import assert from "node:assert/strict";
import test from "node:test";
import { isRecord, MoguriSdk } from "../packages/sdk/src/index.ts";
import { reviewNativeTools, setupFixture, waitFor, type GeneratedProviderOptions } from "./fixture.ts";
import { profileFixture } from "./fixtures/profiles.ts";
import { otlpCollector as collector, signalRecords } from "./fixtures/otlp.ts";

function statusOf(fixture: Awaited<ReturnType<typeof setupFixture>>) {
  return fixture.service.controller.platform.telemetryExport.status();
}

test("OTLP starts disabled and only an exact profile/revision/destination review can change its retained configuration", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready(), receiver = await collector();
  try {
    const initial = await sdk.telemetry.export.status();
    assert.equal(initial.configuration.enabled, false); assert.equal(initial.configuration.endpoint, null);
    const review = await sdk.telemetry.export.review({ enabled: true, endpoint: receiver.endpoint, samplingRatio: 1 });
    assert.equal(review.review.profileId, sdk.profileId); assert.equal(review.review.revision, 0);
    assert.deepEqual(review.review.signals, ["traces", "metrics"]); assert.equal(receiver.requests.length, 0);
    await assert.rejects(sdk.telemetry.export.apply({ ...review.review, endpoint: "https://different.invalid" }), /review/i);
    await sdk.telemetry.export.apply(review.review);
    const enabled = await sdk.telemetry.export.status();
    assert.equal(enabled.configuration.enabled, true); assert.equal(enabled.configuration.revision, 1);
    assert.equal(enabled.configuration.endpoint, receiver.endpoint);
    await assert.rejects(sdk.telemetry.export.apply(review.review), /review|revision/i);
    const disable = await sdk.telemetry.export.review({ enabled: false, endpoint: receiver.endpoint, samplingRatio: 1 });
    await sdk.telemetry.export.apply(disable.review);
    assert.equal((await sdk.telemetry.export.status()).configuration.enabled, false);
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); await receiver.close(); }
});

test("an enabled actual worker turn exports correlated metadata-only traces and canonical gauge totals without another model call", async () => {
  const marker = "GENERATED_PRIVATE_OTLP_PAYLOAD", fixture = await setupFixture({ responseMode: "text", replyText: marker });
  const sdk = await new MoguriSdk(fixture.service.connection).ready(), receiver = await collector();
  try {
    await fixture.configure();
    const review = await sdk.telemetry.export.review({ enabled: true, endpoint: receiver.endpoint, samplingRatio: 1 });
    await sdk.telemetry.export.apply(review.review);
    await fixture.send(marker); await fixture.terminal();
    const original = JSON.stringify(fixture.service.controller.snapshot().budgetEntries);
    await waitFor(() => signalRecords(receiver.requests, "traces").some((span) => span.name === "moguri.turn") && signalRecords(receiver.requests, "metrics").length > 0, 4000);
    const spans = signalRecords(receiver.requests, "traces"), root = spans.find((span) => span.name === "moguri.turn"), model = spans.find((span) => span.name === "moguri.model");
    assert.ok(root && model); assert.equal(model.traceId, root.traceId); assert.equal(model.parentSpanId, root.spanId);
    const totals = (await sdk.budgets.dashboard()).totals;
    const metrics = signalRecords(receiver.requests, "metrics"), calls = metrics.find((metric) => metric.name === "moguri.accounting.calls");
    assert.ok(calls && isRecord(calls.gauge) && Array.isArray(calls.gauge.dataPoints));
    assert.equal(calls.gauge.dataPoints[0]?.asDouble, totals.calls);
    const all = receiver.requests.map((request) => request.text).join("\n");
    for (const forbidden of [marker, fixture.directory, fixture.project, fixture.home, fixture.sessionId, "generated-test-only"]) assert.equal(all.includes(forbidden), false);
    assert.equal(JSON.stringify(fixture.service.controller.snapshot().budgetEntries), original);
    assert.equal(fixture.requests.length, totals.calls);
  } finally { sdk.disconnect(); await fixture.close(); await receiver.close(); }
});

