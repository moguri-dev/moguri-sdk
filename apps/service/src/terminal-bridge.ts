import { createHash } from "node:crypto";
import { fork } from "node:child_process";
import { createRequire } from "node:module";
import { lstat, mkdir, readFile, readdir, realpath, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { MoguriError, isRecord, parse } from "../../../packages/protocol/src/core.ts";
import { PreparedRemoteTerminalOwnerSchema, type PreparedRemoteTerminalOwner, type RemoteTerminalOwner } from "../../../packages/protocol/src/terminals.ts";
import { TerminalChannel } from "./terminal-channel.ts";
import { assertTerminalEndpoint, remoteTerminalPeer, terminalBinding, terminalKey, terminalOwnerScope } from "./terminal-identity.ts";
import { terminalBrokerPath, terminalBuildDigests } from "./terminal-build.ts";
import { TERMINAL_FRAME_BYTES, TerminalRequestSchema } from "./terminal-protocol.ts";
import { RemoteTerminalInitSchema } from "./remote-terminal-protocol.ts";
import { JsonLineChannel } from "./worker-wire.ts";
import { terminalEnvironment } from "./terminal-shell.ts";

const ownerName = (owner: RemoteTerminalOwner) => `mo-${createHash("sha256").update(owner.scopeDigest).digest("hex").slice(0, 12)}`;
const marker = (owner: RemoteTerminalOwner) => JSON.stringify({ format: "moguri-remote-console-owner", version: 1, id: owner.id, profileId: owner.profileId,
  buildDigest: owner.buildDigest, scopeDigest: owner.scopeDigest, remote: owner.remote, createdAt: owner.createdAt });
async function fileExists(path: string): Promise<boolean> {
  try { await lstat(path); return true; }
  catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") return false; throw error; }
}
async function checkedFile(path: string, expected: string): Promise<void> {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.uid !== process.getuid?.() || metadata.mode & 0o077 || metadata.size > 64 * 1024 ||
    await readFile(path, "utf8") !== expected) throw new MoguriError("terminal_remote_metadata", "Remote owner metadata is no longer a bounded private original file. Nothing was adopted or removed.", 409);
}
async function checkedOwner(owner: RemoteTerminalOwner): Promise<void> {
  const build = await terminalBuildDigests();
  if (owner.remote.peerDigest !== remoteTerminalPeer(owner.remote.target) || owner.scopeDigest !== terminalOwnerScope(owner) ||
    owner.buildDigest !== build.brokerDigest || owner.remote.brokerDigest !== build.brokerDigest || owner.remote.bridgeDigest !== build.bridgeDigest) {
    throw new MoguriError("terminal_remote_identity", "Remote console peer/scope/helper identity differs from its retained intent. No key, shell or fallback was used.", 409);
  }
}
async function preparedPath(owner: RemoteTerminalOwner): Promise<PreparedRemoteTerminalOwner> {
  const directory = owner.directory ?? join(await realpath(tmpdir()), ownerName(owner));
  if (basename(directory) !== ownerName(owner)) throw new MoguriError("terminal_remote_path", "The remote private path does not belong to this exact original owner.", 409);
  return parse(PreparedRemoteTerminalOwnerSchema, { ...owner, directory, endpoint: join(directory, "control.sock"), status: owner.status === "preparing" ? "starting" : owner.status });
}
async function prepare(owner: RemoteTerminalOwner): Promise<PreparedRemoteTerminalOwner> {
  if (owner.directory !== null || owner.pid !== null || !["preparing", "unconfirmed"].includes(owner.status)) throw new MoguriError("terminal_remote_prepare", "Only the original unprepared owner can prepare an endpoint. No replacement was selected.", 409);
  const prepared = await preparedPath(owner);
  let created = false;
  try { await mkdir(prepared.directory, { mode: 0o700 }); created = true; }
  catch (error) { if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error; }
  await assertTerminalEndpoint(prepared, false);
  const metadata = join(prepared.directory, "owner.json"), expected = marker(owner);
  if (created) await writeFile(metadata, expected, { flag: "wx", mode: 0o600 }); else await checkedFile(metadata, expected);
  if (await fileExists(join(prepared.directory, "admitted.json"))) throw new MoguriError("terminal_remote_admitted", "This original owner already has a broker admission. Attach/inspect it; no broker was replayed.", 409);
  return { ...prepared, status: "starting", updatedAt: new Date().toISOString(), diagnostic: "Exact Remote endpoint prepared; no broker or PTY started." };
}
async function inspectPath(owner: PreparedRemoteTerminalOwner): Promise<void> {
  if (owner.endpoint !== join(owner.directory, "control.sock") || basename(owner.directory) !== ownerName(owner)) throw new MoguriError("terminal_remote_path", "Remote endpoint differs from its retained private path. No alternative path was used.", 409);
  await assertTerminalEndpoint(owner, false); await checkedFile(join(owner.directory, "owner.json"), marker(owner));
}
async function start(owner: PreparedRemoteTerminalOwner, key: string): Promise<PreparedRemoteTerminalOwner> {
  terminalKey(key); await inspectPath(owner);
  if (owner.pid !== null || owner.status !== "starting") throw new MoguriError("terminal_remote_start", "This owner already has a process or lost start authority. No broker was replayed.", 409);
  try { await writeFile(join(owner.directory, "admitted.json"), marker(owner), { flag: "wx", mode: 0o600 }); }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") throw new MoguriError("terminal_remote_admitted", "The original broker was already admitted. Reconcile its exact key/endpoint; no replacement.", 409);
    throw error;
  }
  const path = terminalBrokerPath(), child = fork(path, ["--moguri-terminal-owner", owner.id], {
    execArgv: path.endsWith(".ts") ? ["--import", createRequire(import.meta.url).resolve("tsx")] : [], detached: true, stdio: ["ignore", "ignore", "ignore", "ipc"],
    env: terminalEnvironment(owner.directory),
  });
  if (!child.pid) throw new MoguriError("terminal_remote_pid", "Remote broker admission has no observed PID. Preserve its original key/endpoint; no retry.", 409);
  const expected = { ...owner, pid: child.pid };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const ready = new Promise<PreparedRemoteTerminalOwner>((resolve, reject) => {
      timer = setTimeout(() => reject(new MoguriError("terminal_remote_timeout", "Remote broker startup is unconfirmed. Its admission was not replayed.", 409)), 8000);
      child.once("error", reject); child.once("exit", () => reject(new Error("Remote broker exited before readiness.")));
      child.once("message", (raw: unknown) => {
        try {
          if (!isRecord(raw) || raw.kind !== "terminal-owner-ready") throw new Error("Remote broker rejected its admitted bootstrap.");
          const actual = parse(PreparedRemoteTerminalOwnerSchema, raw.owner);
          if (actual.id !== owner.id || actual.pid !== expected.pid || actual.scopeDigest !== owner.scopeDigest || actual.buildDigest !== owner.buildDigest) throw new Error("Remote broker readiness changed its exact original identity.");
          resolve(actual);
        } catch (error) { reject(error); }
      });
    });
    child.send({ kind: "terminal-owner", owner: expected, key }); return await ready;
  } finally { clearTimeout(timer); if (child.connected) child.disconnect(); child.unref(); }
}
async function removeKnown(path: string, socket = false): Promise<void> {
  try {
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink() || metadata.uid !== process.getuid?.() || metadata.mode & 0o077 || (socket ? !metadata.isSocket() : !metadata.isFile())) {
      throw new MoguriError("terminal_remote_cleanup", "A private Remote path changed type/ownership. Nothing unrelated was removed.", 409);
    }
    await unlink(path);
  } catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
}
async function cleanup(owner: RemoteTerminalOwner): Promise<void> {
  if (owner.status !== "stopped" || owner.cleanup !== "pending") throw new MoguriError("terminal_remote_cleanup", "Remote cleanup requires an exact confirmed-stopped owner and retained pending cleanup intent.", 409);
  const prepared = await preparedPath(owner);
  if (!await fileExists(prepared.directory)) return;
  await assertTerminalEndpoint(prepared, false);
  const entries = await readdir(prepared.directory), allowed = ["owner.json", "admitted.json", "cleanup.json", "control.sock"];
  if (entries.some((entry) => !allowed.includes(entry))) throw new MoguriError("terminal_remote_cleanup", "Unexpected Remote runtime files were retained. Inspect them before retrying exact cleanup.", 409);
  if (!entries.length) { await rmdir(prepared.directory); return; }
  const cleanupPath = join(prepared.directory, "cleanup.json"), expected = marker(owner);
  if (await fileExists(cleanupPath)) await checkedFile(cleanupPath, expected);
  else {
    await checkedFile(join(prepared.directory, "owner.json"), expected);
    if (owner.pid === null && await fileExists(join(prepared.directory, "admitted.json"))) throw new MoguriError("terminal_remote_unconfirmed", "Broker admission exists without an observed stopped PID. Restore its original key and reconcile; nothing was removed.", 409);
    if (owner.pid !== null) {
      let stopped = false;
      for (let index = 0; index < 40; index++) {
        try { process.kill(owner.pid, 0); }
        catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error; stopped = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      if (!stopped) throw new MoguriError("terminal_remote_live", "The observed Remote PID is still present. No process was guessed or private capability removed.", 409);
    }
    await writeFile(cleanupPath, expected, { flag: "wx", mode: 0o600 });
  }
  if (await fileExists(join(prepared.directory, "admitted.json"))) await checkedFile(join(prepared.directory, "admitted.json"), expected);
  await removeKnown(prepared.endpoint, true);
  await removeKnown(join(prepared.directory, "admitted.json")); await removeKnown(join(prepared.directory, "owner.json"));
  const remaining = await readdir(prepared.directory);
  if (remaining.some((entry) => entry !== "cleanup.json")) throw new MoguriError("terminal_remote_cleanup", "Remote runtime contents changed during cleanup. Exact remaining files were retained.", 409);
  await removeKnown(cleanupPath); await rmdir(prepared.directory);
}

export function runRemoteTerminalBridge(): void {
  const wire = new JsonLineChannel(process.stdin, process.stdout, false, TERMINAL_FRAME_BYTES);
  let channel: TerminalChannel | undefined, initialized = false, active = true, chain = Promise.resolve();
  const detach = () => { active = false; channel?.detach(); process.stdin.destroy(); wire.end(); };
  wire.on("error", () => { console.error("Remote user-console protocol failed. No input or launch was replayed."); process.exitCode = 1; detach(); });
  wire.on("close", detach); process.once("SIGTERM", detach); process.once("SIGHUP", detach);
  wire.on("message", (raw: unknown) => {
    const id = initialized && isRecord(raw) && typeof raw.id === "string" ? raw.id : "bootstrap";
    chain = chain.then(async () => {
      if (!active) throw new MoguriError("terminal_remote_detached", "User-console authority detached before dispatch. No input was replayed.", 409);
      if (!initialized) {
        initialized = true; const init = parse(RemoteTerminalInitSchema, raw);
        if (init.action === "binding") {
          const build = await terminalBuildDigests();
          if (build.bridgeDigest !== init.bridgeDigest || build.brokerDigest !== init.brokerDigest) throw new MoguriError("terminal_remote_build", "The exact Remote console bridge/broker build changed before root admission.", 409);
          const binding = terminalBinding({ ...init, env: "Remote" });
          if (active) wire.send({ id, ok: true, value: { binding } }, detach); return;
        }
        await checkedOwner(init.owner);
        if (init.action === "prepare") { const owner = await prepare(init.owner); if (active) wire.send({ id, ok: true, value: { owner } }, detach); return; }
        if (init.action === "cleanup") { await cleanup(init.owner); if (active) wire.send({ id, ok: true, value: { removed: true } }, detach); return; }
        const owner = init.action === "start" ? await start(init.owner, init.key) : init.owner;
        await inspectPath(owner);
        if (!active) return;
        const attached = await TerminalChannel.connect(owner, init.key, init.clientId, () => detach()); channel = attached.channel;
        wire.send({ id, ok: true, value: { info: attached.info } }); return;
      }
      if (!channel) throw new MoguriError("terminal_remote_unattached", "No exact authenticated Remote owner controls this stream.", 409);
      const { id: requestId, ...request } = parse(TerminalRequestSchema, raw), value = await channel.request(request);
      if (active) wire.send({ id: requestId, ok: true, value });
    }).catch((error: unknown) => {
      console.error("Remote user-console operation failed:", error instanceof MoguriError ? error.code : "terminal_remote_operation");
      if (active) wire.send({ id, ok: false, code: error instanceof MoguriError ? error.code : "terminal_remote_operation",
        message: error instanceof MoguriError ? error.message : "Remote console operation failed or is unconfirmed. No launch/input was replayed." }, channel ? undefined : detach);
    });
  });
}
if (process.argv.includes("--moguri-terminal-bridge")) runRemoteTerminalBridge();
