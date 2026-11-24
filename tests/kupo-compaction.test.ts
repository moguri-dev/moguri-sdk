import test from "node:test";
import assert from "node:assert/strict";
import { automaticCompactionFixture } from "./fixtures/kupo-compaction.ts";
import { waitFor } from "./fixture.ts";
import { join } from "node:path";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { startService } from "../apps/service/src/server.ts";
import { launchRuntimeChild } from "./fixtures/runtime-process.ts";
import { ciTime } from "./fixtures/time-scale.ts";

test("explicit Kupo policy makes one actual bounded tool-less compaction and resumes using its source-bound replacement", { skip: process.platform !== "darwin", timeout: ciTime(25_000) }, async () => {
  const fixture = await automaticCompactionFixture();
  try {
    const before = fixture.service.controller.events(0);
    await fixture.send("Generated next task requires an automatic context handover."); await fixture.terminal();
    assert.equal(fixture.session().status, "completed", fixture.session().lastError ?? "");
    const state = await fixture.sdk.compactions.state(fixture.sessionId), entry = state.compactions.find((entry) => entry.automatic)!;
    assert.ok(entry); assert.equal(entry.status, "applied"); assert.equal(entry.automatic?.actor, "user-policy");
    assert.equal(entry.automatic?.ownerTurnId, entry.turnId); assert.equal(state.activeId, entry.id);
    assert.ok(entry.afterTokens! < entry.beforeTokens); assert.ok(state.estimatedTokens < state.originalEstimatedTokens);
    assert.equal(fixture.requests.length, fixture.calls + 2);
    assert.equal(fixture.requests[fixture.calls]!.tools, undefined);
    assert.ok(Number(fixture.requests[fixture.calls]!.max_tokens ?? fixture.requests[fixture.calls]!.max_completion_tokens) <= 128);
    assert.equal(JSON.stringify(fixture.requests[fixture.calls]).includes("GENERATED_PROVIDER_THINKING_NOT_PUBLIC_HISTORY"), false);
    const final = JSON.stringify(fixture.requests.at(-1));
    assert.match(final, /Generated automatic summary/); assert.match(final, /model-produced, not a user answer/);
    assert.equal(final.includes("Generated retained source 0."), false); assert.match(final, /read_tool_result action=history/);
    assert.deepEqual(fixture.service.controller.events(0).slice(0, before.length), before);
    const calls = (await fixture.sdk.budgets.calls({ sessionId: fixture.sessionId, role: "compaction" })).calls;
    assert.equal(calls.length, 1); assert.equal(calls[0]?.reportedTokens, 42); assert.equal(calls[0]?.status, "settled");
    const page = await fixture.sdk.tools.history(fixture.sessionId, { throughSequence: entry.throughSeq, limitMessages: 1 });
    assert.match(page.text, /Generated retained source 0/); assert.match(page.text, /KEEP_THIS_ORIGINAL_SOURCE/);
    assert.equal(page.boundary, "scoped-controller-public-history"); assert.equal(page.profileId, fixture.sdk.profileId);
  } finally { await fixture.close(); }
});

test("unknown automatic compaction usage remains held and cannot apply context or continue the solver", { skip: process.platform !== "darwin", timeout: ciTime(25_000) }, async () => {
  const fixture = await automaticCompactionFixture();
  try {
    fixture.configuration.omitUsage = true;
    await fixture.send("Generated unknown automatic compaction accounting."); await fixture.terminal();
    const state = await fixture.sdk.compactions.state(fixture.sessionId), entry = state.compactions.find((entry) => entry.automatic)!;
    assert.equal(fixture.requests.length, fixture.calls + 1); assert.equal(entry.status, "partial"); assert.equal(state.activeId, null);
    assert.match(entry.diagnostic!, /usage|meter/i); assert.equal(state.estimatedTokens, state.originalEstimatedTokens);
    const call = (await fixture.sdk.budgets.calls({ sessionId: fixture.sessionId, role: "compaction" })).calls[0]!;
    assert.equal(call.status, "unknown"); assert.equal(call.reportedTokens, null); assert.ok(call.reservedTokens! > 0);
    assert.equal(fixture.service.controller.snapshot().modelFailures.length, 0);
  } finally { await fixture.close(); }
});

