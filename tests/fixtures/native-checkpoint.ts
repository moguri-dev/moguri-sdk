import assert from "node:assert/strict";
import { defaultSandboxManagement, type SandboxConfiguration, type StoredEvent } from "../../packages/sdk/src/index.ts";
import { envelope } from "../../apps/service/src/controller.ts";
import { nativeApiFixture } from "./native-api.ts";
import { initializeGeneratedRepository } from "./git-project.ts";
import { waitFor } from "../fixture.ts";

export async function nativeCheckpointFixture(configuration: SandboxConfiguration) {
  const f = await nativeApiFixture(configuration, { scenario: "checkpoint" }), git = initializeGeneratedRepository(f.project);
  git(["config", "user.name", "Generated fixture"]); git(["config", "user.email", "fixture@example.invalid"]);
  let tightened: Promise<unknown> | undefined, sessionId = "";
  const change = (events: StoredEvent[]) => {
    if (tightened || !events.some((event) => event.event_type === "tool.completed" && event.session_id === sessionId &&
      event.payload.call.name === "write_file" && event.payload.outcome === "completed")) return;
    const snapshot = f.service.controller.snapshot(), record = snapshot.winddowns[0]!;
    tightened = f.service.controller.dispatch(envelope({ type: "budget.policy", expectedRevision: snapshot.budgetPolicy.revision,
      limit: { basis: "estimate", tokens: 84 + record.step.inputBound + record.step.outputBound }, confirmRisk: true }));
  };
  try {
    const settings = structuredClone(f.sdk.settings.get()!);
    settings.values.sandbox = f.reviewedConfiguration; settings.values.sandboxManagement = { ...defaultSandboxManagement(), enabled: true, automaticUpdates: false };
    settings.values.winddown = { ...settings.values.winddown, enabled: true, modelId: f.provider.modelId, allowHosted: true, outputTokens: 128 };
    await f.sdk.settings.update(settings.values, settings.revision); await f.qualify();
    const bound = await f.sdk.projects.add(f.project), created = await f.sdk.sessions.create(bound.id!, "Generated accepted native checkpoint",
      { env: "Sandbox", modelId: f.provider.modelId, budget: { kind: "limited", basis: "estimate", tokens: 500000 } });
    sessionId = created.id!; await f.sdk.sessions.autonomy(sessionId, "Autopilot");
    const session = () => f.service.controller.snapshot().sessions.find((entry) => entry.id === sessionId)!;
    f.service.controller.on("change", change);
    await f.sdk.command({ type: "draft.save", sessionId, expectedRevision: 0, text: "Generated native checkpoint work.", attachments: [] });
    await f.sdk.command({ type: "message.send", sessionId, expectedRevision: 1, delivery: "queue" });
    await waitFor(() => !session().turnId && ["completed", "partial", "failed"].includes(session().status), 30000); await tightened;
    const snapshot = f.service.controller.snapshot(), record = snapshot.winddowns[0]!, execution = snapshot.sandboxExecutions![0]!;
    assert.equal(record.status, "ready", record.diagnostic ?? ""); assert.equal(session().status, "partial");
    return { ...f, git, sessionId, snapshot, record, execution, accept: async () => {
      await waitFor(() => f.service.controller.snapshot().checkpointCaptures.findLast((capture) =>
        capture.turnId === execution.turnId && capture.phase === "after" && ["consumed", "failed", "partial"].includes(capture.status)), 30000);
      const current = f.service.controller.snapshot().sandboxExecutions!.find((entry) => entry.id === execution.id);
      assert.ok(current);
      const source = await f.sdk.sandbox.publicationPreview(execution.id, ["fixture.txt"]);
      const admitted = await f.sdk.sandbox.publish(execution.id, ["fixture.txt"], source.preview.digest, current.revision);
      const accepted = await f.sdk.sandbox.waitPublication(admitted.id!);
      assert.equal(accepted.publication.status, "completed"); return accepted;
    } };
  } catch (error) { await f.close(false); throw error; }
  finally { f.service.controller.off("change", change); await tightened; }
}
