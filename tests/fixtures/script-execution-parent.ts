import { readFile } from "node:fs/promises";
import { ScriptExecutionSchema } from "../../packages/protocol/src/script-reviews.ts";
import { parse } from "../../packages/protocol/src/core.ts";
import { executeReviewedScript } from "../../apps/service/src/script-execution.ts";

const [root, descriptor] = process.argv.slice(2);
if (!root || !descriptor) throw new Error("Provide the generated root and exact execution descriptor.");
const execution = parse(ScriptExecutionSchema, JSON.parse(await readFile(descriptor, "utf8")));
const result = await executeReviewedScript(root, execution, new AbortController().signal, (pid) => {
  process.stdout.write(JSON.stringify({ generatedGroup: pid }) + "\n");
});
process.stdout.write(JSON.stringify(result) + "\n");
