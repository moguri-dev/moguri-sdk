import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { reviewNativeTools, setupFixture, waitFor, type GeneratedProviderOptions } from "./fixture.ts";
import { startService } from "../apps/service/src/server.ts";
import { assertCurrentSchema, writeLegacyState } from "./fixtures/legacy-state.ts";

test("actual SDK tool outcomes separate completed, denied and failed results without retaining private source contents", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await reviewNativeTools(fixture);
    await fixture.configure();
    await fixture.send("generated tool GENERATED_PRIVATE_SENTINEL");
    await fixture.approve(); await fixture.terminal();
    await fixture.send("generated forbidden write GENERATED_PRIVATE_SENTINEL");
    await fixture.approve(false); await fixture.terminal();
    await fixture.send("generated failing command GENERATED_PRIVATE_SENTINEL");
    await fixture.approve(); await fixture.terminal();
    const result = await sdk.telemetry.operations({ sessionId: fixture.sessionId });
    assert.equal(result.totals.attempts, 3); assert.equal(result.totals.completed, 1); assert.equal(result.totals.denied, 1); assert.equal(result.totals.failed, 1);
    assert.equal(result.totals.knownResults, 2); assert.equal(result.totals.failureRate, 0.5); assert.equal(result.totals.retries, null);
    assert.equal(result.groups.length, 3); assert.ok(result.entries.every((entry) => entry.actor === "model" && entry.env === "Local"));
    assert.equal(JSON.stringify(result).includes("GENERATED_PRIVATE_SENTINEL"), false); assert.equal(JSON.stringify(result).includes("fixture.txt"), false);
    assert.ok(result.coverage); assert.equal(result.coverage.priorHistory, "retained-events-only");
    const denied = result.entries.find((entry) => entry.outcome === "denied")!;
    assert.equal(denied.started, false); assert.equal(denied.elapsedMs, null);
    const failed = result.entries.find((entry) => entry.outcome === "failed")!;
    assert.equal(failed.started, true); assert.ok(failed.elapsedMs !== null && failed.elapsedMs >= 0);
    const calls = await sdk.budgets.dashboard();
    assert.ok(calls.totals.calls > result.totals.attempts);
    const storage = await sdk.telemetry.storage();
    assert.equal(storage.storage.profileId, sdk.profileId); assert.ok(storage.storage.bytes.total > 0);
    assert.equal(storage.storage.physicalBytes, null); assert.equal(storage.storage.reclaimedPhysicalBytes, null);
    assert.equal(storage.storage.bytes.total, storage.storage.bytes.events + storage.storage.bytes.blobGrants + storage.storage.bytes.keys);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("independent sanitized outcomes survive deletion, schema-20 upgrade and service restart without replay", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture({ legacyTurnCheckpointJournal: true }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  let restarted: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    await fixture.configure(); await fixture.send("generated tool GENERATED_PRIVATE_SENTINEL"); await fixture.terminal();
    const prior = await sdk.telemetry.operations(), firstId = prior.entries[0]!.id;
    await sdk.sessions.delete(fixture.sessionId, true, fixture.session().revision);
    assert.equal((await sdk.telemetry.operations()).totals.completed, 1);
    assert.equal(fixture.service.controller.events(0).some((event) => event.event_type === "tool.completed"), false);
    assert.equal(JSON.stringify(fixture.service.controller.snapshot().operationEntries).includes("GENERATED_PRIVATE_SENTINEL"), false);
    sdk.disconnect(); await writeLegacyState(fixture.service, 20);
    restarted = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey });
    const peer = await new MoguriSdk(restarted.connection).ready();
    try {
      assertCurrentSchema(restarted.store);
      const result = await peer.telemetry.operations();
      assert.equal(result.totals.completed, 1); assert.equal(result.entries[0]!.id, firstId);
      assert.equal(fixture.requests.length, 2); assert.equal(result.entries[0]!.actor, "model");
      assert.equal(restarted.controller.events(0).filter((event) => event.event_type === "operation.coverage_started").length, 1);
      await peer.command({ type: "provider.refresh" });
      assert.equal((await peer.telemetry.operations()).totals.attempts, 1);
    } finally { peer.disconnect(); }
  } finally { sdk.disconnect(); await restarted?.close(); await fixture.close(); }
});

test("stopping owned work with no retained tool result preserves unconfirmed outcome and no invented timing sample", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.configure(); await fixture.send("generated command GENERATED_PRIVATE_SENTINEL"); await fixture.approve();
    await waitFor(() => fixture.session().processes.length);
    await sdk.command({ type: "session.stop", sessionId: fixture.sessionId }); await fixture.terminal();
    const result = await sdk.telemetry.operations();
    assert.equal(result.totals.completed, 0); assert.equal(result.totals.failureRate, null);
    assert.equal(result.totals.stopped + result.totals.partial + result.totals.unconfirmed + result.totals.unknown, 1);
    assert.equal(JSON.stringify(result).includes("GENERATED_PRIVATE_SENTINEL"), false); assert.equal(JSON.stringify(result).includes("sleep 30"), false);
    for (const entry of result.entries.filter((entry) => entry.outcome === "unconfirmed")) assert.equal(entry.elapsedMs, null);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("actual model and external MCP attempts are not inflated by gateway discovery or retained-result jobs", { skip: process.platform !== "darwin" }, async () => {
  const options: GeneratedProviderOptions = {}, fixture = await setupFixture(options), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await reviewNativeTools(fixture, ["mcp_gateway"]);
    const tool = (await sdk.mcp.tools("builtin", "grep", 0, fixture.sessionId)).tools.find((tool) => tool.name === "grep_logs")!;
    assert.equal((await sdk.telemetry.operations()).totals.attempts, 0);
    options.mcpCall = { serverId: "builtin", tool: tool.name, arguments: { path: "fixture.txt", query: "original" }, schemaDigest: tool.digest };
    await fixture.configure(); await fixture.send("generated mcp call GENERATED_PRIVATE_SENTINEL"); await fixture.approve(); await fixture.terminal();
    const external = await sdk.mcp.call(fixture.sessionId, "builtin", tool.name, { path: "fixture.txt", query: "original" }, tool.digest);
    await fixture.approve(); assert.equal((await sdk.jobs.wait(external.id!)).status, "completed");
    const result = await sdk.telemetry.operations({ family: "mcp" });
    assert.equal(result.totals.attempts, 2); assert.equal(result.totals.completed, 2); assert.equal(result.totals.failureRate, 0);
    assert.deepEqual(result.entries.map((entry) => entry.actor).sort(), ["external", "model"]);
    assert.ok(result.entries.every((entry) => entry.serverId === "builtin" && entry.name === "grep_logs"));
    assert.equal((await sdk.telemetry.operations({ family: "tool" })).totals.attempts, 0);
    assert.equal(JSON.stringify(result).includes("fixture.txt"), false); assert.equal(JSON.stringify(result).includes("GENERATED_PRIVATE_SENTINEL"), false);
    assert.equal(fixture.requests.length, 2);
    const denied = await sdk.mcp.call(fixture.sessionId, "builtin", tool.name, { path: "fixture.txt", query: "original" }, tool.digest);
    await fixture.approve(false); assert.equal((await sdk.jobs.wait(denied.id!)).status, "cancelled");
    const final = await sdk.telemetry.operations({ family: "mcp" });
    assert.equal(final.totals.attempts, 3); assert.equal(final.totals.denied, 1);
    assert.equal(final.totals.completed, 2); assert.equal(final.totals.knownResults, 2);
  } finally { sdk.disconnect(); await fixture.close(); }
});
