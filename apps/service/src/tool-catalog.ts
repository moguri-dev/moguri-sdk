import { createHash } from "node:crypto";
import { Type, type Tool } from "@earendil-works/pi-ai";
import { MoguriError } from "../../../packages/protocol/src/core.ts";

export const discoveryTool: Tool = {
  name: "discover_tools",
  description: "Find tools for this turn by task or exact name. Empty query browses the complete permitted catalogue in pages. Returns metadata/digests and loads selected argument schemas as native typed functions on the next step, without repeating schemas in result text. Discovery does not execute a tool or grant permissions. If search misses, browse or use another query. Skills are discovered separately through skill tools.",
  parameters: Type.Object({
    query: Type.String({ maxLength: 200 }),
    offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 512 })),
  }, { additionalProperties: false }),
};
export const toolSchemaDigest = (tool: Tool): string => createHash("sha256").update(JSON.stringify(tool)).digest("hex");
const words = (text: string): string[] => text.toLowerCase().replaceAll("_", " ").match(/[a-z0-9]+/g) ?? [];

export function catalogForModel(catalog: Tool[], selected: string[]): Tool[] {
  if (selected.length > 64) throw new MoguriError("tool_catalog", "At most 64 tools may be selected for one turn.");
  const names = [...new Set(["ask_user", "task_progress", ...selected])];
  if (selected.some((name) => !catalog.some((tool) => tool.name === name))) throw new MoguriError("tool_unavailable", "A selected tool is no longer in this execution scope. Rediscover the current catalogue.");
  return [discoveryTool, ...names.flatMap((name) => catalog.filter((tool) => tool.name === name && name !== discoveryTool.name))];
}

export function discoverTools(catalog: Tool[], query: string, offset = 0) {
  if (!query.isWellFormed() || query.length > 200 || !Number.isSafeInteger(offset) || offset < 0 || offset > 512) {
    throw new MoguriError("tool_catalog", "Use a query up to 200 characters and a returned nonnegative page offset.");
  }
  const tokens = words(query);
  const ranked = catalog.filter((tool) => tool.name !== discoveryTool.name).map((tool) => {
    const name = words(tool.name), document = words(`${tool.name} ${tool.description} ${JSON.stringify(tool.parameters)}`);
    const score = tool.name === query.trim() ? 10000 : tokens.reduce((sum, token) => sum + (name.includes(token) ? 8 : document.includes(token) ? 1 : 0), 0);
    return { tool, score };
  }).filter((entry) => !tokens.length || entry.score > 0).sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name, "en"));
  if (offset > ranked.length) throw new MoguriError("tool_catalog", "This offset is outside the current catalogue result. Start a new search.");
  const selected: (Tool & { schemaDigest: string })[] = [];
  for (const { tool } of ranked.slice(offset, offset + 5)) {
    const entry = { ...tool, schemaDigest: toolSchemaDigest(tool) };
    if (Buffer.byteLength(JSON.stringify([...selected, entry])) > 15 * 1024) {
      if (!selected.length) throw new MoguriError("tool_catalog_limit", "This schema exceeds the discovery page limit. Its host must expose a smaller bounded schema; no partial schema was returned.");
      break;
    }
    selected.push(entry);
  }
  return { tools: selected, offset, nextOffset: offset + selected.length < ranked.length ? offset + selected.length : null, total: ranked.length, query };
}
