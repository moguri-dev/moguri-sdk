import test from "node:test";
import assert from "node:assert/strict";
import { envelope } from "../apps/service/src/controller.ts";
import { waitFor } from "./fixture.ts";
import { compactionFixture as prepared } from "./fixtures/compaction-service.ts";
import { routedFixture } from "./fixtures/single-routing.ts";
import sharp from "sharp";

test("shared SDK generates, reviews, applies and restores a real metered compaction without rewriting history or drafts", { timeout: 20_000 }, async () => {
  const f = await prepared();
  try {
    await f.sdk.sessions.configure(f.sessionId, { ...f.session().controls, budget: { kind: "limited", tokens: 30_000, basis: "estimate" } });
    await f.service.controller.dispatch(envelope({ type: "draft.save", sessionId: f.sessionId, expectedRevision: f.session().draft.revision, text: "Generated preserved draft.", attachments: [] }));
    const original = f.service.controller.events(0), before = await f.sdk.compactions.state(f.sessionId);
    const preview = await f.sdk.compactions.preview(f.sessionId, { keepRecentTurns: 1 });
    assert.equal(preview.preview.modelId, f.modelId);
    assert.equal(f.requests.length, 3);
    const request = await f.sdk.compactions.generate(f.sessionId, preview.preview, true);
    assert.equal((await f.terminal()).status, "completed");
    const state = await f.sdk.compactions.state(f.sessionId), proposal = state.compactions.find((entry) => entry.id === request.id)!;
    assert.equal(proposal.status, "proposed");
    assert.equal(state.activeId, null);
    assert.equal(state.estimatedTokens, before.estimatedTokens);
    assert.equal(f.session().draft.text, "Generated preserved draft.");
    const content = await f.sdk.compactions.read(f.sessionId, proposal.id);
    assert.match(content.text!, /Generated summary/);
    assert.ok(proposal.afterTokens! < proposal.beforeTokens);
    await f.sdk.compactions.apply(f.sessionId, proposal.id, proposal.revision);
    const applied = await f.sdk.compactions.state(f.sessionId);
    assert.equal(applied.activeId, proposal.id);
    assert.ok(applied.estimatedTokens < applied.originalEstimatedTokens);
    assert.equal(f.requests.length, 4);
    assert.equal(f.requests[3]?.tools, undefined);
    assert.ok(Number(f.requests[3]?.max_tokens ?? f.requests[3]?.max_completion_tokens) <= 1024);
    assert.deepEqual(f.service.controller.events(0).slice(0, original.length), original);
    const calls = await f.sdk.budgets.calls({ sessionId: f.sessionId, role: "compaction" });
    assert.equal(calls.calls.length, 1);
    assert.equal(calls.calls[0]?.status, "settled");
    assert.equal(calls.calls[0]?.reportedTokens, 42);
    assert.equal(calls.calls[0]?.modelId, f.modelId);
    assert.equal(f.session().messages.filter((message) => message.role === "user").length, 3);
    await f.send("Generated follow-up uses reviewed context.");
    assert.equal((await f.terminal()).status, "completed");
    const followup = JSON.stringify(f.requests[4]);
    assert.match(followup, /model-produced, not a user answer/);
    assert.equal(followup.includes("Generated original turn 0."), false);
    assert.match(followup, /Generated original turn 2/);
    const current = await f.sdk.compactions.state(f.sessionId);
    await f.sdk.compactions.restore(f.sessionId, current.activeId!, current.sourceDigest, true);
    const restored = await f.sdk.compactions.state(f.sessionId);
    assert.equal(restored.activeId, null);
    assert.equal(restored.estimatedTokens, restored.originalEstimatedTokens);
    assert.equal(f.requests.length, 5);
    assert.equal((await f.sdk.budgets.status(f.sessionId)).status.totals.knownReportedTokens, 210);
  } finally { await f.close(); }
});

