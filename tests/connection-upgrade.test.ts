import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import fsPromises from "node:fs/promises";
import { lstat, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { ensureConnection, readConnection, ServiceProtocolMismatch, stopMoguriService } from "../packages/sdk/src/node.ts";
import { defaultNotificationWav, MoguriSdk, PROTOCOL_VERSION } from "../packages/sdk/src/index.ts";
import { setupFixture } from "./fixture.ts";
import { readPrivateServiceFile, ServiceFileChanged, ServiceFileDisappeared } from "../packages/client/src/service-files.ts";
import { ciTime } from "./fixtures/time-scale.ts";

for (const replacement of [false, true]) test(`an original service registry unlinked after open is disappeared${replacement ? " even when another registry replaces it" : ""}, never adopted or deleted`, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "moguri-generated-opened-registry-")), path = join(directory, "connection.json");
  await writeFile(path, "Generated original private registry.\n", { mode: 0o600 });
  const open = fsPromises.open.bind(fsPromises);
  try {
    t.mock.method(fsPromises, "open", async (...args: Parameters<typeof open>) => {
      const handle = await open(...args);
      if (args[0] === path) {
        await unlink(path);
        if (replacement) await writeFile(path, "Generated replacement registry.\n", { mode: 0o600 });
      }
      return handle;
    });
    syncBuiltinESMExports();
    await assert.rejects(() => readPrivateServiceFile(path), ServiceFileDisappeared);
    if (replacement) assert.equal(await readFile(path, "utf8"), "Generated replacement registry.\n");
    else await assert.rejects(() => readFile(path), { code: "ENOENT" });
  } finally { t.mock.restoreAll(); syncBuiltinESMExports(); await rm(directory, { recursive: true, force: true }); }
});

test("a registry whose unlink is still in progress is disappeared, not changed", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "moguri-generated-unlinking-registry-")), path = join(directory, "connection.json");
  await writeFile(path, "Generated registry being removed.\n", { mode: 0o600 });
  const original = fsPromises.lstat.bind(fsPromises);
  try {
    // macOS can still resolve a path mid-unlink to the same inode with no links and a new ctime.
    t.mock.method(fsPromises, "lstat", async (...args: Parameters<typeof original>) => {
      const stats = await original(...args);
      return args[0] === path ? Object.assign(Object.create(Object.getPrototypeOf(stats)), stats, { nlink: 0, ctimeMs: Number(stats.ctimeMs) + 1 }) : stats;
    });
    syncBuiltinESMExports();
    await assert.rejects(() => readPrivateServiceFile(path), ServiceFileDisappeared);
  } finally { t.mock.restoreAll(); syncBuiltinESMExports(); await rm(directory, { recursive: true, force: true }); }
});

test("discovery rereads a writer lock that changed while it was being inspected instead of failing", async (t) => {
  const fixture = await setupFixture(), directory = join(fixture.directory, "state"), lockPath = join(directory, "service.lock");
  const lstat = fsPromises.lstat.bind(fsPromises);
  let rewrites = 0;
  try {
    const lock = await readFile(lockPath, "utf8"), canonical = await fsPromises.realpath(lockPath);
    // Rewrite the same bytes during the first two reads, as an owner finishing its write would.
    t.mock.method(fsPromises, "lstat", async (...args: Parameters<typeof lstat>) => {
      if ((args[0] === lockPath || args[0] === canonical) && rewrites < 2) { rewrites++; await new Promise((resolve) => setTimeout(resolve, 5)); await writeFile(lockPath, lock); }
      return lstat(...args);
    });
    syncBuiltinESMExports();
    await assert.rejects(() => readPrivateServiceFile(lockPath), ServiceFileChanged);
    rewrites = 0;
    assert.deepEqual(await ensureConnection({ stateDir: directory, servicePath: resolve("tests/fixtures/startup-failure.mjs") }), fixture.service.connection);
    assert.equal(rewrites, 2);
  } finally { t.mock.restoreAll(); syncBuiltinESMExports(); await fixture.close(); }
});

