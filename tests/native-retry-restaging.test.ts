import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { mkdir, readFile, rename, rmdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { defaultSandboxManagement, MoguriSdk, type ModelFailure, type SandboxExecution, type Snapshot } from "../packages/sdk/src/index.ts";
import { envelope } from "../apps/service/src/controller.ts";
import { startService } from "../apps/service/src/server.ts";
import { nativeConfiguration } from "./fixtures/native-target.ts";
import { nativeApiFixture } from "./fixtures/native-api.ts";
import { GeneratedIntakeClock } from "./fixtures/intake-clock.ts";
import { waitFor } from "./fixture.ts";
import { retainedModelRequest } from "../apps/service/src/model-recovery.ts";
import { privateSource, sandboxRewindFixture, sandboxSignedFixture } from "./fixtures/sandbox-rewind.ts";
import { ciTime } from "./fixtures/time-scale.ts";

const native = await nativeConfiguration();
const git = (root: string, args: string[]): string => {
  const run = (values: string[]) => execFileSync("git", ["--no-pager", "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false",
  "-c", "maintenance.auto=false", "-c", "gc.auto=0", ...values], {
  cwd: root, encoding: "utf8", timeout: ciTime(5000),
  env: { PATH: process.env.PATH, HOME: root, TMPDIR: root, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0",
    GIT_AUTHOR_NAME: "Generated native retry", GIT_AUTHOR_EMAIL: "generated@example.invalid",
    GIT_COMMITTER_NAME: "Generated native retry", GIT_COMMITTER_EMAIL: "generated@example.invalid" },
  }).trimEnd();
  const result = run(args);
  if (args[0] === "init") { run(["config", "--local", "maintenance.auto", "false"]); run(["config", "--local", "gc.auto", "0"]); }
  return result;
};
function retryPreparation(f: Awaited<ReturnType<typeof nativeApiFixture>>, state: Snapshot, failure: ModelFailure, original: SandboxExecution) {
  const preparations = state.sandboxWorkspaces!.filter((workspace) => workspace.sessionId === failure.sessionId &&
    workspace.preparation?.version === 4 && workspace.preparation.retryOrigin?.failureId === failure.id);
  assert.equal(preparations.length, 1, "One original retry capture must own the pre-admission private stage.");
  const workspace = preparations[0]!, owner = workspace.preparation;
  assert.ok(owner?.version === 4 && owner.retryOrigin);
  assert.equal(owner.kind, "turn-admission"); assert.equal(owner.turnId, failure.turnId);
  assert.equal(owner.source.kind, "retry"); assert.equal(owner.source.digest, failure.requestDigest); assert.notEqual(owner.source.id, failure.id);
  assert.equal(owner.retryOrigin.failureId, failure.id); assert.equal(owner.retryOrigin.requestDigest, failure.requestDigest);
  assert.equal(owner.retryOrigin.originExecutionId, original.id); assert.equal(owner.retryOrigin.executionId, original.id);
  assert.equal(owner.retryOrigin.resultDigest, original.resultDigest); assert.equal(owner.retryOrigin.attemptCount, failure.attemptCount + 1);
  const result = JSON.parse(f.service.store.blob(original.resultDigest!));
  assert.equal(owner.retryOrigin.afterId, result.afterId);
  const capture = state.checkpointCaptures.find((capture) => capture.id === owner.captureId);
  assert.ok(capture); assert.equal(capture.checkpointId, owner.checkpointId); assert.equal(capture.turnId, failure.turnId);
  assert.deepEqual(capture.source, owner.source); assert.equal(workspace.commandId, capture.id);
  return { workspace, owner, capture };
}
test("generated retry source validation remains read-only during capture and uses only the exact consumed v4 attempt for execution", async () => {
  const f = await sandboxRewindFixture();
  try {
    f.state.settings.values.interactions.nativeRetryRestaging = true;
    const before = await f.before(), initial = f.state.sandboxWorkspaces![0]!, original = await privateSource(initial.stage!);
    await writeFile(join(initial.stage!.workspace, "file.txt"), "Generated retained retry state.\n");
    const signed = await sandboxSignedFixture(f, before.capture.turnId!, original, await privateSource(initial.stage!), true);
    const input = retainedModelRequest({ version: 2, profileId: "default", sessionId: f.session.id, turnId: before.capture.turnId,
      sourceStepId: randomUUID(), modelId: "generated-model", modelBindingDigest: "1".repeat(64), boundaryDigest: "2".repeat(64),
      controls: f.session.controls, authorizationRevision: 0, endpoint: "https://generated.invalid", api: "generated",
      systemPrompt: "Generated original retry context.", tools: [], toolCatalog: [], maxTokens: 32, contextWindow: 8192,
      loadedTools: [], instructionSources: [], mode: "agent", folders: { denied: [], readOnly: [] }, context: [],
      nativeOrigin: { executionId: signed.execution.id, workspaceId: initial.id, inputDigest: initial.inputDigest, root: initial.stage!.workspace } });
    const now = new Date().toISOString(), failure: ModelFailure = { id: randomUUID(), revision: 0, profileId: "default", sessionId: f.session.id,
      projectId: f.session.projectId, turnId: before.capture.turnId!, sourceStepId: input.sourceStepId, requestDigest: f.store.putBlob(JSON.stringify(input)),
      promptSequence: 1, failedAt: now, updatedAt: now, retryable: true, lastRetryable: true, status: "pending", attemptId: null,
      attemptStepId: null, attemptCount: 0, diagnostic: "Generated original request failure." };
    f.commit([{ event_type: "model.failure_recorded", profile_id: "default", session_id: f.session.id, payload: { failure } }]);
    const attemptId = randomUUID(), capture = f.capture("before", randomUUID(), failure.turnId,
      { kind: "retry", id: attemptId, digest: failure.requestDigest! });
    let validatedCapturing = false;
    f.onCommit((events) => {
      if (!events.some((event) => event.event_type === "session.sandbox_bound")) return;
      assert.equal(f.state.checkpointCaptures.find((entry) => entry.id === capture.id)!.status, "capturing");
      assert.equal(f.workspaces.retrySource(f.session, failure, input).id, signed.execution.id);
      validatedCapturing = true;
    });
    const workspace = await f.read(capture); f.onCommit();
    assert.equal(validatedCapturing, true); assert.equal(f.session.turnId, null);
    assert.equal(f.workspaces.retrySource(f.session, failure, input).id, signed.execution.id);
    await assert.rejects(() => f.workspaces.prepareRetry(f.session.id, failure, input, AbortSignal.timeout(5000)), /actual retained retry attempt/i);
    const selected = f.state.sandboxWorkspaces!.find((entry) => entry.id === f.session.sandboxWorkspaceId)!, count = f.state.sandboxWorkspaces!.length;
    const captured = f.state.checkpointCaptures.find((entry) => entry.id === capture.id)!;
    const retrying: ModelFailure = { ...failure, revision: 1, status: "retrying", attemptId, attemptCount: 1 };
    f.commit([{ event_type: "model.failure_recorded", profile_id: "default", session_id: f.session.id, payload: { failure: retrying } },
      { event_type: "checkpoint.capture_recorded", profile_id: "default", session_id: f.session.id,
        payload: { capture: { ...captured, revision: captured.revision + 1, status: "consumed", consumedByEventId: randomUUID() } } }]);
    f.session.turnId = failure.turnId;
    const ready = await f.workspaces.prepareRetry(f.session.id, retrying, input, AbortSignal.timeout(5000));
    assert.equal(ready.id, selected.id); assert.equal(ready.inputDigest, selected.inputDigest);
    assert.equal(ready.preparation?.version, 4); assert.deepEqual(ready.stage, selected.stage);
    assert.equal(workspace.boundary!.workspaceId, ready.id); assert.equal(f.state.sandboxWorkspaces!.length, count);
    assert.throws(() => f.workspaces.retryCurrent(f.session, { ...retrying, attemptId: randomUUID() }, input), /exact original failure\/turn/i);
    assert.equal(f.store.events().some((event) => event.event_type === "model.started"), false);
  } finally { f.onCommit(); await f.close(); }
});
test("native backoff restages only its original signed private bytes, preserving current live source, draft and unknown original charge", { skip: !native, timeout: ciTime(90000) }, async () => {
  assert.ok(native);
  const clock = new GeneratedIntakeClock(), f = await nativeApiFixture(native, { intakeClock: clock, behavior: "recover-once" });
  let passed = false, sessionId = "", privateGit: { root: string; head: string; index: Buffer } | undefined;
  const initialized = (events: ReturnType<typeof f.service.controller.events>) => {
    if (privateGit) return;
    const recorded = events.find((event) => event.event_type === "sandbox.workspace_recorded" && event.payload.workspace.sessionId === sessionId &&
      event.payload.workspace.status === "ready" && event.payload.workspace.preparation?.version === 4 && event.payload.workspace.preparation.source.kind === "queue");
    if (recorded?.event_type !== "sandbox.workspace_recorded") return;
    const root = recorded.payload.workspace.stage!.workspace;
    git(root, ["init", "--quiet", "--initial-branch=generated-private"]); git(root, ["add", "--", "fixture.txt"]);
    git(root, ["commit", "--quiet", "-m", "Generated retained private history"]);
    writeFileSync(join(root, "generated-private-staged.txt"), "Generated original private staged bytes.\n"); git(root, ["add", "--", "generated-private-staged.txt"]);
    writeFileSync(join(root, "generated-private-untracked.txt"), "Generated original private untracked bytes.\n");
    privateGit = { root, head: git(root, ["rev-parse", "HEAD"]), index: readFileSync(join(root, ".git", "index")) };
  };
  try {
    const settings = structuredClone(f.sdk.settings.get()!);
    settings.values.sandbox = f.reviewedConfiguration;
    settings.values.sandboxManagement = { ...defaultSandboxManagement(), enabled: true, automaticUpdates: false };
    settings.values.interactions.nativeRetryRestaging = true;
    await f.sdk.settings.update(settings.values, settings.revision); await f.qualify();
    git(f.project, ["init", "--quiet", "--initial-branch=generated-source"]); git(f.project, ["add", "--", "fixture.txt"]);
    git(f.project, ["commit", "--quiet", "-m", "Generated retained Local source history"]);
    const project = await f.sdk.projects.add(f.project), created = await f.sdk.sessions.create(project.id!, "Generated exact native retry",
      { env: "Sandbox", modelId: f.provider.modelId });
    sessionId = created.id!; f.service.controller.on("change", initialized);
    const session = () => f.service.controller.snapshot().sessions.find((session) => session.id === created.id)!;
    await f.sdk.command({ type: "draft.save", sessionId: created.id!, expectedRevision: 0, text: "generated native recovery exact snapshot", attachments: [] });
    await f.sdk.command({ type: "message.send", sessionId: created.id!, expectedRevision: 1, delivery: "queue" });
    await waitFor(() => session().status === "failed" && !session().turnId, 30000);
    const original = f.service.controller.snapshot().modelFailures[0]!, first = f.service.controller.snapshot().sandboxExecutions![0]!;
    assert.equal(first.cleanup, "owned-guest-stopped"); assert.equal(original.status, "pending");
    const captured = JSON.parse(f.service.store.blob(original.requestDigest!));
    assert.equal(captured.version, 2); assert.equal(captured.nativeOrigin.executionId, first.id);
    assert.ok(privateGit);
    await writeFile(join(f.project, "fixture.txt"), "Generated changed live checkout must never enter retry.\n");
    await writeFile(join(f.project, "generated-source-staged.txt"), "Generated newer Local staged work.\n"); git(f.project, ["add", "--", "generated-source-staged.txt"]);
    await writeFile(join(f.project, "generated-source-untracked.txt"), "Generated newer Local untracked work.\n");
    const sourceHead = git(f.project, ["rev-parse", "HEAD"]), sourceIndex = await readFile(join(f.project, ".git", "index"));
    await f.sdk.command({ type: "draft.save", sessionId: created.id!, expectedRevision: session().draft.revision, text: "Generated newer untouched draft.", attachments: [] });
    clock.advanceBy(30000);
    await waitFor(() => !session().turnId && ["completed", "failed", "partial"].includes(session().status) &&
      f.service.controller.snapshot().modelFailures[0]?.status !== "pending", 30000);
    const state = f.service.controller.snapshot();
    assert.equal(session().status, "completed", state.modelFailures[0]?.diagnostic ?? session().lastError ?? "");
    assert.equal(state.modelFailures[0]?.status, "recovered"); assert.equal(state.modelFailures[0]?.requestDigest, original.requestDigest);
    assert.equal(state.sandboxExecutions!.length, 2); assert.ok(state.sandboxExecutions!.every((entry) => entry.cleanup === "owned-guest-stopped"));
    const { workspace: retry, owner, capture } = retryPreparation(f, state, original, first);
    assert.ok(retry.stage); assert.equal(retry.status, "ready"); assert.equal(capture.status, "consumed");
    assert.equal(owner.source.id, state.modelFailures[0]!.attemptId); assert.equal(state.sandboxExecutions![1]!.workspaceId, retry.id);
    assert.equal(await readFile(join(retry.stage.workspace, "fixture.txt"), "utf8"), "generated source original\n");
    assert.equal(await readFile(join(f.project, "fixture.txt"), "utf8"), "Generated changed live checkout must never enter retry.\n");
    assert.equal(git(retry.stage.workspace, ["rev-parse", "HEAD"]), privateGit.head);
    assert.deepEqual(await readFile(join(retry.stage.workspace, ".git", "index")), privateGit.index);
    assert.equal(await readFile(join(retry.stage.workspace, "generated-private-staged.txt"), "utf8"), "Generated original private staged bytes.\n");
    assert.equal(await readFile(join(retry.stage.workspace, "generated-private-untracked.txt"), "utf8"), "Generated original private untracked bytes.\n");
    assert.equal(git(f.project, ["rev-parse", "HEAD"]), sourceHead); assert.deepEqual(await readFile(join(f.project, ".git", "index")), sourceIndex);
    assert.equal(await readFile(join(f.project, "generated-source-staged.txt"), "utf8"), "Generated newer Local staged work.\n");
    assert.equal(await readFile(join(f.project, "generated-source-untracked.txt"), "utf8"), "Generated newer Local untracked work.\n");
    assert.deepEqual(JSON.parse(f.service.store.blob(original.requestDigest!)), captured);
    assert.equal(session().draft.text, "Generated newer untouched draft."); assert.equal(session().messages.filter((message) => message.role === "user").length, 1);
    assert.deepEqual(state.budgetEntries.map((entry) => [entry.env, entry.status, entry.reportedTokens]), [["Sandbox", "unknown", null], ["Sandbox", "settled", 42]]);
    assert.equal(f.service.controller.events(0).some((event) => event.event_type === "tool.started"), false);
    assert.equal(f.provider.requests.length, 0); passed = true;
  } finally { f.service.controller.off("change", initialized); await f.close(passed); }
});

test("native retry needs actual opt-in and concurrent manual clients retain only one original attempt", { skip: !native, timeout: ciTime(90000) }, async () => {
  assert.ok(native);
  const f = await nativeApiFixture(native, { behavior: "recover-once" });
  let passed = false, second: MoguriSdk | undefined;
  try {
    const settings = structuredClone(f.sdk.settings.get()!);
    settings.values.sandbox = f.reviewedConfiguration; settings.values.sandboxManagement = { ...defaultSandboxManagement(), enabled: true, automaticUpdates: false };
    await f.sdk.settings.update(settings.values, settings.revision); await f.qualify();
    const project = await f.sdk.projects.add(f.project), created = await f.sdk.sessions.create(project.id!, "Generated manually reviewed native retry", { env: "Sandbox", modelId: f.provider.modelId });
    const id = created.id!, session = () => f.service.controller.snapshot().sessions.find((session) => session.id === id)!;
    await f.sdk.command({ type: "draft.save", sessionId: id, expectedRevision: 0, text: "generated native recovery policy", attachments: [] });
    await f.sdk.command({ type: "message.send", sessionId: id, expectedRevision: 1, delivery: "queue" });
    await waitFor(() => session().status === "failed" && !session().turnId, 30000);
    const failure = f.service.controller.snapshot().modelFailures[0]!;
    const first = f.service.controller.snapshot().sandboxExecutions![0]!;
    await assert.rejects(() => f.sdk.sessions.retry(id, failure.id, failure.revision), /enable|policy|restaging/i);
    assert.equal(f.service.controller.snapshot().sandboxExecutions!.length, 1);
    const enabled = structuredClone(f.sdk.settings.get()!); enabled.values.interactions.nativeRetryRestaging = true;
    await f.sdk.settings.update(enabled.values, enabled.revision); second = await new MoguriSdk(f.service.connection).ready();
    const retainedRoot = `${f.project}-generated-original`;
    await rename(f.project, retainedRoot);
    try {
      await mkdir(f.project);
      const unchanged = f.service.controller.snapshot().modelFailures[0]!;
      await assert.rejects(() => f.sdk.sessions.retry(id, unchanged.id, unchanged.revision), /root|boundary|source|changed/i);
    } finally { await rmdir(f.project); await rename(retainedRoot, f.project); }
    assert.equal(f.service.controller.snapshot().sandboxExecutions!.length, 1);
    const current = f.service.controller.snapshot().modelFailures[0]!;
    const replies = await Promise.all([f.sdk.sessions.retry(id, current.id, current.revision), second.sessions.retry(id, current.id, current.revision)]);
    assert.equal(replies[0].id, replies[1].id);
    await waitFor(() => session().status === "completed" && !session().turnId, 30000);
    const state = f.service.controller.snapshot();
    assert.equal(state.sandboxExecutions!.length, 2); assert.equal(state.modelFailures[0]!.attemptCount, 1);
    const retry = retryPreparation(f, state, failure, first);
    assert.equal(retry.owner.source.id, replies[0].id); assert.equal(retry.capture.status, "consumed");
    assert.equal(state.sandboxExecutions![1]!.workspaceId, retry.workspace.id);
    assert.equal(state.modelFailures[0]!.requestDigest, failure.requestDigest);
    assert.deepEqual(state.budgetEntries.map((entry) => [entry.status, entry.reportedTokens]), [["unknown", null], ["settled", 42]]);
    assert.equal(f.provider.requests.length, 0); passed = true;
  } finally { second?.disconnect(); await f.close(passed); }
});

test("Stop during owned native retry preparation survives a real service restart without stage, model or charge replay", { skip: !native, timeout: ciTime(90000) }, async () => {
  assert.ok(native);
  const clock = new GeneratedIntakeClock(), f = await nativeApiFixture(native, { behavior: "recover-once", intakeClock: clock });
  let passed = false, stop: Promise<unknown> | undefined, sessionId = "", restarted: Awaited<ReturnType<typeof startService>> | undefined;
  const change = (events: ReturnType<typeof f.service.controller.events>) => {
    if (!stop && events.some((event) => event.event_type === "sandbox.workspace_recorded" && event.payload.workspace.sessionId === sessionId &&
      event.payload.workspace.preparation?.version === 4 && event.payload.workspace.preparation.retryOrigin && event.payload.workspace.status === "preparing")) {
      stop = f.service.controller.dispatch(envelope({ type: "session.stop", sessionId }));
    }
  };
  try {
    const settings = structuredClone(f.sdk.settings.get()!);
    settings.values.sandbox = f.reviewedConfiguration; settings.values.sandboxManagement = { ...defaultSandboxManagement(), enabled: true, automaticUpdates: false };
    settings.values.interactions.nativeRetryRestaging = true;
    await f.sdk.settings.update(settings.values, settings.revision); await f.qualify();
    const project = await f.sdk.projects.add(f.project), created = await f.sdk.sessions.create(project.id!, "Generated stopped private retry", { env: "Sandbox", modelId: f.provider.modelId });
    sessionId = created.id!; const session = () => f.service.controller.snapshot().sessions.find((session) => session.id === sessionId)!;
    await f.sdk.command({ type: "draft.save", sessionId, expectedRevision: 0, text: "generated native recovery stop", attachments: [] });
    await f.sdk.command({ type: "message.send", sessionId, expectedRevision: 1, delivery: "queue" });
    await waitFor(() => session().status === "failed" && !session().turnId, 30000);
    f.service.controller.on("change", change);
    const failure = f.service.controller.snapshot().modelFailures[0]!;
    const first = f.service.controller.snapshot().sandboxExecutions![0]!;
    await assert.rejects(() => f.sdk.sessions.retry(sessionId, failure.id, failure.revision), (error) => {
      assert.ok(stop, `The original retry failed before the actual deliberate Stop: ${error instanceof Error ? error.message : String(error)}`);
      return true;
    });
    await waitFor(() => Boolean(stop) && !session().turnId && f.service.controller.snapshot().modelFailures[0]?.status === "cancelled", 10000); await stop;
    const state = f.service.controller.snapshot(), retained = retryPreparation(f, state, failure, first), preparation = retained.workspace;
    assert.equal(preparation.status, "partial"); assert.equal(preparation.stage, null); assert.equal(state.sandboxExecutions!.length, 1);
    assert.equal(retained.capture.status, "failed"); assert.equal(state.modelFailures[0]!.attemptCount, failure.attemptCount);
    assert.equal(f.service.controller.events(0).some((event) => event.event_type === "turn.retry_started"), false);
    assert.equal(state.modelFailures[0]!.requestDigest, failure.requestDigest); assert.equal(state.sandboxExecutions![0]!.resultDigest, first.resultDigest);
    assert.equal(state.budgetEntries.length, 1); assert.equal(state.budgetEntries[0]!.status, "unknown");
    f.sdk.disconnect(); await f.service.close(); restarted = await startService(f.runtimeOptions);
    clock.advanceBy(180000); await new Promise((resolve) => setTimeout(resolve, 50));
    const recovered = restarted.controller.snapshot();
    assert.equal(recovered.modelFailures[0]!.status, "cancelled"); assert.equal(recovered.sandboxExecutions!.length, 1);
    assert.equal(recovered.sandboxWorkspaces!.find((workspace) => workspace.id === preparation.id)!.status, "partial");
    assert.deepEqual(recovered.budgetEntries, state.budgetEntries); assert.equal(f.provider.requests.length, 0); passed = true;
  } finally { f.service.controller.off("change", change); await stop; await restarted?.close(); await f.close(passed); }
});