test("two independently reviewed profiles sharing a collector keep isolated configuration and distinct metadata-only metric resources", async () => {
  const fixture = await profileFixture(), receiver = await collector();
  try {
    const { client: other } = await fixture.create("Generated private observability profile");
    const review = await fixture.sdk.telemetry.export.review({ enabled: true, endpoint: receiver.endpoint, samplingRatio: 1 });
    await assert.rejects(other.telemetry.export.apply(review.review), /review|profile/i);
    await fixture.sdk.telemetry.export.apply(review.review);
    assert.equal((await other.telemetry.export.status()).configuration.enabled, false);
    const otherReview = await other.telemetry.export.review({ enabled: true, endpoint: receiver.endpoint, samplingRatio: 1 });
    await other.telemetry.export.apply(otherReview.review);
    const ownSession = await fixture.sdk.sessions.create(null, "Generated private first profile turn", { modelId: fixture.providers[0]!.modelId });
    const otherSession = await other.sessions.create(null, "Generated private second profile turn", { modelId: fixture.providers[1]!.modelId });
    await Promise.all([fixture.send(fixture.sdk, ownSession.id!, "GENERATED_FIRST_PROFILE_PRIVATE"), fixture.send(other, otherSession.id!, "GENERATED_OTHER_PROFILE_PRIVATE")]);
    await waitFor(() => fixture.session(fixture.sdk, ownSession.id!).status === "completed" && fixture.session(other, otherSession.id!).status === "completed");
    await waitFor(() => receiver.requests.filter((request) => request.path === "/v1/metrics").length >= 2, 4000);
    const instances = receiver.requests.filter((request) => request.path === "/v1/metrics").flatMap((request) => {
      const body: unknown = JSON.parse(request.text); assert.ok(isRecord(body) && Array.isArray(body.resourceMetrics));
      return body.resourceMetrics.flatMap((item: unknown) => {
        assert.ok(isRecord(item) && isRecord(item.resource) && Array.isArray(item.resource.attributes));
        return item.resource.attributes.flatMap((attribute: unknown) => {
          if (!isRecord(attribute) || attribute.key !== "service.instance.id") return [];
          assert.ok(isRecord(attribute.value) && typeof attribute.value.stringValue === "string");
          return [attribute.value.stringValue];
        });

      });
    });
    assert.equal(new Set(instances).size, 2);
    const wire = receiver.requests.map((request) => request.text).join("\n");
    for (const secret of [other.profileId, ownSession.id!, otherSession.id!, fixture.directory, "GENERATED_FIRST_PROFILE_PRIVATE", "GENERATED_OTHER_PROFILE_PRIVATE", "Generated private observability profile"]) assert.equal(wire.includes(secret), false);
    assert.equal((await fixture.sdk.budgets.dashboard()).totals.calls, 1);
    assert.equal((await other.budgets.dashboard()).totals.calls, 1);
  } finally { await fixture.close(); await receiver.close(); }
});

test("collector outage drops only diagnostic spans, performs no retry, and later exports current canonical gauges without replaying work", async () => {
  const fixture = await setupFixture({ responseMode: "text" }), sdk = await new MoguriSdk(fixture.service.connection).ready(), receiver = await collector();
  receiver.mode = "unavailable";
  try {
    await fixture.configure();
    await sdk.telemetry.export.apply((await sdk.telemetry.export.review({ enabled: true, endpoint: receiver.endpoint, samplingRatio: 1 })).review);
    await fixture.send("Generated original collector-outage turn."); await fixture.terminal();
    await waitFor(() => statusOf(fixture).failedRequests === 1, 4000);
    const failed = await sdk.telemetry.export.status();
    assert.equal(failed.phase, "degraded"); assert.equal(failed.lastFailure?.code, "http"); assert.equal(failed.lastFailure?.httpStatus, 503);
    assert.ok(failed.droppedSpans >= 2); assert.equal(fixture.session().status, "completed");
    const original = JSON.stringify(fixture.service.controller.snapshot().budgetEntries);
    await new Promise((resolve) => setTimeout(resolve, failed.limits.requestMs + failed.limits.batchMs));
    assert.equal(receiver.requests.length, 1); assert.equal(fixture.requests.length, 1);
    assert.equal(JSON.stringify(fixture.service.controller.snapshot().budgetEntries), original);
    assert.equal(JSON.stringify(failed).includes("GENERATED_PRIVATE_RECEIVER_ERROR"), false);
    receiver.mode = "ok";
    await fixture.send("Generated explicitly new recovery turn."); await fixture.terminal();
    await waitFor(() => statusOf(fixture).acceptedSpans >= 2 && signalRecords(receiver.requests, "metrics").length > 0, 4000);
    assert.equal(fixture.requests.length, 2); assert.equal((await sdk.budgets.dashboard()).totals.calls, 2);
    assert.equal((await sdk.telemetry.export.status()).failedRequests, 1);
  } finally { sdk.disconnect(); await fixture.close(); await receiver.close(); }
});

test("zero trace sampling still exports canonical gauges while missing usage stays unknown rather than reported or billed zero", async () => {
  const fixture = await setupFixture({ responseMode: "text", omitUsage: true }), sdk = await new MoguriSdk(fixture.service.connection).ready(), receiver = await collector();
  try {
    await fixture.configure();
    await sdk.telemetry.export.apply((await sdk.telemetry.export.review({ enabled: true, endpoint: receiver.endpoint, samplingRatio: 0 })).review);
    await fixture.send("Generated missing provider usage."); await fixture.terminal();
    await waitFor(() => receiver.requests.some((request) => request.path === "/v1/metrics"), 4000);
    assert.equal(receiver.requests.some((request) => request.path === "/v1/traces"), false);
    const totals = (await sdk.budgets.dashboard()).totals;
    assert.equal(totals.reportedTokens, null); assert.equal(totals.unknownTokenCalls, 1); assert.ok(totals.heldTokens! > 0);
    const names = signalRecords(receiver.requests, "metrics").map((metric) => metric.name);
    assert.ok(names.includes("moguri.accounting.unknown_token_calls"));
    for (const omitted of ["moguri.accounting.reported_tokens_complete", "moguri.accounting.provider_reported_usd", "moguri.accounting.billed_usd"]) assert.equal(names.includes(omitted), false);
    const status = await sdk.telemetry.export.status(); assert.ok(status.sampledOut >= 2); assert.equal(status.acceptedSpans, 0);
  } finally { sdk.disconnect(); await fixture.close(); await receiver.close(); }
});

