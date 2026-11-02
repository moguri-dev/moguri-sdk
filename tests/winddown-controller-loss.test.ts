import assert from "node:assert/strict";
import { fork, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { startService } from "../apps/service/src/server.ts";
import { CommandSchema, isRecord, MoguriSdk, parse } from "../packages/sdk/src/index.ts";
import { fixtureProvider, GENERATED_RETENTION_KEY } from "./fixture.ts";
import { tmpdir } from "node:os";
import { createSshTarget } from "./fixtures/ssh-target.ts";
import { GeneratedFileVault } from "./fixtures/generated-vault.ts";

test("actual checkpoint controller SIGKILL before/after local ref creation retains partial intent and never republishes Git or a paid model", { skip: process.platform !== "darwin", timeout: 30000 }, async () => {
  for (const phase of ["intent", "published"] as const) {
    const child = fork(fileURLToPath(new URL("./fixtures/winddown-child.ts", import.meta.url)), [], { execArgv: ["--import", "tsx"], stdio: ["ignore", "pipe", "pipe", "ipc"] });
    let errors = ""; child.stderr?.on("data", (data) => { errors = (errors + data).slice(-8192); });
    const provider = await fixtureProvider({ responseMode: "text" }); let service: Awaited<ReturnType<typeof startService>> | undefined, sdk: MoguriSdk | undefined, directory: string | undefined;
    try {
      const ready = new Promise<unknown>((resolve, reject) => { child.once("message", resolve); child.once("exit", () => reject(new Error(`Generated checkpoint controller exited before its actual phase: ${errors}`))); child.once("error", reject); });
      child.send({ phase }); const value = await ready;
      assert.ok(isRecord(value) && typeof value.directory === "string" && typeof value.stateDir === "string" && typeof value.project === "string" &&
        typeof value.winddownId === "string" && typeof value.commandId === "string" && typeof value.head === "string" && typeof value.indexDigest === "string" && typeof value.branch === "string" && isRecord(value.command));
      directory = value.directory; assert.ok(basename(directory).startsWith("moguri-generated-"));
      const command = parse(CommandSchema, { id: value.commandId, profileId: "default", command: value.command });
      const exit = once(child, "exit"); child.kill("SIGKILL"); await exit;
      service = await startService({ stateDir: value.stateDir, provider: provider.provider, retentionKey: GENERATED_RETENTION_KEY });
      sdk = await new MoguriSdk(service.connection).ready();
      const result = await sdk.winddown.read(value.winddownId);
      assert.equal(result.winddown.status, "partial"); assert.equal(result.winddown.commit?.publicationAttempted, true);
      assert.ok(result.winddown.commit?.preparedCommit);
      const git = (args: string[]) => execFileSync("git", ["--no-pager", "-c", "core.hooksPath=/dev/null", ...args], { cwd: String(value.project), encoding: "utf8" }).trim();
      const actual = git(["for-each-ref", "--format=%(objectname)", "refs/heads/" + value.branch]);
      assert.equal(actual, phase === "published" ? result.winddown.commit.preparedCommit : "");
      assert.equal(git(["rev-parse", "HEAD"]), value.head);
      assert.equal(createHash("sha256").update(await readFile(join(value.project, ".git/index"))).digest("hex"), value.indexDigest);
      assert.equal(service.controller.snapshot().jobs.find((job) => job.id === result.winddown.commit?.jobId)?.status, "partial");
      assert.equal(service.controller.snapshot().budgetEntries.filter((entry) => entry.role === "checkpoint").length, 1);
      service.store.db.prepare("DELETE FROM receipts WHERE id=?").run(command.id);
      assert.equal((await sdk.command(command.command, command.id)).id, result.winddown.id);
      assert.equal(provider.requests.length, 0); assert.equal(git(["for-each-ref", "--format=%(objectname)", "refs/heads/" + value.branch]), actual);
    } finally {
      sdk?.disconnect(); await service?.close(); await provider.close();
      if (child.exitCode === null && child.signalCode === null) { const exit = once(child, "exit"); child.kill("SIGKILL"); await exit; }
      if (directory) await rm(directory, { recursive: true, force: true });
    }
  }
});

test("actual SSH checkpoint controller SIGKILL preserves the pinned peer publication, independent writer and explicit no-replay inspection", { skip: process.platform !== "darwin", timeout: 45000 }, async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "moguri-generated-peer-loss-"))), workspace = join(root, "peer"), sshRoot = join(root, "ssh");
  await mkdir(workspace); await mkdir(sshRoot); await writeFile(join(workspace, "fixture.txt"), "Generated parent-owned peer source.\n");
  const ssh = await createSshTarget(sshRoot), vaultPath = join(root, "generated-vault.json"), vault = new GeneratedFileVault(vaultPath);
  const child = fork(fileURLToPath(new URL("./fixtures/transport-checkpoint-child.ts", import.meta.url)), [], { execArgv: ["--import", "tsx"], stdio: ["ignore", "pipe", "pipe", "ipc"] });
  let errors = "", directory: string | undefined, service: Awaited<ReturnType<typeof startService>> | undefined, sdk: MoguriSdk | undefined;
  child.stderr?.on("data", (data) => { errors = (errors + data).slice(-8192); });
  const provider = await fixtureProvider({ responseMode: "text" });
  try {
    const ready = new Promise<unknown>((resolve, reject) => { child.once("message", resolve); child.once("exit", () => reject(new Error(`Generated peer checkpoint controller exited before its exact publication phase: ${errors}`))); child.once("error", reject); });
    child.send({ target: ssh.target, workspace, vaultPath }); const value = await ready;
    assert.ok(isRecord(value) && typeof value.directory === "string" && typeof value.stateDir === "string" && typeof value.winddownId === "string" &&
      typeof value.commandId === "string" && typeof value.commit === "string" && typeof value.head === "string" && typeof value.indexDigest === "string" && isRecord(value.command));
    directory = value.directory; assert.ok(basename(directory).startsWith("moguri-generated-"));
    const command = parse(CommandSchema, { id: value.commandId, profileId: "default", command: value.command });
    assert.equal(command.command.type, "winddown.commit"); if (command.command.type !== "winddown.commit") throw new Error("Generated exact Git command changed type.");
    const exit = once(child, "exit"); child.kill("SIGKILL"); await exit;
    service = await startService({ stateDir: value.stateDir, provider: provider.provider, retentionKey: GENERATED_RETENTION_KEY, platform: { remote: { vault, modelsVault: vault } } });
    sdk = await new MoguriSdk(service.connection).ready(); await sdk.remote.probe();
    const partial = await sdk.winddown.read(value.winddownId), git = (args: string[]) => execFileSync("git", ["--no-pager", "-c", "core.hooksPath=/dev/null", ...args], { cwd: workspace, encoding: "utf8" }).trim();
    assert.equal(partial.winddown.status, "partial"); assert.equal(partial.winddown.commit?.publicationAttempted, true);
    assert.equal(partial.winddown.commit?.publishedCommit, null);
    assert.ok(service.controller.ownedWriteRoots().some((root) => root.startsWith("remote/")));
    assert.equal(git(["rev-parse", `refs/heads/${command.command.branch}`]), value.commit); assert.equal(git(["rev-parse", "HEAD"]), value.head);
    assert.equal(createHash("sha256").update(await readFile(join(workspace, ".git/index"))).digest("hex"), value.indexDigest);
    service.store.db.prepare("DELETE FROM receipts WHERE id=?").run(command.id);
    assert.equal((await sdk.command(command.command, command.id)).id, partial.winddown.id);
    const inspection = await sdk.winddown.inspectCommit(value.winddownId);
    assert.equal(inspection.inspection.result?.commit, value.commit); assert.equal(inspection.inspection.review.document.actualCommit, value.commit);
    assert.ok(service.controller.ownedWriteRoots().some((root) => root.startsWith("remote/")));
    await sdk.winddown.reconcileCommit(value.winddownId, inspection.inspection.review.revision, inspection.inspection.review.digest, true);
    assert.equal((await sdk.winddown.read(value.winddownId)).winddown.status, "partial");
    assert.equal(service.controller.snapshot().jobs.find((job) => job.id === partial.winddown.commit?.jobId)?.status, "partial");
    assert.deepEqual(service.controller.ownedWriteRoots(), []);
    assert.equal(service.controller.snapshot().budgetEntries.filter((entry) => entry.role === "checkpoint").length, 1);
    assert.equal(provider.requests.length, 0);
  } finally {
    sdk?.disconnect(); await service?.close(); await provider.close();
    if (child.exitCode === null && child.signalCode === null) { const exit = once(child, "exit"); child.kill("SIGKILL"); await exit; }
    await ssh.close();
    if (directory) await rm(directory, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
});
