import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { MoguriSdk, RECOVERY_DELAYS_MS, retryFailure } from "../packages/sdk/src/index.ts";
import { transientModelFailure } from "../apps/service/src/model-recovery.ts";
import { setupFixture, waitFor, reviewNativeTools, type GeneratedProviderOptions } from "./fixture.ts";
import { GeneratedIntakeClock } from "./fixtures/intake-clock.ts";

const upstream = () => ({ status: 408, message: "Timed out reading request body. Generated fixture; no personal inference." });
const failed = async (fixture: Awaited<ReturnType<typeof setupFixture>>, count: number) => waitFor(() => {
  const state = fixture.service.controller.snapshot();
  return fixture.requests.length === count && state.sessions.every((session) => !session.turnId) && state.modelFailures.every((failure) => failure.status !== "retrying") ? state : false;
}).catch((error: unknown) => { throw new Error(`Generated recovery did not settle at ${count} calls: ${JSON.stringify({
  calls: fixture.requests.length, sessions: fixture.service.controller.snapshot().sessions.map(({ id, status, turnId, lastError }) => ({ id, status, turnId, lastError })),
  failures: fixture.service.controller.snapshot().modelFailures, cycle: fixture.service.controller.snapshot().modelRecoveryCycle,
})}`, { cause: error }); });
test("transient model classification never retries authentication, invalid context or an unclassified error", () => {
  for (const diagnostic of ["408 Timed out reading request body", "503 Service unavailable", "429 rate limited", "fetch failed: ECONNRESET"]) assert.equal(transientModelFailure(diagnostic), true);
  for (const diagnostic of ["401 Unauthorized", "403 Forbidden", "400 context window too large", "413 payload too large", "An unrelated tool failed"]) assert.equal(transientModelFailure(diagnostic), false);
  assert.deepEqual(RECOVERY_DELAYS_MS, [30000, 90000, 120000, 180000]);
});

