import { fork } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { lstat, mkdtemp, readFile, readdir, realpath, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isRecord, MoguriError, parse } from "../../packages/protocol/src/core.ts";
import type { PreparedTerminalOwner } from "../../packages/protocol/src/terminals.ts";
import { TerminalChannel } from "../../apps/service/src/terminal-channel.ts";
import { assertTerminalEndpoint, preparedTerminalOwner, terminalBinding, terminalKey, terminalOwnerScope } from "../../apps/service/src/terminal-identity.ts";
import { TERMINAL_FRAME_BYTES, TerminalOwnerInfoSchema, TerminalRequestSchema } from "../../apps/service/src/terminal-protocol.ts";
import { JsonLineChannel } from "../../apps/service/src/worker-wire.ts";
import { RemoteConsoleInitSchema } from "./remote-terminal-wire.ts";

const broker = fileURLToPath(new URL("../../apps/service/src/terminal-broker.ts", import.meta.url));
const build = async () => createHash("sha256").update(await readFile(broker)).digest("hex");
const admission = (owner: PreparedTerminalOwner) => JSON.stringify({ format: "moguri-private-remote-console-admission", version: 1,
  ownerId: owner.id, profileId: owner.profileId, scopeDigest: owner.scopeDigest, buildDigest: owner.buildDigest });
async function start(owner: PreparedTerminalOwner, key: string): Promise<PreparedTerminalOwner> {
  terminalKey(key); await assertTerminalEndpoint(owner, false);
  if (owner.pid !== null || owner.status !== "starting" || owner.buildDigest !== await build()) throw new MoguriError("remote_console_build", "This exact unstarted broker/build is not eligible. No replacement was started.", 409);
  try { await writeFile(join(owner.directory, "admitted.json"), admission(owner), { flag: "wx", mode: 0o600 }); }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") throw new MoguriError("remote_console_admitted", "This owner already has a start admission. Attach/inspect it explicitly; no owner was replayed.", 409);
    throw error;
  }
  const child = fork(broker, ["--moguri-terminal-owner", owner.id], { execArgv: ["--import", createRequire(import.meta.url).resolve("tsx")],
    detached: true, stdio: ["ignore", "ignore", "ignore", "ipc"], env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: process.env.HOME ?? owner.directory, LANG: "en_US.UTF-8" } });
  if (!child.pid) throw new MoguriError("remote_console_pid", "The admitted broker did not publish its exact PID. Inspect it; no launch was replayed.", 409);
  const expected = { ...owner, pid: child.pid };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const ready = new Promise<PreparedTerminalOwner>((resolve, reject) => {
      timer = setTimeout(() => reject(new MoguriError("remote_console_timeout", "Remote broker startup is unconfirmed. Preserve its original admission/key; no retry.", 409)), 8000);
      child.once("error", reject);
      child.once("exit", () => reject(new Error("Remote broker exited before readiness.")));
      child.once("message", (raw: unknown) => {
        try {
          if (!isRecord(raw) || raw.kind !== "terminal-owner-ready") throw new Error("Remote broker rejected bootstrap.");
          const info = parse(TerminalOwnerInfoSchema, { owner: raw.owner, terminalIds: [], nodeVersion: process.versions.node });
          if (info.owner.id !== expected.id || info.owner.pid !== expected.pid || info.owner.buildDigest !== expected.buildDigest) throw new Error("Remote broker readiness changed its admitted identity.");
          resolve(preparedTerminalOwner(info.owner));
        } catch (error) { reject(error); }
      });
    });
    child.send({ kind: "terminal-owner", owner: expected, key });
    const result = await ready; child.unref(); return result;
  } finally { clearTimeout(timer); if (child.connected) child.disconnect(); child.unref(); }
}
async function cleanup(owner: PreparedTerminalOwner): Promise<void> {
  await assertTerminalEndpoint(owner, false);
  const entries = await readdir(owner.directory);
  if (!entries.length && owner.pid === null && owner.status === "starting") { await rmdir(owner.directory); return; }
  if (entries.some((entry) => !["control.sock", "admitted.json"].includes(entry))) throw new MoguriError("remote_console_cleanup", "Unexpected private runtime files were retained. Inspect them before an explicit cleanup retry.", 409);
  const marker = await lstat(join(owner.directory, "admitted.json"));
  if (!marker.isFile() || marker.isSymbolicLink() || marker.uid !== process.getuid?.() || marker.mode & 0o077) throw new MoguriError("remote_console_cleanup", "The original private admission marker is no longer a regular private owned file.", 409);
  if (owner.status !== "stopped" || await readFile(join(owner.directory, "admitted.json"), "utf8") !== admission(owner)) throw new MoguriError("remote_console_cleanup", "No exact stopped owner/admission permits private cleanup.", 409);
  try { const socket = await lstat(owner.endpoint); if (!socket.isSocket()) throw new Error("Unexpected remote socket path."); await unlink(owner.endpoint); }
  catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
  await unlink(join(owner.directory, "admitted.json")); await rmdir(owner.directory);
}