test("Stop cancels the actual automatic compactor and never applies a partial or unacknowledged summary", { skip: process.platform !== "darwin", timeout: ciTime(25_000) }, async () => {
  const fixture = await automaticCompactionFixture();
  try {
    fixture.configuration.respond = () => ({ text: "Generated held unaccepted summary.", hold: true });
    await fixture.send("Generated cancellable automatic context role.");
    await waitFor(() => fixture.requests.length === fixture.calls + 1);
    const entry = fixture.service.controller.snapshot().compactions.find((entry) => entry.automatic)!;
    await fixture.sdk.command({ type: "session.stop", sessionId: fixture.sessionId }); await fixture.terminal();
    const state = await fixture.sdk.compactions.state(fixture.sessionId), stopped = state.compactions.find((record) => record.id === entry.id)!;
    assert.equal(fixture.session().status, "stopped"); assert.equal(stopped.status, "stopped"); assert.equal(state.activeId, null);
    assert.equal(state.estimatedTokens, state.originalEstimatedTokens); assert.equal(fixture.requests.length, fixture.calls + 1);
    assert.ok(fixture.service.controller.events(0).some((event) => event.turn_id === entry.turnId && event.event_type === "turn.stop_acknowledged"));
    assert.equal((await fixture.sdk.budgets.calls({ role: "compaction" })).calls[0]?.status, "unknown");
  } finally { await fixture.close(); }
});

test("source/settings changes retain the paid automatic result but reject its stale context application", { skip: process.platform !== "darwin", timeout: ciTime(25_000) }, async () => {
  const fixture = await automaticCompactionFixture();
  try {
    fixture.configuration.respond = undefined;
    fixture.configuration.stream = { chunks: ["Generated ", "stale automatic summary."], delayMs: 200 };
    await fixture.send("Generated stale automatic source.");
    await waitFor(() => fixture.requests.length === fixture.calls + 1);
    const settings = fixture.sdk.settings.get()!;
    await fixture.sdk.settings.update({ ...settings.values, instructions: "Generated changed original instruction source." }, settings.revision);
    await fixture.terminal();
    const state = await fixture.sdk.compactions.state(fixture.sessionId), entry = state.compactions.find((entry) => entry.automatic)!;
    assert.equal(entry.status, "partial"); assert.equal(state.activeId, null); assert.match(entry.diagnostic!, /changed|stale/);
    assert.equal((await fixture.sdk.budgets.calls({ role: "compaction" })).calls[0]?.reportedTokens, 42);
    assert.equal(fixture.requests.length, fixture.calls + 1);
  } finally { await fixture.close(); }
});

test("actual controller SIGKILL leaves automatic compaction partial with original sources and unknown charges, without another model call", { skip: process.platform !== "darwin", timeout: ciTime(30_000) }, async () => {
  const fixture = await automaticCompactionFixture(), stateDir = join(fixture.directory, "state");
  let runtime: Awaited<ReturnType<typeof launchRuntimeChild>> | undefined, service: Awaited<ReturnType<typeof startService>> | undefined, sdk: MoguriSdk | undefined;
  try {
    fixture.sdk.disconnect(); await fixture.service.close();
    fixture.configuration.respond = () => ({ text: "Generated unacknowledged owned summary.", hold: true });
    runtime = await launchRuntimeChild({ stateDir, vaultPath: join(fixture.directory, "generated-vault.json"), modelId: fixture.modelId,
      baseUrl: fixture.baseUrl, homeRoot: fixture.home, modelInfo: fixture.provider.state.models[0] });
    sdk = await new MoguriSdk(runtime.connection).ready();
    const current = sdk.getState().snapshot!.sessions.find((session) => session.id === fixture.sessionId)!;
    await sdk.command({ type: "draft.save", sessionId: fixture.sessionId, expectedRevision: current.draft.revision, text: "Generated crash during automatic summary.", attachments: [] });
    await sdk.command({ type: "message.send", sessionId: fixture.sessionId, expectedRevision: current.draft.revision + 1, delivery: "queue" });
    await waitFor(() => fixture.requests.length === fixture.calls + 1);
    const entry = await waitFor(() => sdk!.getState().snapshot!.compactions.find((record) => record.automatic && record.status === "running"));
    runtime.child.kill("SIGKILL"); await runtime.exited; sdk.disconnect();
    service = await startService({ stateDir, provider: fixture.provider, retentionKey: fixture.retentionKey, platform: { terminal: { defaultRoot: fixture.home, vault: fixture.terminalVault } } });
    sdk = await new MoguriSdk(service.connection).ready();
    const state = await sdk.compactions.state(fixture.sessionId), recovered = state.compactions.find((record) => record.id === entry.id)!;
    assert.equal(recovered.status, "partial"); assert.equal(state.activeId, null); assert.equal(state.estimatedTokens, state.originalEstimatedTokens);
    assert.equal((await sdk.budgets.calls({ sessionId: fixture.sessionId, role: "compaction" })).calls[0]?.status, "unknown");
    assert.equal(sdk.getState().snapshot!.sessions.find((session) => session.id === fixture.sessionId)?.status, "partial");
    const source = await sdk.tools.history(fixture.sessionId, { throughSequence: entry.throughSeq, limitMessages: 1 });
    assert.match(source.text, /KEEP_THIS_ORIGINAL_SOURCE/);
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(fixture.requests.length, fixture.calls + 1); assert.equal(service.controller.snapshot().modelFailures.length, 0);
  } finally { sdk?.disconnect(); await runtime?.stop(); await service?.close(); await fixture.close(); }
});
