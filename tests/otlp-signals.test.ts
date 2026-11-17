import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { MoguriSdk, projectEvents, type OtlpConfiguration, type StoredEvent } from "../packages/sdk/src/index.ts";
import { TelemetryExport, otlpCredentialSlot } from "../apps/service/src/telemetry-export.ts";
import { setupFixture, waitFor } from "./fixture.ts";
import { profileFixture } from "./fixtures/profiles.ts";
import { attributesOf, memoryVault, otlpCollector, signalRecords } from "./fixtures/otlp.ts";

const enable = async (sdk: MoguriSdk, endpoint: string, extra: { logs?: boolean; headers?: string[]; samplingRatio?: number } = {}) =>
  sdk.telemetry.export.apply((await sdk.telemetry.export.review({ enabled: true, endpoint, samplingRatio: extra.samplingRatio ?? 1, logs: extra.logs, headers: extra.headers })).review);

test("reviews disclose the log signal and credential header names, and reject transport header overrides", async () => {
  const f = await setupFixture(), sdk = await new MoguriSdk(f.service.connection).ready(), receiver = await otlpCollector();
  try {
    const plain = (await sdk.telemetry.export.review({ enabled: true, endpoint: receiver.endpoint, samplingRatio: 1 })).review;
    assert.deepEqual([plain.signals, plain.logs, plain.headers, plain.disclosureVersion], [["traces", "metrics"], false, [], 2]);
    const full = (await sdk.telemetry.export.review({ enabled: true, endpoint: receiver.endpoint, samplingRatio: 1, logs: true, headers: ["X-Api-Key", "Authorization"] })).review;
    assert.deepEqual([full.signals, full.headers], [["traces", "metrics", "logs"], ["authorization", "x-api-key"]]);
    for (const headers of [["content-type"], ["host"], ["authorization", "Authorization"], Array.from({ length: 9 }, (_, index) => `x-generated-${index}`)]) {
      await assert.rejects(() => sdk.telemetry.export.review({ enabled: true, endpoint: receiver.endpoint, samplingRatio: 1, headers }), /header|schema/i);
    }
    await assert.rejects(() => sdk.telemetry.export.review({ enabled: false, endpoint: null, samplingRatio: 1, headers: ["authorization"] }), /origin/i);
    await sdk.telemetry.export.apply(full);
    const status = await sdk.telemetry.export.status();
    assert.deepEqual(status.configuration, { enabled: true, endpoint: receiver.endpoint, samplingRatio: 1, logs: true, headers: ["authorization", "x-api-key"], revision: 1, disclosureVersion: 2 });
    assert.deepEqual(status.headers, [{ name: "authorization", stored: false }, { name: "x-api-key", stored: false }]);
    assert.equal(receiver.requests.length, 0);
  } finally { sdk.disconnect(); await f.close(); await receiver.close(); }
});

test("a controlled model failure exports an ERROR span with a finite error.type and one correlated fixed-template log", async () => {
  const marker = "GENERATED_PRIVATE_PROVIDER_FAILURE";
  const f = await setupFixture({ httpFailure: { status: 400, message: marker } }), sdk = await new MoguriSdk(f.service.connection).ready(), receiver = await otlpCollector();
  try {
    await f.configure(); await enable(sdk, receiver.endpoint, { logs: true });
    await f.send("Generated controlled model failure."); await f.terminal();
    await waitFor(() => signalRecords(receiver.requests, "traces").some((span) => span.name === "moguri.turn") &&
      signalRecords(receiver.requests, "logs").some((record) => record.eventName === "moguri.turn.outcome"), 4000);
    const spans = signalRecords(receiver.requests, "traces"), logs = signalRecords(receiver.requests, "logs");
    const turn = spans.find((span) => span.name === "moguri.turn")!, model = spans.find((span) => span.name === "moguri.model");
    assert.equal(attributesOf(turn)["moguri.outcome"], "failed");
    assert.deepEqual([(turn.status as { code?: number }).code, attributesOf(turn)["error.type"]], [2, "failed"]);
    if (model) assert.equal(model.traceId, turn.traceId);
    const turnLog = logs.find((record) => record.eventName === "moguri.turn.outcome")!;
    assert.deepEqual([turnLog.traceId, turnLog.spanId, turnLog.severityText, attributesOf(turnLog)["error.type"]], [turn.traceId, turn.spanId, "ERROR", "failed"]);
    assert.deepEqual(turnLog.body, { stringValue: "Turn ended with outcome failed." });
    for (const record of logs) assert.ok(spans.some((span) => span.traceId === record.traceId && span.spanId === record.spanId));
    const wire = receiver.requests.map((request) => request.text).join("\n");
    for (const forbidden of [marker, f.project, f.sessionId, "Generated controlled model failure."]) assert.equal(wire.includes(forbidden), false);
  } finally { sdk.disconnect(); await f.close(); await receiver.close(); }
});