test("discovery inspects again when the registry is republished between its two reads instead of failing", async (t) => {
  const fixture = await setupFixture(), directory = join(fixture.directory, "state");
  const connectionPath = await fsPromises.realpath(join(directory, "connection.json")), lockPath = await fsPromises.realpath(join(directory, "service.lock"));
  const open = fsPromises.open.bind(fsPromises), original = await readFile(connectionPath, "utf8");
  let connectionOpens = 0, lockOpens = 0;
  try {
    // Probe reads the registry, the startup review reads the lock and then the registry again. A launch publishing between
    // those reads makes them disagree once; the next inspection sees the settled registry.
    t.mock.method(fsPromises, "open", async (...args: Parameters<typeof open>) => {
      if (args[0] === lockPath && ++lockOpens === 1) await writeFile(connectionPath, JSON.stringify({ ...fixture.service.connection, token: "generated-republished-token" }));
      if (args[0] === connectionPath && ++connectionOpens === 3) await writeFile(connectionPath, original);
      return open(...args);
    });
    syncBuiltinESMExports();
    assert.deepEqual(await ensureConnection({ stateDir: directory, servicePath: resolve("tests/fixtures/startup-failure.mjs") }), fixture.service.connection);
    assert.ok(connectionOpens >= 3);
  } finally {
    t.mock.restoreAll(); syncBuiltinESMExports();
    // The service removes only its own registry bytes on close.
    if (await readFile(connectionPath, "utf8") !== original) await writeFile(connectionPath, original);
    await fixture.close();
  }
});

test("cold service startup authenticates its recovered owner without waiting eleven seconds for unrelated discovery or resetting its retained draft", { timeout: ciTime(25000) }, async () => {
  const fixture = await setupFixture(), directory = join(fixture.directory, "state"), previous = await new MoguriSdk(fixture.service.connection).ready();
  let connection: Awaited<ReturnType<typeof ensureConnection>> | undefined, current: MoguriSdk | undefined;
  try {
    await previous.command({ type: "draft.save", sessionId: fixture.sessionId, expectedRevision: 0, text: "Generated slow-start retained draft.", attachments: [] });
    previous.disconnect(); await fixture.service.close();
    await writeFile(join(directory, "generated-startup-delay.json"), "11000", { mode: 0o600 });
    connection = await ensureConnection({ stateDir: directory, servicePath: resolve("tests/fixtures/startup-service.ts") });
    // Causal rather than a stopwatch: process start alone can take seconds on a loaded runner.
    await assert.rejects(() => lstat(join(directory, "generated-startup-discovered")), { code: "ENOENT" },
      "Original authenticated recovery must not wait for the generated eleven-second provider discovery.");
    current = await new MoguriSdk(connection).ready();
    assert.equal(connection.protocolVersion, PROTOCOL_VERSION);
    assert.equal(current.getState().snapshot!.sessions[0]!.draft.text, "Generated slow-start retained draft.");
    assert.equal(fixture.requests.length, 0);
  } finally {
    previous.disconnect(); current?.disconnect();
    if (!connection) {
      const deadline = performance.now() + ciTime(15000);
      while (performance.now() < deadline) {
        try { connection = await readConnection(directory); break; }
        catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    if (!connection) throw new Error("Generated slow startup did not publish its owned service; its fixture directory was retained for inspection.");
    await stopMoguriService(directory, { expectedConnection: connection }); await fixture.close();
  }
});

test("a service that exits before readiness reports its exact exit and log path promptly without retrying or erasing retained input", { timeout: ciTime(15000) }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "moguri-generated-startup-exit-")), input = join(directory, "generated-retained-input.txt");
  await writeFile(input, "Generated retained startup input.\n", { mode: 0o600 });
  try {
    const began = performance.now();
    await assert.rejects(() => ensureConnection({ stateDir: directory, servicePath: resolve("tests/fixtures/startup-failure.mjs") }),
      (error: unknown) => error instanceof Error && /exited.*17/.test(error.message) && error.message.includes(join(directory, "service.log")));
    assert.ok(performance.now() - began < 5000);
    assert.equal(await readFile(input, "utf8"), "Generated retained startup input.\n");
    const log = await readFile(join(directory, "service.log"), "utf8");
    assert.equal(log.match(/Generated startup failure/g)?.length, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("competing cold-start clients wait for the same authenticated service even when one launch loses the writer lock", { timeout: ciTime(10000) }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "moguri-generated-startup-clients-"));
  let connections: Awaited<ReturnType<typeof ensureConnection>>[] = [];
  try {
    await writeFile(join(directory, "generated-startup-delay.json"), "500", { mode: 0o600 });
    connections = await Promise.all([ensureConnection({ stateDir: directory, servicePath: resolve("tests/fixtures/startup-service.ts") }),
      ensureConnection({ stateDir: directory, servicePath: resolve("tests/fixtures/startup-service.ts") })]);
    assert.deepEqual(connections[0], connections[1]);
  } finally {
    const owner = connections[0] ?? await readConnection(directory);
    await stopMoguriService(directory, { expectedConnection: owner }); await rm(directory, { recursive: true, force: true });
  }
});

