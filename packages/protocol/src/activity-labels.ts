import type { ActivityKind } from "./activity.ts";
import type { Snapshot, ToolCall } from "./index.ts";

const text = (value: unknown): string | null => typeof value === "string" ? value : null;
/** Human label and subject for a tool call, shared by the activity timeline and approval cards. Browser-safe. */
export function describeActivityCall(call: ToolCall, snapshot: Pick<Snapshot, "registry">): { kind: ActivityKind; label: string; subject: string | null } {
  const args = call.arguments, subject = text(args.path) ?? text(args.query);
  if (call.name === "read_file") return args.search === undefined ? { kind: "read-file", label: "Read file", subject } : { kind: "search-files", label: "Search file", subject };
  if (call.name === "read_document") return { kind: "read-file", label: "Read document", subject: text(args.attachmentId) };
  if (call.name === "write_file") return { kind: args.expectedDigest === "absent" ? "create-file" : "edit-file", label: args.expectedDigest === "absent" ? "Create file" : "Edit file", subject };
  if (call.name === "list_files" || call.name === "list_documents") return { kind: "search-files", label: call.name === "list_files" ? "List files" : "List documents", subject };
  if (["memory_search", "search_document"].includes(call.name)) return { kind: "search-files", label: call.name === "memory_search" ? "Search repository memory" : "Search document", subject };
  if (call.name === "run_command") return { kind: "command", label: call.hook ? "Run configured script" : "Run command", subject: text(args.command) };
  if (call.name === "command_job") return { kind: "command", label: args.action === "start" ? "Start command job" : "Stop command job", subject: text(args.command) ?? text(args.jobId) };
  if (call.name === "debug") return { kind: "command", label: "Debug adapter", subject: text(args.command) ?? text(args.action) };
  if (call.name === "create_issue") return { kind: "tool", label: args.action === "preview" ? "Review issue creation" : "Request issue creation", subject: text(args.service) };
  if (call.name === "inspect_document") return { kind: "read-file", label: "Inspect project document", subject: text(args.path) };
  if (["edit_file", "edit_document"].includes(call.name)) return { kind: "edit-file", label: call.name === "edit_file" ? "Edit file" : "Edit document", subject };
  if (call.name === "write_document") return { kind: args.expectedDigest === "absent" ? "create-file" : "edit-file", label: "Write document", subject };
  if (["find_files", "search_files", "query_data", "sqlite_query"].includes(call.name)) return { kind: "search-files", label: "Search/query files", subject };
  if (["web_search", "web_fetch"].includes(call.name)) return { kind: "search-web", label: call.name === "web_search" ? "Search web" : "Read web page", subject: text(args.query) ?? text(args.url) };
  if (call.name === "use_skill") return { kind: args.action === "load" ? "load-skill" : "search-skills", label: args.action === "load" ? "Load skill" : "Find skills", subject: text(args.query) ?? text(args.id) };
  if (call.name === "read_agent_terminal") return { kind: "command", label: "Read agent terminal", subject: text(args.commandId) ?? "Command history" };
  if (call.name === "ask_user") return { kind: "ask-user", label: "Asked user", subject: text(args.question) };
  if (call.name === "mcp_gateway") {
    const tool = text(args.tool), server = text(args.serverId);
    if (args.action !== "call" || !tool) return { kind: "mcp", label: "MCP gateway", subject: text(args.action) };
    const nested = args.arguments && typeof args.arguments === "object" && !Array.isArray(args.arguments) ? args.arguments : {};
    const named = tool.split(/[.:/]/).at(-1) ?? tool;
    if (["fetch_page", "web_search", "search_web", "brave_web_search"].includes(named)) return { kind: "search-web", label: named === "fetch_page" ? "Read web page" : "Search web", subject: text(Reflect.get(nested, "url")) ?? text(Reflect.get(nested, "query")) };
    if (["search_skills", "find_skills", "search_skill", "find_skill"].includes(named)) return { kind: "search-skills", label: "Search skills", subject: text(Reflect.get(nested, "query")) };
    if (["create_issue", "issue_create"].includes(named)) return { kind: "create-issue", label: "Create issue (MCP)", subject: server ? `${server} / ${tool}` : tool };
    if (["grep_logs", "search_memory", "memory_graph", "search_files"].includes(named)) return { kind: "search-files", label: named === "grep_logs" ? "Search file" : "Search repository", subject: text(Reflect.get(nested, "path")) ?? text(Reflect.get(nested, "query")) };
    if (server === "builtin" && snapshot.registry.some((entry) => entry.kind === "script" && entry.name === tool)) return { kind: "command", label: "Run script", subject: tool };
    return { kind: "mcp", label: "Use MCP tool", subject: server ? `${server} / ${tool}` : tool };
  }
  return { kind: "tool", label: "Use tool", subject: call.name };
}
