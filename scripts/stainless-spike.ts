import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { StainlessIntegration } from "../apps/service/src/stainless.ts";
import { runDataTask } from "../apps/service/src/data-tools.ts";

/**
 * Qualifies the Moguri-owned Stainless path against the Stainless installed on this Mac (or STAINLESS_APP).
 * Headless only, disposable profiles, generated loopback pages; it never opens a window, reads a personal
 * profile or calls a model. Requires `npm run build` for dist/playwright-worker.mjs.
 */
const run = promisify(execFile);
const appPath = process.env.STAINLESS_APP ?? null;
const integration = new StainlessIntegration(() => ({ enabled: true, appPath }));
const before = await integration.status();
if (before.availability !== "found" || !before.installation) {
  console.log(JSON.stringify({ status: "SKIP", reason: before.diagnostic }, null, 2));
  process.exit(0);
}
const executable = before.installation.executable;
const survivors = async () => {
  const { stdout } = await run("/bin/ps", ["-axo", "pid=,command="]).catch(() => ({ stdout: "" }));
  return stdout.split("\n").filter((line) => line.includes(executable) && line.includes("moguri-owned-app-")).length;
};
const checkStarted = performance.now();
const checked = await integration.check();
const checkMs = performance.now() - checkStarted;

const server = createServer((request, response) => {
  if (request.url === "/missing") { response.writeHead(404).end("generated missing"); return; }
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(`<!doctype html><title>Generated Stainless qualification</title><main><h1>Generated preview</h1>
    <label>Name <input id="name"></label><button id="go" onclick="document.querySelector('h1').textContent='Hello '+document.querySelector('#name').value;console.warn('generated-warning')">Go</button></main>
    <script>console.log("generated-log");fetch("/missing")</script>`);
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert.ok(address && typeof address === "object");
const url = `http://127.0.0.1:${address.port}/`;
const root = await mkdtemp(join(tmpdir(), "moguri-stainless-spike-"));
const batchStarted = performance.now();
let batch: Record<string, unknown>;
try {
  batch = await runDataTask({ kind: "playwright", root, stainlessExecutable: executable,
    webAccess: { version: 1, unrestricted: false, sites: [], origins: [new URL(url).origin] },
    arguments: { launch: { kind: "stainless", url }, actions: [
      { action: "type", selector: "#name", text: "generated" }, { action: "click", selector: "#go" },
      { action: "wait", milliseconds: 200 }, { action: "snapshot" }, { action: "take_screenshot", name: "Generated" }, { action: "diagnostics" },
    ] } }, AbortSignal.timeout(40_000)) as Record<string, unknown>;
} finally { server.close(); await rm(root, { recursive: true, force: true }); }
const batchMs = performance.now() - batchStarted;
const observations = batch.observations as Record<string, unknown>[];
const snapshot = observations.find((entry) => entry.action === "snapshot");
const diagnostics = observations.find((entry) => entry.action === "diagnostics") as { console: { type: string; text: string }[]; network: { status: number | null; url: string }[] };
const deliveries = batch.deliveries as { kind: string; data: string }[];
const leftover = await survivors();
const checks = {
  checkPassed: checked.check?.outcome === "passed",
  batchCompleted: batch.outcome === "completed" && batch.closedKnownTarget === true,
  typedAndClicked: String(snapshot?.text).includes("Hello generated"),
  screenshot: deliveries.length === 1 && Buffer.from(deliveries[0]!.data, "base64").subarray(1, 4).toString() === "PNG",
  console: diagnostics.console.some((entry) => entry.text === "generated-log") && diagnostics.console.some((entry) => entry.type === "warning"),
  network: diagnostics.network.some((entry) => entry.status === 404 && entry.url.endsWith("/missing")),
  noSurvivors: leftover === 0,
};
const status = Object.values(checks).every(Boolean) ? "PASS" : "FAIL";
console.log(JSON.stringify({ status, installation: before.installation, tested: before.tested, reportedVersion: batch.reportedVersion,
  checkMs: Math.round(checkMs), checkDiagnostic: checked.check?.diagnostic ?? null, batchMs: Math.round(batchMs), checks,
  host: { platform: process.platform, arch: process.arch, node: process.version } }, null, 2));
process.exit(status === "PASS" ? 0 : 1);
