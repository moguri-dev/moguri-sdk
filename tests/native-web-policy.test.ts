import assert from "node:assert/strict";
import test from "node:test";
import { canonicalWebSite, defaultSettings, effectiveWebAllowances, webAccessAllows, webSiteMatches, type ToolCall, type WebAllowance } from "../packages/protocol/src/index.ts";
import { authorizeTool, validateSettings } from "../apps/service/src/permissions.ts";

test("factory Manual and Guided authorize native reads, searches, queries and edits without human or model approval", () => {
  const settings = defaultSettings();
  for (const autonomy of ["Manual", "Guided"] as const) {
    const context = { sessionId: "generated-session", projectId: "generated-project", env: "Local" as const, autonomy };
    for (const name of ["read_file", "list_files", "find_files", "search_files", "edit_file", "write_file", "query_data",
      "sqlite_query", "sqlite_transaction", "inspect_document", "write_document", "edit_document", "discover_tools", "read_tool_result",
      "read_agent_terminal", "read_command_job", "list_documents", "read_document", "search_document", "query_state", "mutate_state", "clock"]) {
      const decision = authorizeTool(settings, { id: "generated-native", name, arguments: { path: "generated.txt" } }, "/generated", context);
      assert.equal(decision.decision, "allow", name); assert.equal(decision.actor, "policy", name);
    }
    const script: ToolCall = { id: "generated-script", name: "run_command", arguments: { command: "node generated.mjs" } };
    assert.equal(authorizeTool(settings, script, "/generated", context).decision, "ask");
    assert.equal(authorizeTool(settings, { ...script, arguments: { command: "pwd; node generated.mjs" } }, "/generated", context).decision, "ask");
    assert.equal(authorizeTool(settings, { id: "generated-web", name: "web_fetch", arguments: { url: "https://example.invalid/" } }, "/generated", context).decision, "ask");
  }
});

test("Local website grants use exact session/project/profile scope, scheme and port without enabling Remote", () => {
  const context = { sessionId: "generated-session", projectId: "generated-project", env: "Local" as const, autonomy: "Manual" as const };
  const entries: WebAllowance[] = [
    { id: "generated-global", scope: { kind: "global" }, site: "global.example.invalid" },
    { id: "generated-project", scope: { kind: "project", projectId: context.projectId }, site: "project.example.invalid" },
    { id: "generated-session", scope: { kind: "session", sessionId: context.sessionId }, site: "http://127.0.0.1:41234" },
  ];
  assert.equal(effectiveWebAllowances(entries, context).length, 3);
  assert.equal(effectiveWebAllowances(entries, { ...context, projectId: null, sessionId: "generated-other" }).length, 1);
  assert.equal(effectiveWebAllowances(entries, { ...context, env: "Remote" }).length, 0);
  assert.equal(effectiveWebAllowances(entries, { ...context, env: "Sandbox" }).length, 0);
  assert.equal(canonicalWebSite(" HTTPS://Example.Invalid:443/ "), "https://example.invalid");
  assert.equal(canonicalWebSite("Example.Invalid"), "example.invalid");
  for (const site of ["*", "*.example.invalid", "https://user:password@example.invalid", "example.invalid/path",
    "https://example.invalid?query", "https://example.invalid/#fragment", "https://example.invalid/#", "https://example.invalid/a/..",
    "https://%65xample.invalid", "https://@example.invalid", "http://example.invalid", "example.invalid:8000", "127.1", "https://example.invalid\\@127.0.0.1"]) {
    assert.throws(() => canonicalWebSite(site), { code: "web_allowlist_site" }, site);
  }
  assert.equal(webSiteMatches("example.invalid", "https://example.invalid/path"), true);
  assert.equal(webSiteMatches("example.invalid", "https://sub.example.invalid/path"), false);
  assert.equal(webSiteMatches("example.invalid", "https://example.invalid:444/path"), false);
  assert.equal(webSiteMatches("http://127.0.0.1:41234", "http://127.0.0.1:41235/path"), false);
  const settings = defaultSettings(); settings.permissions.webAllowlist = entries;
  for (const entry of entries) {
    const url = entry.site.includes("://") ? `${entry.site}/generated` : `https://${entry.site}/generated`;
    const call: ToolCall = { id: "generated-page", name: "web_fetch", arguments: { url } };
    const decision = authorizeTool(settings, call, null, context);
    assert.equal(decision.decision, "allow", entry.id); assert.equal(decision.actor, "policy");
    assert.equal(authorizeTool(settings, call, null, { ...context, env: "Remote" }).decision, "ask");
  }
});

test("one approved origin cannot authorize another redirect, credentials or unsupported protocols", () => {
  const access = { version: 1 as const, unrestricted: false, sites: ["reviewed.example.invalid"], origins: ["https://first.example.invalid"] };
  assert.equal(webAccessAllows(access, "https://first.example.invalid/next"), true);
  assert.equal(webAccessAllows(access, "https://reviewed.example.invalid/next"), true);
  assert.equal(webAccessAllows(access, "https://unreviewed.example.invalid/"), false);
  assert.equal(webAccessAllows(access, "https://user:password@first.example.invalid/"), false);
  assert.equal(webAccessAllows({ ...access, unrestricted: true }, "file:///generated"), false);
});

test("native capability classification never turns external MCP hints, scripts or hard denials into permission", () => {
  const settings = defaultSettings(), context = { sessionId: "generated-session", projectId: "generated-project", env: "Local" as const, autonomy: "Manual" as const };
  const call: ToolCall = { id: "generated-mcp", name: "mcp_gateway", arguments: { action: "call", serverId: "builtin", tool: "grep_logs" } };
  assert.equal(authorizeTool(settings, call, "/generated", context).actor, "policy");
  assert.equal(authorizeTool(settings, { ...call, arguments: { ...call.arguments, tool: "script.generated" } }, "/generated", context).decision, "ask");
  assert.equal(authorizeTool(settings, { ...call, arguments: { ...call.arguments, serverId: "generated-external", readOnlyHint: true } }, "/generated", context).decision, "ask");
  settings.permissions.tools = [{ id: "generated-hard-deny", tool: "*", pathPrefix: "", decision: "deny" }];
  for (const tool of ["read_file", "edit_file", "mcp_gateway"]) assert.equal(authorizeTool(settings, { ...call, name: tool }, "/generated", context).decision, "deny");
  settings.permissions.tools = []; settings.permissions.defaultDecision = "deny";
  assert.equal(authorizeTool(settings, { ...call, name: "read_file" }, "/generated", context).decision, "deny");
});

test("website validation runs without remembered grants and duplicate identity is independent of property order", () => {
  const settings = defaultSettings();
  settings.permissions.webAllowlist = [
    { id: "generated-first", site: "example.invalid", scope: { kind: "session", sessionId: "generated-session" } },
    { id: "generated-second", site: "example.invalid", scope: { sessionId: "generated-session", kind: "session" } },
  ];
  assert.throws(() => validateSettings(settings), { code: "web_allowlist_rule" });
  settings.permissions.webAllowlist = [{ id: "generated-first", site: "*.example.invalid", scope: { kind: "global" } }];
  assert.throws(() => validateSettings(settings), { code: "web_allowlist_site" });
});
