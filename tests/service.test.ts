import { ciTime } from "./fixtures/time-scale.ts";
import assert from "node:assert/strict";
import { readFile, symlink, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { request } from "node:http";
import { WebSocket } from "ws";
import { envelope } from "../apps/service/src/controller.ts";
import { MoguriClient } from "../packages/client/src/index.ts";
import { reviewNativeTools, setupFixture, waitFor } from "./fixture.ts";

const mac = { skip: process.platform !== "darwin", timeout: ciTime(20_000) };

test("loopback HTTP and WebSocket enforce token, Host, Origin and protocol", async () => {
  const fixture = await setupFixture();
  try {
    const { connection } = fixture.service;
    const unauthenticated = await fetch(`${connection.baseUrl}/v1/snapshot`);
    assert.equal(unauthenticated.status, 401);
    const hostile = await fetch(`${connection.baseUrl}/v1/snapshot`, { headers: { Authorization: `Bearer ${connection.token}`, Origin: "https://untrusted.invalid" } });
    assert.equal(hostile.status, 403);
    assert.equal(hostile.headers.has("access-control-allow-origin"), false);
    const rebinding = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(`${connection.baseUrl}/v1/snapshot`, { headers: { Authorization: `Bearer ${connection.token}`, Host: "untrusted.invalid" } }, (response) => { response.resume(); resolve(response.statusCode); });
      req.on("error", reject); req.end();
    });
    assert.equal(rebinding, 403);
    const socket = new WebSocket(connection.wsUrl);
    await new Promise<void>((resolve) => socket.once("open", resolve));
    socket.send(JSON.stringify({ type: "authenticate", protocolVersion: 1, token: "generated-wrong-token", after: 0 }));
    assert.equal(await new Promise<number>((resolve) => socket.once("close", resolve)), 1008);
    const mode = await stat(join(fixture.directory, "state", "connection.json"));
    assert.equal(mode.mode & 0o777, 0o600);
    assert.deepEqual(fixture.session().controls, { env: "Local", modelId: null, autonomy: "Manual", budget: { kind: "unlimited" } });
  } finally { await fixture.close(); }
});

