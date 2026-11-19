import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { MoguriSdk, describeInterruption, executeInterruptedCommand } from "../packages/sdk/src/index.ts";
import { startService } from "../apps/service/src/server.ts";
import { EventStore } from "../apps/service/src/store.ts";
import { setupFixture, waitFor } from "./fixture.ts";
import { removeAutomationsFixtureMarker } from "./fixtures/legacy-state.ts";

type Fixture = Awaited<ReturnType<typeof setupFixture>>;
const reopen = (fixture: Fixture) => startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey });
const chat = (service: Awaited<ReturnType<typeof reopen>>, id: string) => service.controller.snapshot().sessions.find((session) => session.id === id)!;
async function interruptedFixture() {
  const fixture = await setupFixture({ responseMode: "text", maxOutputTokens: 128 });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  await fixture.configure(); await sdk.refresh();
  await fixture.send("Please answer generated slow interrupted task.");
  await waitFor(() => fixture.requests.length === 1 && fixture.session().turnId !== null);
  const turnId = fixture.session().turnId!;
  await fixture.send("Generated prompt waiting behind the running turn.");
  await sdk.command({ type: "draft.save", sessionId: fixture.sessionId, expectedRevision: fixture.session().draft.revision, text: "Generated prompt the user held.", attachments: [] });
  await sdk.command({ type: "message.send", sessionId: fixture.sessionId, expectedRevision: fixture.session().draft.revision, delivery: "queue", held: true });
  await waitFor(() => fixture.session().queue.length === 2);
  const [waiting, held] = fixture.session().queue;
  sdk.disconnect();
  return { fixture, turnId, waiting: waiting!, held: held! };
}

test("a quit records the running turn and waiting prompts, and Continue resumes them ahead of user-held prompts without replay", { skip: process.platform !== "darwin" }, async () => {
  const { fixture, turnId, waiting, held } = await interruptedFixture();
  let service: Awaited<ReturnType<typeof reopen>> | undefined, sdk: MoguriSdk | undefined;
  try {
    await fixture.service.close();
    service = await reopen(fixture);
    const interrupted = chat(service, fixture.sessionId);
    assert.deepEqual({ ...interrupted.interruption, at: undefined }, { cause: "shutdown", turnId, queuedItemIds: [waiting.id], at: undefined });
    assert.equal(describeInterruption(interrupted.interruption!), "Stopped mid-turn when Moguri quit, with 1 queued prompt waiting");
    assert.deepEqual(interrupted.queue.map((item) => [item.id, item.held]), [[waiting.id, true], [held.id, true]]);
    assert.equal(fixture.requests.length, 1, "nothing ran after the restart");
    assert.throws(() => removeAutomationsFixtureMarker(new DatabaseSync(":memory:"), service!.controller.events(0)), /pre-114/);
    sdk = await new MoguriSdk(service.connection).ready();
    assert.deepEqual(sdk.sessions.interrupted().map((session) => session.id), [fixture.sessionId]);
    assert.match(await executeInterruptedCommand(sdk, "list"), /1 interrupted chat:\n[0-9a-f]{8} New session: Stopped mid-turn when Moguri quit/);
    const continued = await sdk.sessions.continueInterrupted(fixture.sessionId);
    await waitFor(() => fixture.requests.length === 2);
    const request = JSON.stringify(fixture.requests[1]!.messages);
    assert.match(request, /moguri-workflow name=\\"continue\\"/);
    assert.match(request, /Please answer generated slow interrupted task\./);
    await waitFor(() => fixture.requests.length === 3);
    assert.match(JSON.stringify((fixture.requests[2]!.messages as unknown[]).at(-1)), /Generated prompt waiting behind the running turn\./);
    await waitFor(() => chat(service!, fixture.sessionId).turnId === null);
    const after = chat(service, fixture.sessionId);
    assert.equal(after.interruption, undefined);
    assert.deepEqual(after.queue.map((item) => [item.id, item.held]), [[held.id, true]], "the prompt the user held stays held");
    assert.ok(after.messages.some((message) => message.id === continued.id));
    await assert.rejects(() => sdk!.sessions.continueInterrupted(fixture.sessionId), /no interrupted work/);
  } finally { sdk?.disconnect(); await service?.close(); await fixture.close(); }
});

