import assert from "node:assert/strict";
import test from "node:test";
import { LiveAnalytics } from "../apps/service/src/live-analytics.ts";
import { envelope } from "../apps/service/src/controller.ts";
import { LIVE_ANALYTICS_LIMITS, MoguriSdk, type Snapshot, type StoredEvent } from "../packages/sdk/src/index.ts";
import { setupFixture } from "./fixture.ts";

const PROFILE = "generated-profile", START = Date.parse("2030-01-01T10:00:00.000Z");
type Generated = { event_type: string; session_id?: string; turn_id?: string; step_id?: string; at: number; payload: unknown };
let sequence = 0;
const stored = (input: Generated): StoredEvent => ({
  seq: ++sequence, id: `generated-event-${sequence}`, schema_version: 1, work_item_id: null, parent_event_id: null, profile_id: PROFILE,
  session_id: input.session_id ?? "generated-session", turn_id: input.turn_id ?? "generated-turn", step_id: input.step_id ?? null,
  timestamp: new Date(START + input.at).toISOString(), event_type: input.event_type, payload: input.payload,
} as unknown as StoredEvent);
const session = (id: string, values: Record<string, unknown> = {}) => ({
  id, projectId: "generated-project", title: `Generated ${id}`, titleSource: "user", status: "completed", turnId: null, pendingApproval: null, pendingQuestionId: null,
  updatedAt: new Date(START).toISOString(), ...values,
});
const host = (sessions: ReturnType<typeof session>[], clock: { now: number }) => ({
  profileId: PROFILE, now: () => clock.now, events: () => [],
  snapshot: () => ({ sessions, projects: [{ id: "generated-project", name: "Generated project" }], settings: { values: { mcpServers: [{ enabled: true }, { enabled: false }] } } }) as unknown as Snapshot,
});
const usage = (inputTokens: number | null, outputTokens: number | null) => ({ stepId: "generated", modelId: "generated-model", role: "solver", inputTokens, outputTokens });

test("live analytics maps one turn into prompt, answer, thinking, command, file, MCP and failure lanes without inventing token reports", () => {
  const clock = { now: START + 10_000 }, analytics = new LiveAnalytics(host([session("generated-session")], clock));
  analytics.observe([
    stored({ event_type: "turn.started", at: 0, payload: { item: { text: "Generated   prompt\nwith whitespace" } } }),
    stored({ event_type: "model.started", step_id: "step-1", at: 100, payload: { modelId: "generated-model" } }),
    stored({ event_type: "model.completed", step_id: "step-1", at: 900, payload: { message: { text: "", reasoning: "Generated reasoning", toolCalls: [{}, {}] }, usage: usage(120, 30) } }),
    stored({ event_type: "tool.started", at: 1000, payload: { call: { id: "call-1", name: "run_command", arguments: { command: "npm test" } } } }),
    stored({ event_type: "tool.completed", at: 1500, payload: { call: { id: "call-1" }, text: "generated failure", isError: true, outcome: "failed" } }),
    stored({ event_type: "tool.started", at: 1600, payload: { call: { id: "call-2", name: "edit_file", arguments: { path: "generated.ts" } } } }),
    stored({ event_type: "tool.completed", at: 1700, payload: { call: { id: "call-2" }, text: "ok", isError: false, outcome: "completed" } }),
    stored({ event_type: "tool.started", at: 1800, payload: { call: { id: "call-3", name: "mcp_direct_generated", arguments: {}, directMcp: { tool: "generated_lookup" } } } }),
    stored({ event_type: "model.started", step_id: "step-2", at: 2000, payload: { modelId: "generated-model" } }),
    stored({ event_type: "model.completed", step_id: "step-2", at: 2500, payload: { message: { text: "Generated answer" }, usage: usage(null, 12) } }),
  ]);
  const detail = analytics.query({ type: "analytics.session", sessionId: "generated-session" });
  assert.equal(detail.type, "analytics.session");
  if (detail.type !== "analytics.session" || !detail.session) throw new Error("Generated session analytics missing.");
  const lanes = detail.session.events.map((event) => [event.lane, event.status]);
  assert.deepEqual(lanes, [["prompt", "ok"], ["answer", "ok"], ["thinking", "ok"], ["command", "failed"], ["file", "ok"], ["tool", "running"], ["answer", "ok"]]);
  assert.equal(detail.session.events[0]!.label, "Generated prompt with whitespace");
  assert.equal(detail.session.events[1]!.label, "Requested 2 tool calls");
  assert.equal(detail.session.events[3]!.label, "run_command npm test");
  assert.equal(detail.session.events[5]!.label, "mcp_direct_generated generated_lookup");
  assert.deepEqual({ ...detail.session.summary.totals }, {
    prompts: 1, answers: 2, commands: 1, mcpCalls: 1, edits: 1, failed: 1, inputTokens: 120, outputTokens: 42, unreportedCalls: 1, models: ["generated-model"],
  });
  assert.equal(detail.session.summary.firstPrompt, "Generated prompt with whitespace");

  analytics.observe([stored({ event_type: "turn.finished", at: 3000, payload: { outcome: "stopped", diagnostic: "Generated stop" } })]);
  const after = analytics.query({ type: "analytics.session", sessionId: "generated-session" });
  if (after.type !== "analytics.session" || !after.session) throw new Error("Generated session analytics missing.");
  assert.equal(after.session.events.find((event) => event.id === "tool:call-3")!.status, "stopped");
  assert.equal(after.session.events.at(-1)!.label, "Turn stopped");
});

