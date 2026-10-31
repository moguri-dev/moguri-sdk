import test from "node:test";
import assert from "node:assert/strict";
import { MoguriSdk, scheduleLocalChoices, scheduleLocalTime, scheduledInstant } from "../packages/sdk/src/index.ts";
import { startService } from "../apps/service/src/server.ts";
import { join } from "node:path";
import { setupFixture, waitFor } from "./fixture.ts";
import { GeneratedIntakeClock } from "./fixtures/intake-clock.ts";

test("custom local schedules preserve the reviewed DST occurrence and reject nonexistent wall times", () => {
  const now = Date.parse("2030-01-01T00:00:00Z");
  assert.deepEqual(scheduleLocalTime(Date.parse("2030-10-27T00:30:00Z"), "Europe/Rome"), { localTime: "2030-10-27T02:30", offsetMinutes: 120 });
  assert.deepEqual(scheduleLocalTime(Date.parse("2030-10-27T01:30:00Z"), "Europe/Rome"), { localTime: "2030-10-27T02:30", offsetMinutes: 60 });
  assert.deepEqual(scheduleLocalChoices("2030-10-27T02:30", "Europe/Rome").map((choice) => choice.at), ["2030-10-27T00:30:00.000Z", "2030-10-27T01:30:00.000Z"]);
  assert.throws(() => scheduleLocalChoices("2030-03-31T02:30", "Europe/Rome"), /does not exist/);
  assert.equal(scheduledInstant({ kind: "at", at: "2030-10-27T01:30:00Z", timeZone: "Europe/Rome", localTime: "2030-10-27T02:30", offsetMinutes: 60 }, now).dueAt, "2030-10-27T01:30:00.000Z");
  assert.throws(() => scheduledInstant({ kind: "at", at: "2030-03-31T01:30:00Z", timeZone: "Europe/Rome", localTime: "2030-03-31T02:30", offsetMinutes: 60 }, now), /DST/);
  assert.throws(() => scheduledInstant({ kind: "delay", minutes: 5, timeZone: "Generated/Invalid" }, now), /timezone/);
  assert.throws(() => scheduledInstant({ kind: "at", at: "2029-01-01T00:00:00Z", timeZone: "UTC", localTime: "2029-01-01T00:00", offsetMinutes: 0 }, now), /future/);
});

test("overdue schedules reopen once under their original profile, saved input and retained attachment grants", { skip: process.platform !== "darwin" }, async () => {
  const clock = new GeneratedIntakeClock(), fixture = await setupFixture({ responseMode: "text", maxOutputTokens: 128, platform: { intakeClock: clock } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  let reopened: Awaited<ReturnType<typeof startService>> | undefined, consumer: MoguriSdk | undefined;
  try {
    await fixture.configure(); await sdk.refresh();
    await sdk.command({ type: "draft.save", sessionId: fixture.sessionId, expectedRevision: fixture.session().draft.revision, text: "Generated retained schedule.", attachments: [] });
    await sdk.attachments.file(fixture.sessionId, join(fixture.project, "fixture.txt"));
    const created = await sdk.scheduledPrompts.create(fixture.sessionId, { kind: "delay", minutes: 5, timeZone: "UTC" });
    await sdk.refresh();
    const original = sdk.scheduledPrompts.list()[0]!, originalAttachment = original.attachments[0]!;
    sdk.disconnect(); await fixture.service.close(); clock.advanceBy(600_000);
    reopened = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey, platform: { intakeClock: clock } });
    assert.equal(reopened.store.blob(originalAttachment.digest), "generated original\n");
    consumer = await new MoguriSdk(reopened.connection).ready();
    clock.advanceBy(0);
    await waitFor(() => reopened!.controller.snapshot().scheduledPrompts[0]?.status === "admitted");
    await waitFor(() => reopened!.controller.snapshot().sessions[0]?.status === "completed");
    await consumer.refresh();
    assert.equal(fixture.requests.length, 1);
    assert.equal(consumer.scheduledPrompts.list()[0]?.id, created.id);
    assert.match(JSON.stringify(fixture.requests[0]), /generated original/);
    assert.equal(reopened.controller.events(0).filter((event) => event.event_type === "queue.enqueued" && event.payload.item.id === created.id).length, 1);
    clock.advanceBy(86400_000);
    assert.equal(fixture.requests.length, 1);
  } finally { consumer?.disconnect(); await reopened?.close(); sdk.disconnect(); await fixture.close(); }
});

