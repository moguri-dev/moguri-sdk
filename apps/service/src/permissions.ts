import { relative, isAbsolute, normalize } from "node:path";
import type { ToolCall, UserSettings } from "../../../packages/protocol/src/index.ts";
import { appearanceErrors, sqlEndpoint, skillArchiveUrl, validateShortcutSet, isPasteFilePath, MoguriError } from "../../../packages/protocol/src/index.ts";
import { validateLocalEndpoints } from "./model-registry.ts";
import { validateRemoteTarget } from "./remote.ts";

export interface Authorization { decision: "ask" | "allow" | "deny"; ruleId?: string; reason: string }
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
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:ghp|gho|github_pat)_[A-Za-z0-9_]{20,}/.test(JSON.stringify(settings))) {
    throw new MoguriError("secret_in_settings", "Do not put credentials in prompts, arguments or settings. Use the credential backend.");
  }
  if (settings.sandbox.image && !/@sha256:[a-f0-9]{64}$/.test(settings.sandbox.image)) throw new MoguriError("sandbox_image", "SendBox requires a digest-pinned workload image.");
}
export function authorizeTool(settings: UserSettings, call: ToolCall, root: string | null): Authorization {
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
  if (call.name === "run_command" || call.name === "command_job" && call.arguments.action === "start" || call.name === "debug") {
    const exact = call.name === "debug" ? `debug ${JSON.stringify(call.arguments)}` : call.arguments.command;
    const commands = settings.permissions.commands.filter((rule) => rule.command === exact);
    const rule = commands.find((rule) => rule.decision === "deny") ?? commands.find((rule) => rule.decision === "allow") ?? commands.find((rule) => rule.decision === "ask");
    return rule ? { decision: rule.decision, ruleId: rule.id, reason: `Exact command ${rule.decision} rule.` } : unspecified;
  }
  if (call.name === "mcp_gateway" && call.arguments.action === "call") return { decision: defaultDecision, reason: "External and script tools require exact nested-tool approval; annotations are not permission." };
  const grant = matched.find((rule) => rule.decision === "allow");
  if (grant) return { decision: "allow", ruleId: grant.id, reason: "Explicit user tool delegation." };
  const ask = matched.find((rule) => rule.decision === "ask");
  return ask ? { decision: "ask", ruleId: ask.id, reason: "Explicit user review rule." } : unspecified;
}