test("Finder-style service startup preserves the original PATH and exposes standard macOS tools without forwarding ambient values", { skip: process.platform !== "darwin" }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "moguri-generated-launch-path-"));
  const previousPath = process.env.PATH, previousValue = process.env.MOGURI_GENERATED_UNFORWARDED;
  let connection: Awaited<ReturnType<typeof ensureConnection>> | undefined;
  try {
    process.env.PATH = "/generated/preferred-bin:/usr/bin:/bin:/usr/sbin:/sbin";
    process.env.MOGURI_GENERATED_UNFORWARDED = "generated-not-a-credential";
    connection = await ensureConnection({ stateDir: directory, servicePath: resolve("tests/fixtures/startup-service.ts") });
    assert.deepEqual(JSON.parse(await readFile(join(directory, "generated-startup-environment.json"), "utf8")), {
      preferredPathFirst: true, homebrewAvailable: true, usrLocalAvailable: true, ambientValueForwarded: false,
    });
  } finally {
    if (previousPath === undefined) delete process.env.PATH; else process.env.PATH = previousPath;
    if (previousValue === undefined) delete process.env.MOGURI_GENERATED_UNFORWARDED; else process.env.MOGURI_GENERATED_UNFORWARDED = previousValue;
    if (connection) await stopMoguriService(directory);
    await rm(directory, { recursive: true, force: true });
  }
});

