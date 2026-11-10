import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { waitFor } from "./fixture.ts";
import { defaultSandboxManagement } from "../packages/sdk/src/index.ts";
import type { SandboxDns } from "../apps/service/src/sandbox-network.ts";
import { frameDigest } from "../apps/service/src/worker-wire.ts";
import { automaticFixture } from "./fixtures/automatic-sandbox.ts";

const native = { skip: process.platform !== "darwin", timeout: 20_000 };

test("managed Send automatically snapshots the complete bound project and captures actual provider aliases before guest admission", native, async (context) => {
  const fixture = await automaticFixture(context);
  try {
    await writeFile(join(fixture.project, "generated-extra.txt"), "Generated automatically included.\n");
    await fixture.send("Generated automatic Sandbox prompt.");
    await waitFor(() => fixture.executions[0]);
    const execution = fixture.executions[0]!;
    assert.equal(execution.sourceRoot, await import("node:fs/promises").then((fs) => fs.realpath(fixture.project)));
    assert.equal(execution.root, "/workspace");
    assert.equal(await readFile(join(execution.stage.workspace, "generated-extra.txt"), "utf8"), "Generated automatically included.\n");
    assert.deepEqual(execution.networkScope?.providerHosts, ["api.individual.githubcopilot.com"]);
    assert.ok(execution.config.qualification!.allowedDomains.includes("generated-edge.github.com"));
    assert.equal(execution.config.qualification!.allowedDomains.includes("google.com"), false);
    const state = fixture.controller.snapshot(), workspace = state.sandboxWorkspaces!.find((value) => value.id === execution.workspaceId)!;
    const owner = workspace.preparation;
    assert.ok(owner?.version === 4); assert.equal(owner.kind, "turn-admission"); assert.equal(owner.turnId, execution.turnId);
    const capture = state.checkpointCaptures.find((capture) => capture.id === owner.captureId);
    const admitted = fixture.controller.events(0).find((event) => event.event_type === "turn.started" && event.turn_id === execution.turnId);
    assert.ok(capture); assert.ok(admitted?.event_type === "turn.started");
    assert.equal(capture.phase, "before"); assert.equal(capture.status, "consumed");
    assert.equal(capture.consumedByEventId, admitted.id); assert.equal(capture.source.kind, "queue");
    assert.equal(capture.source.id, admitted.payload.item.id); assert.equal(capture.source.digest, frameDigest(admitted.payload.item));
    assert.equal(capture.checkpointId, owner.checkpointId); assert.equal(capture.turnId, execution.turnId);
    const before = JSON.parse(fixture.service.store.blob(capture.workspaceDigest!));
    assert.equal(before.boundary.workspaceId, workspace.id); assert.equal(before.boundary.inputDigest, execution.inputDigest);
    assert.equal(execution.inputDigest, workspace.inputDigest); assert.deepEqual(execution.stage, workspace.stage);
    assert.equal(fixture.requests.length, 0);
  } finally { await fixture.close(); }
});

test("project-free managed chats prepare an empty root-less workspace without inheriting any project", native, async (context) => {
  const fixture = await automaticFixture(context);
  try {
    const created = await fixture.sdk.sessions.create(null, "Generated automatic root-less", { env: "Sandbox", modelId: fixture.modelId });
    await fixture.sdk.command({ type: "draft.save", sessionId: created.id!, expectedRevision: 0, text: "Generated root-less prompt.", attachments: [] });
    await fixture.sdk.command({ type: "message.send", sessionId: created.id!, expectedRevision: 1, delivery: "queue" });
    await waitFor(() => fixture.executions[0]);
    assert.equal(fixture.executions[0]!.sourceRoot, null); assert.equal(fixture.executions[0]!.root, null);
    const input = fixture.controller.sandboxWorkspaces.document(fixture.executions[0]!);
    assert.equal(input.version, 2); assert.equal(input.source, null);
    if (input.version === 2) assert.equal(input.workingSource.files.length, 0);
    assert.equal(fixture.requests.length, 0);
  } finally { await fixture.close(); }
});

