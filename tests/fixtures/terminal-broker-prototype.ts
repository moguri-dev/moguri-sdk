import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { fork, execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer, createConnection, type Socket } from "node:net";
import { chmod, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import { isRecord, parse, type TerminalState } from "../../packages/protocol/src/index.ts";
import { JsonLineChannel, frameDigest } from "../../apps/service/src/worker-wire.ts";
import { TerminalEngine as TerminalManager } from "../../apps/service/src/terminal-engine.ts";
import { stopGroup } from "../../apps/service/src/supervisor.ts";

const file = fileURLToPath(import.meta.url), loader = createRequire(import.meta.url).resolve("tsx");
const hash = Type.String({ pattern: "^[a-f0-9]{64}$" }), integer = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const InfoSchema = Type.Object({
  id: Type.String(), pid: Type.Integer({ minimum: 2 }), brokerPid: Type.Integer({ minimum: 2 }), cols: integer, rows: integer,
  status: Type.String(), diagnostic: Type.Union([Type.String(), Type.Null()]),
}, { additionalProperties: false });
const ReadSchema = Type.Object({ data: Type.String({ maxLength: 65536 }), baseOffset: integer, nextOffset: integer }, { additionalProperties: false });
const RequestSchema = Type.Union([
  Type.Object({ id: Type.String(), action: Type.Union([Type.Literal("info"), Type.Literal("stop"), Type.Literal("dispose")]) }, { additionalProperties: false }),
  Type.Object({ id: Type.String(), action: Type.Literal("input"), data: Type.String({ minLength: 1, maxLength: 16384 }) }, { additionalProperties: false }),
  Type.Object({ id: Type.String(), action: Type.Literal("resize"), cols: Type.Integer({ minimum: 10, maximum: 500 }), rows: Type.Integer({ minimum: 2, maximum: 200 }) }, { additionalProperties: false }),
  Type.Object({ id: Type.String(), action: Type.Literal("read"), offset: integer, limit: Type.Integer({ minimum: 1, maximum: 65536 }) }, { additionalProperties: false }),
]);
type Info = Static<typeof InfoSchema>;
type Read = Static<typeof ReadSchema>;
type Request = Static<typeof RequestSchema>;
type Input = Request extends infer T ? T extends Request ? Omit<T, "id"> : never : never;
interface Connection { socket: string; scopeDigest: string; key: string }
interface Boot extends Connection { root: string; launches: string; holdInputAck?: boolean }
export interface PrototypeTerminalClient {
  info(): Promise<Info>; read(offset?: number, limit?: number): Promise<Read>; input(data: string): Promise<Info>;
  resize(cols: number, rows: number): Promise<Info>; stop(): Promise<Info>; dispose(): Promise<Info>; disconnect(): void;
}
const mac = (key: string, role: string, nonce: string, scope: string) => {
  const bytes = Buffer.from(key, "base64");
  if (bytes.length !== 32 || bytes.toString("base64") !== key) throw new Error("Invalid generated terminal authentication key.");
  return createHmac("sha256", bytes).update(JSON.stringify(["moguri-terminal-prototype-v1", role, nonce, scope])).digest("hex");
};
const equal = (value: unknown, expected: string) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value) && timingSafeEqual(Buffer.from(value, "hex"), Buffer.from(expected, "hex"));
const clients = (request: (input: Input) => Promise<unknown>, disconnect: () => void): PrototypeTerminalClient => ({
  info: async () => parse(InfoSchema, await request({ action: "info" })),
  read: async (offset = 0, limit = 65536) => parse(ReadSchema, await request({ action: "read", offset, limit })),
  input: async (data) => parse(InfoSchema, await request({ action: "input", data })),
  resize: async (cols, rows) => parse(InfoSchema, await request({ action: "resize", cols, rows })),
  stop: async () => parse(InfoSchema, await request({ action: "stop" })),
  dispose: async () => parse(InfoSchema, await request({ action: "dispose" })), disconnect,
});