test("a healthy older service is reviewed as an upgrade, not corrupt state, and declining never stops it", async () => {
  const directory = await mkdtemp(join(tmpdir(), "moguri-generated-upgrade-")), token = "generated-private-upgrade-token";
  let healthReads = 0, lifecycleCalls = 0, confirmations = 0;
  const server = createServer((request, response) => {
    assert.equal(request.headers.authorization, `Bearer ${token}`);
    if (request.url === "/v1/health") { healthReads++; response.end(JSON.stringify({ protocolVersion: PROTOCOL_VERSION - 1, pid: process.pid })); }
    else { lifecycleCalls++; response.writeHead(500).end(); }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const original = JSON.stringify({ protocolVersion: PROTOCOL_VERSION - 1, baseUrl: `http://127.0.0.1:${address.port}`, wsUrl: `ws://127.0.0.1:${address.port}/v1/events`, token, pid: process.pid });
  await writeFile(join(directory, "connection.json"), original, { mode: 0o600 });
  try {
    await assert.rejects(() => ensureConnection({ stateDir: directory, confirmUpgrade: async (review: { observedProtocol: number; requiredProtocol: number; pid: number }) => {
      confirmations++;
      assert.equal(review.observedProtocol, PROTOCOL_VERSION - 1); assert.equal(review.requiredProtocol, PROTOCOL_VERSION); assert.equal(review.pid, process.pid);
      assert.equal(JSON.stringify(review).includes(token), false);
      return false;
    } }), /declined|cancelled/i);
    assert.equal(confirmations, 1); assert.ok(healthReads > 0); assert.equal(lifecycleCalls, 0);
    assert.equal(await readFile(join(directory, "connection.json"), "utf8"), original);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); await rm(directory, { recursive: true, force: true }); }
});

test("an unreachable protocol-35 connection and dead writer lock do not block a real current runtime or reset stored history", async () => {
  const fixture = await setupFixture(), directory = join(fixture.directory, "state");
  const original = fixture.service.connection, sdk = await new MoguriSdk(original).ready();
  let successor: Awaited<ReturnType<typeof ensureConnection>> | undefined, current: MoguriSdk | undefined, confirmations = 0;
  try {
    await sdk.command({ type: "draft.save", sessionId: fixture.sessionId, expectedRevision: 0, text: "Generated stale-35 upgrade draft.", attachments: [] });
    sdk.disconnect(); await fixture.service.close();
    const deadPid = Number(execFileSync(process.execPath, ["-e", "console.log(process.pid)"], { encoding: "utf8" }).trim());
    await writeFile(join(directory, "connection.json"), JSON.stringify({ ...original, protocolVersion: 35, pid: deadPid }), { mode: 0o600 });
    await writeFile(join(directory, "service.lock"), JSON.stringify({ pid: deadPid }), { mode: 0o600 });
    successor = await ensureConnection({ stateDir: directory, servicePath: resolve("tests/fixtures/startup-service.ts"),
      confirmUpgrade: async () => { confirmations++; throw new Error("No healthy service exists to approve or stop."); } });
    current = await new MoguriSdk(successor).ready();
    assert.equal(confirmations, 0); assert.equal(successor.protocolVersion, PROTOCOL_VERSION);
    assert.equal(current.getState().snapshot!.sessions[0]!.draft.text, "Generated stale-35 upgrade draft.");
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); current?.disconnect(); if (successor) await stopMoguriService(directory); await fixture.close(); }
});

