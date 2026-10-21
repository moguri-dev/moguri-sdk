import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { stopMoguriService } from "../packages/sdk/src/node.ts";
import { startService } from "../apps/service/src/server.ts";
import { setupFixture, waitFor, fixtureProvider } from "./fixture.ts";
import { launchRuntimeChild } from "./fixtures/runtime-process.ts";
import { GeneratedFileVault } from "./fixtures/generated-vault.ts";
import { TerminalChannel } from "../apps/service/src/terminal-channel.ts";
import { assertTerminalEndpoint, preparedTerminalOwner } from "../apps/service/src/terminal-identity.ts";

const native = { skip: process.platform !== "darwin", timeout: 30_000 };
async function output(sdk: MoguriSdk, id: string, marker: string) {
  for (let index = 0; index < 200; index++) {
    const result = await sdk.terminal.read(id);
    if (result.data.includes(marker)) return result;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Actual owned terminal did not produce the generated marker.");
}
test("an explicitly preserved service restart reattaches the same user PTY and volatile output with no input or process replay", native, async () => {
  const fixture = await setupFixture({ platform: { terminal: { executable: "/bin/sh", args: ["-c", "printf 'GENERATED_TERMINAL_READY\\n'; exec cat"] } } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  let restarted: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    const opened = await sdk.terminal.open(fixture.sessionId);
    await output(sdk, opened.id!, "GENERATED_TERMINAL_READY");
    await sdk.terminal.input(opened.id!, "GENERATED_BEFORE_RESTART\n");
    const before = await output(sdk, opened.id!, "GENERATED_BEFORE_RESTART"), owner = fixture.service.controller.snapshot().terminalOwners[0]!;
    assert.equal(before.terminal.env, "Local"); assert.ok(before.terminal.binding); assert.equal(owner.status, "running");
    assert.equal(JSON.stringify(fixture.service.controller.events(0)).includes("GENERATED_BEFORE_RESTART"), false);
    sdk.disconnect(); await fixture.service.close({ preserveTerminals: true });
    restarted = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey,
      platform: { terminal: { vault: fixture.terminalVault, executable: "/bin/sh", args: ["-c", "printf 'GENERATED_REPLACEMENT_FORBIDDEN\\n'; exec cat"] } } });
    const peer = await new MoguriSdk(restarted.connection).ready();
    try {
      const after = await peer.terminal.read(opened.id!);
      assert.equal(after.terminal.pid, before.terminal.pid); assert.equal(after.terminal.ownerId, owner.id);
      assert.equal(restarted.controller.snapshot().terminalOwners[0]?.pid, owner.pid);
      assert.equal(after.terminal.status, "running"); assert.notEqual(after.terminal.attachmentId, before.terminal.attachmentId);
      assert.match(after.data, /GENERATED_BEFORE_RESTART/); assert.equal(after.data.includes("GENERATED_REPLACEMENT_FORBIDDEN"), false);
      await peer.terminal.input(opened.id!, "GENERATED_AFTER_RESTART\n");
      await output(peer, opened.id!, "GENERATED_AFTER_RESTART");
      await peer.terminal.close(opened.id!);
      assert.equal((await peer.terminal.read(opened.id!)).terminal.status, "closed");
      assert.equal(fixture.requests.length, 0);
    } finally { peer.disconnect(); }
  } finally { sdk.disconnect(); await restarted?.close(); await fixture.close(); }
});

