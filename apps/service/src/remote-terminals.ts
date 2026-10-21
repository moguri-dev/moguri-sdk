import { isAbsolute } from "node:path";
import { isRecord, MoguriError, parse } from "../../../packages/protocol/src/core.ts";
import { PreparedRemoteTerminalOwnerSchema, TerminalBindingSchema, type PreparedRemoteTerminalOwner, type RemoteTerminalBoundary, type RemoteTerminalOwner } from "../../../packages/protocol/src/terminals.ts";
import type { RemoteRuntime } from "./remote.ts";
import { RemoteTerminalChannel, remoteTerminalFormat } from "./remote-terminal-channel.ts";
import { remoteTerminalPeer, terminalOwnerScope } from "./terminal-identity.ts";
import type { TerminalLaunch } from "./terminal-protocol.ts";

export interface RemoteConsoleScope {
  profileId: string; sessionId: string; projectId: string; workspaceId: null; root: string;
}
export interface RemoteConsoleAdmission { boundary: RemoteTerminalBoundary; launch: TerminalLaunch }
export class RemoteConsoles {
  constructor(private readonly runtime: RemoteRuntime) {}
  admission(): RemoteConsoleAdmission {
    const target = this.runtime.assertReady(), build = this.runtime.readiness.terminalBuild;
    if (!build || !isAbsolute(build.shell) || /[\0\r\n]/.test(build.shell)) throw new MoguriError("terminal_remote_unready", this.runtime.readiness.terminalDiagnostic ?? "Probe this exact installed console bridge/broker before Remote console admission. No Local shell was substituted.", 409);
    return { boundary: { target: { id: target.id, name: target.name, host: target.host, port: target.port, user: target.user, hostKey: target.hostKey,
      identityFile: target.identityFile, stateDir: target.stateDir, command: build.command }, peerDigest: remoteTerminalPeer(target), bridgeDigest: build.bridgeDigest, brokerDigest: build.brokerDigest },
      launch: { executable: build.shell, args: ["-l"] } };
  }
  async binding(scope: RemoteConsoleScope, boundary: RemoteTerminalBoundary, signal: AbortSignal) {
    const result = await RemoteTerminalChannel.query(this.runtime, boundary, { ...remoteTerminalFormat, action: "binding", ...scope,
      peerDigest: boundary.peerDigest, bridgeDigest: boundary.bridgeDigest, brokerDigest: boundary.brokerDigest }, signal);
    if (!isRecord(result)) throw new MoguriError("terminal_remote_binding", "Remote console root admission returned no exact binding.", 409);
    const binding = parse(TerminalBindingSchema, result.binding);
    if (binding.env !== "Remote" || binding.peerDigest !== boundary.peerDigest || binding.profileId !== scope.profileId || binding.sessionId !== scope.sessionId ||
      binding.projectId !== scope.projectId || binding.workspaceId !== null || binding.root !== scope.root) throw new MoguriError("terminal_remote_binding", "Remote root observation changed its exact profile/session/project/peer. No Local or different root was used.", 409);
    return binding;
  }
  async prepare(owner: RemoteTerminalOwner, signal: AbortSignal): Promise<PreparedRemoteTerminalOwner> {
    const result = await RemoteTerminalChannel.query(this.runtime, owner.remote, { ...remoteTerminalFormat, action: "prepare", owner }, signal);
    if (!isRecord(result)) throw new MoguriError("terminal_remote_prepare", "Remote owner preparation has no exact receipt. Its original intent was retained.", 409);
    const prepared = parse(PreparedRemoteTerminalOwnerSchema, result.owner);
    if (prepared.id !== owner.id || prepared.profileId !== owner.profileId || prepared.scopeDigest !== owner.scopeDigest || prepared.buildDigest !== owner.buildDigest ||
      JSON.stringify(prepared.remote) !== JSON.stringify(owner.remote) || prepared.createdAt !== owner.createdAt || prepared.pid !== null || prepared.status !== "starting" ||
      prepared.scopeDigest !== terminalOwnerScope(prepared)) throw new MoguriError("terminal_remote_prepare", "Remote endpoint preparation changed the original owner/peer/build. Nothing was adopted.", 409);
    return prepared;
  }
  connect(owner: PreparedRemoteTerminalOwner, key: string, clientId: string, lost: (diagnostic: string) => void, signal: AbortSignal, start = false) {
    return RemoteTerminalChannel.connect(this.runtime, owner, key, clientId, lost, signal, start);
  }
  async cleanup(owner: RemoteTerminalOwner, signal: AbortSignal): Promise<void> {
    const result = await RemoteTerminalChannel.query(this.runtime, owner.remote, { ...remoteTerminalFormat, action: "cleanup", owner }, signal);
    if (!isRecord(result) || result.removed !== true) throw new MoguriError("terminal_remote_cleanup", "Exact remote private-resource cleanup was not acknowledged. Metadata and pending cleanup were retained.", 409);
  }
}
