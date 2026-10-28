import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Value } from "typebox/value";
import { projectEvents, PROTOCOL_VERSION, type Command, type CommandResult, type EventInput, type Snapshot } from "../packages/protocol/src/index.ts";
import {
  GithubCommandSchema, githubRootQuarantined, projectGithubOperation,
  type GithubCommand, type GithubOperation, type GithubReviewDocument,
} from "../packages/protocol/src/github-workflows.ts";
import type { MoguriSdk } from "../packages/sdk/src/index.ts";
import { createGithubApi } from "../packages/sdk/src/github.ts";
import { GitHubWorkflows } from "../apps/service/src/github-workflows.ts";
import type { WorkspaceFinish } from "../apps/service/src/session-workspace.ts";
import type { WorkflowHost } from "../apps/service/src/workflow-host.ts";
import { digest, EventStore } from "../apps/service/src/store.ts";

const H = "a".repeat(64), G = "b".repeat(40), at = "2026-01-01T00:00:00.000Z";
function fixture() {
  const store = new EventStore(":memory:");
  const root = { root: "/generated/deleted-source", device: "1", inode: "2" };
  const document: GithubReviewDocument = {
    format: "moguri-github-review", version: 1, profileId: "default",
    scope: { env: "Local", projectId: "deleted-project", workspaceId: "deleted-workspace", sessionId: "deleted-session" },
    root, policyDigest: H, action: { kind: "git.push", remote: "origin", branch: "main", forceWithLease: false },
    git: { commonDir: "/generated/deleted-source/.git", head: G, branch: "main", indexDigest: H, statusDigest: H, worktreeDigest: H,
      status: "", rebaseDigest: null, rebaseOriginalHead: null, rebaseOnto: null, rebaseBranch: null },
    remote: { name: "origin", url: "https://github.com/generated/repo.git", ref: "refs/heads/main", sha: G },
    targetSha: null, resource: null, accountId: null, warnings: ["Generated original user review"], confirmations: ["Generated review"],
  };
  const initial: GithubOperation = {
    version: 1, id: randomUUID(), profileId: "default", projectId: "deleted-project", workspaceId: "deleted-workspace", originSessionId: "deleted-session",
    root, kind: "git.push", actor: "user", commandId: randomUUID(), commandDigest: H, reviewDigest: store.putBlob(JSON.stringify(document)),
    inputDigest: store.putBlob(JSON.stringify({ generated: "Original reviewed push input" })), resultDigest: null, jobId: randomUUID(),
    revision: 0, status: "running", dispatched: false, cancelRequested: false, createdAt: at, updatedAt: at, diagnostic: null,
  };
  const event = (operation: GithubOperation): EventInput => ({
    event_type: "github.operation_recorded", profile_id: "default", project_id: operation.projectId,
    session_id: operation.originSessionId, payload: { operation },
  });
  const partial: GithubOperation = { ...initial, revision: 2, dispatched: true, status: "partial", diagnostic: "Generated unknown Git/host-hook effects." };
  store.commit([
    event(initial),
    { event_type: "job.started", profile_id: "default", project_id: initial.projectId, session_id: initial.originSessionId, payload: { job: {
      id: initial.jobId, operationId: initial.id, kind: initial.kind, projectId: initial.projectId, workspaceId: initial.workspaceId,
      sessionId: initial.originSessionId, parentTurnId: null, status: "running", progress: "Generated original work", resultDigest: null, error: null,
    } } },
    event({ ...initial, revision: 1, dispatched: true }), event(partial),
    { event_type: "job.finished", profile_id: "default", project_id: initial.projectId, session_id: initial.originSessionId,
      payload: { jobId: initial.jobId, operationId: initial.id, status: "partial", resultDigest: null, error: partial.diagnostic } },
  ]);
  const snapshot = (): Snapshot => ({ ...projectEvents(store.events()), sessionTelemetry: {}, profileId: "default", protocolVersion: PROTOCOL_VERSION, seq: store.events().at(-1)?.seq ?? 0,
    provider: { status: "disconnected", models: [], login: null, diagnostic: null }, capabilities: [], policy: { revision: 7, allowedEnvs: ["Remote"] } });
  const forbidden = (): never => { throw new Error("Inspection attempted source-root, writer, process or credential authority."); };
  const host: WorkflowHost = {
    snapshot, events: () => store.events(), project: forbidden, configuration: forbidden, assertRoot: forbidden,
    rootBusy: forbidden, closing: forbidden, job: forbidden, commit: (events) => { store.commit(events); },
  };
  const runtime = new GitHubWorkflows(store, host, { runProgram: forbidden });
  const finish = (command: GithubCommand, id = randomUUID()): WorkspaceFinish => {
    const commandDigest = digest(JSON.stringify(command));
    return Object.assign((events: EventInput[], result: CommandResult = {}) => {
      store.commit(events, { id, digest: commandDigest, result }); return result;
    }, { intent: { id, digest: commandDigest } });
  };
  const command = (): Extract<GithubCommand, { type: "github.acknowledge" }> => ({
    type: "github.acknowledge", operationId: partial.id, expectedRevision: partial.revision, expectedInputDigest: partial.inputDigest, confirm: true,
  });
  return { store, partial, runtime, snapshot, finish, command };
}

