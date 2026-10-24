import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { MoguriError } from "../../../packages/protocol/src/core.ts";
import type { RemoteTerminalBuild } from "../../../packages/protocol/src/terminals.ts";
import { terminalShell } from "./terminal-shell.ts";

export const terminalBridgePath = () => fileURLToPath(new URL(import.meta.url.endsWith(".ts") ? "./terminal-bridge.ts" : "./terminal-bridge.mjs", import.meta.url));
export const terminalBrokerPath = () => fileURLToPath(new URL(import.meta.url.endsWith(".ts") ? "./terminal-broker.ts" : "./terminal-broker.mjs", import.meta.url));
export async function terminalBuildDigests(): Promise<Pick<RemoteTerminalBuild, "bridgeDigest" | "brokerDigest">> {
  const [bridge, broker] = await Promise.all([readFile(terminalBridgePath()), readFile(terminalBrokerPath())]);
  return { bridgeDigest: createHash("sha256").update(bridge).digest("hex"), brokerDigest: createHash("sha256").update(broker).digest("hex") };
}
function unavailable(error: unknown): string {
  const filesystem = error instanceof Error && "code" in error && ["ENOENT", "ENOTDIR", "EACCES"].includes(String(error.code));
  if (!filesystem && !(error instanceof MoguriError && error.code === "terminal_shell")) throw error;
  return error instanceof MoguriError ? error.message :
    "Console bridge/broker helpers are missing or inaccessible on this execution host. Core agent readiness is separate; no console or Local fallback is authorized.";
}
export async function probeTerminalDigests(): Promise<{ terminalBuild?: Pick<RemoteTerminalBuild, "bridgeDigest" | "brokerDigest">; terminalDiagnostic: string }> {
  try { return { terminalBuild: await terminalBuildDigests(), terminalDiagnostic: "Expected console helper bytes are installed; no controller shell was selected." }; }
  catch (error) { return { terminalDiagnostic: unavailable(error) }; }
}
export async function remoteTerminalBuild(): Promise<RemoteTerminalBuild> {
  const digests = await terminalBuildDigests(), path = terminalBridgePath(), shell = terminalShell();
  return { command: [process.execPath, ...(path.endsWith(".ts") ? ["--import", createRequire(import.meta.url).resolve("tsx")] : []), path, "--moguri-terminal-bridge"],
    ...digests, shell };
}
export async function probeTerminalBuild(): Promise<{ terminalBuild?: RemoteTerminalBuild; terminalDiagnostic: string }> {
  try { return { terminalBuild: await remoteTerminalBuild(), terminalDiagnostic: "Console helper bytes are installed. Exact peer/policy/lifecycle admission remains separate." }; }
  catch (error) {
    return { terminalDiagnostic: unavailable(error) };
  }
}
