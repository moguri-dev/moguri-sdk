import test from "node:test";
import assert from "node:assert/strict";
import { MoguriSdk, type RemoteTarget } from "../packages/sdk/src/index.ts";
import { mcpResource, remoteMcpPeer, remoteMcpPreview, requireRemoteMcpGrant, type RemoteMcpScope } from "../apps/service/src/remote-mcp.ts";
import { remoteFixture } from "./fixtures/remote-service.ts";
import { envelope } from "../apps/service/src/controller.ts";

const native = { skip: process.platform !== "darwin", timeout: 20_000 };
const target: RemoteTarget = { id: "generated", name: "Generated peer", host: "127.0.0.1", port: 2222, user: "generated",
  hostKey: "ssh-ed25519 Z2VuZXJhdGVkLXB1YmxpYy1rZXk=", identityFile: "/generated/identity", stateDir: "/generated/state",
  command: ["/generated/node", "/generated/worker"], allowCopilot: false, models: [] };
const scope: RemoteMcpScope = { profileId: "default", sessionId: "generated-session", projectId: "generated-project", root: "/generated/remote",
  target, workerDigest: "a".repeat(64), settingsRevision: 0, permissionRevision: 0, policyRevision: 0, projectRevision: 0, mode: "agent", pendingMode: null };
const server = { id: "generated-http", name: "Generated resource", enabled: true, transport: { type: "http" as const, url: "https://generated.invalid/mcp", auth: "bearer" as const } };

test("Remote MCP grants default deny and bind the real peer/resource rather than display aliases", () => {
  const preview = remoteMcpPreview(scope, server, "b".repeat(64));
  assert.equal(preview.granted, false); assert.equal(preview.forwardAccess, false);
  assert.throws(() => requireRemoteMcpGrant(preview), { code: "remote_mcp_grant" });
  const grant = { serverId: server.id, peerDigest: remoteMcpPeer(target), resourceDigest: mcpResource(server).digest, forwardAccess: false };
  const granted = { ...scope, target: { ...target, mcpGrants: [grant] } };
  assert.throws(() => requireRemoteMcpGrant(remoteMcpPreview(granted, server, "b".repeat(64))), { code: "remote_mcp_credential" });
  const forwarded = { ...granted, target: { ...granted.target, mcpGrants: [{ ...grant, forwardAccess: true }] } };
  requireRemoteMcpGrant(remoteMcpPreview(forwarded, server, "b".repeat(64)));
  assert.equal(remoteMcpPreview({ ...forwarded, target: { ...forwarded.target, id: "generated-alias", name: "Generated display rename" } }, server, "b".repeat(64)).granted, true);
  for (const changed of [{ user: "generated-other-user" }, { port: 2223 }, { hostKey: "ssh-ed25519 Z2VuZXJhdGVkLWRpZmZlcmVudC1rZXk=" }]) {
    assert.equal(remoteMcpPreview({ ...forwarded, target: { ...forwarded.target, ...changed } }, server, "b".repeat(64)).granted, false);
  }
  assert.equal(remoteMcpPreview(forwarded, { ...server, transport: { ...server.transport, url: "https://generated.invalid/changed" } }, "b".repeat(64)).granted, false);
});

test("real SSH MCP grant preview/configuration needs no selected model, inference or credential read", native, async () => {
  let secretReads = 0;
  const f = await remoteFixture({ platform: { vault: { read: async () => { secretReads++; return null; }, write: async () => {}, remove: async () => {} } } });
  const sdk = await new MoguriSdk(f.service.connection).ready();
  try {
    const settings = structuredClone(sdk.settings.get()!.values); settings.mcpServers = [server];
    await sdk.settings.update(settings, sdk.settings.get()!.revision); await f.probe();
    await sdk.sessions.env(f.sessionId, "Remote");
    assert.equal(sdk.getState().snapshot!.sessions[0]?.controls.modelId, null);
    const preview = (await sdk.mcp.remotePreview(f.sessionId, server.id)).preview;
    assert.equal(preview.root, f.workspace); assert.equal(preview.granted, false);
    await sdk.mcp.grantRemote(f.sessionId, server.id, preview.digest, preview.settingsRevision, true, true);
    const grant = sdk.settings.get()!.values.remote!.mcpGrants![0]!;
    assert.equal(grant.peerDigest, preview.peerDigest); assert.equal(grant.resourceDigest, preview.resourceDigest); assert.equal(grant.forwardAccess, true);
    assert.equal(secretReads, 0); assert.equal(f.requests.length, 0);
    assert.equal(sdk.getState().snapshot!.remoteMcpCalls.length, 0);
  } finally { sdk.disconnect(); await f.close(); }
});

test("stale exact MCP resource review cannot grant access, while revocation never needs an available SSH host", native, async () => {
  const f = await remoteFixture(), sdk = await new MoguriSdk(f.service.connection).ready();
  try {
    const settings = structuredClone(sdk.settings.get()!.values); settings.mcpServers = [server];
    await sdk.settings.update(settings, sdk.settings.get()!.revision); await f.probe(); await sdk.sessions.env(f.sessionId, "Remote");
    const preview = (await sdk.mcp.remotePreview(f.sessionId, server.id)).preview;
    const changed = structuredClone(sdk.settings.get()!.values); changed.mcpServers[0] = { ...server, transport: { ...server.transport, url: "https://generated.invalid/new-resource" } };
    await sdk.settings.update(changed, sdk.settings.get()!.revision);
    await assert.rejects(() => sdk.mcp.grantRemote(f.sessionId, server.id, preview.digest, sdk.settings.get()!.revision, true, true), { code: "remote_mcp_scope" });
    const fresh = (await sdk.mcp.remotePreview(f.sessionId, server.id)).preview;
    await sdk.mcp.grantRemote(f.sessionId, server.id, fresh.digest, fresh.settingsRevision, true, true);
    await f.controller.dispatch(envelope({ type: "policy.set", allowedEnvs: ["Local"] }));
    await f.ssh.close();
    await sdk.refresh();
    await sdk.mcp.revokeRemote(f.sessionId, server.id, sdk.settings.get()!.revision, true);
    assert.deepEqual(sdk.settings.get()!.values.remote!.mcpGrants, []);
    assert.equal(f.requests.length, 0);
  } finally { sdk.disconnect(); await f.close(); }
});

test("concurrent Remote grant writes cannot overwrite another client's observed settings revision", native, async () => {
  const f = await remoteFixture(), sdk = await new MoguriSdk(f.service.connection).ready();
  try {
    await f.probe(); await sdk.sessions.env(f.sessionId, "Remote");
    const preview = (await sdk.mcp.remotePreview(f.sessionId, "builtin")).preview;
    const result = await Promise.allSettled([1, 2].map(() => sdk.mcp.grantRemote(f.sessionId, "builtin", preview.digest, preview.settingsRevision, false, true)));
    assert.equal(result.filter((item) => item.status === "fulfilled").length, 1);
    assert.equal(result.filter((item) => item.status === "rejected").length, 1);
    await sdk.refresh(); assert.equal(sdk.settings.get()!.values.remote!.mcpGrants?.length, 1);
    assert.equal(f.requests.length, 0);
  } finally { sdk.disconnect(); await f.close(); }
});
