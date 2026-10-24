import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { ensureConnection, ServiceProtocolMismatch, stopMoguriService } from "../packages/sdk/src/node.ts";
import { defaultNotificationWav, MoguriSdk, PROTOCOL_VERSION } from "../packages/sdk/src/index.ts";
import { setupFixture } from "./fixture.ts";

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
  const server = createServer((request, response) => {
    assert.equal(request.headers.authorization, `Bearer ${fixture.service.connection.token}`);
    if (request.url === "/v1/health") { response.end(JSON.stringify({ pid: process.pid, protocolVersion: PROTOCOL_VERSION - 1 })); return; }
    if (request.url !== "/v1/lifecycle" || request.method !== "POST") { response.writeHead(404).end(); return; }
    void (async () => {
      let body = ""; for await (const chunk of request) body += String(chunk);
      assert.deepEqual(JSON.parse(body), { action: "restart" }); restarts++;
      response.once("finish", () => { void fixture.service.close({ preserveTerminals: true }); });
      response.end(JSON.stringify({ accepted: true, pid: process.pid }));
    })().catch((error: unknown) => { response.writeHead(500).end(error instanceof Error ? error.message : "Generated lifecycle failure"); });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  try {
    await sdk.command({ type: "draft.save", sessionId: fixture.sessionId, expectedRevision: 0, text: "Generated retained upgrade draft.", attachments: [] });
    const sound = await sdk.notifications.importSound("Generated upgrade sound", defaultNotificationWav("completed"));
    const keyId = fixture.service.store.db.prepare("SELECT value FROM retention_metadata WHERE id='key_id'").get()?.value;
    sdk.disconnect();
    await writeFile(join(directory, "connection.json"), JSON.stringify({ ...fixture.service.connection, protocolVersion: PROTOCOL_VERSION - 1,
      baseUrl: `http://127.0.0.1:${address.port}`, wsUrl: `ws://127.0.0.1:${address.port}/v1/events` }), { mode: 0o600 });
    successor = await ensureConnection({ stateDir: directory, servicePath: resolve("tests/fixtures/startup-service.ts"), confirmUpgrade: async () => true });
    assert.equal(successor.protocolVersion, PROTOCOL_VERSION); assert.notEqual(successor.pid, process.pid); assert.equal(restarts, 1);
    current = await new MoguriSdk(successor).ready();
    assert.equal(current.getState().snapshot!.sessions[0]!.draft.text, "Generated retained upgrade draft.");
    assert.equal((await current.notifications.sound(sound.id!)).sound.name, "Generated upgrade sound");
    assert.equal(JSON.parse(await readFile(join(directory, "connection.json"), "utf8")).pid, successor.pid);
    assert.ok(keyId); assert.equal(fixture.requests.length, 0);
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
