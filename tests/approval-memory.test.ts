import assert from "node:assert/strict";
import test from "node:test";
import { commandFamily, defaultSettings, resolveControls, type ToolCall } from "../packages/protocol/src/index.ts";
import { authorizeTool, rememberToolApproval } from "../apps/service/src/permissions.ts";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { setupFixture, waitFor } from "./fixture.ts";

test("Autopilot and Max automatically approve commands and exact MCP calls without weakening hard policy", () => {
  const settings = defaultSettings();
  const command = { id: "generated-command", name: "run_command", arguments: { command: "npm test" } };
  const mcp = { id: "generated-mcp", name: "mcp_gateway", arguments: { action: "call", serverId: "generated", tool: "inspect", schemaDigest: "a".repeat(64) } };
  for (const autonomy of ["Autopilot", "Autopilot Max"] as const) {
    const context = { sessionId: "generated-session", projectId: "generated-project", env: "Local" as const, autonomy, automaticApprovals: true, mcpBinding: "b".repeat(64) };
    assert.equal(authorizeTool(settings, command, "/generated", context).decision, "allow");
    assert.equal(authorizeTool(settings, mcp, "/generated", context).decision, "allow");
    assert.equal(authorizeTool(settings, command, null, context).decision, "deny");
    settings.permissions.commands = [{ id: "generated-deny", command: "npm test", decision: "deny" }];
    assert.equal(authorizeTool(settings, command, "/generated", context).decision, "deny");
    settings.permissions.commands = [];
    settings.permissions.tools = [{ id: "generated-mcp-deny", tool: "mcp_gateway", pathPrefix: "", decision: "deny" }];
    assert.equal(authorizeTool(settings, mcp, "/generated", context).decision, "deny");
    settings.permissions.tools = [];
  }
  assert.equal(authorizeTool(settings, command, "/generated").decision, "ask");
  const defaults = resolveControls([{ source: "global", values: { autonomy: "Autopilot", automaticApprovals: true } },
    { source: "project", values: { autonomy: "Guided" } }], { settingsRevision: 1, projectRevision: 1 });
  assert.equal(defaults.controls.automaticApprovals, undefined);
  assert.equal(defaults.defaults.sources.automaticApprovals, undefined);
});

test("command families never absorb shell composition, wrappers, substitutions or another scope/environment", () => {
  const context = { sessionId: "generated-session", projectId: "generated-project", env: "Local" as const, autonomy: "Manual" as const };
  const command: ToolCall = { id: "generated-call", name: "run_command", arguments: { command: "npm test" } };
  const settings = rememberToolApproval(defaultSettings(), command, context, { scope: "project", match: "family" }, "generated-family");
  for (const text of ["npm test", "npm run build -- --generated", "npm 'generated file'"]) {
    assert.equal(authorizeTool(settings, { ...command, arguments: { command: text } }, "/generated", context).decision, "allow");
  }
  for (const text of ["npm test && printf generated", "npm test; printf generated", "npm test\nprintf generated", "npm $(printf generated)", "npm `printf generated`", "npm test > generated", "env npm test", "sh -c 'npm test'", "/usr/bin/npm test"]) {
    assert.equal(commandFamily(text), null);
    assert.equal(authorizeTool(settings, { ...command, arguments: { command: text } }, "/generated", context).decision, "ask");
  }
  assert.equal(authorizeTool(settings, command, "/generated", { ...context, projectId: "generated-other" }).decision, "ask");
  assert.equal(authorizeTool(settings, command, "/generated", { ...context, env: "Remote" }).decision, "ask");
  const scoped = rememberToolApproval(defaultSettings(), command, context, { scope: "session", match: "exact" }, "generated-session-grant");
  assert.equal(authorizeTool(scoped, command, "/generated", { ...context, sessionId: "generated-other" }).decision, "ask");
  const global = rememberToolApproval(defaultSettings(), command, context, { scope: "global", match: "exact" }, "generated-global");
  assert.equal(authorizeTool(global, command, "/generated", { ...context, projectId: "generated-other" }).decision, "allow");
  assert.equal(authorizeTool(defaultSettings(), command, "/generated", context).decision, "ask");
  settings.permissions.commands.push({ id: "generated-hard-deny", command: "npm test", decision: "deny" });
  assert.equal(authorizeTool(settings, command, "/generated", context).decision, "deny");
});

