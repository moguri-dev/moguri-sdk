import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, rename, rmdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { defaultSandboxManagement, MoguriSdk } from "../packages/sdk/src/index.ts";
import { envelope } from "../apps/service/src/controller.ts";
import { startService } from "../apps/service/src/server.ts";
import { nativeConfiguration } from "./fixtures/native-target.ts";
import { nativeApiFixture } from "./fixtures/native-api.ts";
import { GeneratedIntakeClock } from "./fixtures/intake-clock.ts";
import { waitFor } from "./fixture.ts";

const native = await nativeConfiguration();
test("native backoff restages only its original signed private bytes, preserving current live source, draft and unknown original charge", { skip: !native, timeout: 90000 }, async () => {
  assert.ok(native);
  const clock = new GeneratedIntakeClock(), f = await nativeApiFixture(native, { intakeClock: clock, behavior: "recover-once" });
  let passed = false;
  try {
    const settings = structuredClone(f.sdk.settings.get()!);
    settings.values.sandbox = f.reviewedConfiguration;
    settings.values.sandboxManagement = { ...defaultSandboxManagement(), enabled: true, automaticUpdates: false };
    settings.values.interactions.nativeRetryRestaging = true;
    await f.sdk.settings.update(settings.values, settings.revision); await f.sdk.sandbox.probe();
    const project = await f.sdk.projects.add(f.project), created = await f.sdk.sessions.create(project.id!, "Generated exact native retry",
      { env: "Sandbox", modelId: f.provider.modelId });
    const session = () => f.service.controller.snapshot().sessions.find((session) => session.id === created.id)!;
    await f.sdk.command({ type: "draft.save", sessionId: created.id!, expectedRevision: 0, text: "generated native recovery exact snapshot", attachments: [] });
    await f.sdk.command({ type: "message.send", sessionId: created.id!, expectedRevision: 1, delivery: "queue" });
    await waitFor(() => session().status === "failed" && !session().turnId, 30000);
    const original = f.service.controller.snapshot().modelFailures[0]!, first = f.service.controller.snapshot().sandboxExecutions![0]!;
    assert.equal(first.cleanup, "owned-guest-stopped"); assert.equal(original.status, "pending");
    const captured = JSON.parse(f.service.store.blob(original.requestDigest!));
    assert.equal(captured.version, 2); assert.equal(captured.nativeOrigin.executionId, first.id);
    await writeFile(join(f.project, "fixture.txt"), "Generated changed live checkout must never enter retry.\n");
    await f.sdk.command({ type: "draft.save", sessionId: created.id!, expectedRevision: session().draft.revision, text: "Generated newer untouched draft.", attachments: [] });
    clock.advanceBy(30000);
    await waitFor(() => !session().turnId && ["completed", "failed", "partial"].includes(session().status) &&
      f.service.controller.snapshot().modelFailures[0]?.status !== "pending", 30000);
    const state = f.service.controller.snapshot();
    assert.equal(session().status, "completed", session().lastError ?? "");
    assert.equal(state.modelFailures[0]?.status, "recovered"); assert.equal(state.modelFailures[0]?.requestDigest, original.requestDigest);
    assert.equal(state.sandboxExecutions!.length, 2); assert.ok(state.sandboxExecutions!.every((entry) => entry.cleanup === "owned-guest-stopped"));
    const retry = state.sandboxWorkspaces!.find((entry) => entry.preparation?.version === 3)!;
    assert.ok(retry.stage); assert.equal(retry.preparation?.kind, "retry");
    assert.equal(await readFile(join(retry.stage.workspace, "fixture.txt"), "utf8"), "generated source original\n");
    assert.equal(await readFile(join(f.project, "fixture.txt"), "utf8"), "Generated changed live checkout must never enter retry.\n");
    assert.equal(session().draft.text, "Generated newer untouched draft."); assert.equal(session().messages.filter((message) => message.role === "user").length, 1);
    assert.deepEqual(state.budgetEntries.map((entry) => [entry.env, entry.status, entry.reportedTokens]), [["Sandbox", "unknown", null], ["Sandbox", "settled", 42]]);
    assert.equal(f.service.controller.events(0).some((event) => event.event_type === "tool.started"), false);
    assert.equal(f.provider.requests.length, 0); passed = true;
  } finally { await f.close(passed); }
});

