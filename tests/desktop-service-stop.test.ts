import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { stopMoguriService } from "../packages/sdk/src/node.ts";
import { PROTOCOL_VERSION, type Connection } from "../packages/sdk/src/index.ts";

test("an app's exact captured connection cannot stop a rotated private registry owner", async () => {
  const directory = await mkdtemp(join(tmpdir(), "moguri-generated-app-stop-")); let requests = 0;
  const server = createServer((_request, response) => { requests++; response.end(JSON.stringify({ pid: process.pid, protocolVersion: PROTOCOL_VERSION })); });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const original: Connection = { protocolVersion: PROTOCOL_VERSION, pid: process.pid, token: "generated-original-app-connection", baseUrl: `http://127.0.0.1:${address.port}`, wsUrl: `ws://127.0.0.1:${address.port}/v1/events` };
  const rotated = JSON.stringify({ ...original, token: "generated-other-owner-connection" }), path = join(directory, "connection.json");
  await writeFile(path, rotated, { mode: 0o600 });
  try {
    await assert.rejects(() => stopMoguriService(directory, { expectedConnection: original }), /captured.*changed|different owner/);
    assert.equal(requests, 0); assert.equal(await readFile(path, "utf8"), rotated);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); await rm(directory, { recursive: true, force: true }); }
});

test("a missing registry is complete only when the captured endpoint and writer lock are gone", async () => {
  const directory = await mkdtemp(join(tmpdir(), "moguri-generated-app-stop-")), server = createServer((_request, response) => response.end("{}"));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const original: Connection = { protocolVersion: PROTOCOL_VERSION, pid: process.pid, token: "generated-no-registry-connection", baseUrl: `http://127.0.0.1:${address.port}`, wsUrl: `ws://127.0.0.1:${address.port}/v1/events` };
  try {
    await assert.rejects(() => stopMoguriService(directory, { expectedConnection: original }), /still responds.*unconfirmed/);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await writeFile(join(directory, "service.lock"), JSON.stringify({ pid: process.pid }), { mode: 0o600 });
    await assert.rejects(() => stopMoguriService(directory, { expectedConnection: original }), /writer lock.*unconfirmed/);
    await rm(join(directory, "service.lock"));
    await stopMoguriService(directory, { expectedConnection: original });
  } finally { if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve())); await rm(directory, { recursive: true, force: true }); }
});
