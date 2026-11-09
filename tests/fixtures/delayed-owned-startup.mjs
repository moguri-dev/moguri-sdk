import { appendFile, readFile, rm } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const stateDir = process.env.MOGURI_STATE_DIR;
if (!stateDir) throw new Error("Generated delayed startup requires its explicit owned root.");
const config = JSON.parse(await readFile(join(stateDir, "generated-owned-startup.json"), "utf8"));
if (!Number.isSafeInteger(config.delayMs) || config.delayMs < 0 || config.delayMs > 75_000 ||
  typeof config.packageRoot !== "string" || !isAbsolute(config.packageRoot) || typeof config.home !== "string" || !isAbsolute(config.home)) {
  throw new Error("Generated delayed startup requires an exact package/root and a bounded initialization delay.");
}
const { createRuntime } = await import(pathToFileURL(join(config.packageRoot, "dist/sdk/node.mjs")).href);
const values = new Map(), vault = {
  read: async (id) => values.get(id) ?? null,
  write: async (id, value) => { values.set(id, value); },
  remove: async (id) => { values.delete(id); },
};
const provider = {
  state: config.provider ?? { status: "disconnected", models: [], login: null, diagnostic: null },
  onChange: () => {}, refresh: async () => {}, logout: async () => {}, cancel: async () => {},
  login: () => { throw new Error("Personal authorization is forbidden in generated delayed startup."); },
  prepare: async () => { throw new Error("No inference or input replay is allowed in generated delayed startup."); },
};
const platform = { vault, models: { vault }, remote: { vault, modelsVault: vault }, sandbox: { vault, setup: { automatic: false } },
  terminal: { vault, defaultRoot: config.home, executable: process.execPath, args: ["-e", "process.stdin.resume()"] } };
const preparationRoot = join(stateDir, "generated-startup-prototype");
const preparation = await createRuntime({ stateDir: preparationRoot, retentionKey: Buffer.alloc(32, 0x67), provider, platform });
const prototype = Object.getPrototypeOf(preparation.controller), initialize = prototype.initialize;
await preparation.close();
await rm(preparationRoot, { recursive: true, force: true });
const abort = new AbortController();
let runtime;
process.once("SIGTERM", () => {
  abort.abort();
  void runtime?.close().catch((error) => { console.error("Generated delayed startup cleanup failed:", error.name); process.exitCode = 1; });
});
prototype.initialize = async function() {
  if (this.store.path === join(stateDir, "state.sqlite")) {
    await appendFile(join(stateDir, "generated-owned-startup-owners.jsonl"), JSON.stringify({ pid: process.pid }) + "\n", { mode: 0o600 });
    await delay(config.delayMs, undefined, { signal: abort.signal });
  }
  await initialize.call(this);
};
try {
  runtime = await createRuntime({ stateDir, retentionKey: Buffer.alloc(32, 0x67), provider, platform });
  if (process.connected) { process.send({ type: "ready", pid: process.pid }); process.disconnect(); }
} catch (error) {
  if (!abort.signal.aborted) { console.error("Generated owned startup failed:", error.name); process.exitCode = 1; }
} finally { prototype.initialize = initialize; }
