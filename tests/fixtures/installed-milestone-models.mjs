import assert from "node:assert/strict";
import { createServer } from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const installed = await fs.realpath(process.argv[2]);
const directory = await fs.realpath(await fs.mkdtemp(join(os.tmpdir(), "moguri-installed-milestone-models-")));
const stateDir = join(directory, "state"), project = join(directory, "project"), home = join(directory, "home");
await fs.mkdir(project); await fs.mkdir(home);
const executablePath = join(project, "generated-llama-cli"), modelPath = join(project, "generated-model.gguf");
const header = Buffer.alloc(64); header.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]); header.writeUInt16LE(62, 18);
await fs.writeFile(executablePath, header, { mode: 0o600 });
await fs.writeFile(modelPath, Buffer.from([0x47, 0x47, 0x55, 0x46, 3, 0, 0, 0]), { mode: 0o600 });
const osNames = ["platform", "arch", "release", "totalmem", "freemem", "availableParallelism"];
const originals = Object.fromEntries(osNames.map((name) => [name, os[name]]));
const fileOriginals = { lstat: fs.lstat, realpath: fs.realpath, statfs: fs.statfs };
const blocked = new Set(["/usr/bin/nvidia-smi", "/usr/sbin/system_profiler",
  ...["/usr/bin", "/usr/local/bin"].flatMap((root) => ["ollama", "llama-cli", "ds4-server"].map((name) => `${root}/${name}`))]);
Object.assign(os, { platform: () => "linux", arch: () => "x64", release: () => "6.18.5",
  totalmem: () => 16 * 1024 ** 3, freemem: () => 8 * 1024 ** 3, availableParallelism: () => 4 });
for (const name of ["lstat", "realpath"]) fs[name] = async (path, ...args) => {
  if (blocked.has(String(path))) throw Object.assign(new Error("Generated missing read-only probe"), { code: "ENOENT" });
  return fileOriginals[name](path, ...args);
};
fs.statfs = async () => ({ type: 0n, bsize: 4096n, blocks: 2097152n, bfree: 1048576n, bavail: 1048576n, files: 1024n, ffree: 1000n });
syncBuiltinESMExports();

const requests = [], apiModelId = "generated-installed-milestone-model";
const server = createServer((request, response) => {
  void (async () => {
    if (request.method === "GET" && request.url.endsWith("/models")) {
      response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ data: [{ id: apiModelId }] })); return;
    }
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    assert.ok(Array.isArray(body.messages)); requests.push(body);
    response.writeHead(200, { "Content-Type": "text/event-stream" }).end([
      `data: ${JSON.stringify({ id: "generated-installed-result", model: apiModelId, choices: [{ index: 0, delta: { role: "assistant", content: "Generated installed exact-window result." }, finish_reason: null }] })}`,
      `data: ${JSON.stringify({ id: "generated-installed-result", model: apiModelId, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 30, completion_tokens: 12, total_tokens: 42 } })}`,
      "data: [DONE]", "",
    ].join("\n\n"));
  })().catch((error) => { console.error("Generated installed model endpoint failed:", error.message); response.destroy(); });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const provider = { state: { status: "disconnected", models: [], login: null, diagnostic: "Generated configured-endpoint-only fixture." },
  onChange() {}, async refresh() {}, async cancel() {}, async logout() {},
  login() { throw new Error("Personal authentication is forbidden."); }, async prepare() { throw new Error("No hosted inference fallback."); } };
const values = new Map(), vault = { read: async (id) => values.get(id) ?? null,
  write: async (id, value) => { values.set(id, value); }, remove: async (id) => { values.delete(id); } };
let runtime, sdk;
const { createRuntime, connectMoguri } = await import(pathToFileURL(join(installed, "dist/sdk/node.mjs")).href);
const { PROTOCOL_VERSION, KUPO_MODEL_ID, configuredReadinessModels } = await import(pathToFileURL(join(installed, "dist/sdk/index.mjs")).href);
const options = { stateDir, retentionKey: Buffer.alloc(32, 0x62), provider, platform: { vault,
  terminal: { vault, defaultRoot: home, executable: process.execPath, args: ["-e", "process.stdin.resume()"] },
  sandbox: { setup: { automatic: false } } } };
