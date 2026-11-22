import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { cp, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { MoguriSdk, isRecord, PROTOCOL_VERSION, type Connection, type UpdateInstallerIntent } from "../packages/sdk/src/index.ts";
import { waitForUpdateInstallArm } from "../packages/sdk/src/node.ts";
import { readInstallJournal } from "../apps/service/src/update-installation.ts";
import { bundleTreeSha512 } from "../apps/service/src/bundle-tree.ts";
import { startService } from "../apps/service/src/server.ts";
import { generatedApplication } from "./fixtures/updates.ts";
import { performBundleReplacement } from "../apps/service/src/update-installer.ts";

test("the actual pinned helper waits for shutdown, preserves the old bundle and recovers verified new bytes without replay or OS launch", { skip: process.platform !== "darwin", timeout: 30_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "moguri-generated-installer-"));
  let worker: ChildProcess | undefined, desktop: ChildProcess | undefined, sdk: MoguriSdk | undefined, restarted: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    await mkdir(join(directory, "Applications"));
    const old = await generatedApplication(join(directory, "Applications"), "0.30.0-alpha.1"), update = await generatedApplication(join(directory, "release"));
    await writeFile(join(directory, "manifest.json"), update.manifestBytes); await writeFile(join(directory, "release.zip"), update.archive);
    worker = spawn(resolve("node_modules/node/bin/node"), ["--import", "tsx", resolve("tests/fixtures/update-service.mjs"), directory], { stdio: ["ignore", "ignore", "pipe", "ipc"], env: { ...process.env, MOGURI_TEST_WINDOW: "hidden" } });
    let logs = ""; worker.stderr!.on("data", (value: Buffer) => { logs = (logs + value.toString("utf8")).slice(-8192); });
    const connection = await new Promise<Connection>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Generated updater service did not become ready: ${logs}`)), 10_000);
      worker!.once("error", reject); worker!.once("exit", () => reject(new Error(`Generated service exited before readiness: ${logs}`)));
      worker!.on("message", (message: unknown) => {
        if (!isRecord(message) || message.type !== "ready" || !isRecord(message.connection)) return;
        const value = message.connection;
        if (value.protocolVersion !== PROTOCOL_VERSION || typeof value.baseUrl !== "string" || typeof value.wsUrl !== "string" || typeof value.token !== "string" || typeof value.pid !== "number") return;
        clearTimeout(timer); resolve({ protocolVersion: PROTOCOL_VERSION, baseUrl: value.baseUrl, wsUrl: value.wsUrl, token: value.token, pid: value.pid });
      });
    });
    sdk = await new MoguriSdk(connection).ready(); await sdk.application.updates.setToken(`ghp_${"g".repeat(30)}`);
    const started = await sdk.application.updates.check();
    let ready;
    for (let count = 0; count < 100; count++) {
      const value = (await sdk.application.updates.read(started.id!)).update;
      if (value.status === "failed") throw new Error(value.diagnostic!);
      if (value.status === "ready") { ready = value; break; }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.ok(ready);
    const review = (await sdk.application.updates.installPreview(started.id!)).review;
    desktop = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    assert.ok(desktop.pid);
    const accepted = await sdk.application.updates.install(started.id!, review.digest, desktop.pid, true); sdk.disconnect();
    await waitForUpdateInstallArm(accepted.journal, accepted.id, accepted.intentDigest, 10_000);
    assert.equal(await bundleTreeSha512(old.root), old.manifest.bundleSha512);
    const exited = once(desktop, "exit"); desktop.kill("SIGTERM"); await exited;
    let journal;
    for (let count = 0; count < 150; count++) {
      journal = await readInstallJournal(accepted.journal);
      if (journal.state === "partial") throw new Error(`${journal.diagnostic} ${logs}`);
      if (journal.state === "installed" && /suppressed/.test(journal.diagnostic ?? "")) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(journal?.state, "installed"); assert.match(journal!.diagnostic!, /suppressed/);
    assert.equal(await bundleTreeSha512(old.root), update.manifest.bundleSha512);
    assert.equal(await bundleTreeSha512(review.backup), old.manifest.bundleSha512);
    const provider = { state: { status: "disconnected" as const, models: [], login: null, diagnostic: null }, onChange: () => {}, refresh: async () => {}, logout: async () => {}, cancel: async () => {},
      login: () => { throw new Error("No personal login."); }, prepare: async () => { throw new Error("No generated model call."); } };
    restarted = await startService({ stateDir: join(directory, "state"), retentionKey: Buffer.alloc(32, 0x6b), provider,
      updates: { version: update.manifest.version, arch: "arm64", installationRoot: await realpath(old.root), homebrewPrefixes: [], vault: { read: async () => null, write: async () => {}, remove: async () => {} } } });
    sdk = await new MoguriSdk(restarted.connection).ready();
    assert.equal((await sdk.application.updates.read(started.id!)).update.status, "completed");
    await assert.rejects(() => sdk!.application.updates.installPreview(started.id!), /partial|consumed|ready/i);
    assert.equal(JSON.parse(await readFile(join(old.root, "Contents/Resources/app/package.json"), "utf8")).version, update.manifest.version);
  } finally {
    sdk?.disconnect(); await restarted?.close();
    if (desktop?.pid && desktop.exitCode === null && desktop.signalCode === null) { const exited = once(desktop, "exit"); desktop.kill("SIGTERM"); await exited; }
    if (worker?.pid && worker.exitCode === null && worker.signalCode === null) { const exited = once(worker, "exit"); worker.kill("SIGTERM"); await exited; }
    await rm(directory, { recursive: true, force: true });
  }
});

test("interruption after preserving the old app retains exact backup/candidate and never claims a completed replacement", { skip: process.platform !== "darwin" }, async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "moguri-generated-partial-installer-")));
  try {
    await mkdir(join(directory, "Applications"));
    const old = await generatedApplication(join(directory, "Applications"), "0.30.0-alpha.1"), update = await generatedApplication(join(directory, "release")), id = randomUUID();
    const sibling = join(directory, "Applications", `.Moguri-update-${id}`), helper = join(directory, "helper"); await mkdir(sibling, { mode: 0o700 }); await mkdir(helper, { mode: 0o700 });
    const candidate = join(sibling, "Moguri.app"); await cp(update.root, candidate, { recursive: true, dereference: false, verbatimSymlinks: true });
    const intent: UpdateInstallerIntent = { schemaVersion: 1, id, keyId: "generated-store", version: update.manifest.version, arch: "arm64", destination: old.root,
      candidate, backup: join(sibling, "previous.app"), journal: join(helper, "journal.json"), oldBundleSha512: old.manifest.bundleSha512, bundleSha512: update.manifest.bundleSha512,
      servicePid: process.pid, desktopPid: process.pid, runtime: { path: join(helper, "node"), sha512: "a".repeat(128) }, helper: { path: join(helper, "installer.mjs"), sha512: "b".repeat(128) } };
    let launches = 0;
    await assert.rejects(() => performBundleReplacement(intent, "c".repeat(64), { launch: async () => { launches++; }, afterBackup: async () => { throw new Error("Generated interruption after old-bundle rename."); } }), /Generated interruption/);
    assert.equal((await readInstallJournal(intent.journal)).state, "partial");
    assert.equal(await bundleTreeSha512(intent.backup), old.manifest.bundleSha512);
    assert.equal(await bundleTreeSha512(intent.candidate), update.manifest.bundleSha512);
    await assert.rejects(() => lstat(intent.destination), { code: "ENOENT" }); assert.equal(launches, 0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