test("explicit Stop pauses scheduled input and archive cancels it without another model call", async () => {
  const clock = new GeneratedIntakeClock(), fixture = await setupFixture({ platform: { intakeClock: clock } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.configure(); await sdk.refresh();
    await sdk.command({ type: "draft.save", sessionId: fixture.sessionId, expectedRevision: fixture.session().draft.revision, text: "Generated stopped schedule.", attachments: [] });
    await sdk.scheduledPrompts.create(fixture.sessionId, { kind: "delay", minutes: 5, timeZone: "UTC" });
    await sdk.command({ type: "session.stop", sessionId: fixture.sessionId });
    clock.advanceBy(300_000); await sdk.refresh();
    assert.equal(sdk.scheduledPrompts.list()[0]?.status, "blocked"); assert.equal(fixture.requests.length, 0);
    await sdk.command({ type: "session.archive", sessionId: fixture.sessionId }); await sdk.refresh();
    assert.equal(sdk.scheduledPrompts.list()[0]?.status, "cancelled");
    await assert.rejects(() => sdk.scheduledPrompts.sendNow(sdk.scheduledPrompts.list()[0]!.id), /cancelled/);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("a scheduled prompt stays outside history and admission until its exact service-owned deadline", { skip: process.platform !== "darwin" }, async () => {
  const clock = new GeneratedIntakeClock();
  const fixture = await setupFixture({ responseMode: "text", maxOutputTokens: 128, platform: { intakeClock: clock } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.configure(); await sdk.refresh();
    await sdk.command({ type: "draft.save", sessionId: fixture.sessionId, expectedRevision: fixture.session().draft.revision, text: "Generated scheduled original.", attachments: [] });
    const created = await sdk.scheduledPrompts.create(fixture.sessionId, { kind: "delay", minutes: 5, timeZone: "Europe/Rome" });
    await sdk.refresh();
    assert.equal(sdk.scheduledPrompts.list()[0]?.id, created.id);
    assert.equal(sdk.scheduledPrompts.list()[0]?.localTime, "2030-01-01T11:05");
    assert.equal(fixture.session().messages.length, 0); assert.equal(fixture.session().queue.length, 0); assert.equal(fixture.requests.length, 0);
    assert.equal(fixture.session().draft.text, "");
    await sdk.command({ type: "draft.save", sessionId: fixture.sessionId, expectedRevision: fixture.session().draft.revision, text: "Generated new unsent draft.", attachments: [] });
    clock.advanceBy(299_999);
    assert.equal(fixture.requests.length, 0); assert.equal(fixture.session().messages.length, 0);
    clock.advanceBy(1);
    await waitFor(() => fixture.requests.length === 1); await fixture.terminal(); await sdk.refresh();
    assert.equal(sdk.scheduledPrompts.list()[0]?.status, "admitted");
    assert.equal(fixture.session().messages.filter((message) => message.role === "user").length, 1);
    assert.equal(fixture.session().draft.text, "Generated new unsent draft.");
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("timer and concurrent Send now claim only one original prompt without consuming a newer draft", { skip: process.platform !== "darwin" }, async () => {
  const clock = new GeneratedIntakeClock(), fixture = await setupFixture({ responseMode: "text", maxOutputTokens: 128, platform: { intakeClock: clock } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.configure(); await sdk.refresh();
    await sdk.command({ type: "draft.save", sessionId: fixture.sessionId, expectedRevision: fixture.session().draft.revision, text: "Generated one-shot schedule.", attachments: [] });
    const created = await sdk.scheduledPrompts.create(fixture.sessionId, { kind: "delay", minutes: 5, timeZone: "UTC" });
    await sdk.refresh();
    const original = sdk.scheduledPrompts.list()[0]!;
    const sends = [sdk.scheduledPrompts.sendNow(original.id, original.revision), sdk.scheduledPrompts.sendNow(original.id, original.revision)];
    clock.advanceBy(300_000);
    await Promise.all(sends); await fixture.terminal(); await sdk.refresh();
    assert.equal(fixture.requests.length, 1);
    assert.equal(fixture.session().messages.filter((message) => message.id === created.id).length, 1);
    assert.equal(fixture.service.controller.events(0).filter((event) => event.event_type === "queue.enqueued" && event.payload.item.id === created.id).length, 1);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("cancellation and changed controls retain unsent scheduling ownership", async () => {
  const clock = new GeneratedIntakeClock(), fixture = await setupFixture({ responseMode: "text", platform: { intakeClock: clock } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.configure(); await sdk.refresh();
    await sdk.command({ type: "draft.save", sessionId: fixture.sessionId, expectedRevision: fixture.session().draft.revision, text: "Generated cancelled schedule.", attachments: [] });
    const first = await sdk.scheduledPrompts.create(fixture.sessionId, { kind: "delay", minutes: 5, timeZone: "UTC" });
    await sdk.refresh(); await sdk.scheduledPrompts.cancel(first.id!);
    await sdk.command({ type: "draft.save", sessionId: fixture.sessionId, expectedRevision: fixture.session().draft.revision, text: "Generated changed schedule.", attachments: [] });
    await sdk.scheduledPrompts.create(fixture.sessionId, { kind: "delay", minutes: 5, timeZone: "UTC" });
    await sdk.sessions.autonomy(fixture.sessionId, "Guided"); clock.advanceBy(300_000); await sdk.refresh();
    assert.deepEqual(sdk.scheduledPrompts.list().map((entry) => entry.status), ["cancelled", "blocked"]);
    assert.equal(fixture.requests.length, 0); assert.equal(fixture.session().queue.length, 0);
    assert.match(sdk.scheduledPrompts.list()[1]!.diagnostic!, /changed/);
  } finally { sdk.disconnect(); await fixture.close(); }
});
