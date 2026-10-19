import { createCipheriv, createDecipheriv, createHmac, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { fork, type ChildProcess } from "node:child_process";
import { createServer, connect, type Socket } from "node:net";
import { mkdir, lstat, readFile, writeFile, readdir, unlink, realpath, rename } from "node:fs/promises";
import { join, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { Value } from "typebox/value";
import { isRecord, MoguriError, PROTOCOL_VERSION } from "../../../packages/protocol/src/index.ts";
import { localEndpointUrl } from "./model-registry.ts";
import { frameDigest, JsonLineChannel, MAX_WORKER_FRAME } from "./worker-wire.ts";
import { parentMessage, WorkerRequestSchema, type WorkerRequest } from "./worker-protocol.ts";
import { BridgeInitSchema, SavedStatusSchema, BridgeEnvelopeSchema, type BridgeInit, type BridgeInfo, type BridgeStatus, type BridgeFrame, type SavedStatus } from "./remote-protocol.ts";
import { repositoryContext } from "./project-policy.ts";

const workerPath = fileURLToPath(new URL(import.meta.url.endsWith(".ts") ? "./worker.ts" : "./worker.mjs", import.meta.url));
const ownPath = fileURLToPath(import.meta.url);
const diagnosticCode = (error: unknown) => error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : error instanceof Error ? error.name : "unknown_error";
const frameName = (sequence: number) => `${String(sequence).padStart(12, "0")}.bin`;
const proof = (key: Buffer, value: Omit<SavedStatus, "proof">) => createHmac("sha256", key).update(JSON.stringify(value)).digest("hex");
async function privateDirectory(path: string): Promise<string> {
  if (!isAbsolute(path)) throw new MoguriError("remote_state_path", "Remote state requires an explicit absolute private path.");
  await mkdir(path, { recursive: true, mode: 0o700 });
  const metadata = await lstat(path), canonical = await realpath(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.uid !== process.getuid?.() || metadata.mode & 0o077 || canonical !== path) throw new MoguriError("remote_state_permissions", "Remote state must be canonical, user-owned, non-symlink and mode 0700.");
  return path;
}
async function runtimeInfo(init: BridgeInit): Promise<BridgeInfo> {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major !== 26 || minor! < 4 || !["darwin", "linux"].includes(process.platform)) throw new MoguriError("remote_version", "The SSH host needs Node 26.4+ (26.x) and a supported macOS/Linux Moguri worker.");
  const workerDigest = createHash("sha256").update(await readFile(workerPath)).digest("hex");
  if (workerDigest !== init.workerDigest && !["inspect", "attach"].includes(init.action)) throw new MoguriError("remote_worker_build", "Remote worker build differs. Install this exact Moguri build; no alternative worker was started.");
  let root: string | null = null;
  if (init.root !== null && init.action !== "inspect") {
    if (!isAbsolute(init.root)) throw new MoguriError("remote_workspace", "Approve an absolute canonical remote workspace.");
    root = await realpath(init.root);
    if (root !== init.root || !(await lstat(root)).isDirectory()) throw new MoguriError("remote_workspace_alias", "Remote workspace moved or is a symlink alias. Approve its canonical path explicitly.");
  }
  return { protocol: PROTOCOL_VERSION, workerDigest, nodeVersion: process.versions.node, platform: process.platform, root };
}
function runCredentials(init: BridgeInit): { id: string; key: Buffer } {
  if (!init.runId || !init.key) throw new Error("A remote run needs its exact owned identity and transport key.");
  return { id: init.runId, key: Buffer.from(init.key, "hex") };
}
async function saveStatus(directory: string, key: Buffer, status: BridgeStatus, info: BridgeInfo): Promise<void> {
  const saved = { status, info };
  const temporary = join(directory, `status-${randomBytes(8).toString("hex")}.tmp`);
  await writeFile(temporary, JSON.stringify({ ...saved, proof: proof(key, saved) }), { mode: 0o600, flag: "wx" });
  await rename(temporary, join(directory, "status.json"));
}
async function loadStatus(directory: string, key: Buffer): Promise<SavedStatus> {
  const metadata = await lstat(join(directory, "status.json"));
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 64 * 1024) throw new Error("Remote status is not a bounded regular file.");
  const value: unknown = JSON.parse(await readFile(join(directory, "status.json"), "utf8"));
  if (!Value.Check(SavedStatusSchema, value)) throw new Error("Remote execution metadata is corrupt; cleanup remains unconfirmed.");
  const expected = proof(key, { status: value.status, info: value.info });
  if (!timingSafeEqual(Buffer.from(value.proof, "hex"), Buffer.from(expected, "hex"))) throw new Error("Remote execution identity/key does not match. No worker was created.");
  return value;
}
function encrypt(key: Buffer, value: unknown): Buffer {
  const nonce = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, nonce);
  const content = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), content]);
}
function decrypt(key: Buffer, value: Buffer): unknown {
  const decipher = createDecipheriv("aes-256-gcm", key, value.subarray(0, 12));
  decipher.setAuthTag(value.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString("utf8"));
}
async function frames(directory: string, key: Buffer, after: number): Promise<BridgeFrame[]> {
  const names = (await readdir(directory)).filter((name) => /^\d{12}\.bin$/.test(name) && Number(name.slice(0, 12)) > after).sort();
  const result: BridgeFrame[] = []; let bytes = 0;
  for (const name of names) {
    const path = join(directory, name), metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > MAX_WORKER_FRAME) throw new Error("Remote replay is not a bounded regular frame.");
    const content = await readFile(path); bytes += content.length;
    if (bytes > MAX_WORKER_FRAME / 2 && result.length || result.length >= 128) break;
    const value = decrypt(key, content);
    if (!Value.Check(BridgeEnvelopeSchema, value) || value.kind !== "frame" || frameDigest(value.request) !== value.digest) throw new Error("Remote replay frame is corrupt.");
    result.push(value);
  }
  return result;
}
async function supervise(init: BridgeInit): Promise<void> {
  const { id, key } = runCredentials(init), info = await runtimeInfo(init), root = await privateDirectory(init.stateDir), directory = join(root, id);
  try { await mkdir(directory, { mode: 0o700 }); }
  catch (error) { if (error instanceof Error && "code" in error && error.code === "EEXIST") throw new MoguriError("remote_duplicate", "This run identity already exists. Inspect/reattach it; no second worker was created."); throw error; }
  let worker: ChildProcess | undefined, client: JsonLineChannel | undefined, queue = Promise.resolve(), bytes = 0, started = false, finalRequest: Extract<WorkerRequest, { kind: "finished" }> | undefined;
  let stopTimer: ReturnType<typeof setTimeout> | undefined;
  const status: BridgeStatus = { runId: id, workerPid: null, port: 0, acknowledged: 0, sequence: 0, status: "launching", cancellation: "none", cleanup: "pending", diagnostic: null };
  const persist = async () => { await saveStatus(directory, key, status, info); client?.send({ kind: "status", status }); };
  const stop = async (reason: string, lostControl = false) => {
    if (["completed", "stopped", "failed", "partial"].includes(status.status) && status.cleanup !== "pending") return;
    status.cancellation = status.cancellation === "none" ? "requested" : status.cancellation; status.status = "stopping"; status.diagnostic = reason;
    try { await persist(); }
    catch (error) { console.error("Remote stop metadata could not be saved:", diagnosticCode(error)); }
    if (!worker) {
      status.status = "stopped"; status.cleanup = "owned-worker-stopped"; status.diagnostic = "Control disconnected before worker launch. No agent or tool was started.";
      try { await persist(); } finally { server.close(); client?.end(); }
      return;
    }
    if (worker?.connected) worker.send({ kind: lostControl ? "control-lost" : "stop" });
    stopTimer ??= setTimeout(() => {
      status.status = "unconfirmed"; status.cancellation = "unconfirmed"; status.cleanup = "unconfirmed";
      status.diagnostic = "Remote worker did not settle cancellation. Worker termination was requested; descendants remain unconfirmed.";
      worker?.kill("SIGTERM");
      void persist().catch(() => console.error("Remote cancellation metadata could not be saved."));
      stopTimer = setTimeout(() => worker?.kill("SIGKILL"), 1000);
    }, 5000);
  };
  const server = createServer((socket: Socket) => {
    const connection = new JsonLineChannel(socket, socket); let authenticated = false;
    const authenticationDeadline = setTimeout(() => socket.destroy(), 5000);
    connection.on("error", () => socket.destroy());
    connection.on("close", () => {
      clearTimeout(authenticationDeadline);
      if (client === connection) { client = undefined; void stop("SSH control disconnected. Owned cancellation requested; no duplicate worker or Local fallback.", true).catch(() => console.error("Remote disconnect cleanup could not be recorded.")); }
    });
    connection.on("message", (raw) => {
      queue = queue.then(async () => {
        if (!authenticated) {
          if (!isRecord(raw) || typeof raw.key !== "string" || !/^[a-f0-9]{64}$/.test(raw.key) || !timingSafeEqual(Buffer.from(raw.key, "hex"), key) || typeof raw.after !== "number" || !Number.isSafeInteger(raw.after) || raw.after < 0 || raw.after > status.sequence) throw new Error("Remote run authentication/cursor failed.");
          if (client) throw new Error("This remote run already has a control connection.");
          authenticated = true; clearTimeout(authenticationDeadline); client = connection;
          connection.send({ kind: "ready", info, status });
          let cursor = raw.after;
          while (cursor < status.sequence) {
            const replay = await frames(directory, key, cursor);
            if (!replay.length) throw new Error("Unacknowledged remote frames are missing; no side effect was replayed.");
            for (const frame of replay) connection.send(frame);
            cursor = replay.at(-1)!.sequence;
          }
          return;
        }
        if (!isRecord(raw)) throw new Error("Invalid remote parent frame.");
        if (raw.kind === "ack") {
          if (typeof raw.sequence !== "number" || !Number.isSafeInteger(raw.sequence) || raw.sequence < status.acknowledged || raw.sequence > status.sequence) throw new Error("Invalid remote durable cursor.");
          for (let sequence = status.acknowledged + 1; sequence <= raw.sequence; sequence++) {
            const path = join(directory, frameName(sequence));
            try { const metadata = await lstat(path); await unlink(path); bytes -= metadata.size; }
            catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
          }
          status.acknowledged = raw.sequence; await persist(); return;
        }
        if (raw.kind !== "parent") throw new Error("Unknown remote parent frame.");
        const message = parentMessage(raw.message);
        if (message.kind === "stop") { await stop("Explicit owned cancellation requested."); return; }
        if (message.kind === "start") {
          if (started || message.root !== info.root || typeof message.readOnly !== "boolean") throw new Error("A run cannot start twice or change its approved workspace.");
          started = true;
          worker = fork(workerPath, [], {
            execPath: process.execPath, execArgv: workerPath.endsWith(".ts") ? process.execArgv : [],
            stdio: ["ignore", "ignore", "pipe", "ipc"],
            env: { PATH: process.env.PATH, HOME: process.env.HOME, MOGURI_TURN_ID: id },
          });
          status.workerPid = worker.pid ?? null; status.status = "running";
          worker.on("message", (request: unknown) => {
            queue = queue.then(async () => {
              if (!Value.Check(WorkerRequestSchema, request)) throw new Error("Remote worker returned an invalid request.");
              const frame: BridgeFrame = { kind: "frame", sequence: ++status.sequence, digest: frameDigest(request), request };
              const encrypted = encrypt(key, frame);
              if (bytes + encrypted.length > MAX_WORKER_FRAME) throw new Error("Remote replay reached its 32 MiB limit; cancellation is required.");
              await writeFile(join(directory, frameName(frame.sequence)), encrypted, { flag: "wx", mode: 0o600 }); bytes += encrypted.length;
              if (request.kind === "ack") status.cancellation = "acknowledged";
              if (request.kind === "finished") finalRequest = request;
              await saveStatus(directory, key, status, info); client?.send(frame);
            }).catch(async (error: unknown) => { console.error("Remote worker framing/storage failed:", diagnosticCode(error)); await stop("Remote worker framing or replay storage failed; effects and accounting may be unconfirmed."); });
          });
          worker.on("error", () => { void stop("Remote worker could not be launched. Check its runtime and native dependencies."); });
          worker.stderr?.on("data", (data: Buffer) => {
            const codes = [...new Set(data.toString().match(/\b(?:ERR_[A-Z_]+|MODULE_NOT_FOUND|EACCES|ENOENT|EPERM)\b/g) ?? [])];
            const text = `Remote worker emitted credential-private stderr${codes.length ? ` (${codes.join(", ")})` : ""}. Check its installed runtime/native dependencies if it cannot start.`;
            console.error(text); client?.send({ kind: "stderr", text });
          });
          worker.once("exit", (code, signal) => {
            void queue.then(async () => {
              clearTimeout(stopTimer);
              const clean = Boolean(finalRequest) && code === 0 && signal === null;
              status.status = clean ? finalRequest!.outcome : "unconfirmed";
              status.cleanup = clean ? "owned-worker-stopped" : "unconfirmed";
              status.diagnostic = clean ? finalRequest!.diagnostic : "Remote worker exited without a confirmed terminal exchange. Effects/descendants may remain.";
              await persist(); server.close(); setTimeout(() => { client?.end(); }, 30).unref();
            }).catch(() => { console.error("Remote terminal status could not be recorded."); process.exitCode = 1; server.close(); client?.end(); });
          });
          await persist(); worker.send(message); return;
        }
        if (!worker?.connected) throw new Error("The owned remote worker is no longer connected; no request was replayed.");
        worker.send(message);
      }).catch(async (error: unknown) => {
        console.error("Remote control failed:", diagnosticCode(error)); socket.destroy();
        if (authenticated && client === connection) await stop("Invalid or failed remote control frame. Cleanup remains visible.").catch(() => { process.exitCode = 1; });
      });
    });
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Remote control listener failed.");
  status.port = address.port; await saveStatus(directory, key, status, info);
  process.send?.({ kind: "supervisor-ready", port: status.port }); process.disconnect?.();
  const launchDeadline = setTimeout(() => { if (!started) { status.status = "failed"; status.cleanup = "owned-worker-stopped"; status.diagnostic = "No authenticated start arrived; no worker was launched."; void persist().finally(() => { server.close(); client?.end(); }); } }, 15_000);
  launchDeadline.unref();
}
async function frontend(): Promise<void> {
  const tty = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  if (tty) process.stdin.setRawMode(true);
  const outer = new JsonLineChannel(process.stdin, process.stdout, tty);
  const abort = new AbortController();
  let initialized = false, inner: JsonLineChannel | undefined;
  outer.on("error", () => { inner?.end(); process.exitCode = 1; });
  outer.on("close", () => { abort.abort(); inner?.end(); process.stdin.destroy(); });
  if (tty) { process.stdout.write("\n"); outer.send({ kind: "bootstrap", protocol: PROTOCOL_VERSION }); }
  let queue = Promise.resolve();
  outer.on("message", (raw) => {
    queue = queue.then(async () => {
      if (initialized) { if (!inner) throw new Error("Remote control is not attached."); inner.send(raw); return; }
      initialized = true;
      if (!Value.Check(BridgeInitSchema, raw)) throw new Error("Remote bootstrap does not match this protocol.");
      const init = raw, info = await runtimeInfo(init);
      if (init.action === "probe") { outer.send({ kind: "probe", info }, () => outer.end()); return; }
      if (init.action === "context") {
        if (!init.context || !info.root) throw new Error("Remote repository context needs its exact approved root and policy.");
        outer.send({ kind: "context", info, text: await repositoryContext(info.root, init.context) }, () => outer.end()); return;
      }
      if (init.action === "catalog") {
        if (!init.catalog) throw new Error("Missing explicit remote model endpoint.");
        const headers = new Headers();
        for (const [name, value] of Object.entries(init.catalog.headers ?? {})) if (value !== null) headers.set(name, value);
        if (init.catalog.key && init.catalog.headers?.Authorization !== null && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${init.catalog.key}`);
        const response = await fetch(new URL("models", localEndpointUrl(init.catalog.url)), { headers, redirect: "error", signal: AbortSignal.any([abort.signal, AbortSignal.timeout(5000)]) });
        if (!response.body) throw new Error("Remote model endpoint returned no catalog.");
        const chunks: Uint8Array[] = []; let size = 0; const reader = response.body.getReader();
        try { while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 256 * 1024) { await reader.cancel(); throw new Error("Remote model catalog exceeded 256 KiB."); } chunks.push(part.value); } }
        finally { reader.releaseLock(); }
        outer.send({ kind: "catalog", status: response.status, body: Buffer.concat(chunks).toString("base64"), info }, () => outer.end()); return;
      }
      const credentials = runCredentials(init), root = await privateDirectory(init.stateDir), directory = join(root, credentials.id);
      if (init.action === "start") {
        const child = fork(ownPath, ["--supervisor"], { execPath: process.execPath, execArgv: ownPath.endsWith(".ts") ? process.execArgv : [], detached: true, stdio: ["ignore", "ignore", "ignore", "ipc"], env: { PATH: process.env.PATH, HOME: process.env.HOME } });
        await new Promise<void>((resolve, reject) => {
          const deadline = setTimeout(() => reject(new Error("Remote supervisor launch timed out; inspect the run before retrying.")), 10_000);
          child.once("error", reject); child.once("exit", () => reject(new Error("Remote supervisor could not claim this run. A duplicate run was not started.")));
          child.once("message", (message: unknown) => {
            clearTimeout(deadline);
            if (isRecord(message) && message.kind === "supervisor-error" && typeof message.message === "string") reject(new MoguriError(typeof message.code === "string" ? message.code : "remote_supervisor", message.message));
            else if (!isRecord(message) || message.kind !== "supervisor-ready") reject(new MoguriError("remote_supervisor", "Invalid remote supervisor readiness."));
            else resolve();
          });
          child.send(init);
        });
        child.unref();
      }
      const saved = await loadStatus(directory, credentials.key);
      if (init.action === "inspect" || !["launching", "running", "stopping"].includes(saved.status.status)) {
        const replay = await frames(directory, credentials.key, init.after ?? 0);
        outer.send({ kind: "inspection", ...saved, frames: replay, nextSequence: replay.at(-1)?.sequence ?? init.after ?? 0 }, () => outer.end()); return;
      }
      const socket = connect({ host: "127.0.0.1", port: saved.status.port });
      inner = new JsonLineChannel(socket, socket);
      inner.on("message", (message) => outer.send(message));
      inner.on("error", () => { outer.send({ kind: "error", message: "Remote control connection failed; cleanup is unconfirmed." }, () => outer.end()); });
      inner.on("close", () => outer.end());
      socket.once("connect", () => inner!.send({ key: init.key, after: init.after ?? 0 }));
    }).catch((error: unknown) => { console.error("Remote bootstrap/control failed:", diagnosticCode(error)); outer.send({ kind: "error", code: error instanceof MoguriError ? error.code : diagnosticCode(error), message: error instanceof MoguriError ? error.message : "Remote bootstrap/control failed. Check the exact build, host workspace and run identity; no duplicate worker or Local fallback." }, () => outer.end()); process.exitCode = 1; });
  });
}
if (process.argv.includes("--supervisor")) {
  process.once("message", (raw: unknown) => {
    if (!Value.Check(BridgeInitSchema, raw)) { console.error("Invalid remote supervisor bootstrap."); process.exitCode = 1; process.disconnect?.(); return; }
    void supervise(raw).catch((error: unknown) => { console.error("Remote supervisor failed before readiness:", diagnosticCode(error)); process.send?.({ kind: "supervisor-error", code: error instanceof MoguriError ? error.code : diagnosticCode(error), message: error instanceof MoguriError ? error.message : "Remote supervisor failed before readiness. Inspect its state/runtime permissions before retrying." }); process.exitCode = 1; process.disconnect?.(); });
  });
} else void frontend();
