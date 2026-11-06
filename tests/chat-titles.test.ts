import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { startService } from "../apps/service/src/server.ts";
import { CHAT_TITLE_PROMPT, MoguriSdk, sessionTitle } from "../packages/sdk/src/index.ts";
import { setupFixture, waitFor, type GeneratedProviderOptions } from "./fixture.ts";

function naming(request: Record<string, unknown>): boolean {
  return JSON.stringify(request.messages).includes(CHAT_TITLE_PROMPT.split("\n")[0]!);
}
async function titleFixture(options: GeneratedProviderOptions = {}, title?: string) {
  const f = await setupFixture({ ...options, respond: options.respond ?? ((request) => ({ text: naming(request) ?
    '{"title":"Generated planner refactor"}' : "Generated original response." })), nodePrimitives: true });
  const sdk = new MoguriSdk(f.service.connection);
  try {
    await sdk.ready();
    const created = await sdk.sessions.create(f.session().projectId, title), id = created.id!;
    const session = () => f.service.controller.snapshot().sessions.find((session) => session.id === id)!;
    await sdk.command({ type: "session.configure", sessionId: id, expectedRevision: session().revision, controls: { ...session().controls, modelId: f.modelId } });
    const send = async (text: string) => {
      const saved = await sdk.command({ type: "draft.save", sessionId: id, expectedRevision: session().draft.revision, text, attachments: [] });
      return sdk.command({ type: "message.send", sessionId: id, expectedRevision: saved.revision!, delivery: "auto" });
    };
    const terminal = () => waitFor(() => !session().turnId && ["completed", "partial", "stopped", "failed"].includes(session().status) && session(), 10_000);
    return { f, sdk, id, session, send, terminal, close: async () => { sdk.disconnect(); await f.close(); } };
  } catch (error) { sdk.disconnect(); await f.close(); throw error; }
}

test("only a newly captured factory title receives one separately metered first-topic summary, never normal solver context", async () => {
  const o = await titleFixture();
  try {
    assert.equal(o.session().titleSource, "factory");
    await o.send("Generated request to refactor the planner.");
    await o.terminal(); await o.sdk.refresh();
    assert.equal(o.session().title, "Generated planner refactor"); assert.equal(o.session().titleSource, "model");
    assert.equal(o.f.requests.length, 2);
    const title = o.sdk.sessions.titles(o.id)[0]!;
    assert.equal(title.status, "completed");
    assert.ok(title.actualInputDigest); assert.ok(title.resultDigest);
    assert.equal(o.f.service.store.blob(title.inputDigest).includes("Generated request to refactor the planner."), true);
    const entry = o.f.service.controller.snapshot().budgetEntries.find((entry) => entry.id === title.stepId)!;
    assert.equal(entry.role, "title"); assert.equal(entry.sessionId, o.id); assert.equal(entry.status, "settled");
    const second = o.f.requests[1]!;
    assert.equal(naming(second), true);
    assert.equal(Array.isArray(second.tools) ? second.tools.length : 0, 0);
    await o.send("Generated follow-up for the original solver."); await o.terminal();
    assert.equal(o.f.requests.length, 3);
    assert.equal(JSON.stringify(o.f.requests[2]).includes("Generated planner refactor"), false);
    assert.equal(o.f.service.controller.events(0).filter((event) => event.event_type === "model.started" && event.payload.role === "title").length, 1);
  } finally { await o.close(); }
});

test("an explicitly supplied title, including the old placeholder string, is not naming eligibility", async () => {
  const o = await titleFixture({}, "New session");
  try {
    await o.send("Generated user-selected topic."); await o.terminal();
    assert.equal(o.session().title, "New session"); assert.equal(o.f.requests.length, 1);
    assert.equal(sessionTitle(o.session()), "New session");
  } finally { await o.close(); }
});

test("an actual inline/user rename wins against an already admitted naming result while its charge remains accounted", async () => {
  const o = await titleFixture({ respond: (request) => naming(request) ? { text: '{"title":"Generated stale model title"}', delayMs: 600 } :
    { text: "Generated primary response." } });
  try {
    await o.send("Generated topic for naming."); await waitFor(() => o.f.requests.length === 2);
    const current = o.session();
    await o.sdk.sessions.organize(o.id, { title: "Generated actual user title" }, current.revision);
    await o.terminal(); await o.sdk.refresh();
    assert.equal(o.session().title, "Generated actual user title"); assert.equal(o.session().titleSource, "user");
    const record = o.sdk.sessions.titles(o.id)[0]!;
    assert.equal(record.status, "completed"); assert.match(record.diagnostic!, /user title.*not overwritten/);
    assert.equal(o.f.service.controller.snapshot().budgetEntries.find((entry) => entry.id === record.stepId)?.status, "settled");
    assert.equal(o.f.service.controller.events(0).some((event) => event.event_type === "session.title_generated" && event.session_id === o.id), false);
  } finally { await o.close(); }
});

