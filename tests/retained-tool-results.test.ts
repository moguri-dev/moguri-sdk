import assert from "node:assert/strict";
import test from "node:test";
import { MoguriSdk, isRecord } from "../packages/sdk/src/index.ts";
import { setupFixture } from "./fixture.ts";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startService } from "../apps/service/src/server.ts";
import { publicToolResults } from "../apps/service/src/retained-tool-results.ts";
import { operationProjection } from "../apps/service/src/operation-telemetry.ts";
import type { StoredEvent } from "../packages/sdk/src/index.ts";

test("the public activity identity resolves its original tool result instead of being mistaken for a model step", { skip: process.platform !== "darwin" }, async () => {
  const f = await setupFixture({ toolCall: { name: "read_file", args: { path: "fixture.txt" } } });
  const sdk = await new MoguriSdk(f.service.connection).ready();
  try {
    await f.configure(); await f.send("Generated original public source."); await f.terminal();
    const activity = (await sdk.activity.list(f.sessionId)).activity.entries.find((entry) => entry.toolName === "read_file");
    assert.ok(activity?.messageId);
    const result = await sdk.tools.result(f.sessionId, activity.id, activity.messageId);
    assert.equal(result.text, "generated original\n"); assert.equal(result.rawComplete, true);
  } finally { sdk.disconnect(); await f.close(); }
});

test("public results use digest-pinned UTF-8 pages and original grants after source edits, paging, reopen and restart", { skip: process.platform !== "darwin" }, async () => {
  const f = await setupFixture({ toolCall: { name: "read_file", args: { path: "fixture.txt" } } });
  let sdk = await new MoguriSdk(f.service.connection).ready(), restarted: Awaited<ReturnType<typeof startService>> | undefined;
  const original = "Generated original \u{1f9ea} source.\n".repeat(1500);
  try {
    await writeFile(join(f.project, "fixture.txt"), original);
    await f.configure(); await f.send("Generated retained paged source."); await f.terminal();
    const listed = await sdk.tools.results(f.sessionId, { limit: 1 }), source = listed.sources[0]!;
    assert.equal(source.name, "read_file"); assert.ok(source.operationId); assert.equal(source.rawComplete, true);
    const first = await sdk.tools.resultById(f.sessionId, source.operationId, { expectedDigest: source.digest, expectedRevision: source.revision });
    assert.ok(first.nextOffset); assert.ok(first.text.isWellFormed());
    await assert.rejects(() => sdk.tools.resultById(f.sessionId, source.operationId, { offset: first.nextOffset!, expectedDigest: "0".repeat(64) }), { code: "tool_result_changed" });
    await assert.rejects(() => sdk.tools.resultById(f.sessionId, source.operationId, { expectedRevision: source.revision + 1 }), { code: "tool_result_changed" });
    const other = await sdk.sessions.create(f.session().projectId);
    await assert.rejects(() => sdk.tools.resultById(other.id!, source.operationId), { code: "tool_result_scope" });
    assert.deepEqual((await sdk.tools.results(other.id!)).sources, []);
    await writeFile(join(f.project, "fixture.txt"), "Generated later source is not the retained result.\n");
    const requests = f.requests.length; sdk.disconnect(); await f.service.close();
    restarted = await startService({ stateDir: join(f.directory, "state"), provider: f.provider, retentionKey: f.retentionKey });
    sdk = await new MoguriSdk(restarted.connection).ready();
    let text = first.text;
    let offset: number | null = first.nextOffset;
    while (offset !== null) {
      const page = await sdk.tools.resultById(f.sessionId, source.operationId, { offset, expectedDigest: source.digest, expectedRevision: source.revision });
      assert.equal(page.offset, offset); assert.equal(page.source.operationId, source.operationId); assert.ok(page.text.isWellFormed());
      text += page.text; offset = page.nextOffset;
    }
    assert.equal(text, original); assert.equal(f.requests.length, requests);
    assert.equal((await sdk.tools.results(f.sessionId)).sources[0]?.operationId, source.operationId);
  } finally { sdk.disconnect(); await restarted?.close(); await f.close(); }
});

test("retained public-source filtering excludes hooks, private control turns, foreign profiles and ambiguous reused identities", { skip: process.platform !== "darwin" }, async () => {
  const f = await setupFixture({ toolCall: { name: "clock", args: { action: "now" } } });
  try {
    await f.configure(); await f.send("Generated source-filter fixture."); await f.terminal();
    const history = f.service.controller.events(0), completion = history.find((event) => event.event_type === "tool.completed");
    if (completion?.event_type !== "tool.completed") assert.fail("Missing original public completion.");
    const hook = { ...completion, id: "generated-private-hook-result", payload: { ...completion.payload, call: { ...completion.payload.call,
      hook: { id: "generated-hook", revision: 0, contentDigest: "a".repeat(64), trigger: "turn.start" as const, actor: "user-configured-hook" as const } } } };
    const hidden: StoredEvent = { ...completion, id: "generated-private-turn-result", turn_id: "generated-private-turn" };
    const foreign: StoredEvent = { ...completion, id: "generated-foreign-result", profile_id: "generated-foreign-profile" };
    const changed: StoredEvent = { ...completion, id: "generated-ambiguous-result", payload: { ...completion.payload,
      call: { ...completion.payload.call, arguments: { action: "wait", milliseconds: 1 } } } };
    for (const extra of [hook, hidden, foreign]) {
      const events = [...history, extra];
      const sources = publicToolResults(events, operationProjection(events), "default", f.sessionId);
      assert.equal(sources.length, 1); assert.equal(sources[0]?.event.id, completion.id);
    }
    const ambiguous = [...history, changed];
    assert.deepEqual(publicToolResults(ambiguous, operationProjection(ambiguous), "default", f.sessionId), []);
  } finally { await f.close(); }
});

test("even compact non-raw results give the model their actual retained source identity", { skip: process.platform !== "darwin" }, async () => {
  let observed = false;
  const f = await setupFixture({ respond: (request, index) => {
    if (index === 1) return { tool: { name: "clock", args: { action: "now" } } };
    const messages = Array.isArray(request.messages) ? request.messages.filter(isRecord) : [];
    const result = messages.findLast((message) => message.role === "tool");
    const value: unknown = JSON.parse(String(result?.content));
    observed = isRecord(value) && isRecord(value.retainedSource) && typeof value.retainedSource.stepId === "string" &&
      typeof value.retainedSource.callId === "string";
    return { text: "Generated original source inspection complete." };
  } });
  try {
    await f.configure(); await f.send("Generated compact original result."); await f.terminal();
    assert.equal(observed, true, "models must not invent an undisclosed source step ID");
  } finally { await f.close(); }
});
