import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { access, lstat, mkdir, open, realpath } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { isRecord, PROTOCOL_VERSION, type Connection } from "../../protocol/src/index.ts";
import { processMayExist, readDefaultStateLocation } from "./state-location.ts";
import { hostExecutablePath } from "./host-environment.ts";
import { readPrivateServiceFile, readServiceGeneration, readServiceLock, SERVICE_LAUNCH_GENERATION_ENV, type PrivateServiceFile } from "./service-files.ts";

export function stateDirectory(): string {
  if (process.env.MOGURI_STATE_DIR && process.env.MOGURI_STATE_DIR_EXPLICIT !== "0") return resolve(process.env.MOGURI_STATE_DIR);
  return readDefaultStateLocation()?.dataDir ?? (process.env.MOGURI_STATE_DIR ? resolve(process.env.MOGURI_STATE_DIR) :
    process.platform === "darwin" ? join(homedir(), "Library", "Application Support", "Moguri") : join(homedir(), ".local", "state", "moguri"));
}
export interface ServiceUpgradeReview {
  stateDir: string; pid: number; observedProtocol: number; requiredProtocol: number; fingerprint: string; canRestart: boolean;
}
export class ServiceProtocolMismatch extends Error {
  constructor(readonly review: ServiceUpgradeReview) {
    super(review.observedProtocol > review.requiredProtocol ?
      `The running Moguri service uses newer protocol ${review.observedProtocol}; this app requires ${review.requiredProtocol}. Open a matching newer app. No service or state was replaced.` :
      review.canRestart ?
        `The running Moguri service uses older protocol ${review.observedProtocol}; this app requires ${review.requiredProtocol}. Explicitly restart the service with user terminals preserved, or run moguri service restart. Do not delete state.` :
        `The running Moguri service uses protocol ${review.observedProtocol}, before authenticated terminal-preserving restart. Close it with its matching version before opening this app. No PID was signalled and no state was deleted.`);
    this.name = "ServiceProtocolMismatch";
  }
}
export async function readPrivateConnection(stateDir = stateDirectory()): Promise<Connection> {
  const path = join(stateDir, "connection.json");
  const { text } = await readPrivateServiceFile(path);
  let value: unknown;
  try { value = JSON.parse(text); } catch (error) { if (error instanceof SyntaxError) throw new Error("Invalid Moguri connection JSON. State was preserved; no replacement service was started."); throw error; }
  if (!isRecord(value) || typeof value.protocolVersion !== "number" || !Number.isSafeInteger(value.protocolVersion) || value.protocolVersion < 1 || typeof value.baseUrl !== "string" ||
    typeof value.wsUrl !== "string" || typeof value.token !== "string" || !value.token.length || value.token.length > 256 ||
    typeof value.pid !== "number" || !Number.isSafeInteger(value.pid) || value.pid < 2 ||
    value.storeId !== undefined && (typeof value.storeId !== "string" || !/^[a-f0-9]{64}$/.test(value.storeId))) throw new Error("Invalid Moguri connection file. State was preserved; no replacement service was started.");
  const url = new URL(value.baseUrl);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.pathname !== "/" || url.search || url.hash || url.username || url.password ||
    value.wsUrl !== `ws://${url.host}/v1/events`) throw new Error("Moguri service must use an authenticated loopback endpoint.");
  return { protocolVersion: value.protocolVersion, baseUrl: value.baseUrl, wsUrl: value.wsUrl, token: value.token, pid: value.pid,
    ...(typeof value.storeId === "string" ? { storeId: value.storeId } : {}) };
}
export async function serviceUpgradeReview(connection: Connection, stateDir: string): Promise<ServiceUpgradeReview> {
  const root = await realpath(stateDir);
  return { stateDir: root, pid: connection.pid, observedProtocol: connection.protocolVersion, requiredProtocol: PROTOCOL_VERSION,
    fingerprint: createHash("sha256").update(JSON.stringify({ stateDir: root, protocolVersion: connection.protocolVersion, baseUrl: connection.baseUrl,
      wsUrl: connection.wsUrl, token: connection.token, pid: connection.pid, ...(connection.storeId ? { storeId: connection.storeId } : {}) })).digest("hex"),
    canRestart: connection.protocolVersion >= 23 && connection.protocolVersion < PROTOCOL_VERSION };
}
export async function readConnection(stateDir = stateDirectory()): Promise<Connection> {
  const connection = await readPrivateConnection(stateDir);
  if (connection.protocolVersion !== PROTOCOL_VERSION) throw new Error(`Moguri connection protocol ${connection.protocolVersion} does not match this client's ${PROTOCOL_VERSION}. Run moguri service restart or open the matching app; do not delete state.`);
  return connection;
}
function unavailable(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if ("code" in error) return error.code === "ENOENT" || error.code === "ECONNREFUSED";
  return error instanceof TypeError && error.cause instanceof Error && "code" in error.cause && error.cause.code === "ECONNREFUSED";
}
type ConnectionOptions = {
  stateDir?: string; runtime?: string; servicePath?: string; explicitStateDir?: boolean;
  startupReview?: ServiceStartupReview; signal?: AbortSignal;
};
export interface ServiceStartupReview {
  stateDir: string; rootId: string; pid: number; lockFingerprint: string | null;
  connectionFingerprint: string | null; staleConnectionFingerprint: string | null;
}
export class ServiceStartupUnconfirmed extends Error {
  private readonly captured: ServiceStartupReview;
  constructor(review: ServiceStartupReview, options?: ErrorOptions) {
    super(`Moguri service startup was not confirmed within 60 seconds. Its original owner may still be initializing; inspect ${join(review.stateDir, "service.log")} and reconnect to that same owner after it is ready. No state was deleted or replacement service started.`, options);
    this.name = "ServiceStartupUnconfirmed"; this.captured = Object.freeze({ ...review });
  }
  get review(): ServiceStartupReview { return { ...this.captured }; }
}
async function startupRoot(stateDir: string): Promise<{ stateDir: string; rootId: string }> {
  const selected = await lstat(stateDir, { bigint: true }), root = await realpath(stateDir), current = await lstat(root, { bigint: true });
  const uid = process.getuid?.();
  if (uid === undefined || !selected.isDirectory() || selected.isSymbolicLink() || selected.uid !== BigInt(uid) || selected.mode & 0o077n ||
    selected.dev !== current.dev || selected.ino !== current.ino || !current.isDirectory() || current.uid !== BigInt(uid) || current.mode & 0o077n) {
    throw new Error("The original service root changed or is not private/user-owned. No different owner was adopted or started.");
  }
  return { stateDir: root, rootId: `${current.dev}:${current.ino}` };
}
const startupLockFingerprint = (root: string, lock: PrivateServiceFile | null) => lock ? createHash("sha256")
  .update(JSON.stringify({ root, dev: lock.metadata.dev, ino: lock.metadata.ino, text: lock.text })).digest("hex") : null;
