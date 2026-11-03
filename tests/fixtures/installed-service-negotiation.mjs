import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { generatedNegotiationHistory } from "./negotiation-history.ts";

const installed = resolve(process.argv[2] ?? "."), require = createRequire(import.meta.url);
const { createRuntime } = await import(pathToFileURL(join(installed, "dist/sdk/node.mjs")).href);
const { MoguriSdk } = await import(pathToFileURL(join(installed, "dist/sdk/index.mjs")).href);
const root = await realpath(await mkdtemp(join(tmpdir(), "moguri-installed-negotiation-")));
const stateDir = join(root, "state"), project = join(root, "project"), home = join(root, "home");
await mkdir(project); await mkdir(home);
const provider = { state: { status: "disconnected", models: [], login: null, diagnostic: null }, onChange: () => {},
  refresh: async () => {}, logout: async () => {}, cancel: async () => {},
  login: () => { throw new Error("Personal authorization is forbidden in generated negotiation checks."); },
  prepare: async () => { throw new Error("Inference is forbidden in generated negotiation checks."); } };
const values = new Map(), vault = { read: async (id) => values.get(id) ?? null,
  write: async (id, value) => { values.set(id, value); }, remove: async (id) => { values.delete(id); } };
const options = { stateDir, provider, retentionKey: Buffer.alloc(32, 0x67), platform: { vault, sandbox: { setup: { automatic: false } } } };
let runtime, sdk, application;
try {
  runtime = await createRuntime(options);
  sdk = await new MoguriSdk(runtime.connection).ready();
  const added = await sdk.projects.add(project), session = await sdk.sessions.create(added.id, "Generated negotiation history");
  sdk.disconnect(); sdk = undefined;
  const events = generatedNegotiationHistory(session.id, added.id, "Generated retained negotiation draft.");
  assert.ok(Buffer.byteLength(JSON.stringify(events)) > 50 * 1024 * 1024);
  runtime.store.commit(events);
  await runtime.close(); runtime = await createRuntime(options);
  const count = runtime.store.db.prepare("SELECT COUNT(*) AS count FROM events").get().count;
  const began = performance.now();
  sdk = await new MoguriSdk(runtime.connection).ready();
  const negotiationMs = performance.now() - began;
  assert.equal(sdk.sessions.get(session.id)?.draft.text, "Generated retained negotiation draft.");
  assert.equal(sdk.getState().events.length, 0);
  assert.equal(sdk.getState().snapshot.budgetEntries.length, 0);
  assert.equal(runtime.store.db.prepare("SELECT COUNT(*) AS count FROM events").get().count, count);
  sdk.disconnect(); sdk = undefined;
  if (process.argv[3]) {
    const source = process.argv[3] === "source";
    let executablePath, args;
    if (source) {
      if (installed !== await realpath(resolve("."))) throw new Error("Source desktop negotiation uses only the current checkout.");
      executablePath = require("electron"); args = ["."];
    } else {
      const app = await realpath(resolve(process.argv[3])), release = await realpath(resolve("release"));
      if (!app.startsWith(release + "/") || !app.endsWith("/Moguri.app")) throw new Error("Use only this checkout's generated release bundle, never a personal installed app.");
      executablePath = join(app, "Contents", "MacOS", "Moguri"); args = [];
    }
    const { _electron } = await import("@playwright/test");
    const opening = performance.now();
    application = await _electron.launch({ executablePath, args,
      env: { PATH: "/usr/bin:/bin", HOME: home, MOGURI_STATE_DIR: stateDir, MOGURI_LOCATION_DIR: join(root, "location"), MOGURI_TEST_WINDOW: "hidden" },
      timeout: 15_000 });
    const page = await application.firstWindow();
    await page.getByRole("button", { name: "Settings", exact: true }).waitFor();
    const desktopMs = performance.now() - opening;
    assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((window) => window.isVisible())), false);
    assert.equal(runtime.store.db.prepare("SELECT COUNT(*) AS count FROM events").get().count, count);
    console.log(JSON.stringify({ primitive: source ? "hidden-source-retained-history-negotiation" : "actual-packaged-retained-history-negotiation",
      historyBytes: Buffer.byteLength(JSON.stringify(events)), negotiationMs, desktopMs, modelCalls: 0, personalState: false }));
    await application.close(); application = undefined;
  } else console.log(JSON.stringify({ primitive: "installed-sdk-retained-history-negotiation",
    historyBytes: Buffer.byteLength(JSON.stringify(events)), negotiationMs, modelCalls: 0, personalState: false }));
} finally {
  sdk?.disconnect(); await application?.close(); await runtime?.close();
  await rm(root, { recursive: true, force: true });
}