test("Stop during provider preparation owns cancellation, holds later prompts and never launches a guest or paid role", native, async (context) => {
  const fixture = await automaticFixture(context), entered = Promise.withResolvers<void>();
  context.mock.method(fixture.provider, "prepare", async (_id: string, signal: AbortSignal) => {
    entered.resolve();
    await new Promise<void>((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
    throw new Error("Generated unreachable.");
  });
  try {
    await fixture.send("Generated waiting native turn."); await entered.promise;
    await fixture.send("Generated next queued prompt.");
    await fixture.sdk.command({ type: "session.stop", sessionId: fixture.sessionId });
    await waitFor(() => fixture.session().status === "stopped");
    assert.equal(fixture.executions.length, 0); assert.equal(fixture.requests.length, 0);
    assert.equal(fixture.session().queue.length, 1); assert.equal(fixture.session().queue[0]!.held, true);
    assert.equal(fixture.controller.snapshot().budgetEntries.length, 0);
  } finally { await fixture.close(); }
});

test("revoked provider-network policy during DNS resolution blocks admission without substituting a worker", native, async (context) => {
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const resolver: SandboxDns = { aliases: async () => [], addresses: async () => { entered.resolve(); await release.promise; return ["1.1.1.1"]; } };
  const fixture = await automaticFixture(context, resolver);
  try {
    await fixture.send("Generated revoked pending provider."); await entered.promise;
    const settings = fixture.sdk.settings.get()!;
    await fixture.sdk.settings.update({ ...settings.values, sandboxManagement: { ...defaultSandboxManagement(), enabled: true, automaticProviderNetwork: false } }, settings.revision);
    release.resolve();
    await waitFor(() => fixture.session().status === "failed");
    assert.equal(fixture.executions.length, 0); assert.equal(fixture.requests.length, 0);
    assert.match(fixture.session().lastError!, /scope|policy|changed/);
  } finally { release.resolve(); await fixture.close(); }
});

test("session deletion waits for the exact native admission to acknowledge cancellation before forgetting its state", native, async (context) => {
  const fixture = await automaticFixture(context), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  context.mock.method(fixture.provider, "prepare", async () => {
    entered.resolve(); await release.promise;
    throw new Error("Generated delayed metadata cancellation acknowledged.");
  });
  let deleting: Promise<{ error: unknown }> | undefined;
  try {
    await fixture.send("Generated delete during native admission."); await entered.promise;
    await waitFor(() => fixture.sdk.getState().snapshot!.sessions.find((session) => session.id === fixture.sessionId)?.revision === fixture.session().revision);
    let deleted = false;
    deleting = fixture.sdk.sessions.delete(fixture.sessionId, true).then(() => { deleted = true; return { error: undefined }; }, (error: unknown) => ({ error }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(deleted, false, "Pending owned native metadata/copy work cannot outlive successful session deletion.");
    assert.ok(fixture.controller.snapshot().sessions.some((session) => session.id === fixture.sessionId));
    release.resolve(); const outcome = await deleting;
    if (outcome.error !== undefined) throw outcome.error;
    assert.equal(fixture.controller.snapshot().sessions.some((session) => session.id === fixture.sessionId), false);
    assert.equal(fixture.executions.length, 0); assert.equal(fixture.requests.length, 0);
  } finally { release.resolve(); await deleting; await fixture.close(); }
});

test("unacknowledged native cancellation refuses deletion and preserves the session until its original owner settles", native, async (context) => {
  const fixture = await automaticFixture(context), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  context.mock.method(fixture.provider, "prepare", async () => {
    entered.resolve(); await release.promise;
    throw new Error("Generated delayed metadata cancellation acknowledged.");
  });
  try {
    await fixture.send("Generated unacknowledged native cancellation."); await entered.promise;
    await waitFor(() => fixture.sdk.getState().snapshot!.sessions.find((session) => session.id === fixture.sessionId)?.revision === fixture.session().revision);
    await assert.rejects(fixture.sdk.sessions.delete(fixture.sessionId, true), { code: "cleanup_unconfirmed" });
    assert.ok(fixture.controller.snapshot().sessions.some((session) => session.id === fixture.sessionId));
    release.resolve(); await waitFor(() => fixture.session().status === "stopped");
    assert.equal(fixture.executions.length, 0); assert.equal(fixture.requests.length, 0);
    assert.equal(fixture.controller.snapshot().budgetEntries.length, 0);
  } finally { release.resolve(); await fixture.close(); }
});
