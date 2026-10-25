import test from "node:test";
import assert from "node:assert/strict";
import { setupFixture, waitFor } from "./fixture.ts";
import { envelope } from "../apps/service/src/controller.ts";
import { tools } from "../apps/service/src/tools.ts";
import { EventStore } from "../apps/service/src/store.ts";
import { startService } from "../apps/service/src/server.ts";
import { join } from "node:path";

test("interrupted watch intent retains its original root and blocks resume without process adoption or replay", async () => {
  const f = await setupFixture();
  let restarted: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    await f.service.close();
    const store = new EventStore(join(f.directory, "state", "state.sqlite"), f.retentionKey), session = f.session();
    store.commit([{ event_type: "job.started", profile_id: "default", project_id: session.projectId, session_id: session.id, payload: { job: {
      id: "generated-crashed-watch", kind: "command.watch", projectId: session.projectId, workspaceId: null, sessionId: session.id, parentTurnId: null,
      status: "running", progress: "Original generated intent", resultDigest: null, error: null,
      commandJob: { root: f.project, env: "Local", command: "printf 'Must never be replayed'", timeoutMs: 10000, callId: "generated-original-call" },
    } } }]); store.close();
    restarted = await startService({ stateDir: join(f.directory, "state"), provider: f.provider, retentionKey: f.retentionKey });
    const snapshot = restarted.controller.snapshot(), job = snapshot.jobs.find((job) => job.id === "generated-crashed-watch")!;
    assert.equal(job.status, "partial"); assert.equal(job.commandJob?.root, f.project);
    assert.ok(snapshot.blockedProjects.includes(session.projectId)); assert.equal(f.requests.length, 0);
    await assert.rejects(() => restarted!.controller.dispatch(envelope({ type: "session.resume", sessionId: session.id })), { code: "command_inspection" });
    const read = await restarted.controller.platform.query({ type: "tooling.command", sessionId: session.id, input: { jobId: job.id } });
    if (read.type !== "tooling.command") assert.fail("Missing captured watch inspection.");
    assert.equal(read.data.source, "unavailable"); assert.equal(read.data.elapsedMs, null);
    await restarted.controller.dispatch(envelope({ type: "tooling.command.acknowledge", sessionId: session.id, jobId: job.id, expectedDigest: read.data.inspectionDigest!, confirmInspection: true }));
    assert.equal(restarted.controller.snapshot().jobs.find((job) => job.id === "generated-crashed-watch")?.status, "partial");
    assert.equal(f.requests.length, 0);
  } finally { await restarted?.close(); await f.close(); }
});

test("explicit watch jobs survive a completed model turn, expose real logs and cancel without success-shaped results", { timeout: 12000 }, async () => {
  assert.ok(tools.some((tool) => tool.name === "command_job"), "The owned command-job capability is missing.");
  const f = await setupFixture({ toolCall: { name: "command_job", args: { action: "start", command: "printf 'Generated watch ready\\n'; sleep 30", timeoutMs: 60000 } } });
  try {
    await f.configure(); await f.send("Generated explicit watch job.");
    await waitFor(() => f.session().pendingApproval?.call.name === "command_job"); await f.approve();
    await f.terminal();
    const job = await waitFor(() => f.service.controller.snapshot().jobs.find((job) => job.kind === "command.watch"));
    assert.equal(job.status, "running");
    await waitFor(() => f.service.controller.platform.commandJobRead(f.sessionId, job.id).text?.includes("Generated watch ready"));
    const logs = await f.service.controller.platform.delegate(f.session(), { id: "read", name: "read_command_job", arguments: { jobId: job.id } }, new AbortController().signal);
    assert.match(logs.text, /Generated watch ready/);
    await f.service.controller.dispatch(envelope({ type: "job.cancel", jobId: job.id }));
    const final = await waitFor(() => f.service.controller.snapshot().jobs.find((entry) => entry.id === job.id && entry.status !== "running"));
    assert.notEqual(final.status, "completed");
  } finally { await f.close(); }
});