test("remembered MCP tools bind exact server configuration and schema but intentionally allow new tool arguments", () => {
  const context = { sessionId: "generated-session", projectId: null, env: "Local" as const, autonomy: "Manual" as const, mcpBinding: "a".repeat(64) };
  const call: ToolCall = { id: "generated-mcp", name: "mcp_gateway", arguments: { action: "call", serverId: "generated-server", tool: "generated-tool", schemaDigest: "b".repeat(64), arguments: { text: "generated first" } } };
  const settings = rememberToolApproval(defaultSettings(), call, context, { scope: "global", match: "exact" }, "generated-mcp-grant");
  assert.equal(authorizeTool(settings, { ...call, arguments: { ...call.arguments, arguments: { text: "generated second" } } }, null, context).decision, "allow");
  assert.equal(authorizeTool(settings, { ...call, arguments: { ...call.arguments, tool: "generated-other" } }, null, context).decision, "ask");
  assert.equal(authorizeTool(settings, { ...call, arguments: { ...call.arguments, schemaDigest: "c".repeat(64) } }, null, context).decision, "ask");
  assert.equal(authorizeTool(settings, call, null, { ...context, mcpBinding: "d".repeat(64) }).decision, "ask");
  assert.throws(() => rememberToolApproval(settings, call, context, { scope: "project", match: "exact" }, "generated-invalid"), { code: "approval_project" });
});

test("an explicitly remembered named tool permits new arguments only inside its original scope and hard policy", () => {
  const context = { sessionId: "generated-session", projectId: "generated-project", env: "Local" as const, autonomy: "Manual" as const };
  const call: ToolCall = { id: "generated-read", name: "read_file", arguments: { path: "first.txt" } };
  const settings = rememberToolApproval(defaultSettings(), call, context, { scope: "project", match: "tool" }, "generated-whole-tool");
  const other = { ...call, arguments: { path: "second.txt" } };
  assert.equal(authorizeTool(settings, other, "/generated", context).decision, "allow");
  assert.equal(authorizeTool(settings, other, "/generated", { ...context, projectId: "generated-other" }).decision, "ask");
  assert.equal(authorizeTool(settings, other, "/generated", { ...context, env: "Remote" }).decision, "ask");
  settings.permissions.tools.push({ id: "generated-deny", tool: "read_file", pathPrefix: "", decision: "deny" });
  assert.equal(authorizeTool(settings, other, "/generated", context).decision, "deny");
  assert.throws(() => rememberToolApproval(defaultSettings(), { ...call, name: "run_command", arguments: { command: "printf generated" } }, context,
    { scope: "global", match: "tool" }, "generated-invalid"), /exact command|family/i);
});