test("unknown compactor usage stays held and cannot become an applied or free successful summary", { timeout: 20_000 }, async () => {
  const f = await prepared();
  try {
    f.configuration.omitUsage = true;
    const before = await f.sdk.compactions.state(f.sessionId), preview = await f.sdk.compactions.preview(f.sessionId, { keepRecentTurns: 1 });
    const result = await f.sdk.compactions.generate(f.sessionId, preview.preview, true);
    await f.terminal();
    const state = await f.sdk.compactions.state(f.sessionId), entry = state.compactions.find((entry) => entry.id === result.id)!;
    assert.equal(entry.status, "partial");
    assert.match(entry.diagnostic!, /metering|usage/i);
    assert.equal(state.activeId, null);
    assert.equal(state.estimatedTokens, before.estimatedTokens);
    await assert.rejects(() => f.sdk.compactions.apply(f.sessionId, entry.id, entry.revision), /proposal|complete|applied/i);
    const calls = (await f.sdk.budgets.calls({ sessionId: f.sessionId, role: "compaction" })).calls;
    assert.equal(calls[0]?.status, "unknown");
    assert.equal(calls[0]?.reportedTokens, null);
    assert.equal(f.requests.length, 4);
  } finally { await f.close(); }
});

test("a concurrent settings change rejects a stale compactor result after retaining its actual charge", { timeout: 20_000 }, async () => {
  const f = await prepared();
  try {
    f.configuration.stream = { chunks: ["Generated ", "stale summary."], delayMs: 150 };
    const preview = await f.sdk.compactions.preview(f.sessionId, { keepRecentTurns: 1 });
    const result = await f.sdk.compactions.generate(f.sessionId, preview.preview, true);
    await waitFor(() => f.requests.length === 4);
    const settings = f.service.controller.snapshot().settings;
    await f.sdk.settings.update({ ...settings.values, instructions: "Generated changed instruction scope." }, settings.revision);
    await f.terminal();
    const state = await f.sdk.compactions.state(f.sessionId), entry = state.compactions.find((entry) => entry.id === result.id)!;
    assert.equal(entry.status, "partial");
    assert.match(entry.diagnostic!, /changed|stale/i);
    assert.equal(state.activeId, null);
    assert.equal((await f.sdk.budgets.calls({ role: "compaction" })).calls[0]?.reportedTokens, 42);
  } finally { await f.close(); }
});

test("stop acknowledges owned compaction cancellation and preserves source, draft and unknown capacity", { timeout: 20_000 }, async () => {
  const f = await prepared();
  try {
    f.configuration.stream = { chunks: ["Generated partial summary."], delayMs: 1000 };
    const before = await f.sdk.compactions.state(f.sessionId), preview = await f.sdk.compactions.preview(f.sessionId, { keepRecentTurns: 1 });
    const result = await f.sdk.compactions.generate(f.sessionId, preview.preview, true);
    await waitFor(() => f.requests.length === 4);
    await f.sdk.compactions.stop(f.sessionId, result.id!);
    assert.equal((await f.terminal()).status, "stopped");
    const state = await f.sdk.compactions.state(f.sessionId), entry = state.compactions.find((entry) => entry.id === result.id)!;
    assert.equal(entry.status, "stopped");
    assert.equal(state.activeId, null);
    assert.equal(state.estimatedTokens, before.estimatedTokens);
    assert.ok(f.service.controller.events(0).some((event) => event.turn_id === entry.turnId && event.event_type === "turn.stop_acknowledged"));
    await assert.rejects(() => f.sdk.compactions.apply(f.sessionId, entry.id, entry.revision));
    assert.equal((await f.sdk.budgets.calls({ role: "compaction" })).calls[0]?.status, "unknown");
  } finally { await f.close(); }
});

test("source-bound apply and idempotent generation cannot use a newer task or make duplicate calls", { timeout: 20_000 }, async () => {
  const f = await prepared();
  try {
    const preview = (await f.sdk.compactions.preview(f.sessionId, { keepRecentTurns: 1 })).preview;
    const command = envelope({ type: "compaction.generate", sessionId: f.sessionId, modelId: preview.modelId, keepRecentTurns: preview.keepRecentTurns, expectedDigest: preview.digest, confirmCost: true });
    const [first, second] = await Promise.all([f.service.controller.dispatch(command), f.service.controller.dispatch(command)]);
    assert.equal(first.id, second.id);
    await f.terminal();
    assert.equal((await f.service.controller.dispatch(command)).id, first.id);
    assert.equal(f.requests.length, 4);
    const entry = (await f.sdk.compactions.state(f.sessionId)).compactions.find((entry) => entry.id === first.id)!;
    await f.send("Generated new source invalidates a prior proposal.");
    await f.terminal();
    await assert.rejects(() => f.sdk.compactions.apply(f.sessionId, entry.id, entry.revision), /changed|stale/i);
    await f.sdk.compactions.discard(f.sessionId, entry.id, entry.revision);
    assert.equal((await f.sdk.compactions.state(f.sessionId)).compactions.find((value) => value.id === entry.id)?.status, "discarded");
    assert.equal(f.requests.length, 5);
  } finally { await f.close(); }
});

