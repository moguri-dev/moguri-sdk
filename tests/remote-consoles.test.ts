import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { lstat, mkdir, readFile, realpath, unlink, writeFile } from "node:fs/promises";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { startService } from "../apps/service/src/server.ts";
import { remoteFixture } from "./fixtures/remote-service.ts";

const native = { skip: process.platform !== "darwin", timeout: 30_000 };
const program = { executable: "/bin/sh", args: ["-c", "printf 'GENERATED_REMOTE_SDK_READY\\n'; pwd; exec cat"] };
async function configure(sdk: MoguriSdk, f: Awaited<ReturnType<typeof remoteFixture>>) { await f.probe(); await sdk.sessions.env(f.sessionId, "Remote"); }
async function output(sdk: MoguriSdk, id: string, marker: string) {
  for (let index = 0; index < 150; index++) {
    const result = await sdk.terminal.read(id); if (result.data.includes(marker)) return result;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  throw new Error("Actual public Remote console did not produce the generated output.");
}

test("public SDK opens and controls actual Remote user consoles without a model or Local broker and keeps Local ownership separate", native, async () => {
  const f = await remoteFixture({ exposeModels: false, platform: { terminal: program } }), sdk = await new MoguriSdk(f.service.connection).ready();
  try {
    await configure(sdk, f); assert.equal(f.session().controls.modelId, null);
    const opened = await sdk.terminal.open(f.sessionId), first = await output(sdk, opened.id!, "GENERATED_REMOTE_SDK_READY");
    assert.equal(first.terminal.env, "Remote"); assert.equal(first.terminal.binding?.env, "Remote"); assert.equal(first.terminal.binding?.root, f.workspace);
    const owner = sdk.getState().snapshot!.terminalOwners.find((owner) => owner.id === first.terminal.ownerId)!;
    assert.equal(owner.env, "Remote"); assert.ok(owner.remote); assert.equal(owner.profileId, "default");
    await sdk.terminal.input(opened.id!, "GENERATED_PUBLIC_REMOTE_INPUT\n");
    await output(sdk, opened.id!, "GENERATED_PUBLIC_REMOTE_INPUT");
    await sdk.terminal.resize(opened.id!, 96, 30);
    assert.equal((await sdk.terminal.read(opened.id!)).terminal.cols, 96);
    const second = await sdk.terminal.open(f.sessionId), remoteSecond = await output(sdk, second.id!, "GENERATED_REMOTE_SDK_READY");
    assert.equal(remoteSecond.terminal.ownerId, owner.id); assert.notEqual(remoteSecond.terminal.pid, first.terminal.pid);
    const local = await sdk.sessions.create(f.session().projectId!);
    const localConsole = await sdk.terminal.open(local.id!), localRead = await output(sdk, localConsole.id!, "GENERATED_REMOTE_SDK_READY");
    assert.equal(localRead.terminal.env, "Local"); assert.equal(localRead.terminal.binding?.root, await realpath(f.project));
    assert.notEqual(localRead.terminal.ownerId, owner.id); assert.equal(sdk.getState().snapshot!.terminalOwners.length, 2);
    assert.equal(JSON.stringify(f.controller.events(0)).includes("GENERATED_PUBLIC_REMOTE_INPUT"), false);
    assert.equal(f.requests.length, 0);
    await sdk.terminal.close(opened.id!);
    assert.equal((await sdk.terminal.read(opened.id!)).terminal.status, "closed");
    await sdk.terminal.input(second.id!, "GENERATED_OTHER_REMOTE_CONSOLE_ALIVE\n");
    await output(sdk, second.id!, "GENERATED_OTHER_REMOTE_CONSOLE_ALIVE");
  } finally { sdk.disconnect(); await f.close(); }
});

test("an explicit service restart reattaches the same public Remote owner/PTY and accepts only original-root input without another model/probe", native, async () => {
  const f = await remoteFixture({ exposeModels: false, platform: { terminal: program } }), sdk = await new MoguriSdk(f.service.connection).ready();
  let restarted: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    await configure(sdk, f);
    const opened = await sdk.terminal.open(f.sessionId), before = await output(sdk, opened.id!, "GENERATED_REMOTE_SDK_READY");
    const owner = sdk.getState().snapshot!.terminalOwners.find((owner) => owner.id === before.terminal.ownerId)!;
    await sdk.terminal.input(opened.id!, "GENERATED_REMOTE_BEFORE_SERVICE_RESTART\n");
    await output(sdk, opened.id!, "GENERATED_REMOTE_BEFORE_SERVICE_RESTART");
    sdk.disconnect(); await f.service.close({ preserveTerminals: true });
    restarted = await startService({ stateDir: join(f.directory, "state"), provider: f.provider, retentionKey: f.retentionKey,
      platform: { terminal: { vault: f.terminalVault, executable: "/bin/sh", args: ["-c", "printf 'GENERATED_REMOTE_REPLACEMENT_FORBIDDEN\\n'; exec cat"] } } });
    const current = await new MoguriSdk(restarted.connection).ready();
    try {
      assert.equal((await current.remote.status()).remote.ready, false);
      const after = await current.terminal.read(opened.id!);
      assert.equal(after.terminal.pid, before.terminal.pid); assert.equal(after.terminal.ownerId, owner.id);
      assert.equal(current.getState().snapshot!.terminalOwners.find((entry) => entry.id === owner.id)?.pid, owner.pid);
      assert.notEqual(after.terminal.attachmentId, before.terminal.attachmentId);
      assert.match(after.data, /GENERATED_REMOTE_BEFORE_SERVICE_RESTART/); assert.doesNotMatch(after.data, /GENERATED_REMOTE_REPLACEMENT_FORBIDDEN/);
      await current.terminal.input(opened.id!, "GENERATED_REMOTE_AFTER_SERVICE_RESTART\n");
      await output(current, opened.id!, "GENERATED_REMOTE_AFTER_SERVICE_RESTART");
      const changed = join(f.directory, "generated-new-remote-root"); await mkdir(changed);
      const configuration = (await current.projects.configuration(f.session().projectId!)).configuration;
      await current.projects.configure(configuration.projectId, { ...configuration.values, remotePath: changed }, configuration.revision);
      await assert.rejects(() => current.terminal.input(opened.id!, "GENERATED_FORBIDDEN_NEW_MAPPING\n"), { code: "terminal_root_changed" });
      assert.equal((await current.terminal.read(opened.id!)).data.includes("GENERATED_FORBIDDEN_NEW_MAPPING"), false);
      await current.terminal.close(opened.id!);
      assert.equal((await current.terminal.read(opened.id!)).terminal.status, "closed");
      assert.equal(f.requests.length, 0);
    } finally { current.disconnect(); }
  } finally { sdk.disconnect(); await restarted?.close(); await f.close(); }
});

