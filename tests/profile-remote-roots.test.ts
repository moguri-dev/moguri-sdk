import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { envelope } from "../apps/service/src/controller.ts";
import { remoteRootLease } from "../apps/service/src/remote.ts";
import { startService } from "../apps/service/src/server.ts";
import { profileFixture } from "./fixtures/profiles.ts";
import { createSshTarget } from "./fixtures/ssh-target.ts";
import { waitFor } from "./fixture.ts";

async function sharedRemoteFixture(holdAfterTool = false) {
  const secrets = new Map<string, Map<string, string>>();
  const fixture = await profileFixture((profileId) => {
    if (!secrets.has(profileId)) secrets.set(profileId, new Map());
    const values = secrets.get(profileId)!;
    const vault = { read: async (id: string) => values.get(id) ?? null, write: async (id: string, value: string) => { values.set(id, value); }, remove: async (id: string) => { values.delete(id); } };
    return { remote: { vault, modelsVault: vault } };
  }, undefined, holdAfterTool);
  let service = fixture.service, ssh: Awaited<ReturnType<typeof createSshTarget>> | undefined, closed = false;
  const sessions: Array<{ client: MoguriSdk; id: string }> = [];
  const close = async () => {
    if (closed) return;
    closed = true;
    try {
      for (const { client, id } of sessions) {
        const control = await service.profiles.control(client.profileId);
        await control.dispatch(envelope({ type: "session.stop", sessionId: id }, client.profileId));
        await waitFor(() => !control.snapshot().sessions.find((session) => session.id === id)?.turnId);
        await waitFor(() => control.snapshot().executions.every((execution) => !control.remote.owns(execution.id)));
      }
    } finally { try { await service.close(); } finally { try { await ssh?.close(); } finally { await fixture.close(); } } }
  };
  try {
    const base = await realpath(fixture.directory), targetRoot = join(base, "generated-shared-ssh"), workspace = join(base, "generated-shared-remote-workspace");
    await mkdir(targetRoot); await mkdir(workspace); await writeFile(join(workspace, "fixture.txt"), "Generated shared remote bytes.\n");
    ssh = await createSshTarget(targetRoot);
    const beta = await fixture.create("Generated shared SSH Beta");
    for (const [index, client] of [fixture.sdk, beta.client].entries()) {
      const local = join(base, `generated-local-mapping-${index}`); await mkdir(local);
      const settings = structuredClone(client.settings.get()!.values); settings.remote = { ...ssh.target, id: `generated-alias-${index}`, name: `Generated peer alias ${index}` };
      await client.settings.update(settings, client.settings.get()!.revision); await client.remote.probe();
      const project = await client.command({ type: "project.add", path: local }), configuration = (await client.projects.configuration(project.id!)).configuration;
      await client.projects.configure(project.id!, { ...configuration.values, remotePath: workspace }, configuration.revision);
      const session = await client.sessions.create(project.id!, `Generated shared remote writer ${index}`, { env: "Remote", modelId: fixture.providers[index]!.modelId });
      sessions.push({ client, id: session.id! });
    }
    return { ...fixture, sessions, workspace, ssh, close, useService: (value: typeof service) => { service = value; } };
  } catch (error) {
    try { await close(); } catch (cleanup) { throw new AggregateError([error, cleanup], "Generated SSH fixture setup and cleanup failed."); }
    throw error;
  }
}

test("SSH lease identity ignores configured aliases and retains only the pinned peer/root boundary", () => {
  const peer = { hostKey: "ssh-ed25519 GENERATED_PUBLIC_FIXTURE" };
  assert.equal(remoteRootLease(peer, "/generated/root"), remoteRootLease({ ...peer }, "/generated/root"));
  assert.notEqual(remoteRootLease(peer, "/generated/root"), remoteRootLease(peer, "/generated/other"));
  assert.notEqual(remoteRootLease(peer, "/generated/root"), remoteRootLease({ hostKey: "ssh-ed25519 GENERATED_OTHER_PUBLIC" }, "/generated/root"));
  assert.equal(remoteRootLease(peer, null), null);
});

test("two profiles with distinct local mappings serialize actual Remote writers against the same pinned SSH root", { skip: process.platform !== "darwin", timeout: 30_000 }, async () => {
  const fixture = await sharedRemoteFixture(), first = fixture.sessions[0]!, second = fixture.sessions[1]!;
  try {
    await fixture.send(first.client, first.id, "generated slow shared SSH writer");
    await waitFor(() => fixture.providers[0]!.requests.length === 1);
    await fixture.send(second.client, second.id, "Generated second shared SSH writer.");
    assert.equal(fixture.session(second.client, second.id).status, "queued");
    assert.equal(fixture.providers[1]!.requests.length, 0);
    await first.client.command({ type: "session.stop", sessionId: first.id });
    await waitFor(() => fixture.session(second.client, second.id).status === "completed");
    assert.equal(fixture.providers[1]!.requests.length, 1);
  } finally { await fixture.close(); }
});

test("same-profile duplicate SSH workspace bindings remain explicitly rejected", { skip: process.platform !== "darwin", timeout: 30_000 }, async () => {
  const fixture = await sharedRemoteFixture(), first = fixture.sessions[1]!;
  try {
    const path = join(await realpath(fixture.directory), "generated-additional-local"); await mkdir(path);
    const project = await first.client.command({ type: "project.add", path }), configuration = (await first.client.projects.configuration(project.id!)).configuration;
    await assert.rejects(() => first.client.projects.configure(project.id!, { ...configuration.values, remotePath: fixture.workspace }, configuration.revision), { code: "remote_workspace_shared" });
    assert.equal(fixture.providers[1]!.requests.length, 0);
  } finally { await fixture.close(); }
});

