import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { modelRequest } from "../apps/service/src/model-controls.ts";
import { assistantMessage } from "../apps/service/src/worker-protocol.ts";
import { startService } from "../apps/service/src/server.ts";
import { digest } from "../apps/service/src/store.ts";
import { MoguriSdk, projectRoleSequence, interruptedRoleSequence, type RoleSequenceRecord } from "../packages/sdk/src/index.ts";
import { budgetPlanFixture } from "./fixtures/budget-plan-api.ts";
import { ownedRoleWorker } from "./fixtures/owned-role-worker.ts";

test("actual candidate-stage roles consume complete planned capacity and retain exact starts/results before continuation; a failed append preserves the unknown hold", { timeout: 25_000 }, async () => {
  for (const failCompletion of [false, true]) {
    const f = await budgetPlanFixture(), roles = ["draft", "critic", "revision"] as const, started = performance.now();
    const text = JSON.stringify({ format: "moguri-role-sequence-input", version: 1, generatedFixtureOnly: true, roles });
    const created = await f.sdk.artifacts.create(f.sessionId, { kind: "report", name: "Generated actual worker role evidence", text });
    const artifact = (await f.sdk.artifacts.read(created.id!)).artifact;
    const planned = f.budget.planBatch(f.session(), roles.map((role) => ({ ...f.request, id: randomUUID(), turnId: artifact.id, role, inputEstimate: 4096, maxOutputTokens: 64 })));
    const now = new Date().toISOString(), initial: RoleSequenceRecord = { version: 1, id: artifact.id, profileId: f.control.profileId, sessionId: f.sessionId, ownerSessionId: f.sessionId,
      ownerTurnId: artifact.id, projectId: f.session().projectId, workspaceId: f.session().workspaceId, folderId: planned.plans[0]!.folderId, env: "Local",
      commandId: randomUUID(), commandDigest: digest("Generated exact owned worker command."), inputDigest: artifact.contentDigest,
      authorityDigest: f.request.authorityDigest, policyDigest: digest("Generated exact owned worker role policy."), revision: 0, createdAt: now, updatedAt: now,
      status: "running", stopRequested: false, diagnostic: null, steps: planned.plans.map((plan, index) => ({
        planId: plan.id, role: roles[index]!, modelId: plan.modelId, providerId: plan.providerId, apiModelId: plan.apiModelId, inputBound: plan.inputBound, outputBound: plan.outputBound,
        state: "pending", stepId: null, inputDigest: null, resultDigest: null, outcome: null, diagnostic: null,
      })) };
    const current = () => f.control.snapshot().roleSequences.find((sequence) => sequence.id === initial.id)!;
    let reopened: Awaited<ReturnType<typeof startService>> | undefined;
    await f.sdk.budgets.policy({ basis: "estimate", tokens: planned.plans.reduce((total, plan) => total + plan.tokens, 0) }, 0, true);
    f.append([...planned.events, f.control.platform.roles.event(initial), { event_type: "turn.control_started", profile_id: f.control.profileId, project_id: f.session().projectId,
      session_id: f.sessionId, turn_id: initial.id, payload: { purpose: "role.sequence", sequenceId: initial.id, controls: f.session().controls,
        policyRevision: f.control.snapshot().policy.revision, promptDigest: initial.inputDigest } }]);
    if (failCompletion) f.service.store.db.exec(`CREATE TRIGGER generated_owned_role_result BEFORE INSERT ON events
      WHEN json_extract(NEW.data,'$.event_type')='model.completed' BEGIN SELECT RAISE(ABORT,'Generated owned role receipt failure'); END;`);
    const worker = await ownedRoleWorker({
      admit: ({ index, stepId, prepared, context, systemPrompt, output }) => {
        const role = roles[index]!, spec = modelRequest(prepared.model, undefined, { systemPrompt, messages: context, tools: [] });
        const admitted = f.budget.consumePlan(f.session(), planned.plans[index]!.id, { ...f.request, turnId: initial.id, stepId, role, providerId: prepared.model.provider,
          apiModelId: prepared.model.id, inputEstimate: spec.estimatedTokens, maxOutputTokens: output });
        const previous = current(), next = structuredClone(previous);
        next.revision++; next.updatedAt = new Date().toISOString();
        next.steps[index] = { ...next.steps[index]!, state: "started", stepId, inputDigest: f.service.store.putBlob(JSON.stringify({ systemPrompt, messages: context })) };
        f.append([...admitted.events, { event_type: "model.started", profile_id: f.control.profileId, session_id: f.sessionId,
          project_id: f.session().projectId, turn_id: initial.id, step_id: stepId,
          payload: { modelId: f.modelId, providerId: prepared.model.provider, apiModelId: prepared.model.id, role, source: "local", contextEstimate: spec.estimatedTokens } },
        f.control.platform.roles.event(projectRoleSequence(previous, next))]);
        return admitted.maxTokens;
      },
      retain: (request, index) => {
        const message = assistantMessage(request.message); assert.equal(request.usageReported, true);
        const previous = current(), next = structuredClone(previous), resultDigest = f.service.store.putBlob(JSON.stringify(message));
        next.revision++; next.updatedAt = new Date().toISOString();
        next.steps[index] = { ...next.steps[index]!, state: "recorded", resultDigest, outcome: "stop" };
        f.append([{ event_type: "model.completed", profile_id: f.control.profileId, session_id: f.sessionId, project_id: f.session().projectId,
          turn_id: initial.id, step_id: request.stepId, payload: {
            contextDigest: resultDigest,
            message: { id: request.stepId, turnId: initial.id, role: "notice", text: "Generated unaccepted role result.", timestamp: new Date().toISOString() },
            usage: { stepId: request.stepId, modelId: f.modelId, apiModelId: message.model, providerId: message.provider, source: "local", role: roles[index]!,
              inputTokens: message.usage.input, outputTokens: message.usage.output, totalTokens: message.usage.totalTokens,
              cacheReadTokens: null, quality: "provider-reported", requestMs: request.generationMs, outcome: message.stopReason,
              estimatedUsd: null, providerReportedUsd: null, billedUsd: null },
          } }, f.control.platform.roles.event(projectRoleSequence(previous, next))]);
      },
      finish: (request) => f.append([f.control.platform.roles.event(request.outcome === "completed" ?
        projectRoleSequence(current(), { ...current(), revision: current().revision + 1, status: "completed", updatedAt: new Date().toISOString() }) :
        interruptedRoleSequence(current(), request.diagnostic ?? "Generated owned worker ended without complete retained roles.")),
      { event_type: "turn.finished", profile_id: f.control.profileId, session_id: f.sessionId, project_id: f.session().projectId, turn_id: initial.id,
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
      const ids = entries.map((entry) => entry.id);
      await f.sdk.sessions.delete(f.sessionId, true, f.session().revision); await f.service.close();
      reopened = await startService({ stateDir: join(f.directory, "state"), provider: f.provider, retentionKey: f.retentionKey });
      const peer = await new MoguriSdk(reopened.connection).ready();
      try {
        assert.deepEqual((await peer.budgets.calls()).calls.map((entry) => entry.id).sort(), ids.sort());
        assert.equal((await peer.budgets.dashboard()).totals.reportedTokens, failCompletion ? null : 126);
        const retained = await peer.roleSequences.read(initial.id, 0);
        assert.equal(retained.sequence.status, failCompletion ? "partial" : "completed");
        assert.equal(retained.step?.result !== null, !failCompletion);
        assert.equal(JSON.parse((await peer.artifacts.export(initial.id)).export.text).schemaVersion, 4);
        assert.equal(worker.providers.reduce((total, provider) => total + provider.requests.length, 0), failCompletion ? 1 : 3);
      } finally { peer.disconnect(); }
      console.log(JSON.stringify({ primitive: "actual-owned-role-budget-acknowledgement", failedResult: failCompletion, calls: entries.length,
        reportedTokens: status.totals.reportedTokens, heldTokens: status.totals.heldTokens, ms: performance.now() - started, productionWorkflow: false }));
    } finally { await worker.close(); await reopened?.close(); await f.close(); }
  }
});
