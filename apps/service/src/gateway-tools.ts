import { Type } from "typebox";

export const INTERNAL_MCP_TOOLS = [
  { name: "grep_logs", description: "Search one approved project text/log file with a literal string. No generated shell or regular expression.", inputSchema: Type.Object({ path: Type.String({ minLength: 1, maxLength: 4096 }), query: Type.String({ minLength: 1, maxLength: 1000 }) }, { additionalProperties: false }) },
  { name: "fetch_page", description: "Fetch an explicitly approved public HTTPS page as untrusted readable text. Private network destinations and scripts are not executed.", inputSchema: Type.Object({ url: Type.String({ minLength: 1, maxLength: 2048 }) }, { additionalProperties: false }) },
  { name: "search_memory", description: "Search this project's opt-in local lexical-vector index, retaining revision and source provenance.", inputSchema: Type.Object({ query: Type.String({ minLength: 1, maxLength: 4000 }) }, { additionalProperties: false }) },
  { name: "memory_graph", description: "Read this project's local import/symbol graph.", inputSchema: Type.Object({ path: Type.String({ maxLength: 4096 }) }, { additionalProperties: false }) },
];
