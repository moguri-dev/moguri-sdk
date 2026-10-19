import { fileURLToPath } from "node:url";
import { ensureConnection as ensureTransportConnection, readConnection, stateDirectory } from "../../client/src/node.ts";
import { startService, type ServiceOptions } from "../../../apps/service/src/server.ts";
import { MoguriSdk } from "./index.ts";
import { basename, dirname, isAbsolute, join } from "node:path";
import { link, lstat, open, readFile, realpath, unlink } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { isRecord, PROTOCOL_VERSION, type ArtifactExport, type Connection } from "../../protocol/src/index.ts";

export { readConnection, stateDirectory };
const source = import.meta.url.endsWith(".ts");
const worker = (name: string) => fileURLToPath(new URL(source ? `../../../apps/service/src/${name}.ts` : `../${name}.mjs`, import.meta.url));
export function ensureConnection(options: Parameters<typeof ensureTransportConnection>[0] = {}) {
  return ensureTransportConnection({ ...options, servicePath: options?.servicePath ?? sdkServicePath() });
}
export function createRuntime(options: ServiceOptions) {
  return startService({
    ...options, workerPath: options.workerPath ?? worker("worker"),
    platform: {
      ...options.platform, mcpWorkerPath: options.platform?.mcpWorkerPath ?? worker("mcp-worker"),
      speech: { ...options.platform?.speech, executable: options.platform?.speech?.executable ?? fileURLToPath(new URL(source ? "../../../.native/speech/bin/nemo-speech" : "../native/speech/bin/nemo-speech", import.meta.url)) },
    },
  });
}
export async function connectMoguri(options: { stateDir?: string; runtime?: string; autoStart?: boolean } = {}): Promise<MoguriSdk> {
  const stateDir = options.stateDir ?? stateDirectory();
  const connection = options.autoStart === false ? await readConnection(stateDir) : await ensureConnection({
    stateDir, runtime: options.runtime, servicePath: fileURLToPath(new URL(source ? "../../../apps/service/src/main.ts" : "../service.mjs", import.meta.url)),
  });
  return new MoguriSdk(connection, () => readConnection(stateDir)).ready();
}
export async function stopMoguriService(stateDir = stateDirectory()): Promise<void> {
  const path = join(stateDir, "connection.json");
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.uid !== process.getuid?.() || metadata.mode & 0o077) throw new Error("Refusing to use non-private service metadata.");
  const value: unknown = JSON.parse(await readFile(path, "utf8"));
  if (!isRecord(value) || typeof value.baseUrl !== "string" || typeof value.token !== "string" || typeof value.pid !== "number" || !Number.isSafeInteger(value.pid) || value.pid < 2) throw new Error("Service metadata is invalid.");
  const url = new URL(value.baseUrl);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.username || url.password) throw new Error("Refusing to signal an unverified service.");
  const response = await fetch(`${url.origin}/v1/health`, { headers: { Authorization: `Bearer ${value.token}` }, signal: AbortSignal.timeout(2000) });
  const health: unknown = await response.json();
  if (!response.ok || !isRecord(health) || health.pid !== value.pid) throw new Error("The process does not match the authenticated Moguri service. No signal was sent.");
  process.kill(value.pid, "SIGTERM");
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try { await lstat(path); } catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") return; throw error; }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Service shutdown is unconfirmed. Do not launch a second writer.");
}
export function sdkServicePath(): string { return source ? worker("main") : join(dirname(fileURLToPath(import.meta.url)), "..", "service.mjs"); }
export const protocolVersion = PROTOCOL_VERSION;
export async function saveArtifactExport(path: string, document: ArtifactExport): Promise<{ path: string; digest: string }> {
  if (!isAbsolute(path) || Buffer.byteLength(document.text) > 8 * 1024 * 1024 || createHash("sha256").update(document.text).digest("hex") !== document.digest) throw new Error("Choose an absolute export destination and an exact bounded SDK export. No file was written.");
  const parent = await realpath(dirname(path)), target = join(parent, basename(path)), temporary = join(parent, `.moguri-export-${randomUUID()}.tmp`);
  let created = false, published = false;
  try {
    const file = await open(temporary, "wx", 0o600); created = true;
    try { await file.writeFile(document.text); await file.sync(); }
    finally { await file.close(); }
    await link(temporary, target); published = true;
    await unlink(temporary); created = false;
    const directory = await open(parent, "r");
    try { await directory.sync(); } finally { await directory.close(); }
    return { path: target, digest: document.digest };
  } catch (error) {
    throw new Error(published ? "Export file was created, but persistence was not fully acknowledged. Inspect its checksum; no project copy was deleted." :
      error instanceof Error && "code" in error && error.code === "EEXIST" ? "The export destination already exists and was preserved. Choose a new file." :
      `Export failed; no stored artifact was deleted. ${error instanceof Error ? error.message : "Check destination permissions."}`, { cause: error });
  } finally {
    if (created) await unlink(temporary);
  }
}
export type { Connection };
