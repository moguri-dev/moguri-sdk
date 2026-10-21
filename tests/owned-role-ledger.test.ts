import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { modelRequest } from "../apps/service/src/model-controls.ts";
import { assistantMessage } from "../apps/service/src/worker-protocol.ts";
import { startService } from "../apps/service/src/server.ts";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { budgetPlanFixture } from "./fixtures/budget-plan-api.ts";
import { ownedRoleWorker } from "./fixtures/owned-role-worker.ts";

test("actual candidate-stage roles consume complete planned capacity and retain exact starts/results before continuation; a failed append preserves the unknown hold", { timeout: 25_000 }, async () => {
  for (const failCompletion of [false, true]) {
    const f = await budgetPlanFixture(), roles = ["draft", "critic", "revision"] as const, started = performance.now();
    const planned = f.budget.planBatch(f.session(), roles.map((role) => ({ ...f.request, id: randomUUID(), role, inputEstimate: 4096, maxOutputTokens: 64 })));
    let reopened: Awaited<ReturnType<typeof startService>> | undefined;
    await f.sdk.budgets.policy({ basis: "estimate", tokens: planned.plans.reduce((total, plan) => total + plan.tokens, 0) }, 0, true);
    f.append(planned.events);
    if (failCompletion) f.service.store.db.exec(`CREATE TRIGGER generated_owned_role_result BEFORE INSERT ON events
      WHEN json_extract(NEW.data,'$.event_type')='model.completed' BEGIN SELECT RAISE(ABORT,'Generated owned role receipt failure'); END;`);
    const worker = await ownedRoleWorker({
      admit: ({ index, stepId, prepared, context, systemPrompt, output }) => {
        const role = roles[index]!, spec = modelRequest(prepared.model, undefined, { systemPrompt, messages: context, tools: [] });
        const admitted = f.budget.consumePlan(f.session(), planned.plans[index]!.id, { ...f.request, stepId, role, providerId: prepared.model.provider,
          apiModelId: prepared.model.id, inputEstimate: spec.estimatedTokens, maxOutputTokens: output });
        f.append([...admitted.events, { event_type: "model.started", profile_id: f.control.profileId, session_id: f.sessionId,
          project_id: f.session().projectId, turn_id: f.request.turnId, step_id: stepId,
          payload: { modelId: f.modelId, providerId: prepared.model.provider, apiModelId: prepared.model.id, role, source: "local", contextEstimate: spec.estimatedTokens } }]);
        return admitted.maxTokens;
      },
      retain: (request, index) => {
        const message = assistantMessage(request.message); assert.equal(request.usageReported, true);
        f.append([{ event_type: "model.completed", profile_id: f.control.profileId, session_id: f.sessionId, project_id: f.session().projectId,
          turn_id: f.request.turnId, step_id: request.stepId, payload: {
            contextDigest: f.service.store.putBlob(JSON.stringify(message)),
            message: { id: request.stepId, turnId: f.request.turnId, role: "notice", text: "Generated unaccepted role result.", timestamp: new Date().toISOString() },
            usage: { stepId: request.stepId, modelId: f.modelId, apiModelId: message.model, providerId: message.provider, source: "local", role: roles[index]!,
              inputTokens: message.usage.input, outputTokens: message.usage.output, totalTokens: message.usage.totalTokens,
              cacheReadTokens: null, quality: "provider-reported", requestMs: request.generationMs, outcome: message.stopReason,
              estimatedUsd: null, providerReportedUsd: null, billedUsd: null },
          } }]);
      },
      finish: (request) => f.append([{ event_type: "turn.finished", profile_id: f.control.profileId, session_id: f.sessionId, project_id: f.session().projectId, turn_id: f.request.turnId,
        payload: { outcome: request.outcome, diagnostic: request.diagnostic, workspaceEffects: "none" } }]),
    });
    try {
      const terminal = await worker.settled();
      assert.equal(terminal.kind === "finished" && terminal.outcome, failCompletion ? "partial" : "completed");
      const status = f.budget.status(f.sessionId), entries = f.control.snapshot().budgetEntries;
      assert.equal(entries.length, failCompletion ? 1 : 3); assert.equal(status.totals.calls, entries.length); assert.equal(status.totals.plannedHolds, 0);
      assert.equal(status.totals.billedUsd, null); assert.equal(worker.retentionFailures.length, failCompletion ? 1 : 0);
      if (failCompletion) {
        assert.equal(worker.providers[1]?.requests.length, 0); assert.equal(status.totals.reportedTokens, null); assert.ok(status.totals.heldTokens! > 0);
        assert.equal(entries[0]?.status, "unknown"); assert.deepEqual(f.control.snapshot().budgetPlans.map((plan) => plan.status), ["consumed", "released", "released"]);
      } else {
        assert.deepEqual(entries.map((entry) => entry.role), roles); assert.equal(status.totals.reportedTokens, 126); assert.equal(status.totals.heldTokens, 0);
        assert.equal(worker.providers.reduce((total, provider) => total + provider.requests.length, 0), 3);
      }
      const ids = entries.map((entry) => entry.id); await f.service.close();
      reopened = await startService({ stateDir: join(f.directory, "state"), provider: f.provider, retentionKey: f.retentionKey });
      const peer = await new MoguriSdk(reopened.connection).ready();
      try {
        assert.deepEqual((await peer.budgets.calls()).calls.map((entry) => entry.id).sort(), ids.sort());
        assert.equal((await peer.budgets.dashboard()).totals.reportedTokens, failCompletion ? null : 126);
        assert.equal(worker.providers.reduce((total, provider) => total + provider.requests.length, 0), failCompletion ? 1 : 3);
      } finally { peer.disconnect(); }
      console.log(JSON.stringify({ primitive: "actual-owned-role-budget-acknowledgement", failedResult: failCompletion, calls: entries.length,
        reportedTokens: status.totals.reportedTokens, heldTokens: status.totals.heldTokens, ms: performance.now() - started, productionWorkflow: false }));
    } finally { await worker.close(); await reopened?.close(); await f.close(); }
  }
});
