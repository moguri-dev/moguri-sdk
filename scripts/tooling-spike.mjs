import { performance } from "node:perf_hooks";
import { tools } from "../apps/service/src/tools.ts";
import { catalogForModel, discoverTools } from "../apps/service/src/tool-catalog.ts";
import { estimateModelContext } from "../apps/service/src/model-controls.ts";

const started = performance.now();
const bootstrap = catalogForModel(tools, []);
const lazy = catalogForModel(tools, ["read_file", "write_file"]);
const gateway = [{ name: "toolbox", description: "Search, describe or invoke a permitted tool.", parameters: {
  type: "object", properties: { action: { enum: ["search", "call"] }, name: { type: "string" }, arguments: { type: "object" } }, required: ["action"],
} }];
const arms = Object.entries({ baseline: tools, lazyBootstrap: bootstrap, lazyFileTask: lazy, stableGateway: gateway }).map(([name, catalog]) => ({
  name, schemas: catalog.length, schemaBytes: Buffer.byteLength(JSON.stringify(catalog)),
  estimatedInput: estimateModelContext({ systemPrompt: "Generated task.", messages: [], tools: catalog }),
}));
const found = discoverTools(tools, "read_file");
if (found.tools[0]?.name !== "read_file" || bootstrap.length !== 3) throw new Error("Generated discovery/call shape failed.");
console.log(JSON.stringify({
  status: "PASS", elapsedMs: performance.now() - started, arms,
  decision: "Lazy typed schemas preserve native argument constraints. A stable generic gateway is smaller but cannot expose each native argument schema to provider validation.",
  scope: "Generated schema/context-estimate probe, not real tokenizer counts, inference, cache-hit measurements or task-quality evidence. No credentials or paid models.",
  qualityGate: "Live task/cost/cache non-regression remains unqualified; do not advertise savings percentages or automatic model summaries.",
}, null, 2));
