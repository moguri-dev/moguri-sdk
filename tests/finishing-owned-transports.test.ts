import test from "node:test";
import assert from "node:assert/strict";
import { isRecord } from "../packages/sdk/src/index.ts";
import { waitFor } from "./fixture.ts";
import { remoteWinddownApiFixture } from "./fixtures/winddown-api.ts";
import { holdRemoteFrame } from "./fixtures/remote-frame-gate.ts";

for (const { unknown, kupo, late } of [{ unknown: false, kupo: false, late: false }, { unknown: true, kupo: false, late: false },
  { unknown: false, kupo: true, late: false }, { unknown: false, kupo: false, late: true }]) {
  test(`actual SSH ${kupo ? "Savings Kupo" : "fixed-model"} finishing ${unknown ? "retains unknown usage" : late ? "reconciles original late data" : "transfers its original hold"} without Local or task-history input`, { skip: process.platform !== "darwin", timeout: 30_000 }, async (t) => {
    const fixture = await remoteWinddownApiFixture({ unknown, kupo });
    const gate = late ? holdRemoteFrame(t, fixture.service.controller.remote, "model.complete", (request) => isRecord(request) &&
      fixture.service.controller.snapshot().budgetEntries.find((entry) => entry.id === request.stepId)?.role === "checkpoint") : undefined;
    try {
      await Promise.all([fixture.run(), (async () => {
        if (gate) { await waitFor(() => gate.held, 15000); await fixture.sdk.command({ type: "session.stop", sessionId: fixture.sessionId }); }
      })()]);
      if (gate) {
        await waitFor(() => fixture.service.controller.snapshot().executions.every((execution) => !fixture.service.controller.remote.owns(execution.id)), 12000);
        await fixture.sdk.remote.reconcile(fixture.service.controller.snapshot().executions[0]!.id);
      }
      const state = fixture.service.controller.snapshot(), record = state.winddowns[0]!;
      assert.equal(fixture.session().status, "partial", fixture.session().lastError ?? "");
      assert.equal(record.version, 2); assert.equal(record.env, "Remote"); assert.equal(record.status, unknown || late ? "partial" : "ready");
      assert.equal(record.version === 2 && record.transport?.executionId, state.executions[0]?.id);
      assert.equal(fixture.requests.length, 0); assert.equal(fixture.solver.requests.length, 2); assert.equal(state.executions.length, 1);
      assert.deepEqual(state.budgetEntries.map((entry) => [entry.env, entry.role]), [["Remote", "solver"], ["Remote", "checkpoint"]]);
      assert.equal(state.budgetEntries[1]?.status, unknown ? "unknown" : "settled");
      assert.equal(state.budgetPlans.find((plan) => plan.id === record.step.planId)?.status, "consumed");
      if (late) {
        assert.equal(record.step.state, "recorded");
        const result = (await fixture.sdk.winddown.read(record.id)).result;
        assert.ok(result); assert.equal(JSON.parse(JSON.parse(result).content[0].text).summary, "Generated source-independent SSH finishing data.");
      }
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
    } finally { gate?.restore(); await fixture.close(); }
  });
}
