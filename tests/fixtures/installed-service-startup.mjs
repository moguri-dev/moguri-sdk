import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
// CI stretches harness deadlines on slower shared runners (#1); product latency budgets are never scaled.
const ciTime = (milliseconds) => milliseconds * Math.max(1, Number(process.env.MOGURI_TEST_TIME_SCALE) || 1);

const installed = process.argv[2];
if (!installed) throw new Error("Provide the independently installed package root.");
const nodeEntry = pathToFileURL(join(installed, "dist/sdk/node.mjs")).href;
const { createRuntime, ensureConnection, readConnection, stopMoguriService, ServiceStartupUnconfirmed } = await import(nodeEntry);
const { MoguriSdk } = await import(pathToFileURL(join(installed, "dist/sdk/index.mjs")).href);
const root = await realpath(await mkdtemp(join(tmpdir(), "moguri-installed-startup-"))), stateDir = join(root, "state"), project = join(root, "project");
await mkdir(project);
const provider = { state: { status: "disconnected", models: [], login: null, diagnostic: null }, onChange: () => {},
  refresh: async () => {}, logout: async () => {}, cancel: async () => {},
  login: () => { throw new Error("No personal authorization in generated startup qualification."); },
  prepare: async () => { throw new Error("No inference in generated startup qualification."); } };
const values = new Map(), vault = { read: async (id) => values.get(id) ?? null,
  write: async (id, value) => { values.set(id, value); }, remove: async (id) => { values.delete(id); } };
let runtime, sdk, connection, launched = false, expectedStartupPid;
try {
  runtime = await createRuntime({ stateDir, retentionKey: Buffer.alloc(32, 0x67), provider, platform: { vault, sandbox: { setup: { automatic: false } } } });
  sdk = await new MoguriSdk(runtime.connection).ready();
  const added = await sdk.projects.add(project), created = await sdk.sessions.create(added.id);
  await sdk.command({ type: "draft.save", sessionId: created.id, expectedRevision: 0, text: "Generated installed slow-start draft.", attachments: [] });
  sdk.disconnect(); sdk = undefined; await runtime.close(); runtime = undefined;
  const startup = join(root, "generated-installed-startup.mjs");
  await writeFile(startup, `
    import {createRuntime} from ${JSON.stringify(nodeEntry)};
    import {setTimeout as delay} from 'node:timers/promises';
    const stateDir=process.env.MOGURI_STATE_DIR;
    if(!stateDir)throw new Error("An exact generated state directory is required.");
    const provider={state:{status:"disconnected",models:[],login:null,diagnostic:null},onChange:()=>{},
      refresh:async signal=>{await delay(11000,undefined,{signal});},logout:async()=>{},cancel:async()=>{},
      login:()=>{throw new Error("No personal authorization.");},prepare:async()=>{throw new Error("No inference.");}};
    const values=new Map(),vault={read:async id=>values.get(id)??null,write:async(id,value)=>{values.set(id,value);},remove:async id=>{values.delete(id);}};
    const runtime=await createRuntime({stateDir,retentionKey:Buffer.alloc(32,0x67),provider,platform:{vault,sandbox:{setup:{automatic:false}}}});
    process.once("SIGTERM",()=>{void runtime.close().catch(error=>{console.error(error.message);process.exitCode=1;});});
  `, { mode: 0o600 });
  const began = performance.now();
  launched = true;
  connection = await ensureConnection({ stateDir, servicePath: startup, runtime: process.execPath });
  const elapsed = performance.now() - began;
  assert.ok(elapsed < 2000, "Packed startup must not wait for the generated eleven-second provider discovery.");
  sdk = await new MoguriSdk(connection).ready();
  assert.equal(sdk.getState().snapshot.sessions.find((session) => session.id === created.id)?.draft.text, "Generated installed slow-start draft.");
  assert.equal(sdk.getState().snapshot.budgetEntries.length, 0);
  await stopMoguriService(stateDir, { expectedConnection: connection }); launched = false; connection = undefined; sdk.disconnect(); sdk = undefined;
  console.log(`Installed SDK cold startup authenticated its real owner after ${Math.round(elapsed)} ms, preserving generated encrypted history without inference or reset.`);
  if (typeof ServiceStartupUnconfirmed === "function") {
    await writeFile(join(stateDir, "generated-owned-startup.json"), JSON.stringify({
      delayMs: 61_100, packageRoot: installed, home: project,
    }), { mode: 0o600 });
    const began = performance.now();
    let captured;
    launched = true;
    try { await ensureConnection({ stateDir, servicePath: join(process.cwd(), "tests/fixtures/delayed-owned-startup.mjs"), runtime: process.execPath }); }
    catch (error) {
      if (!(error instanceof ServiceStartupUnconfirmed)) throw error;
      captured = error.review; expectedStartupPid = captured.pid;
    }
    assert.ok(captured, "The actual installed SDK must retain an unconfirmed original-owner review at its real deadline.");
    const unconfirmedMs = performance.now() - began;
    assert.ok(unconfirmedMs >= 59_900 && unconfirmedMs < 65_000);
    connection = await ensureConnection({ stateDir, startupReview: captured, servicePath: join(root, "generated-do-not-launch.mjs") });
    assert.equal(connection.pid, expectedStartupPid);
    sdk = await new MoguriSdk(connection).ready();
    assert.equal(sdk.sessions.get(created.id).draft.text, "Generated installed slow-start draft.");
    assert.equal(sdk.getState().snapshot.budgetEntries.length, 0);
    const configuration = (await sdk.application.status()).configuration;
    assert.equal(configuration.values.keepServiceOnWindowClose, true);
    await sdk.application.configure({ keepServiceOnWindowClose: false }, configuration.revision);
    assert.equal((await sdk.application.status()).configuration.values.keepServiceOnWindowClose, false);
    assert.equal((await readFile(join(stateDir, "generated-owned-startup-owners.jsonl"), "utf8")).trim().split("\n").length, 1);
    await stopMoguriService(stateDir, { expectedConnection: connection });
    launched = false; connection = undefined; sdk.disconnect(); sdk = undefined;
    console.log(JSON.stringify({ primitive: "installed-sdk-original-unconfirmed-startup", unconfirmedMs,
      authenticatedMs: performance.now() - began, originalOwnerOnly: true, backgroundOptOut: "acknowledged", modelCalls: 0 }));
  }
} finally {
  sdk?.disconnect(); await runtime?.close();
  if (launched && !connection) {
    const deadline = performance.now() + ciTime(15000);
    while (performance.now() < deadline) {
      try { connection = await readConnection(stateDir); break; }
      catch (error) { if (error?.code !== "ENOENT") throw error; }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  if (launched && !connection) throw new Error(`Generated startup ownership is unconfirmed; its private fixture was retained at ${root}.`);
  if (connection) {
    if (expectedStartupPid && connection.pid !== expectedStartupPid) throw new Error("The generated original startup owner changed. No different owner was stopped or fixture deleted.");
    await stopMoguriService(stateDir, { expectedConnection: connection });
  }
  await rm(root, { recursive: true, force: true });
}