test("actual approved tools and model/external MCP attempts export only their recorded outcomes without arguments, results or MCP identities", async () => {
  const options: GeneratedProviderOptions = {}, fixture = await setupFixture(options), sdk = await new MoguriSdk(fixture.service.connection).ready(), receiver = await collector();
  try {
    await reviewNativeTools(fixture, ["read_file", "mcp_gateway"]); await fixture.configure();
    await sdk.telemetry.export.apply((await sdk.telemetry.export.review({ enabled: true, endpoint: receiver.endpoint, samplingRatio: 1 })).review);
    await fixture.send("generated tool GENERATED_PRIVATE_TOOL_ARGUMENT"); await fixture.approve(); await fixture.terminal();
    const tool = (await sdk.mcp.tools("builtin", "grep", 0, fixture.sessionId)).tools.find((tool) => tool.name === "grep_logs")!;
    options.mcpCall = { serverId: "builtin", tool: tool.name, arguments: { path: "fixture.txt", query: "original" }, schemaDigest: tool.digest };
    await fixture.send("generated mcp call GENERATED_PRIVATE_MCP_ARGUMENT"); await fixture.approve(); await fixture.terminal();
    const external = await sdk.mcp.call(fixture.sessionId, "builtin", tool.name, { path: "fixture.txt", query: "original" }, tool.digest);
    await fixture.approve(); await sdk.jobs.wait(external.id!);
    await waitFor(() => signalRecords(receiver.requests, "traces").filter((span) => span.name === "moguri.mcp").length >= 2, 4000);
    assert.ok(signalRecords(receiver.requests, "traces").some((span) => span.name === "moguri.tool"));
    const wire = receiver.requests.map((request) => request.text).join("\n");
    for (const forbidden of ["fixture.txt", "grep_logs", "builtin", "GENERATED_PRIVATE_TOOL_ARGUMENT", "GENERATED_PRIVATE_MCP_ARGUMENT", fixture.project]) assert.equal(wire.includes(forbidden), false);
    assert.equal((await sdk.telemetry.operations({ family: "mcp" })).totals.attempts, 2);
    assert.equal(fixture.requests.length, (await sdk.budgets.dashboard()).totals.calls);
  } finally { sdk.disconnect(); await fixture.close(); await receiver.close(); }
});

test("disabled export ignores ambient OTEL destinations and credentials, and concurrent opt-in admits only one exact revision", async () => {
  const fixture = await setupFixture({ responseMode: "text" }), sdk = await new MoguriSdk(fixture.service.connection).ready(), receiver = await collector();
  const before = { endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT, headers: process.env.OTEL_EXPORTER_OTLP_HEADERS };
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT = receiver.endpoint; process.env.OTEL_EXPORTER_OTLP_HEADERS = "authorization=GENERATED_PRIVATE_AMBIENT_CREDENTIAL";
  try {
    await fixture.configure(); await fixture.send("Generated work before any telemetry consent."); await fixture.terminal();
    await new Promise((resolve) => setTimeout(resolve, 1100));
    assert.equal(receiver.requests.length, 0);
    const review = (await sdk.telemetry.export.review({ enabled: true, endpoint: receiver.endpoint, samplingRatio: 1 })).review;
    const results = await Promise.allSettled([sdk.telemetry.export.apply(review), sdk.telemetry.export.apply(review)]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal((await sdk.telemetry.export.status()).configuration.revision, 1);
    await fixture.send("Generated newly consented work."); await fixture.terminal();
    await waitFor(() => signalRecords(receiver.requests, "metrics").length > 0, 4000);
    assert.ok(receiver.requests.every((request) => request.authorization === undefined));
    assert.equal(receiver.requests.map((request) => request.text).join("").includes("GENERATED_PRIVATE_AMBIENT_CREDENTIAL"), false);
    assert.equal(signalRecords(receiver.requests, "traces").filter((span) => span.name === "moguri.turn").length, 1);
    assert.equal((await sdk.budgets.dashboard()).totals.calls, 2);
  } finally {
    if (before.endpoint === undefined) delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT; else process.env.OTEL_EXPORTER_OTLP_ENDPOINT = before.endpoint;
    if (before.headers === undefined) delete process.env.OTEL_EXPORTER_OTLP_HEADERS; else process.env.OTEL_EXPORTER_OTLP_HEADERS = before.headers;
    sdk.disconnect(); await fixture.close(); await receiver.close();
  }
});
