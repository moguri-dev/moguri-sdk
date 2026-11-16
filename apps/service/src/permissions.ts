import { relative, isAbsolute, normalize, resolve } from "node:path";
import { createHash } from "node:crypto";
import type { Controls, RememberApproval, RememberedApproval, ToolCall, UserSettings } from "../../../packages/protocol/src/index.ts";
import { appearanceErrors, commandFamily, sqlEndpoint, skillArchiveUrl, validateShortcutSet, validateModelPreferences, isPasteFilePath, MoguriError,
  canonicalWebSite, effectiveWebAllowances, webSiteMatches, isRecord, type WebAccess } from "../../../packages/protocol/src/index.ts";
import { validateLocalEndpoints } from "./model-registry.ts";
import { agentHarnessOf } from "../../../packages/protocol/src/agent-harness.ts";
import { validateRemoteTarget } from "./remote.ts";
import { matchesFolder } from "./project-policy.ts";
import { unreviewedScriptCommand } from "./script-command-guard.ts";
import { validateKupoProfiles } from "./kupo-policy.ts";

export interface Authorization { decision: "ask" | "allow" | "deny"; ruleId?: string; reason: string; actor?: "policy" }
export const automaticNativeTools = new Set([
  "git_read", "read_file", "list_files", "find_files", "search_files", "diff_files", "edit_file", "write_file", "query_data",
  "sqlite_query", "sqlite_transaction", "inspect_document", "write_document", "edit_document", "discover_tools", "read_tool_result",
  "read_agent_terminal", "read_command_job", "list_documents", "read_document", "search_document", "query_state", "mutate_state", "review_script",
  "session_context", "wait_session", "memory_search", "clock", "ask_user", "task_progress", "use_skill",
]);
export interface PermissionContext {
  sessionId: string; projectId: string | null; env: Controls["env"]; autonomy: Controls["autonomy"];
  automaticApprovals?: boolean; mcpBinding?: string; mcpSchemaDigest?: string;
  enforcedWebDomains?: string[];
}
export function toolWebTarget(call: ToolCall): string | undefined {
  if (["click", "type", "wait", "take_screenshot"].includes(call.name)) return typeof call.arguments.expectedUrl === "string" ? call.arguments.expectedUrl : undefined;
  if (call.name === "playwright" && isRecord(call.arguments.launch) && call.arguments.launch.kind === "chromium") return typeof call.arguments.launch.url === "string" ? call.arguments.launch.url : undefined;
  if (call.name === "review_script" && call.arguments.action === "inspect" && typeof call.arguments.url === "string") return call.arguments.url;
  if (call.name === "web_search") return "https://html.duckduckgo.com/html/";
  if (["web_fetch", "fetch_page"].includes(call.name)) return typeof call.arguments.url === "string" ? call.arguments.url : undefined;
  if (call.name !== "mcp_gateway" || call.arguments.action !== "call" || call.arguments.serverId !== "builtin" || !isRecord(call.arguments.arguments)) return;
  const tool = call.arguments.tool, args = call.arguments.arguments;
  if (tool === "fetch_page" || tool === "browser_navigate") return typeof args.url === "string" ? args.url : undefined;
  if (["browser_snapshot", "browser_click", "browser_fill", "browser_press_key", "browser_wait", "browser_screenshot"].includes(String(tool))) return typeof args.expectedUrl === "string" ? args.expectedUrl : undefined;
}
export function approvedWebAccess(settings: UserSettings, call: ToolCall, context: PermissionContext): WebAccess | undefined {
  const target = toolWebTarget(call);
  if (!target) return;
  return { version: 1, unrestricted: settings.permissions.defaultDecision !== "deny" && context.automaticApprovals === true && ["Autopilot", "Autopilot Max"].includes(context.autonomy),
    sites: context.env === "Sandbox" ? [...new Set(context.enforcedWebDomains ?? [])] :
      [...new Set(effectiveWebAllowances(settings.permissions.webAllowlist ?? [], context).map((entry) => entry.site))],
    origins: target === "about:blank" ? [] : [new URL(target).origin] };
}
const argumentsDigest = (value: ToolCall["arguments"]) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const commandText = (call: ToolCall): string | null => call.name === "run_command" || call.name === "command_job" && call.arguments.action === "start" ?
  typeof call.arguments.command === "string" ? call.arguments.command : null : call.name === "run_script" ? call.arguments.reviewId !== undefined ?
    `reviewed-script ${JSON.stringify({ reviewId: call.arguments.reviewId, digest: call.arguments.expectedDigest, path: call.arguments.path })}` :
    `trusted-script ${JSON.stringify({ path: call.arguments.path, interpreter: call.arguments.interpreter, args: call.arguments.args ?? [] })}` : call.name === "debug" ? `debug ${JSON.stringify(call.arguments)}` : null;