test("a finite cap refuses compaction before inference, without clearing earlier charges or source", { timeout: 20_000 }, async () => {
  const f = await prepared();
  try {
    await f.sdk.sessions.configure(f.sessionId, { ...f.session().controls, budget: { kind: "limited", tokens: 200, basis: "estimate" } });
    const preview = (await f.sdk.compactions.preview(f.sessionId, { keepRecentTurns: 1 })).preview;
    const result = await f.sdk.compactions.generate(f.sessionId, preview, true);
    assert.equal((await f.terminal()).status, "partial");
    const state = await f.sdk.compactions.state(f.sessionId);
    assert.equal(state.activeId, null);
    assert.equal(state.compactions.find((entry) => entry.id === result.id)?.status, "partial");
    assert.equal(f.requests.length, 3);
    assert.equal((await f.sdk.budgets.status(f.sessionId)).status.totals.knownReportedTokens, 126);
  } finally { await f.close(); }
});

test("image context is preserved and cannot be silently sent through the text-only compactor", { timeout: 20_000 }, async () => {
  const f = await prepared({ responseMode: "text", imageInput: true });
  try {
    const image = await sharp({ create: { width: 2, height: 2, channels: 4, background: "#336699" } }).png().toBuffer();
    await f.sdk.attachments.image(f.sessionId, image.toString("base64"), "Generated compaction image");
    await f.send("Generated image source remains intact."); await f.terminal();
    await assert.rejects(() => f.sdk.compactions.preview(f.sessionId, { keepRecentTurns: 1 }), /text history|image context/i);
    assert.equal(f.requests.length, 4);
    assert.equal(f.session().activeCompactionId, null);
    assert.ok(f.session().messages.some((message) => message.attachments?.some((entry) => entry.kind === "image")));
  } finally { await f.close(); }
});

test("kupo never silently selects a compactor; an explicit real model remains independently metered", { timeout: 20_000 }, async () => {
  const f = await routedFixture();
  try {
    await f.select();
    for (let turn = 0; turn < 3; turn++) { await f.send(`Generated routed compaction source ${turn}. ` + "Generated routed detail. ".repeat(160)); await f.terminal(); }
    await assert.rejects(() => f.sdk.compactions.preview(f.sessionId, { keepRecentTurns: 1 }), /actual|real|kupo/i);
    const preview = (await f.sdk.compactions.preview(f.sessionId, { keepRecentTurns: 1, modelId: f.solverId })).preview;
    const request = await f.sdk.compactions.generate(f.sessionId, preview, true); await f.terminal();
    const row = (await f.sdk.compactions.state(f.sessionId)).compactions.find((entry) => entry.id === request.id)!;
    assert.equal(row.status, "proposed");
    assert.equal(f.session().controls.modelId, "kupo");
    assert.equal(f.requests.length, 3); assert.equal(f.solver.requests.length, 4);
    const call = (await f.sdk.budgets.calls({ role: "compaction" })).calls[0]!;
    assert.equal(call.modelId, f.solverId); assert.equal(call.reportedTokens, 42);
  } finally { await f.close(); }
});

