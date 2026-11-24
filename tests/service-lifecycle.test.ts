import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import { chmod, lstat, mkdir, mkdtemp, readFile, rename, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { ensureConnection, readConnection, restartMoguriService, stopMoguriService } from "../packages/sdk/src/node.ts";
import { MoguriSdk, PROTOCOL_VERSION, type Connection } from "../packages/sdk/src/index.ts";
import { startService } from "../apps/service/src/server.ts";
import { processMayExist } from "../packages/client/src/state-location.ts";
import { setupFixture, waitFor } from "./fixture.ts";
import { ciTime } from "./fixtures/time-scale.ts";

async function lifecycleFixture(options: {
  health?: (connection: Connection, directory: string) => Promise<void>;
  request?: (response: ServerResponse, connection: Connection, directory: string) => Promise<void>;
} = {}) {
  const directory = await mkdtemp(join(tmpdir(), "moguri-generated-lifecycle-"));
  const actions: string[] = [];
  let connection: Connection;
  const server = createServer((request, response) => {
    void (async () => {
      assert.equal(request.headers.authorization, `Bearer ${connection.token}`);
      if (request.url === "/v1/health") {
        await options.health?.(connection, directory);
        response.end(JSON.stringify({ protocolVersion: PROTOCOL_VERSION, pid: process.pid })); return;
      }
      assert.equal(request.url, "/v1/lifecycle");
      let body = ""; for await (const chunk of request) body += String(chunk);
      actions.push(JSON.parse(body).action);
      if (options.request) await options.request(response, connection, directory);
      else response.end(JSON.stringify({ accepted: false, pid: process.pid }));
    })().catch((error: unknown) => { response.writeHead(500).end(error instanceof Error ? error.message : "Generated lifecycle fixture failure."); });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  connection = { protocolVersion: PROTOCOL_VERSION, pid: process.pid, token: "generated-lifecycle-token",
    baseUrl: `http://127.0.0.1:${address.port}`, wsUrl: `ws://127.0.0.1:${address.port}/v1/events` };
  await writeFile(join(directory, "connection.json"), JSON.stringify(connection), { mode: 0o600 });
  await writeFile(join(directory, "service.lock"), JSON.stringify({ pid: process.pid }), { mode: 0o600 });
  return { directory, connection, actions, close: async () => {
    server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  } };
}

test("the built package uses its exact dist service entrypoint for cold and already-stopped restarts", { timeout: ciTime(60_000) }, async () => {
  const result = await promisify(execFile)(process.execPath, [resolve("tests/fixtures/installed-service-recovery.mjs"), resolve(".")], { timeout: ciTime(55_000) });
  assert.match(result.stdout, /exact service entrypoint passed/);
});

test("stopping an absent service is idempotent and does not create or erase state", async () => {
  const directory = await mkdtemp(join(tmpdir(), "moguri-generated-absent-service-"));
  try {
    const absent = join(directory, "never-started");
    await stopMoguriService(absent);
    await assert.rejects(() => lstat(absent), { code: "ENOENT" });
    const stateDir = join(directory, "retained-state"); await mkdir(stateDir);
    const retained = join(stateDir, "generated-retained-input");
    await writeFile(retained, "Generated saved work must survive an already-stopped service.\n");
    await stopMoguriService(stateDir, { preserveTerminals: true });
    assert.equal(await readFile(retained, "utf8"), "Generated saved work must survive an already-stopped service.\n");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("a missing registry with a retained writer lock is unconfirmed, not an already-stopped service", async () => {
  const directory = await mkdtemp(join(tmpdir(), "moguri-generated-missing-registry-"));
  const path = join(directory, "service.lock"), original = JSON.stringify({ pid: process.pid });
  try {
    await writeFile(path, original, { mode: 0o600 });
    await assert.rejects(() => stopMoguriService(directory, { preserveTerminals: true }), /registry.*missing.*writer lock|writer lock.*unconfirmed/i);
    assert.equal(await readFile(path, "utf8"), original);
    await assert.rejects(() => lstat(join(directory, "service.log")), { code: "ENOENT" });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("a healthy authenticated service with missing registry is never replaced or stopped through its PID", async () => {
  const fixture = await setupFixture(), stateDir = join(fixture.directory, "state"), original = join(stateDir, "generated-original-connection");
  try {
    await rename(join(stateDir, "connection.json"), original);
    await assert.rejects(() => stopMoguriService(stateDir, { expectedConnection: fixture.service.connection }), /writer lock.*unconfirmed/i);
    const response = await fetch(`${fixture.service.connection.baseUrl}/v1/health`, { headers: { Authorization: `Bearer ${fixture.service.connection.token}` } });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).lifecycle, null);
    await assert.rejects(() => lstat(join(stateDir, "service.log")), { code: "ENOENT" });
  } finally { await rename(original, join(stateDir, "connection.json")); await fixture.close(); }
});

test("an owned service can finish acknowledged shutdown when its registry disappears during cleanup", async (t) => {
  const fixture = await setupFixture(), stateDir = join(fixture.directory, "state");
  const original = fixture.service.profiles.close.bind(fixture.service.profiles);
  let removed = false;
  t.mock.method(fixture.service.profiles, "close", async (...args: Parameters<typeof original>) => {
    if (!removed) { await unlink(join(stateDir, "connection.json")); removed = true; }
    return original(...args);
  });
  try {
    await stopMoguriService(stateDir, { preserveTerminals: true });
    await assert.rejects(() => lstat(join(stateDir, "service.lock")), { code: "ENOENT" });
    assert.equal(fixture.service.store.db.isOpen, false);
  } finally { t.mock.restoreAll(); await fixture.close(); }
});

test("accepted shutdown synchronously fences owned admission before any private metadata I/O can release a pending open", async (t) => {
  const fixture = await setupFixture(), close = fixture.service.profiles.close.bind(fixture.service.profiles);
  let fenced = false;
  t.mock.method(fixture.service.profiles, "close", (...args: Parameters<typeof close>) => { fenced = true; return close(...args); });
  try {
    const closing = fixture.service.close();
    assert.equal(fenced, true);
    await closing;
  } finally { t.mock.restoreAll(); await fixture.close(); }
});

test("service discovery never reports an accepted but unconfirmed lifecycle operation as ready", async (t) => {
  const fixture = await setupFixture(), stateDir = join(fixture.directory, "state");
  const original = fixture.service.profiles.close.bind(fixture.service.profiles);
  t.mock.method(fixture.service.profiles, "close", async () => { throw new Error("Generated owned cleanup is unconfirmed."); });
  try {
    await assert.rejects(() => stopMoguriService(stateDir, { preserveTerminals: true }), /shutdown is unconfirmed/);
    await assert.rejects(() => ensureConnection({ stateDir }), /unconfirmed|shutting down|stopping/);
    await lstat(join(stateDir, "connection.json")); await lstat(join(stateDir, "service.lock"));
  } finally { t.mock.restoreAll(); await original({ preserveTerminals: true }); await fixture.service.close({ preserveTerminals: true }); await fixture.close(); }
});

test("a broken selected installation cannot interrupt a healthy authenticated service", async () => {
  const fixture = await lifecycleFixture();
  try {
    await assert.rejects(() => restartMoguriService({ stateDir: fixture.directory, servicePath: join(fixture.directory, "missing-service.mjs") }), /installation.*missing.*Reinstall/);
    assert.equal(fixture.actions.length, 0);
    assert.equal((await ensureConnection({ stateDir: fixture.directory })).pid, fixture.connection.pid);
    await assert.rejects(() => lstat(join(fixture.directory, "service.log")), { code: "ENOENT" });
  } finally { await fixture.close(); }
});

test("a private connection replaced while health is authenticating cannot receive lifecycle approval", async () => {
  const fixture = await lifecycleFixture({ health: async (connection, directory) => {
    await writeFile(join(directory, "connection.json"), JSON.stringify({ ...connection, token: "generated-different-lifecycle-owner" }), { mode: 0o600 });
  } });
  try {
    await assert.rejects(() => stopMoguriService(fixture.directory), /connection changed.*different owner/);
    assert.equal(fixture.actions.length, 0);
    assert.match(await readFile(join(fixture.directory, "connection.json"), "utf8"), /generated-different-lifecycle-owner/);
  } finally { await fixture.close(); }
});

test("a lost lifecycle acknowledgement never becomes successful restart readiness or another launch", async () => {
  const fixture = await lifecycleFixture({ request: async (response) => { response.destroy(); } });
  try {
    const before = await readFile(join(fixture.directory, "connection.json"), "utf8");
    await assert.rejects(() => restartMoguriService({ stateDir: fixture.directory }), /did not confirm acceptance.*may already be stopping/);
    assert.deepEqual(fixture.actions, ["restart"]);
    assert.equal(await readFile(join(fixture.directory, "connection.json"), "utf8"), before);
    await lstat(join(fixture.directory, "service.lock"));
    await assert.rejects(() => lstat(join(fixture.directory, "service.log")), { code: "ENOENT" });
  } finally { await fixture.close(); }
});

test("a rejected lifecycle acknowledgement preserves the exact owner and does not start a successor", async () => {
  const fixture = await lifecycleFixture();
  try {
    await assert.rejects(() => restartMoguriService({ stateDir: fixture.directory }), /did not accept its exact lifecycle request/);
    assert.deepEqual(fixture.actions, ["restart"]);
    await lstat(join(fixture.directory, "connection.json")); await lstat(join(fixture.directory, "service.lock"));
    await assert.rejects(() => lstat(join(fixture.directory, "service.log")), { code: "ENOENT" });
  } finally { await fixture.close(); }
});

test("owned cleanup preserves replaced connection and lock files and can retry only its restored originals", async () => {
  for (const name of ["connection.json", "service.lock"]) {
    const fixture = await setupFixture(), stateDir = join(fixture.directory, "state"), path = join(stateDir, name), original = join(stateDir, `generated-original-${name}`);
    try {
      await rename(path, original);
      const replacement = name === "connection.json" ? JSON.stringify({ ...fixture.service.connection, token: "generated-replacement-service" }) : JSON.stringify({ pid: process.pid, replacement: true });
      await writeFile(path, replacement, { mode: 0o600 });
      await assert.rejects(() => fixture.service.close({ preserveTerminals: true }), /no longer belongs.*Cleanup is unconfirmed/);
      assert.equal(await readFile(path, "utf8"), replacement);
      assert.equal(fixture.service.store.db.isOpen, true);
      await assert.rejects(() => fixture.service.close(), { code: "lifecycle_conflict" });
      await unlink(path); await rename(original, path);
      await fixture.service.close({ preserveTerminals: true });
    } finally {
      try { await lstat(original); await rm(path, { force: true }); await rename(original, path); }
      catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
      await fixture.service.close({ preserveTerminals: true });
      await fixture.close();
    }
  }
});

test("an initializing private writer is awaited without launching another service", async (t) => {
  const fixture = await setupFixture(), stateDir = join(fixture.directory, "state");
  let restarted: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    await fixture.service.close();
    const refresh = fixture.provider.refresh.bind(fixture.provider);
    let preparing = false;
    t.mock.method(fixture.provider, "refresh", async () => { preparing = true; await new Promise((resolve) => setTimeout(resolve, 200)); await refresh(); });
    const starting = startService({ stateDir, provider: fixture.provider, retentionKey: fixture.retentionKey });
    await waitFor(() => preparing);
    const discovering = ensureConnection({ stateDir, servicePath: resolve("tests/fixtures/startup-failure.mjs") });
    restarted = await starting;
    assert.deepEqual(await discovering, restarted.connection);
    await assert.rejects(() => lstat(join(stateDir, "service.log")), { code: "ENOENT" });
  } finally { t.mock.restoreAll(); await restarted?.close(); await fixture.close(); }
});

test("a writer lock between its exclusive claim and recorded PID is awaited, not reported as a missing owner", async () => {
  const fixture = await setupFixture(), stateDir = join(fixture.directory, "state");
  let restarted: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    const original = fixture.service.connection;
    await fixture.service.close();
    const deadPid = Number(execFileSync(process.execPath, ["-e", "console.log(process.pid)"], { encoding: "utf8" }).trim());
    await writeFile(join(stateDir, "connection.json"), JSON.stringify({ ...original, pid: deadPid }), { mode: 0o600 });
    await writeFile(join(stateDir, "service.lock"), "", { mode: 0o600 });
    const discovering = ensureConnection({ stateDir, servicePath: resolve("tests/fixtures/startup-failure.mjs") });
    let settled = false;
    void discovering.then(() => { settled = true; }, () => { settled = true; });
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(settled, false, "An incomplete writer claim must be awaited.");
    await unlink(join(stateDir, "service.lock"));
    restarted = await startService({ stateDir, provider: fixture.provider, retentionKey: fixture.retentionKey });
    assert.deepEqual(await discovering, restarted.connection);
    await assert.rejects(() => lstat(join(stateDir, "service.log")), { code: "ENOENT" });
  } finally { await restarted?.close(); await fixture.close(); }
});

test("a stale-lock recovery claim between its exclusive creation and recorded PID is awaited, not reported as interrupted", async () => {
  const fixture = await setupFixture(), stateDir = join(fixture.directory, "state"), recoveryPath = join(stateDir, "service.lock.recovery");
  let restarted: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    const original = fixture.service.connection;
    await fixture.service.close();
    const deadPid = Number(execFileSync(process.execPath, ["-e", "console.log(process.pid)"], { encoding: "utf8" }).trim());
    await writeFile(join(stateDir, "connection.json"), JSON.stringify({ ...original, pid: deadPid }), { mode: 0o600 });
    await writeFile(join(stateDir, "service.lock"), JSON.stringify({ pid: deadPid }), { mode: 0o600 });
    await writeFile(recoveryPath, "", { mode: 0o600 });
    const discovering = ensureConnection({ stateDir, servicePath: resolve("tests/fixtures/startup-failure.mjs") });
    let settled = false;
    void discovering.then(() => { settled = true; }, () => { settled = true; });
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(settled, false, "An incomplete recovery claim must be awaited.");
    // Finish the recovery as its live owner would: record the claim, replace the stale lock, then start.
    await writeFile(recoveryPath, JSON.stringify({ pid: process.pid, token: "generated-live-recovery" }), { mode: 0o600 });
    await unlink(join(stateDir, "service.lock"));
    restarted = await startService({ stateDir, provider: fixture.provider, retentionKey: fixture.retentionKey });
    assert.deepEqual(await discovering, restarted.connection);
    await assert.rejects(() => lstat(join(stateDir, "service.log")), { code: "ENOENT" });
  } finally { await rm(recoveryPath, { force: true }); await restarted?.close(); await fixture.close(); }
});

test("concurrent stale-lock startup clients publish only one recovered writer", { timeout: ciTime(20_000) }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "moguri-generated-stale-startup-race-"));
  const deadPid = Number(execFileSync(process.execPath, ["-e", "console.log(process.pid)"], { encoding: "utf8" }).trim());
  let connection: Connection | undefined, failed = false;
  try {
    await writeFile(join(directory, "service.lock"), JSON.stringify({ pid: deadPid }), { mode: 0o600 });
    const connections = await Promise.all(Array.from({ length: 8 }, () => ensureConnection({ stateDir: directory, servicePath: resolve("tests/fixtures/startup-service.ts") })));
    connection = connections[0]!;
    for (const current of connections) assert.deepEqual(current, connection);
    const owners = (await readFile(join(directory, "generated-startup-owners.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line) as { pid: number });
    assert.deepEqual(owners, [{ pid: connection.pid }]);
    await assert.rejects(() => lstat(join(directory, "service.lock.recovery")), { code: "ENOENT" });
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    try {
      connection ??= await readConnection(directory);
      await stopMoguriService(directory, { expectedConnection: connection });
    } catch (cleanup) {
      // A cleanup failure must not replace the assertion that explains the race.
      if (!failed) throw cleanup;
      console.error("Generated stale-lock cleanup also failed:", cleanup);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
});

test("a startup launch that reaches the writer lock after its adopted owner stopped exits without becoming the service", { timeout: ciTime(90_000) }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "moguri-generated-late-launch-"));
  const gatedPid = join(directory, "generated-startup-gated.pid");
  try {
    const slow = ensureConnection({ stateDir: directory, servicePath: resolve("tests/fixtures/gated-startup-service.ts") });
    await waitFor(() => existsSync(gatedPid));
    const late = Number(await readFile(gatedPid, "utf8"));
    const connection = await ensureConnection({ stateDir: directory, servicePath: resolve("tests/fixtures/startup-service.ts") });
    assert.deepEqual(await slow, connection);
    await stopMoguriService(directory, { expectedConnection: connection });
    await writeFile(join(directory, "generated-startup-gate"), "", { mode: 0o600 });
    await waitFor(() => !processMayExist(late), 60_000);
    const owners = (await readFile(join(directory, "generated-startup-owners.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line) as { pid: number });
    assert.deepEqual(owners, [{ pid: connection.pid }]);
    for (const name of ["service.lock", "service.lock.recovery", "connection.json"]) await assert.rejects(() => lstat(join(directory, name)), { code: "ENOENT" });
    assert.match(await readFile(join(directory, "service.log"), "utf8"), /launch was requested for an earlier startup state/);
  } finally {
    try { await stopMoguriService(directory); } finally { await rm(directory, { recursive: true, force: true }); }
  }
});

test("a retained interrupted recovery claim is not permission to remove another writer lock", async () => {
  const fixture = await setupFixture(), stateDir = join(fixture.directory, "state");
  try {
    await fixture.service.close();
    const deadPid = Number(execFileSync(process.execPath, ["-e", "console.log(process.pid)"], { encoding: "utf8" }).trim());
    const lock = JSON.stringify({ pid: deadPid }), claim = JSON.stringify({ pid: deadPid, token: "generated-unconfirmed-recovery" });
    await writeFile(join(stateDir, "service.lock"), lock, { mode: 0o600 });
    await writeFile(join(stateDir, "service.lock.recovery"), claim, { mode: 0o600 });
    await assert.rejects(() => startService({ stateDir, provider: fixture.provider, retentionKey: fixture.retentionKey }), /interrupted service-lock recovery remains/);
    assert.equal(await readFile(join(stateDir, "service.lock"), "utf8"), lock);
    assert.equal(await readFile(join(stateDir, "service.lock.recovery"), "utf8"), claim);
    await assert.rejects(() => ensureConnection({ stateDir }), /recovery remains unconfirmed/);
    await assert.rejects(() => stopMoguriService(stateDir, { preserveTerminals: true }), /writer lock or recovery claim remains/);
    assert.equal(fixture.requests.length, 0);
  } finally { await fixture.close(); }
});

test("an early-exited child retaining its own lock reports cleanup unconfirmed promptly without erasing it or retrying", { timeout: ciTime(10_000) }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "moguri-generated-exited-owner-"));
  try {
    const began = performance.now();
    await assert.rejects(() => ensureConnection({ stateDir: directory, servicePath: resolve("tests/fixtures/startup-lock-failure.mjs") }), /exited with code 17.*writer lock remains.*unconfirmed/);
    assert.ok(performance.now() - began < 5000);
    const lock = await readFile(join(directory, "service.lock"), "utf8");
    assert.ok(JSON.parse(lock).pid > 1);
    assert.equal((await readFile(join(directory, "service.log"), "utf8")).match(/Generated startup failed/g)?.length, 1);
    await assert.rejects(() => stopMoguriService(directory, { preserveTerminals: true }), /writer lock or recovery claim remains/);
    assert.equal(await readFile(join(directory, "service.lock"), "utf8"), lock);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("corrupt, non-private and symlinked connection metadata cannot become permission to launch or stop another owner", async () => {
  for (const kind of ["json", "permissions", "symlink"] as const) {
    const fixture = await setupFixture(), stateDir = join(fixture.directory, "state"), path = join(stateDir, "connection.json");
    const original = join(stateDir, "generated-private-original");
    try {
      await rename(path, original);
      if (kind === "symlink") await symlink(original, path);
      else await writeFile(path, kind === "json" ? "{invalid generated JSON" : await readFile(original, "utf8"), { mode: kind === "permissions" ? 0o644 : 0o600 });
      await assert.rejects(() => ensureConnection({ stateDir }));
      await assert.rejects(() => stopMoguriService(stateDir, { preserveTerminals: true }));
      await assert.rejects(() => lstat(join(stateDir, "service.log")), { code: "ENOENT" });
      assert.equal((await fetch(`${fixture.service.connection.baseUrl}/v1/health`, { headers: { Authorization: `Bearer ${fixture.service.connection.token}` } })).status, 200);
    } finally { await unlink(path); await chmod(original, 0o600); await rename(original, path); await fixture.close(); }
  }
});

test("intentional restart retains original drafts, held work, artifacts, receipts and unknown charges without replay", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture(), stateDir = join(fixture.directory, "state");
  let sdk: MoguriSdk | undefined = await new MoguriSdk(fixture.service.connection).ready(), restarted: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    await fixture.configure(); await fixture.send("generated slow work before intentional service restart");
    await waitFor(() => fixture.requests.length === 1);
    await fixture.send("Generated undispatched queue must remain retained.");
    await sdk.command({ type: "draft.save", sessionId: fixture.sessionId, expectedRevision: fixture.session().draft.revision, text: "Generated retained restart draft.", attachments: [] }, "generated-restart-draft-receipt");
    const artifact = await sdk.artifacts.create(fixture.sessionId, { kind: "research-note", name: "Generated restart artifact", text: "Generated independent restart artifact." });
    const queued = fixture.session().queue[0]!, entry = fixture.service.controller.snapshot().budgetEntries[0]!;
    assert.ok(entry.reservedTokens !== null && entry.reservedTokens > 0);
    sdk.disconnect(); sdk = undefined;
    await stopMoguriService(stateDir, { preserveTerminals: true });
    restarted = await startService({ stateDir, provider: fixture.provider, retentionKey: fixture.retentionKey, platform: { terminal: { vault: fixture.terminalVault } } });
    sdk = await new MoguriSdk(restarted.connection).ready();
    const session = sdk.sessions.get(fixture.sessionId)!, retained = sdk.getState().snapshot!.budgetEntries.find((item) => item.id === entry.id)!;
    assert.equal(session.draft.text, "Generated retained restart draft.");
    assert.equal(session.queue[0]?.id, queued.id); assert.equal(session.queue[0]?.held, true);
    assert.notEqual(session.status, "completed");
    assert.equal(retained.status, "unknown"); assert.equal(retained.reservedTokens, entry.reservedTokens);
    assert.equal(retained.reportedTokens, null);
    assert.equal((await sdk.budgets.dashboard()).totals.billedUsd, null);
    assert.equal((await sdk.artifacts.read(artifact.id!)).text, "Generated independent restart artifact.");
    assert.ok(restarted.store.db.prepare("SELECT id FROM receipts WHERE id=?").get("generated-restart-draft-receipt"));
    await new Promise((resolve) => setTimeout(resolve, 100)); assert.equal(fixture.requests.length, 1);
  } finally { sdk?.disconnect(); await restarted?.close(); await fixture.close(); }
});
