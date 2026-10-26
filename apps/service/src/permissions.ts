import { relative, isAbsolute, normalize } from "node:path";
import { createHash } from "node:crypto";
import type { Controls, RememberApproval, RememberedApproval, ToolCall, UserSettings } from "../../../packages/protocol/src/index.ts";
import { appearanceErrors, commandFamily, sqlEndpoint, skillArchiveUrl, validateShortcutSet, isPasteFilePath, MoguriError } from "../../../packages/protocol/src/index.ts";
import { validateLocalEndpoints } from "./model-registry.ts";
import { validateRemoteTarget } from "./remote.ts";

export interface Authorization { decision: "ask" | "allow" | "deny"; ruleId?: string; reason: string }
export interface PermissionContext {
  sessionId: string; projectId: string | null; env: Controls["env"]; autonomy: Controls["autonomy"];
  automaticApprovals?: boolean; mcpBinding?: string; mcpSchemaDigest?: string;
}
const argumentsDigest = (value: ToolCall["arguments"]) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const commandText = (call: ToolCall): string | null => call.name === "run_command" || call.name === "command_job" && call.arguments.action === "start" ?
  typeof call.arguments.command === "string" ? call.arguments.command : null : call.name === "debug" ? `debug ${JSON.stringify(call.arguments)}` : null;
function rememberedTarget(call: ToolCall, context: PermissionContext, match: RememberApproval["match"]): RememberedApproval["target"] {
  const command = commandText(call);
  if (command !== null) {
    const family = match === "family" && call.name !== "debug" ? commandFamily(command) : null;
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
  return { kind: "tool", tool: call.name, argumentsDigest: argumentsDigest(call.arguments) };
}
export function rememberToolApproval(settings: UserSettings, call: ToolCall, context: PermissionContext, request: RememberApproval, id: string): UserSettings {
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
    if (target.kind === "command") return command !== null && (target.match === "exact" ? command === target.command : call.name !== "debug" && commandFamily(command) === target.command);
    if (target.kind === "mcp") return call.name === "mcp_gateway" && call.arguments.action === "call" &&
      call.arguments.serverId === target.serverId && call.arguments.tool === target.tool && (context.mcpSchemaDigest ?? call.arguments.schemaDigest) === target.schemaDigest && context.mcpBinding === target.bindingDigest;
    return call.name === target.tool && argumentsDigest(call.arguments) === target.argumentsDigest;
  });
  return grant ? { decision: "allow", ruleId: grant.id, reason: `Remembered actual-user ${grant.scope.kind} approval.` } : undefined;
}
export function validateSettings(settings: UserSettings): void {
  validateLocalEndpoints(settings.localModels);
  validateRemoteTarget(settings.remote);
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
    if (["run_command", "command_job", "debug"].includes(rule.tool) && rule.decision === "allow") throw new MoguriError("unsafe_rule", "Allow shell/watch commands or DAP actions only by exact command/request rules, never a blanket execution grant.");
    if (rule.tool === "*" && rule.decision === "allow") throw new MoguriError("unsafe_rule", "A wildcard cannot grant all tools. Name each delegated tool.");
    if (isAbsolute(rule.pathPrefix) || normalize(rule.pathPrefix).split(/[\\/]/).includes("..")) throw new MoguriError("unsafe_rule", "Tool path rules must remain inside the approved project.");
  }
  const rememberedIds = new Set<string>();
  for (const grant of settings.permissions.remembered ?? []) {
    if (rememberedIds.has(grant.id)) throw new MoguriError("unsafe_rule", "Remembered approval IDs must be unique.");
    rememberedIds.add(grant.id);
    if (grant.target.kind === "command" && grant.target.match === "family" && commandFamily(grant.target.command) !== grant.target.command ||
      grant.target.kind === "tool" && ["*", "run_command", "command_job", "debug", "mcp_gateway"].includes(grant.target.tool)) {
      throw new MoguriError("unsafe_rule", "Use an exact command, safe command family or schema-bound MCP tool, never a blanket execution grant.");
    }
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
  const scoped = value && root && isAbsolute(value) ? relative(root, value) : value;
  const matched = settings.permissions.tools.filter((rule) => {
    if (rule.tool !== "*" && rule.tool !== call.name) return false;
    const prefix = rule.pathPrefix.replace(/\/$/, "");
    return !prefix || scoped === prefix || scoped.startsWith(`${prefix}/`);
  });
  const denial = matched.find((rule) => rule.decision === "deny");
  if (denial) return { decision: "deny", ruleId: denial.id, reason: "Denied by user tool policy." };
  const automatic: Authorization | undefined = context?.automaticApprovals === true && ["Autopilot", "Autopilot Max"].includes(context.autonomy) && defaultDecision !== "deny" ?
    { decision: "allow", ruleId: `autonomy:${context.sessionId}`, reason: "Automatic approvals explicitly enabled by the user for this session." } : undefined;
  const remembered = () => rememberedAuthorization(settings, call, context);
  if (call.name === "run_command" || call.name === "command_job" && call.arguments.action === "start" || call.name === "debug") {
    const exact = call.name === "debug" ? `debug ${JSON.stringify(call.arguments)}` : call.arguments.command;
    const commands = settings.permissions.commands.filter((rule) => rule.command === exact);
    const rule = commands.find((rule) => rule.decision === "deny") ?? commands.find((rule) => rule.decision === "allow") ?? commands.find((rule) => rule.decision === "ask");
    if (rule?.decision === "deny") return { decision: "deny", ruleId: rule.id, reason: "Denied by exact command policy." };
    return automatic ?? remembered() ?? (rule ? { decision: rule.decision, ruleId: rule.id, reason: `Exact command ${rule.decision} rule.` } : unspecified);
  }
  if (call.name === "mcp_gateway" && call.arguments.action === "call") return automatic ?? remembered() ?? { decision: defaultDecision, reason: "External and script tools require exact nested-tool approval; annotations are not permission." };
  const delegated = automatic ?? remembered();
  if (delegated) return delegated;
  const grant = matched.find((rule) => rule.decision === "allow");
  if (grant) return { decision: "allow", ruleId: grant.id, reason: "Explicit user tool delegation." };
  const ask = matched.find((rule) => rule.decision === "ask");
  return ask ? { decision: "ask", ruleId: ask.id, reason: "Explicit user review rule." } : unspecified;
}
