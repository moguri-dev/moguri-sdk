import { createHmac, timingSafeEqual } from "node:crypto";
import { lstatSync, realpathSync } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import { basename, isAbsolute, join } from "node:path";
import { MoguriError } from "../../../packages/protocol/src/core.ts";
import type { TerminalBinding, TerminalOwner } from "../../../packages/protocol/src/terminals.ts";
import { frameDigest } from "./worker-wire.ts";

export function terminalBinding(scope: { profileId: string; sessionId: string; projectId: string; workspaceId: string | null; root: string }): TerminalBinding {
  if (!isAbsolute(scope.root)) throw new MoguriError("terminal_root", "A terminal needs an explicit canonical root. No previous folder was reused.", 409);
  const state = lstatSync(scope.root, { bigint: true });
  if (!state.isDirectory() || state.isSymbolicLink() || realpathSync(scope.root) !== scope.root) throw new MoguriError("terminal_root", "The exact terminal root is no longer a canonical directory. Inspect it before input.", 409);
  const identity = { profileId: scope.profileId, sessionId: scope.sessionId, projectId: scope.projectId, workspaceId: scope.workspaceId, root: scope.root,
    env: "Local" as const, device: String(state.dev), inode: String(state.ino) };
  return { ...identity, digest: frameDigest(identity) };
}
export function assertTerminalBinding(binding: TerminalBinding): void {
  if (terminalBinding(binding).digest !== binding.digest) throw new MoguriError("terminal_root_changed", "The terminal root identity changed. No input or replacement shell was sent to another folder.", 409);
}
export const terminalOwnerScope = (owner: Pick<TerminalOwner, "id" | "profileId">) => frameDigest(["moguri-user-terminal-owner-v1", owner.profileId, owner.id]);
export async function assertTerminalEndpoint(owner: TerminalOwner, socket = true): Promise<void> {
  if (owner.endpoint !== join(owner.directory, "control.sock") || !isAbsolute(owner.directory) || !/^mo-[a-zA-Z0-9]{6}$/.test(basename(owner.directory)) || Buffer.byteLength(owner.endpoint) >= 104 ||
    owner.scopeDigest !== terminalOwnerScope(owner)) throw new MoguriError("terminal_endpoint", "Terminal owner endpoint/scope metadata is invalid. Nothing was adopted.", 409);
  const directory = await lstat(owner.directory);
  if (!directory.isDirectory() || directory.isSymbolicLink() || directory.uid !== process.getuid?.() || directory.mode & 0o077 ||
    await realpath(owner.directory) !== owner.directory) throw new MoguriError("terminal_endpoint", "Terminal runtime directory is not canonical, private and user-owned. Nothing was adopted.", 409);
  if (!socket) return;
  const endpoint = await lstat(owner.endpoint);
  if (!endpoint.isSocket() || endpoint.isSymbolicLink() || endpoint.uid !== process.getuid?.() || endpoint.mode & 0o077) throw new MoguriError("terminal_endpoint", "Terminal control socket is not private and owned. No authentication/input was sent.", 409);
}
export function terminalKey(key: string): Buffer {
  const bytes = Buffer.from(key, "base64");
  if (bytes.length !== 32 || bytes.toString("base64") !== key) throw new MoguriError("terminal_key", "Terminal authentication key is missing or invalid. Preserve the original secret backend.", 409);
  return bytes;
}
export const terminalProof = (key: string, role: "client" | "server", nonce: string, scope: string, clientId: string) =>
  createHmac("sha256", terminalKey(key)).update(JSON.stringify(["moguri-user-terminal-auth-v1", role, nonce, scope, clientId])).digest("hex");
export const validTerminalProof = (value: unknown, expected: string): boolean =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value) && timingSafeEqual(Buffer.from(value, "hex"), Buffer.from(expected, "hex"));
