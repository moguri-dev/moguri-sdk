import assert from "node:assert/strict";
import { test } from "node:test";
import { compareSessionPrompts, sessionNavigationStatus, sessionBackgroundWork, workspaceDiffSummary, type ActivityEntry, type CapabilityJob, type Session, type SessionActivity } from "../packages/sdk/src/index.ts";
import { setupFixture } from "./fixture.ts";

test("navigation filters distinguish actual completion, failures, attention and active work without relabeling held or stopped sessions", async () => {
  const f = await setupFixture();
  try {
    const snapshot = structuredClone(f.service.controller.snapshot()), session = snapshot.sessions[0]!;
    for (const status of ["idle", "queued", "stopped"] as const) {
      session.status = status; assert.equal(sessionNavigationStatus(session, snapshot), null);
    }
    session.status = "completed"; assert.equal(sessionNavigationStatus(session, snapshot), "finished");
    for (const status of ["failed", "partial"] as const) { session.status = status; assert.equal(sessionNavigationStatus(session, snapshot), "error"); }
    session.status = "running"; session.turnId = "generated-current-turn";
    assert.equal(sessionNavigationStatus(session, snapshot), "progress");
    session.pendingQuestionId = "generated-owning-question";
    assert.equal(sessionNavigationStatus(session, snapshot), "attention");
    assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});

test("prompt ordering ignores assistant activity, edits and unsent drafts and uses actual creation time only for unsent sessions", async () => {
  const f = await setupFixture();
  try {
    const base = f.session();
    const make = (id: string, createdAt: string, timestamp?: string): Session => ({ ...structuredClone(base), id, createdAt,
      messages: timestamp ? [{ id: `${id}-prompt`, role: "user", text: "Generated prompt", timestamp, turnId: `${id}-turn` }] : [] });
    const first = make("generated-first", "2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z");
    const last = make("generated-last", "2025-01-01T00:00:00Z", "2026-01-04T00:00:00Z");
    const unsent = make("generated-unsent", "2026-01-03T00:00:00Z");
    first.messages.push({ id: "generated-later-assistant", role: "assistant", text: "Generated streaming answer", timestamp: "2026-01-05T00:00:00Z", turnId: "generated-first-turn" });
    first.updatedAt = "2026-01-06T00:00:00Z"; first.draft.text = "Generated unsent edit.";
    assert.deepEqual([last, unsent, first].sort((a, b) => compareSessionPrompts(a, b, "oldest")).map((session) => session.id), [first.id, unsent.id, last.id]);
    assert.deepEqual([first, unsent, last].sort((a, b) => compareSessionPrompts(a, b, "newest")).map((session) => session.id), [last.id, unsent.id, first.id]);
    assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});

test("workspace line counts distinguish hunk content from headers, binary changes and mode-only changes", () => {
  const patch = "diff --git a/generated.txt b/generated.txt\nindex 1111111..2222222 100644\n--- a/generated.txt\n+++ b/generated.txt\n@@ -1,2 +1,3 @@\n-old\n+++ literal content\n context\n+new\n\\ No newline at end of file\n";
  assert.deepEqual(workspaceDiffSummary(patch), { additions: 2, deletions: 1, binaryFiles: 0 });
  assert.deepEqual(workspaceDiffSummary(`${patch}diff --git a/generated.bin b/generated.bin\nindex 1111111..2222222 100644\nBinary files a/generated.bin and b/generated.bin differ\n`),
    { additions: 2, deletions: 1, binaryFiles: 1 });
  assert.deepEqual(workspaceDiffSummary("diff --git a/generated.sh b/generated.sh\nold mode 100644\nnew mode 100755\n"), { additions: 0, deletions: 0, binaryFiles: 0 });
});

test("partial or unsupported diffs never produce successful-looking counts", () => {
  for (const patch of [
    "diff --git a/generated.txt b/generated.txt\n--- a/generated.txt\n+++ b/generated.txt\n@@ -1,2 +1,2 @@\n-old\n+new\n",
    "diff --git a/generated.txt b/generated.txt\n@@ -1 +1 @@\n-old\n+new\n+extra\n",
    "diff --git a/generated.txt b/generated.txt\nindex 1111111..2222222 100644\n--- a/generated.txt\n+++ b/generated.txt\n",
    "diff --git a/generated.txt b/generated.txt\nnew file mode 100644\n--- /dev/null\n+++ b/generated.txt\n",
    "\\ No newline at end of file\n",
    "diff --cc generated.txt\n@@@ -1,1 -1,1 +1,1 @@@\n",
    "Generated truncated patch",
  ]) assert.throws(() => workspaceDiffSummary(patch), /complete unified diff/i);
});

test("background work uses actual agent origins and live command ownership, not nesting, approvals or duplicate job calls", async () => {
  const fixture = await setupFixture();
  try {
    const snapshot = structuredClone(fixture.service.controller.snapshot()), parent = snapshot.sessions[0]!;
    parent.turnId = "generated-current-turn"; parent.status = "running";
    const child = (id: string, changes: Partial<Session>): Session => ({ ...structuredClone(parent), id, createdParentSessionId: parent.id,
      parentSessionId: parent.id, kind: "subagent", ...changes });
    snapshot.sessions.push(
      child("generated-running-agent", { parentSessionId: undefined }),
      child("generated-coordinated-agent", { kind: "agent", coordinationParentId: parent.id }),
      child("generated-organized-other-agent", { createdParentSessionId: "generated-other-parent" }),
      child("generated-side-chat", { kind: "side" }),
      child("generated-manual-nesting", { kind: "agent" }),
      child("generated-finished-agent", { turnId: null, status: "completed" }),
    );
    const job = (id: string, parentTurnId: string): CapabilityJob => ({ id, kind: "command", sessionId: parent.id, projectId: parent.projectId, parentTurnId,
      commandJob: { root: fixture.project, command: "Generated watch command", timeoutMs: 1000, callId: "generated-watch-call", env: "Local" },
      status: "running", progress: "Running", resultDigest: null, error: null });
    snapshot.jobs.push(job("generated-current-watch", parent.turnId), { ...job("generated-finished-watch", parent.turnId), status: "completed" },
      { ...job("generated-foreign-watch", parent.turnId), sessionId: "generated-other-session" });
    const command = (id: string, changes: Partial<ActivityEntry> = {}): ActivityEntry => ({
      id, sessionId: parent.id, turnId: parent.turnId, stepId: "generated-step", messageId: id, sequence: 1, updatedSequence: 1,
      source: "tool", actor: "model", toolName: "run_command", kind: "command", label: "Run command", subject: "Generated command",
      status: "running", startedAt: null, finishedAt: null, durationMs: null, durationBasis: "observed-lifecycle",
      outputBytes: null, outputBasis: "retained-tail", hasArguments: true, hasOutput: false, ...changes,
    });
    const current = [command("generated-normal-call"), command("generated-watch-operation", { messageId: "generated-watch-call" }),
      command("generated-awaiting-approval", { status: "pending" }), command("generated-ended-turn", { turnId: "generated-old-turn" })];
    const activity: SessionActivity = { sessionId: parent.id, sequence: 1, entries: current, current, currentCount: current.length, messageOrder: [], nextBefore: null };
    const work = sessionBackgroundWork(parent, snapshot, activity);
    assert.deepEqual(work.agents.map((agent) => agent.id), ["generated-running-agent", "generated-coordinated-agent"]);
    assert.ok(work.agentSessions.some((agent) => agent.id === "generated-finished-agent"), "finished agents remain inspectable without counting as running");
    assert.deepEqual(work.commands.map((entry) => entry.id), ["generated-normal-call"]);
    assert.deepEqual(work.jobs.map((entry) => entry.id), ["generated-current-watch"]);
    assert.equal(work.count, 4); assert.equal(work.complete, true);
    snapshot.jobs.find((job) => job.id === "generated-current-watch")!.parentTurnId = "generated-old-turn";
    assert.equal(sessionBackgroundWork(parent, snapshot, activity).count, 5, "a reused call ID in a different turn is separate owned work");
    assert.equal(sessionBackgroundWork(parent, snapshot, { ...activity, currentCount: 101 }).complete, false);
    assert.equal(sessionBackgroundWork(parent, snapshot, { ...activity, sessionId: "generated-other-session" }).commands.length, 0);
    assert.equal(fixture.requests.length, 0);
  } finally { await fixture.close(); }
});
