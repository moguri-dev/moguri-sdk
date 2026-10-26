import assert from "node:assert/strict";
import test from "node:test";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MoguriSdk, kanbanPreferences, ProjectWorkReadSchema } from "../packages/sdk/src/index.ts";
import { githubApplicationFixture } from "./github-workflows-fixture.ts";
import { fixtureProvider, setupFixture, waitFor } from "./fixture.ts";
import { Value } from "typebox/value";

test("each project has one shared lazily opened Kanban chat and hiding it preserves cards", async () => {
  const fixture = await githubApplicationFixture();
  const other = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const [first, second] = await Promise.all([fixture.sdk.kanban.open(fixture.projectId), other.kanban.open(fixture.projectId)]);
    assert.equal(first.id, second.id);
    await fixture.sdk.refresh();
    assert.equal(fixture.sdk.getState().snapshot!.sessions.filter((session) => session.purpose === "kanban").length, 1);
    const board = (await fixture.sdk.issues.board(fixture.projectId)).board;
    const card = await fixture.sdk.issues.create(fixture.projectId, { title: "Generated card", body: "Generated board text", kind: "feature", phaseId: "backlog", pullRequestUrl: null });
    await fixture.sdk.issues.configure(fixture.projectId, { ...board, kanban: { ...kanbanPreferences(board), visible: false } }, board.revision);
    await other.refresh();
    assert.equal(kanbanPreferences((await other.issues.board(fixture.projectId)).board).visible, false);
    assert.ok(other.getState().snapshot!.issues.some((issue) => issue.id === card.id));
    assert.ok(other.getState().snapshot!.sessions.some((session) => session.id === first.id));
    await fixture.sdk.sessions.organize(fixture.sessionId, { workItemId: card.id! });
    assert.equal(fixture.session().workItemId, card.id);
    const items = await other.kanban.items(fixture.projectId);
    assert.equal(items.local[0]?.body, "Generated board text");
    await assert.rejects(() => fixture.sdk.kanban.continue(first.id!), { code: "model_unavailable" });
    assert.equal(fixture.service.controller.snapshot().projectWorkRuns.length, 0);
  } finally { other.disconnect(); await fixture.close(); }
});