test("explicit Autopilot runs ungranted commands across turns and records autonomy, never a fabricated human approval", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture({ toolCall: { name: "run_command", args: { command: "printf 'Generated automatic command\\n'", timeoutMs: 2000 } } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.configure(); await sdk.refresh(); await sdk.sessions.autonomy(fixture.sessionId, "Autopilot");
    for (const text of ["Generated automatic first turn", "Generated automatic second turn"]) {
      await fixture.send(text); assert.equal((await fixture.terminal()).status, "completed");
      assert.equal(fixture.session().pendingApproval, null);
    }
    const decisions = fixture.service.controller.events(0).filter((event) => event.event_type === "tool.decided");
    assert.equal(decisions.length, 2); assert.ok(decisions.every((event) => event.event_type === "tool.decided" && event.payload.actor === "autonomy"));
    assert.deepEqual(sdk.settings.get()!.values.permissions.tools, []);
    assert.match(JSON.stringify(fixture.requests[0]?.messages), /Automatic tool approvals are enabled by the user/);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("an explicit generic Autopilot selection enables real tool approvals without requiring the SDK convenience method", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture({ toolCall: { name: "run_command", args: { command: "printf 'Generated selected autopilot\\n'", timeoutMs: 2000 } } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.configure();
    await sdk.sessions.configure(fixture.sessionId, { ...fixture.session().controls, autonomy: "Autopilot" }, fixture.session().revision);
    await fixture.send("Generated explicit automatic tool.");
    await waitFor(() => fixture.session().pendingApproval || fixture.session().status === "completed");
    assert.equal(fixture.session().pendingApproval, null);
    assert.equal((await fixture.terminal()).status, "completed");
    assert.equal(fixture.session().controls.automaticApprovals, true);
    const created = resolveControls([{ source: "session", values: { autonomy: "Autopilot" } }], { settingsRevision: 0, projectRevision: null });
    assert.equal(created.controls.automaticApprovals, true);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("a stopped pending action cannot create a remembered grant or execute late", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.configure(); await fixture.send("generated tool cancelled approval");
    const pending = await waitFor(() => fixture.session().pendingApproval);
    await sdk.command({ type: "session.stop", sessionId: fixture.sessionId }); await fixture.terminal();
    await assert.rejects(() => sdk.approvals.respond(fixture.sessionId, pending.id, true, { scope: "global", match: "exact" }), { code: "approval_stale" });
    await sdk.refresh(); assert.deepEqual(sdk.approvals.list(), []);
    assert.equal(fixture.service.controller.events(0).some((event) => event.event_type === "tool.started"), false);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("a remembered Local MCP tool runs with new arguments without another approval or model call", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const tool = (await sdk.mcp.tools("builtin", "grep", 0, fixture.sessionId)).tools.find((tool) => tool.name === "grep_logs")!;
    const first = await sdk.mcp.call(fixture.sessionId, "builtin", tool.name, { path: "fixture.txt", query: "original" }, tool.digest);
    const approval = fixture.session().pendingApproval; assert.ok(approval);
    await sdk.approvals.respond(fixture.sessionId, approval.id, true, { scope: "project", match: "exact" });
    assert.equal((await sdk.jobs.wait(first.id!)).status, "completed");
    const second = await sdk.mcp.call(fixture.sessionId, "builtin", tool.name, { path: "fixture.txt", query: "generated" }, tool.digest);
    assert.equal((await sdk.jobs.wait(second.id!)).status, "completed");
    assert.equal(fixture.requests.length, 0);
    await sdk.approvals.revoke(sdk.approvals.list()[0]!.id);
    const third = await sdk.mcp.call(fixture.sessionId, "builtin", tool.name, { path: "fixture.txt", query: "original" }, tool.digest);
    assert.ok(fixture.session().pendingApproval); await fixture.approve(false);
    assert.equal((await sdk.jobs.wait(third.id!)).status, "cancelled");
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("remembering a pending approval is atomic, shared across clients and used by later turns", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture();
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  const other = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.configure();
    await fixture.send("generated tool task");
    const approval = await waitFor(() => fixture.session().pendingApproval);
    const answers = await Promise.allSettled([
      sdk.approvals.respond(fixture.sessionId, approval.id, true, { scope: "project", match: "exact" }),
      other.approvals.respond(fixture.sessionId, approval.id, true, { scope: "global", match: "exact" }),
    ]);
    assert.equal(answers.filter((answer) => answer.status === "fulfilled").length, 1);
    await fixture.terminal(); await sdk.refresh(); await other.refresh();
    const grants = sdk.settings.get()!.values.permissions.remembered!;
    assert.equal(grants.length, 1);
    assert.deepEqual(other.settings.get()!.values.permissions.remembered, grants);
    await fixture.send("generated tool task again");
    assert.equal((await fixture.terminal()).status, "completed");
    const events = fixture.service.controller.events(0);
    assert.ok(events.some((event) => event.event_type === "tool.decided" && event.payload.actor === "delegation" && event.payload.ruleId === grants[0]!.id));
  } finally { sdk.disconnect(); other.disconnect(); await fixture.close(); }
});