test("inspection binds the actual-user command, original input and observed revision without requiring a surviving source grant", async () => {
  const f = fixture();
  try {
    assert.equal(f.snapshot().projects.length, 0); assert.equal(f.snapshot().sessions.length, 0);
    const command = f.command(), finish = f.finish(command);
    const result = await f.runtime.execute(command, finish), next = f.snapshot().githubOperations[0]!;
    assert.deepEqual(result, { id: f.partial.id, revision: f.partial.revision + 1 });
    assert.equal(next.status, "partial"); assert.equal(next.diagnostic, f.partial.diagnostic); assert.equal(next.resultDigest, f.partial.resultDigest);
    assert.deepEqual(next.inspection, { actor: "user", at: next.updatedAt, commandId: finish.intent!.id, commandDigest: finish.intent!.digest,
      operationId: f.partial.id, observedRevision: f.partial.revision, inputDigest: f.partial.inputDigest });
    const { inspection: _inspection, revision: _revision, updatedAt: _updatedAt, ...original } = next;
    const { revision: _oldRevision, updatedAt: _oldAt, ...expected } = f.partial;
    assert.deepEqual(original, expected); assert.equal(f.snapshot().jobs[0]?.status, "partial");
    assert.equal(githubRootQuarantined(f.snapshot(), f.partial.root.root), false);
    const count = f.store.events().length;
    assert.deepEqual(await f.runtime.execute(command, finish), result); assert.equal(f.store.events().length, count);
    f.store.db.prepare("DELETE FROM receipts WHERE profile_id=? AND id=?").run("default", finish.intent!.id);
    await assert.rejects(() => f.runtime.execute(command, finish), { code: "github_no_replay" }); assert.equal(f.store.events().length, count);
    const read = await f.runtime.query({ type: "github.read", operationId: f.partial.id });
    assert.equal(read.type, "github.read"); if (read.type === "github.read") assert.equal(read.operation.status, "partial");
    f.runtime.recover(); assert.equal(f.store.events().length, count);
  } finally { f.runtime.close(); f.store.close(); }
});

test("stale revisions, replaced original input, false confirmation and invented actors cannot acknowledge a partial root", async () => {
  const f = fixture();
  try {
    const before = f.store.events().length;
    for (const command of [{ ...f.command(), expectedRevision: 0 }, { ...f.command(), expectedInputDigest: H }]) {
      await assert.rejects(() => f.runtime.execute(command, f.finish(command)), { code: "github_inspection_stale" });
    }
    assert.equal(Value.Check(GithubCommandSchema, { ...f.command(), confirm: false }), false);
    assert.equal(Value.Check(GithubCommandSchema, { ...f.command(), actor: "model" }), false);
    await assert.rejects(() => f.runtime.execute(f.command(), (() => ({})) as WorkspaceFinish), { code: "github_intent" });
    assert.equal(f.store.events().length, before); assert.equal(githubRootQuarantined(f.snapshot(), f.partial.root.root), true);
    const command = f.command(); await f.runtime.execute(command, f.finish(command));
    const again = { ...command, expectedRevision: f.partial.revision + 1 };
    await assert.rejects(() => f.runtime.execute(again, f.finish(again)), { code: "github_inspection" });
  } finally { f.runtime.close(); f.store.close(); }
});

