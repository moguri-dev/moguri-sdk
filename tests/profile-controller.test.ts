import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventStore } from "../apps/service/src/store.ts";
import { ControlPlane, envelope } from "../apps/service/src/controller.ts";
import { fixtureProvider, waitFor } from "./fixture.ts";

test("immutable profile controllers isolate real model turns, drafts, artifacts, derived attention and budget owners", { skip: process.platform !== "darwin" }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "moguri-generated-profile-controllers-")), stateA = join(directory, "state-a"), stateB = join(directory, "state-b");
  await mkdir(stateA, { mode: 0o700 }); await mkdir(stateB, { mode: 0o700 });
  const key = Buffer.alloc(32, 0x69), path = join(directory, "state.sqlite"), alpha = new EventStore(path, key, "generated-profile-master", "default"), beta = new EventStore(path, key, "generated-profile-master", "generated-beta");
  const providerA = await fixtureProvider({ maxOutputTokens: 128 }), providerB = await fixtureProvider({ maxOutputTokens: 128 });
  const first = new ControlPlane(alpha, providerA.provider, undefined, { stateDir: stateA }), second = new ControlPlane(beta, providerB.provider, undefined, { stateDir: stateB });
  try {
    await first.initialize(); await second.initialize();
    const command = { type: "session.create" as const, projectId: null };
    const a = await first.dispatch({ id: "generated-same-client-command", profileId: "default", command });
    const b = await second.dispatch({ id: "generated-same-client-command", profileId: "generated-beta", command });
    assert.notEqual(a.id, b.id); assert.equal(second.snapshot().profileId, "generated-beta");
    assert.equal(first.snapshot().sessions.length, 1); assert.equal(second.snapshot().sessions.length, 1);
    await assert.rejects(() => first.dispatch(envelope({ type: "session.organize", sessionId: a.id!, expectedRevision: 0, changes: { title: "Generated wrong scope" } }, "generated-beta")), /another profile/);
    await assert.rejects(() => second.dispatch(envelope({ type: "session.organize", sessionId: a.id!, expectedRevision: 0, changes: { title: "Generated foreign lookup" } }, "generated-beta")), /outside this profile/);
    const artifact = await first.dispatch(envelope({ type: "artifact.create", sessionId: a.id!, kind: "decision", name: "Generated private alpha decision", text: "Generated profile A private body." }));
    await assert.rejects(() => second.platform.query({ type: "artifact.read", artifactId: artifact.id! }), /outside this profile/);
    for (const [control, sessionId, profileId, modelId, text] of [
      [first, a.id!, "default", providerA.modelId, "Generated isolated profile alpha question."],
      [second, b.id!, "generated-beta", providerB.modelId, "Generated isolated profile beta question."],
    ] as const) {
      const session = control.snapshot().sessions.find((session) => session.id === sessionId)!;
      await control.dispatch(envelope({ type: "session.configure", sessionId, expectedRevision: session.revision, controls: { ...session.controls, modelId } }, profileId));
      await control.dispatch(envelope({ type: "draft.save", sessionId, expectedRevision: 0, text, attachments: [] }, profileId));
      await control.dispatch(envelope({ type: "message.send", sessionId, expectedRevision: 1, delivery: "queue" }, profileId));
    }
    await waitFor(() => first.snapshot().sessions[0]?.status === "completed" && second.snapshot().sessions[0]?.status === "completed");
    assert.equal(providerA.requests.length, 1); assert.equal(providerB.requests.length, 1);
    assert.equal(first.snapshot().budgetEntries[0]?.sessionId, a.id);
    assert.equal(second.snapshot().budgetEntries[0]?.sessionId, b.id);
    assert.equal(first.snapshot().budgetEntries.length, 1); assert.equal(second.snapshot().budgetEntries.length, 1);
    assert.equal(first.snapshot().attention[0]?.sessionId, a.id); assert.equal(second.snapshot().attention[0]?.sessionId, b.id);
    assert.ok(second.events(0).every((event) => event.profile_id === "generated-beta"));
    await first.dispatch(envelope({ type: "session.delete", sessionId: a.id!, expectedRevision: first.snapshot().sessions[0]!.revision, confirm: true }));
    assert.equal(second.snapshot().sessions[0]?.id, b.id);
    assert.equal(second.platform.budgets.status(b.id!).totals.reportedTokens, 42);
    assert.equal((await first.platform.query({ type: "artifact.read", artifactId: artifact.id! })).type, "artifact.read");
  } finally {
    await first.close(); await second.close(); alpha.close(); beta.close();
    await providerA.close(); await providerB.close(); await rm(directory, { recursive: true, force: true });
  }
});