const wire = new JsonLineChannel(process.stdin, process.stdout, false, TERMINAL_FRAME_BYTES);
let channel: TerminalChannel | undefined, initialized = false, active = true, chain = Promise.resolve();
const detach = () => { active = false; channel?.detach(); process.stdin.destroy(); wire.end(); };
wire.on("error", (error) => { console.error("Private Remote console control failed:", error.message); detach(); });
wire.on("close", detach); process.once("SIGTERM", detach); process.once("SIGHUP", detach);
wire.on("message", (raw: unknown) => {
  const id = initialized && isRecord(raw) && typeof raw.id === "string" ? raw.id : "bootstrap";
  chain = chain.then(async () => {
    if (!active) throw new MoguriError("remote_console_detached", "Private console authority detached; no request was dispatched.", 409);
    if (!initialized) {
      initialized = true; const init = parse(RemoteConsoleInitSchema, raw);
      if (init.action === "prepare") {
        const binding = terminalBinding({ ...init, workspaceId: null }), directory = await realpath(await mkdtemp(join(tmpdir(), "mo-"))), now = new Date().toISOString();
        const owner: PreparedTerminalOwner = { id: init.ownerId, profileId: init.profileId, protocol: 1, buildDigest: await build(),
          scopeDigest: terminalOwnerScope({ id: init.ownerId, profileId: init.profileId }), directory, endpoint: join(directory, "control.sock"),
          pid: null, status: "starting", cleanup: "retained", createdAt: now, updatedAt: now, diagnostic: null };
        wire.send({ id, ok: true, value: { kind: "prepared", owner, binding } }, detach); return;
      }
      if (init.action === "cleanup") { await cleanup(init.owner); wire.send({ id, ok: true, value: { removed: true } }, detach); return; }
      if (init.owner.buildDigest !== await build()) throw new MoguriError("remote_console_build", "The exact Remote broker build changed. No authentication or input was sent.", 409);
      const owner = init.action === "start" ? await start(init.owner, init.key) : init.owner;
      if (!active) return;
      const attached = await TerminalChannel.connect(owner, init.key, init.clientId, () => detach());
      channel = attached.channel;
      wire.send({ id, ok: true, value: { kind: "attached", info: attached.info, frontPid: process.pid } }); return;
    }
    if (!channel) throw new MoguriError("remote_console_unattached", "No authenticated Remote broker owns this stream.", 409);
    const { id: requestId, ...request } = parse(TerminalRequestSchema, raw);
    const value = await channel.request(request);
    if (active) wire.send({ id: requestId, ok: true, value });
  }).catch((error: unknown) => {
    console.error("Private Remote console request failed:", error instanceof MoguriError ? error.code : "remote_console_request");
    if (active) wire.send({ id, ok: false, code: error instanceof MoguriError ? error.code : "remote_console_request",
      message: error instanceof MoguriError ? error.message : "Private Remote console request failed; no work or input was replayed." }, channel ? undefined : detach);
  });
});
