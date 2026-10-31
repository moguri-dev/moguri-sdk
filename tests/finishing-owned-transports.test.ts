import test from "node:test";
import assert from "node:assert/strict";
import type { StoredEvent } from "../packages/sdk/src/index.ts";
import { defaultKupoSettings, isRecord } from "../packages/sdk/src/index.ts";
import { envelope } from "../apps/service/src/controller.ts";
import { routedFixture } from "./fixtures/single-routing.ts";
import { waitFor } from "./fixture.ts";
import { generatedKupoProfile } from "./fixtures/kupo-profiles.ts";

for (const { unknown, kupo } of [{ unknown: false, kupo: false }, { unknown: true, kupo: false }, { unknown: false, kupo: true }]) {
  test(`actual SSH ${kupo ? "Savings Kupo" : "fixed-model"} finishing ${unknown ? "retains unknown usage" : "transfers its original hold"} without Local or task-history input`, { skip: process.platform !== "darwin", timeout: 30_000 }, async () => {
    const fixture = await routedFixture({ env: "Remote", configured: false, legacy: false });
    let tightened: Promise<unknown> | undefined;
    const change = (events: StoredEvent[]) => {
      if (tightened || !events.some((event) => event.event_type === "model.completed" && event.session_id === fixture.sessionId &&
        event.payload.usage.role === "solver")) return;
      const record = fixture.service.controller.snapshot().winddowns[0]!;
      assert.ok(record);
      fixture.solverOptions.omitUsage = unknown;
      tightened = fixture.service.controller.dispatch(envelope({ type: "budget.policy", expectedRevision: fixture.service.controller.snapshot().budgetPolicy.revision,
        limit: { basis: "estimate", tokens: 42 + record.step.inputBound + record.step.outputBound }, confirmRisk: true }));
    };
    try {
      const settings = structuredClone(fixture.sdk.settings.get()!.values);
      settings.winddown = { ...settings.winddown, enabled: true, modelId: fixture.solverId, outputTokens: 128 };
      settings.kupo = { ...defaultKupoSettings(), approvedModelIds: [fixture.solverId] };
      await fixture.sdk.settings.update(settings, fixture.sdk.settings.get()!.revision);
      if (kupo) {
        const profile = await generatedKupoProfile(fixture.sdk, fixture.solverId, { category: "economy", score: 0.4, price: 0 });
        await fixture.sdk.routing.configure({ ...defaultKupoSettings(), approvedModelIds: [fixture.solverId], modelProfiles: [profile] },
          fixture.sdk.settings.get()!.revision);
      }

      await fixture.sdk.sessions.configure(fixture.sessionId, { ...fixture.session().controls, env: "Remote", modelId: kupo ? "kupo" : fixture.solverId,
        budget: { kind: "limited", basis: "estimate", tokens: 50_000 } });
      if (kupo) await fixture.sdk.sessions.kupoMode(fixture.sessionId, "savings");
      fixture.solverOptions.toolCall = { name: "read_file", args: { path: "fixture.txt" } };
      fixture.solverOptions.respond = (request) => JSON.stringify(request.messages).includes("untrustedCheckpointMetadata") ?
        { text: '{"summary":"Generated source-independent SSH finishing data."}' } : !JSON.stringify(request.messages).includes('"role":"tool"') ?
          { tool: fixture.solverOptions.toolCall } : { text: "Generated ordinary answer." };
      fixture.service.controller.on("change", change);
      await fixture.send("GENERATED_ORIGINAL_TASK_NOT_FINISHING_CONTEXT");
      await waitFor(() => !fixture.session().turnId && ["completed", "partial", "failed"].includes(fixture.session().status), 20_000);
      await tightened;
      const state = fixture.service.controller.snapshot(), record = state.winddowns[0]!;
      assert.equal(fixture.session().status, "partial", fixture.session().lastError ?? "");
      assert.equal(record.version, 2); assert.equal(record.env, "Remote"); assert.equal(record.status, unknown ? "partial" : "ready");
      assert.equal(record.version === 2 && record.transport?.executionId, state.executions[0]?.id);
      assert.equal(fixture.requests.length, 0); assert.equal(fixture.solver.requests.length, 2); assert.equal(state.executions.length, 1);
      assert.deepEqual(state.budgetEntries.map((entry) => [entry.env, entry.role]), [["Remote", "solver"], ["Remote", "checkpoint"]]);
      assert.equal(state.budgetEntries[1]?.status, unknown ? "unknown" : "settled");
      assert.equal(state.budgetPlans.find((plan) => plan.id === record.step.planId)?.status, "consumed");
      if (kupo) {
        assert.equal(fixture.session().controls.kupoMode, "savings");
        assert.ok(state.budgetPlans.some((plan) => plan.purpose === "routing" && plan.env === "Remote" && plan.status === "consumed"));
      }
      const sent = JSON.stringify(fixture.solver.requests[1]!.messages);
      assert.match(sent, /untrustedCheckpointMetadata/);
      const messages = fixture.solver.requests[1]!.messages;
      assert.ok(Array.isArray(messages));
      const user = messages.filter(isRecord).find((message) => message.role === "user");
      assert.equal(JSON.parse(String(user?.content)).untrustedCheckpointMetadata.env, "Remote");
      assert.equal(sent.includes("GENERATED_ORIGINAL_TASK_NOT_FINISHING_CONTEXT"), false); assert.equal(fixture.solver.requests[1]!.tools, undefined);
      if (!unknown) {
        await assert.rejects(() => fixture.sdk.winddown.commitPreview({ sessionId: fixture.sessionId, winddownId: record.id,
          candidateIds: ["generated-nonlocal-candidate"], branch: "generated/never-local", message: "Generated unqualified Git." }),
          /Local accepted-work\/Git|Remote\/native boundary/);
      }
    } finally { fixture.service.controller.off("change", change); await tightened; await fixture.close(); }
  });
}