test("tool-bearing or expanding compactor output remains untrusted and never executes or replaces source", { timeout: 20_000 }, async () => {
  const f = await prepared();
  try {
    await f.send("generated forbidden write"); await f.terminal();
    await f.send("Generated recent retained turn."); await f.terminal();
    f.configuration.responseMode = "auto";
    let preview = (await f.sdk.compactions.preview(f.sessionId, { keepRecentTurns: 1 })).preview;
    const requested = await f.sdk.compactions.generate(f.sessionId, preview, true); await f.terminal();
    let state = await f.sdk.compactions.state(f.sessionId), row = state.compactions.find((entry) => entry.id === requested.id)!;
    assert.equal(row.status, "partial"); assert.match(row.diagnostic!, /tool-less|bounded/);
    assert.equal(f.service.controller.events(0).some((event) => event.turn_id === row.turnId && event.event_type === "tool.started"), false);
    assert.equal(state.activeId, null);
    await f.sdk.command({ type: "session.resume", sessionId: f.sessionId });
    f.configuration.responseMode = "text"; f.configuration.replyText = "Generated large expansion. ".repeat(700);
    preview = (await f.sdk.compactions.preview(f.sessionId, { keepRecentTurns: 1 })).preview;
    const expanded = await f.sdk.compactions.generate(f.sessionId, preview, true); await f.terminal();
    state = await f.sdk.compactions.state(f.sessionId); row = state.compactions.find((entry) => entry.id === expanded.id)!;
    assert.equal(row.status, "partial"); assert.match(row.diagnostic!, /not strictly smaller/);
    assert.equal(state.activeId, null); assert.equal(state.estimatedTokens, state.originalEstimatedTokens);
    assert.equal((await f.sdk.budgets.calls({ role: "compaction" })).calls.reduce((sum, call) => sum + (call.reportedTokens ?? 0), 0), 84);
  } finally { await f.close(); }
});

test("parallel generation and foreign-session review cannot escape exact operation ownership", { timeout: 20_000 }, async () => {
  const f = await prepared();
  try {
    const preview = (await f.sdk.compactions.preview(f.sessionId, { keepRecentTurns: 1 })).preview;
    const results = await Promise.allSettled([f.sdk.compactions.generate(f.sessionId, preview, true), f.sdk.compactions.generate(f.sessionId, preview, true)]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.filter((result) => result.status === "rejected").length, 1);
    await f.terminal();
    const row = (await f.sdk.compactions.state(f.sessionId)).compactions[0]!;
    const other = await f.sdk.sessions.create(null, "Generated foreign context scope");
    await assert.rejects(() => f.sdk.compactions.read(other.id!, row.id), /outside|missing/i);
    await assert.rejects(() => f.sdk.compactions.apply(other.id!, row.id, row.revision), /outside|missing/i);
    assert.equal(f.requests.length, 4);
    assert.equal(f.session().activeCompactionId, null);
  } finally { await f.close(); }
});

test("an old compaction stop cannot cancel a newer solver turn in the same session", { timeout: 20_000 }, async () => {
  const f = await prepared();
  try {
    const preview = (await f.sdk.compactions.preview(f.sessionId, { keepRecentTurns: 1 })).preview;
    const requested = await f.sdk.compactions.generate(f.sessionId, preview, true); await f.terminal();
    await f.send("generated slow newer solver turn");
    await waitFor(() => f.requests.length === 5);
    const turnId = f.session().turnId;
    await assert.rejects(() => f.sdk.compactions.stop(f.sessionId, requested.id!), /settled|ownership|newer/);
    assert.equal(f.session().turnId, turnId);
    assert.equal(f.session().status, "running");
    assert.equal(f.service.controller.events(0).some((event) => event.turn_id === turnId && event.event_type === "turn.stop_requested"), false);
    await f.sdk.command({ type: "session.stop", sessionId: f.sessionId });
    assert.equal((await f.terminal()).status, "stopped");
  } finally { await f.close(); }
});

test("changing the global hard cap invalidates the reviewed preview without making a model call", { timeout: 20_000 }, async () => {
  const f = await prepared();
  try {
    const preview = (await f.sdk.compactions.preview(f.sessionId, { keepRecentTurns: 1 })).preview;
    const catalog = (await f.sdk.profiles.list()).catalog;
    await f.sdk.profiles.globalBudget({ basis: "estimate", tokens: 50_000 }, catalog.globalBudget.revision, true);
    await assert.rejects(() => f.sdk.compactions.generate(f.sessionId, preview, true), /changed|preview/i);
    assert.equal(f.requests.length, 3);
    assert.equal((await f.sdk.compactions.state(f.sessionId)).activeId, null);
  } finally { await f.close(); }
});