export async function connectTerminalPrototype(connection: Connection): Promise<PrototypeTerminalClient> {
  const socket = createConnection(connection.socket), channel = new JsonLineChannel(socket, socket, false, 512 * 1024);
  let ready = false, nonce: string | null = null, clientNonce = "", resolveReady!: () => void, rejectReady!: (error: Error) => void;
  const waiting = new Map<string, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  const startup = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const fail = (error: Error) => {
    rejectReady(error);
    for (const entry of waiting.values()) { clearTimeout(entry.timer); entry.reject(error); }
    waiting.clear(); socket.destroy();
  };
  const deadline = setTimeout(() => fail(new Error("Terminal prototype authentication timed out.")), 2500);
  channel.on("error", fail); channel.on("close", () => fail(new Error("Terminal control connection closed; outcome unconfirmed.")));
  socket.on("error", fail);
  channel.on("message", (value) => {
    if (!isRecord(value)) { fail(new Error("Invalid terminal control frame.")); return; }
    if (!ready) {
      if (value.type === "challenge" && Value.Check(hash, value.nonce) && value.scopeDigest === connection.scopeDigest) {
        nonce = value.nonce; clientNonce = randomBytes(32).toString("hex");
        channel.send({ type: "authenticate", clientNonce, scopeDigest: connection.scopeDigest, proof: mac(connection.key, "client", nonce, connection.scopeDigest) });
      } else if (value.type === "ready" && nonce && equal(value.proof, mac(connection.key, "server", `${nonce}:${clientNonce}`, connection.scopeDigest))) {
        ready = true; clearTimeout(deadline); resolveReady();
      } else fail(new Error("Terminal authentication, scope or server proof rejected."));
      return;
    }
    if (typeof value.id !== "string") { fail(new Error("Terminal response has no owning request.")); return; }
    const pending = waiting.get(value.id);
    if (!pending) { fail(new Error("Terminal response does not own a pending request.")); return; }
    waiting.delete(value.id); clearTimeout(pending.timer);
    if (value.ok === true) pending.resolve(value.value);
    else pending.reject(new Error("Terminal request failed or is unconfirmed; no input was replayed."));
  });
  try { await startup; } finally { clearTimeout(deadline); }
  return clients((input) => new Promise((resolve, reject) => {
    const id = randomUUID(), timer = setTimeout(() => { waiting.delete(id); reject(new Error("Terminal control request timed out; outcome unconfirmed.")); }, 2500);
    waiting.set(id, { resolve, reject, timer });
    channel.send({ ...input, id }, (error) => { if (error) { clearTimeout(timer); waiting.delete(id); reject(error); } });
  }), () => socket.destroy());
}

async function broker(boot: Boot): Promise<void> {
  let current: TerminalState | null = null;
  const manager = new TerminalManager((state) => { current = state; }, {
    executable: process.execPath, args: [fileURLToPath(new URL("./terminal-echo.mjs", import.meta.url)), boot.launches],
  });
  const terminal = manager.open({ root: boot.root, sessionId: "generated-terminal-session", projectId: "generated-terminal-project" }, 80, 24);
  const info = (): Info => {
    if (!current || current.pid === null) throw new Error("Terminal has no observed owned process identity.");
    return parse(InfoSchema, { id: current.id, pid: current.pid, brokerPid: process.pid, cols: current.cols, rows: current.rows, status: current.status, diagnostic: current.diagnostic });
  };
  const peers = new Set<Socket>();
  const server = createServer((socket) => {
    if (peers.size >= 8) { socket.destroy(); return; }
    peers.add(socket);
    const channel = new JsonLineChannel(socket, socket, false, 512 * 1024), nonce = randomBytes(32).toString("hex");
    let authenticated = false, chain = Promise.resolve();
    const timer = setTimeout(() => socket.destroy(), 2000);
    channel.on("error", () => socket.destroy());
    socket.on("error", () => socket.destroy());
    socket.on("close", () => { clearTimeout(timer); peers.delete(socket); });
    channel.send({ type: "challenge", nonce, scopeDigest: boot.scopeDigest });
    channel.on("message", (raw) => {
      if (!authenticated) {
        if (!isRecord(raw) || raw.type !== "authenticate" || raw.scopeDigest !== boot.scopeDigest || !Value.Check(hash, raw.clientNonce) ||
          !equal(raw.proof, mac(boot.key, "client", nonce, boot.scopeDigest))) {
          channel.send({ type: "rejected", code: "authentication" }); channel.end(); return;
        }
        authenticated = true; clearTimeout(timer);
        channel.send({ type: "ready", proof: mac(boot.key, "server", `${nonce}:${raw.clientNonce}`, boot.scopeDigest) }); return;
      }
      chain = chain.then(async () => {
        const request = parse(RequestSchema, raw);
        if (request.action === "input") manager.input({ action: "input", terminalId: terminal.id, data: request.data });
        else if (request.action === "resize") manager.input({ action: "resize", terminalId: terminal.id, cols: request.cols, rows: request.rows });
        else if (request.action === "stop" || request.action === "dispose") await manager.close(terminal.id);
        const value = request.action === "read" ? manager.read(terminal.id, request.offset, request.limit) : info();
        const result = request.action === "read" && "data" in value ? { data: value.data, baseOffset: value.baseOffset, nextOffset: value.nextOffset } : value;
        channel.send({ id: request.id, ok: true, value: result }, (error) => {
          if (request.action === "dispose" && !error) { for (const peer of peers) peer.end(); server.close(); }
        });
      }).catch(() => {
        channel.send({ id: isRecord(raw) && typeof raw.id === "string" ? raw.id : "unowned", ok: false, error: "invalid_or_unconfirmed" });
      });
    });
  });
  process.send?.({ type: "broker-owned", info: info() });
  process.on("SIGTERM", () => { void manager.closeAll().then(() => { for (const peer of peers) peer.destroy(); server.close(); }); });
  try {
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(boot.socket, resolve); });
    await chmod(boot.socket, 0o600);
    process.send?.({ type: "broker-ready", info: info() });
  } catch (error) { await manager.closeAll(); server.close(); throw error; }
}

