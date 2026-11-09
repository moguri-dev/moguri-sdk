import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { writeFile } from "node:fs/promises";
import { once } from "node:events";
import { join, resolve } from "node:path";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { setupFixture, waitFor } from "../tests/fixture.ts";

const binary = process.argv[2] ? resolve(process.argv[2]) : null;
if (!binary) throw new Error("Pass an explicitly downloaded, checksum-verified otelcol 0.165.0 executable. This command never installs or discovers a Collector.");
assert.match(execFileSync(binary, ["--version"], { encoding: "utf8" }), /\b0\.165\.0\b/);
const reservation = createServer(); reservation.listen(0, "127.0.0.1"); await once(reservation, "listening");
const address = reservation.address(); assert.ok(address && typeof address === "object");
await new Promise<void>((resolve, reject) => reservation.close((error) => error ? reject(error) : resolve()));
const fixture = await setupFixture({ responseMode: "text", replyText: "GENERATED_PRIVATE_COLLECTOR_RESPONSE" });
const configuration = join(fixture.directory, "collector.yaml"), endpoint = `http://127.0.0.1:${address.port}`;
try {
  await writeFile(configuration, `receivers:\n  otlp:\n    protocols:\n      http:\n        endpoint: 127.0.0.1:${address.port}\nexporters:\n  debug:\n    verbosity: detailed\nservice:\n  telemetry:\n    metrics:\n      level: none\n  pipelines:\n    traces:\n      receivers: [otlp]\n      exporters: [debug]\n    metrics:\n      receivers: [otlp]\n      exporters: [debug]\n`, { mode: 0o600 });
  execFileSync(binary, ["validate", "--config", configuration], { encoding: "utf8", timeout: 10_000 });
} catch (error) { await fixture.close(); throw error; }
let output = "", finished = false;
const child = spawn(binary, ["--config", configuration], { stdio: ["ignore", "pipe", "pipe"] });
const exit = new Promise<number | null>((resolve, reject) => { child.once("error", (error) => { finished = true; reject(error); }); child.once("exit", (code) => { finished = true; resolve(code); }); });
void exit.catch(() => console.error("The exact generated Collector failed to start; its original error remains attached to owned cleanup."));
child.stdout.on("data", (chunk: Buffer) => { output = (output + chunk.toString("utf8")).slice(-262144); });
child.stderr.on("data", (chunk: Buffer) => { output = (output + chunk.toString("utf8")).slice(-262144); });
const sdk = new MoguriSdk(fixture.service.connection), started = performance.now();
try {
  await sdk.ready();
  await waitFor(() => output.includes("Everything is ready") || finished, 8000);
  assert.equal(finished, false, output);
  await fixture.configure();
  await sdk.telemetry.export.apply((await sdk.telemetry.export.review({ enabled: true, endpoint, samplingRatio: 1 })).review);
  await fixture.send("GENERATED_PRIVATE_COLLECTOR_PROMPT"); await fixture.terminal();
  await waitFor(() => output.includes("moguri.model") && output.includes("moguri.accounting.calls"), 8000);
  const status = await sdk.telemetry.export.status();
  assert.ok(status.acceptedSpans >= 2); assert.equal(status.failedRequests, 0);
  assert.equal(fixture.requests.length, 1);
  for (const forbidden of ["GENERATED_PRIVATE_COLLECTOR_RESPONSE", "GENERATED_PRIVATE_COLLECTOR_PROMPT", fixture.project, fixture.sessionId, "generated-test-only"]) assert.equal(output.includes(forbidden), false);
  await sdk.telemetry.export.apply((await sdk.telemetry.export.review({ enabled: false, endpoint, samplingRatio: 1 })).review);
  console.log(JSON.stringify({ status: "PASS", collector: "otelcol 0.165.0", transport: "OTLP/HTTP JSON", receiver: "actual stable OTLP receiver",
    exporter: "actual debug/detailed, generated loopback diagnostic only", modelCalls: 1, receiverAcknowledgedSpans: status.acceptedSpans,
    decodedModelAndMetricVisible: true, privateMarkersVisible: false, paidInference: false, globalInstallation: false, ms: performance.now() - started }));
} finally {
  sdk.disconnect();
  try { await fixture.close(); }
  finally {
    if (!finished) child.kill("SIGTERM");
    assert.equal(await exit, 0, "The exact owned Collector did not acknowledge normal shutdown.");
  }
}
