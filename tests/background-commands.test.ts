import assert from "node:assert/strict";
import test from "node:test";
import { access, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { envelope } from "../apps/service/src/controller.ts";
import { EventStore } from "../apps/service/src/store.ts";
import { BACKGROUND_COMMAND_SIGNAL, STEERED_CALL_SKIPPED } from "../apps/service/src/background-commands.ts";
import { isRecord, type StoredEvent } from "../packages/protocol/src/index.ts";
import { setupFixture, waitFor, type GeneratedProviderOptions } from "./fixture.ts";
import { removeSourceTrustTelemetryFixtureMarkers } from "./fixtures/legacy-state.ts";
import { remoteFixture } from "./fixtures/remote-service.ts";

const mac = { skip: process.platform !== "darwin", timeout: 60_000 };
const native = { skip: process.platform !== "darwin" && process.platform !== "linux", timeout: 60_000 };
const blocking = { name: "run_command", args: { command: "printf GENERATED_STARTED; while [ ! -f generated-release ]; do sleep 0.05; done; printf GENERATED_BACKGROUND_DONE > generated-done.txt; printf GENERATED_BACKGROUND_DONE", timeoutMs: 30_000 } };
const second = { name: "run_command", args: { command: "printf GENERATED_SECOND > generated-second.txt", timeoutMs: 5000 } };
const NOTICE = "<moguri-background-command>";

/** Tool-less requests (chat titles) get plain text; solver requests are routed by what their context already holds. */
function respond(tools: { name: string; args: Record<string, unknown> }[]): GeneratedProviderOptions["respond"] {
  return (request) => {
    if (!Array.isArray(request.tools) || !request.tools.length) return { text: "Generated title" };
    const context = JSON.stringify(request.messages);
    if (context.includes("generated follow-up")) return { text: "Generated follow-up answered." };
    if (context.includes(NOTICE)) return { text: "Generated background result reported." };
    if (context.includes("generated steer while running")) return { text: "Generated steer handled." };
    return { tool: tools.length === 1 ? tools[0]! : tools };
  };
}
const messages = (request: Record<string, unknown>) => Array.isArray(request.messages) ? request.messages.filter(isRecord) : [];
const content = (message: Record<string, unknown>) => typeof message.content === "string" ? message.content : JSON.stringify(message.content);
const noticeOf = (request: Record<string, unknown>) => messages(request).find((message) => message.role === "user" && content(message).includes(NOTICE));
const solver = (requests: Record<string, unknown>[]) => requests.filter((request) => Array.isArray(request.tools) && request.tools.length > 0);
const seq = (events: StoredEvent[], match: (event: StoredEvent) => boolean) => events.find(match)?.seq ?? -1;

test("a user steer moves a running command to the background; the turn waits for it and the agent gets its final result", mac, async () => {
  const f = await setupFixture({ respond: respond([blocking, second]) });
  try {
    await f.configure();
    await f.send("generated background task");
    await f.approve();
    await waitFor(() => f.service.controller.events(0).some((event) => event.event_type === "process.started"), 10_000);
    await f.send("generated steer while running", "steer");
    const backgrounded = await waitFor(() => f.service.controller.events(0).find((event) => event.event_type === "tool.completed" && event.payload.outcome === "background"), 10_000);
    await waitFor(() => solver(f.requests).length === 2, 10_000);
    const steered = solver(f.requests)[1]!;
    assert.ok(messages(steered).some((message) => message.role === "tool" && content(message).includes(BACKGROUND_COMMAND_SIGNAL)), "the agent is told the command continues in the background");
    assert.ok(messages(steered).some((message) => message.role === "tool" && content(message).includes(STEERED_CALL_SKIPPED)), "later calls of the response wait for the steer");
    assert.ok(messages(steered).some((message) => message.role === "user" && content(message).includes("generated steer while running")));
    // The agent already answered the steer, but the turn keeps waiting for its background command.
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.ok(f.session().turnId, "the turn waits for its background command");
    assert.equal(f.service.controller.events(0).some((event) => event.event_type === "tool.background_completed"), false);
    assert.equal(f.session().messages.find((message) => message.id === (backgrounded.event_type === "tool.completed" ? backgrounded.payload.call.id : ""))?.outcome, "background");
    await writeFile(join(f.project, "generated-release"), "");
    const terminal = await f.terminal();
    assert.equal(terminal.status, "completed");

    const events = f.service.controller.events(0), callId = backgrounded.event_type === "tool.completed" ? backgrounded.payload.call.id : "";
    const final = events.find((event) => event.event_type === "tool.background_completed");
    assert.ok(final?.event_type === "tool.background_completed");
    assert.equal(final.payload.outcome, "completed"); assert.equal(final.payload.isError, false);
    assert.match(final.payload.text, /GENERATED_BACKGROUND_DONE/); assert.equal(final.step_id, backgrounded.step_id);
    const skipped = events.find((event) => event.event_type === "tool.completed" && event.payload.call.id !== callId && event.payload.call.name === "run_command");
    assert.ok(skipped?.event_type === "tool.completed"); assert.equal(skipped.payload.outcome, "stopped");
    assert.equal(events.some((event) => event.event_type === "tool.started" && event.payload.call.id === skipped.payload.call.id), false);
    await assert.rejects(access(join(f.project, "generated-second.txt")));
    assert.equal(f.session().messages.find((message) => message.id === callId)?.outcome, "completed");
    assert.equal(f.service.controller.snapshot().operationEntries.find((entry) => entry.stepId === backgrounded.step_id && entry.name === "run_command" && entry.started)?.outcome, "completed");
    const order = [seq(events, (event) => event === backgrounded), seq(events, (event) => event.event_type === "steer.applied"), seq(events, (event) => event === final),
      seq(events, (event) => event.event_type === "turn.finished")];
    assert.deepEqual([...order].sort((a, b) => a - b), order); assert.ok(order.every((value) => value > 0));
    const reported = solver(f.requests)[2]!, notice = noticeOf(reported);
    assert.ok(notice); assert.match(content(notice), /GENERATED_BACKGROUND_DONE/);

    // A later turn rebuilds the same context from durable events: the notice is byte-identical.
    await f.send("generated follow-up");
    await waitFor(() => solver(f.requests).length === 4 && f.session().status === "completed" && !f.session().turnId, 10_000);
    assert.equal(content(noticeOf(solver(f.requests)[3]!)!), content(notice));

    await f.service.close();
    const path = f.service.store.path, history = f.service.controller.events(0), raw = new DatabaseSync(path);
    try {
      assert.throws(() => removeSourceTrustTelemetryFixtureMarkers(new DatabaseSync(":memory:"), history), /genuine pre-112 history/);
      raw.exec("DELETE FROM retention_metadata WHERE id IN ('skill_publisher_trust_schema','otlp_signals_credentials_schema','background_command_schema'); PRAGMA user_version=111");
    } finally { raw.close(); }
    assert.throws(() => new EventStore(path, f.retentionKey), /pre-112 lineage/);
  } finally { await f.close(); }
});

test("Stop cancels a backgrounded command and retains its stopped result", mac, async () => {
  const f = await setupFixture({ respond: respond([blocking]) });
  try {
    await f.configure();
    await f.send("generated background task");
    await f.approve();
    await waitFor(() => f.service.controller.events(0).some((event) => event.event_type === "process.started"), 10_000);
    await f.send("generated steer while running", "steer");
    await waitFor(() => solver(f.requests).length === 2, 10_000);
    await f.service.controller.dispatch(envelope({ type: "session.stop", sessionId: f.sessionId }));
    const terminal = await f.terminal();
    assert.notEqual(terminal.status, "completed");
    const final = f.service.controller.events(0).find((event) => event.event_type === "tool.background_completed");
    assert.ok(final?.event_type === "tool.background_completed"); assert.equal(final.payload.outcome, "partial");
    assert.equal(solver(f.requests).length, 2, "no model call follows a stopped background command");
    await writeFile(join(f.project, "generated-release"), "");
    await new Promise((resolve) => setTimeout(resolve, 400));
    await assert.rejects(access(join(f.project, "generated-done.txt")), "the stopped process group never finished its work");
    await assert.rejects(() => f.service.controller.dispatch(envelope({ type: "session.delete", sessionId: f.sessionId, expectedRevision: f.session().revision, confirm: true })), /unconfirmed/,
      "a stopped background command needs the same inspection before deletion as a foreground one");
  } finally { await f.close(); }
});

test("a lost worker settles its background command as unconfirmed instead of leaving it running", mac, async () => {
  const f = await setupFixture({ respond: respond([blocking]) });
  try {
    await f.configure();
    await f.send("generated background task");
    await f.approve();
    await waitFor(() => f.service.controller.events(0).some((event) => event.event_type === "process.started"), 10_000);
    await f.send("generated steer while running", "steer");
    await waitFor(() => solver(f.requests).length === 2, 10_000);
    const runs = (f.service.controller as unknown as { runs: Map<string, { child: { kill(signal: NodeJS.Signals): void } }> }).runs;
    runs.get(f.sessionId)!.child.kill("SIGKILL");
    const terminal = await f.terminal();
    assert.equal(terminal.status, "partial");
    const final = f.service.controller.events(0).find((event) => event.event_type === "tool.background_completed");
    assert.ok(final?.event_type === "tool.background_completed"); assert.equal(final.payload.outcome, "unconfirmed");
    assert.equal(f.session().messages.find((message) => message.id === final.payload.call.id)?.outcome, "unconfirmed");
  } finally {
    await writeFile(join(f.project, "generated-release"), "").catch(() => {});
    await f.close();
  }
});

test("a steer backgrounds a Remote command over the SSH bridge and its result arrives before the turn ends", native, async () => {
  const f = await remoteFixture({ respond: respond([blocking]) });
  try {
    await f.probe(); await f.select();
    await f.send("generated background task");
    await f.approve();
    await waitFor(() => f.controller.events(0).some((event) => event.event_type === "process.started"), 20_000);
    await f.send("generated steer while running", "steer");
    await waitFor(() => f.controller.events(0).some((event) => event.event_type === "tool.completed" && event.payload.outcome === "background"), 20_000);
    await waitFor(() => solver(f.requests).length === 2, 20_000);
    assert.ok(f.session().turnId);
    await writeFile(join(f.workspace, "generated-release"), "");
    assert.equal((await f.terminal()).status, "completed");
    const final = f.controller.events(0).find((event) => event.event_type === "tool.background_completed");
    assert.ok(final?.event_type === "tool.background_completed"); assert.equal(final.payload.outcome, "completed");
    assert.match(content(noticeOf(solver(f.requests)[2]!)!), /GENERATED_BACKGROUND_DONE/);
    await access(join(f.workspace, "generated-done.txt"));
  } finally { await f.close(); }
});