async function parent(boot: Boot): Promise<void> {
  const child = fork(file, ["broker", boot.scopeDigest], { execArgv: ["--import", loader], detached: true, stdio: ["ignore", "ignore", "ignore", "ipc"],
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: boot.root, LANG: "en_US.UTF-8" } });
  process.send?.({ type: "broker-spawned", pid: child.pid });
  const started = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Generated terminal broker did not become ready.")), 5000);
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("message", (message) => {
      if (isRecord(message) && message.type === "broker-owned") { process.send?.(message); return; }
      clearTimeout(timer); if (isRecord(message) && message.type === "broker-ready") resolve(); else reject(new Error("Terminal broker startup failed."));
    });
  });
  child.send(boot); await started; child.disconnect(); child.unref();
  const client = await connectTerminalPrototype(boot), initial = await client.info();
  process.send?.({ type: "parent-ready", info: initial });
  process.on("message", (raw) => {
    if (!isRecord(raw) || raw.type !== "rpc") return;
    void (async () => {
      const request = parse(RequestSchema, raw.request);
      let value: unknown;
      if (request.action === "info") value = await client.info();
      else if (request.action === "read") value = await client.read(request.offset, request.limit);
      else if (request.action === "input") {
        value = await client.input(request.data);
        if (boot.holdInputAck) { process.send?.({ type: "input-held" }); await new Promise<void>(() => {}); }
      }
      else if (request.action === "resize") value = await client.resize(request.cols, request.rows);
      else if (request.action === "stop") value = await client.stop();
      else value = await client.dispose();
      process.send?.({ type: "rpc", id: request.id, ok: true, value });
    })().catch(() => { if (process.connected) process.send?.({ type: "rpc", id: isRecord(raw.request) ? raw.request.id : "unowned", ok: false }); });
  });
  const detach = () => { client.disconnect(); if (process.connected) process.disconnect?.(); };
  process.on("SIGTERM", detach); process.on("disconnect", () => client.disconnect());
}

