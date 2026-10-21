import { randomBytes, randomUUID } from "node:crypto";
import { MoguriError, parse } from "../../packages/protocol/src/core.ts";
import { PreparedRemoteTerminalOwnerSchema, RemoteTerminalOwnerSchema, type RemoteTerminalOwner, type TerminalState } from "../../packages/protocol/src/terminals.ts";
import { MoguriSdk } from "../../packages/sdk/src/index.ts";
import { RemoteConsoles } from "../../apps/service/src/remote-terminals.ts";
import { terminalOwnerScope } from "../../apps/service/src/terminal-identity.ts";
import { TerminalInspectSchema, TerminalOwnerInfoSchema, TerminalReadSchema, type TerminalLaunch } from "../../apps/service/src/terminal-protocol.ts";
import { frameDigest } from "../../apps/service/src/worker-wire.ts";
import type { RemoteTerminalChannel } from "../../apps/service/src/remote-terminal-channel.ts";
import { remoteFixture } from "./remote-service.ts";

export async function remoteConsoleServiceFixture() {
  const f = await remoteFixture({ exposeModels: false }), sdk = await new MoguriSdk(f.service.connection).ready();
  let consoles = new RemoteConsoles(f.controller.remote), owner: RemoteTerminalOwner | undefined, channel: RemoteTerminalChannel | undefined;
  const key = randomBytes(32).toString("base64"), slot = () => `terminal-owner-${owner!.id}`;
  const recordOwner = (next: RemoteTerminalOwner) => {
    f.service.store.commit([{ event_type: "terminal.owner_changed", profile_id: "default", payload: { owner: next } }]); owner = next; f.controller.refreshProfile();
  };
  const recordTerminal = (terminal: TerminalState) => {
    f.service.store.commit([{ event_type: "terminal.changed", profile_id: "default", project_id: terminal.projectId, session_id: terminal.sessionId, payload: { terminal } }]);
    f.controller.refreshProfile();
  };
  const close = async () => {
    try {
      if (owner && owner.cleanup !== "removed") {
        if (owner.status !== "stopped") {
          if (!channel && owner.directory !== null) channel = (await consoles.connect(parse(PreparedRemoteTerminalOwnerSchema, owner), key, randomUUID(), () => {}, AbortSignal.timeout(10_000))).channel;
          if (channel) {
            const stopped = parse(TerminalOwnerInfoSchema, await channel.request({ action: "close-all" }));
            recordOwner(parse(RemoteTerminalOwnerSchema, stopped.owner));
            for (const terminal of f.controller.snapshot().terminals.filter((terminal) => terminal.ownerId === owner!.id)) {
              const observed = parse(TerminalInspectSchema, await channel.request({ action: "inspect", terminalId: terminal.id }));
              recordTerminal({ ...terminal, ...observed.terminal });
            }
            channel.retire(); await channel.request({ action: "dispose" }); await channel.detach(); channel = undefined;
          } else recordOwner({ ...owner, status: "stopped" });
        }
        recordOwner({ ...owner!, status: "stopped", cleanup: "pending" });
        await consoles.cleanup(owner!, AbortSignal.timeout(10_000));
        await f.terminalVault.remove(slot()); recordOwner({ ...owner!, cleanup: "removed" });
      }
    } finally { sdk.disconnect(); await f.close(); }
  };
  try {
    await f.probe(); await sdk.sessions.env(f.sessionId, "Remote");
    const admission = consoles.admission(), scope = { profileId: "default", sessionId: f.sessionId, projectId: f.session().projectId!, workspaceId: null, root: f.workspace };
    const binding = await consoles.binding(scope, admission.boundary, AbortSignal.timeout(10_000)), now = new Date().toISOString();
    const first = parse(RemoteTerminalOwnerSchema, { id: randomUUID(), profileId: "default", env: "Remote", remote: admission.boundary, protocol: 1,
      buildDigest: admission.boundary.brokerDigest, scopeDigest: "0".repeat(64), directory: null, endpoint: null, pid: null, status: "preparing",
      cleanup: "retained", createdAt: now, updatedAt: now, diagnostic: null });
    recordOwner({ ...first, scopeDigest: terminalOwnerScope(first) });
    recordOwner(await consoles.prepare(owner!, AbortSignal.timeout(10_000)));
    await f.terminalVault.write(slot(), key);
    const attached = await consoles.connect(parse(PreparedRemoteTerminalOwnerSchema, owner), key, randomUUID(), () => { channel = undefined; }, AbortSignal.timeout(10_000), true);
    channel = attached.channel; recordOwner(parse(RemoteTerminalOwnerSchema, attached.info.owner));
    const launch: TerminalLaunch = { executable: "/bin/sh", args: ["-c", "printf 'GENERATED_PRODUCTION_REMOTE_CONSOLE\\n'; pwd; exec cat"] };
    const terminal = (): TerminalState => {
      const id = randomUUID(), title = "Generated Remote user console";
      return { id, sessionId: scope.sessionId, projectId: scope.projectId, workspaceId: null, title, cols: 80, rows: 24, pid: null, status: "starting",
        diagnostic: null, env: "Remote", binding, ownerId: owner!.id, commandId: randomUUID(), commandDigest: frameDigest({ id, action: "generated-terminal-open" }),
        launchDigest: frameDigest([id, binding, launch, 80, 24, title]) };
    };
    const open = async (intent = terminal()) => {
      if (!channel) throw new MoguriError("generated_console_closed", "Generated exact channel is detached.");
      recordTerminal(intent); const actual = parse(TerminalInspectSchema, await channel.request({ action: "open", intent, launch }));
      if (actual.launchDigest !== intent.launchDigest) throw new Error("Generated actual Remote launch digest changed.");
      recordTerminal(actual.terminal); return { intent, terminal: actual.terminal };
    };
    const read = async (terminal: TerminalState) => {
      if (!channel) throw new Error("No generated Remote channel.");
      return parse(TerminalReadSchema, await channel.request({ action: "read", terminalId: terminal.id, bindingDigest: binding.digest, offset: 0, limit: 65536 }));
    };
    const reconnect = async () => {
      await channel?.detach(); channel = undefined;
      const attached = await consoles.connect(parse(PreparedRemoteTerminalOwnerSchema, owner), key, randomUUID(), () => { channel = undefined; }, AbortSignal.timeout(10_000));
      channel = attached.channel; recordOwner(parse(RemoteTerminalOwnerSchema, attached.info.owner)); return attached.info;
    };
    return { ...f, sdk, admission, binding, launch, key, owner: parse(PreparedRemoteTerminalOwnerSchema, owner), terminal, open, read, reconnect, recordOwner, recordTerminal,
      get channel() { if (!channel) throw new Error("Generated Remote console is detached."); return channel; },
      useTransport: (next: RemoteConsoles) => { consoles = next; channel = undefined; },
      close };
  } catch (error) { try { await close(); } catch (cleanup) { throw new AggregateError([error, cleanup], "Generated Remote console initialization/cleanup were not both confirmed."); } throw error; }
}
