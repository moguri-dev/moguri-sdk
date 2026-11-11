import assert from "node:assert/strict";
import test from "node:test";
import { MoguriSdk, projectEvents } from "../packages/sdk/src/index.ts";
import { setupFixture, waitFor } from "./fixture.ts";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

test("confirmed native deadline cleanup keeps the solver and later tool execution running while retaining the original partial result", { skip: process.platform !== "darwin" }, async () => {
  const f = await setupFixture({ respond: (_request, index) => index === 1 ?
    { tool: { name: "run_command", args: { command: "printf GENERATED_PARTIAL; sleep 30", timeoutMs: 1000 } } } :
    index === 2 ? { tool: { name: "run_command", args: { command: "printf GENERATED_AFTER_PARTIAL", timeoutMs: 2000 } } } :
      { text: "Generated recovery inspected the original deadline and confirmed stopped group, then completed the later command." } });
  const sdk = await new MoguriSdk(f.service.connection).ready();
  try {
    await f.configure(); await sdk.sessions.autonomy(f.sessionId, "Autopilot", f.session().revision);
    await f.send("Generated recoverable partial command.");
    assert.equal((await f.terminal()).status, "completed");
    const results = f.service.controller.events(0).filter((event) => event.event_type === "tool.completed" && event.payload.call.name === "run_command");
    assert.equal(results.length, 2);
    assert.ok(results[0]?.event_type === "tool.completed" && results[1]?.event_type === "tool.completed");
    assert.equal(results[0].payload.outcome, "partial");
    assert.equal(results[0].payload.cleanupConfirmed, true);
    assert.equal(results[1].payload.outcome, "completed");
    assert.match(results[1].payload.text, /GENERATED_AFTER_PARTIAL/);
    assert.equal(f.requests.length, 3);
    assert.equal(f.service.controller.events(0).some((event) => event.event_type === "turn.recovery_entered"), false);
    const events = f.service.controller.events(0);
    assert.throws(() => projectEvents(events.filter((event) => event.event_type !== "process.started")), /actual started Local process/i);
    assert.throws(() => projectEvents(events.map((event) => event.event_type === "tool.completed" && event.payload.cleanupConfirmed ?
      { ...event, payload: { ...event.payload, call: { ...event.payload.call, name: "mcp_gateway" } } } : event)), /Opaque tool output|actual started Local process/i);
  } finally { sdk.disconnect(); await f.close(); }
});

test("unconfirmed MCP effects keep the model inspecting read-only, deny a later process and never replay the original call", { skip: process.platform !== "darwin" }, async () => {
  let digest = "";
  const f = await setupFixture({ respond: (_request, index) => index === 1 ?
    { tool: { name: "mcp_gateway", args: { action: "call", serverId: "generated-drop", tool: "echo", schemaDigest: digest, arguments: { text: "Generated original effect." } } } } :
    index === 2 ? { tool: { name: "run_command", args: { command: "printf GENERATED_FORBIDDEN_RECOVERY", timeoutMs: 2000 } } } :
    index === 3 ? { tool: { name: "read_file", args: { path: "fixture.txt" } } } :
      { text: "Generated read-only recovery inspected the source; original MCP effects remain unconfirmed." } });
  const sdk = await new MoguriSdk(f.service.connection).ready(), marker = join(f.directory, "generated-call-marker");
  try {
    await f.configure(); await sdk.refresh();
    const settings = sdk.settings.get()!;
    await sdk.settings.update({ ...settings.values, mcpServers: [{ id: "generated-drop", name: "Generated dropped call", enabled: true,
      transport: { type: "stdio", command: process.execPath, args: [resolve("tests/fixtures/mcp-echo.mjs"), "--drop-call", "--call-marker", marker] } }] }, settings.revision);
    digest = (await sdk.mcp.tools("generated-drop", "", 0, f.sessionId)).tools[0]!.digest;
    await sdk.sessions.autonomy(f.sessionId, "Autopilot", f.session().revision);
    await f.send("Generated unconfirmed MCP recovery.");
    assert.equal((await f.terminal()).status, "partial");
    const events = f.service.controller.events(0);
    assert.equal(events.filter((event) => event.event_type === "turn.recovery_entered").length, 1);
    assert.ok(events.some((event) => event.event_type === "tool.completed" && event.payload.call.name === "run_command" && event.payload.outcome === "denied"));
    assert.equal(events.some((event) => event.event_type === "tool.started" && event.payload.call.name === "run_command"), false);
    assert.ok(events.some((event) => event.event_type === "tool.completed" && event.payload.call.name === "read_file" && event.payload.outcome === "completed"));
    assert.equal(f.requests.length, 4);
    assert.equal(await readFile(marker, "utf8"), "generated call\n");
    assert.equal(f.service.controller.snapshot().blockedProjects.includes(f.session().projectId), true);
  } finally { sdk.disconnect(); await f.close(); }
});

test("actual Stop still cancels a running command and cannot use cleanup confirmation to start another model", { skip: process.platform !== "darwin" }, async () => {
  const f = await setupFixture({ toolCall: { name: "run_command", args: { command: "printf GENERATED_STARTED; sleep 30", timeoutMs: 30_000 } } });
  const sdk = await new MoguriSdk(f.service.connection).ready();
  try {
    await f.configure(); await sdk.sessions.autonomy(f.sessionId, "Autopilot", f.session().revision);
    await f.send("Generated actual cancellation.");
    await waitFor(() => f.service.controller.events(0).some((event) => event.event_type === "process.started"));
    await sdk.command({ type: "session.stop", sessionId: f.sessionId });
    assert.equal((await f.terminal()).status, "partial");
    assert.equal(f.requests.length, 1);
  } finally { sdk.disconnect(); await f.close(); }
});

test("a project-free Home writer's wider uncertainty remains read-only and partial even when its native process group stopped", { skip: process.platform !== "darwin" }, async () => {
  const f = await setupFixture({ respond: (_request, index) => index === 1 ?
    { tool: { name: "run_command", args: { command: "printf GENERATED_HOME_PARTIAL; sleep 30", timeoutMs: 1000 } } } :
    index === 2 ? { tool: { name: "read_file", args: { path: "generated-inspection.txt" } } } :
      { text: "Generated Home recovery inspected the source without authorizing another write." } });
  const sdk = await new MoguriSdk(f.service.connection).ready();
  try {
    await writeFile(join(f.home, "generated-inspection.txt"), "Generated private Home fixture only.\n");
    const created = await sdk.sessions.create(null, "Generated Home recovery", { modelId: f.modelId }), id = created.id!;
    await sdk.sessions.autonomy(id, "Autopilot");
    const saved = await sdk.command({ type: "draft.save", sessionId: id, expectedRevision: 0, text: "Generated Home partial command.", attachments: [] });
    await sdk.command({ type: "message.send", sessionId: id, expectedRevision: saved.revision!, delivery: "queue" });
    await waitFor(() => sdk.sessions.get(id)?.status === "partial");
    const events = f.service.controller.events(0).filter((event) => event.session_id === id);
    assert.ok(events.some((event) => event.event_type === "tool.completed" && event.payload.cleanupConfirmed === true));
    assert.equal(events.filter((event) => event.event_type === "turn.recovery_entered").length, 1);
    assert.ok(events.some((event) => event.event_type === "tool.completed" && event.payload.call.name === "read_file" && event.payload.outcome === "completed"));
    assert.equal(f.requests.length, 3);
  } finally { sdk.disconnect(); await f.close(); }
});
