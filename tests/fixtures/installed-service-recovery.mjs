import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { chmod, copyFile, cp, lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
// CI stretches harness deadlines on slower shared runners (#1); product latency budgets are never scaled.
const ciTime = (milliseconds) => milliseconds * Math.max(1, Number(process.env.MOGURI_TEST_TIME_SCALE) || 1);

const installed = resolve(process.argv[2] ?? ".");
const require = createRequire(join(installed, "package.json")), execute = promisify(execFile);
const { MoguriSdk } = await import(pathToFileURL(join(installed, "dist/sdk/index.mjs")).href);
const { readConnection, stopMoguriService } = await import(pathToFileURL(join(installed, "dist/sdk/node.mjs")).href);
const root = await realpath(await mkdtemp(join(tmpdir(), "moguri-installed-service-recovery-")));
const appRoot = join(root, "Generated Moguri.app", "Contents", "Resources", "app");
const stateDir = join(root, "state"), home = join(root, "home"), dependencies = join(appRoot, "node_modules");
const env = { PATH: "/usr/bin:/bin", HOME: home, MOGURI_STATE_DIR: stateDir, MOGURI_LOCATION_DIR: join(root, "location") };
let connection, sdk, application, launched = false, failure;
try {
  await mkdir(dependencies, { recursive: true }); await mkdir(home);
  await cp(join(installed, "dist"), join(appRoot, "dist"), { recursive: true });
  await cp(join(installed, "bin"), join(appRoot, "bin"), { recursive: true });
  await copyFile(join(installed, "package.json"), join(appRoot, "package.json"));
  const manifest = JSON.parse(await readFile(join(installed, "package.json"), "utf8"));
  for (const name of Object.keys(manifest.dependencies)) {
    if (name === "@napi-rs/keyring" || name === "node") continue;
    let dependency;
    for (const directory of require.resolve.paths(name) ?? []) {
      try { await lstat(join(directory, name, "package.json")); dependency = join(directory, name); break; }
      catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    if (!dependency) throw new Error(`The installed dependency ${name} is missing; no ambient replacement was used.`);
    const target = join(dependencies, name); await mkdir(dirname(target), { recursive: true }); await symlink(dependency, target);
  }
  const node = join(dependencies, "node", "bin", "node");
  await mkdir(dirname(node), { recursive: true });
  let pinnedNode;
  try { pinnedNode = require.resolve("node/bin/node"); }
  catch (error) {
    if (error.code !== "MODULE_NOT_FOUND") throw error;
    // The SDK package does not ship a Node runtime; the repository's pinned one stands in for the embedder's bundled runtime.
    pinnedNode = createRequire(import.meta.url).resolve("node/bin/node");
  }
  await copyFile(pinnedNode, node, constants.COPYFILE_FICLONE);
  await chmod(node, 0o755);
  const keyring = join(dependencies, "@napi-rs", "keyring");
  await mkdir(keyring, { recursive: true });
  await writeFile(join(keyring, "package.json"), JSON.stringify({ name: "@napi-rs/keyring", type: "module", exports: "./index.mjs" }));
  await writeFile(join(keyring, "index.mjs"), `
    import {readFile,writeFile} from "node:fs/promises";
    const path=${JSON.stringify(join(root, "generated-secrets.json"))};
    async function read(){try{return JSON.parse(await readFile(path,"utf8"));}catch(error){if(error.code==="ENOENT")return {};throw error;}}
    export class AsyncEntry {
      constructor(service,account){if(!service.startsWith("dev.moguri."))throw new Error("Only generated Moguri namespaces are allowed.");this.id=JSON.stringify([service,account]);}
      async getPassword(){return (await read())[this.id]??null;}
      async setPassword(value){const entries=await read();entries[this.id]=value;await writeFile(path,JSON.stringify(entries),{mode:0o600});}
      async deleteCredential(){const entries=await read();delete entries[this.id];await writeFile(path,JSON.stringify(entries),{mode:0o600});}
    }
  `);
  // Service control runs the copied SDK under the bundled Node runtime, as an embedding application would.
  const control = `
    const { connectMoguri, restartMoguriService, stopMoguriService } = await import(${JSON.stringify(pathToFileURL(join(appRoot, "dist", "sdk", "node.mjs")).href)});
    const [action] = process.argv.slice(1), stateDir = process.env.MOGURI_STATE_DIR;
    if (action === "stop") await stopMoguriService(stateDir);
    else if (action === "connect") (await connectMoguri()).disconnect();
    else {
      const connection = await restartMoguriService({ stateDir, explicitStateDir: true });
      console.log(JSON.stringify({ pid: connection.pid, protocolVersion: connection.protocolVersion, stateDir }));
    }
  `;
  const service = (action) => execute(node, ["--input-type=module", "--eval", control, action], { env, timeout: ciTime(15_000) });
  await assert.rejects(() => lstat(join(appRoot, "service.mjs")), { code: "ENOENT" });
  assert.deepEqual(await readFile(join(appRoot, "dist", "service.mjs")), await readFile(join(installed, "dist", "service.mjs")));
  launched = true;
  const cold = JSON.parse((await service("restart")).stdout);
  connection = await readConnection(stateDir);
  assert.equal(cold.pid, connection.pid);
  assert.equal(cold.protocolVersion, connection.protocolVersion);
  assert.notEqual(connection.pid, process.pid);
  sdk = await new MoguriSdk(connection).ready();
  const projectRoot = join(root, "project"); await mkdir(projectRoot);
  const project = await sdk.projects.add(projectRoot), session = await sdk.sessions.create(project.id, "Generated packaged recovery");
  await sdk.command({ type: "draft.save", sessionId: session.id, expectedRevision: 0, text: "Generated retained held input.", attachments: [] });
  const held = await sdk.command({ type: "message.send", sessionId: session.id, expectedRevision: 1, delivery: "queue", held: true });
  await sdk.command({ type: "draft.save", sessionId: session.id, expectedRevision: 2, text: "Generated retained packaged draft.", attachments: [] });
  const artifact = await sdk.artifacts.create(session.id, { kind: "research-note", name: "Generated packaged retention", text: "Generated independent artifact survives service restart." });
  let terminal, before, owner, terminalMarker;
  if (process.platform === "darwin") {
    terminal = await sdk.terminal.open(session.id);
    before = await sdk.terminal.read(terminal.id); owner = sdk.getState().snapshot.terminalOwners[0];
    terminalMarker = join(projectRoot, "generated-terminal-once");
    await sdk.terminal.input(terminal.id, `printf 'GENERATED_ONCE\\n' >> '${terminalMarker}'\n`);
    const deadline = performance.now() + ciTime(5000);
    while (true) {
      // The shell creates the file before writing it, so an empty read is still in progress.
      try { const text = await readFile(terminalMarker, "utf8"); if (text) { assert.equal(text, "GENERATED_ONCE\n"); break; } }
      catch (error) { if (error.code !== "ENOENT") throw error; }
      if (performance.now() >= deadline) throw new Error("The generated user terminal did not execute its one explicit input.");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  const originalPid = connection.pid;
  sdk.disconnect(); sdk = undefined;
  const restarted = JSON.parse((await service("restart")).stdout);
  connection = await readConnection(stateDir);
  assert.equal(restarted.pid, connection.pid); assert.notEqual(restarted.pid, originalPid);
  sdk = await new MoguriSdk(connection).ready();
  const retained = sdk.getState().snapshot.sessions.find((item) => item.id === session.id);
  assert.equal(retained?.draft.text, "Generated retained packaged draft.");
  assert.equal(retained.queue[0]?.id, held.id); assert.equal(retained.queue[0]?.held, true);
  assert.equal((await sdk.artifacts.read(artifact.id)).text, "Generated independent artifact survives service restart.");
  assert.equal(sdk.getState().snapshot.budgetEntries.length, 0);
  if (terminal) {
    const after = await sdk.terminal.read(terminal.id);
    assert.equal(after.terminal.pid, before.terminal.pid);
    assert.equal(after.terminal.ownerId, owner.id);
    assert.notEqual(after.terminal.attachmentId, before.terminal.attachmentId);
    assert.equal(await readFile(terminalMarker, "utf8"), "GENERATED_ONCE\n");
  }
  sdk.disconnect(); sdk = undefined;
  await service("stop"); launched = false; connection = undefined;
  const keyBytes = await readFile(join(root, "generated-secrets.json"), "utf8");
  await service("stop");
  const recovered = JSON.parse((await service("restart")).stdout);
  launched = true; connection = await readConnection(stateDir);
  assert.equal(recovered.pid, connection.pid);
  assert.equal(await readFile(join(root, "generated-secrets.json"), "utf8"), keyBytes);
  sdk = await new MoguriSdk(connection).ready();
  assert.equal(sdk.getState().snapshot.sessions.find((item) => item.id === session.id)?.queue[0]?.id, held.id);
  assert.equal((await sdk.artifacts.read(artifact.id)).text, "Generated independent artifact survives service restart.");
  sdk.disconnect(); sdk = undefined;
  await service("stop"); launched = false; connection = undefined;
  await service("connect");
  launched = true; connection = await readConnection(stateDir);
  if (process.argv[3]) {
    if (process.platform !== "darwin") throw new Error("Actual hidden packaged startup requires macOS.");
    const app = await realpath(resolve(process.argv[3])), release = await realpath(resolve("release"));
    if (!app.startsWith(release + "/") || !app.endsWith("/Moguri.app")) throw new Error("Use only this checkout's generated release bundle, never a personal installed app.");
    const contents = resolve(appRoot, "../..");
    for (const name of ["MacOS", "Frameworks", "Info.plist"]) {
      await cp(join(app, "Contents", name), join(contents, name), { recursive: true, mode: constants.COPYFILE_FICLONE, verbatimSymlinks: true });
    }
    await service("stop"); launched = false; connection = undefined;
    const { _electron } = await import("@playwright/test");
    launched = true;
    application = await _electron.launch({ executablePath: join(contents, "MacOS", "Moguri"), args: [],
      env: { ...env, MOGURI_TEST_WINDOW: "hidden" }, timeout: ciTime(15_000) });
    const page = await application.firstWindow();
    await page.getByRole("button", { name: "Settings", exact: true }).waitFor();
    connection = await readConnection(stateDir);
    sdk = await new MoguriSdk(connection).ready();
    assert.equal(sdk.sessions.get(session.id)?.draft.text, "Generated retained packaged draft.");
    assert.equal(sdk.sessions.get(session.id)?.queue[0]?.id, held.id);
    sdk.disconnect(); sdk = undefined;
    await application.close(); application = undefined; launched = false; connection = undefined;
    await assert.rejects(() => lstat(join(stateDir, "service.lock")), { code: "ENOENT" });
    console.log("Actual packaged Electron and its unmodified Node SDK/service bytes cold-started hidden, recovered the exact generated history, and confirmed owned shutdown before exit.");
  }
  const log = await readFile(join(stateDir, "service.log"), "utf8");
  assert.equal(log.includes("MODULE_NOT_FOUND"), false);
  assert.equal(log.match(/Moguri service ready on loopback/g)?.length, process.argv[3] ? 5 : 4);
  if (connection) await stopMoguriService(stateDir, { expectedConnection: connection });
  launched = false; connection = undefined;
  console.log("Installed SDK service control under the bundled Node runtime and exact service entrypoint passed cold restart, authenticated restart, already-stopped restart, generic SDK auto-start and encrypted draft/queue/artifact/key retention; macOS preserves the exact authenticated PTY with no input replay. Generated secrets only, no ambient Node, authorization or inference.");
} catch (error) { failure = error; throw error; } finally {
  try {
    sdk?.disconnect();
    await application?.close();
    if (launched && !connection) {
      try { connection = await readConnection(stateDir); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    if (connection) await stopMoguriService(stateDir, { expectedConnection: connection });
    if (launched && !connection) {
      try { await lstat(join(stateDir, "service.lock")); throw new Error(`Generated ownership remains unconfirmed; retained ${root}.`); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    await rm(root, { recursive: true, force: true });
  } catch (cleanup) {
    // A cleanup failure must not replace the error that explains it (#1).
    if (!failure) throw cleanup;
    console.error("Generated installed-service cleanup also failed:", cleanup instanceof Error ? cleanup.message : cleanup);
    let log = "";
    try { log = await readFile(join(stateDir, "service.log"), "utf8"); } catch (error) { if (error.code !== "ENOENT") throw error; }
    if (log) console.error(`Retained generated service.log tail:\n${log.slice(-4000)}`);
  }
}