function rememberedTarget(call: ToolCall, context: PermissionContext, match: RememberApproval["match"]): RememberedApproval["target"] {
  const command = commandText(call);
  if (command !== null) {
    if (match === "tool") throw new MoguriError("approval_command", "Use an exact command or safe command family, not a blanket execution-tool grant.");
    const family = match === "family" && call.name !== "debug" && call.name !== "run_script" ? commandFamily(command) : null;
    if (match === "family" && !family) throw new MoguriError("approval_family", "This shell expression has no safe command-family grant. Approve the exact command instead.");
    return { kind: "command", command: family ?? command, match };
  }
  if (match === "family") throw new MoguriError("approval_family", "Command-family approval applies only to a simple command.");
  if (call.name === "mcp_gateway" && call.arguments.action === "call") {
    const schemaDigest = context.mcpSchemaDigest ?? call.arguments.schemaDigest;
    if (typeof call.arguments.serverId !== "string" || typeof call.arguments.tool !== "string" ||
      typeof schemaDigest !== "string" || !/^[a-f0-9]{64}$/.test(schemaDigest) || !context.mcpBinding) {
      throw new MoguriError("approval_mcp", "Rediscover the exact MCP tool and server configuration before remembering its approval.");
    }
    return { kind: "mcp", serverId: call.arguments.serverId, tool: call.arguments.tool, schemaDigest, bindingDigest: context.mcpBinding };
  }
  return { kind: "tool", tool: call.name, ...(match === "tool" ? {} : { argumentsDigest: argumentsDigest(call.arguments) }) };
}
export function rememberToolApproval(settings: UserSettings, call: ToolCall, context: PermissionContext, request: RememberApproval, id: string): UserSettings {
  if (call.name === "run_script") throw new MoguriError("script_approval_once", "This reviewed script owns one original source-bound attempt. Approve only this action; no future script grant or replay can be remembered.");
  if (request.scope === "project" && !context.projectId) throw new MoguriError("approval_project", "A project-scoped approval requires this session's actual project.");
  const scope: RememberedApproval["scope"] = request.scope === "session" ? { kind: "session", sessionId: context.sessionId } :
    request.scope === "project" ? { kind: "project", projectId: context.projectId! } : { kind: "global" };
  const grant: RememberedApproval = { id, scope, env: context.env, target: rememberedTarget(call, context, request.match) };
  const remembered = settings.permissions.remembered ?? [];
  const same = (value: RememberedApproval) => value.env === grant.env && JSON.stringify(value.scope) === JSON.stringify(grant.scope) && JSON.stringify(value.target) === JSON.stringify(grant.target);
  if (remembered.some(same)) return settings;
  if (remembered.length >= 500) throw new MoguriError("approval_limit", "Remove an unused remembered approval in Settings before adding another.");
  return { ...settings, permissions: { ...settings.permissions, remembered: [...remembered, grant] } };
}
function rememberedAuthorization(settings: UserSettings, call: ToolCall, context?: PermissionContext): Authorization | undefined {
  if (!context) return;
  const command = commandText(call);
  const grant = settings.permissions.remembered?.find((grant) => {
    if (grant.env !== context.env || grant.scope.kind === "session" && grant.scope.sessionId !== context.sessionId ||
      grant.scope.kind === "project" && grant.scope.projectId !== context.projectId) return false;
    const target = grant.target;
    if (target.kind === "command") return command !== null && (target.match === "exact" ? command === target.command : call.name !== "debug" && call.name !== "run_script" && commandFamily(command) === target.command);
    if (target.kind === "mcp") return call.name === "mcp_gateway" && call.arguments.action === "call" &&
      call.arguments.serverId === target.serverId && call.arguments.tool === target.tool && (context.mcpSchemaDigest ?? call.arguments.schemaDigest) === target.schemaDigest && context.mcpBinding === target.bindingDigest;
    return call.name === target.tool && (target.argumentsDigest === undefined || argumentsDigest(call.arguments) === target.argumentsDigest);
  });
  return grant ? { decision: "allow", ruleId: grant.id, reason: `Remembered actual-user ${grant.scope.kind} approval.` } : undefined;
}
export function validateSettings(settings: UserSettings): void {
  if (settings.kupo.workflow === "auto") validateKupoProfiles(settings.kupo);
  validateLocalEndpoints(settings.localModels);
  validateRemoteTarget(settings.remote);
  if (settings.modelPreferences) validateModelPreferences(settings.modelPreferences);
  if ([settings.chatTitles?.modelId, settings.decisions.modelId, settings.winddown.modelId].some((modelId) => agentHarnessOf(modelId))) {
    throw new MoguriError("agent_harness_model", "Agent harness models (Claude Agent, Codex Agent) run your installed CLI and cannot serve as a naming, decision or finishing model. Choose a Moguri model.");
  }
  const sourceIds = new Set<string>();
  for (const source of settings.skillSources ?? []) {
    if (sourceIds.has(source.id)) throw new MoguriError("skill_source_id", "Skill source IDs must be unique within the profile.");
    sourceIds.add(source.id);
    if (source.kind === "remote") skillArchiveUrl(source.url);
    else if (!isAbsolute(source.path) || /[\0\r\n]/.test(source.path)) throw new MoguriError("skill_source_path", "Use an explicit absolute skill folder without control characters.");
  }
  const shortcuts = validateShortcutSet({ voice: settings.voice.shortcut ?? "Control+Space",
    commands: settings.shortcuts?.commands ?? "Primary+KeyK", terminalCopy: settings.shortcuts?.terminalCopy ?? "Primary+Shift+KeyC" });
  if (shortcuts.length) throw new MoguriError("shortcut_conflict", shortcuts.join(" "));
  const contrast = appearanceErrors(settings.appearance);
  if (contrast.length) throw new MoguriError("theme_contrast", `Theme contrast needs correction: ${contrast.slice(0, 6).join(" ")}`);
  if (Buffer.byteLength(JSON.stringify(settings.guidance ?? {})) > 64 * 1024) throw new MoguriError("guidance_limit", "Combined guidance templates must fit within 64 KiB. Nothing was truncated.");
  if (settings.integrations?.sql) {
    try { sqlEndpoint(settings.integrations.sql.endpoint); }
    catch { throw new MoguriError("sql_endpoint", "Use an explicit HTTPS daemon origin or loopback HTTP origin, without credentials, paths, query or fragment."); }
  }
  const ids = new Set<string>();
  for (const server of settings.mcpServers) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}$/.test(server.id) || server.id === "builtin" || ids.has(server.id)) throw new MoguriError("invalid_server", "MCP server IDs must be unique safe names; builtin is reserved.");
    ids.add(server.id);
    if (server.transport.type === "http") {
      const url = new URL(server.transport.url);
      if (url.username || url.password || url.hash || (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname)))) {
        throw new MoguriError("invalid_server", "MCP requires HTTPS, or an explicitly configured loopback HTTP server. Credentials do not belong in URLs.");
      }
    }
  }
  for (const rule of settings.permissions.tools) {
    if (["run_command", "run_script", "command_job", "debug"].includes(rule.tool) && rule.decision === "allow") throw new MoguriError("unsafe_rule", "Allow shell/watch commands or DAP actions only by exact command/request rules, never a blanket execution grant.");
    if (rule.tool === "*" && rule.decision === "allow") throw new MoguriError("unsafe_rule", "A wildcard cannot grant all tools. Name each delegated tool.");
    if (isAbsolute(rule.pathPrefix) || normalize(rule.pathPrefix).split(/[\\/]/).includes("..")) throw new MoguriError("unsafe_rule", "Tool path rules must remain inside the approved project.");
  }
  const rememberedIds = new Set<string>();
  for (const grant of settings.permissions.remembered ?? []) {
    if (rememberedIds.has(grant.id)) throw new MoguriError("unsafe_rule", "Remembered approval IDs must be unique.");
    rememberedIds.add(grant.id);
    if (grant.target.kind === "command" && grant.target.match === "family" && commandFamily(grant.target.command) !== grant.target.command ||
      grant.target.kind === "tool" && ["*", "run_command", "run_script", "command_job", "debug", "mcp_gateway"].includes(grant.target.tool)) {
      throw new MoguriError("unsafe_rule", "Use an exact command, safe command family or schema-bound MCP tool, never a blanket execution grant.");
    }
  }
  const webIds = new Set<string>(), webScopes = new Set<string>();
  for (const entry of settings.permissions.webAllowlist ?? []) {
    const key = JSON.stringify([entry.scope.kind, entry.scope.kind === "session" ? entry.scope.sessionId :
      entry.scope.kind === "project" ? entry.scope.projectId : null, entry.site]);
    if (canonicalWebSite(entry.site) !== entry.site || webIds.has(entry.id) || webScopes.has(key)) throw new MoguriError("web_allowlist_rule", "Website entries need unique IDs and canonical sites within each exact scope.");
    webIds.add(entry.id); webScopes.add(key);
  }
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:ghp|gho|github_pat)_[A-Za-z0-9_]{20,}/.test(JSON.stringify(settings))) {
    throw new MoguriError("secret_in_settings", "Do not put credentials in prompts, arguments or settings. Use the credential backend.");
  }
  if (settings.sandbox.image && !/@sha256:[a-f0-9]{64}$/.test(settings.sandbox.image)) throw new MoguriError("sandbox_image", "SendBox requires a digest-pinned workload image.");
}
export function authorizeTool(settings: UserSettings, call: ToolCall, root: string | null, context?: PermissionContext): Authorization {
  const defaultDecision = settings.permissions.defaultDecision ?? "ask";
  const unspecified: Authorization = { decision: defaultDecision, reason: defaultDecision === "deny" ? "Denied by the explicit default tool policy." : "No matching user delegation." };
  const value = typeof call.arguments.path === "string" ? call.arguments.path : "";
  if (!root && ["list_files", "read_file", "write_file", "run_command"].includes(call.name) && !(call.name === "read_file" && isPasteFilePath(value))) return { decision: "deny", reason: "A selected project is required for workspace access." };
  const scoped = value ? normalize(root ? relative(root, resolve(root, value)) : value).replace(/\/$/, "") : "";
  if (value && root && (isAbsolute(scoped) || scoped === ".." || scoped.startsWith("../"))) {
    return { decision: "deny", reason: "Choose a path inside the exact approved workspace, not an outside or aliased absolute root." };
  }
  const matched = settings.permissions.tools.filter((rule) => {
    if (rule.tool !== "*" && rule.tool !== call.name && !(call.name === "run_script" && rule.tool === "run_command")) return false;
    const prefix = rule.pathPrefix ? normalize(rule.pathPrefix).replace(/\/$/, "") : "";
    return !prefix || scoped === prefix || scoped.startsWith(`${prefix}/`) ||
      rule.decision !== "allow" && matchesFolder(scoped, [prefix]);
  });
  const denial = matched.find((rule) => rule.decision === "deny");
  if (denial) return { decision: "deny", ruleId: denial.id, reason: "Denied by user tool policy." };
  if (call.name === "run_command" || call.name === "command_job" && call.arguments.action === "start") {
    const blocked = typeof call.arguments.command === "string" ? unreviewedScriptCommand(call.arguments.command) : "Provide one exact literal command.";
    if (blocked) return { decision: "deny", reason: blocked };
  }
  const automatic: Authorization | undefined = context?.automaticApprovals === true && ["Autopilot", "Autopilot Max"].includes(context.autonomy) && defaultDecision !== "deny" ?
    { decision: "allow", ruleId: `autonomy:${context.sessionId}`, reason: "Automatic approvals explicitly enabled by the user for this session." } : undefined;
  const remembered = () => rememberedAuthorization(settings, call, context);
  const nativeGateway = call.name === "mcp_gateway" && (call.arguments.action === "read_result" || call.arguments.action === "discover" ||
    call.arguments.serverId === "builtin" && (call.arguments.action === "tools" ||
      call.arguments.action === "call" && ["browser_status", "grep_logs", "search_memory", "memory_graph"].includes(String(call.arguments.tool))));
  if (call.name === "run_command" || call.name === "run_script" || call.name === "command_job" && call.arguments.action === "start" || call.name === "debug") {
    const exact = commandText(call);
    const commands = settings.permissions.commands.filter((rule) => rule.command === exact);
    const rule = commands.find((rule) => rule.decision === "deny") ?? commands.find((rule) => rule.decision === "allow") ?? commands.find((rule) => rule.decision === "ask");
    if (rule?.decision === "deny") return { decision: "deny", ruleId: rule.id, reason: "Denied by exact command policy." };
    return automatic ?? remembered() ?? (rule ? { decision: rule.decision, ruleId: rule.id, reason: `Exact command ${rule.decision} rule.` } : unspecified);
  }
  const webTarget = toolWebTarget(call);
  if (!webTarget && !nativeGateway && call.name === "mcp_gateway" && call.arguments.action === "call") return automatic ?? remembered() ?? { decision: defaultDecision, reason: "External and script tools require exact nested-tool approval; annotations are not permission." };
  const delegated = automatic ?? remembered();
  if (delegated) return delegated;
  const grant = matched.find((rule) => rule.decision === "allow");
  if (grant) return { decision: "allow", ruleId: grant.id, reason: "Explicit user tool delegation." };
  const ask = matched.find((rule) => rule.decision === "ask");
  if (ask) return { decision: "ask", ruleId: ask.id, reason: "Explicit user review rule." };
  if (defaultDecision !== "deny" && context && webTarget) {
    const allowance = effectiveWebAllowances(settings.permissions.webAllowlist ?? [], context).find((entry) => webSiteMatches(entry.site, webTarget));
    const enforced = context.env === "Sandbox" && context.enforcedWebDomains?.some((site) => webSiteMatches(site, webTarget));
    if (allowance || enforced) return { decision: "allow", actor: "policy", ruleId: allowance?.id ?? "native:enforced-network", reason: allowance ?
      `Actual-user ${allowance.scope.kind} Local website allowlist.` : "The exact verified guest already enforces this approved host." };
  }
  if (defaultDecision !== "deny" && (automaticNativeTools.has(call.name) && !(call.name === "review_script" && webTarget) || nativeGateway)) {
    return { decision: "allow", actor: "policy", ruleId: `native:${call.name}`, reason: "Native operation is automatically permitted within its existing root, mode and hard policy." };
  }
  return unspecified;
}
