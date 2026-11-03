import { fileURLToPath } from "node:url";
import { ensureConnection as ensureTransportConnection, readConnection, readPrivateConnection, serviceUpgradeReview, ServiceProtocolMismatch, stateDirectory, verifyServiceInstallation, type ServiceUpgradeReview } from "../../client/src/node.ts";
import type { ServiceOptions } from "../../../apps/service/src/server.ts";
import { MoguriSdk } from "./index.ts";
import { basename, dirname, join } from "node:path";
import { lstat, open } from "node:fs/promises";
import { constants } from "node:fs";
import { isRecord, PROTOCOL_VERSION, type ArtifactExport, type Connection, type RuntimeCloseOptions } from "../../protocol/src/index.ts";
import { writeArtifactExport } from "../../../apps/service/src/artifact-export.ts";
import type { PlatformOptions } from "../../../apps/service/src/platform.ts";
import { MAX_NOTIFICATION_AUDIO_BYTES, validateNotificationWav } from "../../protocol/src/notification-sounds.ts";
import { missingServiceFile, ServiceFileDisappeared } from "../../client/src/service-files.ts";

export { readConnection, stateDirectory };
export { ServiceProtocolMismatch, type ServiceUpgradeReview };
export class ServiceUpgradeCancelled extends Error {
  constructor() { super("Service upgrade was declined. The original service, state and user terminals were left unchanged."); this.name = "ServiceUpgradeCancelled"; }
}
export { readDefaultStateLocation, readStateLocation, stateLocationDirectory, waitForStorageRelocation } from "../../client/src/state-location.ts";
export { waitForUpdateInstallArm } from "../../../apps/service/src/update-installation.ts";
const source = import.meta.url.endsWith(".ts");
const worker = (name: string) => fileURLToPath(new URL(source ? `../../../apps/service/src/${name}.ts` : `../${name}.mjs`, import.meta.url));
export async function ensureConnection(options: Parameters<typeof ensureTransportConnection>[0] & {
  confirmUpgrade?: (review: ServiceUpgradeReview) => Promise<boolean>;
} = {}): Promise<Connection> {
  const { confirmUpgrade, ...transport } = options;
  const selected = { ...transport, servicePath: transport.servicePath ?? sdkServicePath() };
  try { return await ensureTransportConnection(selected); }
  catch (error) {
    if (!(error instanceof ServiceProtocolMismatch) || !error.review.canRestart || !confirmUpgrade) throw error;
    if (!await confirmUpgrade(structuredClone(error.review))) throw new ServiceUpgradeCancelled();
    return restartMoguriService({ ...selected, stateDir: error.review.stateDir }, error.review);
  }
}
export async function restartMoguriService(options: Parameters<typeof ensureTransportConnection>[0] & { expectedConnection?: Connection } = {}, expected?: ServiceUpgradeReview): Promise<Connection> {
  const { expectedConnection, ...transport } = options;
  const stateDir = transport.stateDir ?? stateDirectory();
  const selected = { ...transport, stateDir, servicePath: transport.servicePath ?? sdkServicePath(),
    explicitStateDir: transport.explicitStateDir ?? Boolean(transport.stateDir || process.env.MOGURI_STATE_DIR && process.env.MOGURI_STATE_DIR_EXPLICIT !== "0") };
  await verifyServiceInstallation(selected);
  await stopMoguriService(stateDir, { preserveTerminals: true, ...(expectedConnection ? { expectedConnection } : {}) }, expected);
  return ensureTransportConnection(selected);
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
export async function connectMoguri(options: { stateDir?: string; runtime?: string; autoStart?: boolean; profileId?: string; confirmUpgrade?: (review: ServiceUpgradeReview) => Promise<boolean> } = {}): Promise<MoguriSdk> {
  const stateDir = options.stateDir ?? stateDirectory();
  const connection = options.autoStart === false ? await readConnection(stateDir) : await ensureConnection({
    stateDir, explicitStateDir: Boolean(options.stateDir || process.env.MOGURI_STATE_DIR && process.env.MOGURI_STATE_DIR_EXPLICIT !== "0"),
    runtime: options.runtime, confirmUpgrade: options.confirmUpgrade, servicePath: sdkServicePath(),
  });
  return new MoguriSdk(connection, () => readConnection(stateDir), options.profileId).ready();
}
async function serviceFilesAbsent(stateDir: string): Promise<boolean> {
  for (const name of ["connection.json", "service.lock", "service.lock.recovery"]) {
    try { await lstat(join(stateDir, name)); return false; }
    catch (error) { if (!missingServiceFile(error)) throw error; }
  }
  return true;
}
async function capturedServiceGone(stateDir: string, connection: Connection, acknowledged = false): Promise<boolean> {
  if (!await serviceFilesAbsent(stateDir)) return false;
  try {
    const response = await fetch(`${connection.baseUrl}/v1/health`, { headers: { Authorization: `Bearer ${connection.token}` }, redirect: "error", signal: AbortSignal.timeout(2000) });
    await response.body?.cancel();
    return false;
  } catch (error) {
    if (error instanceof TypeError && error.cause instanceof Error && "code" in error.cause && error.cause.code === "ECONNREFUSED") return serviceFilesAbsent(stateDir);
    if (acknowledged && (error instanceof Error && error.name === "TimeoutError" ||
      error instanceof TypeError && error.cause instanceof Error && "code" in error.cause && ["ECONNRESET", "UND_ERR_SOCKET"].includes(String(error.cause.code)))) return false;
    throw new Error("The captured service endpoint did not confirm exit. Shutdown is unconfirmed; inspect the original service log and retained cleanup. No replacement was started.", { cause: error });
  }
}
export async function stopMoguriService(stateDir = stateDirectory(), options: RuntimeCloseOptions & { expectedConnection?: Connection } = {}, expected?: ServiceUpgradeReview): Promise<void> {
  let value: Connection;
  try { value = await readPrivateConnection(stateDir); }
  catch (error) {
    if (!missingServiceFile(error) && !(options.expectedConnection && error instanceof ServiceFileDisappeared)) throw error;
    for (const name of ["service.lock", "service.lock.recovery"]) {
      try { await lstat(join(stateDir, name)); throw new Error("The original service registry is missing but its writer lock or recovery claim remains. Shutdown is unconfirmed; no other owner was stopped."); }
      catch (lockError) { if (!missingServiceFile(lockError)) throw lockError; }
    }
    if (!options.expectedConnection) {
      if (expected) throw new Error("The exact service reviewed for upgrade is no longer registered. Its shutdown is unconfirmed; review discovery again. No replacement was started.");
      return;
    }
    if (await capturedServiceGone(stateDir, options.expectedConnection)) return;
    throw new Error("The captured service still responds or acquired new registry/lock metadata. Shutdown is unconfirmed; no different owner was adopted.");
  }
  if (options.expectedConnection && (await serviceUpgradeReview(value, stateDir)).fingerprint !== (await serviceUpgradeReview(options.expectedConnection, stateDir)).fingerprint) throw new Error("The app's captured service connection changed. No replacement or different owner was stopped.");
  if (expected && (!expected.canRestart || !options.preserveTerminals || (await serviceUpgradeReview(value, stateDir)).fingerprint !== expected.fingerprint)) throw new Error("The exact service/root reviewed for upgrade changed. No different owner was stopped; review the current service again.");
  const fingerprint = (await serviceUpgradeReview(value, stateDir)).fingerprint;
  const url = new URL(value.baseUrl);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.username || url.password) throw new Error("Refusing to signal an unverified service.");
  let response: Response;
  try { response = await fetch(`${url.origin}/v1/health`, { headers: { Authorization: `Bearer ${value.token}` }, redirect: "error", signal: AbortSignal.timeout(2000) }); }
  catch (error) {
    if (await capturedServiceGone(stateDir, value)) return;
    throw new Error(`The registered Moguri service could not authenticate a lifecycle request. Inspect ${join(stateDir, "service.log")} and the original cleanup before retrying. No PID was signalled and no replacement was started.`, { cause: error });
  }
  if (!response.ok) throw new Error("The registered endpoint rejected lifecycle authentication. No PID was signalled and no replacement was started.");
  let health: unknown;
  try { health = await response.json(); }
  catch (error) { throw new Error("The registered endpoint returned invalid health metadata. No authenticated lifecycle owner was confirmed or stopped.", { cause: error }); }
  if (!isRecord(health) || health.pid !== value.pid || health.protocolVersion !== value.protocolVersion) throw new Error("The process does not match the authenticated Moguri service. No signal was sent.");
  const unchanged = async () => {
    let current: Connection;
    try { current = await readPrivateConnection(stateDir); }
    catch (error) { if (missingServiceFile(error) || error instanceof ServiceFileDisappeared) return false; throw error; }
    if ((await serviceUpgradeReview(current, stateDir)).fingerprint !== fingerprint) throw new Error("The service connection changed during lifecycle inspection. No different owner was stopped or adopted.");
    return true;
  };
  if (!await unchanged()) {
    if (await capturedServiceGone(stateDir, value)) return;
    throw new Error("The authenticated service registry disappeared before lifecycle acceptance. Shutdown is unconfirmed; no request was sent to a different owner.");
  }
  if (typeof health.protocolVersion === "number" && health.protocolVersion >= 23) {
    let closing: Response;
    try {
      closing = await fetch(`${url.origin}/v1/lifecycle`, { method: "POST", headers: { Authorization: `Bearer ${value.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action: options.preserveTerminals ? "restart" : "stop" }), redirect: "error", signal: AbortSignal.timeout(5000) });
    } catch (error) {
      throw new Error("The authenticated lifecycle request did not confirm acceptance. It may already be stopping; inspect its original log/cleanup before explicitly retrying. No replacement service was started.", { cause: error });
    }
    let result: unknown;
    try { result = await closing.json(); }
    catch (error) { throw new Error("The lifecycle acknowledgement was invalid. Original shutdown is unconfirmed; inspect its log/cleanup. No replacement was started.", { cause: error }); }
    if (!closing.ok || !isRecord(result) || result.accepted !== true || result.pid !== value.pid) throw new Error("The authenticated service did not accept its exact lifecycle request. No process was signalled.");
  } else process.kill(value.pid, "SIGTERM");
  const deadline = performance.now() + 30_000;
  while (performance.now() < deadline) {
    if (!await unchanged() && await capturedServiceGone(stateDir, value, true)) return;
    if (typeof health.protocolVersion === "number" && health.protocolVersion >= 23) {
      let current: unknown;
      try {
        const status = await fetch(`${url.origin}/v1/health`, { headers: { Authorization: `Bearer ${value.token}` }, redirect: "error", signal: AbortSignal.timeout(2000) });
        if (!status.ok) throw new Error("The captured service rejected lifecycle inspection. Shutdown is unconfirmed; no different owner was adopted.");
        current = await status.json();
      } catch (error) {
        if (!(error instanceof TypeError && error.cause instanceof Error && "code" in error.cause && ["ECONNREFUSED", "ECONNRESET", "UND_ERR_SOCKET"].includes(String(error.cause.code))) &&
          !(error instanceof Error && error.name === "TimeoutError")) throw error;
      }
      if (current !== undefined && (!isRecord(current) || current.pid !== value.pid || current.protocolVersion !== value.protocolVersion)) throw new Error("The authenticated lifecycle endpoint changed identity or protocol. Original shutdown is unconfirmed; no different owner was adopted.");
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
