import { Type, type Static } from "typebox";
import { Value } from "typebox/value";

/**
 * Protocol 114. A read-only, profile-level view of the agent's built-in deterministic tools grouped into toolsets.
 * Listing grants nothing: each chat still receives only the tools its environment, mode, scope and policy allow.
 */
export const TOOLSETS = [
  { id: "files", name: "Files", description: "List, read, write and edit files in the approved workspace.",
    tools: ["list_files", "read_file", "write_file", "edit_file", "find_files"] },
  { id: "search", name: "Search and code intelligence", description: "Search code with ripgrep, follow TypeScript symbols and query opt-in repository memory.",
    tools: ["search_files", "goto_definition", "find_references", "memory_search"] },
  { id: "git", name: "Git and GitHub", description: "Read and change the Local repository through reviewed Git operations, and read GitHub work.",
    tools: ["git_read", "git_write", "diff_files", "github_read", "create_issue", "project_work"] },
  { id: "commands", name: "Commands and scripts", description: "Run approved commands and reviewed scripts, follow long-running jobs and debug programs.",
    tools: ["run_command", "command_job", "read_command_job", "read_agent_terminal", "review_script", "run_script", "debug"] },
  { id: "documents", name: "Documents", description: "Create, inspect and edit PDF, Word and Excel files, and read attached documents.",
    tools: ["write_document", "inspect_document", "edit_document", "list_documents", "read_document", "search_document"] },
  { id: "data", name: "Data", description: "Query JSON, YAML and SQLite data, sort and filter arrays, and read the session's plan and notes.",
    tools: ["query_data", "sqlite_query", "sqlite_transaction", "find_in_array", "order_asc", "order_desc", "find_bigger", "find_smaller", "query_state", "mutate_state", "clock"] },
  { id: "web", name: "Web and browser", description: "Search and fetch public web pages, drive the session's browser and render small HTML results.",
    tools: ["web_search", "web_fetch", "fetch_page", "click", "type", "wait", "take_screenshot", "playwright", "render_html"] },
  { id: "sessions", name: "Planning and sessions", description: "Plan work, ask you questions, coordinate child sessions and reread earlier tool results.",
    tools: ["task_progress", "ask_user", "session_context", "session_message", "session_control", "wait_session", "run_subagent", "read_tool_result", "discover_tools"] },
  { id: "extensions", name: "Skills, MCP and proposals", description: "Load enabled skills, call configured MCP servers and approved scripts, and propose improvements for your review.",
    tools: ["use_skill", "mcp_gateway", "moguri_config", "propose_skill", "propose_script", "propose_memory", "propose_hook"] },
] as const;
export interface ToolsetTool { name: string; summary: string }
export interface Toolset { id: string; name: string; description: string; tools: ToolsetTool[] }
export interface ToolsetCatalog {
  toolsets: Toolset[];
  /** Foundational scripts every project gets through the internal MCP server. */
  scripts: { name: string; summary: string }[];
}
export const ToolsetQuerySchema = Type.Object({ type: Type.Literal("tooling.toolsets") }, { additionalProperties: false });
export type ToolsetQuery = Static<typeof ToolsetQuerySchema>;
export const isToolsetQuery = (value: unknown): value is ToolsetQuery => Value.Check(ToolsetQuerySchema, value);
export type ToolsetResponse = { type: "tooling.toolsets"; catalog: ToolsetCatalog };

/** The first sentence of a tool description, bounded for display. */
export function toolSummary(description: string): string {
  const sentence = description.match(/^[\s\S]*?[.!?](?=\s|$)/)?.[0] ?? description;
  const characters = Array.from(sentence.trim());
  return characters.length > 220 ? `${characters.slice(0, 219).join("")}…` : characters.join("");
}
/** Groups actual tool definitions by toolset; tools without a documented group stay visible under Other. */
export function groupToolsets(tools: readonly { name: string; description: string }[]): Toolset[] {
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const grouped = new Set<string>();
  const result: Toolset[] = TOOLSETS.map((set) => ({ id: set.id, name: set.name, description: set.description,
    tools: set.tools.flatMap((name) => {
      const tool = byName.get(name);
      if (!tool) return [];
      grouped.add(name);
      return [{ name, summary: toolSummary(tool.description) }];
    }) })).filter((set) => set.tools.length);
  const other = tools.filter((tool) => !grouped.has(tool.name));
  if (other.length) result.push({ id: "other", name: "Other", description: "Built-in tools without a documented toolset.", tools: other.map((tool) => ({ name: tool.name, summary: toolSummary(tool.description) })) });
  return result;
}
