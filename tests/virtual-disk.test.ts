import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { GLOBAL_PROFILE_ID, MoguriError, type VirtualDiskStatus } from "../packages/protocol/src/index.ts";
import { EventStore } from "../apps/service/src/store.ts";
import { VirtualDiskRuntime, type VirtualDiskDriver } from "../apps/service/src/virtual-disk.ts";
import { GENERATED_RETENTION_KEY, setupFixture, waitFor } from "./fixture.ts";
import { initializeGeneratedRepository } from "./fixtures/git-project.ts";
import { generatedIssueRevisions, generatedResponsiveHistory } from "./fixtures/responsive-history.ts";
import { ciTime } from "./fixtures/time-scale.ts";

const MiB = 1024 ** 2, GiB = 1024 ** 3;
const run = (cwd: string, args: string[]) => execFileSync("git", ["--no-pager", "-c", "core.hooksPath=/dev/null", "-c", "user.name=Generated fixture",
  "-c", "user.email=fixture@example.invalid", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
async function until<T>(read: () => Promise<T | false | null | undefined>, timeout = 30_000): Promise<T> {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error("Timed out waiting for the generated virtual disk.");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

test("the virtual disk holds new worktrees, pauses work when full, reclaims archived pushed worktrees, resizes and turns off only when empty", { skip: process.platform !== "darwin" }, async () => {
  const f = await setupFixture({ virtualDisk: { intervalMs: 100, reserve: (total) => total - 48 * MiB, resume: (total) => total - 24 * MiB } });
  const git = initializeGeneratedRepository(f.project), remote = await mkdtemp(join(tmpdir(), "moguri-generated-remote-"));
  run(remote, ["init", "--bare", "--initial-branch=main"]); git(["remote", "add", "origin", remote]); git(["push", "--quiet", "origin", "main"]);
  const sdk = await new MoguriSdk(f.service.connection).ready();
  const status = async (): Promise<VirtualDiskStatus> => (await sdk.application.disk.status()).disk;
  const workspace = (id: string) => sdk.getState().snapshot!.managedWorkspaces.find((value) => value.id === id)!;
  try {
    const initial = await status();
    assert.equal(initial.supported, true); assert.equal(initial.disk, null);
    await sdk.application.disk.configure(1, 0);
    const ready = await until(async () => { const value = await status(); return value.disk?.status === "ready" && value; });
    const disk = ready.disk!;
    assert.equal(disk.sizeGiB, 1); assert.ok(ready.usage && Math.abs(ready.usage.totalBytes - GiB) < 64 * MiB);
    const root = join(realpathSync(disk.mountpoint), "moguri", "profiles", "default", "worktrees");
    // D76: the event connection pushes the disk's status, so clients show live usage without polling.
    const live = await until(async () => { const value = sdk.application.disk.current(); return value?.disk?.status === "ready" && value.usage && value; });

    const first = await sdk.sessions.create(f.session().projectId, "Generated disk session", { modelId: f.modelId });
    const a = await sdk.workspaces.wait(sdk.sessions.get(first.id!)!.workspaceId!);
    assert.deepEqual(a.volume, { kind: "virtual-disk", diskId: disk.id });
    assert.ok(a.path.startsWith(`${root}/`), a.path);
    const send = async (id: string, text: string) => {
      const saved = await sdk.command({ type: "draft.save", sessionId: id, expectedRevision: sdk.sessions.get(id)!.draft.revision, text, attachments: [] });
      await sdk.command({ type: "message.send", sessionId: id, expectedRevision: saved.revision!, delivery: "queue" });
    };
    await send(first.id!, "generated write on the disk");
    await waitFor(() => sdk.sessions.get(first.id!)?.status === "completed", 20_000);

    await writeFile(join(a.path, "generated-filler.bin"), Buffer.alloc(72 * MiB, 1));
    await until(async () => { const value = sdk.application.disk.current(); return value?.disk?.pressure?.paused && value.usage!.freeBytes < live.usage!.freeBytes - 64 * MiB; });
    await until(async () => (await status()).disk?.pressure?.paused);
    await assert.rejects(sdk.sessions.create(f.session().projectId, "Generated blocked session", { modelId: f.modelId }), /virtual disk is full/);
    const requests = f.requests.length;
    await send(first.id!, "generated queued while full");
    await new Promise((resolve) => setTimeout(resolve, 1000));
    assert.equal(f.requests.length, requests, "a queued turn on a full disk waits");
    assert.equal(sdk.sessions.get(first.id!)?.turnId, null);
    await unlink(join(a.path, "generated-filler.bin"));
    await until(async () => (await status()).disk?.pressure?.paused === false);
    await until(async () => sdk.application.disk.current()?.disk?.pressure?.paused === false);
    await waitFor(() => sdk.sessions.get(first.id!)?.status === "completed" && f.requests.length > requests, 20_000);

    const settings = sdk.getState().snapshot!.settings;
    await sdk.settings.update({ ...settings.values, retention: { ...settings.values.retention, archiveBranchCleanup: false } }, settings.revision);
    const second = await sdk.sessions.create(f.session().projectId, "Generated reclaimable session", { modelId: f.modelId });
    const b = await sdk.workspaces.wait(sdk.sessions.get(second.id!)!.workspaceId!);
    await writeFile(join(b.path, "generated-large.bin"), Buffer.alloc(72 * MiB, 2));
    run(b.path, ["add", "--", "generated-large.bin"]); run(b.path, ["commit", "--no-gpg-sign", "--quiet", "-m", "Generated large file"]);
    run(b.path, ["push", "--quiet", "-u", "origin", b.branch]);
    await sdk.command({ type: "session.archive", sessionId: second.id! });
    await waitFor(() => workspace(b.id).status === "removed", 30_000);
    assert.equal(workspace(b.id).parked?.reason, "disk-pressure");
    assert.equal(existsSync(b.path), false);
    await until(async () => { const value = await status(); return value.disk?.pressure?.paused !== true && value.usage!.freeBytes > value.usage!.totalBytes - 24 * MiB; });

    const before = await status();
    await sdk.application.disk.configure(2, before.disk!.revision);
    const resized = await until(async () => { const value = await status(); return value.disk?.status === "ready" && value.disk.sizeGiB === 2 && value; }, 120_000);
    assert.ok(resized.usage && Math.abs(resized.usage.totalBytes - 2 * GiB) < 64 * MiB);
    assert.equal(run(a.path, ["rev-parse", "--abbrev-ref", "HEAD"]), a.branch, "worktrees on the disk survive a resize");

    await assert.rejects(sdk.application.disk.configure(null, resized.disk!.revision), /1 worktree still lives on the disk/);
    run(a.path, ["add", "--", "fixture.txt"]); run(a.path, ["commit", "--no-gpg-sign", "--quiet", "-m", "Generated disk work"]);
    run(a.path, ["push", "--quiet", "-u", "origin", a.branch]);
    const restored = await sdk.settings.get()!;
    await sdk.settings.update({ ...restored.values, retention: { ...restored.values.retention, archiveBranchCleanup: true } }, restored.revision);
    await sdk.command({ type: "session.archive", sessionId: first.id! });
    await waitFor(() => workspace(a.id).status === "removed", 30_000);
    const empty = await status();
    assert.equal(empty.worktrees, 0);
    await sdk.application.disk.configure(null, empty.disk!.revision);
    const off = await until(async () => { const value = await status(); return value.disk?.status === "off" && value; }, 120_000);
    assert.equal(off.usage, null); assert.equal(existsSync(disk.image), false);
  } finally { sdk.disconnect(); await f.close(); await rm(remote, { recursive: true, force: true }); }
});

function fakeDriver(space: { freeBytes: number; totalBytes: number }, supported = true): VirtualDiskDriver & { calls: string[] } {
  const calls: string[] = [];
  return { supported, calls,
    create: async () => { calls.push("create"); }, attach: async () => { calls.push("attach"); }, detach: async () => { calls.push("detach"); },
    resize: async () => { calls.push("resize"); }, compact: async () => { calls.push("compact"); },
    mounted: () => true, space: () => space };
}
async function runtime(driver: VirtualDiskDriver, owners: string[] = [], worktrees = 0) {
  const folder = await mkdtemp(join(tmpdir(), "moguri-generated-disk-")), store = new EventStore(join(folder, "state.sqlite"), GENERATED_RETENTION_KEY);
  const global = store.view(GLOBAL_PROFILE_ID);
  const disk = new VirtualDiskRuntime(global, folder, { changed: () => {}, reclaim: async () => {}, owners: () => owners, worktrees: () => worktrees }, { driver, intervalMs: 60_000 });
  const finish = (events: Parameters<typeof global.commit>[0], result = {}) => { global.commit(events); return result; };
  return { disk, finish, global, close: async () => { await disk.close(); store.close(); await rm(folder, { recursive: true, force: true }); } };
}

test("virtual disk changes refuse unsupported hosts, busy resizes, too-small shrinks and stale revisions without touching the image", async () => {
  const unsupported = await runtime(fakeDriver({ freeBytes: GiB, totalBytes: GiB }, false));
  try {
    assert.throws(() => unsupported.disk.configure({ type: "application.virtual_disk.configure", sizeGiB: 5, expectedRevision: 0 }, unsupported.finish), /need macOS/);
  } finally { await unsupported.close(); }

  const driver = fakeDriver({ freeBytes: 2 * GiB, totalBytes: 10 * GiB }), owned = await runtime(driver, ["session \"Generated busy\""]);
  try {
    const now = new Date().toISOString();
    owned.global.commit([{ event_type: "application.virtual_disk_saved", profile_id: GLOBAL_PROFILE_ID, payload: { disk: {
      id: "generated-disk", revision: 0, status: "ready", sizeGiB: 10, image: "/generated/none.sparsebundle", mountpoint: "/generated/none", createdAt: now, updatedAt: now, diagnostic: null, pressure: null } } }]);
    const reloaded = new VirtualDiskRuntime(owned.global, "/generated", { changed: () => {}, reclaim: async () => {}, owners: () => ["session \"Generated busy\""], worktrees: () => 1 }, { driver, intervalMs: 60_000 });
    assert.throws(() => reloaded.configure({ type: "application.virtual_disk.configure", sizeGiB: 20, expectedRevision: 3 }, owned.finish), /changed\. Reload/);
    assert.throws(() => reloaded.configure({ type: "application.virtual_disk.configure", sizeGiB: 20, expectedRevision: 0 }, owned.finish), (error) => error instanceof MoguriError && /Generated busy/.test(error.message));
    const idle = new VirtualDiskRuntime(owned.global, "/generated", { changed: () => {}, reclaim: async () => {}, owners: () => [], worktrees: () => 1 }, { driver, intervalMs: 60_000 });
    assert.throws(() => idle.configure({ type: "application.virtual_disk.configure", sizeGiB: 5, expectedRevision: 0 }, owned.finish), /already holds 8\.0 GB\. Choose at least 9 GB/);
    assert.throws(() => idle.configure({ type: "application.virtual_disk.configure", sizeGiB: null, expectedRevision: 0 }, owned.finish), /1 worktree still lives on the disk/);
    assert.deepEqual(driver.calls, [], "no refused change touched the image");
  } finally { await owned.close(); }
});

test("a disk image that already exists is never adopted, attached or deleted, and the disk stays off", async () => {
  const driver = fakeDriver({ freeBytes: GiB, totalBytes: GiB }), t = await runtime(driver);
  try {
    const image = join(t.disk.directory, "sessions.sparsebundle");
    await mkdir(t.disk.directory, { mode: 0o700 }); await mkdir(image); await writeFile(join(image, "generated-user-file"), "Generated pre-existing bytes.\n");
    t.disk.configure({ type: "application.virtual_disk.configure", sizeGiB: 1, expectedRevision: 0 }, t.finish);
    await until(async () => t.disk.status().disk?.status === "off");
    assert.match(t.disk.status().disk!.diagnostic ?? "", /already exists .* didn't overwrite it/);
    assert.throws(() => t.disk.configure({ type: "application.virtual_disk.configure", sizeGiB: null, expectedRevision: t.disk.status().disk!.revision }, t.finish), /already off/);
    assert.equal(existsSync(join(image, "generated-user-file")), true);
    assert.deepEqual(driver.calls, []);
  } finally { await t.close(); }
});

test("a resource folder configured in another letter case still gives the disk's canonical worktree root", { skip: process.platform !== "darwin" }, async (t) => {
  const folder = await mkdtemp(join(tmpdir(), "moguri-generated-case-")), spelled = join(dirname(folder), basename(folder).toUpperCase());
  const store = new EventStore(join(folder, "state.sqlite"), GENERATED_RETENTION_KEY), global = store.view(GLOBAL_PROFILE_ID);
  const disk = new VirtualDiskRuntime(global, spelled, { changed: () => {}, reclaim: async () => {}, owners: () => [], worktrees: () => 0 },
    { driver: fakeDriver({ freeBytes: GiB, totalBytes: GiB }), intervalMs: 60_000 });
  try {
    if (!existsSync(spelled)) { t.skip("This volume is case-sensitive."); return; }
    disk.configure({ type: "application.virtual_disk.configure", sizeGiB: 1, expectedRevision: 0 }, (events, result = {}) => { global.commit(events); return result; });
    await until(async () => disk.status().disk?.status === "ready");
    const root = disk.current()!.root;
    assert.equal(root, await realpath(root), "new worktree parents are checked against the native real path");
    assert.equal(root, join(await realpath(folder), "virtual-disk", "volume", "moguri"));
  } finally { await disk.close(); store.close(); await rm(folder, { recursive: true, force: true }); }
});

test("a client whose ready snapshot exceeds the event backpressure limit keeps its connection and gets the disk status in ready", { timeout: ciTime(120_000) }, async () => {
  const f = await setupFixture({ responseMode: "text" });
  let sdk: MoguriSdk | undefined;
  try {
    const projectId = f.session().projectId;
    f.service.store.commit([...generatedResponsiveHistory(f.sessionId, projectId), ...generatedIssueRevisions(projectId)]);
    f.service.controller.refreshProfile();
    sdk = await new MoguriSdk(f.service.connection).ready();
    assert.ok(Buffer.byteLength(JSON.stringify(sdk.getState().snapshot)) > 4 * MiB, "the generated snapshot alone fills the socket buffer");
    const closes: string[] = [];
    sdk.subscribe(() => { const state = sdk!.getState(); if (state.status !== "connected") closes.push(state.error ?? state.status); });
    await waitFor(() => sdk!.getState().disk !== null, ciTime(10_000));
    assert.equal(sdk.getState().disk!.disk, null);
    await new Promise((resolve) => setTimeout(resolve, ciTime(500)));
    const created = await sdk.sessions.create(null, "Generated session after a large ready");
    assert.ok(created.id);
    assert.deepEqual(closes, [], "no backpressure close followed the large ready snapshot");
  } finally { sdk?.disconnect(); await f.close(); }
});
