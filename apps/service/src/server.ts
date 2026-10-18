import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import { chmod, lstat, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import { Type } from "typebox";
import { ControlPlane } from "./controller.ts";
import { EventStore } from "./store.ts";
import type { ProviderAdapter } from "./provider.ts";
import { MoguriError, parse, PROTOCOL_VERSION, QuerySchema, type Connection, type StoredEvent } from "../../../packages/protocol/src/index.ts";
import type { PlatformOptions } from "./platform.ts";

const authenticateSchema = Type.Object({
  type: Type.Literal("authenticate"), protocolVersion: Type.Literal(PROTOCOL_VERSION),
  token: Type.String({ minLength: 1, maxLength: 256 }), after: Type.Integer({ minimum: 0 }),
}, { additionalProperties: false });
function tokenMatches(value: string | undefined, expected: string): boolean {
  if (!value) return false;
  const a = Buffer.from(value);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
async function claimLock(path: string): Promise<Awaited<ReturnType<typeof open>>> {
  try { return await open(path, "wx", 0o600); } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
    const old: unknown = JSON.parse(await readFile(path, "utf8"));
    if (typeof old !== "object" || old === null || !("pid" in old) || typeof old.pid !== "number" || !Number.isSafeInteger(old.pid) || old.pid < 1) {
      throw new Error("The service lock is invalid. Preserve your state and inspect service.lock before restarting.");
    }
    try { process.kill(old.pid, 0); } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ESRCH") {
        await unlink(path);
        return open(path, "wx", 0o600);
      }
      throw error;
    }
    throw new Error("Another Moguri service owns this state directory. Connect to it instead.");
  }
}
export interface ServiceOptions { stateDir: string; provider?: ProviderAdapter; workerPath?: string; platform?: PlatformOptions }
export async function startService(options: ServiceOptions) {
  await mkdir(options.stateDir, { recursive: true, mode: 0o700 });
  const directory = await lstat(options.stateDir);
  if (!directory.isDirectory() || directory.isSymbolicLink() || directory.uid !== process.getuid?.() || (directory.mode & 0o077) !== 0) {
    throw new Error("Moguri's state directory must be a user-owned, non-symlink directory with mode 0700.");
  }
  const lockPath = join(options.stateDir, "service.lock");
  const lock = await claimLock(lockPath);
  await lock.writeFile(JSON.stringify({ pid: process.pid }));
  let store: EventStore | undefined;
  let controller: ControlPlane | undefined;
  const connectionPath = join(options.stateDir, "connection.json");
  try {
    const dbPath = join(options.stateDir, "state.sqlite");
    const dbFile = await open(dbPath, "a", 0o600);
    await dbFile.close();
    await chmod(dbPath, 0o600);
    store = new EventStore(dbPath);
    controller = new ControlPlane(store, options.provider, options.workerPath, { ...options.platform, stateDir: options.stateDir });
    await controller.initialize();
    const control = controller;
    const token = randomBytes(32).toString("hex");
    let expectedHost = "";
    const acceptable = (request: IncomingMessage) => request.headers.host === expectedHost &&
      (request.headers.origin === undefined || request.headers.origin === "moguri://app");
    const server = createServer((request, response) => {
      const handle = async () => {
        response.setHeader("Content-Type", "application/json");
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("X-Content-Type-Options", "nosniff");
        if (!acceptable(request)) throw new MoguriError("origin_denied", "Host or Origin is not an authorized Moguri client.", 403);
        if (!tokenMatches(request.headers.authorization, `Bearer ${token}`)) throw new MoguriError("unauthorized", "A valid local connection token is required.", 401);
        if (request.url === "/v1/health" && request.method === "GET") { response.end(JSON.stringify({ protocolVersion: PROTOCOL_VERSION, pid: process.pid })); return; }
        if (request.url === "/v1/snapshot" && request.method === "GET") { response.end(JSON.stringify(control.snapshot())); return; }
        if (!["/v1/commands", "/v1/query"].includes(request.url ?? "") || request.method !== "POST") throw new MoguriError("not_found", "Unknown protocol route.", 404);
        if (!request.headers["content-type"]?.startsWith("application/json")) throw new MoguriError("content_type", "Commands require application/json.", 415);
        const chunks: Buffer[] = [];
        let bytes = 0;
        for await (const chunk of request) {
          const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          bytes += data.length;
          if (bytes > 2 * 1024 * 1024) throw new MoguriError("body_limit", "Command body exceeds 2 MiB.", 413);
          chunks.push(data);
        }
        let body: unknown;
        try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new MoguriError("invalid_json", "Command body is not valid JSON."); }
        response.end(JSON.stringify(request.url === "/v1/query" ? await control.platform.query(parse(QuerySchema, body)) : await control.dispatch(body)));
      };
      void handle().catch((error: unknown) => {
        const known = error instanceof MoguriError;
        if (!known) console.error("Moguri command failed:", error instanceof Error && "code" in error ? error.code : "internal_error");
        response.statusCode = known ? error.status : 500;
        response.end(JSON.stringify({ error: { code: known ? error.code : "internal_error", message: known ? error.message : "The operation failed. Check local paths, permissions and service diagnostics; no success was recorded." } }));
      });
    });
    const websockets = new WebSocketServer({ noServer: true, maxPayload: 4096 });
    const authenticated = new Set<WebSocket>();
    const send = (socket: WebSocket, value: unknown) => {
      if (socket.readyState !== WebSocket.OPEN) return;
      if (socket.bufferedAmount > 4 * 1024 * 1024) { socket.close(1013, "Reconnect to replay missed events."); return; }
      socket.send(JSON.stringify(value));
    };
    server.on("upgrade", (request, socket, head) => {
      if (!acceptable(request) || request.url !== "/v1/events") { socket.destroy(); return; }
      websockets.handleUpgrade(request, socket, head, (ws) => websockets.emit("connection", ws));
    });
    websockets.on("connection", (socket: WebSocket) => {
      const timer = setTimeout(() => socket.close(1008, "Authentication required."), 5000);
      socket.on("error", () => { console.error("Moguri event connection failed."); });
      socket.on("message", (data) => {
        try {
          if (authenticated.has(socket)) throw new Error("Unexpected client event.");
          const auth = parse(authenticateSchema, JSON.parse(data.toString()));
          if (!tokenMatches(auth.token, token)) throw new Error("Authentication failed.");
          clearTimeout(timer);
          for (const event of control.events(auth.after)) send(socket, { type: "event", event });
          authenticated.add(socket);
          send(socket, { type: "ready", snapshot: control.snapshot() });
        } catch { socket.close(1008, "Authentication or protocol negotiation failed."); }
      });
      socket.on("close", () => { clearTimeout(timer); authenticated.delete(socket); });
    });
    const changed = (events: StoredEvent[]) => {
      for (const socket of authenticated) {
        if (events.length) for (const event of events) send(socket, { type: "event", event });
        else send(socket, { type: "invalidate" });
      }
    };
    control.on("change", changed);
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); }); });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Loopback binding failed.");
    expectedHost = `127.0.0.1:${address.port}`;
    const connection: Connection = { protocolVersion: PROTOCOL_VERSION, baseUrl: `http://${expectedHost}`, wsUrl: `ws://${expectedHost}/v1/events`, token, pid: process.pid };
    const pendingConnection = join(options.stateDir, `connection-${process.pid}.tmp`);
    await writePrivate(pendingConnection, JSON.stringify(connection));
    await rename(pendingConnection, connectionPath);
    let closed = false;
    return {
      connection, controller: control, store,
      close: async () => {
        if (closed) return;
        closed = true;
        await control.close();
        control.off("change", changed);
        for (const socket of websockets.clients) socket.terminate();
        await new Promise<void>((resolve) => websockets.close(() => resolve()));
        await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
        store!.close();
        await unlink(connectionPath);
        await lock.close();
        await unlink(lockPath);
      },
    };
  } catch (error) {
    await controller?.close();
    store?.close();
    await lock.close();
    await unlink(lockPath);
    throw error;
  }
}
async function writePrivate(path: string, contents: string): Promise<void> {
  const file = await open(path, "wx", 0o600);
  try { await file.writeFile(contents); await file.sync(); } finally { await file.close(); }
}
