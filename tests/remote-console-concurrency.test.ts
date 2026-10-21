import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { startService } from "../apps/service/src/server.ts";
import { RemoteConsoles } from "../apps/service/src/remote-terminals.ts";
import { remoteFixture } from "./fixtures/remote-service.ts";
import { profileFixture } from "./fixtures/profiles.ts";
import { createSshTarget } from "./fixtures/ssh-target.ts";
import { waitFor } from "./fixture.ts";

const native = { skip: process.platform !== "darwin", timeout: 30_000 };
const program = { executable: "/bin/sh", args: ["-c", "printf 'GENERATED_CONCURRENT_REMOTE_CONSOLE\\n'; exec cat"] };

test("concurrent Remote admissions create one profile/peer broker and preserve exact per-session capacity", native, async () => {
  const f = await remoteFixture({ exposeModels: false, platform: { terminal: program } }), sdk = await new MoguriSdk(f.service.connection).ready();
  try {
    await f.probe(); await sdk.sessions.env(f.sessionId, "Remote");
    const opened = await Promise.all([0, 1, 2, 3].map(() => sdk.terminal.open(f.sessionId)));
    const terminals = await Promise.all(opened.map((result) => sdk.terminal.read(result.id!)));
    assert.equal(new Set(terminals.map((result) => result.terminal.pid)).size, 4);
    assert.equal(new Set(terminals.map((result) => result.terminal.ownerId)).size, 1);
    assert.equal(f.controller.snapshot().terminalOwners.length, 1);
    await assert.rejects(() => sdk.terminal.open(f.sessionId), { code: "terminal_limit" });
    assert.equal(f.controller.snapshot().terminals.length, 4); assert.equal(f.requests.length, 0);
  } finally { sdk.disconnect(); await f.close(); }
});

test("shutdown aborts a pending Remote secret write before broker/PTY start and removes only its exact prepared resources", native, async () => {
  const values = new Map<string, string>(); let entered = false, release = () => {};
  const barrier = new Promise<void>((resolve) => { release = resolve; });
  const f = await remoteFixture({ exposeModels: false, platform: { terminal: { ...program, vault: {
    read: async (id) => values.get(id) ?? null, remove: async (id) => { values.delete(id); },
    write: async (id, value, signal) => { entered = true; values.set(id, value); await barrier; signal?.throwIfAborted(); },
  } } } }), sdk = await new MoguriSdk(f.service.connection).ready();
  try {
    await f.probe(); await sdk.sessions.env(f.sessionId, "Remote");
    const pending = sdk.terminal.open(f.sessionId);
    const rejected = assert.rejects(() => pending, /abort|failed|closing|unconfirmed/i);
    await waitFor(() => entered);
    const closing = f.service.close(); release(); await closing; await rejected;
    assert.equal(f.controller.snapshot().terminals.length, 0);
    const owner = f.controller.snapshot().terminalOwners[0]!;
    assert.equal(owner.status, "stopped"); assert.equal(owner.cleanup, "removed"); assert.equal(owner.pid, null); assert.equal(values.size, 0);
    assert.equal(f.requests.length, 0);
  } finally { release(); sdk.disconnect(); await f.close(); }
});

test("an actual scope change while Remote endpoint preparation is held cannot dispatch its key/broker/PTY into the old root", native, async (t) => {
  let held = false, release = () => {};
  const barrier = new Promise<void>((resolve) => { release = resolve; });
  const f = await remoteFixture({ exposeModels: false, platform: { terminal: program } }), sdk = await new MoguriSdk(f.service.connection).ready();
  try {
    await f.probe(); await sdk.sessions.env(f.sessionId, "Remote");
    const prepare = RemoteConsoles.prototype.prepare;
    t.mock.method(RemoteConsoles.prototype, "prepare", async function (this: RemoteConsoles, ...args: Parameters<typeof prepare>) {
      const owner = await prepare.call(this, ...args); held = true; await barrier; return owner;
    });
    const pending = sdk.terminal.open(f.sessionId), rejected = assert.rejects(() => pending, { code: "terminal_scope_changed" });
    await waitFor(() => held);
    const path = join(f.directory, "generated-new-admission-root"); await mkdir(path);
    const configuration = (await sdk.projects.configuration(f.session().projectId!)).configuration;
    await sdk.projects.configure(configuration.projectId, { ...configuration.values, remotePath: path }, configuration.revision);
    release(); await rejected;
    assert.equal(f.controller.snapshot().terminals.length, 0);
    const owner = f.controller.snapshot().terminalOwners[0]!;
    assert.equal(owner.status, "stopped"); assert.equal(owner.pid, null); assert.equal(owner.cleanup, "removed"); assert.equal(f.requests.length, 0);
  } finally { release(); sdk.disconnect(); await f.close(); }
});