async function guardStartup(review: ServiceStartupReview): Promise<void> {
  const root = await startupRoot(review.stateDir), lock = await readServiceLock(join(root.stateDir, "service.lock"));
  if (root.stateDir !== review.stateDir || root.rootId !== review.rootId ||
    startupLockFingerprint(root.stateDir, lock) !== review.lockFingerprint || lock && lock.pid !== review.pid) {
    throw new Error("The captured original service root or writer lock changed. No different owner was adopted or started.");
  }
}
export async function reviewServiceStartup(stateDir = stateDirectory()): Promise<ServiceStartupReview> {
  const root = await startupRoot(stateDir), lock = await readServiceLock(join(root.stateDir, "service.lock"));
  let connection: Connection | undefined;
  try { connection = await readPrivateConnection(root.stateDir); }
  catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
  const pid = lock?.pid ?? connection?.pid;
  if (!pid || lock && lock.pid === null) throw new Error("The original service has no complete private owner to review. Preserve its metadata; no PID was inferred or replacement started.");
  const fingerprint = connection ? (await serviceUpgradeReview(connection, root.stateDir)).fingerprint : null;
  const review: ServiceStartupReview = { ...root, pid, lockFingerprint: startupLockFingerprint(root.stateDir, lock),
    connectionFingerprint: connection?.pid === pid ? fingerprint : null,
    staleConnectionFingerprint: connection && connection.pid !== pid ? fingerprint : null };
  await guardStartup(review);
  return review;
}
export class ServiceHealthTimeout extends Error {
  constructor(protocol: number, cause: unknown) {
    super(`The registered Moguri service (protocol ${protocol}) did not confirm authenticated health within this operation's existing deadline. Its owner is unconfirmed; inspect its original log/cleanup. No replacement or force-stop was attempted.`, { cause });
    this.name = "ServiceHealthTimeout";
  }
}
export async function readAuthenticatedServiceHealth(connection: Connection, stateDir: string, deadline: number, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const expected = (await serviceUpgradeReview(connection, stateDir)).fingerprint;
  const guard = async () => {
    if ((await serviceUpgradeReview(await readPrivateConnection(stateDir), stateDir)).fingerprint !== expected) throw new Error("The service connection changed, or its canonical root changed, during health inspection. No different owner was adopted or stopped.");
  };
  let timeout: unknown;
  while (performance.now() < deadline) {
    signal?.throwIfAborted();
    await guard();
    try {
      const response = await fetch(`${connection.baseUrl}/v1/health`, { headers: { Authorization: `Bearer ${connection.token}` }, redirect: "error",
        signal: AbortSignal.any([AbortSignal.timeout(Math.max(1, Math.min(2000, Math.ceil(deadline - performance.now())))), ...(signal ? [signal] : [])]) });
      if (!response.ok) throw new Error("The registered Moguri endpoint rejected authentication. No owner was stopped or replaced.");
      let health: unknown;
      try { health = await response.json(); }
      catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        throw new Error("The registered Moguri endpoint returned invalid health metadata. No authenticated owner was accepted or stopped.", { cause: error });
      }
      await guard();
      if (!isRecord(health) || health.protocolVersion !== connection.protocolVersion || health.pid !== connection.pid) throw new Error("Moguri service identity or protocol changed. No unverified owner was restarted.");
      return health;
    } catch (error) {
      signal?.throwIfAborted();
      if (!(error instanceof Error && error.name === "TimeoutError")) throw error;
      timeout = error;
      await delay(Math.max(0, Math.min(50, deadline - performance.now())), undefined, { signal });
    }
  }
  throw new ServiceHealthTimeout(connection.protocolVersion, timeout);
}
function readyLifecycle(health: Record<string, unknown>): void {
  if (health.lifecycle !== undefined && health.lifecycle !== null) {
    throw new Error(`The authenticated Moguri service is ${isRecord(health.lifecycle) && health.lifecycle.status === "unconfirmed" ? "in unconfirmed shutdown" : "stopping"}. Acceptance is not readiness. Inspect its original cleanup and retry; no replacement service was started.`);
  }
}
async function waitForStartupOwner(review: ServiceStartupReview, deadline: number, signal?: AbortSignal, checkLaunch?: () => Promise<void>): Promise<Connection> {
  let fingerprint = review.connectionFingerprint;
  while (performance.now() < deadline) {
    signal?.throwIfAborted();
    await checkLaunch?.(); await guardStartup(review);
    if (!processMayExist(review.pid)) throw new Error("The captured original service process exited before readiness. Its cleanup remains inspectable; no different PID was adopted or replacement started.");
    try {
      const connection = await readPrivateConnection(review.stateDir), current = (await serviceUpgradeReview(connection, review.stateDir)).fingerprint;
      if (connection.pid !== review.pid) {
        if (current !== review.staleConnectionFingerprint) throw new Error("The captured original service publication changed to a different owner. No endpoint was adopted or started.");
      } else {
        if (fingerprint !== null && fingerprint !== current) throw new Error("The captured original service connection changed. No different endpoint was adopted or started.");
        fingerprint ??= current;
        const health = await readAuthenticatedServiceHealth(connection, review.stateDir, deadline, signal);
        await guardStartup(review); signal?.throwIfAborted(); readyLifecycle(health);
        return connection;
      }
    } catch (error) {
      if (error instanceof ServiceHealthTimeout) throw new ServiceStartupUnconfirmed({ ...review, connectionFingerprint: fingerprint }, { cause: error });
      if (!unavailable(error)) throw error;
    }
    await delay(Math.min(100, Math.max(0, deadline - performance.now())), undefined, { signal });
  }
  signal?.throwIfAborted();
  await checkLaunch?.(); await guardStartup(review);
  throw new ServiceStartupUnconfirmed({ ...review, connectionFingerprint: fingerprint });
}
export async function waitForStartupService(review: ServiceStartupReview, options: { signal?: AbortSignal } = {}): Promise<Connection> {
  return waitForStartupOwner({ ...review }, performance.now() + 60_000, options.signal);
}
export async function verifyServiceInstallation(options: ConnectionOptions): Promise<{ servicePath: string; runtime: string }> {
  const servicePath = options.servicePath ?? fileURLToPath(new URL(import.meta.url.endsWith(".ts") ? "../../../apps/service/src/main.ts" : "./service.mjs", import.meta.url));
  const runtime = options.runtime ?? process.execPath;
  try {
    const entry = await lstat(servicePath);
    if (!entry.isFile() || entry.isSymbolicLink()) throw new Error("The selected entrypoint is not a regular installation file.");
    await access(runtime, constants.X_OK);
  } catch (error) {
    throw new Error(`Moguri's selected service installation is missing or inaccessible: ${servicePath} (runtime ${runtime}). Reinstall or rebuild this exact installation, then reinstall its managed command if the app moved. No other app, checkout or runtime was substituted and no service was stopped.`, { cause: error });
  }
  return { servicePath, runtime };
}
export async function ensureConnection(options: ConnectionOptions = {}): Promise<Connection> {
  const stateDir = options.stateDir ?? options.startupReview?.stateDir ?? stateDirectory(), deadline = performance.now() + 60_000;
  options.signal?.throwIfAborted();
  let originalRoot: Awaited<ReturnType<typeof startupRoot>> | undefined;
  const captureRoot = async () => {
    const root = await startupRoot(stateDir);
    if (originalRoot && (root.stateDir !== originalRoot.stateDir || root.rootId !== originalRoot.rootId)) throw new Error("The original service root changed during startup. No different owner or replacement was accepted.");
    originalRoot ??= root;
    return root;
  };
  const captureOwner = async (lock: PrivateServiceFile) => {
    const root = await captureRoot(), review = await reviewServiceStartup(root.stateDir);
    if (review.rootId !== root.rootId || review.lockFingerprint !== startupLockFingerprint(root.stateDir, lock)) throw new Error("The captured original writer changed during startup review. No different owner was adopted or started.");
    return review;
  };
  const matching = async (connection: Connection) => {
    if (connection.protocolVersion !== PROTOCOL_VERSION) throw new ServiceProtocolMismatch(await serviceUpgradeReview(connection, stateDir));
    return connection;
  };
  if (options.startupReview) {
    if ((await startupRoot(stateDir)).stateDir !== options.startupReview.stateDir) throw new Error("The requested root differs from its captured original startup review. No fallback or service launch was attempted.");
    return matching(await waitForStartupOwner({ ...options.startupReview }, deadline, options.signal));
  }
  const probe = async () => {
    const root = await captureRoot(), connection = await readPrivateConnection(root.stateDir), review = await reviewServiceStartup(root.stateDir);
    const fingerprint = (await serviceUpgradeReview(connection, root.stateDir)).fingerprint;
    if (review.rootId !== root.rootId) throw new Error("The captured original service root changed before health inspection. No different owner was adopted.");
    if (review.pid !== connection.pid) {
      if (review.staleConnectionFingerprint === fingerprint && processMayExist(review.pid)) return matching(await waitForStartupOwner(review, deadline, options.signal));
      throw new Error("The original connection and private writer changed before health inspection. No different owner was adopted.");
    }
    if (review.connectionFingerprint !== fingerprint) throw new Error("The captured original connection changed before health inspection. No different endpoint was adopted.");
    try {
      const health = await readAuthenticatedServiceHealth(connection, root.stateDir, deadline, options.signal);
      await guardStartup(review); readyLifecycle(health); options.signal?.throwIfAborted();
      return matching(connection);
    } catch (error) {
      if (error instanceof ServiceHealthTimeout) {
        await guardStartup(review);
        throw new ServiceStartupUnconfirmed(review, { cause: error });
      }
      throw error;
    }
  };
  try { return await probe(); } catch (error) {
    if (!unavailable(error)) throw error;
  }
  options.signal?.throwIfAborted();
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  const root = await captureRoot(), launchGeneration = await readServiceGeneration(root.stateDir);
  const existingLock = await readServiceLock(join(root.stateDir, "service.lock"));
  const canLaunch = !existingLock || existingLock.pid !== null && !processMayExist(existingLock.pid);
  const recovery = canLaunch ? await readServiceLock(join(stateDir, "service.lock.recovery")) : null;
  if (recovery && (recovery.pid === null || !processMayExist(recovery.pid))) throw new Error("An interrupted private service.lock.recovery remains unconfirmed. Preserve it and inspect the original log/owner; no replacement service was started.");
  const launching = canLaunch && !recovery;
  let startupReview = existingLock?.pid && processMayExist(existingLock.pid) ? await captureOwner(existingLock) : undefined;
  let launchError: Error | undefined;
  let exited: { code: number | null; signal: NodeJS.Signals | null } | undefined;
  let launchedPid: number | undefined;
  if (launching) {
    const { servicePath, runtime } = await verifyServiceInstallation(options);
    await captureRoot();
    const log = await open(join(stateDir, "service.log"), "a", 0o600);
    try {
      options.signal?.throwIfAborted(); await captureRoot();
      const child = spawn(runtime, [...(servicePath.endsWith(".ts") ? ["--import", "tsx"] : []), servicePath], {
        detached: true, stdio: ["ignore", log.fd, log.fd],
        env: { PATH: hostExecutablePath(process.env.PATH), HOME: process.env.HOME, MOGURI_STATE_DIR: stateDir,
          MOGURI_STATE_DIR_EXPLICIT: (options.explicitStateDir ?? Boolean(options.stateDir || process.env.MOGURI_STATE_DIR && process.env.MOGURI_STATE_DIR_EXPLICIT !== "0")) ? "1" : "0",
          [SERVICE_LAUNCH_GENERATION_ENV]: launchGeneration ?? "none",
          ...(process.env.MOGURI_LOCATION_DIR ? { MOGURI_LOCATION_DIR: process.env.MOGURI_LOCATION_DIR } : {}) },
      });
      launchedPid = child.pid;
      child.on("error", (error) => { launchError = error; });
      child.once("exit", (code, signal) => { exited = { code, signal }; });
      child.unref();
    } finally { await log.close(); }
  }
  const logPath = join(stateDir, "service.log");
  const checkLaunch = async () => {
    if (launchError) throw new Error(`Could not launch the Moguri service: ${launchError.message}`);
    if (exited) {
      const lock = await readServiceLock(join(stateDir, "service.lock"));
      const recovery = await readServiceLock(join(stateDir, "service.lock.recovery"));
      if (recovery && (recovery.pid === null || !processMayExist(recovery.pid))) throw new Error(`The launched service exited and its original lock recovery is unconfirmed. Inspect ${logPath} and service.lock.recovery; no metadata was removed or startup retried.`);
      if (!lock || lock.pid === launchedPid) {
        throw new Error(`Moguri service exited with ${exited.signal ? `signal ${exited.signal}` : `code ${exited.code ?? "unknown"}`} before becoming ready. Inspect ${logPath}.${lock ? " Its original writer lock remains; cleanup is unconfirmed." : ""} No state was deleted or service automatically retried.`);
      }
    }
  };
  while (performance.now() < deadline) {
    options.signal?.throwIfAborted(); await checkLaunch(); await captureRoot();
    if (!startupReview) {
      const lock = await readServiceLock(join(stateDir, "service.lock"));
      if (lock?.pid && processMayExist(lock.pid)) startupReview = await captureOwner(lock);
    }
    if (startupReview) return matching(await waitForStartupOwner(startupReview, deadline, options.signal, checkLaunch));
    try { return await probe(); }
    catch (error) {
      if (!unavailable(error)) throw error;
    }
    await delay(Math.min(100, Math.max(0, deadline - performance.now())), undefined, { signal: options.signal });
  }
  throw new Error(`Moguri service startup was not confirmed within 60 seconds. It may still be initializing; inspect ${logPath} and reconnect after it is ready. No state was deleted or replacement service started.`);
}