test("a failed tool exports its own ERROR span and log under its model call, without the tool path or error text", async () => {
  const f = await setupFixture({ toolCall: { name: "read_file", args: { path: "generated-private-missing.txt" } } }), sdk = await new MoguriSdk(f.service.connection).ready();
  const receiver = await otlpCollector();
  try {
    await f.configure(); await enable(sdk, receiver.endpoint, { logs: true });
    await f.send("Generated failing tool."); await f.terminal();
    await waitFor(() => signalRecords(receiver.requests, "logs").some((record) => record.eventName === "moguri.tool.outcome"), 4000);
    const spans = signalRecords(receiver.requests, "traces"), tool = spans.find((span) => span.name === "moguri.tool")!;
    assert.equal(attributesOf(tool)["error.type"], "failed"); assert.equal((tool.status as { code?: number }).code, 2);
    assert.ok(spans.some((span) => span.name === "moguri.model" && span.spanId === tool.parentSpanId));
    const log = signalRecords(receiver.requests, "logs").find((record) => record.eventName === "moguri.tool.outcome")!;
    assert.deepEqual([log.traceId, log.spanId, attributesOf(log)["moguri.operation.family"]], [tool.traceId, tool.spanId, "tool"]);
    const wire = receiver.requests.map((request) => request.text).join("\n");
    assert.equal(wire.includes("generated-private-missing"), false); assert.equal(wire.includes("Not Found"), false);
  } finally { sdk.disconnect(); await f.close(); await receiver.close(); }
});

test("a stopped turn and a concurrent completed turn keep separate traces and their actual outcomes", async () => {
  const f = await setupFixture({ responseMode: "text" }), sdk = await new MoguriSdk(f.service.connection).ready(), receiver = await otlpCollector();
  try {
    await f.configure(); await enable(sdk, receiver.endpoint, { logs: true });
    const other = await sdk.sessions.create(null, "Generated concurrent session", { modelId: f.session().controls.modelId! });
    await f.send("generated slow stopped owner"); await waitFor(() => f.requests.length === 1);
    await sdk.refresh();
    const current = sdk.getState().snapshot!.sessions.find((session) => session.id === other.id)!;
    await sdk.command({ type: "draft.save", sessionId: other.id!, expectedRevision: current.draft.revision, text: "Generated concurrent completed turn.", attachments: [] });
    await sdk.command({ type: "message.send", sessionId: other.id!, expectedRevision: current.draft.revision + 1, delivery: "queue" });
    await waitFor(() => sdk.getState().snapshot!.sessions.find((session) => session.id === other.id)?.status === "completed");
    await sdk.command({ type: "session.stop", sessionId: f.sessionId }); await f.terminal();
    await waitFor(() => signalRecords(receiver.requests, "traces").filter((span) => span.name === "moguri.turn").length === 2, 4000);
    const turns = signalRecords(receiver.requests, "traces").filter((span) => span.name === "moguri.turn");
    const stopped = turns.find((span) => attributesOf(span)["moguri.outcome"] === "stopped")!, completed = turns.find((span) => attributesOf(span)["moguri.outcome"] === "completed")!;
    assert.notEqual(stopped.traceId, completed.traceId);
    assert.deepEqual([(stopped.status as { code?: number }).code ?? 0, attributesOf(stopped)["error.type"]], [0, undefined]);
    assert.equal((completed.status as { code?: number }).code, 1);
    for (const span of signalRecords(receiver.requests, "traces").filter((span) => span.name === "moguri.model")) {
      assert.ok([stopped.spanId, completed.spanId].includes(String(span.parentSpanId)));
      assert.equal(span.traceId, span.parentSpanId === stopped.spanId ? stopped.traceId : completed.traceId);
    }
    await waitFor(() => signalRecords(receiver.requests, "logs").some((record) => record.eventName === "moguri.turn.outcome"), 4000);
    const logs = signalRecords(receiver.requests, "logs").filter((record) => record.eventName === "moguri.turn.outcome");
    assert.deepEqual(logs.map((record) => [record.traceId, record.severityText]), [[stopped.traceId, "INFO"]]);
  } finally { sdk.disconnect(); await f.close(); await receiver.close(); }
});

