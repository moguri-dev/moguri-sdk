import test from "node:test";
import assert from "node:assert/strict";
import { defaultKupoSettings, defaultSandboxManagement, type StoredEvent } from "../packages/sdk/src/index.ts";
import { envelope } from "../apps/service/src/controller.ts";
import { nativeConfiguration } from "./fixtures/native-target.ts";
import { nativeApiFixture } from "./fixtures/native-api.ts";
import { waitFor } from "./fixture.ts";

const native = await nativeConfiguration();
for (const behavior of [undefined, "unknown-checkpoint", "hold-checkpoint"] as const)
test(`actual native finite ${behavior === "hold-checkpoint" ? "fixed-model" : "Kupo"} checkpoint ${behavior ?? "known result"} keeps its original guest/hold without Local Git or task context`, { skip: !native, timeout: 90_000 }, async () => {
  assert.ok(native);
  const fixture = await nativeApiFixture(native, { scenario: "finishing", behavior }), { sdk, service, provider, project } = fixture;
  let passed = false, tightened: Promise<unknown> | undefined, checkpointStreamed = false;
  let sessionId = "";
  const change = (events: StoredEvent[]) => {
    if (events.some((event) => event.event_type === "assistant.delta" && event.step_id === service.controller.snapshot().winddowns[0]?.step.stepId)) checkpointStreamed = true;
    if (tightened || !events.some((event) => event.event_type === "model.completed" && event.session_id === sessionId && event.payload.usage.role === "solver")) return;
    const record = service.controller.snapshot().winddowns[0]!;
    tightened = service.controller.dispatch(envelope({ type: "budget.policy", expectedRevision: service.controller.snapshot().budgetPolicy.revision,
      limit: { basis: "estimate", tokens: 42 + record.step.inputBound + record.step.outputBound }, confirmRisk: true }));
  };
  try {
    const settings = structuredClone(sdk.settings.get()!);
    settings.values.sandbox = fixture.reviewedConfiguration;
    settings.values.sandboxManagement = { ...defaultSandboxManagement(), enabled: true, automaticUpdates: false };
    settings.values.winddown = { ...settings.values.winddown, enabled: true, modelId: provider.modelId, allowHosted: true, outputTokens: 128 };
    settings.values.kupo = { ...defaultKupoSettings(), approvedModelIds: [provider.modelId] };
    await sdk.settings.update(settings.values, settings.revision); await sdk.sandbox.probe();
    const bound = await sdk.projects.add(project), created = await sdk.sessions.create(bound.id!, "Generated native finite Kupo",
      { env: "Sandbox", modelId: behavior === "hold-checkpoint" ? provider.modelId : "kupo", budget: { kind: "limited", basis: "estimate", tokens: 500_000 } });
    sessionId = created.id!;
    const session = () => service.controller.snapshot().sessions.find((entry) => entry.id === sessionId)!;
    service.controller.on("change", change);
    await sdk.command({ type: "draft.save", sessionId, expectedRevision: 0, text: "GENERATED_NATIVE_TASK_NOT_FINISHING_INPUT", attachments: [] });
    await sdk.command({ type: "message.send", sessionId, expectedRevision: 1, delivery: "queue" });
    if (behavior === "hold-checkpoint") {
      await waitFor(() => checkpointStreamed, 30000);
      await sdk.winddown.stop(service.controller.snapshot().winddowns[0]!.id);
    }
    await waitFor(() => !session().turnId && ["completed", "partial", "failed"].includes(session().status), 30000).catch((error: unknown) => {
      const state = service.controller.snapshot();
      throw new Error(`Generated native finishing gate: ${JSON.stringify({ status: session().status, error: session().lastError, records: state.winddowns,
        entries: state.budgetEntries.map((entry) => ({ env: entry.env, role: entry.role, status: entry.status })) })}`, { cause: error });
    });
    await tightened;
    const state = service.controller.snapshot(), record = state.winddowns[0]!, execution = state.sandboxExecutions![0]!;
    assert.equal(session().status, "partial", session().lastError ?? ""); assert.equal(record.status, behavior ? "partial" : "ready");
    assert.equal(record.version, 2); assert.equal(record.env, "Sandbox"); assert.equal(record.version === 2 && record.transport?.executionId, execution.id);
    assert.equal(state.sandboxExecutions!.length, 1); assert.equal(execution.cleanup, "owned-guest-stopped"); assert.equal(provider.requests.length, 0);
    assert.deepEqual(state.budgetEntries.map((entry) => [entry.env, entry.role, entry.reportedTokens]), [["Sandbox", "solver", 42], ["Sandbox", "checkpoint", behavior ? null : 42]]);
    assert.equal(state.budgetEntries[1]?.status, behavior ? "unknown" : "settled");
    assert.equal(state.budgetPlans.find((plan) => plan.id === record.step.planId)?.status, "consumed");
    if (behavior !== "hold-checkpoint") assert.ok(state.budgetPlans.some((plan) => plan.purpose === "routing" && plan.env === "Sandbox" && plan.status === "consumed"));
    const result = (await sdk.sandbox.result(execution.id)).result!;
    const proof = JSON.parse(result.files.find((file) => file.path === "generated-native-decisions.json")!.text);
    assert.deepEqual(proof.calls.map((call: { role: string }) => call.role), ["solver", "checkpoint"]);
    assert.equal(new Set(proof.calls.map((call: { pid: number }) => call.pid)).size, 1);
    assert.deepEqual(proof.calls[1].tools, []); assert.equal(proof.calls[1].maxOutput, 128);
    passed = true;
  } finally { service.controller.off("change", change); await tightened; await fixture.close(passed); }
});
