import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { lstat, mkdir, open, readFile } from "node:fs/promises";
import { isRecord, PROTOCOL_VERSION, type Connection } from "../../protocol/src/index.ts";

export function stateDirectory(): string {
  return process.env.MOGURI_STATE_DIR ? resolve(process.env.MOGURI_STATE_DIR) :
    process.platform === "darwin" ? join(homedir(), "Library", "Application Support", "Moguri") : join(homedir(), ".local", "state", "moguri");
}
export async function readConnection(stateDir = stateDirectory()): Promise<Connection> {
  const path = join(stateDir, "connection.json");
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.uid !== process.getuid?.() || (metadata.mode & 0o077)) {
    throw new Error("Connection metadata is not private or is not owned by this user.");
  }
  const value: unknown = JSON.parse(await readFile(path, "utf8"));
  if (!isRecord(value) || value.protocolVersion !== PROTOCOL_VERSION || typeof value.baseUrl !== "string" ||
    typeof value.wsUrl !== "string" || typeof value.token !== "string" || typeof value.pid !== "number") throw new Error("Unsupported or invalid Moguri connection file.");
  const url = new URL(value.baseUrl);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.pathname !== "/" || url.search || url.username || url.password ||
    value.wsUrl !== `ws://${url.host}/v1/events`) throw new Error("Moguri service must use an authenticated loopback endpoint.");
  return { protocolVersion: value.protocolVersion, baseUrl: value.baseUrl, wsUrl: value.wsUrl, token: value.token, pid: value.pid };
}
export async function ensureConnection(options: { stateDir?: string; runtime?: string; servicePath?: string } = {}): Promise<Connection> {
  const stateDir = options.stateDir ?? stateDirectory();
  const probe = async () => {
    const connection = await readConnection(stateDir);
    const response = await fetch(`${connection.baseUrl}/v1/health`, { headers: { Authorization: `Bearer ${connection.token}` }, signal: AbortSignal.timeout(500) });
    if (!response.ok) throw new Error("Existing Moguri service rejected the connection.");
    const health: unknown = await response.json();
    if (!isRecord(health) || health.protocolVersion !== PROTOCOL_VERSION || health.pid !== connection.pid) throw new Error("Moguri service identity or protocol changed.");
    return connection;
  };
  try { return await probe(); } catch (error) {
    if (error instanceof Error && "code" in error && error.code !== "ENOENT" && error.code !== "ECONNREFUSED") {
      throw error;
    }
    if (error instanceof Error && /private|owned|Unsupported|invalid|identity|protocol|rejected/.test(error.message)) throw error;
  }
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  const log = await open(join(stateDir, "service.log"), "a", 0o600);
  const source = import.meta.url.endsWith(".ts");
  const servicePath = options.servicePath ?? fileURLToPath(new URL(source ? "../../../apps/service/src/main.ts" : "./service.mjs", import.meta.url));
  const child = spawn(options.runtime ?? process.execPath, [...(servicePath.endsWith(".ts") ? ["--import", "tsx"] : []), servicePath], {
    detached: true, stdio: ["ignore", log.fd, log.fd],
    env: { PATH: process.env.PATH, HOME: process.env.HOME, MOGURI_STATE_DIR: stateDir },
  });
  let launchError: Error | undefined;
  child.on("error", (error) => { launchError = error; });
  child.unref();
  await log.close();
  for (let attempt = 0; attempt < 100; attempt++) {
    if (launchError) throw new Error(`Could not launch the Moguri service: ${launchError.message}`);
    try { return await probe(); } catch { await new Promise((resolve) => setTimeout(resolve, 100)); }
  }
  throw new Error("Moguri service did not become ready. Inspect service.log in the private state directory.");
}
