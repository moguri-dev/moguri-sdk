import assert from "node:assert/strict";
import { fork, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { readFile, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { startService } from "../apps/service/src/server.ts";
import { CommandSchema, isRecord, MoguriSdk, parse } from "../packages/sdk/src/index.ts";
import { fixtureProvider, GENERATED_RETENTION_KEY } from "./fixture.ts";

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
