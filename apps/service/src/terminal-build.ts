import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { MoguriError } from "../../../packages/protocol/src/core.ts";
import type { RemoteTerminalBuild } from "../../../packages/protocol/src/terminals.ts";

export const terminalBridgePath = () => fileURLToPath(new URL(import.meta.url.endsWith(".ts") ? "./terminal-bridge.ts" : "./terminal-bridge.mjs", import.meta.url));
export const terminalBrokerPath = () => fileURLToPath(new URL(import.meta.url.endsWith(".ts") ? "./terminal-broker.ts" : "./terminal-broker.mjs", import.meta.url));
export async function remoteTerminalBuild(): Promise<RemoteTerminalBuild> {
  const path = terminalBridgePath(), shell = process.env.SHELL ?? "/bin/sh";
  if (!isAbsolute(shell) || /[\0\r\n]/.test(shell)) throw new MoguriError("terminal_shell", "The execution host's shell is not an explicit valid absolute path. No alternate shell was selected.", 409);
  const [bridge, broker] = await Promise.all([readFile(path), readFile(terminalBrokerPath())]);
  return { command: [process.execPath, ...(path.endsWith(".ts") ? ["--import", createRequire(import.meta.url).resolve("tsx")] : []), path, "--moguri-terminal-bridge"],
    bridgeDigest: createHash("sha256").update(bridge).digest("hex"), brokerDigest: createHash("sha256").update(broker).digest("hex"), shell };
}