test("Remote policy revocation blocks new console input but not retained output or exact known-group close", native, async () => {
  const f = await remoteFixture({ exposeModels: false, platform: { terminal: program } }), sdk = await new MoguriSdk(f.service.connection).ready();
  try {
    await configure(sdk, f);
    const opened = await sdk.terminal.open(f.sessionId); await output(sdk, opened.id!, "GENERATED_REMOTE_SDK_READY");
    await sdk.command({ type: "policy.set", allowedEnvs: ["Local"] });
    await assert.rejects(() => sdk.terminal.input(opened.id!, "GENERATED_FORBIDDEN_REMOTE_POLICY_INPUT\n"), { code: "terminal_root_changed" });
    const read = await sdk.terminal.read(opened.id!);
    assert.match(read.data, /GENERATED_REMOTE_SDK_READY/); assert.equal(read.data.includes("GENERATED_FORBIDDEN_REMOTE_POLICY_INPUT"), false);
    await sdk.terminal.close(opened.id!);
    assert.equal((await sdk.terminal.read(opened.id!)).terminal.status, "closed"); assert.equal(f.requests.length, 0);
  } finally { sdk.disconnect(); await f.close(); }
});

test("a lost original Remote console command receipt cannot start another broker or PTY", native, async (t) => {
  const f = await remoteFixture({ exposeModels: false, platform: { terminal: program } }), sdk = await new MoguriSdk(f.service.connection).ready();
  try {
    await configure(sdk, f);
    const id = randomUUID(), command = { type: "terminal.open" as const, sessionId: f.sessionId, cols: 80, rows: 24 }, commit = f.service.store.commit.bind(f.service.store);
    const failure = t.mock.method(f.service.store, "commit", (...args: Parameters<typeof commit>) => {
      if (args[1]?.id === id) throw new Error("Generated lost Remote console command receipt.");
      return commit(...args);
    });
    await assert.rejects(() => sdk.command(command, id), /receipt|failed|internal/i); failure.mock.restore();
    const retained = f.controller.snapshot().terminals.find((terminal) => terminal.commandId === id)!;
    assert.equal(retained.env, "Remote"); assert.equal(retained.status, "running");
    const before = await output(sdk, retained.id, "GENERATED_REMOTE_SDK_READY");
    await assert.rejects(() => sdk.command(command, id), { code: "terminal_intent_exists" });
    assert.equal(f.controller.snapshot().terminalOwners.length, 1); assert.equal(f.controller.snapshot().terminals.length, 1);
    const after = await sdk.terminal.read(retained.id); assert.equal(after.terminal.pid, before.terminal.pid);
    assert.equal(after.data.split("GENERATED_REMOTE_SDK_READY").length - 1, 1); assert.equal(f.requests.length, 0);
  } finally { sdk.disconnect(); await f.close(); }
});

