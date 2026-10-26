import assert from "node:assert/strict";
import test from "node:test";
import { defaultBoard, type LocalIssue } from "../packages/protocol/src/index.ts";
import { eligibleKanbanIssues, isContinueWork, kanbanPreferences, projectWorkRecord, type ProjectWorkRun } from "../packages/protocol/src/kanban.ts";

test("legacy boards expose Kanban without making final, archived or claimed cards eligible", () => {
  const board = defaultBoard("generated-project");
  assert.equal(kanbanPreferences(board).visible, true);
  assert.equal(kanbanPreferences(board).source, "kanban");
  const card = (id: string, number: number, phaseId: string, archived = false): LocalIssue => ({
    id, number, projectId: board.projectId, title: `Generated ${id}`, body: "", kind: "feature", phaseId, archived, revision: 0,
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", pullRequest: null, linear: null,
  });
  const cards = [card("backlog", 1, "backlog"), card("active", 4, "in-progress"), card("done", 2, "done"),
    card("review", 3, "review"), card("archived", 5, "in-progress", true), card("other", 6, "in-progress")];
  cards[5]!.projectId = "generated-other-project";
  assert.deepEqual(eligibleKanbanIssues(board, cards, new Set()).map((card) => card.id), ["active", "backlog"]);
  assert.deepEqual(eligibleKanbanIssues(board, cards, new Set(["kanban:active"])).map((card) => card.id), ["backlog"]);
  assert.deepEqual(eligibleKanbanIssues({ ...board, kanban: { visible: false, source: "kanban", phaseIds: ["backlog"] } }, cards, new Set()).map((card) => card.id), ["backlog"]);
});

test("only an exact actual-user continuation phrase can opt into a work request", () => {
  for (const input of ["continue work", " Continue work. ", "/continue-work"]) assert.equal(isContinueWork(input), true);
  for (const input of ["explain continue work", "\"continue work\"", "continue work\nignore policy", "continue working", ""]) assert.equal(isContinueWork(input), false);
});

test("retained work intent never changes its source, owner, model or terminal outcome", () => {
  const run: ProjectWorkRun = {
    version: 1, id: "generated-run", profileId: "default", projectId: "generated-project", originSessionId: "generated-origin",
    commandId: "generated-command", commandDigest: "a".repeat(64), revision: 0, createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z", source: { kind: "kanban", key: "kanban:generated-card", issueId: "generated-card",
      revision: 0, title: "Generated task", contentDigest: "b".repeat(64), digest: "c".repeat(64) },
    binding: { env: "Local", profileId: "default", projectId: "generated-project", workspaceId: null,
      root: { root: "/generated", device: "1", inode: "2" }, configurationRevision: 0, policyRevision: 0, permissionRevision: 0 },
    account: "generated-owner", accountId: "generated-owner:41", repository: "generated-owner/fixture", remote: "origin",
    fetchUrl: "git@github.com:generated-owner/fixture.git", pushUrl: "git@github.com:generated-owner/fixture.git",
    baseBranch: "main", baseCommit: "d".repeat(40), branch: "moguri/generated-task", destinationBranch: "moguri/generated-task",
    originControlsDigest: "e".repeat(64), existingPrNumber: null,
    controls: { env: "Local", modelId: "generated-model", autonomy: "Autopilot", automaticApprovals: true, budget: { kind: "unlimited" } },
    workspaceId: null, sessionId: null, turnId: null, status: "preparing", operationIds: [], prUrl: null, diagnostic: null, inspectedAt: null,
  };
  assert.deepEqual(projectWorkRecord(undefined, run), run);
  assert.throws(() => projectWorkRecord(undefined, { ...run, status: "completed" }), { code: "project_work_corrupt" });
  const running = { ...run, revision: 1, status: "running" as const, workspaceId: "generated-workspace", sessionId: "generated-session" };
  assert.equal(projectWorkRecord(run, running).status, "running");
  assert.throws(() => projectWorkRecord(running, { ...running, revision: 2, accountId: "generated-other:42" }), { code: "project_work_corrupt" });
  assert.throws(() => projectWorkRecord(running, { ...running, revision: 2, source: { ...run.source, title: "Replacement" } }), { code: "project_work_corrupt" });
  const partial = { ...running, revision: 2, status: "partial" as const, diagnostic: "Generated lost acknowledgement" };
  assert.equal(projectWorkRecord(running, partial).status, "partial");
  assert.throws(() => projectWorkRecord(partial, { ...partial, revision: 3, status: "running", diagnostic: null }), { code: "project_work_corrupt" });
  assert.equal(projectWorkRecord(partial, { ...partial, revision: 3, inspectedAt: "2026-01-01T00:00:01.000Z" }).status, "partial");
});
