import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { lstat, mkdir, open, readFile, realpath } from "node:fs/promises";
import { isRecord, PROTOCOL_VERSION, type Connection } from "../../protocol/src/index.ts";
import { readDefaultStateLocation } from "./state-location.ts";
import { hostExecutablePath } from "./host-environment.ts";

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
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.uid !== process.getuid?.() || (metadata.mode & 0o077)) {
    throw new Error("Connection metadata is not private or is not owned by this user.");
  }
  let value: unknown;
  try { value = JSON.parse(await readFile(path, "utf8")); } catch (error) { if (error instanceof SyntaxError) throw new Error("Invalid Moguri connection JSON. State was preserved; no replacement service was started."); throw error; }
  if (!isRecord(value) || typeof value.protocolVersion !== "number" || !Number.isSafeInteger(value.protocolVersion) || value.protocolVersion < 1 || typeof value.baseUrl !== "string" ||
    typeof value.wsUrl !== "string" || typeof value.token !== "string" || !value.token.length || value.token.length > 256 ||
    typeof value.pid !== "number" || !Number.isSafeInteger(value.pid) || value.pid < 2) throw new Error("Invalid Moguri connection file. State was preserved; no replacement service was started.");
  const url = new URL(value.baseUrl);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.pathname !== "/" || url.search || url.hash || url.username || url.password ||
    value.wsUrl !== `ws://${url.host}/v1/events`) throw new Error("Moguri service must use an authenticated loopback endpoint.");
  return { protocolVersion: value.protocolVersion, baseUrl: value.baseUrl, wsUrl: value.wsUrl, token: value.token, pid: value.pid };
}
export async function serviceUpgradeReview(connection: Connection, stateDir: string): Promise<ServiceUpgradeReview> {
  const root = await realpath(stateDir);
  return { stateDir: root, pid: connection.pid, observedProtocol: connection.protocolVersion, requiredProtocol: PROTOCOL_VERSION,
    fingerprint: createHash("sha256").update(JSON.stringify({ stateDir: root, ...connection })).digest("hex"),
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
export async function ensureConnection(options: { stateDir?: string; runtime?: string; servicePath?: string; explicitStateDir?: boolean } = {}): Promise<Connection> {
  const stateDir = options.stateDir ?? stateDirectory();
  const probe = async () => {
    const connection = await readPrivateConnection(stateDir);
    let response: Response;
    try { response = await fetch(`${connection.baseUrl}/v1/health`, { headers: { Authorization: `Bearer ${connection.token}` }, redirect: "error", signal: AbortSignal.timeout(2000) }); }
    catch (error) {
      if (error instanceof Error && error.name === "TimeoutError") throw new Error(`The registered Moguri service (protocol ${connection.protocolVersion}) did not respond. Its owner is unconfirmed; no replacement or force-stop was attempted. Close the original service and retry. Stored data was preserved.`, { cause: error });
      throw error;
    }
    if (!response.ok) throw new Error("Existing Moguri service rejected the connection.");
    const health: unknown = await response.json();
    if (!isRecord(health) || health.protocolVersion !== connection.protocolVersion || health.pid !== connection.pid) throw new Error("Moguri service identity or protocol changed. No unverified owner was restarted.");
    if (connection.protocolVersion !== PROTOCOL_VERSION) throw new ServiceProtocolMismatch(await serviceUpgradeReview(connection, stateDir));
    return connection;
  };
  try { return await probe(); } catch (error) {
    if (!unavailable(error)) throw error;
  }
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  const log = await open(join(stateDir, "service.log"), "a", 0o600);
  const source = import.meta.url.endsWith(".ts");
  const servicePath = options.servicePath ?? fileURLToPath(new URL(source ? "../../../apps/service/src/main.ts" : "./service.mjs", import.meta.url));
  const child = spawn(options.runtime ?? process.execPath, [...(servicePath.endsWith(".ts") ? ["--import", "tsx"] : []), servicePath], {
    detached: true, stdio: ["ignore", log.fd, log.fd],
    env: { PATH: hostExecutablePath(process.env.PATH), HOME: process.env.HOME, MOGURI_STATE_DIR: stateDir,
      MOGURI_STATE_DIR_EXPLICIT: (options.explicitStateDir ?? Boolean(options.stateDir || process.env.MOGURI_STATE_DIR && process.env.MOGURI_STATE_DIR_EXPLICIT !== "0")) ? "1" : "0",
      ...(process.env.MOGURI_LOCATION_DIR ? { MOGURI_LOCATION_DIR: process.env.MOGURI_LOCATION_DIR } : {}) },
  });
  let launchError: Error | undefined;
  child.on("error", (error) => { launchError = error; });
  child.unref();
  await log.close();
  for (let attempt = 0; attempt < 100; attempt++) {
    if (launchError) throw new Error(`Could not launch the Moguri service: ${launchError.message}`);
    try { return await probe(); } catch (error) { if (!unavailable(error)) throw error; await new Promise((resolve) => setTimeout(resolve, 100)); }
  }
  throw new Error("Moguri service did not become ready. Inspect service.log in the private state directory.");
}