test("actual workers retry all at30/90, earliest-prompted at120/180, then stop with retained errors and unknown holds", { skip: process.platform !== "darwin", timeout: 30_000 }, async () => {
  const clock = new GeneratedIntakeClock(), options: GeneratedProviderOptions = { httpFailure: upstream(), responseMode: "text", maxOutputTokens: 128 };
  const fixture = await setupFixture({ ...options, platform: { intakeClock: clock } }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.configure(); await sdk.refresh();
    const second = (await sdk.sessions.create(fixture.session().projectId, "Generated earlier-prompted second chat")).id!;
    await sdk.sessions.selectModel(second, fixture.modelId);
    await sdk.command({ type: "draft.save", sessionId: second, expectedRevision: 0, text: "Generated earlier prompted session.", attachments: [] });
    await sdk.command({ type: "message.send", sessionId: second, expectedRevision: 1, delivery: "queue" });
    await waitFor(() => fixture.service.controller.snapshot().sessions.find((session) => session.id === second)?.status === "failed");
    await fixture.send("Generated later prompted session."); await failed(fixture, 2);
    const firstAt = fixture.service.controller.snapshot().modelRecoveryCycle!.startedAt;
    for (const [advance, count, round] of [[29999, 2, 0], [1, 4, 1], [59999, 4, 1], [1, 6, 2], [29999, 6, 2], [1, 7, 3], [59999, 7, 3], [1, 8, 4]] as const) {
      clock.advanceBy(advance);
      if (count > fixture.requests.length) await failed(fixture, count);
      assert.equal(fixture.requests.length, count);
      assert.equal(fixture.service.controller.snapshot().modelRecoveryCycle?.round, round);
    }
    const state = fixture.service.controller.snapshot(), cycle = state.modelRecoveryCycle!;
    assert.equal(cycle.startedAt, firstAt); assert.equal(cycle.status, "exhausted");
    assert.deepEqual(state.modelFailures.map((failure) => [failure.sessionId, failure.attemptCount, failure.status]), [[second, 4, "exhausted"], [fixture.sessionId, 2, "exhausted"]]);
    assert.equal(cycle.targets[0]?.failureId, state.modelFailures[0]?.id);
    assert.equal(state.budgetEntries.length, 8); assert.ok(state.budgetEntries.every((entry) => entry.status === "unknown" && entry.reservedTokens! > 0));
    assert.ok(state.sessions.every((session) => session.status === "failed" && session.lastError));
    clock.advanceBy(86400_000); await new Promise((resolve) => setTimeout(resolve, 50)); assert.equal(fixture.requests.length, 8);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("a successful metered retry resets the shared cycle, not command acceptance or a failed manual attempt", { skip: process.platform !== "darwin", timeout: 20_000 }, async () => {
  const clock = new GeneratedIntakeClock(), failure = { ...upstream(), remaining: 2 };
  const fixture = await setupFixture({ httpFailure: failure, responseMode: "text", maxOutputTokens: 128, platform: { intakeClock: clock } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.configure(); await fixture.send("Generated one shared recovery task."); await failed(fixture, 1); await sdk.refresh();
    const original = retryFailure(fixture.session(), fixture.service.controller.snapshot().modelFailures)!;
    clock.advanceBy(10_000);
    const manual = await Promise.all([sdk.sessions.retry(fixture.sessionId, original.id, original.revision), sdk.sessions.retry(fixture.sessionId, original.id, original.revision)]);
    assert.equal(manual[0]!.id, manual[1]!.id);
    assert.equal(fixture.service.controller.snapshot().modelRecoveryCycle?.generation, 0);
    await failed(fixture, 2);
    assert.equal(fixture.service.controller.snapshot().modelRecoveryCycle?.startedAt, "2030-01-01T10:00:00.000Z");
    clock.advanceBy(19_999); assert.equal(fixture.requests.length, 2);
    clock.advanceBy(1); await failed(fixture, 3);
    const state = fixture.service.controller.snapshot();
    assert.equal(state.modelFailures[0]?.status, "recovered"); assert.equal(state.modelRecoveryCycle?.generation, 1);
    assert.equal(state.modelRecoveryCycle?.startedAt, "2030-01-01T10:00:30.000Z"); assert.equal(state.modelRecoveryCycle?.status, "idle");
    assert.equal(fixture.session().status, "completed");
    assert.deepEqual(state.budgetEntries.map((entry) => entry.status), ["unknown", "unknown", "settled"]);
    assert.deepEqual(fixture.requests[0]!.messages, fixture.requests[1]!.messages);
    assert.deepEqual(fixture.requests[0]!.messages, fixture.requests[2]!.messages);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("manual and timer retry share one original request while preserving new drafts and held messages", { skip: process.platform !== "darwin" }, async () => {
  const clock = new GeneratedIntakeClock(), fixture = await setupFixture({ httpFailure: { ...upstream(), remaining: 1 }, responseMode: "text", maxOutputTokens: 128, platform: { intakeClock: clock } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.configure(); await fixture.send("Generated original retained model request."); await failed(fixture, 1); await sdk.refresh();
    await sdk.command({ type: "draft.save", sessionId: fixture.sessionId, expectedRevision: fixture.session().draft.revision, text: "Generated held later input.", attachments: [] });
    await sdk.command({ type: "message.send", sessionId: fixture.sessionId, expectedRevision: fixture.session().draft.revision, delivery: "queue", held: true });
    await sdk.command({ type: "draft.save", sessionId: fixture.sessionId, expectedRevision: fixture.session().draft.revision, text: "Generated new unsent draft.", attachments: [] }); await sdk.refresh();
    const original = fixture.service.controller.snapshot().modelFailures[0]!;
    const manual = sdk.sessions.retry(fixture.sessionId, original.id, original.revision); clock.advanceBy(30000); await manual;
    await failed(fixture, 2);
    assert.equal(fixture.session().draft.text, "Generated new unsent draft.");
    assert.equal(fixture.session().queue[0]?.text, "Generated held later input."); assert.equal(fixture.session().queue[0]?.held, true);
    assert.equal(fixture.session().messages.filter((message) => message.role === "user").length, 1);
    assert.deepEqual(fixture.requests[0]!.messages, fixture.requests[1]!.messages);
    assert.equal(JSON.stringify(fixture.requests).includes("Generated new unsent draft."), false);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("retry after a confirmed write resumes the failed model step without replaying the write or its approval", { skip: process.platform !== "darwin" }, async () => {
  const clock = new GeneratedIntakeClock(), fixture = await setupFixture({ maxOutputTokens: 128, httpFailure: { ...upstream(), afterRequests: 1, remaining: 1 },
    toolCall: { name: "write_file", args: { path: "generated-once.txt", text: "Generated one original write.\n", expectedDigest: "absent" } }, platform: { intakeClock: clock } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await reviewNativeTools(fixture, ["write_file"]); await fixture.configure(); await fixture.send("Generated original write before upstream failure.");
    await fixture.approve(); await failed(fixture, 2);
    assert.equal(await readFile(join(fixture.project, "generated-once.txt"), "utf8"), "Generated one original write.\n");
    clock.advanceBy(30000); await failed(fixture, 3);
    assert.equal(fixture.session().status, "completed");
    assert.equal(fixture.service.controller.events(0).filter((event) => event.event_type === "tool.started").length, 1);
    assert.equal(fixture.service.controller.events(0).filter((event) => event.event_type === "tool.decided").length, 1);
    assert.deepEqual(fixture.requests[1]!.messages, fixture.requests[2]!.messages);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("Stop cancels outer recovery and authentication failure never starts it", { skip: process.platform !== "darwin" }, async () => {
  for (const status of [408, 401]) {
    const clock = new GeneratedIntakeClock(), fixture = await setupFixture({ httpFailure: { status, message: status === 401 ? "Unauthorized generated credential." : "Timed out generated model." }, platform: { intakeClock: clock } });
    const sdk = await new MoguriSdk(fixture.service.connection).ready();
    try {
      await fixture.configure(); await fixture.send("Generated explicit failure boundary."); await failed(fixture, 1);
      if (status === 408) await sdk.command({ type: "session.stop", sessionId: fixture.sessionId });
      clock.advanceBy(180000); await sdk.refresh();
      assert.equal(fixture.requests.length, 1);
      assert.equal(sdk.getState().snapshot?.modelFailures[0]?.status, status === 408 ? "cancelled" : "blocked");
      assert.equal(retryFailure(fixture.session(), sdk.getState().snapshot!.modelFailures), undefined);
    } finally { sdk.disconnect(); await fixture.close(); }
  }
});

test("a later authentication error cannot inherit a transient error's manual Retry or restart the backoff", { skip: process.platform !== "darwin" }, async () => {
  const clock = new GeneratedIntakeClock(), failure = { ...upstream(), remaining: 1 };
  const fixture = await setupFixture({ httpFailure: failure, responseMode: "text", maxOutputTokens: 128, platform: { intakeClock: clock } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.configure(); await fixture.send("Generated failure becomes expired authentication."); await failed(fixture, 1);
    failure.status = 401; failure.message = "Unauthorized generated model credential."; failure.remaining = 1;
    clock.advanceBy(30000); await failed(fixture, 2); await sdk.refresh();
    assert.equal(fixture.service.controller.snapshot().modelFailures[0]?.lastRetryable, false);
    assert.equal(retryFailure(fixture.session(), fixture.service.controller.snapshot().modelFailures), undefined);
    await assert.rejects(async () => sdk.sessions.retry(fixture.sessionId), /no eligible original model failure/);
    clock.advanceBy(150000); assert.equal(fixture.requests.length, 2);
    assert.equal(fixture.service.controller.snapshot().budgetEntries.filter((entry) => entry.status === "unknown").length, 2);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("account-change intent invalidates old recovery and scheduled input without forwarding credentials or replaying prompts", { skip: process.platform !== "darwin" }, async () => {
  const clock = new GeneratedIntakeClock(), fixture = await setupFixture({ httpFailure: upstream(), responseMode: "text", maxOutputTokens: 128, platform: { intakeClock: clock } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.configure(); await fixture.send("Generated old-account model failure."); await failed(fixture, 1); await sdk.refresh();
    await sdk.command({ type: "draft.save", sessionId: fixture.sessionId, expectedRevision: fixture.session().draft.revision, text: "Generated old-account scheduled prompt.", attachments: [] });
    await sdk.scheduledPrompts.create(fixture.sessionId, { kind: "delay", minutes: 5, timeZone: "UTC" });
    await sdk.command({ type: "provider.logout" });
    await sdk.command({ type: "provider.login" });
    fixture.provider.authorize(); await sdk.refresh();
    assert.equal(retryFailure(fixture.session(), fixture.service.controller.snapshot().modelFailures), undefined);
    assert.equal(sdk.scheduledPrompts.list()[0]?.status, "blocked");
    assert.equal(fixture.service.controller.snapshot().modelRecoveryCycle?.status, "idle");
    const epochs = fixture.service.controller.events(0).filter((event) => event.event_type === "model.authorization_changed");
    assert.equal(epochs.length, 2); assert.equal(JSON.stringify(epochs).includes("generated-test-only"), false);
    clock.advanceBy(600000); await new Promise((resolve) => setTimeout(resolve, 30)); assert.equal(fixture.requests.length, 1);
    assert.equal(fixture.session().messages.filter((message) => message.role === "user").length, 1);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("a changed actual endpoint cannot substitute for an otherwise identical retained model binding", { skip: process.platform !== "darwin" }, async (t) => {
  const clock = new GeneratedIntakeClock(), fixture = await setupFixture({ httpFailure: upstream(), responseMode: "text", maxOutputTokens: 128, platform: { intakeClock: clock } });
  try {
    await fixture.configure(); await fixture.send("Generated exact endpoint-bound failure."); await failed(fixture, 1);
    const prepare = fixture.provider.prepare.bind(fixture.provider);
    t.mock.method(fixture.provider, "prepare", async (...args: Parameters<typeof prepare>) => {
      const prepared = await prepare(...args);
      return { ...prepared, auth: { ...prepared.auth, baseUrl: `${prepared.auth.baseUrl}/generated-other-endpoint` } };
    });
    clock.advanceBy(30000); await waitFor(() => !fixture.session().turnId && fixture.service.controller.snapshot().modelFailures[0]?.status === "blocked");
    assert.equal(fixture.requests.length, 1); assert.equal(fixture.service.controller.snapshot().budgetEntries.length, 1);
    assert.match(fixture.session().lastError!, /endpoint or transport changed/);
    assert.equal(retryFailure(fixture.session(), fixture.service.controller.snapshot().modelFailures), undefined);
  } finally { t.mock.restoreAll(); await fixture.close(); }
});

test("a complete retry without recorded usage stays partial, retains unknown charges and never resets or claims recovery", { skip: process.platform !== "darwin" }, async () => {
  const clock = new GeneratedIntakeClock(), configuration: GeneratedProviderOptions & { platform: { intakeClock: GeneratedIntakeClock } } = {
    httpFailure: { ...upstream(), remaining: 1 }, responseMode: "text", maxOutputTokens: 128, platform: { intakeClock: clock },
  };
  const fixture = await setupFixture(configuration);
  try {
    await fixture.configure(); await fixture.send("Generated unmetered recovery result."); await failed(fixture, 1);
    configuration.omitUsage = true; clock.advanceBy(30000); await failed(fixture, 2);
    const state = fixture.service.controller.snapshot();
    assert.equal(fixture.session().status, "partial"); assert.match(fixture.session().lastError!, /lacks complete qualified usage/);
    assert.equal(state.modelFailures[0]?.status, "blocked"); assert.equal(state.modelFailures[0]?.lastRetryable, false);
    assert.equal(state.modelRecoveryCycle?.generation, 0); assert.ok(state.budgetEntries.every((entry) => entry.status === "unknown"));
    clock.advanceBy(180000); assert.equal(fixture.requests.length, 2);
  } finally { await fixture.close(); }
});

test("a later non-model failure cannot expose an older upstream failure as the primary Retry action", { skip: process.platform !== "darwin" }, async (t) => {
  const clock = new GeneratedIntakeClock(), fixture = await setupFixture({ httpFailure: upstream(), responseMode: "text", maxOutputTokens: 128, platform: { intakeClock: clock } });
  try {
    await fixture.configure(); await fixture.send("Generated earlier retained model failure."); await failed(fixture, 1);
    assert.ok(retryFailure(fixture.session(), fixture.service.controller.snapshot().modelFailures));
    await fixture.service.controller.dispatch({ id: "generated-explicit-inspection-before-new-prompt", profileId: "default",
      command: { type: "session.resume", sessionId: fixture.sessionId } });
    t.mock.method(fixture.provider, "prepare", async () => { throw new Error("Generated later preparation failure before any model call."); });
    await fixture.send("Generated separate later prompt."); await fixture.terminal();
    assert.equal(retryFailure(fixture.session(), fixture.service.controller.snapshot().modelFailures), undefined);
    assert.equal(fixture.session().lastModelFailureId, undefined); assert.equal(fixture.requests.length, 1);
    clock.advanceBy(30000); assert.equal(fixture.requests.length, 1);
  } finally { t.mock.restoreAll(); await fixture.close(); }
});

test("earliest recovery means the oldest currently failed prompt, not an earlier completed prompt in that session", { skip: process.platform !== "darwin", timeout: 20_000 }, async () => {
  const clock = new GeneratedIntakeClock(), configuration: GeneratedProviderOptions & { platform: { intakeClock: GeneratedIntakeClock } } = {
    responseMode: "text", maxOutputTokens: 128, platform: { intakeClock: clock },
  };
  const fixture = await setupFixture(configuration), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.configure(); await fixture.send("Generated completed older prompt."); await fixture.terminal();
    assert.equal(fixture.session().status, "completed");
    configuration.httpFailure = upstream();
    const second = (await sdk.sessions.create(fixture.session().projectId, "Generated oldest currently failed prompt", { modelId: fixture.modelId })).id!;
    await sdk.command({ type: "draft.save", sessionId: second, expectedRevision: 0, text: "Generated earlier current failure.", attachments: [] });
    await sdk.command({ type: "message.send", sessionId: second, expectedRevision: 1, delivery: "queue" });
    await waitFor(() => fixture.service.controller.snapshot().sessions.find((session) => session.id === second)?.status === "failed");
    await fixture.send("Generated later current failure in historically older chat."); await failed(fixture, 3);
    clock.advanceBy(30000); await failed(fixture, 5);
    clock.advanceBy(60000); await failed(fixture, 7);
    clock.advanceBy(30000); await failed(fixture, 8);
    const state = fixture.service.controller.snapshot(), target = state.modelRecoveryCycle!.targets[0]!;
    assert.equal(state.modelFailures.find((failure) => failure.id === target.failureId)?.sessionId, second);
    assert.equal(state.modelFailures.find((failure) => failure.sessionId === fixture.sessionId)?.attemptCount, 2);
    assert.equal(state.modelFailures.find((failure) => failure.sessionId === second)?.attemptCount, 3);
    await sdk.refresh(); await sdk.sessions.autonomy(second, "Guided");
    clock.advanceBy(60000); await failed(fixture, 9);
    const final = fixture.service.controller.snapshot();
    assert.equal(final.modelFailures.find((failure) => failure.id === final.modelRecoveryCycle!.targets[0]!.failureId)?.sessionId, fixture.sessionId);
    assert.equal(final.modelFailures.find((failure) => failure.sessionId === second)?.status, "blocked");
    assert.equal(final.modelFailures.find((failure) => failure.sessionId === fixture.sessionId)?.attemptCount, 3);
  } finally { sdk.disconnect(); await fixture.close(); }
});