test("ordinary disposal stops owned user terminals while a stale root/policy cannot receive new input", native, async () => {
  const fixture = await setupFixture({ platform: { terminal: { executable: "/bin/sh", args: ["-c", "printf 'GENERATED_STOP_READY\\n'; exec cat"] } } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const opened = await sdk.terminal.open(fixture.sessionId);
    await output(sdk, opened.id!, "GENERATED_STOP_READY");
    await sdk.command({ type: "policy.set", allowedEnvs: ["Remote"] });
    await assert.rejects(() => sdk.terminal.input(opened.id!, "GENERATED_FORBIDDEN_POLICY_INPUT\n"), /policy|environment|Local/i);
    await sdk.terminal.close(opened.id!);
    assert.equal((await sdk.terminal.read(opened.id!)).terminal.status, "closed");
    await waitFor(() => fixture.service.controller.snapshot().terminals.every((terminal) => terminal.status === "closed"));
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("one authenticated profile owner holds independent PTYs and a lost command receipt cannot launch the original intent twice", native, async (t) => {
  const fixture = await setupFixture({ platform: { terminal: { executable: "/bin/sh", args: ["-c", "printf 'GENERATED_MULTI_READY\\n'; exec cat"] } } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const id = randomUUID(), command = { type: "terminal.open" as const, sessionId: fixture.sessionId, cols: 80, rows: 24 };
    const commit = fixture.service.store.commit.bind(fixture.service.store);
    let failed = false;
    const mock = t.mock.method(fixture.service.store, "commit", (...args: Parameters<typeof commit>) => {
      if (!failed && args[1]?.id === id) { failed = true; throw new Error("Generated lost terminal command receipt"); }
      return commit(...args);
    });
    await assert.rejects(() => sdk.command(command, id), /receipt|failed|internal/i); mock.mock.restore();
    const retained = fixture.service.controller.snapshot().terminals.find((terminal) => terminal.commandId === id)!;
    assert.ok(retained); assert.equal(retained.status, "running"); await output(sdk, retained.id, "GENERATED_MULTI_READY");
    await assert.rejects(() => sdk.command(command, id), { code: "terminal_intent_exists" });
    const second = await sdk.terminal.open(fixture.sessionId);
    const state = await output(sdk, second.id!, "GENERATED_MULTI_READY");
    assert.equal(state.terminal.ownerId, retained.ownerId); assert.notEqual(state.terminal.pid, retained.pid);
    assert.equal(fixture.service.controller.snapshot().terminalOwners.length, 1);
    await sdk.terminal.close(retained.id); await sdk.terminal.input(second.id!, "GENERATED_SECOND_STILL_ALIVE\n");
    await output(sdk, second.id!, "GENERATED_SECOND_STILL_ALIVE"); await sdk.terminal.close(second.id!);
    assert.equal(fixture.service.controller.snapshot().terminals.length, 2);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("the authenticated lifecycle endpoint preserves only an explicit restart and ordinary stop remains an owned shutdown", native, async () => {
  const fixture = await setupFixture({ platform: { terminal: { executable: "/bin/sh", args: ["-c", "printf 'GENERATED_LIFECYCLE_READY\\n'; exec cat"] } } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  let restarted: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    const opened = await sdk.terminal.open(fixture.sessionId), before = await output(sdk, opened.id!, "GENERATED_LIFECYCLE_READY");
    const bad = await fetch(`${fixture.service.connection.baseUrl}/v1/lifecycle`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "restart" }) });
    assert.equal(bad.status, 401);
    sdk.disconnect(); await stopMoguriService(join(fixture.directory, "state"), { preserveTerminals: true });
    restarted = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey, platform: { terminal: { vault: fixture.terminalVault } } });
    const peer = await new MoguriSdk(restarted.connection).ready();
    try { assert.equal((await peer.terminal.read(opened.id!)).terminal.pid, before.terminal.pid); }
    finally { peer.disconnect(); }
    await stopMoguriService(join(fixture.directory, "state"));
    await assert.rejects(() => readFile(join(fixture.directory, "state/connection.json")), { code: "ENOENT" });
  } finally { sdk.disconnect(); await restarted?.close(); await fixture.close(); }
});

test("an actual service SIGKILL recovers the same authenticated owner/PTY from an explicit generated secret backend", native, async () => {
  const directory = await mkdtemp(join(tmpdir(), "moguri-terminal-crash-")), stateDir = join(directory, "state"), project = join(directory, "project"), vaultPath = join(directory, "generated-vault.json");
  await mkdir(project);
  const provider = await fixtureProvider();
  let first: Awaited<ReturnType<typeof launchRuntimeChild>> | undefined, second: typeof first;
  let sdk: MoguriSdk | undefined, peer: MoguriSdk | undefined, owner: import("../packages/sdk/src/index.ts").TerminalOwner | undefined;
  try {
    first = await launchRuntimeChild({ stateDir, vaultPath, modelId: provider.modelId, baseUrl: provider.baseUrl });
    sdk = await new MoguriSdk(first.connection).ready();
    const registered = await sdk.command({ type: "project.add", path: project }), session = await sdk.sessions.create(registered.id!);
    const opened = await sdk.terminal.open(session.id!), before = await output(sdk, opened.id!, "GENERATED_CHILD_TERMINAL_READY");
    owner = sdk.getState().snapshot!.terminalOwners[0]!;
    await sdk.terminal.input(opened.id!, "GENERATED_CRASH_INPUT\n"); await output(sdk, opened.id!, "GENERATED_CRASH_INPUT");
    sdk.disconnect(); await first.stop();
    second = await launchRuntimeChild({ stateDir, vaultPath, modelId: provider.modelId, baseUrl: provider.baseUrl });
    peer = await new MoguriSdk(second.connection).ready();
    const after = await peer.terminal.read(opened.id!);
    assert.equal(after.terminal.pid, before.terminal.pid); assert.equal(peer.getState().snapshot!.terminalOwners[0]?.pid, owner.pid);
    assert.equal(after.data.split("GENERATED_CHILD_TERMINAL_READY").length - 1, 1); assert.match(after.data, /GENERATED_CRASH_INPUT/);
    assert.equal((await readFile(vaultPath, "utf8")).includes("GENERATED_CRASH_INPUT"), false); assert.equal(provider.requests.length, 0);
    await peer.terminal.close(opened.id!); peer.disconnect(); await stopMoguriService(stateDir);
  } finally {
    sdk?.disconnect(); peer?.disconnect();
    await first?.stop(); await second?.stop();
    if (owner) {
      const key = await new GeneratedFileVault(vaultPath).read(`terminal-owner-${owner.id}`);
      if (key) {
        let connected: Awaited<ReturnType<typeof TerminalChannel.connect>> | undefined;
        for (let index = 0; index < 20 && !connected; index++) {
          try { connected = await TerminalChannel.connect(owner, key, randomUUID()); }
          catch (error) {
            if (!(error instanceof Error && "code" in error && error.code === "terminal_owner_busy") || index === 19) throw error;
            await new Promise((resolve) => setTimeout(resolve, 20));
          }
        }
        assert.ok(connected);
        try { await connected.channel.request({ action: "close-all" }); connected.channel.retire(); await connected.channel.request({ action: "dispose" }); }
        finally { connected.channel.detach(); }
        await new GeneratedFileVault(vaultPath).remove(`terminal-owner-${owner.id}`);
        const prepared = preparedTerminalOwner(owner); await assertTerminalEndpoint(prepared, false); await rm(prepared.directory, { recursive: true, force: true });
      }
    }
    await provider.close(); await rm(directory, { recursive: true, force: true });
  }
});