test("an approved authenticated old-service restart starts the actual new runtime without deleting retained drafts or independent grants", async () => {
  const fixture = await setupFixture(), directory = join(fixture.directory, "state"), sdk = await new MoguriSdk(fixture.service.connection).ready();
  let current: MoguriSdk | undefined, successor: Awaited<ReturnType<typeof ensureConnection>> | undefined, restarts = 0;
  const closed = Promise.withResolvers<void>();
  void closed.promise.catch((error: unknown) => console.error("Generated old-service cleanup failed:", error instanceof Error ? error.message : "inspect generated registry/lock"));
  const server = createServer((request, response) => {
    assert.equal(request.headers.authorization, `Bearer ${fixture.service.connection.token}`);
    if (request.url === "/v1/health") { response.end(JSON.stringify({ pid: process.pid, protocolVersion: PROTOCOL_VERSION - 1 })); return; }
    if (request.url !== "/v1/lifecycle" || request.method !== "POST") { response.writeHead(404).end(); return; }
    void (async () => {
      let body = ""; for await (const chunk of request) body += String(chunk);
      assert.deepEqual(JSON.parse(body), { action: "restart" }); restarts++;
      response.once("finish", () => {
        void (async () => {
          await unlink(join(directory, "connection.json")); await unlink(join(directory, "service.lock"));
          server.closeAllConnections();
          await new Promise<void>((resolve) => server.close(() => resolve()));
        })().then(() => closed.resolve(), closed.reject);
      });
      response.end(JSON.stringify({ accepted: true, pid: process.pid }));
    })().catch((error: unknown) => { response.writeHead(500).end(error instanceof Error ? error.message : "Generated lifecycle failure"); });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  try {
    await sdk.command({ type: "draft.save", sessionId: fixture.sessionId, expectedRevision: 0, text: "Generated retained upgrade draft.", attachments: [] });
    const sound = await sdk.notifications.importSound("Generated upgrade sound", defaultNotificationWav("completed"));
    const keyId = fixture.service.store.db.prepare("SELECT value FROM retention_metadata WHERE id='key_id'").get()?.value;
    sdk.disconnect(); await fixture.service.close({ preserveTerminals: true });
    await writeFile(join(directory, "service.lock"), JSON.stringify({ pid: process.pid }), { mode: 0o600 });
    await writeFile(join(directory, "connection.json"), JSON.stringify({ ...fixture.service.connection, protocolVersion: PROTOCOL_VERSION - 1,
      baseUrl: `http://127.0.0.1:${address.port}`, wsUrl: `ws://127.0.0.1:${address.port}/v1/events` }), { mode: 0o600 });
    successor = await ensureConnection({ stateDir: directory, servicePath: resolve("tests/fixtures/startup-service.ts"), confirmUpgrade: async () => true });
    assert.equal(successor.protocolVersion, PROTOCOL_VERSION); assert.notEqual(successor.pid, process.pid); assert.equal(restarts, 1);
    current = await new MoguriSdk(successor).ready();
    assert.equal(current.getState().snapshot!.sessions[0]!.draft.text, "Generated retained upgrade draft.");
    assert.equal((await current.notifications.sound(sound.id!)).sound.name, "Generated upgrade sound");
    assert.equal(JSON.parse(await readFile(join(directory, "connection.json"), "utf8")).pid, successor.pid);
    assert.ok(keyId); assert.equal(fixture.requests.length, 0);
    await closed.promise;
  } finally {
    sdk.disconnect(); current?.disconnect();
    if (successor) await stopMoguriService(directory);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fixture.close();
  }
});

test("newer or unauthenticated service identities never become an upgrade approval or a stop", async () => {
  for (const mode of ["newer", "identity"] as const) {
    const directory = await mkdtemp(join(tmpdir(), "moguri-generated-upgrade-")); let confirmations = 0, stops = 0;
    const server = createServer((request, response) => {
      if (request.url === "/v1/health") response.end(JSON.stringify({ protocolVersion: mode === "newer" ? PROTOCOL_VERSION + 1 : PROTOCOL_VERSION - 1, pid: mode === "identity" ? process.pid + 1 : process.pid }));
      else { stops++; response.writeHead(500).end(); }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address(); assert.ok(address && typeof address !== "string");
    await writeFile(join(directory, "connection.json"), JSON.stringify({ protocolVersion: mode === "newer" ? PROTOCOL_VERSION + 1 : PROTOCOL_VERSION - 1,
      baseUrl: `http://127.0.0.1:${address.port}`, wsUrl: `ws://127.0.0.1:${address.port}/v1/events`, token: "generated-private-version-token", pid: process.pid }), { mode: 0o600 });
    try {
      await assert.rejects(() => ensureConnection({ stateDir: directory, confirmUpgrade: async () => { confirmations++; return true; } }), mode === "newer" ? ServiceProtocolMismatch : /identity/);
      assert.equal(confirmations, 0); assert.equal(stops, 0);
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); await rm(directory, { recursive: true, force: true }); }
  }
});

test("a connection rotated during actual confirmation cannot stop the newly discovered owner", async () => {
  const directory = await mkdtemp(join(tmpdir(), "moguri-generated-upgrade-")); let stops = 0;
  const server = createServer((request, response) => { if (request.url === "/v1/health") response.end(JSON.stringify({ protocolVersion: PROTOCOL_VERSION - 1, pid: process.pid })); else { stops++; response.writeHead(500).end(); } });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const path = join(directory, "connection.json"), original = { protocolVersion: PROTOCOL_VERSION - 1, baseUrl: `http://127.0.0.1:${address.port}`, wsUrl: `ws://127.0.0.1:${address.port}/v1/events`, token: "generated-original-upgrade-token", pid: process.pid };
  await writeFile(path, JSON.stringify(original), { mode: 0o600 });
  try {
    await assert.rejects(() => ensureConnection({ stateDir: directory, confirmUpgrade: async () => {
      await writeFile(path, JSON.stringify({ ...original, token: "generated-rotated-upgrade-token" }), { mode: 0o600 }); return true;
    } }), /reviewed.*changed|different owner/);
    assert.equal(stops, 0);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); await rm(directory, { recursive: true, force: true }); }
});