test("an unloaded profile's failed SSH-root quarantine survives restart and releases only after explicit inspection/resume", { skip: process.platform !== "darwin", timeout: 30_000 }, async () => {
  const fixture = await sharedRemoteFixture(), first = fixture.sessions[1]!, other = fixture.sessions[0]!;
  let current: MoguriSdk | undefined, owner: MoguriSdk | undefined;
  try {
    await fixture.send(first.client, first.id, "generated provider failure");
    await waitFor(() => fixture.session(first.client, first.id).status === "failed");
    const control = await fixture.service.profiles.control(first.client.profileId);
    await waitFor(() => control.snapshot().executions.every((execution) => !control.remote.owns(execution.id)));
    await fixture.send(other.client, other.id, "Generated blocked by other SSH profile.");
    assert.equal(fixture.session(other.client, other.id).status, "queued"); assert.equal(fixture.providers[0]!.requests.length, 0);
    for (const client of fixture.clients) client.disconnect();
    await fixture.service.close();
    const restarted = await startService(fixture.options); fixture.useService(restarted);
    current = await new MoguriSdk(restarted.connection).ready();
    await current.remote.probe();
    await current.command({ type: "session.resume", sessionId: other.id });
    assert.equal(current.getState().snapshot!.sessions.find((session) => session.id === other.id)?.status, "queued");
    assert.equal(fixture.providers[0]!.requests.length, 0);
    owner = await current.profiles.open(first.client.profileId);
    await owner.remote.probe();
    assert.equal(fixture.providers[0]!.requests.length, 0);
    await owner.command({ type: "session.resume", sessionId: first.id });
    await waitFor(() => current!.getState().snapshot!.sessions.find((session) => session.id === other.id)?.status === "completed");
    assert.equal(fixture.providers[0]!.requests.length, 1);
  } finally { current?.disconnect(); owner?.disconnect(); await fixture.close(); }
});

test("distinct SSH roots remain independent rather than locking the whole peer", { skip: process.platform !== "darwin", timeout: 30_000 }, async () => {
  const fixture = await sharedRemoteFixture(), first = fixture.sessions[0]!, second = fixture.sessions[1]!;
  try {
    const different = join(await realpath(fixture.directory), "generated-independent-remote-root"); await mkdir(different);
    const projectId = fixture.session(second.client, second.id).projectId!;
    const configuration = (await second.client.projects.configuration(projectId)).configuration;
    await second.client.projects.configure(projectId, { ...configuration.values, remotePath: different }, configuration.revision);
    await fixture.send(first.client, first.id, "generated slow first independent remote writer");
    await waitFor(() => fixture.providers[0]!.requests.length === 1);
    await fixture.send(second.client, second.id, "generated slow second independent remote writer");
    await waitFor(() => fixture.providers[1]!.requests.length === 1);
    assert.ok(fixture.session(first.client, first.id).turnId && fixture.session(second.client, second.id).turnId);
  } finally { await fixture.close(); }
});

test("a pending read-only restriction does not release the active writer before the acknowledged mode boundary", { skip: process.platform !== "darwin", timeout: 30_000 }, async () => {
  const fixture = await sharedRemoteFixture(), first = fixture.sessions[0]!, second = fixture.sessions[1]!;
  try {
    await fixture.send(first.client, first.id, "generated slow remote writer before restriction");
    await waitFor(() => fixture.providers[0]!.requests.length === 1);
    await first.client.sessions.mode(first.id, "read-only");
    assert.equal(fixture.session(first.client, first.id).pendingMode, "read-only");
    const control = await fixture.service.profiles.control(first.client.profileId);
    assert.equal(control.ownedWriteRoots().length, 1);
    await fixture.send(second.client, second.id, "Generated wait for actual writer boundary.");
    assert.equal(fixture.session(second.client, second.id).status, "queued");
    assert.equal(fixture.providers[1]!.requests.length, 0);
  } finally { await fixture.close(); }
});

test("an acknowledged read-only boundary wakes the other profile while the original read-only turn continues", { skip: process.platform !== "darwin", timeout: 30_000 }, async () => {
  const fixture = await sharedRemoteFixture(true), first = fixture.sessions[0]!, second = fixture.sessions[1]!;
  try {
    await fixture.send(first.client, first.id, "generated tool before acknowledged read-only boundary");
    await waitFor(() => fixture.session(first.client, first.id).pendingApproval);
    await fixture.send(second.client, second.id, "Generated write after actual mode acknowledgement.");
    assert.equal(fixture.session(second.client, second.id).status, "queued");
    await first.client.sessions.mode(first.id, "read-only");
    await waitFor(() => fixture.session(first.client, first.id).mode === "read-only");
    await waitFor(() => fixture.providers[0]!.requests.length === 2);
    await waitFor(() => fixture.session(second.client, second.id).status === "completed");
    assert.ok(fixture.session(first.client, first.id).turnId);
    assert.equal(fixture.providers[1]!.requests.length, 1);
    const control = await fixture.service.profiles.control(first.client.profileId);
    assert.equal(control.ownedWriteRoots().length, 0);
  } finally { await fixture.close(); }
});
