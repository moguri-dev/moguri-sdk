import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, realpath, rename } from "node:fs/promises";
import { join } from "node:path";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { startService } from "../apps/service/src/server.ts";
import { setupFixture, waitFor } from "./fixture.ts";
import { initializeGeneratedRepository } from "./fixtures/git-project.ts";

const native = { skip: process.platform !== "darwin" };
const program = { executable: "/bin/sh", args: ["-c", "printf 'GENERATED_GLOBAL_READY\\n'; exec cat"] };

test("one global console is independent of all sessions, deduplicates concurrent opens and never enters model context", native, async () => {
  const fixture = await setupFixture({ platform: { terminal: program } }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const before = sdk.getState().snapshot!.sessions.length;
    const opened = await Promise.all([sdk.terminal.openGlobal(fixture.project), sdk.terminal.openGlobal(fixture.project)]);
    assert.equal(opened[0]!.id, opened[1]!.id);
    const id = opened[0]!.id!, current = await sdk.terminal.read(id);
    assert.equal(current.terminal.sessionId, null); assert.equal(current.terminal.projectId, null);
    assert.equal(current.terminal.binding?.root, await realpath(fixture.project));
    assert.equal(sdk.getState().snapshot!.sessions.length, before);
    await sdk.terminal.input(id, "GENERATED_GLOBAL_INPUT\n");
    await waitFor(() => fixture.service.controller.snapshot().terminals.some((terminal) => terminal.id === id));
    await sdk.sessions.delete(fixture.sessionId, true);
    assert.equal((await sdk.terminal.read(id)).terminal.status, "running");
    assert.equal(JSON.stringify(fixture.service.controller.events(0)).includes("GENERATED_GLOBAL_INPUT"), false);
    assert.equal(fixture.requests.length, 0);
    await sdk.terminal.close(id);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("global input rechecks Local policy and the exact root inode while inspection and close stay available", native, async () => {
  const fixture = await setupFixture({ platform: { terminal: program } }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const opened = await sdk.terminal.openGlobal(fixture.project), id = opened.id!;
    await sdk.command({ type: "policy.set", allowedEnvs: ["Remote"] });
    await assert.rejects(() => sdk.terminal.input(id, "GENERATED_DENIED_INPUT\n"), /policy|Local/i);
    await assert.rejects(() => sdk.terminal.openGlobal(fixture.project), /policy|Local/i);
    assert.equal((await sdk.terminal.read(id)).terminal.status, "running");
    await sdk.command({ type: "policy.set", allowedEnvs: ["Local", "Sandbox", "Remote"] });
    await rename(fixture.project, join(fixture.directory, "old-root")); await mkdir(fixture.project);
    await assert.rejects(() => sdk.terminal.resize(id, 90, 30), /root|identity/i);
    await sdk.terminal.close(id);
    assert.equal((await sdk.terminal.read(id)).terminal.status, "closed");
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("restart reattaches the exact global owner and PTY without a session or replayed input", native, async () => {
  const fixture = await setupFixture({ platform: { terminal: program } }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  let restarted: Awaited<ReturnType<typeof startService>> | undefined, peer: MoguriSdk | undefined;
  try {
    await sdk.sessions.delete(fixture.sessionId, true);
    const opened = await sdk.terminal.openGlobal(fixture.project), before = await sdk.terminal.read(opened.id!);
    await sdk.terminal.input(opened.id!, "GENERATED_GLOBAL_BEFORE_RESTART\n");
    sdk.disconnect(); await fixture.service.close({ preserveTerminals: true });
    restarted = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey,
      platform: { terminal: { ...program, vault: fixture.terminalVault } } });
    peer = await new MoguriSdk(restarted.connection).ready();
    const after = await peer.terminal.read(opened.id!);
    assert.equal(after.terminal.pid, before.terminal.pid); assert.equal(after.terminal.ownerId, before.terminal.ownerId);
    assert.notEqual(after.terminal.attachmentId, before.terminal.attachmentId);
    assert.equal(peer.getState().snapshot!.sessions.length, 0);
    await peer.terminal.input(opened.id!, "GENERATED_GLOBAL_AFTER_RESTART\n"); await peer.terminal.close(opened.id!);
  } finally { sdk.disconnect(); peer?.disconnect(); await restarted?.close(); await fixture.close(); }
});

test("project-free session consoles require an explicitly chosen root and remain distinct from the global console", native, async () => {
  const fixture = await setupFixture({ platform: { terminal: program } }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const created = await sdk.sessions.create(null);
    await assert.rejects(() => sdk.terminal.open(created.id!), /explicit|root|project/i);
    const global = await sdk.terminal.openGlobal(fixture.project);
    const own = await sdk.terminal.open(created.id!, 80, 24, undefined, fixture.project);
    assert.notEqual(global.id, own.id);
    assert.equal((await sdk.terminal.read(own.id!)).terminal.sessionId, created.id);
    assert.equal((await sdk.terminal.read(own.id!)).terminal.projectId, null);
    await sdk.sessions.delete(created.id!, true);
    assert.equal((await sdk.terminal.read(global.id!)).terminal.status, "running");
    await sdk.terminal.close(global.id!);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("a missing global launch receipt cannot replace a closed original console", native, async () => {
  const fixture = await setupFixture({ platform: { terminal: program } }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const id = "generated-original-global-open", command = { type: "terminal.open-global" as const, root: fixture.project, cols: 80, rows: 24 };
    const opened = await sdk.command(command, id), before = await sdk.terminal.read(opened.id!);
    await sdk.terminal.close(opened.id!);
    fixture.service.store.db.prepare("DELETE FROM receipts WHERE profile_id=? AND id=?").run(sdk.profileId, id);
    await assert.rejects(() => sdk.command(command, id), /original command already owns a terminal intent/);
    assert.equal(fixture.service.controller.snapshot().terminals.length, 1);
    assert.equal((await sdk.terminal.read(opened.id!)).terminal.pid, before.terminal.pid);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("an independent global console protects its exact managed root from removal and artifact publication without borrowing project identity", native, async () => {
  const fixture = await setupFixture({ platform: { terminal: program } }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    initializeGeneratedRepository(fixture.project);
    const created = await sdk.workspaces.create(fixture.session().projectId, "moguri/generated-global-root");
    const workspace = await sdk.workspaces.wait(created.id!);
    await sdk.artifacts.create(fixture.sessionId, { kind: "report", name: "Generated root-bound report", text: "Generated independent console publication guard." });
    const opened = await sdk.terminal.openGlobal(workspace.path);
    const options = { workspaceId: workspace.id }, preview = (await sdk.artifacts.materializePreview(fixture.session().projectId, options)).preview;
    await assert.rejects(() => sdk.artifacts.materialize(fixture.session().projectId, preview.digest, options), /Finish owned work/);
    await assert.rejects(() => sdk.workspaces.remove(workspace.id, workspace.revision, true), /owned writer|holds.*worktree/i);
    assert.equal((await sdk.terminal.read(opened.id!)).terminal.status, "running");
    assert.equal((await sdk.terminal.read(opened.id!)).terminal.projectId, null);
    await sdk.terminal.close(opened.id!);
    await sdk.workspaces.remove(workspace.id, workspace.revision, true);
    assert.equal((await sdk.workspaces.wait(workspace.id)).status, "removed");
  } finally { sdk.disconnect(); await fixture.close(); }
});