test("failed Remote runtime cleanup preserves unrelated files and the writer lock, then explicit stop retry completes after other runtimes closed", native, async () => {
  const f = await remoteFixture({ exposeModels: false, platform: { terminal: program } }), sdk = await new MoguriSdk(f.service.connection).ready();
  let sentinel: string | undefined;
  try {
    await configure(sdk, f);
    const opened = await sdk.terminal.open(f.sessionId); await output(sdk, opened.id!, "GENERATED_REMOTE_SDK_READY");
    const owner = sdk.getState().snapshot!.terminalOwners[0]!;
    assert.ok(owner.directory); sentinel = join(owner.directory, "generated-unrelated-remote-runtime-file");
    await writeFile(sentinel, "Generated unrelated Remote bytes must survive.\n");
    await assert.rejects(() => f.service.close(), { code: "terminal_remote_cleanup" });
    assert.equal(await readFile(sentinel, "utf8"), "Generated unrelated Remote bytes must survive.\n");
    await lstat(join(f.directory, "state/service.lock"));
    assert.equal(f.controller.snapshot().terminalOwners[0]?.cleanup, "pending");
    await unlink(sentinel); sentinel = undefined;
    await f.service.close();
    assert.equal(f.controller.snapshot().terminalOwners[0]?.cleanup, "removed");
    await assert.rejects(() => lstat(owner.directory!), { code: "ENOENT" });
    assert.equal(f.requests.length, 0);
  } finally { if (sentinel) await unlink(sentinel); sdk.disconnect(); await f.close(); }
});

test("failed Remote running-state retention is explicitly reconciled to the original PTY rather than launched again", native, async (t) => {
  const f = await remoteFixture({ exposeModels: false, platform: { terminal: program } }), sdk = await new MoguriSdk(f.service.connection).ready();
  try {
    await configure(sdk, f);
    const commit = f.service.store.commit.bind(f.service.store); let failed = false;
    const failure = t.mock.method(f.service.store, "commit", (...args: Parameters<typeof commit>) => {
      if (!failed && args[0].some((event) => event.event_type === "terminal.changed" && event.payload.terminal.env === "Remote" && event.payload.terminal.status === "running")) {
        failed = true; throw new Error("Generated Remote running-state retention failure.");
      }
      return commit(...args);
    });
    await assert.rejects(() => sdk.terminal.open(f.sessionId), /unconfirmed|failed|retention|internal/i); failure.mock.restore();
    const intent = f.controller.snapshot().terminals[0]!;
    assert.equal(intent.status, "unconfirmed"); assert.equal(intent.pid, null);
    await sdk.terminal.reconcile(intent.id);
    const actual = await output(sdk, intent.id, "GENERATED_REMOTE_SDK_READY");
    assert.equal(actual.terminal.status, "running"); assert.ok(actual.terminal.pid);
    assert.equal(actual.data.split("GENERATED_REMOTE_SDK_READY").length - 1, 1);
    assert.equal(f.controller.snapshot().terminals.length, 1); assert.equal(f.controller.snapshot().terminalOwners.length, 1);
    assert.equal(f.requests.length, 0);
  } finally { sdk.disconnect(); await f.close(); }
});

test("a Remote broker PID-publication failure closes its exact authenticated empty owner before reporting no PTY", native, async (t) => {
  const f = await remoteFixture({ exposeModels: false, platform: { terminal: program } }), sdk = await new MoguriSdk(f.service.connection).ready();
  try {
    await configure(sdk, f);
    const commit = f.service.store.commit.bind(f.service.store); let failed = false;
    const failure = t.mock.method(f.service.store, "commit", (...args: Parameters<typeof commit>) => {
      if (!failed && args[0].some((event) => event.event_type === "terminal.owner_changed" && event.payload.owner.env === "Remote" && event.payload.owner.status === "running")) {
        failed = true; throw new Error("Generated Remote owner PID-publication failure.");
      }
      return commit(...args);
    });
    await assert.rejects(() => sdk.terminal.open(f.sessionId), /failed|unconfirmed|internal/i); failure.mock.restore();
    const owner = f.controller.snapshot().terminalOwners[0]!;
    assert.equal(owner.status, "stopped"); assert.equal(owner.cleanup, "removed");
    assert.equal(f.controller.snapshot().terminals.length, 0);
    assert.equal(await f.terminalVault.read(`terminal-owner-${owner.id}`), null);
    assert.equal(f.requests.length, 0);
  } finally { sdk.disconnect(); await f.close(); }
});