test("two clients share durable drafts, queue races, idempotency and cancellation", mac, async () => {
  const fixture = await setupFixture();
  const first = new MoguriClient(fixture.service.connection);
  const second = new MoguriClient(fixture.service.connection);
  try {
    await fixture.configure();
    await Promise.all([first.connect(), second.connect()]);
    await waitFor(() => first.getState().status === "connected" && second.getState().status === "connected");
    await first.command({ type: "draft.save", sessionId: fixture.sessionId, expectedRevision: 0, text: "generated slow task", attachments: [] });
    await waitFor(() => second.getState().snapshot?.sessions.find((session) => session.id === fixture.sessionId)?.draft.text === "generated slow task");
    const send = envelope({ type: "message.send", sessionId: fixture.sessionId, expectedRevision: fixture.session().draft.revision, delivery: "queue" });
    const sent = await Promise.all([fixture.service.controller.dispatch(send), fixture.service.controller.dispatch(send)]);
    assert.deepEqual(sent[0], sent[1]);
    await waitFor(() => fixture.requests.length > 0);
    assert.equal(fixture.session().messages.filter((message) => message.role === "user").length, 1);
    await fixture.send("generated queued task");
    const queued = fixture.session().queue[0]!;
    const revision = fixture.session().queueRevision;
    const edit = (text: string) => fixture.service.controller.dispatch(envelope({ type: "queue.edit", sessionId: fixture.sessionId, messageId: queued.id, expectedRevision: revision, text }));
    const race = await Promise.allSettled([edit("generated edited A"), edit("generated edited B")]);
    assert.equal(race.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(race.filter((result) => result.status === "rejected").length, 1);
    await first.command({ type: "session.stop", sessionId: fixture.sessionId });
    await fixture.terminal();
    assert.equal(fixture.session().queue.length, 1);
    assert.equal(fixture.session().queue[0]?.held, true);
    await second.command({ type: "session.resume", sessionId: fixture.sessionId });
    await waitFor(() => fixture.session().status === "completed" && fixture.session().queue.length === 0);
    const events = fixture.service.controller.events(0);
    assert.ok(events.some((event) => event.event_type === "turn.stop_requested"));
    assert.ok(events.some((event) => event.event_type === "turn.stop_acknowledged"));
    assert.ok(events.some((event) => event.event_type === "turn.finished" && event.payload.outcome === "stopped"));
    assert.equal(fixture.session().messages.filter((message) => message.role === "user").length, 2);
    assert.ok(fixture.session().usage.some((usage) => usage.quality === "unknown"));
    assert.ok(fixture.session().usage.every((usage) => usage.billedUsd === null && usage.estimatedUsd === null));
  } finally { first.disconnect(); second.disconnect(); await fixture.close(); }
});

test("explicit strict review rules retain manual exact-argument file approvals and conflict-aware writes", mac, async () => {
  const fixture = await setupFixture();
  try {
    await reviewNativeTools(fixture);
    await fixture.configure();
    await fixture.send("generated write task");
    const approval = await waitFor(() => fixture.session().pendingApproval);
    assert.equal(approval.call.name, "read_file");
    assert.equal(fixture.service.controller.events(0).some((event) => event.event_type === "tool.started"), false);
    const respond = (allow: boolean) => fixture.service.controller.dispatch(envelope({ type: "approval.respond", sessionId: fixture.sessionId, approvalId: approval.id, allow }));
    const answers = await Promise.allSettled([respond(true), respond(false)]);
    assert.equal(answers.filter((answer) => answer.status === "fulfilled").length, 1);
    await waitFor(() => fixture.session().pendingApproval?.call.name === "write_file");
    await fixture.approve();
    assert.equal((await fixture.terminal()).status, "completed");
    assert.equal(await readFile(join(fixture.project, "fixture.txt"), "utf8"), "generated replacement\n");
    const writes = fixture.service.controller.events(0).filter((event) => event.event_type === "tool.started" && event.payload.call.name === "write_file");
    assert.equal(writes.length, 1);
  } finally { await fixture.close(); }
});

test("a stopped approved command terminates its nested process tree and records the actual outcome", mac, async () => {
  const fixture = await setupFixture();
  try {
    await fixture.configure();
    await fixture.send("generated command task");
    await fixture.approve();
    const output = await waitFor(() => fixture.session().messages.find((message) => message.role === "tool" && /GENERATED_CHILD=\d+/.test(message.text)));
    const child = Number(output.text.match(/GENERATED_CHILD=(\d+)/)![1]);
    await fixture.service.controller.dispatch(envelope({ type: "session.stop", sessionId: fixture.sessionId }));
    const terminal = await fixture.terminal();
    assert.equal(terminal.status, "partial", JSON.stringify({ diagnostic: terminal.lastError, tail: fixture.service.controller.events(0).slice(-7) }));
    assert.throws(() => process.kill(child, 0), (error: NodeJS.ErrnoException) => error.code === "ESRCH");
    const result = fixture.service.controller.events(0).find((event) => event.event_type === "tool.completed" && event.payload.call.name === "run_command");
    assert.ok(result?.event_type === "tool.completed" && ["partial", "unconfirmed"].includes(result.payload.outcome));
    if (result?.event_type === "tool.completed") {
      assert.equal(result.payload.isError, true);
      assert.ok(result.payload.text.length > 0);
    }
    assert.equal(terminal.messages.some((message) => message.role === "tool" && message.outcome === "running"), false);
    assert.ok(["partial", "unconfirmed"].includes(terminal.processes[0]?.outcome ?? ""));
  } finally { await fixture.close(); }
});

test("policy exclusion lets the recorded Local turn finish but blocks new Local work without fallback", mac, async () => {
  const fixture = await setupFixture();
  try {
    await fixture.configure();
    await fixture.send("generated delayed task");
    await waitFor(() => fixture.requests.length > 0);
    await fixture.service.controller.dispatch(envelope({ type: "policy.set", allowedEnvs: ["Sandbox", "Remote"] }));
    assert.equal(fixture.session().localFinishing, true);
    await fixture.service.controller.dispatch(envelope({ type: "draft.save", sessionId: fixture.sessionId, expectedRevision: fixture.session().draft.revision, text: "generated blocked task", attachments: [] }));
    await assert.rejects(() => fixture.service.controller.dispatch(envelope({ type: "message.send", sessionId: fixture.sessionId, expectedRevision: fixture.session().draft.revision, delivery: "queue" })), /excluded/);
    assert.equal((await fixture.terminal()).status, "completed");
    assert.equal(fixture.requests.length, 1);
    assert.equal(fixture.session().draft.text, "generated blocked task");
    assert.equal(fixture.session().localFinishing, false);
  } finally { await fixture.close(); }
});

test("attachments are immutable approved project snapshots, not escaping paths or live file pointers", async () => {
  const fixture = await setupFixture();
  try {
    await writeFile(join(fixture.directory, "outside.txt"), "generated outside\n");
    await symlink(join(fixture.directory, "outside.txt"), join(fixture.project, "escape.txt"));
    await assert.rejects(() => fixture.service.controller.dispatch(envelope({ type: "attachment.add", sessionId: fixture.sessionId, expectedRevision: 0, path: "escape.txt" })), /Symlink/);
    await writeFile(join(fixture.project, ".env"), "GENERATED_SECRET=not-real\n");
    await assert.rejects(() => fixture.service.controller.dispatch(envelope({ type: "attachment.add", sessionId: fixture.sessionId, expectedRevision: 0, path: ".env" })), /protected/);
    await fixture.service.controller.dispatch(envelope({ type: "attachment.add", sessionId: fixture.sessionId, expectedRevision: 0, path: "fixture.txt" }));
    const attachment = fixture.session().draft.attachments[0]!;
    await writeFile(join(fixture.project, "fixture.txt"), "generated external change\n");
    assert.equal(fixture.service.store.blob(attachment.digest), "generated original\n");
    assert.equal(fixture.session().draft.attachments[0]?.digest, attachment.digest);
    assert.equal(fixture.requests.length, 0);
  } finally { await fixture.close(); }
});