test("late canonical corrections become one correction log instead of a duplicate span or extra accounting", async () => {
  const f = await setupFixture({ responseMode: "text" }), receiver = await otlpCollector();
  const configuration: OtlpConfiguration = { enabled: true, endpoint: receiver.endpoint, samplingRatio: 1, logs: true, headers: [], revision: 1, disclosureVersion: 2 };
  const exporter = new TelemetryExport("default", () => configuration, memoryVault());
  try {
    await f.configure(); await f.send("Generated source for a late correction."); await f.terminal();
    const snapshot = f.service.controller.snapshot(), source = f.service.controller.events(0).find((event) => event.event_type === "budget.recorded" && event.payload.entry.status === "settled");
    assert.ok(source?.event_type === "budget.recorded");
    const accounting = JSON.stringify(snapshot.budgetEntries);
    exporter.start(configuration);
    exporter.observe([source], configuration, snapshot);
    exporter.observe([{ ...source, id: randomUUID(), seq: source.seq + 1 }], configuration, snapshot);
    assert.deepEqual([exporter.status().queuedSpans, exporter.status().queuedLogs], [1, 0]);
    exporter.observe([{ ...source, id: randomUUID(), seq: source.seq + 2, payload: { entry: { ...source.payload.entry, cacheReadTokens: 7 } } }], configuration, snapshot);
    assert.deepEqual([exporter.status().queuedSpans, exporter.status().queuedLogs], [1, 1]);
    await waitFor(() => exporter.status().acceptedLogs === 1, 4000);
    const spans = signalRecords(receiver.requests, "traces"), logs = signalRecords(receiver.requests, "logs");
    assert.equal(spans.filter((span) => span.name === "moguri.model").length, 1);
    assert.deepEqual([logs[0]?.eventName, logs[0]?.spanId, logs[0]?.severityText], ["moguri.model.corrected", spans[0]?.spanId, "INFO"]);
    assert.equal(JSON.stringify(f.service.controller.snapshot().budgetEntries), accounting); assert.equal(f.requests.length, 1);
  } finally { await exporter.close(); await f.close(); await receiver.close(); }
});

test("log saturation drops beyond 128 queued records with visible loss and no effect on spans or accounting", async () => {
  const f = await setupFixture({ responseMode: "text" }), receiver = await otlpCollector();
  receiver.mode = "stall";
  const configuration: OtlpConfiguration = { enabled: true, endpoint: receiver.endpoint, samplingRatio: 0, logs: true, headers: [], revision: 1, disclosureVersion: 2 };
  const exporter = new TelemetryExport("default", () => configuration, memoryVault());
  try {
    await f.configure(); await f.send("Generated source for log saturation."); await f.terminal();
    const snapshot = f.service.controller.snapshot(), source = f.service.controller.events(0).find((event) => event.event_type === "budget.recorded" && event.payload.entry.status === "settled");
    assert.ok(source?.event_type === "budget.recorded");
    const accounting = JSON.stringify(snapshot.budgetEntries);
    exporter.start(configuration);
    exporter.observe(Array.from({ length: 500 }, (_, index) => ({ ...source, id: randomUUID(), seq: source.seq + index,
      payload: { entry: { ...source.payload.entry, id: randomUUID(), outcome: "error" } } })), configuration, snapshot);
    const status = exporter.status();
    assert.deepEqual([status.queuedLogs, status.droppedLogs, status.queuedSpans, status.sampledOut], [128, 372, 0, 500]);
    assert.equal(status.lastFailure?.code, "capacity");
    assert.equal(JSON.stringify(f.service.controller.snapshot().budgetEntries), accounting); assert.equal(f.requests.length, 1);
  } finally { await exporter.close(); await f.close(); await receiver.close(); }
});

test("logs stay off until reviewed, so an enabled traces-and-metrics export never posts log records", async () => {
  const f = await setupFixture({ httpFailure: { status: 400, message: "GENERATED_PRIVATE_FAILURE" } }), sdk = await new MoguriSdk(f.service.connection).ready(), receiver = await otlpCollector();
  try {
    await f.configure(); await enable(sdk, receiver.endpoint);
    await f.send("Generated failure without reviewed logs."); await f.terminal();
    await waitFor(() => signalRecords(receiver.requests, "traces").some((span) => span.name === "moguri.turn"), 4000);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    assert.equal(receiver.requests.some((request) => request.path === "/v1/logs"), false);
    const status = await sdk.telemetry.export.status(); assert.deepEqual([status.acceptedLogs, status.droppedLogs, status.queuedLogs], [0, 0, 0]);
  } finally { sdk.disconnect(); await f.close(); await receiver.close(); }
});

