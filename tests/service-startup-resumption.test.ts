import assert from "node:assert/strict";
import { createServer } from "node:http";
import { copyFile, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  ensureConnection, reviewServiceStartup, ServiceStartupUnconfirmed, stopMoguriService, waitForStartupService,
} from "../packages/sdk/src/node.ts";
import { readPrivateConnection, ServiceHealthTimeout } from "../packages/client/src/node.ts";
import { readServiceLock } from "../packages/client/src/service-files.ts";
import { MoguriSdk, PROTOCOL_VERSION } from "../packages/sdk/src/index.ts";
import { setupFixture } from "./fixture.ts";
import { ciTime } from "./fixtures/time-scale.ts";

test("the real 60-second deadline retains original readiness intent and concurrent explicit reconnects authenticate only that late owner", {
  timeout: ciTime(90_000),
}, async () => {
  const f = await setupFixture(), stateDir = join(f.directory, "state");
  const previous = await new MoguriSdk(f.service.connection).ready();
  let connection: Awaited<ReturnType<typeof ensureConnection>> | undefined, current: MoguriSdk | undefined;
  try {
    await previous.command({ type: "draft.save", sessionId: f.sessionId, expectedRevision: 0,
      text: "Generated original held input.", attachments: [] });
    await previous.command({ type: "message.send", sessionId: f.sessionId, expectedRevision: 1, delivery: "queue", held: true });
    await previous.command({ type: "draft.save", sessionId: f.sessionId, expectedRevision: 2,
      text: "Generated original unsent opening draft.", attachments: [] });
    const artifact = await previous.artifacts.create(f.sessionId, { kind: "research-note",
      name: "Generated original startup artifact", text: "Generated independently retained startup evidence." });
    previous.disconnect(); await f.service.close();
    await writeFile(join(stateDir, "generated-owned-startup.json"), JSON.stringify({
      delayMs: 61_100, packageRoot: process.cwd(), home: f.home,
    }), { mode: 0o600 });
    const began = performance.now();
    let unconfirmed: ServiceStartupUnconfirmed | undefined;
    await assert.rejects(ensureConnection({ stateDir, servicePath: resolve("tests/fixtures/delayed-owned-startup.mjs") }), (error: unknown) => {
      if (!(error instanceof ServiceStartupUnconfirmed)) return false;
      unconfirmed = error; return true;
    });
    const unconfirmedMs = performance.now() - began;
    assert.ok(unconfirmedMs >= 59_900 && unconfirmedMs < 65_000, `The unchanged readiness deadline took ${unconfirmedMs} ms.`);
    assert.ok(unconfirmed);
    const original = unconfirmed.review, callerCopy = unconfirmed.review;
    callerCopy.pid++;
    assert.deepEqual(unconfirmed.review, original);
    assert.equal(JSON.parse(await readFile(join(stateDir, "service.lock"), "utf8")).pid, original.pid);
    assert.equal(f.requests.length, 0);
    const connections = await Promise.all([
      ensureConnection({ stateDir, startupReview: original, servicePath: resolve("tests/fixtures/startup-failure.mjs") }),
      ensureConnection({ stateDir, startupReview: unconfirmed.review }),
      ensureConnection({ stateDir, servicePath: resolve("tests/fixtures/startup-failure.mjs") }),
    ]);
    connection = connections[0]!;
    for (const candidate of connections) assert.deepEqual(candidate, connection);
    assert.equal(connection.pid, original.pid);
    const owners = (await readFile(join(stateDir, "generated-owned-startup-owners.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    assert.deepEqual(owners, [{ pid: original.pid }]);
    current = await new MoguriSdk(connection).ready();
    assert.equal(current.sessions.get(f.sessionId)?.draft.text, "Generated original unsent opening draft.");
    assert.equal(current.sessions.get(f.sessionId)?.queue.length, 1);
    assert.equal(current.sessions.get(f.sessionId)?.queue[0]?.held, true);
    assert.equal((await current.artifacts.read(artifact.id!)).artifact.name, "Generated original startup artifact");
    assert.equal(current.getState().snapshot?.budgetEntries.length, 0);
    assert.equal(f.requests.length, 0);
    assert.doesNotMatch(await readFile(join(stateDir, "service.log"), "utf8"), /Generated startup failure/);
    console.log(JSON.stringify({ primitive: "original-owned-startup-late-confirmation", unconfirmedMs,
      authenticatedMs: performance.now() - began, concurrentClients: connections.length, originalOwnerOnly: true, modelCalls: 0 }));
  } finally {
    previous.disconnect(); current?.disconnect();
    connection ??= await readPrivateConnection(stateDir);
    await stopMoguriService(stateDir, { expectedConnection: connection });
    await f.close();
  }
});

test("captured startup review rejects a changed root, lock or private connection before adopting a different endpoint", async (t) => {
  for (const change of ["lock", "connection", "root"] as const) await t.test(change, async () => {
    const f = await setupFixture(), stateDir = join(f.directory, "state"), review = await reviewServiceStartup(stateDir);
    const target = change === "lock" ? join(stateDir, "service.lock") : join(stateDir, "connection.json");
    const preserved = `${target}.generated-original`;
    const displaced = `${stateDir}-generated-original`;
    let foreignReads = 0;
    const foreign = createServer((_request, response) => { foreignReads++; response.writeHead(403).end("{}"); });
    await new Promise<void>((resolve) => foreign.listen(0, "127.0.0.1", resolve));
    const address = foreign.address(); assert.ok(address && typeof address !== "string");
    try {
      if (change === "root") {
        await rename(stateDir, displaced);
        const replacement = await mkdtemp(join(f.directory, "generated-replacement-"));
        await rename(replacement, stateDir);
      } else {
        await rename(target, preserved);
        await writeFile(target, change === "lock" ? JSON.stringify({ pid: process.pid }) : JSON.stringify({
          ...f.service.connection, token: "generated-foreign-startup-token", baseUrl: `http://127.0.0.1:${address.port}`,
          wsUrl: `ws://127.0.0.1:${address.port}/v1/events`,
        }), { mode: 0o600 });
      }
      await assert.rejects(ensureConnection({ stateDir, startupReview: review, servicePath: resolve("tests/fixtures/startup-failure.mjs") }), /original.*changed|captured.*changed/i);
      assert.equal(foreignReads, 0);
      assert.equal(f.requests.length, 0);
    } finally {
      if (change === "root") { await rm(stateDir, { recursive: true }); await rename(displaced, stateDir); }
      else { await rm(target); await rename(preserved, target); }
      foreign.closeAllConnections(); await new Promise<void>((resolve) => foreign.close(() => resolve()));
      await f.close();
    }
  });
});

test("cancelling discovery does not stop or replace the original initializing owner", async () => {
  const f = await setupFixture(), stateDir = join(f.directory, "state");
  await f.service.close();
  await writeFile(join(stateDir, "generated-owned-startup.json"), JSON.stringify({
    delayMs: 500, packageRoot: process.cwd(), home: f.home,
  }), { mode: 0o600 });
  const abort = new AbortController();
  let connection: Awaited<ReturnType<typeof ensureConnection>> | undefined;
  try {
    const starting = ensureConnection({ stateDir, servicePath: resolve("tests/fixtures/delayed-owned-startup.mjs"), signal: abort.signal });
    const rejected = assert.rejects(starting, { name: "AbortError" });
    const deadline = performance.now() + ciTime(5000);
    let claimed = false;
    while (performance.now() < deadline) {
      const lock = await readServiceLock(join(stateDir, "service.lock"));
      if (lock?.pid) { claimed = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(claimed, true);
    abort.abort(); await rejected;
    const original = await reviewServiceStartup(stateDir);
    connection = await waitForStartupService(original);
    assert.equal(connection.pid, original.pid);
    assert.equal((await readFile(join(stateDir, "generated-owned-startup-owners.jsonl"), "utf8")).trim().split("\n").length, 1);
    assert.equal(f.requests.length, 0);
  } finally {
    connection ??= await readPrivateConnection(stateDir);
    await stopMoguriService(stateDir, { expectedConnection: connection }); await f.close();
  }
});

test("the first authenticated health timeout cannot create a fresh review for a replacement root", async (t) => {
  const f = await setupFixture(), stateDir = join(f.directory, "state"), original = `${stateDir}-generated-original`;
  const fetch = globalThis.fetch;
  let changed = false;
  try {
    t.mock.method(globalThis, "fetch", async (...args: Parameters<typeof fetch>) => {
      if (!changed && String(args[0]).endsWith("/v1/health")) {
        changed = true;
        await rename(stateDir, original); await mkdir(stateDir, { mode: 0o700 });
        for (const name of ["service.lock", "connection.json"]) await copyFile(join(original, name), join(stateDir, name));
        throw new ServiceHealthTimeout(PROTOCOL_VERSION, new Error("Generated original health completion was lost."));
      }
      return fetch(...args);
    });
    await assert.rejects(ensureConnection({ stateDir }), (error: unknown) => error instanceof Error &&
      !(error instanceof ServiceStartupUnconfirmed) && /original.*changed|captured.*changed/i.test(error.message));
    assert.equal(changed, true);
    assert.equal(f.requests.length, 0);
    await assert.rejects(readFile(join(stateDir, "service.log")), { code: "ENOENT" });
  } finally {
    t.mock.restoreAll();
    if (changed) { await rm(stateDir, { recursive: true }); await rename(original, stateDir); }
    await f.close();
  }
});
