import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { EventStore } from "../apps/service/src/store.ts";
import { KeepAwake, NativePowerDriver, type PowerLease } from "../apps/service/src/keep-awake.ts";
import { factoryControls, projectEvents, PROTOCOL_VERSION, type Snapshot } from "../packages/protocol/src/index.ts";
import { waitFor } from "./fixture.ts";

function snapshot(): Snapshot {
  const store = new EventStore(":memory:");
  try {
    store.commit([{ profile_id: "default", session_id: "generated-session", event_type: "session.created", payload: { title: "Generated power owner", controls: factoryControls() } }]);
    const result: Snapshot = { ...projectEvents(store.events()), protocolVersion: PROTOCOL_VERSION, seq: 1, profileId: "default",
      provider: { status: "disconnected", models: [], login: null, diagnostic: null }, capabilities: [] };
    result.settings.values.lifecycle = { keepAwake: true, tailMinutes: 2 };
    result.sessions[0]!.turnId = "generated-owned-turn"; result.sessions[0]!.status = "running";
    return result;
  } finally { store.close(); }
}

test("keep-awake owns only admitted work and its configured tail, including after source deletion", async () => {
  const state = snapshot(); let now = Date.parse("2026-01-01T00:00:00.000Z"), starts = 0, stops = 0;
  const keeper = new KeepAwake(() => state, { start: async () => { starts++; return { stop: async () => { stops++; } }; } }, () => now);
  try {
    keeper.update(); await waitFor(() => keeper.status().status === "working");
    state.sessions[0]!.turnId = null; state.sessions[0]!.status = "completed"; state.sessions[0]!.finishedAt = new Date(now).toISOString();
    keeper.update(); assert.equal(keeper.status().status, "tail");
    state.sessions.length = 0; keeper.update(); assert.equal(keeper.status().status, "tail");
    now += 120_000 - 1; keeper.update(); assert.equal(stops, 0);
    now++; keeper.update(); await waitFor(() => keeper.status().status === "idle");
    assert.equal(starts, 1); assert.equal(stops, 1);
  } finally { await keeper.close(); }
});

test("disabling or closing before delayed startup never leaves a late native assertion", async () => {
  const state = snapshot(), ready = Promise.withResolvers<PowerLease>(); let entered = false, stops = 0;
  const keeper = new KeepAwake(() => state, { start: async () => { entered = true; return ready.promise; } });
  keeper.update(); await waitFor(() => entered);
  state.settings.values.lifecycle!.keepAwake = false; keeper.update();
  const closed = keeper.close();
  ready.resolve({ stop: async () => { stops++; } });
  await closed;
  assert.equal(stops, 1); assert.equal(keeper.status().status, "idle");
});

test("an undispatched startup can be withdrawn without invoking the driver", async () => {
  const state = snapshot(); let starts = 0;
  const keeper = new KeepAwake(() => state, { start: async () => { starts++; return { stop: async () => {} }; } });
  keeper.update(); state.settings.values.lifecycle!.keepAwake = false; keeper.update();
  await keeper.close(); assert.equal(starts, 0);
});

test("failed shutdown retains the exact lease and requires an explicit retry, not another spawned owner", async () => {
  const state = snapshot(); let starts = 0, stops = 0;
  const keeper = new KeepAwake(() => state, { start: async () => {
    starts++;
    return { stop: async () => { stops++; if (stops === 1) throw new Error("Generated owned shutdown failure."); } };
  } });
  try {
    keeper.update(); await waitFor(() => keeper.status().status === "working");
    state.settings.values.lifecycle!.keepAwake = false; keeper.update();
    await waitFor(() => keeper.status().status === "failed");
    keeper.update(); assert.equal(starts, 1); assert.equal(stops, 1);
    await keeper.retry(); assert.equal(starts, 1); assert.equal(stops, 2);
    assert.equal(keeper.status().status, "idle");
  } finally { await keeper.close(); }
});

test("native driver binds the actual owning service PID and only stops its generated child", async () => {
  let invocation: { command: string; args: readonly string[] } | undefined, unexpected = 0;
  const driver = new NativePowerDriver("darwin", (command, args, options) => {
    invocation = { command, args };
    return spawn(process.execPath, ["-e", "process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{},1000)"], options);
  });
  const lease = await driver.start(() => unexpected++);
  await lease.stop(); await lease.stop();
  assert.deepEqual(invocation, { command: "/usr/bin/caffeinate", args: ["-i", "-w", String(process.pid)] });
  assert.equal(unexpected, 0);
  await assert.rejects(() => new NativePowerDriver("linux").start(() => {}), /only on macOS/);
});
