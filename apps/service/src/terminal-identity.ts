import { createHmac, timingSafeEqual } from "node:crypto";
import { lstatSync, realpathSync } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import { basename, isAbsolute, join } from "node:path";
import { MoguriError } from "../../../packages/protocol/src/core.ts";
import type { TerminalBinding, TerminalOwner, PreparedTerminalOwner } from "../../../packages/protocol/src/terminals.ts";
import type { RemoteIdentity } from "../../../packages/protocol/src/execution.ts";
import { frameDigest } from "./worker-wire.ts";

export function terminalBinding(scope: { profileId: string; workspaceId: string | null; root: string } &
  ({ sessionId: string | null; projectId: string | null; env?: "Local" } | { sessionId: string; projectId: string; env: "Remote"; peerDigest: string })): TerminalBinding {
  if (!isAbsolute(scope.root)) throw new MoguriError("terminal_root", "A terminal needs an explicit canonical root. No previous folder was reused.", 409);
  const state = lstatSync(scope.root, { bigint: true });
  if (!state.isDirectory() || state.isSymbolicLink() || realpathSync(scope.root) !== scope.root) throw new MoguriError("terminal_root", "The exact terminal root is no longer a canonical directory. Inspect it before input.", 409);
  const base = { profileId: scope.profileId, workspaceId: scope.workspaceId, root: scope.root, device: String(state.dev), inode: String(state.ino) };
  const identity = scope.env === "Remote" ? { ...base, sessionId: scope.sessionId, projectId: scope.projectId, env: "Remote" as const, peerDigest: scope.peerDigest } :
    { ...base, sessionId: scope.sessionId, projectId: scope.projectId, env: "Local" as const };
  return { ...identity, digest: frameDigest(identity) };
}
export function assertTerminalBinding(binding: TerminalBinding): void {
  if (terminalBinding(binding).digest !== binding.digest) throw new MoguriError("terminal_root_changed", "The terminal root identity changed. No input or replacement shell was sent to another folder.", 409);
}
export const remoteTerminalPeer = (target: Pick<RemoteIdentity, "host" | "port" | "user" | "hostKey">) =>
  frameDigest(["moguri-remote-user-terminal-peer-v1", target.host, target.port, target.user, target.hostKey]);
export const terminalOwnerScope = (owner: Pick<TerminalOwner, "id" | "profileId"> & { remote?: TerminalOwner["remote"] }) => owner.remote ?
  frameDigest(["moguri-remote-user-terminal-owner-v1", owner.profileId, owner.id, owner.remote.peerDigest, owner.remote.bridgeDigest, owner.remote.brokerDigest]) :
  frameDigest(["moguri-user-terminal-owner-v1", owner.profileId, owner.id]);
export function preparedTerminalOwner(owner: TerminalOwner): PreparedTerminalOwner {
  if (owner.directory === null || owner.endpoint === null) throw new MoguriError("terminal_owner_preparing", "This exact Remote owner has no prepared endpoint. No Local path or replacement was used.", 409);
  return owner;
}
export async function assertTerminalEndpoint(owner: TerminalOwner, socket = true): Promise<void> {
  const prepared = preparedTerminalOwner(owner);
  if (prepared.endpoint !== join(prepared.directory, "control.sock") || !isAbsolute(prepared.directory) || !/^mo-[a-zA-Z0-9]{6,12}$/.test(basename(prepared.directory)) || Buffer.byteLength(prepared.endpoint) >= 104 ||
    owner.scopeDigest !== terminalOwnerScope(owner)) throw new MoguriError("terminal_endpoint", "Terminal owner endpoint/scope metadata is invalid. Nothing was adopted.", 409);
  const directory = await lstat(prepared.directory);
  if (!directory.isDirectory() || directory.isSymbolicLink() || directory.uid !== process.getuid?.() || directory.mode & 0o077 ||
    await realpath(prepared.directory) !== prepared.directory) throw new MoguriError("terminal_endpoint", "Terminal runtime directory is not canonical, private and user-owned. Nothing was adopted.", 409);
  if (!socket) return;
  const endpoint = await lstat(prepared.endpoint);
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