test("profile-isolated Remote owners on target aliases reattach original PTYs and ordinary stop covers a profile no client reopened", native, async () => {
  const keys = new Map<string, Map<string, string>>();
  const f = await profileFixture((id) => {
    let values = keys.get(id); if (!values) { values = new Map(); keys.set(id, values); }
    const scoped = values, vault = { read: async (key: string) => scoped.get(key) ?? null, write: async (key: string, value: string) => { scoped.set(key, value); }, remove: async (key: string) => { scoped.delete(key); } };
    return { terminal: { ...program, vault }, remote: { vault, modelsVault: vault } };
  });
  const root = await realpath(f.directory), sshRoot = join(root, "ssh"), workspace = join(root, "remote"), localA = join(root, "local-a"), localB = join(root, "local-b");
  for (const path of [sshRoot, workspace, localA, localB]) await mkdir(path, { mode: 0o700 });
  const ssh = await createSshTarget(sshRoot);
  let restarted: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    const beta = await f.create("Generated Remote console Beta");
    const consoles: Array<{ client: typeof f.sdk; id: string; ownerId: string; pid: number; profile: string }> = [];
    for (const [index, client] of [f.sdk, beta.client].entries()) {
      const settings = structuredClone(client.settings.get()!.values);
      settings.remote = { ...ssh.target, id: `generated-console-alias-${index}`, name: `Generated console alias ${index}`, stateDir: join(sshRoot, `runs-${index}`), allowCopilot: false };
      await client.settings.update(settings, client.settings.get()!.revision);
      const project = await client.command({ type: "project.add", path: index ? localB : localA }), configuration = (await client.projects.configuration(project.id!)).configuration;
      await client.projects.configure(project.id!, { ...configuration.values, remotePath: workspace }, configuration.revision);
      await client.remote.probe();
      const session = await client.sessions.create(project.id!, `Generated scoped Remote console ${index}`, { env: "Remote", modelId: null });
      const opened = await client.terminal.open(session.id!), read = await client.terminal.read(opened.id!);
      assert.ok(read.terminal.pid); consoles.push({ client, id: opened.id!, ownerId: read.terminal.ownerId!, pid: read.terminal.pid, profile: client.profileId });
    }
    const first = consoles[0]!, second = consoles[1]!;
    assert.notEqual(first.ownerId, second.ownerId); assert.notEqual(first.pid, second.pid);
    await assert.rejects(() => second.client.terminal.read(first.id), { code: "terminal_missing" });
    await assert.rejects(() => first.client.terminal.reconcileOwner(second.ownerId), { code: "terminal_owner_missing" });
    for (const client of f.clients) client.disconnect(); await f.service.close({ preserveTerminals: true });
    restarted = await startService(f.options);
    const defaultClient = await new MoguriSdk(restarted.connection).ready();
    try { assert.equal((await defaultClient.terminal.read(first.id)).terminal.pid, first.pid); assert.equal(defaultClient.getState().snapshot!.terminalOwners.length, 1); }
    finally { defaultClient.disconnect(); }
    await restarted.close();
    assert.equal(keys.get(first.profile)?.size, 0); assert.equal(keys.get(second.profile)?.size, 0);
    assert.equal(f.providers.reduce((sum, provider) => sum + provider.requests.length, 0), 0);
  } finally { await restarted?.close(); await f.service.close(); await ssh.close(); await f.close(); }
});