const wait = async (read) => {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) { const result = read(); if (result) return result; await new Promise((resolve) => setTimeout(resolve, 15)); }
  throw new Error("Generated installed milestone result did not settle.");
};
try {
  assert.ok(PROTOCOL_VERSION >= 92);
  runtime = await createRuntime(options); sdk = await connectMoguri({ stateDir, autoStart: false });
  const added = await sdk.projects.add(project), created = await sdk.sessions.create(added.id, "Generated installed milestone model controls");
  const settings = sdk.settings.get();
  await sdk.settings.update({ ...settings.values, localModels: [{
    id: "generated-milestone", name: "Generated installed endpoint", enabled: true, auth: "none",
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`, runtime: { kind: "llama-cpp", executablePath, modelPath },
    models: [{ id: apiModelId, name: "Generated installed model", contextWindow: 32768, maxTokens: 512, imageInput: false, toolInput: true }],
  }] }, settings.revision);
  await sdk.models.refresh();
  const model = configuredReadinessModels(sdk.models.catalogue(), "Local")[0];
  assert.ok(model); assert.equal(sdk.sessions.get(created.id).controls.modelId, null);
  const target = (await sdk.models.readinessTarget(created.id, model.id)).target;
  const report = (await sdk.models.readiness(created.id, model.id)).readiness;
  assert.deepEqual(report.target, target); assert.equal(report.observations.host.ramBytes.value, 16 * 1024 ** 3);
  assert.equal(report.observations.model.format.value, "gguf"); assert.equal(report.capacity.status, "unknown");
  await assert.rejects(() => sdk.models.readiness(created.id, model.id, "required"), /required|unknown|missing/i);
  const preview = (await sdk.models.runtimePreview(created.id, model.id)).preview;
  assert.deepEqual(preview.program, { executablePath, args: ["--version"], cwd: "/" });
  const reviewed = await sdk.models.reviewRuntime(created.id, model.id, preview.digest);
  const version = (await sdk.models.readinessWithRuntimeReview(created.id, model.id, reviewed.id)).readiness;
  assert.equal(version.observations.runtime.version.status, "unknown");
  assert.equal(version.observations.runtime.version.evidence.code, "runtime-executable-mutable");
  await assert.rejects(() => sdk.models.readinessWithRuntimeReview(created.id, model.id, reviewed.id), /consumed|replay|already/i);
  assert.equal((await sdk.models.readiness(created.id, model.id)).readiness.target.modelId, model.id); assert.equal(requests.length, 0);
  await sdk.sessions.selectModel(created.id, KUPO_MODEL_ID);
  const pooled = (await sdk.routing.options(created.id, { contextWindow: 24577 })).report;
  assert.equal(pooled.available, true); assert.deepEqual(pooled.modelIds, [model.id]);
  await sdk.sessions.modelOptions(created.id, { contextWindow: 24577 });
  await sdk.command({ type: "draft.save", sessionId: created.id, expectedRevision: 0, text: "Generated installed exact pooled window.", attachments: [] });
  await sdk.command({ type: "message.send", sessionId: created.id, expectedRevision: 1, delivery: "queue" });
  const completed = await wait(() => {
    const session = sdk.sessions.get(created.id);
    if (session?.status === "failed" || session?.status === "partial") throw new Error(session.lastError ?? session.status);
    return session?.status === "completed" && !session.turnId ? session : null;
  });
  assert.equal(requests.length, 1); assert.equal(completed.usage[0].contextWindow, 24577);
  assert.equal(completed.usage[0].totalTokens, 42);
  for (const marker of ["model_runtime_readiness_schema", "kupo_options_schema", "candidate_transports_schema"])
    assert.equal(runtime.store.db.prepare("SELECT value FROM retention_metadata WHERE id=?").get(marker)?.value, "1");
  sdk.disconnect(); await runtime.close(); runtime = await createRuntime(options); sdk = await connectMoguri({ stateDir, autoStart: false });
  await sdk.models.refresh();
  await assert.rejects(() => sdk.models.readinessWithRuntimeReview(created.id, model.id, reviewed.id), /consumed|already|replay/i);
  assert.equal(requests.length, 1); assert.equal(sdk.sessions.get(created.id).controls.modelOptions.contextWindow, 24577);
  console.log(`Installed protocol${PROTOCOL_VERSION} SDK/runtime/worker: actual scoped metadata, user-only one-use runtime identity review, truthful mutable-version refusal, exact pooled window and restart/no replay passed with generated facts only.`);
} finally {
  sdk?.disconnect(); await runtime?.close();
  server.closeAllConnections(); await new Promise((resolve) => server.close(resolve));
  Object.assign(os, originals); Object.assign(fs, fileOriginals); syncBuiltinESMExports();
  await fs.rm(directory, { recursive: true, force: true });
}
