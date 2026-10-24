import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MAX_TEXT, MoguriSdk, PROTOCOL_VERSION, type ActivityCursor, type ActivityKind, type StoredEvent, type ToolCall } from "../packages/sdk/src/index.ts";
import { ChatActivity, describeActivityCall } from "../apps/service/src/chat-activity.ts";
import { operationProjection } from "../apps/service/src/operation-telemetry.ts";
import { EventStore } from "../apps/service/src/store.ts";
import { startService } from "../apps/service/src/server.ts";
import { setupFixture, waitFor, type GeneratedProviderOptions } from "./fixture.ts";
import { retainedCiphertextRows, writeLegacyState } from "./fixtures/legacy-state.ts";

test("session activity reports an empty retained session without inference or an inherited scope", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const result = await sdk.activity.list(fixture.sessionId);
    assert.equal(result.activity.sessionId, fixture.sessionId);
    assert.deepEqual(result.activity.entries, []); assert.equal(result.activity.nextBefore, null);
    assert.deepEqual(result.activity.current, []); assert.equal(result.activity.currentCount, 0);
    await assert.rejects(() => sdk.activity.list("outside-profile"), /session|profile/i);
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("operation icons describe actual file, search, skill, issue, script and MCP identities without adding capabilities", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const snapshot = sdk.getState().snapshot!, before = snapshot.registry.length;
    const mcpCases: Array<[string, ActivityKind]> = [["web_search", "search-web"], ["brave_web_search", "search-web"], ["fetch_page", "search-web"], ["find_skills", "search-skills"],
      ["load_skill", "load-skill"], ["create_issue", "create-issue"], ["issue_create", "create-issue"], ["search_files", "search-files"], ["generated_unknown", "mcp"]];
    const cases: Array<[string, Record<string, unknown>, ActivityKind]> = [
      ["read_file", { path: "generated.txt" }, "read-file"],
      ["read_file", { path: "generated.txt", search: "generated" }, "search-files"],
      ["read_document", { attachmentId: "generated-document" }, "read-file"],
      ["write_file", { path: "generated.txt", expectedDigest: "absent" }, "create-file"],
      ["write_file", { path: "generated.txt", expectedDigest: "a".repeat(64) }, "edit-file"],
      ["list_files", { path: "." }, "search-files"], ["search_document", { query: "generated" }, "search-files"],
      ["memory_search", { query: "generated" }, "search-files"], ["run_command", { command: "printf generated" }, "command"],
      ["ask_user", { question: "Generated question?" }, "ask-user"],
      ...mcpCases.map(([tool, kind]): [string, Record<string, unknown>, ActivityKind] => ["mcp_gateway", { action: "call", serverId: "generated", tool, arguments: { query: "generated" } }, kind]),
      ["mcp_gateway", { action: "list" }, "mcp"], ["generated_unknown", {}, "tool"],
    ];
    for (const [name, args, kind] of cases) assert.equal(describeActivityCall({ id: "generated-call", name, arguments: args }, snapshot).kind, kind, name);
    const hook: ToolCall = { id: "generated-hook-call", name: "run_command", arguments: { command: "printf generated" },
      hook: { id: "generated-hook", revision: 0, contentDigest: "a".repeat(64), trigger: "turn.start", actor: "user-configured-hook" } };
    assert.equal(describeActivityCall(hook, snapshot).label, "Run configured script");
    assert.equal(sdk.getState().snapshot!.registry.length, before); assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("tool activity uses exact original starts, outcomes, arguments and retained UTF-8 result quantities", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.configure(); await fixture.send("generated tool activity"); await fixture.approve(); await fixture.terminal();
    const entry = (await sdk.activity.list(fixture.sessionId)).activity.entries.find((entry) => entry.kind === "read-file")!;
    const start = fixture.service.controller.events(0).find((event) => event.event_type === "tool.started")!;
    const finished = fixture.service.controller.events(0).find((event) => event.event_type === "tool.completed")!;
    if (finished.event_type !== "tool.completed") throw new Error("Generated result missing.");
    assert.equal(entry.startedAt, start.timestamp); assert.equal(entry.status, "completed");
    assert.equal(entry.outputBytes, Buffer.byteLength(finished.payload.text)); assert.equal(entry.outputBasis, "retained-utf8");
    assert.equal(entry.durationMs, Date.parse(finished.timestamp) - Date.parse(start.timestamp));
    const args = await sdk.activity.read(fixture.sessionId, entry.id, "arguments");
    assert.equal(JSON.parse(args.content!.text).path, "fixture.txt");
    const output = await sdk.activity.read(fixture.sessionId, entry.id, "output", { limit: 8 });
    assert.equal(Buffer.byteLength(output.content!.text), 8); assert.equal(output.content!.nextOffset, 8);
    const other = (await sdk.sessions.create(null)).id!;
    await assert.rejects(() => sdk.activity.read(other, entry.id, "output"), /activity|scope|session/i);
    const independent = await sdk.telemetry.operations({ sessionId: fixture.sessionId });
    assert.equal(JSON.stringify(independent).includes("fixture.txt"), false);
    assert.equal(JSON.stringify(independent).includes("generated original"), false);
    assert.equal(fixture.requests.length, 2);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("turn info retains original model/context and captured prices; copy excludes provider reasoning and tool payloads", { skip: process.platform !== "darwin" }, async (t) => {
  const fixture = await setupFixture({ reasoning: true, reasoningText: "Generated public provider reasoning.", contextWindow: 32768 }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const settings = sdk.settings.get()!;
    await sdk.settings.update({ ...settings.values, budgets: { ...settings.values.budgets, rates: [{
      modelId: fixture.modelId, inputUsdPerMillion: 1, outputUsdPerMillion: 2, effectiveAt: new Date().toISOString().slice(0, 10), source: "user-estimate",
    }] } }, settings.revision);
    await fixture.configure(); await fixture.send("Generated public activity response. GENERATED_PRIVATE_CONTEXT_SENTINEL"); await fixture.terminal();
    const turnId = fixture.session().messages.find((message) => message.role === "user")!.turnId;
    const thought = (await sdk.activity.list(fixture.sessionId)).activity.entries.find((entry) => entry.kind === "thought")!;
    assert.ok(thought); assert.equal(thought.durationBasis, "model-request"); assert.equal(thought.hasArguments, false); assert.equal(thought.status, "completed");
    const reasoning = fixture.session().messages.find((message) => message.role === "assistant")!.reasoning!;
    const completion = fixture.service.controller.events(0).find((event) => event.event_type === "model.completed")!;
    if (completion.event_type !== "model.completed") throw new Error("Generated completion missing.");
    const blob = fixture.service.store.blob.bind(fixture.service.store);
    t.mock.method(fixture.service.store, "blob", (digest: string) => {
      if (digest === completion.payload.contextDigest) throw new Error("Activity must not read private model context.");
      return blob(digest);
    });
    assert.equal((await sdk.activity.read(fixture.sessionId, thought.id, "output")).content?.text, reasoning);
    assert.equal(JSON.stringify(thought).includes("GENERATED_PRIVATE_CONTEXT_SENTINEL"), false);
    assert.equal(reasoning.includes("GENERATED_PRIVATE_CONTEXT_SENTINEL"), false);
    const before = (await sdk.activity.turn(fixture.sessionId, turnId)).info;
    assert.equal(before.context?.window, 32768); assert.equal(before.models[0]?.modelId, fixture.modelId);
    assert.ok(before.usage.estimatedUsd! > 0);
    const changed = sdk.settings.get()!;
    await sdk.settings.update({ ...changed.values, budgets: { ...changed.values.budgets, rates: [{
      ...changed.values.budgets.rates[0]!, inputUsdPerMillion: 99, outputUsdPerMillion: 99,
    }] } }, changed.revision);
    assert.equal((await sdk.activity.turn(fixture.sessionId, turnId)).info.usage.estimatedUsd, before.usage.estimatedUsd);
    const response = sdk.activity.response(fixture.sessionId, turnId);
    assert.equal(response.includes(reasoning), false);
    assert.match(response, /Generated Copilot response/);
    assert.equal(before.responseBytes, Buffer.byteLength(response));
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("provider output limits stay partial, not unknown or completed thought operations", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture({ reasoning: true, reasoningText: "Generated bounded provider reasoning.", finishReason: "length" }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.configure(); await fixture.send("Generated bounded public response."); await fixture.terminal();
    const thought = (await sdk.activity.list(fixture.sessionId)).activity.entries.find((entry) => entry.kind === "thought")!;
    assert.equal(thought.status, "partial"); assert.ok(thought.finishedAt); assert.ok(thought.durationMs !== null);
    assert.equal(fixture.session().status, "partial");
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("real file creation/editing and command arguments/results keep actual effects, failure status and captured byte counts", { skip: process.platform !== "darwin" }, async (t) => {
  for (const kind of ["create", "edit", "command"] as const) await t.test(kind, async () => {
    const options: GeneratedProviderOptions = kind === "create" ? { toolCall: { name: "write_file", args: { path: "generated-new.txt", text: "Generated new file.\n", expectedDigest: "absent" } } } :
      kind === "command" ? { toolCall: { name: "run_command", args: { command: "printf 'Generated script result\\n'", timeoutMs: 2000 } } } : {};
    const fixture = await setupFixture(options), sdk = await new MoguriSdk(fixture.service.connection).ready();
    try {
      await fixture.configure(); await fixture.send(kind === "edit" ? "generated write" : "Generated actual activity.");
      await fixture.approve();
      if (kind === "edit") await fixture.approve();
      await fixture.terminal();
      const expected = kind === "create" ? "create-file" : kind === "edit" ? "edit-file" : "command";
      const entry = (await sdk.activity.list(fixture.sessionId)).activity.entries.find((entry) => entry.kind === expected)!;
      assert.ok(entry); assert.equal(entry.status, "completed");
      const args = JSON.parse((await sdk.activity.read(fixture.sessionId, entry.id, "arguments")).content!.text);
      const result = (await sdk.activity.read(fixture.sessionId, entry.id, "output")).content!;
      assert.equal(entry.outputBytes, result.bytes); assert.equal(result.bytes, Buffer.byteLength(result.text));
      if (kind === "command") {
        assert.equal(args.command, options.toolCall!.args.command); assert.match(result.text, /Generated script result/);
        delete options.toolCall;
        await fixture.send("generated failing command"); await fixture.approve(); await fixture.terminal();
        const failure = (await sdk.activity.list(fixture.sessionId)).activity.entries.find((entry) => entry.kind === "command" && entry.status === "failed")!;
        assert.ok(failure); assert.match((await sdk.activity.read(fixture.sessionId, failure.id, "output")).content!.text, /7|failure/);
      } else {
        assert.equal(await readFile(join(fixture.project, kind === "create" ? "generated-new.txt" : "fixture.txt"), "utf8"), kind === "create" ? "Generated new file.\n" : "generated replacement\n");
        assert.equal(args.path, kind === "create" ? "generated-new.txt" : "fixture.txt");
      }
    } finally { sdk.disconnect(); await fixture.close(); }
  });
});

test("model and external MCP activity retains exact nested arguments/results and source deletion never falls back to the independent ledger", { skip: process.platform !== "darwin" }, async () => {
  const options: GeneratedProviderOptions = {}, fixture = await setupFixture(options), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const tool = (await sdk.mcp.tools("builtin", "grep", 0, fixture.sessionId)).tools.find((tool) => tool.name === "grep_logs")!;
    options.mcpCall = { serverId: "builtin", tool: tool.name, arguments: { path: "fixture.txt", query: "original" }, schemaDigest: tool.digest };
    await fixture.configure(); await fixture.send("generated mcp call"); await fixture.approve(); await fixture.terminal();
    const external = await sdk.mcp.call(fixture.sessionId, "builtin", tool.name, { path: "fixture.txt", query: "original" }, tool.digest);
    await fixture.approve(); assert.equal((await sdk.jobs.wait(external.id!)).status, "completed");
    const entries = (await sdk.activity.list(fixture.sessionId)).activity.entries.filter((entry) => entry.source === "tool");
    assert.equal(entries.length, 2); assert.deepEqual(entries.map((entry) => entry.actor).sort(), ["external", "model"]);
    for (const entry of entries) {
      const args = JSON.parse((await sdk.activity.read(fixture.sessionId, entry.id, "arguments")).content!.text);
      assert.deepEqual(args.arguments, { path: "fixture.txt", query: "original" }); assert.equal(args.schemaDigest, tool.digest);
      assert.equal(entry.kind, "search-files"); assert.equal(entry.status, "completed");
      assert.match((await sdk.activity.read(fixture.sessionId, entry.id, "output")).content!.text, /generated original/);
    }
    await sdk.sessions.delete(fixture.sessionId, true, fixture.session().revision);
    await assert.rejects(() => sdk.activity.list(fixture.sessionId), { code: "activity_scope" });
    await assert.rejects(() => sdk.activity.read(fixture.sessionId, entries[0]!.id, "output"), { code: "activity_scope" });
    assert.equal((await sdk.telemetry.operations()).totals.completed, 2);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("reused call IDs, UTF-8 paging, latest-update pagination, ambiguous bodies and regressed clocks do not invent a source", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const snapshot = sdk.getState().snapshot!;
    const common: Pick<StoredEvent, "profile_id" | "schema_version" | "project_id" | "session_id" | "turn_id" | "step_id" | "work_item_id" | "parent_event_id"> = {
      profile_id: sdk.profileId, schema_version: 1, project_id: fixture.session().projectId, session_id: fixture.sessionId,
      turn_id: "generated-turn", step_id: "generated-step-a", work_item_id: null, parent_event_id: null,
    };
    const callA: ToolCall = { id: "generated-reused-call", name: "read_file", arguments: { path: "generated-a.txt" } }, callB = { ...callA, arguments: { path: "generated-b.txt" } };
    const events: StoredEvent[] = [
      { ...common, id: "generated-start-a", seq: 1, timestamp: "2026-01-01T12:00:00.000Z", event_type: "tool.started", payload: { call: callA } },
      { ...common, step_id: "generated-step-b", id: "generated-start-b", seq: 2, timestamp: "2026-01-01T12:00:01.000Z", event_type: "tool.started", payload: { call: callB } },
      { ...common, step_id: "generated-step-b", id: "generated-end-b", seq: 3, timestamp: "2026-01-01T12:00:02.000Z", event_type: "tool.completed", payload: { call: callB, text: "Generated B", isError: false, outcome: "completed" } },
      { ...common, id: "generated-end-a", seq: 4, timestamp: "2026-01-01T12:00:03.000Z", event_type: "tool.completed", payload: { call: callA, text: "A🐈", isError: false, outcome: "completed" } },
    ];
    const activity = new ChatActivity({
      snapshot: () => ({ ...snapshot, seq: events.at(-1)!.seq, operationEntries: operationProjection(events, sdk.profileId) }), events: () => events,
      turnBudget: () => { throw new Error("No accounting was requested."); }, workflow: async () => { throw new Error("No workflow was requested."); },
    }, fixture.service.store);
    const list = async (before?: ActivityCursor) => {
      const result = await activity.query({ type: "activity.list", sessionId: fixture.sessionId, limit: 1, ...(before === undefined ? {} : { before }) });
      if (result.type !== "activity.list") throw new Error("Wrong generated response.");
      return result.activity;
    };
    const read = async (id: string, offset = 0, limit = 16384) => {
      const result = await activity.query({ type: "activity.read", sessionId: fixture.sessionId, activityId: id, part: "output", offset, limit });
      if (result.type !== "activity.read") throw new Error("Wrong generated response.");
      return result;
    };
    const first = await list(), a = first.entries[0]!;
    assert.equal(a.subject, "generated-a.txt"); assert.equal(a.sequence, 1); assert.equal(a.updatedSequence, 4);
    assert.equal(a.outputBytes, 5); assert.equal(a.durationMs, 3000);
    assert.equal((await list(first.nextBefore!)).entries[0]?.subject, "generated-b.txt");
    const page = (await read(a.id, 0, 4)).content!;
    assert.equal(page.text, "A"); assert.equal(page.nextOffset, 1);
    assert.equal((await read(a.id, page.nextOffset!, 4)).content?.text, "🐈");
    events.push({ ...common, id: "generated-ambiguous-end", seq: 5, timestamp: "2026-01-01T11:59:00.000Z", event_type: "tool.completed", payload: { call: callB, text: "Do not show an ambiguous result.", isError: false, outcome: "completed" } });
    const ambiguous = (await list()).entries[0]!;
    assert.equal(ambiguous.hasArguments, false); assert.equal(ambiguous.hasOutput, false); assert.equal(ambiguous.outputBytes, null);
    assert.equal(ambiguous.status, "unknown");
    assert.equal(ambiguous.durationMs, null); assert.equal((await read(ambiguous.id)).content, null);
    const command: ToolCall = { id: "generated-stream", name: "run_command", arguments: { command: "printf generated" } };
    events.push(
      { ...common, step_id: "generated-stream-step", id: "generated-stream-start", seq: 6, timestamp: "2026-01-01T12:00:04.000Z", event_type: "tool.started", payload: { call: command } },
      { ...common, step_id: "generated-stream-step", id: "generated-stream-output", seq: 7, timestamp: "2026-01-01T12:00:05.000Z", event_type: "tool.output", payload: { callId: command.id, text: `🐈${"A".repeat(MAX_TEXT - 1)}` } },
      { ...common, step_id: "generated-other-step", id: "generated-other-start", seq: 8, timestamp: "2026-01-01T12:00:05.000Z", event_type: "tool.started", payload: { call: { ...command, id: "generated-other-stream" } } },
    );
    const whileRunning = await list();
    assert.equal(whileRunning.currentCount, 2);
    assert.ok(whileRunning.current.some((entry) => entry.stepId === "generated-stream-step"));
    assert.equal(whileRunning.entries.some((entry) => entry.stepId === "generated-stream-step"), false);
    events.push({ ...common, id: "generated-turn-end", seq: 9, timestamp: "2026-01-01T12:00:06.000Z", event_type: "turn.finished", payload: { outcome: "partial", diagnostic: "Generated missing cleanup." } });
    const sameEventFirst = await list(), sameEventSecond = await list(sameEventFirst.nextBefore!);
    assert.equal(sameEventFirst.currentCount, 0);
    assert.equal(sameEventFirst.entries[0]!.updatedSequence, 9); assert.equal(sameEventSecond.entries[0]!.updatedSequence, 9);
    assert.notEqual(sameEventFirst.entries[0]!.id, sameEventSecond.entries[0]!.id);
    const stream = [...sameEventFirst.entries, ...sameEventSecond.entries].find((entry) => entry.stepId === "generated-stream-step")!;
    assert.equal(stream.status, "unconfirmed"); assert.equal(stream.outputBasis, "retained-tail"); assert.equal(stream.outputBytes, MAX_TEXT - 1);
    assert.equal((await read(stream.id)).content!.text.includes("\uFFFD"), false);
    events.push(
      { ...common, step_id: "generated-stream-step", id: "generated-final-output", seq: 10, timestamp: "2026-01-01T12:00:07.000Z", event_type: "tool.completed", payload: { call: command, text: "Generated final retained result.", isError: false, outcome: "completed" } },
      { ...common, step_id: "generated-stream-step", id: "generated-late-stream", seq: 11, timestamp: "2026-01-01T12:00:08.000Z", event_type: "tool.output", payload: { callId: command.id, text: "Never append this after the final result." } },
    );
    const final = await read(stream.id);
    assert.equal(final.entry.outputBasis, "retained-utf8"); assert.equal(final.content?.text, "Generated final retained result.");
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("an actual question stays waiting until its owning answer and stopped work never looks completed", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.configure(); await fixture.send("generated structured question");
    await waitFor(() => fixture.session().pendingQuestionId);
    const question = (await sdk.activity.list(fixture.sessionId)).activity.entries.find((entry) => entry.kind === "ask-user")!;
    assert.equal(question.status, "waiting_input"); assert.equal(question.finishedAt, null);
    assert.equal(question.durationMs, null); assert.equal(question.outputBytes, null);
    await sdk.command({ type: "session.stop", sessionId: fixture.sessionId }); await fixture.terminal();
    const stopped = (await sdk.activity.list(fixture.sessionId)).activity.entries.find((entry) => entry.id === question.id)!;
    assert.notEqual(stopped.status, "completed");
    await fixture.send("generated structured question again"); await waitFor(() => fixture.session().pendingQuestionId);
    const pending = await waitFor(() => sdk.getState().snapshot!.questions.find((entry) => entry.id === fixture.session().pendingQuestionId));
    const actual = (await sdk.activity.list(fixture.sessionId)).activity.entries.findLast((entry) => entry.kind === "ask-user")!;
    await sdk.questions.answer(pending.id, pending.choices[0]!, pending.revision); await fixture.terminal();
    const answered = (await sdk.activity.list(fixture.sessionId)).activity.entries.find((entry) => entry.id === actual.id)!;
    assert.equal(answered.status, "completed");
    const result = JSON.parse((await sdk.activity.read(fixture.sessionId, actual.id, "output")).content!.text);
    assert.equal(result.actor, "user"); assert.equal(result.answer, pending.choices[0]); assert.equal(result.permissionGrant, false);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("explicit skill loading records actual user provenance and retains exact independently granted source", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const path = join(fixture.project, "SKILL.md"), content = "---\nname: generated-activity\ndescription: Generated source\n---\nUse generated exact bytes.\n";
    await writeFile(path, content);
    const imported = await sdk.capabilities.importSkill(fixture.session().projectId!, path);
    await sdk.capabilities.toggle(imported.id!, true, 0);
    const skill = sdk.getState().snapshot!.registry.find((entry) => entry.id === imported.id)!;
    await sdk.capabilities.useSkill(fixture.sessionId, skill.id, skill.contentDigest);
    const loaded = (await sdk.activity.list(fixture.sessionId)).activity.entries.find((entry) => entry.kind === "load-skill")!;
    assert.equal(loaded.actor, "user"); assert.equal(loaded.turnId, null); assert.equal(loaded.status, "completed");
    assert.equal(loaded.outputBytes, Buffer.byteLength(content));
    assert.equal((await sdk.activity.read(fixture.sessionId, loaded.id, "output")).content?.text, content);
    await writeFile(path, "Generated changed source.");
    assert.equal((await sdk.activity.read(fixture.sessionId, loaded.id, "output")).content?.text, content);
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("failed skill selection rolls back both the draft and session source grant, then retained bytes survive restart without replay", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  let restarted: Awaited<ReturnType<typeof startService>> | undefined, peer: MoguriSdk | undefined;
  try {
    const path = join(fixture.project, "SKILL.md"), content = "---\nname: generated-atomic-skill\ndescription: Generated atomic source\n---\nGenerated immutable source.\n";
    await writeFile(path, content);
    const imported = await sdk.capabilities.importSkill(fixture.session().projectId, path);
    await sdk.capabilities.toggle(imported.id!, true, 0);
    const skill = sdk.getState().snapshot!.registry.find((entry) => entry.id === imported.id)!;
    const draft = structuredClone(fixture.session().draft), grants = fixture.service.store.db.prepare("SELECT digest,scope,payload FROM blob_payloads ORDER BY digest,scope").all();
    fixture.service.store.db.exec(`CREATE TRIGGER generated_skill_failure BEFORE INSERT ON events
      WHEN json_extract(NEW.data,'$.event_type')='skill.used' BEGIN SELECT RAISE(ABORT,'Generated atomic skill failure'); END;`);
    await assert.rejects(() => sdk.capabilities.useSkill(fixture.sessionId, skill.id, skill.contentDigest), /no success was recorded/);
    assert.deepEqual(fixture.session().draft, draft);
    assert.deepEqual(fixture.service.store.db.prepare("SELECT digest,scope,payload FROM blob_payloads ORDER BY digest,scope").all(), grants);
    assert.deepEqual((await sdk.activity.list(fixture.sessionId)).activity.entries, []);
    fixture.service.store.db.exec("DROP TRIGGER generated_skill_failure");
    await sdk.capabilities.useSkill(fixture.sessionId, skill.id, skill.contentDigest);
    const loaded = (await sdk.activity.list(fixture.sessionId)).activity.entries[0]!;
    sdk.disconnect(); await fixture.service.close();
    restarted = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey });
    peer = await new MoguriSdk(restarted.connection).ready();
    assert.equal((await peer.activity.read(fixture.sessionId, loaded.id, "output")).content?.text, content);
    assert.equal((await peer.activity.list(fixture.sessionId)).activity.entries.length, 1);
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); peer?.disconnect(); await restarted?.close(); await fixture.close(); }
});

test("schema-44 upgrades preserve existing ciphertext, receipts and scoped activity across a real reopen", async () => {
  const fixture = await setupFixture(); let store: EventStore | undefined, restarted: Awaited<ReturnType<typeof startService>> | undefined, peer: MoguriSdk | undefined;
  try {
    const sdk = await new MoguriSdk(fixture.service.connection).ready();
    try { await sdk.sessions.rename(fixture.sessionId, "Generated preserved activity"); } finally { sdk.disconnect(); }
    const before = retainedCiphertextRows(fixture.service.store.db), database = fixture.service.store.path;
    await writeLegacyState(fixture.service, 44);
    store = new EventStore(database, fixture.retentionKey);
    assert.equal(store.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
    assert.deepEqual(retainedCiphertextRows(store.db), before);
    store.close(); store = undefined;
    restarted = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey });
    peer = await new MoguriSdk(restarted.connection).ready();
    assert.equal(peer.getState().snapshot!.sessions[0]?.title, "Generated preserved activity");
    assert.deepEqual((await peer.activity.list(fixture.sessionId)).activity.entries, []);
  } finally { peer?.disconnect(); store?.close(); await restarted?.close(); await fixture.close(); }
});
