import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { MoguriSdk, OTLP_LIMITS, type OtlpConfiguration } from "../packages/sdk/src/index.ts";
import { TelemetryExport } from "../apps/service/src/telemetry-export.ts";
import { startService } from "../apps/service/src/server.ts";
import { setupFixture, waitFor } from "./fixture.ts";
import { memoryVault, otlpCollector } from "./fixtures/otlp.ts";

test("queue saturation and real shutdown deadlines bound diagnostic loss without changing canonical accounting", async () => {
  const fixture = await setupFixture({ responseMode: "text" }), receiver = await otlpCollector();
  receiver.mode = "stall";
  const configuration: OtlpConfiguration = { enabled: true, endpoint: receiver.endpoint, samplingRatio: 1, revision: 1, disclosureVersion: 1 };
  const exporter = new TelemetryExport("default", () => configuration, memoryVault());
  try {
    await fixture.configure(); await fixture.send("Generated source for diagnostic saturation."); await fixture.terminal();
    const snapshot = fixture.service.controller.snapshot(), source = fixture.service.controller.events(0).find((event) => event.event_type === "budget.recorded" && event.payload.entry.status === "settled");
    assert.ok(source?.event_type === "budget.recorded");
    const accounting = JSON.stringify(snapshot.budgetEntries);
    exporter.start(configuration);
    exporter.observe(Array.from({ length: 500 }, (_, index) => ({ ...source, id: randomUUID(), seq: source.seq + index,
      payload: { entry: { ...source.payload.entry, id: randomUUID() } } })), configuration, snapshot);
    const queued = exporter.status();
    assert.equal(queued.queuedSpans, OTLP_LIMITS.queuedSpans); assert.equal(queued.droppedSpans, 500 - OTLP_LIMITS.queuedSpans);
    const began = performance.now(); await exporter.close(); const elapsed = performance.now() - began;
    assert.ok(elapsed >= OTLP_LIMITS.requestMs && elapsed < OTLP_LIMITS.shutdownMs + 750, `Actual shutdown took ${elapsed} ms`);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const ended = exporter.status();
    assert.equal(ended.queuedSpans, 0); assert.equal(ended.lastFailure?.code, "shutdown");
    assert.ok(receiver.requests.length <= 2); assert.equal(fixture.requests.length, 1);
    assert.equal(JSON.stringify(fixture.service.controller.snapshot().budgetEntries), accounting);
    console.log(JSON.stringify({ primitive: "otlp-bounded-shutdown", queued: queued.queuedSpans, overflowDropped: queued.droppedSpans, shutdownMs: elapsed, requestLimitMs: OTLP_LIMITS.requestMs, attempts: receiver.requests.length }));
  } finally { await exporter.close(); await fixture.close(); await receiver.close(); }
});

test("disable aborts the original in-flight metadata request and admits no later sends or paid replay", async () => {
  const fixture = await setupFixture({ responseMode: "text" }), sdk = await new MoguriSdk(fixture.service.connection).ready(), receiver = await otlpCollector();
  receiver.mode = "stall";
  try {
    await fixture.configure();
    await sdk.telemetry.export.apply((await sdk.telemetry.export.review({ enabled: true, endpoint: receiver.endpoint, samplingRatio: 1 })).review);
    await fixture.send("Generated disable during collector wait."); await fixture.terminal();
    await waitFor(() => receiver.requests.length === 1, 4000);
    await sdk.telemetry.export.apply((await sdk.telemetry.export.review({ enabled: false, endpoint: receiver.endpoint, samplingRatio: 1 })).review);
    const disabled = await sdk.telemetry.export.status(); assert.equal(disabled.phase, "disabled"); assert.equal(disabled.queuedSpans, 0);
    await fixture.send("Generated later disabled turn."); await fixture.terminal();
    await new Promise((resolve) => setTimeout(resolve, OTLP_LIMITS.requestMs + OTLP_LIMITS.batchMs));
    assert.equal(receiver.requests.length, 1); assert.equal(fixture.requests.length, 2);
    assert.equal((await sdk.budgets.dashboard()).totals.calls, 2);
  } finally { sdk.disconnect(); await fixture.close(); await receiver.close(); }
});

test("retained opt-in survives a service restart but old traces and paid work are never replayed", async () => {
  const fixture = await setupFixture({ responseMode: "text" }), sdk = await new MoguriSdk(fixture.service.connection).ready(), receiver = await otlpCollector();
  let restarted: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    await fixture.configure();
    await sdk.telemetry.export.apply((await sdk.telemetry.export.review({ enabled: true, endpoint: receiver.endpoint, samplingRatio: 1 })).review);
    await fixture.send("Generated original restart observation."); await fixture.terminal();
    await waitFor(() => receiver.requests.length >= 2, 4000);
    sdk.disconnect(); await fixture.service.close();
    const before = receiver.requests.length;
    const vault = { read: async () => null, write: async () => {}, remove: async () => {} };
    restarted = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey,
      platform: { vault, terminal: { defaultRoot: fixture.home, vault: fixture.terminalVault } } });
    const peer = await new MoguriSdk(restarted.connection).ready();
    try {
      assert.equal((await peer.telemetry.export.status()).configuration.enabled, true);
      assert.equal((await peer.telemetry.export.status()).acceptedSpans, 0);
      await new Promise((resolve) => setTimeout(resolve, OTLP_LIMITS.batchMs + 100));
      assert.equal(receiver.requests.length, before); assert.equal(fixture.requests.length, 1);
      assert.equal((await peer.budgets.dashboard()).totals.calls, 1);
      assert.equal(peer.getState().snapshot?.sessions[0]?.queue.length, 0);
    } finally { peer.disconnect(); }
  } finally { sdk.disconnect(); await restarted?.close(); await fixture.close(); await receiver.close(); }
});

test("wrong-signal, malformed and non-OTLP receiver responses never become acknowledged spans", async (t) => {
  for (const mode of ["wrong-signal", "invalid-partial", "wrong-content-type", "partial"] as const) await t.test(mode, async () => {
    const fixture = await setupFixture({ responseMode: "text" }), sdk = await new MoguriSdk(fixture.service.connection).ready(), receiver = await otlpCollector();
    receiver.mode = mode;
    try {
      await fixture.configure();
      await sdk.telemetry.export.apply((await sdk.telemetry.export.review({ enabled: true, endpoint: receiver.endpoint, samplingRatio: 1 })).review);
      await fixture.send("Generated unqualified collector response."); await fixture.terminal();
      await waitFor(() => {
        return fixture.service.controller.platform.telemetryExport.status().failedRequests > 0;
      }, 4000);
      const status = await sdk.telemetry.export.status();
      assert.equal(status.acceptedSpans, 0); assert.equal(status.lastFailure?.code, mode === "partial" ? "partial" : "response"); assert.ok(status.droppedSpans >= 2);
      assert.equal(fixture.session().status, "completed"); assert.equal(fixture.requests.length, 1);
    } finally { sdk.disconnect(); await fixture.close(); await receiver.close(); }
  });
});
