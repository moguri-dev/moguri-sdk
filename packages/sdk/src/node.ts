import { fileURLToPath } from "node:url";
import { ensureConnection as ensureTransportConnection, readConnection, stateDirectory } from "../../client/src/node.ts";
import type { ServiceOptions } from "../../../apps/service/src/server.ts";
import { MoguriSdk } from "./index.ts";
import { basename, dirname, join } from "node:path";
import { lstat, open, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { isRecord, PROTOCOL_VERSION, type ArtifactExport, type Connection, type RuntimeCloseOptions } from "../../protocol/src/index.ts";
import { writeArtifactExport } from "../../../apps/service/src/artifact-export.ts";
import type { PlatformOptions } from "../../../apps/service/src/platform.ts";
import { MAX_NOTIFICATION_AUDIO_BYTES, validateNotificationWav } from "../../protocol/src/notification-sounds.ts";

export { readConnection, stateDirectory };
const source = import.meta.url.endsWith(".ts");
const worker = (name: string) => fileURLToPath(new URL(source ? `../../../apps/service/src/${name}.ts` : `../${name}.mjs`, import.meta.url));
export function ensureConnection(options: Parameters<typeof ensureTransportConnection>[0] = {}) {
  return ensureTransportConnection({ ...options, servicePath: options?.servicePath ?? sdkServicePath() });
}
export async function createRuntime(options: ServiceOptions) {
  const runtime: typeof import("../../../apps/service/src/server.ts") = await import(new URL(source ? "../../../apps/service/src/server.ts" : "../runtime.mjs", import.meta.url).href);
  const profilePlatform = options.profiles?.platform;
  const platform = (configured: PlatformOptions | undefined): PlatformOptions => ({
    ...configured, mcpWorkerPath: configured?.mcpWorkerPath ?? worker("mcp-worker"),
    terminal: { ...configured?.terminal, brokerPath: configured?.terminal?.brokerPath ?? worker("terminal-broker") },
    speech: { ...configured?.speech, executable: configured?.speech?.executable ?? fileURLToPath(new URL(source ? "../../../.native/speech/bin/nemo-speech" : "../native/speech/bin/nemo-speech", import.meta.url)) },
  });
  return runtime.startService({
    ...options, workerPath: options.workerPath ?? worker("worker"),
    platform: platform(options.platform),
    ...(profilePlatform ? { profiles: { ...options.profiles, platform: (id: string) => platform(profilePlatform(id) ?? options.platform) } } : {}),
  });
}
export async function connectMoguri(options: { stateDir?: string; runtime?: string; autoStart?: boolean; profileId?: string } = {}): Promise<MoguriSdk> {
  const stateDir = options.stateDir ?? stateDirectory();
  const connection = options.autoStart === false ? await readConnection(stateDir) : await ensureConnection({
    stateDir, runtime: options.runtime, servicePath: fileURLToPath(new URL(source ? "../../../apps/service/src/main.ts" : "../service.mjs", import.meta.url)),
  });
  return new MoguriSdk(connection, () => readConnection(stateDir), options.profileId).ready();
}
export async function stopMoguriService(stateDir = stateDirectory(), options: RuntimeCloseOptions = {}): Promise<void> {
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
  if (typeof health.protocolVersion === "number" && health.protocolVersion >= 23) {
    const closing = await fetch(`${url.origin}/v1/lifecycle`, { method: "POST", headers: { Authorization: `Bearer ${value.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action: options.preserveTerminals ? "restart" : "stop" }), signal: AbortSignal.timeout(5000) });
    const result: unknown = await closing.json();
    if (!closing.ok || !isRecord(result) || result.accepted !== true || result.pid !== value.pid) throw new Error("The authenticated service did not accept its exact lifecycle request. No process was signalled.");
  } else process.kill(value.pid, "SIGTERM");
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try { await lstat(path); } catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") return; throw error; }
    if (typeof health.protocolVersion === "number" && health.protocolVersion >= 23) {
      let current: unknown;
      try {
        const status = await fetch(`${url.origin}/v1/health`, { headers: { Authorization: `Bearer ${value.token}` }, signal: AbortSignal.timeout(2000) });
        if (status.ok) current = await status.json();
      } catch (error) {
        if (!(error instanceof TypeError && error.cause instanceof Error && "code" in error.cause && ["ECONNREFUSED", "ECONNRESET", "UND_ERR_SOCKET"].includes(String(error.cause.code))) &&
          !(error instanceof Error && error.name === "TimeoutError")) throw error;
      }
      if (isRecord(current) && current.pid === value.pid && isRecord(current.lifecycle) && current.lifecycle.status === "unconfirmed") {
        throw new Error("Service shutdown is unconfirmed; its registry and writer lock remain. Restore the explicit terminal backend or inspect its processes, then retry stop/restart. No second writer was launched.");
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Service shutdown is unconfirmed. Do not launch a second writer.");
}
export function sdkServicePath(): string { return source ? worker("main") : join(dirname(fileURLToPath(import.meta.url)), "..", "service.mjs"); }
export const protocolVersion = PROTOCOL_VERSION;
export async function saveArtifactExport(path: string, document: ArtifactExport): Promise<{ path: string; digest: string }> {
  return writeArtifactExport(path, document);
}
export async function loadNotificationSoundFile(path: string): Promise<{ name: string; audio: string }> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadata = await file.stat();
    if (!metadata.isFile() || metadata.size > MAX_NOTIFICATION_AUDIO_BYTES) throw new Error("Select a regular mono 16-kHz PCM16 WAV up to ten seconds. No compressed or oversized audio was decoded.");
    const bytes = Buffer.alloc(MAX_NOTIFICATION_AUDIO_BYTES + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const value = await file.read(bytes, offset, bytes.length - offset, offset);
      if (!value.bytesRead) break; offset += value.bytesRead;
    }
    const audio = bytes.subarray(0, offset);
    validateNotificationWav(audio);
    const name = basename(path).replace(/\.wav$/i, "");
    if (!name.trim() || name.length > 80 || /[\u0000-\u001f\u007f]/.test(name)) throw new Error("Use a sound filename up to 80 characters without control characters.");
    return { name, audio: audio.toString("base64") };
  } finally { await file.close(); }
}
export type { Connection };