test("live analytics forgets old, archived, deleted and over-cap data and only keeps active sessions past the window", () => {
  const clock = { now: START }, limits = { ...LIVE_ANALYTICS_LIMITS, windowMs: 60_000, sessions: 2, eventsPerSession: 3 };
  const sessions = [session("generated-old"), session("generated-active", { turnId: "generated-turn", status: "running" }), session("generated-archived"), session("generated-recent")];
  const analytics = new LiveAnalytics(host(sessions, clock), limits);
  const prompt = (sessionId: string, at: number) => stored({ event_type: "turn.started", session_id: sessionId, at, payload: { item: { text: `Generated ${at}` } } });
  analytics.observe([prompt("generated-old", 0), prompt("generated-active", 0)]);
  analytics.observe([prompt("generated-archived", 0), stored({ event_type: "session.archived", session_id: "generated-archived", at: 1, payload: {} })]);
  assert.deepEqual(analytics.query({ type: "analytics.session", sessionId: "generated-archived" }), { type: "analytics.session", session: null });

  clock.now = START + 61_000;
  analytics.prune();
  const overview = analytics.overview();
  assert.deepEqual(overview.sessions.map((value) => value.sessionId), ["generated-active"]);
  assert.equal(overview.live, 1); assert.equal(overview.working, 1); assert.equal(overview.mcpServers, 1);
  const active = analytics.query({ type: "analytics.session", sessionId: "generated-active" });
  assert.ok(active.type === "analytics.session" && active.session?.events.length === 0, "Events older than the window are dropped even for active sessions.");

  analytics.observe([0, 1, 2, 3, 4].map((offset) => prompt("generated-recent", 61_000 + offset)));
  const recent = analytics.query({ type: "analytics.session", sessionId: "generated-recent" });
  assert.ok(recent.type === "analytics.session" && recent.session);
  assert.deepEqual(recent.session.events.map((event) => event.label), ["Generated 61002", "Generated 61003", "Generated 61004"]);
  assert.equal(recent.session.truncated, true);

  analytics.observe([prompt("generated-old", 61_010)]);
  assert.deepEqual(analytics.overview().sessions.map((value) => value.sessionId).sort(), ["generated-active", "generated-old"], "Session cap drops the least recent track.");
  analytics.observe([stored({ event_type: "session.deleted", session_id: "generated-old", at: 61_020, payload: {} })]);
  assert.deepEqual(analytics.overview().sessions.map((value) => value.sessionId), ["generated-active"]);
  analytics.close();
  assert.equal(analytics.overview().sessions.length, 1, "Only the still-active snapshot session reappears after close; its retained events are gone.");
});

test("live analytics reads a real generated turn through the SDK without appending durable events and drops it on archive", { skip: process.platform !== "darwin", timeout: 30_000 }, async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.configure();
    await fixture.send("Generated analytics prompt");
    await fixture.terminal();
    const before = fixture.service.controller.events(0).length;
    const overview = await sdk.analytics.overview();
    assert.ok(overview.sessions.some((value) => value.sessionId === fixture.sessionId));
    const detail = await sdk.analytics.session(fixture.sessionId);
    assert.ok(detail);
    assert.equal(detail.summary.firstPrompt, "Generated analytics prompt");
    assert.ok(detail.events.some((event) => event.lane === "prompt"));
    assert.ok(detail.events.some((event) => event.lane === "answer" && event.status === "ok"));
    assert.equal(fixture.service.controller.events(0).length, before, "Analytics queries never append durable events.");
    await fixture.service.controller.dispatch(envelope({ type: "session.archive", sessionId: fixture.sessionId }));
    assert.equal(await sdk.analytics.session(fixture.sessionId), null);
  } finally { sdk.disconnect(); await fixture.close(); }
});
