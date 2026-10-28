import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { MoguriSdk, slashCommands } from "../packages/sdk/src/index.ts";
import { setupFixture, waitFor } from "./fixture.ts";
import { startService } from "../apps/service/src/server.ts";

test("thinking and effort shortcuts preserve the window and autonomy, remember only explicit effort and never infer", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture({ reasoning: true, contextWindow: 32769 }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.configure(); await sdk.refresh();
    await sdk.sessions.modelOptions(fixture.sessionId, { contextWindow: 16384 });
    const autonomy = fixture.session().controls.autonomy;
    for (const [command, effort] of [["/thinking high", "high"], ["/effort low", "low"], ["/thinking default", undefined]] as const) {
      assert.equal((await sdk.slash(fixture.sessionId, command, "tui")).kind, "ok");
      assert.deepEqual(fixture.session().controls.modelOptions, { contextWindow: 16384, ...(effort ? { thinkingEffort: effort } : {}) });
      assert.equal(fixture.session().controls.autonomy, autonomy);
      const created = await sdk.sessions.create(null, "Generated remembered shortcut effort");
      const next = sdk.getState().snapshot!.sessions.find((entry) => entry.id === created.id)!;
      assert.equal(next.controls.modelId, fixture.modelId);
      assert.deepEqual(next.controls.modelOptions, effort ? { thinkingEffort: effort } : undefined);
    }
    assert.ok(slashCommands.some((command) => command.name === "thinking"));
    assert.ok(slashCommands.some((command) => command.name === "effort"));
    const saved = structuredClone(fixture.session().controls);
    await assert.rejects(() => sdk.slash(fixture.sessionId, "/effort max", "desktop"), /not supported/i);
    await assert.rejects(() => sdk.slash(fixture.sessionId, "/thinking"), /thinking|effort|level/i);
    await assert.rejects(() => sdk.slash(fixture.sessionId, "/effort low high"), /thinking|effort|level/i);
    assert.deepEqual(fixture.session().controls, saved);
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("context presets respect only actual provider declarations and never round an unsupported half into another window", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture({ contextWindow: 131072, supportedContextWindows: [32768, 65536] }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.configure(); await sdk.refresh();
    for (const [argument, tokens] of [["max", 65536], ["half", 32768], ["min", 32768], ["65536", 65536]] as const) {
      await sdk.slash(fixture.sessionId, `/context-window ${argument}`);
      assert.equal(fixture.session().controls.modelOptions?.contextWindow, tokens);
    }
    for (const tokens of [8192, 49152, 131072]) await assert.rejects(() => sdk.slash(fixture.sessionId, `/context-window ${tokens}`), /provider-declared/i);
    fixture.provider.state.models[0]!.supportedContextWindows = [65536];
    fixture.provider.onChange(); await sdk.refresh();
    await assert.rejects(() => sdk.slash(fixture.sessionId, "/context-window half"), /unsupported half|not clamped/i);
    assert.equal(fixture.session().controls.modelOptions?.contextWindow, 65536);
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("a minimum-sized model never clamps its half and tuning never invents a fixed model or overrides Kupo", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture({ contextWindow: 8192, maxOutputTokens: 128 }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await assert.rejects(() => sdk.slash(fixture.sessionId, "/context-window max"), /fixed model/i);
    await assert.rejects(() => sdk.slash(fixture.sessionId, "/effort low"), /model/i);
    assert.equal(fixture.session().controls.modelId, null);
    await fixture.configure(); await sdk.refresh();
    await sdk.slash(fixture.sessionId, "/context-window min");
    await assert.rejects(() => sdk.slash(fixture.sessionId, "/context-window half"), /unsupported half|not clamped/i);
    assert.equal(fixture.session().controls.modelOptions?.contextWindow, 8192);
    await sdk.sessions.selectModel(fixture.sessionId, "kupo");
    await assert.rejects(() => sdk.slash(fixture.sessionId, "/context-window max"), /Kupo|fixed model/i);
    await assert.rejects(() => sdk.slash(fixture.sessionId, "/thinking low"), /kupo|overrides|fixed model/i);
    assert.equal(fixture.session().controls.modelOptions, undefined);
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("concurrent revisions and an actual running model cannot replace saved tuning through a shortcut", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture({ reasoning: true, contextWindow: 32769, respond: () => ({ hold: true }) });
  const sdk = await new MoguriSdk(fixture.service.connection).ready(), other = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.configure(); await sdk.refresh(); await other.refresh();
    await sdk.sessions.modelOptions(fixture.sessionId, { thinkingEffort: "low", contextWindow: 16384 });
    await other.refresh();
    const original = sdk.sessions.modelOptions;
    sdk.sessions.modelOptions = async (...args) => { await other.sessions.autonomy(fixture.sessionId, "Guided"); return original(...args); };
    try { await assert.rejects(() => sdk.slash(fixture.sessionId, "/context-window 24577"), /revision|changed/i); }
    finally { sdk.sessions.modelOptions = original; }
    assert.equal(fixture.session().controls.autonomy, "Guided");
    assert.deepEqual(fixture.session().controls.modelOptions, { contextWindow: 16384, thinkingEffort: "low" });
    await fixture.send("Generated held request keeps its original model tuning.");
    await waitFor(() => fixture.requests.length === 1); await sdk.refresh();
    for (const command of ["/thinking high", "/context-window max"]) await assert.rejects(() => sdk.slash(fixture.sessionId, command), /active|running|turn|stop/i);
    assert.deepEqual(fixture.session().controls.modelOptions, { contextWindow: 16384, thinkingEffort: "low" });
    assert.equal(fixture.requests.length, 1);
  } finally { sdk.disconnect(); other.disconnect(); await fixture.close(); }
});

test("exact shortcut tuning and its original effort survive a real service restart without a model call", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture({ reasoning: true, contextWindow: 32769 }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  let restarted: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    await fixture.configure(); await sdk.refresh();
    await sdk.slash(fixture.sessionId, "/context-window 24577");
    await sdk.slash(fixture.sessionId, "/effort low");
    sdk.disconnect(); await fixture.service.close();
    restarted = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey });
    const reopened = await new MoguriSdk(restarted.connection).ready();
    try {
      const session = reopened.getState().snapshot!.sessions.find((entry) => entry.id === fixture.sessionId)!;
      assert.deepEqual(session.controls.modelOptions, { contextWindow: 24577, thinkingEffort: "low" });
      assert.equal((await reopened.sessions.context(fixture.sessionId)).context.contextWindow, 24577);
      assert.equal(fixture.requests.length, 0);
    } finally { reopened.disconnect(); }
  } finally { sdk.disconnect(); await restarted?.close(); await fixture.close(); }
});

test("context-window accepts exact tokens and min/half/max while preserving effort and forwarding the exact admitted ceiling", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture({ reasoning: true, contextWindow: 32769, maxOutputTokens: 32768 }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.configure(); await sdk.refresh();
    await sdk.sessions.modelOptions(fixture.sessionId, { thinkingEffort: "high" });
    const preferences = () => fixture.service.controller.events(0).filter((event) => event.event_type === "model.selection_remembered").length;
    const remembered = preferences();
    for (const [argument, tokens] of [["24577", 24577], ["MIN", 8192], ["half", 16384], ["max", 32769]] as const) {
      assert.equal((await sdk.slash(fixture.sessionId, `/context-window ${argument}`, "desktop")).kind, "ok");
      assert.deepEqual(fixture.session().controls.modelOptions, { contextWindow: tokens, thinkingEffort: "high" });
      assert.equal(preferences(), remembered);
    }
    const saved = structuredClone(fixture.session().controls);
    for (const argument of ["8191", "32770", "0", "-1", "12.5", "2e4", "16384 extra", "9007199254740993", "NaN", ""]) {
      await assert.rejects(() => sdk.slash(fixture.sessionId, `/context-window ${argument}`, "tui"), /context|window|token|min|half|max/i);
      assert.deepEqual(fixture.session().controls, saved);
    }
    assert.equal(fixture.requests.length, 0);
    await sdk.slash(fixture.sessionId, "/context-window 24577", "cli");
    await fixture.send("Generated exact working-window request.");
    assert.equal((await fixture.terminal()).status, "completed");
    assert.equal(fixture.requests.length, 1);
    const usage = fixture.session().usage[0]!, output = fixture.requests[0]?.max_tokens ?? fixture.requests[0]?.max_completion_tokens;
    assert.equal(usage.contextWindow, 24577); assert.equal(usage.thinkingEffort, "high");
    assert.equal(typeof output, "number");
    assert.ok(typeof output === "number" && output > 0 && output + usage.contextEstimate! + 4096 <= 24577);
  } finally { sdk.disconnect(); await fixture.close(); }
});