export async function terminalPrototype(options: { holdInputAck?: boolean } = {}) {
  const runtime = await realpath(await mkdtemp(join(tmpdir(), "mt-"))), root = await realpath(await mkdtemp(join(tmpdir(), "moguri-terminal-probe-")));
  const launches = join(root, "launches"), socket = join(runtime, "control.sock"), scopeDigest = frameDigest(["default", "generated-project", "generated-session", root]);
  if (Buffer.byteLength(socket) >= 104) throw new Error("Generated Unix endpoint exceeds the macOS socket path bound.");
  const connection: Connection = { socket, scopeDigest, key: randomBytes(32).toString("base64") };
  const child = fork(file, ["parent"], { execArgv: ["--import", loader], stdio: ["ignore", "ignore", "pipe", "ipc"] });
  let errors = ""; child.stderr?.on("data", (data: Buffer) => { errors = (errors + data.toString()).slice(-4096); });
  const waiting = new Map<string, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  let resolveStartup!: (info: Info) => void, rejectStartup!: (error: Error) => void;
  let ownedInfo: Info | null = null, brokerPid: number | null = null, inputHeld = false;
  const startup = new Promise<Info>((resolve, reject) => { resolveStartup = resolve; rejectStartup = reject; });
  const startupTimer = setTimeout(() => rejectStartup(new Error(`Terminal controller startup timed out: ${errors}`)), 7000);
  const parentExit = new Promise<void>((resolve) => child.once("exit", () => {
    clearTimeout(startupTimer); rejectStartup(new Error(`Terminal controller exited: ${errors}`));
    for (const entry of waiting.values()) { clearTimeout(entry.timer); entry.reject(new Error("Terminal controller connection closed; outcome unconfirmed.")); }
    waiting.clear(); resolve();
  }));
  child.once("error", rejectStartup);
  child.on("message", (raw) => {
    if (!isRecord(raw)) return;
    if (raw.type === "input-held") { inputHeld = true; return; }
    if (raw.type === "broker-spawned" && typeof raw.pid === "number") { brokerPid = raw.pid; return; }
    if (raw.type === "broker-owned") { ownedInfo = parse(InfoSchema, raw.info); return; }
    if (raw.type === "parent-ready") { clearTimeout(startupTimer); resolveStartup(parse(InfoSchema, raw.info)); return; }
    if (raw.type === "fatal") { rejectStartup(new Error("Generated terminal controller failed.")); return; }
    if (raw.type !== "rpc" || typeof raw.id !== "string") return;
    const pending = waiting.get(raw.id); if (!pending) return;
    clearTimeout(pending.timer); waiting.delete(raw.id);
    if (raw.ok === true) pending.resolve(raw.value); else pending.reject(new Error("Terminal controller request failed; outcome unconfirmed."));
  });
  child.send({ ...connection, root, launches, holdInputAck: options.holdInputAck } satisfies Boot);
  const command = async (pid: number): Promise<string> => {
    try { return (await promisify(execFile)("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" })).stdout; }
    catch (error) { if (isRecord(error) && error.code === 1) return ""; throw error; }
  };
  const fallback = async (info: Info | null): Promise<boolean> => {
    if (brokerPid) {
      const brokerCommand = await command(brokerPid);
      if (brokerCommand) {
        if (!brokerCommand.includes(file) || !brokerCommand.includes(scopeDigest)) throw new Error("Terminal broker PID identity changed; no unrelated process was signalled.");
        process.kill(brokerPid, "SIGTERM");
      }
    }
    if (info) {
      const processCommand = await command(info.pid);
      if (processCommand) { if (!processCommand.includes(launches)) throw new Error("Generated PTY PID identity changed; no unrelated process was signalled."); if (!await stopGroup(info.pid)) return false; }
    }
    for (let index = 0; index < 100; index++) {
      if ((!brokerPid || !await command(brokerPid)) && (!info || !await command(info.pid))) return true;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return false;
  };
  let info: Info;
  try { info = await startup; }
  catch (error) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    await parentExit;
    if (await fallback(ownedInfo)) { await rm(runtime, { recursive: true, force: true }); await rm(root, { recursive: true, force: true }); }
    throw error;
  }
  const client = clients((input) => new Promise((resolve, reject) => {
    const id = randomUUID(), timer = setTimeout(() => { waiting.delete(id); reject(new Error("Terminal controller timed out; outcome unconfirmed.")); }, 3000);
    waiting.set(id, { resolve, reject, timer });
    if (!child.connected) { clearTimeout(timer); waiting.delete(id); reject(new Error("Terminal controller connection closed.")); return; }
    child.send({ type: "rpc", request: { ...input, id } }, (error) => { if (error) { clearTimeout(timer); waiting.delete(id); reject(error); } });
  }), () => { if (child.connected) child.disconnect(); });
  const close = async () => {
      let confirmed = false;
      try {
        try {
          const cleanup = await connectTerminalPrototype(connection);
          try { const stopped = await cleanup.stop(); if (stopped.status !== "closed") throw new Error("Generated PTY cleanup is unconfirmed."); await cleanup.dispose(); confirmed = true; }
          finally { cleanup.disconnect(); }
        } catch (error) {
          confirmed = await fallback(info);
          if (!confirmed) throw error;
        }
      } finally {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
        await parentExit;
        if (confirmed) { await rm(runtime, { recursive: true, force: true }); await rm(root, { recursive: true, force: true }); }
      }
    };
  try {
    let observed = false;
    for (let index = 0; index < 200; index++) { if ((await client.read()).data.includes("GENERATED_READY")) { observed = true; break; } await new Promise((resolve) => setTimeout(resolve, 10)); }
    if (!observed) throw new Error("Actual generated PTY program did not become ready.");
  } catch (error) { await close(); throw error; }
  return { runtime, root, launches, connection, info, client, parent: child, parentExit, close, get inputHeld() { return inputHeld; } };
}

if (process.argv[2] === "broker" || process.argv[2] === "parent") {
  process.once("message", (raw) => {
    void (async () => {
      if (!isRecord(raw) || typeof raw.root !== "string" || typeof raw.socket !== "string" || typeof raw.launches !== "string" || typeof raw.key !== "string" || !Value.Check(hash, raw.scopeDigest)) throw new Error("Invalid generated terminal bootstrap.");
      if (raw.holdInputAck !== undefined && typeof raw.holdInputAck !== "boolean") throw new Error("Invalid generated acknowledgement gate.");
      const boot: Boot = { root: raw.root, socket: raw.socket, launches: raw.launches, key: raw.key, scopeDigest: raw.scopeDigest, ...(raw.holdInputAck === true ? { holdInputAck: true } : {}) };
      if (process.argv[2] === "broker") await broker(boot); else await parent(boot);
    })().catch((error: unknown) => { console.error("Generated terminal prototype failed:", error instanceof Error ? error.message : "unknown"); process.send?.({ type: "fatal" }); process.exitCode = 1; if (process.connected) process.disconnect?.(); });
  });
}
