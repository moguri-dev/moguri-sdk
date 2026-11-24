import assert from "node:assert/strict";
import test from "node:test";
import { fork, spawnSync } from "node:child_process";
import { appendFile, chmod, lstat, mkdir, open, readFile, rename, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { remoteRestorePlan, remoteRewindFixture, waitForRemote } from "./fixtures/remote-rewind.ts";
import { inspectRemoteCheckpointRewind, runRemoteCheckpointRewind } from "../apps/service/src/remote-checkpoint-workspace.ts";
import { frameDigest } from "../apps/service/src/worker-wire.ts";
import { CHECKPOINT_FILE_BYTES } from "../packages/protocol/src/index.ts";
import { parentMessage, type WorkerStart } from "../apps/service/src/worker-protocol.ts";
import { RemoteRuntime } from "../apps/service/src/remote.ts";
import { isRecord, type RemoteExecution } from "../packages/protocol/src/index.ts";
import { GeneratedFileVault } from "./fixtures/generated-vault.ts";
import { verifyRemoteCheckpointWorkspace } from "../apps/service/src/workspace-rewind-worker.ts";
import { ciTime } from "./fixtures/time-scale.ts";

const generatedGit = (root: string, ...args: string[]) => {
  const result = spawnSync("git", ["--no-pager", "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false",
    "-c", "user.name=Generated fixture", "-c", "user.email=generated@example.invalid", ...args], { cwd: root,
    env: { PATH: process.env.PATH, HOME: root, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" },
    timeout: 5000, encoding: "utf8" });
  assert.equal(result.status, 0, `Generated Git fixture failed: ${result.stderr}`); return result.stdout.trim();
};

test("Remote checkpoint capture reads the actual pinned peer root, never the controller checkout", { skip: process.platform !== "darwin", timeout: ciTime(30000) }, async () => {
  const fixture = await remoteRewindFixture();
  try {
    await writeFile(join(fixture.workspace, "fixture.txt"), "Generated exact Remote checkpoint bytes.");
    await writeFile(join(fixture.workspace, ".env"), "GENERATED_SECRET_PLACEHOLDER=excluded");
    await writeFile(join(fixture.workspace, ".gitignore"), "generated-ignored/\n");
    await mkdir(join(fixture.workspace, "generated-ignored")); await mkdir(join(fixture.workspace, "generated-denied"));
    await writeFile(join(fixture.workspace, "generated-ignored", "ignored.txt"), "Generated excluded ignored bytes.");
    await writeFile(join(fixture.workspace, "generated-denied", "denied.txt"), "Generated excluded policy bytes.");
    fixture.settings.deniedFolders = ["generated-denied"];
    const binary = Buffer.alloc(512 * 1024, 0x80);
    await writeFile(join(fixture.workspace, "complete.bin"), binary); await chmod(join(fixture.workspace, "complete.bin"), 0o751);
    const result = await fixture.capture();
    assert.equal(result.roots[0]?.binding.root, fixture.workspace);
    assert.equal(Buffer.from(result.roots[0]!.files.find((file) => file.path === "fixture.txt")!.content, "base64").toString("utf8"), "Generated exact Remote checkpoint bytes.");
    assert.equal(result.roots[0]?.files.some((file) => file.path === ".env"), false);
    assert.ok(result.roots[0]!.excluded.includes(".env"));
    assert.ok(result.roots[0]!.excluded.includes("generated-ignored")); assert.ok(result.roots[0]!.excluded.includes("generated-denied"));
    const captured = result.roots[0]!.files.find((file) => file.path === "complete.bin")!;
    assert.deepEqual(Buffer.from(captured.content, "base64"), binary); assert.equal(captured.mode, 0o751);
    assert.equal(result.bytes, result.roots[0]!.files.reduce((bytes, file) => bytes + file.bytes, 0));
    assert.equal(result.boundary?.env, "Remote");
    assert.equal(result.boundary?.peerDigest, frameDigest({ hostKey: fixture.ssh.target.hostKey }));
    assert.ok(result.boundary?.sourceDigest);
    assert.equal(await readFile(join(fixture.controllerRoot, "fixture.txt"), "utf8"), "Generated untouched controller bytes.\n");
  } finally { await fixture.close(); }
});

test("Remote capture rejects oversized or unsupported complete sources without truncation", { skip: process.platform !== "darwin", timeout: ciTime(30_000) }, async () => {
  const fixture = await remoteRewindFixture();
  try {
    await writeFile(join(fixture.workspace, "oversized.bin"), Buffer.alloc(CHECKPOINT_FILE_BYTES + 1, 0x61));
    await assert.rejects(() => fixture.capture(), /regular files|prefix|limit|complete/i);
    await unlink(join(fixture.workspace, "oversized.bin"));
    await symlink("fixture.txt", join(fixture.workspace, "unsupported-link"));
    await assert.rejects(() => fixture.capture(), /linked|special|incomplete/i);
    await unlink(join(fixture.workspace, "unsupported-link"));
    for (let index = 0; index < 9; index++) await writeFile(join(fixture.workspace, `bounded-${index}.bin`), Buffer.alloc(CHECKPOINT_FILE_BYTES, index));
    await assert.rejects(() => fixture.capture(), /16 MiB|complete snapshot|capture exceeds/i);
    assert.equal(fixture.writes.length, 0);
  } finally { await fixture.close(); }
});

test("Remote restoration uses the exact owned model-free worker and retains original frames and displaced bytes", { skip: process.platform !== "darwin", timeout: ciTime(30_000) }, async () => {
  const fixture = await remoteRewindFixture();
  try {
    const before = await fixture.capture();
    await writeFile(join(fixture.workspace, "fixture.txt"), "Generated changed peer bytes.\n");
    const current = await fixture.capture(), plan = remoteRestorePlan(before, current);
    const restored = await fixture.run(plan);
    assert.equal(restored.execution.status, "completed");
    assert.equal(restored.execution.cleanup, "owned-worker-stopped");
    assert.equal(await readFile(join(fixture.workspace, "fixture.txt"), "utf8"), "Generated original peer bytes.\n");
    assert.equal(await readFile(restored.result.files[0]!.backup!, "utf8"), "Generated changed peer bytes.\n");
    const inspection = await inspectRemoteCheckpointRewind(fixture.runtime, restored.execution, plan, fixture.settings, AbortSignal.timeout(15_000));
    assert.equal(inspection.settled, true); assert.deepEqual(inspection.result, restored.result);
    assert.equal(inspection.journal.status.acknowledged, 0);
    assert.equal(inspection.effects[0]?.backupMatchesOriginal, true);
    assert.equal(inspection.effects[0]?.currentMatchesResult, true);
    assert.ok(inspection.frames.every((frame) => ["workspace.rewind.intent", "workspace.rewind.boundary", "workspace.rewind.complete", "finished", "ack"].includes(frame.request.kind)));
    assert.equal(fixture.writes.filter((id) => id === plan.operationId).length, 1);
    assert.equal(await readFile(join(fixture.controllerRoot, "fixture.txt"), "utf8"), "Generated untouched controller bytes.\n");
  } finally { await fixture.close(); }
});

test("Remote capture, restore and inspection reject missing OS identity even when the shared native schema permits it", { skip: process.platform !== "darwin", timeout: ciTime(30_000) }, async (t) => {
  const f = await remoteRewindFixture();
  try {
    const before = await f.capture();
    const response = await f.runtime.readWorkspace(f.workspace, { query: { type: "checkpoint.capture" },
      policy: { deniedFolders: [], planPath: f.settings.planPath } }, AbortSignal.timeout(15_000));
    assert.equal(response.type, "checkpoint.capture");
    if (response.type !== "checkpoint.capture") throw new Error("Missing generated raw Remote capture.");
    const { digest: _digest, ...raw } = response.workspace;
    delete raw.roots[0]!.files[0]!.identity;
    assert.throws(() => verifyRemoteCheckpointWorkspace({ ...raw, digest: frameDigest(raw) }, f.workspace), /Remote.*genuine OS identity/i);

    await writeFile(join(f.workspace, "fixture.txt"), "Generated genuine Remote identity preservation.\n");
    const plan = remoteRestorePlan(before, await f.capture());
    const missingCurrent = structuredClone(plan); delete missingCurrent.files[0]!.current!.identity;
    await assert.rejects(() => f.run(missingCurrent), /Remote.*genuine OS identity/i);
    const missingTarget = structuredClone(plan); delete missingTarget.files[0]!.target!.identity;
    await assert.rejects(() => f.run(missingTarget), /Remote.*genuine OS identity/i);
    assert.equal(f.executions.size, 0); assert.equal(f.writes.length, 0);

    const restored = await f.run(plan), query = f.runtime.query.bind(f.runtime);
    let missing: "current" | "backup" = "current";
    const mock = t.mock.method(f.runtime, "query", async (...args: Parameters<typeof query>) => {
      const result = await query(...args);
      if (result.kind === "workspace" && result.result.type === "checkpoint.rewind.inspect") {
        const inspected = result.result.inspection.files[0]!;
        const file = missing === "current" ? inspected.current : inspected.backup?.file;
        assert.ok(file); delete file.identity;
      }
      return result;
    });
    try {
      for (const field of ["current", "backup"] as const) {
        missing = field;
        await assert.rejects(() => inspectRemoteCheckpointRewind(f.runtime, restored.execution, plan, f.settings, AbortSignal.timeout(15_000)), /Remote.*genuine OS identity/i);
      }
    } finally { mock.mock.restore(); }
    assert.equal(await readFile(join(f.workspace, "fixture.txt"), "utf8"), "Generated original peer bytes.\n");
    assert.equal(await readFile(restored.result.files[0]!.backup!, "utf8"), "Generated genuine Remote identity preservation.\n");
    assert.equal(f.writes.length, 1);
  } finally { await f.close(); }
});

test("Remote restoration preserves actual HEAD/index, dirty staged and unrelated untracked intent, exact modes and every displaced file", { skip: process.platform !== "darwin", timeout: ciTime(40_000) }, async () => {
  const f = await remoteRewindFixture();
  try {
    await writeFile(join(f.workspace, "missing.txt"), "Generated checkpoint file to recreate.\n");
    await writeFile(join(f.workspace, "staged.txt"), "Generated committed staged base.\n");
    await chmod(join(f.workspace, "fixture.txt"), 0o755);
    generatedGit(f.workspace, "init", "--quiet", "--initial-branch=main");
    generatedGit(f.workspace, "add", "fixture.txt", "missing.txt", "staged.txt"); generatedGit(f.workspace, "commit", "--quiet", "-m", "Generated fixture base");
    await writeFile(join(f.workspace, "staged.txt"), "Generated staged intent.\n"); generatedGit(f.workspace, "add", "staged.txt");
    await writeFile(join(f.workspace, "staged.txt"), "Generated unstaged intent after staged version.\n");
    const before = await f.capture(), head = generatedGit(f.workspace, "rev-parse", "HEAD");
    await writeFile(join(f.workspace, "fixture.txt"), "Generated file edited after checkpoint.\n"); await chmod(join(f.workspace, "fixture.txt"), 0o640);
    await unlink(join(f.workspace, "missing.txt")); await writeFile(join(f.workspace, "created.txt"), "Generated post-checkpoint file to retain in backup.\n");
    await writeFile(join(f.workspace, "unrelated.txt"), "Generated unrelated external untracked file.\n");
    const index = await readFile(join(f.workspace, ".git", "index")), current = await f.capture();
    const plan = remoteRestorePlan(before, current, ["fixture.txt", "missing.txt", "created.txt", "staged.txt"]);
    plan.files[3]!.choice = "keep-current";
    await writeFile(join(f.controllerRoot, "generated-ledger.json"), '{"spentTokens":77,"unknownSpendHeld":true}\n');
    const restored = await f.run(plan);
    assert.equal(generatedGit(f.workspace, "rev-parse", "HEAD"), head);
    assert.deepEqual(await readFile(join(f.workspace, ".git", "index")), index);
    assert.equal(await readFile(join(f.workspace, "staged.txt"), "utf8"), "Generated unstaged intent after staged version.\n");
    assert.equal(await readFile(join(f.workspace, "unrelated.txt"), "utf8"), "Generated unrelated external untracked file.\n");
    assert.equal(await readFile(join(f.workspace, "missing.txt"), "utf8"), "Generated checkpoint file to recreate.\n");
    assert.equal((await lstat(join(f.workspace, "fixture.txt"))).mode & 0o777, 0o755);
    await assert.rejects(() => lstat(join(f.workspace, "created.txt")), { code: "ENOENT" });
    assert.equal(await readFile(restored.result.files[0]!.backup!, "utf8"), "Generated file edited after checkpoint.\n");
    assert.equal((await lstat(restored.result.files[0]!.backup!)).mode & 0o777, 0o640);
    assert.equal(await readFile(restored.result.files[2]!.backup!, "utf8"), "Generated post-checkpoint file to retain in backup.\n");
    assert.equal(restored.result.files[1]!.backup, null); assert.equal(restored.result.files[3]!.backup, null);
    assert.equal(await readFile(join(f.controllerRoot, "generated-ledger.json"), "utf8"), '{"spentTokens":77,"unknownSpendHeld":true}\n');
    assert.ok((await f.retained(plan.operationId)).some((record) => record.kind === "result"));
  } finally { await f.close(); }
});

test("stale raw Remote preview and a late boundary writer preserve external replacements without any restore", { skip: process.platform !== "darwin", timeout: ciTime(40_000) }, async () => {
  const f = await remoteRewindFixture();
  try {
    const before = await f.capture();
    await writeFile(join(f.workspace, "fixture.txt"), "Generated post-turn bytes.\n");
    const current = await f.capture(), stale = remoteRestorePlan(before, current);
    await writeFile(join(f.workspace, "fixture.txt"), "Generated external preview replacement.\n");
    await assert.rejects(() => f.run(stale), /changed|stale|preview/i);
    assert.equal(await readFile(join(f.workspace, "fixture.txt"), "utf8"), "Generated external preview replacement.\n");
    const fresh = remoteRestorePlan(before, await f.capture());
    await assert.rejects(() => f.run(fresh, { boundary: async (_index, phase) => {
      if (phase === "moving") await writeFile(join(f.workspace, "fixture.txt"), "Generated exact late boundary writer.\n");
    } }), /changed|conflict|review/i);
    assert.equal(await readFile(join(f.workspace, "fixture.txt"), "utf8"), "Generated exact late boundary writer.\n");
    const inspected = await inspectRemoteCheckpointRewind(f.runtime, f.executions.get(fresh.operationId)!, fresh, f.settings, AbortSignal.timeout(15_000));
    assert.equal(inspected.settled, true); assert.equal(inspected.result, null); assert.equal(inspected.effects[0]!.backup, null);
    assert.ok(["failed", "partial"].includes(f.executions.get(fresh.operationId)!.status));
  } finally { await f.close(); }
});

test("writes through an already-open displaced Remote inode survive and make the original restore partial", { skip: process.platform !== "darwin", timeout: ciTime(30_000) }, async () => {
  const f = await remoteRewindFixture();
  try {
    const before = await f.capture(); await writeFile(join(f.workspace, "fixture.txt"), "Generated original displaced bytes.\n");
    const plan = remoteRestorePlan(before, await f.capture()), writer = await open(join(f.workspace, "fixture.txt"), "r+");
    try {
      await assert.rejects(() => f.run(plan, { boundary: async (_index, phase) => {
        if (phase === "observed") { await writer.truncate(0); await writer.writeFile("Generated late write through original open inode.\n"); await writer.sync(); }
      } }), /late writer|displaced|conflict/i);
      const backup = join(f.workspace, ".moguri", "rewinds", plan.operationId, "0.displaced");
      assert.equal(await readFile(backup, "utf8"), "Generated late write through original open inode.\n");
      assert.equal((await lstat(backup, { bigint: true })).ino, (await writer.stat({ bigint: true })).ino);
      assert.equal(await readFile(join(f.workspace, "fixture.txt"), "utf8"), "Generated original peer bytes.\n");
      const inspected = await inspectRemoteCheckpointRewind(f.runtime, f.executions.get(plan.operationId)!, plan, f.settings, AbortSignal.timeout(15_000));
      assert.equal(inspected.settled, true); assert.equal(inspected.result, null);
      assert.equal(inspected.effects[0]!.backupMatchesOriginal, false); assert.equal(inspected.effects[0]!.currentMatchesResult, true);
      assert.equal(f.executions.get(plan.operationId)!.status, "partial");
    } finally { await writer.close(); }
  } finally { await f.close(); }
});

test("replaced Remote roots and changed Git intent are rejected at the actual effect boundary", { skip: process.platform !== "darwin", timeout: ciTime(40_000) }, async () => {
  const f = await remoteRewindFixture();
  try {
    const before = await f.capture(); await writeFile(join(f.workspace, "fixture.txt"), "Generated bytes before root replacement.\n");
    const plan = remoteRestorePlan(before, await f.capture()), old = `${f.workspace}-original`;
    await assert.rejects(() => f.run(plan, { boundary: async (_index, phase) => {
      if (phase === "moving") { await rename(f.workspace, old); await mkdir(f.workspace); await writeFile(join(f.workspace, "fixture.txt"), "Generated replacement root preserved.\n"); }
    } }), /root|device|inode/i);
    assert.equal(await readFile(join(old, "fixture.txt"), "utf8"), "Generated bytes before root replacement.\n");
    assert.equal(await readFile(join(f.workspace, "fixture.txt"), "utf8"), "Generated replacement root preserved.\n");
    await assert.rejects(() => inspectRemoteCheckpointRewind(f.runtime, f.executions.get(plan.operationId)!, plan, f.settings, AbortSignal.timeout(15_000)), /root|replaced/i);
    await rm(f.workspace, { recursive: true }); await rename(old, f.workspace);
    generatedGit(f.workspace, "init", "--quiet", "--initial-branch=main"); generatedGit(f.workspace, "add", "fixture.txt");
    generatedGit(f.workspace, "commit", "--quiet", "-m", "Generated exact original HEAD");
    const gitBefore = await f.capture(); await writeFile(join(f.workspace, "fixture.txt"), "Generated newer unstaged bytes.\n");
    const gitPlan = remoteRestorePlan(gitBefore, await f.capture());
    await assert.rejects(() => f.run(gitPlan, { boundary: async (_index, phase) => {
      if (phase === "moving") generatedGit(f.workspace, "add", "fixture.txt");
    } }), /HEAD|index|Git/i);
    assert.equal(await readFile(join(f.workspace, "fixture.txt"), "utf8"), "Generated newer unstaged bytes.\n");
    assert.match(generatedGit(f.workspace, "show", ":fixture.txt"), /newer unstaged/);
  } finally { await f.close(); }
});

test("Remote peer pin, selected build and protected/read-only/denied policy cannot grant restoration", { skip: process.platform !== "darwin", timeout: ciTime(30_000) }, async () => {
  const f = await remoteRewindFixture();
  try {
    const before = await f.capture(); await writeFile(join(f.workspace, "fixture.txt"), "Generated unmodified protected-policy source.\n");
    const plan = remoteRestorePlan(before, await f.capture());
    f.scope.workerDigest = "0".repeat(64);
    await assert.rejects(() => f.run(plan), /peer|build|identity/i); f.scope.workerDigest = f.runtime.readiness.workerDigest!;
    f.settings.readOnlyFolders = ["."];
    await assert.rejects(() => f.run(plan), /read.only|denied/i); f.settings.readOnlyFolders = [];
    f.settings.deniedFolders = ["fixture.txt"];
    await assert.rejects(() => f.run(plan), /denied/i); f.settings.deniedFolders = [];
    const protectedPlan = structuredClone(plan); protectedPlan.files[0]!.path = ".env";
    await assert.rejects(() => f.run(protectedPlan), /protected|path/i);
    f.setTarget({ ...f.ssh.target, hostKey: f.ssh.incorrectHostKey });
    await assert.rejects(() => f.runtime.probe(), /host.key|verification/i);
    await assert.rejects(() => f.run(plan), /qualification|probe|fallback|identity|pin|host.key/i);
    assert.equal(f.writes.length, 0); assert.equal(f.executions.size, 0);
    assert.equal(await readFile(join(f.workspace, "fixture.txt"), "utf8"), "Generated unmodified protected-policy source.\n");
  } finally { await f.close(); }
});

test("an actually changed installed Remote worker build cannot return a capture or run restoration", { skip: process.platform !== "darwin", timeout: ciTime(40_000) }, async () => {
  const f = await remoteRewindFixture({ bundled: true });
  try {
    const before = await f.capture(); await writeFile(join(f.workspace, "fixture.txt"), "Generated source before changed peer build.\n");
    const qualified = await f.run(remoteRestorePlan(before, await f.capture()));
    assert.equal(qualified.execution.status, "completed"); assert.equal(qualified.execution.cleanup, "owned-worker-stopped");
    await writeFile(join(f.workspace, "fixture.txt"), "Generated source before changed peer build.\n");
    const plan = remoteRestorePlan(before, await f.capture());
    await appendFile(f.workerPath, "\n// Generated different installed worker bytes.\n");
    await assert.rejects(() => f.capture(), /build differs|exact Moguri build|worker build/i);
    await assert.rejects(() => f.run(plan), /build differs|exact Moguri build|worker build/i);
    assert.equal(await readFile(join(f.workspace, "fixture.txt"), "utf8"), "Generated source before changed peer build.\n");
    assert.equal(f.executions.get(plan.operationId)?.cleanup, "unconfirmed");
  } finally { await f.close(); }
});

test("a policy change after one actual Remote file effect cancels the real worker before the next file", { skip: process.platform !== "darwin", timeout: ciTime(30_000) }, async () => {
  const f = await remoteRewindFixture();
  try {
    await writeFile(join(f.workspace, "second.txt"), "Generated second checkpoint.\n");
    const before = await f.capture(); await writeFile(join(f.workspace, "fixture.txt"), "Generated first post-turn.\n");
    await writeFile(join(f.workspace, "second.txt"), "Generated second post-turn.\n");
    const plan = remoteRestorePlan(before, await f.capture(), ["fixture.txt", "second.txt"]);
    await assert.rejects(() => f.run(plan, { boundary: async (index, phase) => {
      if (index === 0 && phase === "observed") f.settings.readOnlyFolders = ["."];
    } }), /settings changed|boundary|scope|read.only/i);
    assert.equal(await readFile(join(f.workspace, "fixture.txt"), "utf8"), "Generated original peer bytes.\n");
    assert.equal(await readFile(join(f.workspace, "second.txt"), "utf8"), "Generated second post-turn.\n");
    assert.equal(f.executions.get(plan.operationId)!.cleanup, "owned-worker-stopped");
    assert.equal(f.executions.get(plan.operationId)!.status, "partial");
    await assert.rejects(() => lstat(join(f.workspace, ".moguri", "rewinds", plan.operationId, "1.displaced")), { code: "ENOENT" });
  } finally { await f.close(); }
});

test("cancellation before authorization has no Remote effect; cancellation after an observed file stays partial with actual cleanup", { skip: process.platform !== "darwin", timeout: ciTime(40_000) }, async () => {
  const f = await remoteRewindFixture();
  try {
    const before = await f.capture(); await writeFile(join(f.workspace, "fixture.txt"), "Generated bytes before exact stop.\n");
    const first = remoteRestorePlan(before, await f.capture()), stopBefore = new AbortController();
    await assert.rejects(() => f.run(first, { boundary: async (_index, phase) => { if (phase === "moving") stopBefore.abort(new Error("Generated before-effect cancellation.")); } }, stopBefore.signal), /cancel|stop/i);
    assert.equal(await readFile(join(f.workspace, "fixture.txt"), "utf8"), "Generated bytes before exact stop.\n");
    assert.equal(f.executions.get(first.operationId)!.cleanup, "owned-worker-stopped");
    const second = remoteRestorePlan(before, await f.capture()), stopAfter = new AbortController();
    await assert.rejects(() => f.run(second, { boundary: async (_index, phase) => { if (phase === "observed") stopAfter.abort(new Error("Generated after-effect cancellation.")); } }, stopAfter.signal), /cancel|stop/i);
    assert.equal(await readFile(join(f.workspace, "fixture.txt"), "utf8"), "Generated original peer bytes.\n");
    assert.equal(f.executions.get(second.operationId)!.status, "partial");
    assert.equal(f.executions.get(second.operationId)!.cleanup, "owned-worker-stopped");
    assert.equal(await readFile(join(f.workspace, ".moguri", "rewinds", second.operationId, "0.displaced"), "utf8"), "Generated bytes before exact stop.\n");
  } finally { await f.close(); }
});

test("control loss retains the original Remote journal and restart inspection never launches or upgrades partial work", { skip: process.platform !== "darwin", timeout: ciTime(40_000) }, async () => {
  const f = await remoteRewindFixture();
  try {
    const before = await f.capture(); await writeFile(join(f.workspace, "fixture.txt"), "Generated control-loss source.\n");
    const plan = remoteRestorePlan(before, await f.capture());
    await assert.rejects(() => f.run(plan, { boundary: async (_index, phase) => { if (phase === "moving") await f.runtime.close(); } }), /control|closed|original|partial|unconfirmed/i);
    const original = structuredClone(f.executions.get(plan.operationId)!);
    assert.equal(original.cleanup, "unconfirmed");
    assert.equal(await readFile(join(f.workspace, "fixture.txt"), "utf8"), "Generated control-loss source.\n");
    await f.restart();
    const inspected = await inspectRemoteCheckpointRewind(f.runtime, original, plan, f.settings, AbortSignal.timeout(15_000));
    assert.equal(inspected.settled, true); assert.equal(inspected.result, null);
    assert.equal(inspected.execution.status, "unconfirmed"); assert.equal(inspected.execution.cleanup, "owned-worker-stopped");
    assert.equal(original.cleanup, "unconfirmed");
    assert.equal(f.writes.filter((id) => id === plan.operationId).length, 1);
    assert.equal(await readFile(join(f.workspace, "fixture.txt"), "utf8"), "Generated control-loss source.\n");
  } finally { await f.close(); }
});

test("failed controller result retention preserves late Remote results, exact key and backups through restart without replay", { skip: process.platform !== "darwin", timeout: ciTime(40_000) }, async () => {
  const f = await remoteRewindFixture();
  try {
    const before = await f.capture(); await writeFile(join(f.workspace, "fixture.txt"), "Generated original result-failure bytes.\n");
    const plan = remoteRestorePlan(before, await f.capture());
    await assert.rejects(() => f.run(plan, { result: async () => { throw new Error("Generated exact result persistence failure."); } }), /persistence failure/i);
    const original = structuredClone(f.executions.get(plan.operationId)!);
    assert.equal(original.status, "partial"); assert.equal(original.cleanup, "owned-worker-stopped");
    assert.equal((await f.retained(plan.operationId)).some((record) => record.kind === "result"), false);
    const key = f.secrets.get(plan.operationId)!; await f.restart();
    const inspected = await inspectRemoteCheckpointRewind(f.runtime, original, plan, f.settings, AbortSignal.timeout(15_000));
    assert.equal(inspected.settled, true); assert.equal(inspected.result?.verified, true); assert.equal(original.status, "partial");
    assert.equal(await readFile(inspected.result!.files[0]!.backup!, "utf8"), "Generated original result-failure bytes.\n");
    await assert.rejects(() => runRemoteCheckpointRewind(f.runtime, f.scope, plan.operationId, plan, f.settings, AbortSignal.timeout(15_000), {
      intent: () => {}, status: () => {}, boundary: async () => {}, result: async () => {},
    }), /original.*key already exists|no.*replay|already exists/i);
    assert.equal(f.secrets.get(plan.operationId), key); assert.equal(f.writes.filter((id) => id === plan.operationId).length, 1);
    f.secrets.delete(plan.operationId);
    await assert.rejects(() => inspectRemoteCheckpointRewind(f.runtime, original, plan, f.settings, AbortSignal.timeout(15_000)), /key is missing|key.*missing/i);
    assert.equal(f.writes.filter((id) => id === plan.operationId).length, 1);
    f.secrets.set(plan.operationId, key);
    const terminal = inspected.frames.find((frame) => frame.request.kind === "finished")!;
    await unlink(join(f.scope.target.stateDir, plan.operationId, `${String(terminal.sequence).padStart(12, "0")}.bin`));
    await assert.rejects(() => inspectRemoteCheckpointRewind(f.runtime, original, plan, f.settings, AbortSignal.timeout(15_000)), /gap|missing|receipt/i);
  } finally { await f.close(); }
});

test("Remote original receipt inspection pages from zero and observes later external bytes without relabeling historical success", { skip: process.platform !== "darwin", timeout: ciTime(120_000) }, async () => {
  const f = await remoteRewindFixture();
  try {
    const paths = Array.from({ length: 65 }, (_, index) => `paged-${String(index).padStart(3, "0")}.txt`);
    for (const path of paths) await writeFile(join(f.workspace, path), `Generated checkpoint ${path}.\n`);
    const before = await f.capture();
    for (const path of paths) await writeFile(join(f.workspace, path), `Generated changed ${path}.\n`);
    const plan = remoteRestorePlan(before, await f.capture(), paths), result = await f.run(plan, {}, AbortSignal.timeout(90_000));
    await f.restart();
    await writeFile(join(f.workspace, paths[0]!), "Generated later external destination edit.\n");
    await appendFile(result.result.files[0]!.backup!, "Generated later external backup edit.\n");
    const inspection = await inspectRemoteCheckpointRewind(f.runtime, result.execution, plan, f.settings, AbortSignal.timeout(30_000));
    assert.equal(inspection.settled, true); assert.ok(inspection.frames.length > 128);
    assert.deepEqual(inspection.result, result.result); assert.equal(inspection.effects[0]!.currentMatchesResult, false);
    assert.equal(inspection.effects[0]!.backupMatchesOriginal, false);
    assert.equal(inspection.effects[1]!.currentMatchesResult, true);
    assert.equal(await readFile(join(f.workspace, paths[0]!), "utf8"), "Generated later external destination edit.\n");
    assert.equal(f.writes.filter((id) => id === plan.operationId).length, 1);
  } finally { await f.close(); }
});

test("actual control-plane SIGKILL preserves the original model-free Remote effect, durable key and read-only no-replay recovery", { skip: process.platform !== "darwin", timeout: ciTime(40_000) }, async () => {
  const f = await remoteRewindFixture();
  let child: ReturnType<typeof fork> | undefined, exited: Promise<void> | undefined, inspector: RemoteRuntime | undefined;
  try {
    const before = await f.capture(); await writeFile(join(f.workspace, "fixture.txt"), "Generated pre-SIGKILL displaced bytes.\n");
    const plan = remoteRestorePlan(before, await f.capture()), inputPath = join(f.controllerRoot, "generated-child-input.json");
    const vaultPath = join(f.controllerRoot, "generated-child-vault.json"), receiptsPath = join(f.controllerRoot, "generated-child-receipts.jsonl");
    await writeFile(inputPath, JSON.stringify({ stateDir: f.controllerRoot, target: f.ssh.target, workerPath: f.workerPath, vaultPath, receiptsPath,
      scope: f.scope, plan, settings: f.settings }), { mode: 0o600 });
    child = fork(resolve("tests/fixtures/remote-rewind-controller.ts"), [inputPath], { execPath: process.execPath, execArgv: ["--import", "tsx"],
      stdio: ["ignore", "ignore", "pipe", "ipc"], env: { PATH: process.env.PATH, HOME: f.controllerRoot } });
    child.stderr?.resume(); exited = new Promise<void>((resolve) => child!.once("exit", () => resolve()));
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const retained = new Promise<void>((resolve, reject) => {
      deadline = setTimeout(() => reject(new Error("Generated crash controller did not reach its bounded actual effect.")), 15_000);
      child!.once("error", reject);
      child!.once("exit", () => reject(new Error("Generated crash controller ended before its actual effect was retained.")));
      child!.on("message", (value: unknown) => {
        if (isRecord(value) && value.kind === "effect-retained") resolve();
        else reject(new Error(isRecord(value) && typeof value.message === "string" ? value.message : "Generated child did not reach its actual effect boundary."));
      });
    });
    try { await retained; } finally { clearTimeout(deadline); }
    const keyBefore = await readFile(vaultPath), records = (await readFile(receiptsPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as {
      kind: string; value: { execution?: RemoteExecution };
    });
    const execution = records.filter((record) => record.kind === "status").at(-1)!.value.execution!;
    assert.ok(execution.workerPid); assert.equal(await readFile(join(f.workspace, "fixture.txt"), "utf8"), "Generated original peer bytes.\n");
    child.kill("SIGKILL"); await exited;
    inspector = new RemoteRuntime(f.controllerRoot, () => f.ssh.target, f.workerPath, { vault: new GeneratedFileVault(vaultPath) });
    await inspector.probe();
    const inspection = await inspectRemoteCheckpointRewind(inspector, execution, plan, f.settings, AbortSignal.timeout(15_000));
    assert.equal(inspection.settled, true); assert.equal(inspection.result, null);
    assert.equal(inspection.execution.status, "unconfirmed"); assert.equal(inspection.execution.cleanup, "owned-worker-stopped");
    assert.equal(inspection.effects[0]!.currentMatchesResult, true); assert.equal(inspection.effects[0]!.backupMatchesOriginal, true);
    assert.equal(await readFile(inspection.effects[0]!.backup!.path, "utf8"), "Generated pre-SIGKILL displaced bytes.\n");
    assert.deepEqual(await readFile(vaultPath), keyBefore);
    assert.equal(execution.cleanup, "pending"); assert.equal(execution.status, "running");
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) { child.kill("SIGTERM"); await exited; }
    await inspector?.close(); await f.close();
  }
});

test("Remote peer journal persistence failure never becomes an inferred complete restoration or a releasable missing receipt", { skip: process.platform !== "darwin", timeout: ciTime(40_000) }, async () => {
  const f = await remoteRewindFixture();
  try {
    const before = await f.capture(); await writeFile(join(f.workspace, "fixture.txt"), "Generated source before peer journal failure.\n");
    const plan = remoteRestorePlan(before, await f.capture());
    await assert.rejects(() => f.run(plan, { boundary: async (_index, phase) => {
      if (phase === "observed") await mkdir(join(f.scope.target.stateDir, plan.operationId, "000000000004.bin"), { mode: 0o700 });
    } }), /partial|unconfirmed|frame|cursor|receipt|journal/i);
    const execution = f.executions.get(plan.operationId)!;
    assert.notEqual(execution.status, "completed");
    assert.equal(await readFile(join(f.workspace, "fixture.txt"), "utf8"), "Generated original peer bytes.\n");
    assert.equal(await readFile(join(f.workspace, ".moguri", "rewinds", plan.operationId, "0.displaced"), "utf8"), "Generated source before peer journal failure.\n");
    await assert.rejects(() => inspectRemoteCheckpointRewind(f.runtime, execution, plan, f.settings, AbortSignal.timeout(15_000)), /journal|receipt|regular|private/i);
    assert.equal(f.writes.filter((id) => id === plan.operationId).length, 1);
  } finally { await f.close(); }
});

test("ordinary model/role worker starts cannot acquire Remote rewind authority, and duplicate active owner admission cannot replace its key", { skip: process.platform !== "darwin", timeout: ciTime(30_000) }, async () => {
  const f = await remoteRewindFixture();
  try {
    const before = await f.capture(); await writeFile(join(f.workspace, "fixture.txt"), "Generated unchanged concurrent owner bytes.\n");
    const plan = remoteRestorePlan(before, await f.capture()), gate = Promise.withResolvers<void>();
    let held = false;
    const pending = f.run(plan, { boundary: async (_index, phase) => { if (phase === "moving") { held = true; await gate.promise; } } });
    try {
      await waitForRemote(() => held);
      const original = f.executions.get(plan.operationId)!, key = f.secrets.get(plan.operationId);
      assert.throws(() => f.runtime.launch(original, () => {}, true), /already launching|original.*owned/i);
      assert.equal(f.secrets.get(plan.operationId), key); assert.equal(f.writes.filter((id) => id === plan.operationId).length, 1);
      const saved = await f.runtime.inspectCandidate(original, 0, AbortSignal.timeout(15_000));
      const intent = saved.frames.find((frame) => frame.request.kind === "workspace.rewind.intent")!.request;
      assert.equal(intent.kind, "workspace.rewind.intent");
      if (intent.kind !== "workspace.rewind.intent") throw new Error("Missing generated operation intent.");
      const start: WorkerStart = { kind: "start", root: f.workspace, env: "Remote", context: [], readOnly: false, operation: intent.operation };
      assert.throws(() => parentMessage({ ...start, env: "Local" }), /Invalid owned user operation/i);
      assert.throws(() => parentMessage({ ...start, readOnly: true }), /Invalid owned user operation/i);
      assert.throws(() => parentMessage({ ...start, context: [{ role: "user", content: "Generated model cannot authorize a restore.", timestamp: 0 }] }), /Invalid owned user operation/i);
      assert.throws(() => parentMessage({ ...start, chatTitles: true }), /naming.*user operation/i);
      assert.throws(() => parentMessage({ ...start, ownedModelCalls: true }), /subcalls.*user operation/i);
    } finally { gate.resolve(); }
    await pending;
  } finally { await f.close(); }
});