test("credential headers come only from this profile's secret backend for the reviewed origin and never leak into records", async () => {
  const fixture = await profileFixture(), receiver = await otlpCollector(), moved = await otlpCollector();
  const secret = "GENERATED_PRIVATE_OTLP_TOKEN", key = "GENERATED_PRIVATE_OTLP_KEY";
  try {
    const { client: other } = await fixture.create("Generated second telemetry profile");
    const own = fixture.sdk, session = await own.sessions.create(null, "Generated credential turn", { modelId: fixture.providers[0]!.modelId });
    await enable(own, receiver.endpoint, { headers: ["authorization", "x-api-key"] });
    await fixture.send(own, session.id!, "Generated turn before credentials.");
    await waitFor(() => fixture.session(own, session.id!).status === "completed");
    await waitFor(() => fixture.service.controller.platform.telemetryExport.status().lastFailure?.code === "credential", 4000);
    assert.equal(receiver.requests.length, 0);
    assert.equal((await own.telemetry.export.status()).lastFailure?.code, "credential");
    await own.telemetry.export.setCredential(receiver.endpoint, "Authorization", `Bearer ${secret}`);
    await own.telemetry.export.setCredential(receiver.endpoint, "x-api-key", key);
    assert.deepEqual((await own.telemetry.export.status()).headers, [{ name: "authorization", stored: true }, { name: "x-api-key", stored: true }]);
    await fixture.send(own, session.id!, "Generated turn with credentials.");
    await waitFor(() => receiver.requests.some((request) => request.path === "/v1/traces"), 4000);
    assert.ok(receiver.requests.every((request) => request.headers.authorization === `Bearer ${secret}` && request.headers["x-api-key"] === key));

    const otherSession = await other.sessions.create(null, "Generated other credential turn", { modelId: fixture.providers[1]!.modelId });
    await enable(other, receiver.endpoint, { headers: ["authorization"] });
    const before = receiver.requests.length;
    await fixture.send(other, otherSession.id!, "Generated other profile turn.");
    await waitFor(() => fixture.session(other, otherSession.id!).status === "completed");
    await new Promise((resolve) => setTimeout(resolve, 1200));
    assert.equal(receiver.requests.length, before);
    assert.deepEqual((await other.telemetry.export.status()).headers, [{ name: "authorization", stored: false }]);

    await enable(own, moved.endpoint, { headers: ["authorization", "x-api-key"] });
    assert.deepEqual((await own.telemetry.export.status()).headers.map((header) => header.stored), [false, false]);
    await fixture.send(own, session.id!, "Generated turn after moving the collector.");
    await waitFor(() => fixture.session(own, session.id!).status === "completed");
    await new Promise((resolve) => setTimeout(resolve, 1200));
    assert.equal(moved.requests.length, 0);

    const vault = fixture.vaults.get("default")!;
    assert.equal(vault.get(otlpCredentialSlot(receiver.endpoint, "authorization")), `Bearer ${secret}`);
    await own.telemetry.export.removeCredential(receiver.endpoint, "authorization");
    assert.equal(vault.has(otlpCredentialSlot(receiver.endpoint, "authorization")), false);
    const retained = JSON.stringify([fixture.service.controller.events(0), await own.telemetry.export.status(), await other.telemetry.export.status(),
      receiver.requests.map((request) => request.text)]);
    for (const value of [secret, key]) assert.equal(retained.includes(value), false);
  } finally { await fixture.close(); await receiver.close(); await moved.close(); }
});

test("retained disclosure-1 configuration projects without logs or headers, and malformed disclosure-2 headers are refused", () => {
  const base = { schema_version: 1 as const, timestamp: new Date().toISOString(), profile_id: "default", work_item_id: null, parent_event_id: null };
  const configured = (seq: number, configuration: Record<string, unknown>) => ({ ...base, seq, id: randomUUID(), event_type: "telemetry.export_configured",
    payload: { configuration, actor: "user", reviewDigest: "a".repeat(64) } }) as unknown as StoredEvent;
  const legacy = projectEvents([configured(1, { enabled: true, endpoint: "http://127.0.0.1:4318", samplingRatio: 1, revision: 1, disclosureVersion: 1 })]);
  assert.deepEqual([legacy.telemetryExport.logs, legacy.telemetryExport.headers, legacy.telemetryExport.disclosureVersion], [undefined, undefined, 1]);
  for (const configuration of [
    { enabled: true, endpoint: "http://127.0.0.1:4318", samplingRatio: 1, logs: true, revision: 1, disclosureVersion: 1 },
    { enabled: true, endpoint: "http://127.0.0.1:4318", samplingRatio: 1, logs: false, headers: ["X-Api-Key"], revision: 1, disclosureVersion: 2 },
    { enabled: true, endpoint: "http://127.0.0.1:4318", samplingRatio: 1, logs: false, headers: ["content-type"], revision: 1, disclosureVersion: 2 },
    { enabled: true, endpoint: "http://127.0.0.1:4318", samplingRatio: 1, revision: 1, disclosureVersion: 2 },
  ]) assert.throws(() => projectEvents([configured(1, configuration)]), /OTLP|header/i);
});
