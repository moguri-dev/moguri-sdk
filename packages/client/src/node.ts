import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { access, lstat, mkdir, open, realpath } from "node:fs/promises";
import { isRecord, PROTOCOL_VERSION, type Connection } from "../../protocol/src/index.ts";
import { processMayExist, readDefaultStateLocation } from "./state-location.ts";
import { hostExecutablePath } from "./host-environment.ts";
import { readPrivateServiceFile, readServiceLock } from "./service-files.ts";

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
type ConnectionOptions = { stateDir?: string; runtime?: string; servicePath?: string; explicitStateDir?: boolean };
export class ServiceHealthTimeout extends Error {
  constructor(protocol: number, cause: unknown) {
    super(`The registered Moguri service (protocol ${protocol}) did not confirm authenticated health within this operation's existing deadline. Its owner is unconfirmed; inspect its original log/cleanup. No replacement or force-stop was attempted.`, { cause });
    this.name = "ServiceHealthTimeout";
  }
}
export async function readAuthenticatedServiceHealth(connection: Connection, stateDir: string, deadline: number): Promise<Record<string, unknown>> {
  const expected = (await serviceUpgradeReview(connection, stateDir)).fingerprint;
  const guard = async () => {
    if ((await serviceUpgradeReview(await readPrivateConnection(stateDir), stateDir)).fingerprint !== expected) throw new Error("The service connection changed, or its canonical root changed, during health inspection. No different owner was adopted or stopped.");
  };
  let timeout: unknown;
  while (performance.now() < deadline) {
    await guard();
    try {
      const response = await fetch(`${connection.baseUrl}/v1/health`, { headers: { Authorization: `Bearer ${connection.token}` }, redirect: "error",
        signal: AbortSignal.timeout(Math.max(1, Math.min(2000, Math.ceil(deadline - performance.now())))) });
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
      if (!(error instanceof Error && error.name === "TimeoutError")) throw error;
      timeout = error;
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, Math.min(50, deadline - performance.now()))));
    }
  }
  throw new ServiceHealthTimeout(connection.protocolVersion, timeout);
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
  const stateDir = options.stateDir ?? stateDirectory(), deadline = performance.now() + 60_000;
  const probe = async () => {
    const connection = await readPrivateConnection(stateDir);
    const health = await readAuthenticatedServiceHealth(connection, stateDir, deadline);
    if (connection.protocolVersion !== PROTOCOL_VERSION) throw new ServiceProtocolMismatch(await serviceUpgradeReview(connection, stateDir));
    if (health.lifecycle !== undefined && health.lifecycle !== null) {
      throw new Error(`The authenticated Moguri service is ${isRecord(health.lifecycle) && health.lifecycle.status === "unconfirmed" ? "in unconfirmed shutdown" : "stopping"}. Acceptance is not readiness. Inspect its original cleanup and retry; no replacement service was started.`);
    }
    return connection;
  };
  try { return await probe(); } catch (error) {
    if (!unavailable(error)) throw error;
  }
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  const existingLock = await readServiceLock(join(stateDir, "service.lock"));
  const canLaunch = !existingLock || existingLock.pid !== null && !processMayExist(existingLock.pid);
  const recovery = canLaunch ? await readServiceLock(join(stateDir, "service.lock.recovery")) : null;
  if (recovery && (recovery.pid === null || !processMayExist(recovery.pid))) throw new Error("An interrupted private service.lock.recovery remains unconfirmed. Preserve it and inspect the original log/owner; no replacement service was started.");
  const launching = canLaunch && !recovery;
  let launchError: Error | undefined;
  let exited: { code: number | null; signal: NodeJS.Signals | null } | undefined;
  let launchedPid: number | undefined;
  if (launching) {
    const { servicePath, runtime } = await verifyServiceInstallation(options);
    const log = await open(join(stateDir, "service.log"), "a", 0o600);
    try {
      const child = spawn(runtime, [...(servicePath.endsWith(".ts") ? ["--import", "tsx"] : []), servicePath], {
        detached: true, stdio: ["ignore", log.fd, log.fd],
        env: { PATH: hostExecutablePath(process.env.PATH), HOME: process.env.HOME, MOGURI_STATE_DIR: stateDir,
          MOGURI_STATE_DIR_EXPLICIT: (options.explicitStateDir ?? Boolean(options.stateDir || process.env.MOGURI_STATE_DIR && process.env.MOGURI_STATE_DIR_EXPLICIT !== "0")) ? "1" : "0",
          ...(process.env.MOGURI_LOCATION_DIR ? { MOGURI_LOCATION_DIR: process.env.MOGURI_LOCATION_DIR } : {}) },
      });
      launchedPid = child.pid;
      child.on("error", (error) => { launchError = error; });
      child.once("exit", (code, signal) => { exited = { code, signal }; });
      child.unref();
    } finally { await log.close(); }
  }
  const logPath = join(stateDir, "service.log");
  while (performance.now() < deadline) {
    if (launchError) throw new Error(`Could not launch the Moguri service: ${launchError.message}`);
    try { return await probe(); } catch (error) { if (!unavailable(error)) throw error; }
    if (exited) {
      const lock = await readServiceLock(join(stateDir, "service.lock"));
      const recovery = await readServiceLock(join(stateDir, "service.lock.recovery"));
      if (recovery && (recovery.pid === null || !processMayExist(recovery.pid))) throw new Error(`The launched service exited and its original lock recovery is unconfirmed. Inspect ${logPath} and service.lock.recovery; no metadata was removed or startup retried.`);
      if (!lock || lock.pid === launchedPid) {
        throw new Error(`Moguri service exited with ${exited.signal ? `signal ${exited.signal}` : `code ${exited.code ?? "unknown"}`} before becoming ready. Inspect ${logPath}.${lock ? " Its original writer lock remains; cleanup is unconfirmed." : ""} No state was deleted or service automatically retried.`);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(100, Math.max(0, deadline - performance.now()))));
  }
  throw new Error(`Moguri service startup was not confirmed within 60 seconds. It may still be initializing; inspect ${logPath} and reconnect after it is ready. No state was deleted or replacement service started.`);
}