test("a crash restart records the unfinished turn, Dismiss forgets it, and an explicit Resume also settles a later one", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture({ responseMode: "text", maxOutputTokens: 128 });
  let service: Awaited<ReturnType<typeof reopen>> | undefined, sdk: MoguriSdk | undefined;
  try {
    await fixture.configure();
    const stateDir = join(fixture.directory, "state"), session = fixture.session();
    await fixture.service.close();
    const store = new EventStore(join(stateDir, "state.sqlite"), fixture.retentionKey);
    const scope = { profile_id: "default", project_id: session.projectId, session_id: fixture.sessionId };
    const item = { id: "generated-crashed-item", text: "Generated task interrupted by a crash.", attachments: [], delivery: "queue" as const };
    store.commit([{ ...scope, event_type: "queue.enqueued", payload: { item } },
      { ...scope, turn_id: "generated-crashed-turn", event_type: "turn.started", payload: { item, controls: session.controls, policyRevision: 0 } },
      { ...scope, turn_id: "generated-crashed-turn", step_id: "generated-crashed-step", event_type: "model.started", payload: { modelId: fixture.modelId } }]);
    store.close();
    service = await reopen(fixture);
    const interrupted = chat(service, fixture.sessionId);
    assert.equal(interrupted.interruption?.cause, "restart"); assert.equal(interrupted.interruption?.turnId, "generated-crashed-turn");
    assert.equal(describeInterruption(interrupted.interruption!), "Stopped mid-turn when Moguri restarted");
    sdk = await new MoguriSdk(service.connection).ready();
    await sdk.sessions.dismissInterruption(fixture.sessionId); await sdk.refresh();
    assert.equal(sdk.sessions.interrupted().length, 0); assert.equal(fixture.requests.length, 0);
    await assert.rejects(() => sdk!.sessions.continueInterrupted(fixture.sessionId), /no interrupted work/);
    await service.close(); service = undefined;
    const store2 = new EventStore(join(stateDir, "state.sqlite"), fixture.retentionKey);
    const turn = { ...scope, turn_id: "generated-second-crash" }, second = { ...item, id: "generated-second-item", text: "Generated second interrupted task." };
    store2.commit([{ ...scope, event_type: "queue.enqueued", payload: { item: second } },
      { ...turn, event_type: "turn.started", payload: { item: second, controls: session.controls, policyRevision: 0 } }]);
    store2.close();
    service = await reopen(fixture);
    assert.equal(chat(service, fixture.sessionId).interruption?.turnId, "generated-second-crash");
    sdk.disconnect(); sdk = await new MoguriSdk(service.connection).ready();
    await sdk.command({ type: "session.resume", sessionId: fixture.sessionId });
    assert.equal(chat(service, fixture.sessionId).interruption, undefined, "an explicit Resume also settles the interruption");
  } finally { sdk?.disconnect(); await service?.close(); await fixture.close(); }
});

test("with Continue all automatically saved, a restart continues interrupted chats once without asking", { skip: process.platform !== "darwin" }, async () => {
  const { fixture, waiting } = await interruptedFixture();
  let service: Awaited<ReturnType<typeof reopen>> | undefined, sdk: MoguriSdk | undefined;
  try {
    sdk = await new MoguriSdk(fixture.service.connection).ready();
    assert.match(await executeInterruptedCommand(sdk, "always"), /continues interrupted chats automatically/);
    sdk.disconnect(); sdk = undefined;
    await fixture.service.close();
    service = await reopen(fixture);
    await waitFor(() => fixture.requests.length === 3);
    assert.match(JSON.stringify(fixture.requests[1]!.messages), /moguri-workflow name=\\"continue\\"/);
    assert.match(JSON.stringify((fixture.requests[2]!.messages as unknown[]).at(-1)), new RegExp(waiting.text.replaceAll(".", "\\.")));
    await waitFor(() => chat(service!, fixture.sessionId).turnId === null);
    assert.equal(chat(service, fixture.sessionId).interruption, undefined);
    await service.close(); service = await reopen(fixture);
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(fixture.requests.length, 3, "a later clean restart continues nothing again");
  } finally { sdk?.disconnect(); await service?.close(); await fixture.close(); }
});