test("the projector permits only one exact terminal inspection addition, never result/status/scope rewrites or model attribution", () => {
  const f = fixture();
  try {
    const next: GithubOperation = { ...f.partial, revision: f.partial.revision + 1, updatedAt: at, inspection: {
      actor: "user", at, commandId: "generated-user-inspection", commandDigest: H, operationId: f.partial.id,
      observedRevision: f.partial.revision, inputDigest: f.partial.inputDigest,
    } };
    assert.deepEqual(projectGithubOperation(f.partial, next), next);
    for (const changed of [
      { ...next, status: "completed", diagnostic: null }, { ...next, projectId: "adopted-alias" }, { ...next, resultDigest: H },
      { ...next, diagnostic: "Cleanup proven" }, { ...next, dispatched: false }, { ...next, root: { ...next.root, root: "/another/root" } },
      { ...next, inspection: { ...next.inspection!, actor: "model" } }, { ...next, inspection: { ...next.inspection!, observedRevision: 0 } },
      { ...next, inspection: { ...next.inspection!, inputDigest: H } }, { ...next, inspection: { ...next.inspection!, operationId: "another-operation" } },
      { ...next, inspection: { ...next.inspection!, commandId: f.partial.commandId } },
    ]) assert.throws(() => projectGithubOperation(f.partial, changed), { code: "github_corrupt" });
    assert.throws(() => projectGithubOperation(next, { ...next, revision: next.revision + 1, inspection: undefined }), { code: "github_corrupt" });
    assert.throws(() => projectGithubOperation(next, { ...next, revision: next.revision + 1, inspection: { ...next.inspection!, commandId: "replacement" } }), { code: "github_corrupt" });
  } finally { f.runtime.close(); f.store.close(); }
});

test("canonical root quarantine survives project/workspace/profile aliases and acknowledges only its exact retained operation", () => {
  const f = fixture();
  try {
    const foreign: GithubOperation = { ...f.partial, id: "foreign-partial", profileId: "other-profile", projectId: "other-project", workspaceId: null };
    const alias = { githubOperations: [f.partial, foreign] };
    assert.equal(githubRootQuarantined(alias, f.partial.root.root), true);
    assert.equal(githubRootQuarantined({ githubOperations: [{ ...f.partial, projectId: "new-alias", workspaceId: "new-workspace" }] }, f.partial.root.root), true);
    assert.equal(githubRootQuarantined(alias, "/unrelated/canonical-root"), false);
    const inspected: GithubOperation = { ...f.partial, revision: f.partial.revision + 1, inspection: { actor: "user", at, commandId: "inspection", commandDigest: H,
      operationId: f.partial.id, observedRevision: f.partial.revision, inputDigest: f.partial.inputDigest } };
    assert.equal(githubRootQuarantined({ githubOperations: [inspected, foreign] }, f.partial.root.root), true);
    assert.equal(githubRootQuarantined({ githubOperations: [inspected] }, f.partial.root.root), false);
    assert.equal(githubRootQuarantined({ githubOperations: [{ ...f.partial, kind: "github.pr.merge" }] }, f.partial.root.root), false);
  } finally { f.runtime.close(); f.store.close(); }
});

test("the SDK inspection helper sends only exact operation/revision/input confirmation, not source or actor authority", async () => {
  const f = fixture(), sent: Command[] = [];
  try {
    const sdk = { command: async (command: Command) => {
      sent.push(command); assert.equal(command.type, "github.acknowledge");
      return f.runtime.execute(command as GithubCommand, f.finish(command as GithubCommand));
    } } as unknown as MoguriSdk;
    const result = await createGithubApi(sdk).acknowledge(f.partial.id, f.partial.revision, f.partial.inputDigest, true);
    assert.equal(result.id, f.partial.id); assert.deepEqual(sent, [f.command()]);
    assert.equal(f.snapshot().githubOperations[0]?.status, "partial");
  } finally { f.runtime.close(); f.store.close(); }
});