test("read-only chats can inspect their board with a read-only schema but cannot acquire publication authority", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture({ toolCall: { name: "project_work", args: { action: "read" } } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.configure();
    await sdk.issues.create(fixture.session().projectId!, { title: "Generated readable card", body: "Generated readable source.", kind: "feature", phaseId: "backlog", pullRequestUrl: null });
    await sdk.sessions.mode(fixture.sessionId, "read-only");
    await sdk.sessions.autonomy(fixture.sessionId, "Autopilot");
    const tool = (await sdk.tools.catalog(fixture.sessionId, "project_work")).tools.find((tool) => tool.name === "project_work")!;
    assert.ok(tool);
    assert.deepEqual(tool.parameters, JSON.parse(JSON.stringify(ProjectWorkReadSchema)));
    assert.equal(Value.Check(ProjectWorkReadSchema, { action: "read" }), true);
    assert.equal(Value.Check(ProjectWorkReadSchema, { action: "publish", title: "Generated", body: "" }), false);
    await fixture.send("Generated read-only board request");
    assert.equal((await fixture.terminal()).status, "completed");
    assert.ok(fixture.service.controller.events(0).some((event) => event.event_type === "tool.completed" && event.payload.text.includes("Generated readable source.")));
    assert.equal(fixture.service.controller.snapshot().projectWorkRuns.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("a continuation cannot exceed the existing eight-level navigation bound before creating any task or checkout", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.configure();
    let parent = fixture.sessionId;
    for (let index = 0; index < 7; index++) parent = (await sdk.sessions.spawn(parent, "agent", `Generated depth ${index + 1}`)).id!;
    await assert.rejects(() => sdk.kanban.continue(parent), { code: "project_work_depth" });
    assert.equal(fixture.service.controller.snapshot().projectWorkRuns.length, 0);
    assert.equal(fixture.service.controller.snapshot().managedWorkspaces.length, 0);
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});

for (const mergedColumnId of ["done", "review"] as const) test(`one captured card ends at its draft PR without moving to the configured ${mergedColumnId} merged phase`, { skip: process.platform !== "darwin" }, async () => {
  const provider = await fixtureProvider({ toolCalls: [
    { name: "run_command", args: { command: "printf 'generated task change\\n' > task.txt && git add -- task.txt && git -c commit.gpgsign=false commit --no-gpg-sign -m 'Generated task change'", timeoutMs: 15000 } },
    { name: "project_work", args: { action: "publish", title: "Generated task PR", body: "Generated implementation details and fixture validation." } },
  ] });
  const fixture = await githubApplicationFixture({ provider: provider.provider, ownedNetwork: true });
  try {
    await fixture.sdk.refresh();
    const modelId = fixture.sdk.getState().snapshot!.provider.models[0]!.id;
    await fixture.sdk.sessions.configure(fixture.sessionId, { ...fixture.session().controls, modelId });
    if (mergedColumnId !== "done") {
      const board = (await fixture.sdk.issues.board(fixture.projectId)).board;
      await fixture.sdk.issues.configure(fixture.projectId, { ...board, mergedColumnId }, board.revision);
    }
    const card = await fixture.sdk.issues.create(fixture.projectId, { title: "Generated isolated task", body: "Implement the generated task", kind: "feature", phaseId: "backlog", pullRequestUrl: null });
    await writeFile(join(fixture.root, "unrelated.txt"), "generated preserved source index\n");
    fixture.git(["add", "--", "unrelated.txt"]);
    const sourceHead = fixture.git(["rev-parse", "HEAD"]), sourceIndex = fixture.git(["write-tree"]);
    const started = await fixture.sdk.kanban.continue(fixture.sessionId, card.id!);
    const run = await waitFor(() => fixture.service.controller.snapshot().projectWorkRuns.find((run) => run.id === started.id && ["completed", "failed", "partial"].includes(run.status)), 60000);
    assert.equal(run.status, "completed", run.diagnostic ?? JSON.stringify(fixture.service.controller.snapshot().sessions.find((session) => session.id === run.sessionId)?.messages));
    await waitFor(() => fixture.service.controller.snapshot().sessions.find((session) => session.id === run.sessionId)?.status === "completed");
    assert.equal(provider.requests.length, 2, "Publication must not admit another paid model call");
    assert.equal(fixture.writes().pulls, 1);
    assert.equal(run.operationIds.length, 2);
    assert.equal(fixture.git(["rev-parse", "HEAD"]), sourceHead);
    assert.equal(fixture.git(["write-tree"]), sourceIndex);
    assert.equal(await readFile(join(fixture.root, "unrelated.txt"), "utf8"), "generated preserved source index\n");
    assert.equal(fixture.session().controls.autonomy, "Manual");
    const snapshot = fixture.service.controller.snapshot(), task = snapshot.sessions.find((session) => session.id === run.sessionId)!;
    assert.equal(task.controls.autonomy, "Autopilot");
    assert.equal(task.controls.automaticApprovals, true);
    assert.equal(task.coordinationParentId, fixture.sessionId);
    assert.equal(task.workItemId, card.id);
    assert.equal(task.prUrl, run.prUrl);
    assert.equal(snapshot.issues.find((issue) => issue.id === card.id)?.phaseId, mergedColumnId === "done" ? "review" : "backlog");
    assert.ok(snapshot.githubOperations.filter((operation) => run.operationIds.includes(operation.id)).every((operation) => operation.actor === "model" && operation.projectWorkId === run.id));
    assert.ok(snapshot.budgetEntries.every((entry) => entry.ownerSessionId === fixture.sessionId));
    const retained = (await fixture.sdk.kanban.work(run.id)).text, workspace = snapshot.managedWorkspaces.find((workspace) => workspace.id === run.workspaceId)!;
    await fixture.sdk.sessions.delete(fixture.sessionId, true);
    assert.equal((await fixture.sdk.kanban.work(run.id)).text, retained);
    assert.equal((await stat(workspace.path)).isDirectory(), true);
    assert.equal(fixture.service.controller.snapshot().budgetEntries.length, 2);
    assert.equal(provider.requests.length, 2);
  } finally { await fixture.close(); await provider.close(); }
});

test("concurrent clients claim one card once; acknowledged stop retains unknown usage and requires inspection before another task", { skip: process.platform !== "darwin" }, async () => {
  const provider = await fixtureProvider();
  const fixture = await githubApplicationFixture({ provider: provider.provider, ownedNetwork: true });
  const other = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.sdk.sessions.configure(fixture.sessionId, { ...fixture.session().controls, modelId: provider.modelId });
    const second = await fixture.sdk.sessions.create(fixture.projectId, "Generated competing origin", { modelId: provider.modelId });
    const card = await fixture.sdk.issues.create(fixture.projectId, { title: "Generated claimed card", body: "generated slow task", kind: "feature", phaseId: "backlog", pullRequestUrl: null });
    const attempts = await Promise.allSettled([fixture.sdk.kanban.continue(fixture.sessionId, card.id!), other.kanban.continue(second.id!, card.id!)]);
    assert.equal(attempts.filter((attempt) => attempt.status === "fulfilled").length, 1);
    assert.equal(fixture.service.controller.snapshot().projectWorkRuns.length, 1);
    const task = await waitFor(() => fixture.service.controller.snapshot().projectWorkRuns.find((run) => run.status === "running" && run.sessionId), 15000);
    await waitFor(() => provider.requests.length === 1);
    await fixture.sdk.kanban.cancel(task.id);
    const terminal = await waitFor(() => {
      const run = fixture.service.controller.snapshot().projectWorkRuns.find((run) => run.id === task.id);
      return run && !["preparing", "running", "publishing"].includes(run.status) &&
        !fixture.service.controller.snapshot().sessions.find((session) => session.id === run.sessionId)?.turnId ? run : null;
    }, 15000);
    assert.notEqual(terminal.status, "completed");
    assert.equal(fixture.service.controller.snapshot().managedWorkspaces.length, 1);
    assert.equal(fixture.writes().pulls, 0);
    assert.ok(fixture.service.controller.snapshot().budgetEntries.some((entry) => entry.status === "unknown" && entry.reservedTokens! > 0));
    await assert.rejects(() => other.kanban.continue(second.id!, card.id!), { code: "project_work_claimed" });
    await fixture.sdk.kanban.inspect(terminal.id, terminal.revision, true);
    assert.ok((await fixture.sdk.kanban.work(task.id)).run.inspectedAt);
    assert.equal(provider.requests.length, 1);
  } finally { other.disconnect(); await fixture.close(); await provider.close(); }
});

for (const source of ["github-issues", "github-prs"] as const) {
  test(`configured ${source} uses the actual open source and ${source === "github-prs" ? "updates its exact PR instead of creating another" : "opens one draft PR"}`, { skip: process.platform !== "darwin" }, async () => {
    const provider = await fixtureProvider({ toolCalls: [
      { name: "run_command", args: { command: "printf 'generated source task\\n' > source-task.txt && git add -- source-task.txt && git -c commit.gpgsign=false commit --no-gpg-sign -m 'Generated source task'", timeoutMs: 15000 } },
      { name: "project_work", args: { action: "publish", title: "Generated source implementation", body: "Generated source implementation details." } },
    ] });
    const fixture = await githubApplicationFixture({ provider: provider.provider, ownedNetwork: true });
    try {
      await fixture.sdk.sessions.configure(fixture.sessionId, { ...fixture.session().controls, modelId: provider.modelId });
      const board = (await fixture.sdk.issues.board(fixture.projectId)).board;
      await fixture.sdk.issues.configure(fixture.projectId, { ...board, kanban: { visible: true, source, phaseIds: ["backlog"] } }, board.revision);
      const started = await fixture.sdk.kanban.continue(fixture.sessionId);
      const run = await waitFor(() => fixture.service.controller.snapshot().projectWorkRuns.find((run) => run.id === started.id &&
        ["completed", "failed", "partial"].includes(run.status)), 60000);
      assert.equal(run.status, "completed", run.diagnostic ?? JSON.stringify(fixture.service.controller.snapshot().sessions.find((session) => session.id === run.sessionId)?.messages));
      assert.equal(provider.requests.length, 2);
      if (source === "github-prs") {
        assert.equal(run.existingPrNumber, 11);
        assert.equal(run.prUrl, "https://github.com/generated-owner/fixture/pull/11");
        assert.equal(fixture.calls.filter((call) => call.method === "POST" && call.path === "repos/generated-owner/fixture/pulls").length, 0);
        assert.equal(fixture.calls.filter((call) => call.method === "PATCH" && call.path === "repos/generated-owner/fixture/pulls/11").length, 1);
      } else {
        assert.equal(run.existingPrNumber, null);
        assert.equal(fixture.service.controller.snapshot().sessions.find((session) => session.id === run.sessionId)?.workItemUrl, "https://github.com/generated-owner/fixture/issues/7");
      }
    } finally { await fixture.close(); await provider.close(); }
  });
}

test("actual-user continue work starts a task, while a held prompt stays inert and cannot grant publication from a normal chat", { skip: process.platform !== "darwin" }, async () => {
  const provider = await fixtureProvider({ responseMode: "text" });
  const fixture = await githubApplicationFixture({ provider: provider.provider, ownedNetwork: true });
  try {
    await fixture.sdk.sessions.configure(fixture.sessionId, { ...fixture.session().controls, modelId: provider.modelId });
    await fixture.sdk.issues.create(fixture.projectId, { title: "Generated continuation", body: "Generated task body", kind: "feature", phaseId: "backlog", pullRequestUrl: null });
    await fixture.sdk.command({ type: "draft.save", sessionId: fixture.sessionId, expectedRevision: 0, text: "continue work", attachments: [] });
    await fixture.sdk.command({ type: "message.send", sessionId: fixture.sessionId, expectedRevision: 1, delivery: "queue", held: true });
    assert.equal(fixture.service.controller.snapshot().projectWorkRuns.length, 0);
    assert.equal(provider.requests.length, 0);
    const queue = fixture.session();
    await fixture.sdk.command({ type: "queue.remove", sessionId: queue.id, messageId: queue.queue[0]!.id, expectedRevision: queue.queueRevision });
    await fixture.sdk.command({ type: "draft.save", sessionId: queue.id, expectedRevision: fixture.session().draft.revision, text: "continue work", attachments: [] });
    await fixture.sdk.command({ type: "message.send", sessionId: queue.id, expectedRevision: fixture.session().draft.revision, delivery: "queue" });
    await waitFor(() => fixture.service.controller.snapshot().projectWorkRuns[0]?.status === "failed", 15000);
    assert.equal(provider.requests.length, 1);
    assert.equal(fixture.writes().pulls, 0);
    assert.match(fixture.service.controller.snapshot().projectWorkRuns[0]!.diagnostic!, /without a verified published PR/);
    assert.equal(fixture.session().controls.autonomy, "Manual");
  } finally { await fixture.close(); await provider.close(); }
});

test("a successful publication denies remaining same-response calls without another paid step or malformed dangling tool history", { skip: process.platform !== "darwin" }, async () => {
  const provider = await fixtureProvider({ toolBatches: [
    [{ name: "run_command", args: { command: "printf 'generated batched task\\n' > batch.txt && git add -- batch.txt && git -c commit.gpgsign=false commit --no-gpg-sign -m 'Generated batched task'", timeoutMs: 15000 } }],
    [{ name: "project_work", args: { action: "publish", title: "Generated bounded endpoint", body: "Generated endpoint details" } },
      { name: "run_command", args: { command: "printf 'must not execute' > forbidden-after-publication.txt", timeoutMs: 15000 } }],
  ] });
  const fixture = await githubApplicationFixture({ provider: provider.provider, ownedNetwork: true });
  try {
    await fixture.sdk.sessions.configure(fixture.sessionId, { ...fixture.session().controls, modelId: provider.modelId });
    const card = await fixture.sdk.issues.create(fixture.projectId, { title: "Generated batch endpoint", body: "", kind: "feature", phaseId: "backlog", pullRequestUrl: null });
    const start = await fixture.sdk.kanban.continue(fixture.sessionId, card.id!);
    const run = await waitFor(() => fixture.service.controller.snapshot().projectWorkRuns.find((run) => run.id === start.id && run.status === "completed"), 60000);
    await waitFor(() => fixture.service.controller.snapshot().sessions.find((session) => session.id === run.sessionId)?.status === "completed");
    const workspace = fixture.service.controller.snapshot().managedWorkspaces.find((workspace) => workspace.id === run.workspaceId)!;
    await assert.rejects(() => stat(join(workspace.path, "forbidden-after-publication.txt")), { code: "ENOENT" });
    const skipped = fixture.service.controller.events(0).filter((event) => event.session_id === run.sessionId && event.event_type === "tool.completed" &&
      event.payload.call.arguments.command === "printf 'must not execute' > forbidden-after-publication.txt");
    assert.equal(skipped.length, 1); assert.equal(skipped[0]?.event_type === "tool.completed" ? skipped[0].payload.outcome : null, "denied");
    assert.equal(provider.requests.length, 2);
  } finally { await fixture.close(); await provider.close(); }
});

test("a changed same-repository push URL cannot inherit the original autonomous publication grant", { skip: process.platform !== "darwin" }, async () => {
  const provider = await fixtureProvider({ toolCalls: [
    { name: "run_command", args: { command: "printf 'generated destination task\\n' > destination.txt && git add -- destination.txt && git -c commit.gpgsign=false commit --no-gpg-sign -m 'Generated destination task' && git remote set-url --push origin https://github.com/generated-owner/fixture.git", timeoutMs: 15000 } },
    { name: "project_work", args: { action: "publish", title: "Generated must-not-publish", body: "Generated stale destination." } },
  ] });
  const fixture = await githubApplicationFixture({ provider: provider.provider, ownedNetwork: true });
  try {
    await fixture.sdk.sessions.configure(fixture.sessionId, { ...fixture.session().controls, modelId: provider.modelId });
    const card = await fixture.sdk.issues.create(fixture.projectId, { title: "Generated destination binding", body: "", kind: "feature", phaseId: "backlog", pullRequestUrl: null });
    const started = await fixture.sdk.kanban.continue(fixture.sessionId, card.id!);
    const terminal = await waitFor(() => fixture.service.controller.snapshot().projectWorkRuns.find((run) => run.id === started.id &&
      ["partial", "failed", "completed"].includes(run.status)), 60000);
    assert.equal(terminal.status, "partial");
    assert.match(terminal.diagnostic!, /destination changed/);
    assert.equal(terminal.operationIds.length, 0);
    assert.equal(fixture.writes().pulls, 0);
    assert.equal(fixture.bare(["for-each-ref", "--format=%(refname)", `refs/heads/${terminal.branch}`]), "");
  } finally { await fixture.close(); await provider.close(); }
});
