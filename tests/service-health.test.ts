import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readAuthenticatedServiceHealth, ServiceHealthTimeout } from "../packages/client/src/node.ts";
import { PROTOCOL_VERSION, type Connection } from "../packages/sdk/src/index.ts";

async function delayedHealth(rotate = false) {
  const directory = await mkdtemp(join(tmpdir(), "moguri-generated-health-"));
  let requests = 0, connection: Connection;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const server = createServer((request, response) => {
    assert.equal(request.url, "/v1/health"); assert.equal(request.method, "GET");
    assert.equal(request.headers.authorization, `Bearer ${connection.token}`);
    const reply = () => response.end(JSON.stringify({ protocolVersion: PROTOCOL_VERSION, pid: process.pid, lifecycle: null }));
    if (++requests > 1) { reply(); return; }
    const timer = setTimeout(reply, 2400); timers.add(timer);
    if (rotate) {
      const changed = setTimeout(() => { void writeFile(join(directory, "connection.json"), JSON.stringify({ ...connection, token: "generated-different-health-owner" }), { mode: 0o600 }); }, 50);
      timers.add(changed);
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  connection = { protocolVersion: PROTOCOL_VERSION, pid: process.pid, token: "generated-authenticated-health-token",
    baseUrl: `http://127.0.0.1:${address.port}`, wsUrl: `ws://127.0.0.1:${address.port}/v1/events` };
  await writeFile(join(directory, "connection.json"), JSON.stringify(connection), { mode: 0o600 });
  return { directory, connection, get requests() { return requests; }, close: async () => {
    for (const timer of timers) clearTimeout(timer);
    server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  } };
}

test("a slow authenticated owner can recover within the existing operation deadline by retrying only the read", async () => {
  const fixture = await delayedHealth(), began = performance.now();
  try {
    const before = await readFile(join(fixture.directory, "connection.json"), "utf8");
    const health = await readAuthenticatedServiceHealth(fixture.connection, fixture.directory, began + 5000);
    assert.equal(health.pid, fixture.connection.pid); assert.equal(health.protocolVersion, PROTOCOL_VERSION);
    assert.equal(fixture.requests, 2); assert.ok(performance.now() - began >= 2000);
    assert.equal(await readFile(join(fixture.directory, "connection.json"), "utf8"), before);
  } finally { await fixture.close(); }
});

test("a rotated owner during a timed-out health read is not retried or adopted", async () => {
  const fixture = await delayedHealth(true);
  try {
    await assert.rejects(() => readAuthenticatedServiceHealth(fixture.connection, fixture.directory, performance.now() + 5000), /connection changed.*different owner/);
    assert.equal(fixture.requests, 1);
    assert.match(await readFile(join(fixture.directory, "connection.json"), "utf8"), /generated-different-health-owner/);
  } finally { await fixture.close(); }
});

test("health retry has one bounded operation deadline and never turns a timeout into lifecycle acceptance", async () => {
  const fixture = await delayedHealth();
  try {
    await assert.rejects(() => readAuthenticatedServiceHealth(fixture.connection, fixture.directory, performance.now() + 50), ServiceHealthTimeout);
    assert.equal(fixture.requests, 1);
    await readFile(join(fixture.directory, "connection.json"));
  } finally { await fixture.close(); }
});
