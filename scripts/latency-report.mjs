// Prints the product latency budget samples recorded with MOGURI_LATENCY_BUDGETS=report: a GitHub warning per miss and a
// step summary table. It never fails the job; local runs, including verify:sdk before tagging, enforce the same budgets.
import { appendFileSync, existsSync, readFileSync } from "node:fs";

const path = process.argv[2];
if (!path) throw new Error("Usage: node scripts/latency-report.mjs <report.jsonl>");
const samples = existsSync(path) ? readFileSync(path, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];
const misses = samples.filter((sample) => !sample.within);
for (const miss of misses) console.log(`::warning title=Latency budget miss::${miss.name} took ${miss.elapsedMs.toFixed(2)} ms; budget is ${miss.limitMs} ms.`);
console.log(`${samples.length} latency budget samples, ${misses.length} over budget.`);
if (process.env.GITHUB_STEP_SUMMARY) {
  const rows = samples.map((sample) => `| ${sample.name} | ${sample.elapsedMs.toFixed(1)} | ${sample.limitMs} | ${sample.within ? "within" : "**over**"} |`);
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, ["## Product latency budgets (reported, not enforced on shared runners)", "",
    `${samples.length} samples, ${misses.length} over budget.`, "", "| Sample | ms | Budget ms | Result |", "| --- | ---: | ---: | --- |", ...rows, ""].join("\n"));
}