test("native retry needs actual opt-in and concurrent manual clients retain only one original attempt", { skip: !native, timeout: 90000 }, async () => {
  assert.ok(native);
  const f = await nativeApiFixture(native, { behavior: "recover-once" });
  let passed = false, second: MoguriSdk | undefined;
  try {
    const settings = structuredClone(f.sdk.settings.get()!);
    settings.values.sandbox = f.reviewedConfiguration; settings.values.sandboxManagement = { ...defaultSandboxManagement(), enabled: true, automaticUpdates: false };
    await f.sdk.settings.update(settings.values, settings.revision); await f.sdk.sandbox.probe();
    const project = await f.sdk.projects.add(f.project), created = await f.sdk.sessions.create(project.id!, "Generated manually reviewed native retry", { env: "Sandbox", modelId: f.provider.modelId });
    const id = created.id!, session = () => f.service.controller.snapshot().sessions.find((session) => session.id === id)!;
    await f.sdk.command({ type: "draft.save", sessionId: id, expectedRevision: 0, text: "generated native recovery policy", attachments: [] });
    await f.sdk.command({ type: "message.send", sessionId: id, expectedRevision: 1, delivery: "queue" });
    await waitFor(() => session().status === "failed" && !session().turnId, 30000);
    const failure = f.service.controller.snapshot().modelFailures[0]!;
    await assert.rejects(() => f.sdk.sessions.retry(id, failure.id, failure.revision), /enable|policy|restaging/i);
    assert.equal(f.service.controller.snapshot().sandboxExecutions!.length, 1);
    const enabled = structuredClone(f.sdk.settings.get()!); enabled.values.interactions.nativeRetryRestaging = true;
    await f.sdk.settings.update(enabled.values, enabled.revision); second = await new MoguriSdk(f.service.connection).ready();
    const retainedRoot = `${f.project}-generated-original`;
    await rename(f.project, retainedRoot);
    try {
      await mkdir(f.project);
      const unchanged = f.service.controller.snapshot().modelFailures[0]!;
      await assert.rejects(() => f.sdk.sessions.retry(id, unchanged.id, unchanged.revision), /root|boundary|source|changed/i);
    } finally { await rmdir(f.project); await rename(retainedRoot, f.project); }
    assert.equal(f.service.controller.snapshot().sandboxExecutions!.length, 1);
    const current = f.service.controller.snapshot().modelFailures[0]!;
    const replies = await Promise.all([f.sdk.sessions.retry(id, current.id, current.revision), second.sessions.retry(id, current.id, current.revision)]);
    assert.equal(replies[0].id, replies[1].id);
    await waitFor(() => session().status === "completed" && !session().turnId, 30000);
    const state = f.service.controller.snapshot();
    assert.equal(state.sandboxExecutions!.length, 2); assert.equal(state.modelFailures[0]!.attemptCount, 1);
    assert.deepEqual(state.budgetEntries.map((entry) => [entry.status, entry.reportedTokens]), [["unknown", null], ["settled", 42]]);
    assert.equal(f.provider.requests.length, 0); passed = true;
  } finally { second?.disconnect(); await f.close(passed); }
});

test("Stop during owned native retry preparation survives a real service restart without stage, model or charge replay", { skip: !native, timeout: 90000 }, async () => {
  assert.ok(native);
  const clock = new GeneratedIntakeClock(), f = await nativeApiFixture(native, { behavior: "recover-once", intakeClock: clock });
  let passed = false, stop: Promise<unknown> | undefined, sessionId = "", restarted: Awaited<ReturnType<typeof startService>> | undefined;
  const change = (events: ReturnType<typeof f.service.controller.events>) => {
    if (!stop && events.some((event) => event.event_type === "sandbox.workspace_recorded" && event.payload.workspace.sessionId === sessionId &&
      event.payload.workspace.preparation?.version === 3 && event.payload.workspace.status === "preparing")) {
      stop = f.service.controller.dispatch(envelope({ type: "session.stop", sessionId }));
    }
  };
  try {
    const settings = structuredClone(f.sdk.settings.get()!);
    settings.values.sandbox = f.reviewedConfiguration; settings.values.sandboxManagement = { ...defaultSandboxManagement(), enabled: true, automaticUpdates: false };
    settings.values.interactions.nativeRetryRestaging = true;
    await f.sdk.settings.update(settings.values, settings.revision); await f.sdk.sandbox.probe();
    const project = await f.sdk.projects.add(f.project), created = await f.sdk.sessions.create(project.id!, "Generated stopped private retry", { env: "Sandbox", modelId: f.provider.modelId });
    sessionId = created.id!; const session = () => f.service.controller.snapshot().sessions.find((session) => session.id === sessionId)!;
    await f.sdk.command({ type: "draft.save", sessionId, expectedRevision: 0, text: "generated native recovery stop", attachments: [] });
    await f.sdk.command({ type: "message.send", sessionId, expectedRevision: 1, delivery: "queue" });
    await waitFor(() => session().status === "failed" && !session().turnId, 30000);
    f.service.controller.on("change", change);
    const failure = f.service.controller.snapshot().modelFailures[0]!;
    await f.sdk.sessions.retry(sessionId, failure.id, failure.revision);
    await waitFor(() => Boolean(stop) && !session().turnId && f.service.controller.snapshot().modelFailures[0]?.status === "cancelled", 10000); await stop;
    const state = f.service.controller.snapshot(), preparation = state.sandboxWorkspaces!.find((workspace) => workspace.preparation?.version === 3)!;
    assert.equal(preparation.status, "partial"); assert.equal(preparation.stage, null); assert.equal(state.sandboxExecutions!.length, 1);
    assert.equal(state.budgetEntries.length, 1); assert.equal(state.budgetEntries[0]!.status, "unknown");
    f.sdk.disconnect(); await f.service.close(); restarted = await startService(f.runtimeOptions);
    clock.advanceBy(180000); await new Promise((resolve) => setTimeout(resolve, 50));
    const recovered = restarted.controller.snapshot();
    assert.equal(recovered.modelFailures[0]!.status, "cancelled"); assert.equal(recovered.sandboxExecutions!.length, 1);
    assert.equal(recovered.sandboxWorkspaces!.find((workspace) => workspace.id === preparation.id)!.status, "partial");
    assert.deepEqual(recovered.budgetEntries, state.budgetEntries); assert.equal(f.provider.requests.length, 0); passed = true;
  } finally { f.service.controller.off("change", change); await stop; await restarted?.close(); await f.close(passed); }
});
