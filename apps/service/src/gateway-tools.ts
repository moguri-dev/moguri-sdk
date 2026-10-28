import { Type } from "typebox";
import { createHash } from "node:crypto";
import { ToolSchema } from "@modelcontextprotocol/sdk/types.js";
import { BROWSER_MCP_TOOLS } from "../../../packages/protocol/src/index.ts";

export const BUILTIN_FILE_SEARCH_LIMITS = { bytes: 1024 * 1024, lines: 100, characters: 1000, resultBytes: 12000 } as const;
export const INTERNAL_MCP_TOOLS = [
  ...BROWSER_MCP_TOOLS,
  { name: "grep_logs", description: "Search one approved UTF-8 project text/log file up to 1 MiB with a literal string. Return at most 100 matching lines, 1000 characters each, within 12000 serialized UTF-8 bytes, with byte offsets and explicit omissions/clipping. No matches is a successful empty result. Use native read_file to page exact source, or search_files for regex/larger sources. No generated shell or regular expression.", inputSchema: Type.Object({ path: Type.String({ minLength: 1, maxLength: 4096 }), query: Type.String({ minLength: 1, maxLength: 1000 }) }, { additionalProperties: false }) },
  { name: "fetch_page", description: "Fetch an explicitly approved public HTTPS HTML/text page or public GitHub REST API JSON as untrusted readable text. Private network destinations and scripts are not executed.", inputSchema: Type.Object({ url: Type.String({ minLength: 1, maxLength: 2048 }) }, { additionalProperties: false }) },
  { name: "search_memory", description: "Search the actual repository's opt-in lexical-vector index, with current source checks and captured binding provenance.", inputSchema: Type.Object({ query: Type.String({ minLength: 1, maxLength: 4000 }) }, { additionalProperties: false }) },
  { name: "memory_graph", description: "Read the actual repository's opt-in import/symbol graph with current source checks.", inputSchema: Type.Object({ path: Type.String({ maxLength: 4096 }) }, { additionalProperties: false }) },
];
export const builtinToolDigest = (tool: unknown): string => createHash("sha256").update(JSON.stringify({ tool: ToolSchema.parse(tool), server: { name: "moguri-internal", version: "1" } })).digest("hex");
