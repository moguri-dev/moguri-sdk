import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DraftEditor, MoguriSdk, isRecord } from "../packages/sdk/src/index.ts";
import { reviewNativeTools, setupFixture, waitFor } from "./fixture.ts";

const mac = { skip: process.platform !== "darwin", timeout: 20_000 };
test("held queue admission is explicit even when idle or no model is configured", mac, async () => {
  const fixture = await setupFixture();
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  const draft = new DraftEditor(sdk, fixture.sessionId, fixture.session().draft);
  try {
    draft.edit("generated held question"); await draft.send("queue", true);
    assert.equal(fixture.requests.length, 0);
    assert.equal(fixture.session().queue[0]?.held, true);
    await assert.rejects(() => sdk.prompts.release(fixture.sessionId, fixture.session().queue[0]!.id, fixture.session().queueRevision), /model/i);
    await fixture.configure();
    await sdk.prompts.release(fixture.sessionId, fixture.session().queue[0]!.id, fixture.session().queueRevision);
    assert.equal((await fixture.terminal()).status, "completed");
    assert.equal(fixture.requests.length, 1);
    const prompt = fixture.session().messages.find((message) => message.role === "user")!;
    assert.equal(sdk.prompts.text(fixture.sessionId, prompt.id), "generated held question");
  } finally { draft.dispose(); sdk.disconnect(); await fixture.close(); }
});
test("read-only mode disables edit/shell/MCP tools and rejects an undeclared write even from model output", mac, async () => {
  const fixture = await setupFixture();
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.configure();
    await sdk.refresh();
    await sdk.slash(fixture.sessionId, "/read-only", "desktop");
    await fixture.send("generated forbidden write");
    assert.equal((await fixture.terminal()).status, "completed");
    assert.equal(existsSync(join(fixture.project, "forbidden.txt")), false);
    assert.equal(fixture.service.controller.events(0).some((event) => event.event_type === "tool.started"), false);
    const declared = fixture.requests[0]?.tools;
    assert.ok(Array.isArray(declared));
    const names = declared.map((tool: unknown) => {
      assert.ok(isRecord(tool) && isRecord(tool.function) && typeof tool.function.name === "string");
      return tool.function.name;
    });
    assert.equal(names.includes("write_file"), false);
    assert.equal(names.includes("run_command"), false);
    assert.equal(names.includes("mcp_gateway"), false);
    assert.equal(names.includes("discover_tools"), true);
    const catalog = await sdk.tools.catalog(fixture.sessionId, "read_agent_terminal");
    assert.equal(catalog.type, "tooling.catalog");
    if (catalog.type === "tooling.catalog") assert.ok(catalog.tools.some((tool) => tool.name === "read_agent_terminal"));
    await sdk.slash(fixture.sessionId, "/agent", "tui");
    assert.equal(fixture.session().mode, "agent");
    await sdk.slash(fixture.sessionId, "/rename Generated renamed session", "desktop");
    assert.equal(fixture.session().title, "Generated renamed session");
  } finally { sdk.disconnect(); await fixture.close(); }
});
test("a pending mode restriction invalidates approval and settles at a safe boundary", mac, async () => {
  const fixture = await setupFixture();
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await reviewNativeTools(fixture, ["read_file"]);
    await fixture.configure(); await fixture.send("generated tool task");
    const approval = await waitFor(() => fixture.session().pendingApproval);
    await sdk.sessions.mode(fixture.sessionId, "read-only");
    await assert.rejects(() => sdk.command({ type: "approval.respond", sessionId: fixture.sessionId, approvalId: approval.id, allow: true }), /expired|cancel|already/);
    await fixture.terminal();
    assert.equal(fixture.session().mode, "read-only");
    assert.equal(fixture.session().pendingMode, null);
    assert.equal(fixture.service.controller.events(0).some((event) => event.event_type === "tool.started"), false);
  } finally { sdk.disconnect(); await fixture.close(); }
});
test("side context runs in parallel without edit authority and explicit nested sessions do not require model-subagent opt-in", mac, async () => {
  const fixture = await setupFixture();
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.configure(); await fixture.send("generated slow parent context");
    await waitFor(() => fixture.requests.length === 1);
    const side = await sdk.sessions.spawn(fixture.sessionId, "side");
    const session = sdk.getState().snapshot!.sessions.find((session) => session.id === side.id)!;
    assert.equal(session.kind, "side"); assert.equal(session.mode, "read-only");
    const draft = new DraftEditor(sdk, session.id, session.draft);
    try { draft.edit("generated parallel question"); await draft.send("queue"); } finally { draft.dispose(); }
    await waitFor(() => fixture.service.controller.snapshot().sessions.find((session) => session.id === side.id)?.status === "completed");
    assert.equal(fixture.session().status, "running");
    assert.match(JSON.stringify(fixture.requests[1]?.messages), /generated slow parent context/);
    assert.doesNotMatch(JSON.stringify(fixture.requests[1]?.messages), /parent-session-reference/);
    const captured = await sdk.coordination.read(side.id!, { action: "snapshot" });
    assert.match(JSON.stringify(captured), /generated slow parent context/);
    assert.equal(fixture.service.controller.snapshot().sessions.find((session) => session.id === side.id)?.usage[0]?.role, "side");
    await assert.rejects(() => sdk.sessions.mode(side.id!, "agent"), /question-only|Question-only/);
    const nested = await sdk.sessions.spawn(fixture.sessionId, "agent");
    assert.equal(sdk.getState().snapshot!.sessions.find((session) => session.id === nested.id)?.parentSessionId, fixture.sessionId);
    await assert.rejects(() => sdk.sessions.organize(fixture.sessionId, { parentSessionId: nested.id! }), /Stop|acyclic/);
    await sdk.command({ type: "session.stop", sessionId: fixture.sessionId }); await fixture.terminal();
    await assert.rejects(() => sdk.sessions.organize(fixture.sessionId, { parentSessionId: nested.id! }), /acyclic/);
    await sdk.sessions.organize(nested.id!, { parentSessionId: null, pinned: true, unread: true }, undefined, true);
    assert.equal(sdk.getState().snapshot!.sessions.find((session) => session.id === nested.id)?.pinned, true);
  } finally { sdk.disconnect(); await fixture.close(); }
});
test("session deletion destroys its retained payloads but preserves project artifacts and never deletes repository files", async () => {
  const fixture = await setupFixture();
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const projectId = fixture.session().projectId;
    await mkdir(join(fixture.project, "docs"));
    await writeFile(join(fixture.project, "docs", "plan.md"), "Generated independently retained plan.");
    const artifact = await sdk.plans.capture(fixture.sessionId);
    await sdk.command({ type: "draft.save", sessionId: fixture.sessionId, expectedRevision: 0, text: "Generated uniquely deleted draft value", attachments: [] });
    const rawBefore = Number(fixture.service.store.db.prepare("SELECT count(*) AS total FROM events").get()?.total);
    await sdk.sessions.delete(fixture.sessionId, true);
    assert.equal(sdk.getState().snapshot!.sessions.length, 0);
    assert.equal((await sdk.plans.artifact(artifact.id!)).text, "Generated independently retained plan.");
    assert.equal(JSON.stringify(fixture.service.controller.events(0)).includes("Generated uniquely deleted draft value"), false);
    assert.ok(Number(fixture.service.store.db.prepare("SELECT count(*) AS total FROM events").get()?.total) > rawBefore);
    assert.throws(() => fixture.service.store.db.exec("DELETE FROM events"), /append-only/);
    assert.equal(await readFile(join(fixture.project, "fixture.txt"), "utf8"), "generated original\n");
    const removal = (await sdk.artifacts.projectPreview(projectId)).preview;
    await sdk.projects.remove(projectId, true, 0, { action: "delete", expectedDigest: removal.digest });
    assert.equal(sdk.getState().snapshot!.projects.length, 0);
    await assert.rejects(() => sdk.plans.artifact(artifact.id!), /outside|missing/);
    assert.equal(existsSync(join(fixture.project, "docs", "plan.md")), true);
  } finally { sdk.disconnect(); await fixture.close(); }
});
test("Ghostty transport owns PTYs and never persists terminal input/output or its command hashes", mac, async () => {
  const fixture = await setupFixture({ platform: { terminal: { executable: "/bin/sh", args: ["-c", "printf 'GENERATED_TERMINAL_READY\\n'; exec cat"] } } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const terminal = await sdk.terminal.open(fixture.sessionId, 80, 24);
    await waitFor(() => sdk.getState().snapshot?.terminals.some((entry) => entry.id === terminal.id));
    let output = "";
    for (let index = 0; index < 50 && !output.includes("GENERATED_TERMINAL_READY"); index++) {
      output = (await sdk.terminal.read(terminal.id!)).data;
      if (!output.includes("GENERATED_TERMINAL_READY")) await new Promise((resolve) => setTimeout(resolve, 15));
    }
    assert.match(output, /GENERATED_TERMINAL_READY/);
    const receipts = Number(fixture.service.store.db.prepare("SELECT count(*) AS total FROM receipts").get()?.total);
    await sdk.terminal.input(terminal.id!, "GENERATED_PRIVATE_TERMINAL_INPUT\n");
    await sdk.terminal.resize(terminal.id!, 100, 32);
    assert.equal(Number(fixture.service.store.db.prepare("SELECT count(*) AS total FROM receipts").get()?.total), receipts);
    assert.equal(JSON.stringify(fixture.service.controller.events(0)).includes("GENERATED_PRIVATE_TERMINAL_INPUT"), false);
    assert.equal(JSON.stringify(fixture.service.controller.events(0)).includes("GENERATED_TERMINAL_READY"), false);
    await sdk.terminal.close(terminal.id!);
    assert.equal(sdk.getState().snapshot!.terminals.find((entry) => entry.id === terminal.id)?.status, "closed");
    await assert.rejects(() => sdk.terminal.input(terminal.id!, "not replayed"), /not running/);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("terminal paging makes Unicode progress and retains at most 128 KiB of actual UTF-8 output", mac, async () => {
  const fixture = await setupFixture({ platform: { terminal: { executable: process.execPath, args: ["-e", "process.stdout.write('\\u{1f600}'.repeat(40000)+'GENERATED_UTF8_READY\\n');process.stdin.resume();"] } } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const terminal = await sdk.terminal.open(fixture.sessionId);
    let result = await sdk.terminal.read(terminal.id!);
    let text = "";
    for (let index = 0; index < 100; index++) {
      result = await sdk.terminal.read(terminal.id!);
      text = result.data + (await sdk.terminal.read(terminal.id!, result.nextOffset)).data;
      if (text.includes("GENERATED_UTF8_READY")) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.match(text, /GENERATED_UTF8_READY/);
    result = await sdk.terminal.read(terminal.id!);
    text = result.data + (await sdk.terminal.read(terminal.id!, result.nextOffset)).data;
    assert.ok(result.baseOffset > 0);
    assert.ok(Buffer.byteLength(text) <= 128 * 1024);
    const page = await sdk.terminal.read(terminal.id!, result.baseOffset, 1);
    assert.equal(page.data, "\u{1f600}");
    assert.equal(page.nextOffset, result.baseOffset + 2);
    await assert.rejects(() => sdk.terminal.input(terminal.id!, ""), /at least one/);
    await sdk.terminal.close(terminal.id!);
  } finally { sdk.disconnect(); await fixture.close(); }
});
