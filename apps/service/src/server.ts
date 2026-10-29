import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import { chmod, lstat, mkdir, open, readFile, realpath, rename, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import { Type } from "typebox";
import { ControlPlane } from "./controller.ts";
import { EventStore } from "./store.ts";
import type { ProviderAdapter } from "./provider.ts";
import { CommandSchema, GLOBAL_PROFILE_ID, isApplicationCommand, isApplicationQuery, isUpdateQuery, isProfileCommand, isProfileQuery, MoguriError, parse, PROFILE_ID, PROTOCOL_VERSION, QUERY_ID_PATTERN, QueryCancellationSchema, QuerySchema, SpeechCaptureRequestSchema, StorageMoveRequestSchema, UpdateTokenRequestSchema, UpdateInstallRequestSchema, isRecord, TerminalInputSchema, type Connection, type StoredEvent, type RuntimeCloseOptions } from "../../../packages/protocol/src/index.ts";
import type { PlatformOptions } from "./platform.ts";
import { retentionKey } from "./retention-key.ts";
import { ProfileRuntime } from "./profiles.ts";
import { NEMOTRON_MODEL } from "./voice.ts";
import { ApplicationRuntime } from "./application.ts";
import { acknowledgeMovedDatabase, storedStorageOptions, type StorageOptions } from "./storage-relocation.ts";
import { claimStoreIdentity, readDefaultStateLocation, readStateLocation } from "../../../packages/client/src/state-location.ts";
import { runtimeBuildVersion, type UpdateOptions } from "./updates.ts";
import { pinnedInstalledApplication } from "./bundle-tree.ts";
import type { CommandEnvironment, CommandOwner } from "./queued-commands.ts";
import type { CommandEnvelope, CommandResult, PlatformQuery, PlatformResponse } from "../../../packages/protocol/src/index.ts";

const authenticateSchema = Type.Object({
  type: Type.Literal("authenticate"), protocolVersion: Type.Literal(PROTOCOL_VERSION),
  token: Type.String({ minLength: 1, maxLength: 256 }), after: Type.Integer({ minimum: 0 }),
  profileId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
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
export interface ServiceOptions {
  stateDir: string; provider?: ProviderAdapter; workerPath?: string; platform?: PlatformOptions; retentionKey?: Buffer;
  profiles?: { provider?: (profileId: string) => ProviderAdapter | undefined; platform?: (profileId: string) => PlatformOptions };
  storage?: StorageOptions;
  updates?: UpdateOptions;
}
export async function startService(options: ServiceOptions) {
  await mkdir(options.stateDir, { recursive: true, mode: 0o700 });
  const directory = await lstat(options.stateDir);
  if (!directory.isDirectory() || directory.isSymbolicLink() || directory.uid !== process.getuid?.() || (directory.mode & 0o077) !== 0) {
    throw new Error("Moguri's state directory must be a user-owned, non-symlink directory with mode 0700.");
  }
  if (options.storage) {
    const location = readDefaultStateLocation(options.storage.locatorDirectory);
    const canonical = await realpath(options.stateDir);
    if (location && location.dataDir !== canonical && location.move.source === canonical) throw new Error("This original root is retired by the authoritative store locator. No old or empty fallback was opened.");
  }
  const lockPath = join(options.stateDir, "service.lock");
  const lock = await claimLock(lockPath);
  await lock.writeFile(JSON.stringify({ pid: process.pid }));
  let store: EventStore | undefined;
  let controller: ControlPlane | undefined;
  let profiles: ProfileRuntime | undefined;
  let application: ApplicationRuntime | undefined;
  let releaseIdentity: (() => Promise<void>) | undefined;
  const connectionPath = join(options.stateDir, "connection.json");
  const commandEnvironment = Promise.withResolvers<CommandEnvironment>();
  void commandEnvironment.promise.catch(() => console.error("The original queued-command service environment could not initialize."));
  try {
    const dbPath = join(options.stateDir, "state.sqlite");
    const dbFile = await open(dbPath, "a", 0o600);
    await dbFile.close();
    await chmod(dbPath, 0o600);
    const stored = storedStorageOptions(dbPath);
    if (stored.locatorDirectory && options.storage && resolve(options.storage.locatorDirectory) !== stored.locatorDirectory) throw new Error("The whole store already binds a different locator authority. No new alias or writer was created.");
    const storage = options.storage ?? (stored.locatorDirectory ? { locatorDirectory: stored.locatorDirectory, explicitOverride: true } : undefined);
    const retention = await retentionKey(dbPath, options.retentionKey);
    if (stored.locatorDirectory && !readStateLocation(stored.locatorDirectory, retention.id)) throw new Error("The whole store's exact bound locator is missing. No retired, copied or empty fallback was opened.");
    if (storage) {
      releaseIdentity = await claimStoreIdentity(storage.locatorDirectory, retention.id, options.stateDir);
      await acknowledgeMovedDatabase(dbPath, storage, retention.id);
    }
    store = new EventStore(dbPath, retention.key, retention.id);
    const resourceBase = stored.resourceBase ?? options.stateDir;
    const packagedRoot = options.platform?.sandbox?.distribution ? undefined : await pinnedInstalledApplication(runtimeBuildVersion());
    const nativeDistribution = options.platform?.sandbox?.distribution ?? (packagedRoot ? join(packagedRoot, "Contents", "Resources", "moguri-native") : undefined);
    if (stored.resourceBase) {
      const resources = await lstat(stored.resourceBase);
      if (!resources.isDirectory() || resources.isSymbolicLink() || resources.uid !== process.getuid?.() || resources.mode & 0o077) throw new Error("The retained original resource root changed. No cache, worktree, profile or terminal directory was rebound.");
    }
    const authenticated = new Map<WebSocket, string>();
    const authenticating = new Set<WebSocket>();
    const send = (socket: WebSocket, value: unknown) => {
      if (socket.readyState !== WebSocket.OPEN) return;
      if (socket.bufferedAmount > 4 * 1024 * 1024) { socket.close(1013, "Reconnect to replay missed events."); return; }
      socket.send(JSON.stringify(value));
    };
    const changed = (profileId: string, events: StoredEvent[]) => {
      for (const [socket, scope] of authenticated) {
        if (profileId === GLOBAL_PROFILE_ID) { send(socket, { type: "invalidate" }); continue; }
        if (profileId !== scope) continue;
        if (events.length) { for (const event of events) if (event.profile_id === scope) send(socket, { type: "event", event }); }
        else send(socket, { type: "invalidate" });
      }
    };
    profiles = new ProfileRuntime(store, resourceBase, {
      controller: (view, stateDir, profileHooks) => {
        const scopedPlatform = options.profiles?.platform?.(view.profileId) ?? (view.profileId === PROFILE_ID ? options.platform : {
          mcpWorkerPath: options.platform?.mcpWorkerPath,
          speech: { executable: options.platform?.speech?.executable },
        });
        const platform = { ...scopedPlatform, mcpWorkerPath: scopedPlatform?.mcpWorkerPath ?? options.platform?.mcpWorkerPath,
          sandbox: { ...scopedPlatform?.sandbox, distribution: scopedPlatform?.sandbox?.distribution ?? nativeDistribution },
          speech: { ...scopedPlatform?.speech, executable: scopedPlatform?.speech?.executable ?? options.platform?.speech?.executable } };
        const provider = options.profiles?.provider?.(view.profileId) ?? (view.profileId === PROFILE_ID ? options.provider : undefined);
        const model = platform?.speech?.model;
        const officialSpeech = !model || model.id === NEMOTRON_MODEL.id && model.revision === NEMOTRON_MODEL.revision && model.sha256 === NEMOTRON_MODEL.sha256;
        return new ControlPlane(view, provider, options.workerPath, {
          ...platform, stateDir, profileHooks,
          cache: { ...platform?.cache, cacheDirectory: platform?.cache?.cacheDirectory ?? join(resourceBase, "dependency-cache") },
          speech: { ...platform?.speech, modelDirectory: platform?.speech?.modelDirectory ?? (officialSpeech ? join(resourceBase, "speech-models") : undefined) },
        }, () => commandEnvironment.promise);
      },
      changed,
    });
    controller = await profiles.initialize();
    const control = controller;
    const rootProfiles = profiles;
    let quiescing: Promise<void> | undefined;
    application = new ApplicationRuntime(store, () => changed(GLOBAL_PROFILE_ID, []), {
      resourceBase, storage, updates: options.updates, facts: () => rootProfiles.maintenanceFacts(),
      quiesce: () => { quiescing ??= rootProfiles.close({ preserveTerminals: true }); void quiescing.catch((error: unknown) => console.error("Relocation quiescence is unconfirmed:", error instanceof Error ? error.message : "owned profile cleanup failed")); },
    });
    const rootApplication = application;
    await rootApplication.updates.initialize();
    const executeCommand = async (envelope: CommandEnvelope, owner?: CommandOwner): Promise<CommandResult> => {
      if (owner && owner.profileId !== envelope.profileId) throw new MoguriError("command_profile", "The queued command cannot change its immutable owning profile.", 403);
      owner?.guard();
      if (isApplicationCommand(envelope.command)) {
        if (!rootProfiles.catalog().profiles.some((profile) => profile.id === envelope.profileId && profile.status === "ready")) throw new MoguriError("profile_missing", "Choose an actual ready profile before changing application configuration.", 404);
        return rootApplication.dispatch(envelope, envelope.command);
      }
      if (isProfileCommand(envelope.command)) return rootProfiles.dispatch(envelope, envelope.command);
      return (await rootProfiles.control(envelope.profileId)).dispatch(envelope, owner);
    };
    const executeQuery = async (profileId: string, query: PlatformQuery, signal: AbortSignal, owner?: CommandOwner): Promise<PlatformResponse> => {
      if (owner && owner.profileId !== profileId) throw new MoguriError("command_profile", "The queued read cannot inherit another profile.", 403);
      owner?.guard(); signal.throwIfAborted();
      let result: PlatformResponse;
      if (isApplicationQuery(query)) {
        if (!rootProfiles.catalog().profiles.some((profile) => profile.id === profileId && profile.status === "ready")) throw new MoguriError("profile_missing", "Choose an actual ready profile before reading application configuration.", 404);
        result = isUpdateQuery(query) ? await rootApplication.updateQuery(query) :
          query.type === "application.storage.status" ? { type: query.type, storage: rootApplication.storage.status() } :
          query.type === "application.storage.preview" ? { type: query.type, review: await rootApplication.storage.preview(query.path) } :
          { type: query.type, configuration: rootApplication.configuration() };
      } else if (isProfileQuery(query)) {
        if (!rootProfiles.catalog().profiles.some((profile) => profile.id === profileId && profile.status === "ready")) throw new MoguriError("profile_missing", "This profile is missing/unready. No registry fallback was used.", 404);
        result = { type: query.type, catalog: rootProfiles.catalog() };
      } else result = await (await rootProfiles.control(profileId)).platform.query(query, signal);
      signal.throwIfAborted(); owner?.guard(); return result;
    };
    const token = randomBytes(32).toString("hex");
    let closeRuntime!: (options?: RuntimeCloseOptions, preserveInstaller?: boolean) => Promise<void>;
    let lifecycle: { action: "stop" | "restart"; status: "stopping" | "unconfirmed"; diagnostic: string | null } | null = null;
    const activeQueries = new Map<string, AbortController>(), cancelledQueries = new Map<string, number>();
    const pruneQueries = () => { for (const [key, expires] of cancelledQueries) if (expires <= Date.now()) cancelledQueries.delete(key); };
    const queryCancelled = () => new MoguriError("query_cancelled", "The client cancelled this query. No result was published.", 409);
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
        if (request.url === "/v1/health" && request.method === "GET") { response.end(JSON.stringify({ protocolVersion: PROTOCOL_VERSION, pid: process.pid, lifecycle })); return; }
        const suppliedProfile = request.headers["x-moguri-profile"];
        const profileId = suppliedProfile === undefined ? PROFILE_ID : typeof suppliedProfile === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(suppliedProfile) ? suppliedProfile : null;
        if (!profileId || profileId === GLOBAL_PROFILE_ID) throw new MoguriError("profile_scope", "Choose one explicit user profile. No Default fallback was used.", 403);
        if (request.url === "/v1/snapshot" && request.method === "GET") { response.end(JSON.stringify(await rootProfiles.snapshot(profileId))); return; }
        if (!["/v1/commands", "/v1/query", "/v1/query-cancel", "/v1/terminal", "/v1/voice", "/v1/lifecycle", "/v1/application"].includes(request.url ?? "") || request.method !== "POST") throw new MoguriError("not_found", "Unknown protocol route.", 404);
        if (!request.headers["content-type"]?.startsWith("application/json")) throw new MoguriError("content_type", "Commands require application/json.", 415);
        const chunks: Buffer[] = [];
        let bytes = 0;
        for await (const chunk of request) {
          const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          bytes += data.length;
          if (bytes > 16 * 1024 * 1024) throw new MoguriError("body_limit", "Command body exceeds 16 MiB.", 413);
          chunks.push(data);
        }
        let body: unknown;
        try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new MoguriError("invalid_json", "Command body is not valid JSON."); }
        if (request.url === "/v1/voice") {
          response.end(JSON.stringify(await (await rootProfiles.control(profileId)).platform.captureVoice(parse(SpeechCaptureRequestSchema, body)))); return;
        }
        if (request.url === "/v1/application") {
          if (!rootProfiles.catalog().profiles.some((profile) => profile.id === profileId && profile.status === "ready")) throw new MoguriError("profile_missing", "Choose an actual ready profile before reviewing whole-store maintenance.", 404);
          if (isRecord(body) && body.action === "update-token") {
            const input = parse(UpdateTokenRequestSchema, body);
            response.end(JSON.stringify(await rootApplication.updates.setToken(input.token))); return;
          }
          if (isRecord(body) && body.action === "update-install") {
            const accepted = await rootApplication.updates.prepareInstallation(parse(UpdateInstallRequestSchema, body), profileId);
            response.once("finish", () => {
              void (async () => {
                try { await closeRuntime({ preserveTerminals: true }, true); await rootApplication.updates.armInstallation(); }
                catch (error) { console.error("The original update shutdown/installer arm is unconfirmed:", error instanceof Error ? error.message : "inspect retained journal and backup"); }
              })();
            });
            response.end(JSON.stringify({ ...accepted, accepted: true })); return;
          }
          const accepted = await rootApplication.storage.begin(parse(StorageMoveRequestSchema, body));
          response.once("finish", () => {
            void (async () => {
              try { await closeRuntime({ preserveTerminals: true }); await rootApplication.storage.copyAfterClose(); }
              catch (error) {
                await rootApplication.storage.failed(error);
                console.error("Moguri store relocation is partial:", error instanceof Error ? error.message : "the original encrypted source and destination were retained");
              }
            })().catch((error: unknown) => console.error("Relocation diagnostic persistence is unconfirmed:", error instanceof Error ? error.message : "inspect original locator and source"));
          });
          response.end(JSON.stringify({ ...accepted, accepted: true })); return;
        }
        if (request.url === "/v1/lifecycle") {
          const requested = parse(Type.Object({ action: Type.Union([Type.Literal("stop"), Type.Literal("restart")]) }, { additionalProperties: false }), body);
          if (lifecycle?.status === "stopping" && lifecycle.action !== requested.action) throw new MoguriError("lifecycle_conflict", "A different explicit lifecycle operation is already stopping this controller. No opposite terminal action was accepted.", 409);
          lifecycle = { action: requested.action, status: "stopping", diagnostic: null };
          response.once("finish", () => {
            void closeRuntime({ preserveTerminals: requested.action === "restart" }).catch((error: unknown) => {
              console.error("Moguri lifecycle shutdown is unconfirmed:", error instanceof MoguriError ? error.code : "service_shutdown");
            });
          });
          response.end(JSON.stringify({ accepted: true, pid: process.pid, protocolVersion: PROTOCOL_VERSION })); return;
        }
        if (request.url === "/v1/terminal") {
          await (await rootProfiles.control(profileId)).platform.sessions.input(parse(TerminalInputSchema, body));
          response.end(JSON.stringify({ accepted: true })); return;
        }
        if (request.url === "/v1/query-cancel") {
          const { requestId } = parse(QueryCancellationSchema, body), key = `${profileId}:${requestId}`;
          pruneQueries();
          if (!cancelledQueries.has(key) && cancelledQueries.size >= 1024) throw new MoguriError("query_capacity", "Too many recent query cancellations. Wait for their short-lived markers to expire.", 429);
          cancelledQueries.set(key, Date.now() + 30_000);
          activeQueries.get(key)?.abort(queryCancelled());
          response.end(JSON.stringify({ requested: true })); return;
        }
        if (request.url === "/v1/query") {
          const query = parse(QuerySchema, body);
          if (isApplicationQuery(query) || isProfileQuery(query)) {
            response.end(JSON.stringify(await executeQuery(profileId, query, new AbortController().signal))); return;
          }
          const abort = new AbortController();
          const requestId = request.headers["x-moguri-query-id"];
          if (requestId !== undefined && (typeof requestId !== "string" || !new RegExp(QUERY_ID_PATTERN).test(requestId))) throw new MoguriError("query_identity", "Use one exact UUID for this cancellable query.");
          const key = requestId ? `${profileId}:${requestId}` : null;
          if (key) {
            pruneQueries();
            if (cancelledQueries.has(key)) throw queryCancelled();
            if (activeQueries.has(key)) throw new MoguriError("query_identity", "This exact query is already active. No second source read was started.", 409);
            if (activeQueries.size >= 1024) throw new MoguriError("query_capacity", "Too many active cancellable queries. Finish or cancel existing reads first.", 429);
            activeQueries.set(key, abort);
          }
          const disconnected = () => { if (!response.writableEnded) abort.abort(queryCancelled()); };
          response.once("close", disconnected);
          try {
            abort.signal.throwIfAborted();
            const result = await executeQuery(profileId, query, abort.signal);
            if (!response.destroyed) response.end(JSON.stringify(result));
          } finally { response.off("close", disconnected); if (key) activeQueries.delete(key); }
          return;
        }
        const command = parse(CommandSchema, body);
        if (command.profileId !== profileId) throw new MoguriError("profile_scope", "Request scope and command profile differ. No foreign receipt or effect was used.", 403);
        response.end(JSON.stringify(await executeCommand(command)));
      };
      void handle().catch((error: unknown) => {
        const known = error instanceof MoguriError;
        if (!known) console.error("Moguri command failed:", error instanceof Error && "code" in error ? error.code : "internal_error");
        if (response.destroyed) return;
        response.statusCode = known ? error.status : 500;
        response.end(JSON.stringify({ error: { code: known ? error.code : "internal_error", message: known ? error.message : "The operation failed. Check local paths, permissions and service diagnostics; no success was recorded." } }));
      });
    });
    const websockets = new WebSocketServer({ noServer: true, maxPayload: 4096 });
    server.on("upgrade", (request, socket, head) => {
      if (!acceptable(request) || request.url !== "/v1/events") { socket.destroy(); return; }
      websockets.handleUpgrade(request, socket, head, (ws) => websockets.emit("connection", ws));
    });
    websockets.on("connection", (socket: WebSocket) => {
      const timer = setTimeout(() => socket.close(1008, "Authentication required."), 5000);
      socket.on("error", () => { console.error("Moguri event connection failed."); });
      socket.on("message", (data) => {
        if (authenticated.has(socket) || authenticating.has(socket)) { socket.close(1008, "Unexpected client event."); return; }
        authenticating.add(socket);
        void (async () => {
          try {
            const auth = parse(authenticateSchema, JSON.parse(data.toString()));
            if (!tokenMatches(auth.token, token)) throw new Error("Authentication failed.");
            const profileId = auth.profileId ?? PROFILE_ID;
            const scoped = await rootProfiles.control(profileId);
            if (socket.readyState !== WebSocket.OPEN) return;
            clearTimeout(timer);
            for (const event of scoped.events(auth.after)) send(socket, { type: "event", event });
            authenticated.set(socket, profileId);
            send(socket, { type: "ready", snapshot: await rootProfiles.snapshot(profileId) });
          } catch { socket.close(1008, "Authentication, profile or protocol negotiation failed."); }
          finally { authenticating.delete(socket); }
        })();
      });
      socket.on("close", () => { clearTimeout(timer); authenticated.delete(socket); });
    });
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); }); });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Loopback binding failed.");
    expectedHost = `127.0.0.1:${address.port}`;
    const connection: Connection = { protocolVersion: PROTOCOL_VERSION, baseUrl: `http://${expectedHost}`, wsUrl: `ws://${expectedHost}/v1/events`, token, pid: process.pid };
    commandEnvironment.resolve({ connection, command: executeCommand, query: (profileId, query, owner, signal) => executeQuery(profileId, query, signal, owner) });
    const pendingConnection = join(options.stateDir, `connection-${process.pid}.tmp`);
    await writePrivate(pendingConnection, JSON.stringify(connection));
    await rename(pendingConnection, connectionPath);
    let closeTask: Promise<void> | undefined;
    closeRuntime = (options: RuntimeCloseOptions = {}, preserveInstaller = false) => {
      if (!closeTask) lifecycle = { action: options.preserveTerminals ? "restart" : "stop", status: "stopping", diagnostic: null };
      closeTask ??= (async () => {
        const nativeClosing = rootApplication.close(preserveInstaller), ownersClosing = rootProfiles.close(options);
        await Promise.all([nativeClosing, ownersClosing]);
        for (const socket of websockets.clients) socket.terminate();
        await new Promise<void>((resolve) => websockets.close(() => resolve()));
        await new Promise<void>((resolve, reject) => {
          server.close((error) => error ? reject(error) : resolve());
          server.closeAllConnections();
        });
        store!.close();
        await unlink(connectionPath);
        await lock.close();
        await unlink(lockPath);
        await releaseIdentity?.();
        releaseIdentity = undefined;
      })().catch((error: unknown) => {
        lifecycle = { action: options.preserveTerminals ? "restart" : "stop", status: "unconfirmed",
          diagnostic: "Shutdown did not complete. The registry and writer lock remain; restore the explicit terminal backend or inspect its processes, then retry lifecycle cleanup." };
        closeTask = undefined; throw error;
      });
      return closeTask;
    };
    return {
      connection, controller: control, store, profiles: rootProfiles, application: rootApplication,
      close: closeRuntime,
    };
  } catch (error) {
    commandEnvironment.reject(error);
    const nativeClosing = application?.close(), ownersClosing = profiles ? profiles.close() : controller?.close();
    await Promise.all([nativeClosing, ownersClosing]);
    store?.close();
    await lock.close();
    await unlink(lockPath);
    await releaseIdentity?.();
    throw error;
  }
}
async function writePrivate(path: string, contents: string): Promise<void> {
  const file = await open(path, "wx", 0o600);
  try { await file.writeFile(contents); await file.sync(); } finally { await file.close(); }
}
