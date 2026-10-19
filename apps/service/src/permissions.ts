import { relative, isAbsolute, normalize } from "node:path";
import type { ToolCall, UserSettings } from "../../../packages/protocol/src/index.ts";
import { MoguriError } from "../../../packages/protocol/src/index.ts";
import { validateLocalEndpoints } from "./model-registry.ts";
import { validateRemoteTarget } from "./remote.ts";

export interface Authorization { decision: "ask" | "allow" | "deny"; ruleId?: string; reason: string }
export function validateSettings(settings: UserSettings): void {
  validateLocalEndpoints(settings.localModels);
  validateRemoteTarget(settings.remote);
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
    if (rule.tool === "run_command" && rule.decision === "allow") throw new MoguriError("unsafe_rule", "Allow shell commands only by exact command rules, never a blanket tool grant.");
    if (rule.tool === "*" && rule.decision === "allow") throw new MoguriError("unsafe_rule", "A wildcard cannot grant all tools. Name each delegated tool.");
    if (isAbsolute(rule.pathPrefix) || normalize(rule.pathPrefix).split(/[\\/]/).includes("..")) throw new MoguriError("unsafe_rule", "Tool path rules must remain inside the approved project.");
  }
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:ghp|gho|github_pat)_[A-Za-z0-9_]{20,}/.test(JSON.stringify(settings))) {
    throw new MoguriError("secret_in_settings", "Do not put credentials in prompts, arguments or settings. Use the credential backend.");
  }
  if (settings.sandbox.image && !/@sha256:[a-f0-9]{64}$/.test(settings.sandbox.image)) throw new MoguriError("sandbox_image", "SendBox requires a digest-pinned workload image.");
}
export function authorizeTool(settings: UserSettings, call: ToolCall, root: string | null): Authorization {
  const value = typeof call.arguments.path === "string" ? call.arguments.path : "";
  if (!root && ["list_files", "read_file", "write_file", "run_command"].includes(call.name)) return { decision: "deny", reason: "A selected project is required for workspace access." };
  const scoped = value && root && isAbsolute(value) ? relative(root, value) : value;
  const matched = settings.permissions.tools.filter((rule) => {
    if (rule.tool !== "*" && rule.tool !== call.name) return false;
    const prefix = rule.pathPrefix.replace(/\/$/, "");
    return !prefix || scoped === prefix || scoped.startsWith(`${prefix}/`);
  });
  const denial = matched.find((rule) => rule.decision === "deny");
  if (denial) return { decision: "deny", ruleId: denial.id, reason: "Denied by user tool policy." };
  if (call.name === "run_command") {
    const commands = settings.permissions.commands.filter((rule) => rule.command === call.arguments.command);
    const rule = commands.find((rule) => rule.decision === "deny") ?? commands.find((rule) => rule.decision === "allow");
    return rule ? { decision: rule.decision, ruleId: rule.id, reason: `Exact command ${rule.decision} rule.` } : { decision: "ask", reason: "Shell commands require an exact delegation or human approval." };
  }
  if (call.name === "mcp_gateway" && call.arguments.action === "call") return { decision: "ask", reason: "External and script tools require exact nested-tool approval; annotations are not permission." };
  const grant = matched.find((rule) => rule.decision === "allow");
  return grant ? { decision: "allow", ruleId: grant.id, reason: "Explicit user tool delegation." } : { decision: "ask", reason: "No matching user delegation." };
}