test("invalid naming output is explicitly rejected and charged, not applied or retried", async () => {
  const o = await titleFixture({ respond: (request) => ({ text: naming(request) ? "Generated non-JSON title output" : "Generated complete response." }) });
  try {
    await o.send("Generated invalid-output topic."); await o.terminal(); await o.sdk.refresh();
    const record = o.sdk.sessions.titles(o.id)[0]!;
    assert.equal(record.status, "rejected"); assert.match(record.diagnostic!, /invalid JSON/);
    assert.equal(o.session().titleSource, "factory"); assert.equal(o.f.requests.length, 2);
    assert.equal(o.f.service.controller.snapshot().budgetEntries.find((entry) => entry.id === record.stepId)?.status, "settled");
  } finally { await o.close(); }
});

test("known metered naming tool requests are rejected as data without executing them or downgrading completed solver work to unknown", async () => {
  const o = await titleFixture({ respond: (request) => naming(request) ? {
    tool: { name: "run_command", args: { command: "GENERATED_NAMING_MUST_NEVER_EXECUTE", timeoutMs: 1000 } },
  } : { text: "Generated complete primary reply." } });
  try {
    await o.send("Generated malicious naming output fixture."); await o.terminal(); await o.sdk.refresh();
    const record = o.sdk.sessions.titles(o.id)[0]!;
    assert.equal(o.session().status, "completed"); assert.equal(record.status, "rejected");
    assert.match(record.diagnostic!, /tool-less result/); assert.equal(o.f.requests.length, 2);
    assert.equal(o.f.service.controller.snapshot().budgetEntries.find((entry) => entry.id === record.stepId)?.status, "settled");
    assert.equal(o.f.service.controller.events(0).some((event) => event.event_type === "tool.started" && event.step_id === record.stepId), false);
  } finally { await o.close(); }
});

test("a rolled-back title/result/accounting transaction retains the original dispatched hold instead of a name or paid retry", async () => {
  const o = await titleFixture();
  try {
    o.f.service.store.db.exec("CREATE TRIGGER generated_title_apply_failure BEFORE INSERT ON events WHEN json_extract(NEW.data,'$.event_type')='session.title_generated' BEGIN SELECT RAISE(ABORT,'Generated title apply rollback'); END");
    await o.send("Generated naming rollback source."); await o.terminal(); await o.sdk.refresh();
    const record = o.sdk.sessions.titles(o.id)[0]!, entry = o.f.service.controller.snapshot().budgetEntries.find((entry) => entry.id === record.stepId)!;
    assert.equal(record.status, "partial"); assert.equal(o.session().titleSource, "factory");
    assert.equal(entry.role, "title"); assert.equal(entry.status, "unknown"); assert.equal(entry.reportedTokens, null);
    assert.ok(entry.reservedTokens! > 0); assert.equal(o.f.requests.length, 2);
    assert.equal(o.f.service.controller.events(0).some((event) => event.event_type === "model.completed" && event.step_id === record.stepId), false);
    o.f.service.store.db.exec("DROP TRIGGER generated_title_apply_failure");
  } finally { await o.close(); }
});

test("stop and restart during naming preserve its original unknown charge and topic without a second request", async () => {
  const o = await titleFixture({ respond: (request) => naming(request) ? { hold: true } : { text: "Generated complete primary reply." } });
  let restarted: Awaited<ReturnType<typeof startService>> | undefined, recovered: MoguriSdk | undefined;
  try {
    await o.send("Generated cancelled naming topic."); await waitFor(() => o.f.requests.length === 2);
    const record = o.f.service.controller.snapshot().chatTitles!.find((record) => record.sessionId === o.id)!;
    await o.sdk.command({ type: "session.stop", sessionId: o.id }); await o.terminal();
    const state = o.f.service.controller.snapshot();
    assert.equal(state.chatTitles!.find((candidate) => candidate.id === record.id)?.status, "partial");
    const entry = state.budgetEntries.find((entry) => entry.id === record.stepId)!;
    assert.equal(entry.role, "title");
    assert.equal(entry.status, "unknown"); assert.equal(entry.reportedTokens, null); assert.ok(entry.reservedTokens! > 0);
    assert.equal(o.session().titleSource, "factory"); assert.equal(o.f.requests.length, 2);
    o.sdk.disconnect(); await o.f.service.close({ preserveTerminals: true });
    restarted = await startService({ stateDir: join(o.f.directory, "state"), provider: o.f.provider, retentionKey: o.f.retentionKey });
    recovered = await new MoguriSdk(restarted.connection).ready();
    const original = recovered.sessions.titles(o.id)[0]!;
    assert.equal(original.status, "partial"); assert.equal(original.stepId, record.stepId);
    assert.equal(restarted.controller.snapshot().budgetEntries.find((entry) => entry.id === record.stepId)?.status, "unknown");
    assert.ok(restarted.store.blob(original.inputDigest).includes("Generated cancelled naming topic."));
    assert.equal(o.f.requests.length, 2);
  } finally { recovered?.disconnect(); await restarted?.close(); await o.close(); }
});
