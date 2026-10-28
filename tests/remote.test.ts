import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { envelope } from "../apps/service/src/controller.ts";
import { WorkerRequestSchema } from "../apps/service/src/worker-protocol.ts";
import type { WorkerConnectionEvents } from "../apps/service/src/worker-connection.ts";
import { parse } from "../packages/protocol/src/index.ts";
import { reviewNativeTools, waitFor } from "./fixture.ts";
import { remoteFixture } from "./fixtures/remote-service.ts";

const native = { skip: process.platform !== "darwin", timeout: 30_000 };

test("Remote keeps authority local while real SSH models, instructions, approvals and writes use only the approved remote root", native, async () => {
  const fixture = await remoteFixture();
  try {
    await fixture.probe(); await fixture.select();
    assert.equal(fixture.controller.snapshot().capabilities.find((value) => value.env === "Remote")?.ready, true);
    await fixture.send("generated write");
    await waitFor(() => fixture.session().status === "completed");
    assert.equal(fixture.session().pendingApproval, null);
    await waitFor(() => fixture.controller.snapshot().executions[0]?.cleanup === "owned-worker-stopped");
    assert.equal(await readFile(join(fixture.workspace, "fixture.txt"), "utf8"), "generated replacement\n");
    assert.equal(await readFile(join(fixture.project, "fixture.txt"), "utf8"), "generated original\n");
    assert.equal(fixture.requests.length, 3);
    assert.match(JSON.stringify(fixture.requests[0]), /Generated SSH workspace instructions/);
    assert.equal(fixture.session().usage.length, 3); assert.equal(fixture.session().usage[0]?.totalTokens, 42);
    const execution = fixture.controller.snapshot().executions[0]!;
    assert.equal(execution.workspace, fixture.workspace); assert.equal(execution.status, "completed");
    const events = fixture.controller.events(0);
    const outcomes = fixture.controller.platform.telemetry.query({ type: "telemetry.operations", env: "Remote", sessionId: fixture.session().id });
    assert.equal(outcomes.type, "telemetry.operations");
    if (outcomes.type === "telemetry.operations") {
      assert.equal(outcomes.totals.completed, 2); assert.ok(outcomes.entries.every((entry) => entry.actor === "model" && entry.env === "Remote"));
      assert.equal(JSON.stringify(outcomes).includes(fixture.workspace), false);
    }
    for (const event of events.filter((value) => value.event_type === "model.completed")) assert.equal(events.find((value) => value.seq === event.seq + 1)?.event_type, "execution.frame_recorded");
    await fixture.controller.dispatch(envelope({ type: "remote.reconcile", executionId: execution.id }));
    assert.equal(fixture.session().usage.length, 3);
  } finally { await fixture.close(); }
});

test("an SSH disconnect retains late model usage without replay, duplicate inference or changing a partial turn to success", native, async (t) => {
  const fixture = await remoteFixture();
  try {
    await fixture.probe(); await fixture.select();
    const original = fixture.controller.remote.launch.bind(fixture.controller.remote);
    t.mock.method(fixture.controller.remote, "launch", (execution: Parameters<typeof original>[0], changed: Parameters<typeof original>[1]) => {
      const worker = original(execution, changed), events = new EventEmitter<WorkerConnectionEvents>();
      worker.events.on("message", (raw, frame) => {
        const request = parse(WorkerRequestSchema, raw);
        if (request.kind === "model.complete") { worker.kill("SIGTERM"); return; }
        events.emit("message", raw, frame);
      });
      worker.events.on("error", (error) => events.emit("error", error));
      worker.events.on("exit", (code, signal) => events.emit("exit", code, signal));
      worker.events.on("stderr", (text) => events.emit("stderr", text));
      return { events, get connected() { return worker.connected; }, send: worker.send.bind(worker), kill: worker.kill.bind(worker), acknowledge: worker.acknowledge?.bind(worker) };
    });
    await fixture.send("generated late-accounting answer");
    await waitFor(() => fixture.session().status === "partial");
    assert.equal(fixture.requests.length, 1); assert.equal(fixture.session().usage[0]?.totalTokens, null);
    assert.equal(fixture.controller.snapshot().budgetEntries[0]?.status, "unknown");
    const execution = fixture.controller.snapshot().executions[0]!;
    let terminal = false;
    for (let index = 0; index < 100; index++) {
      const result = await fixture.controller.remote.inspect(execution);
      if (["partial", "stopped", "completed", "unconfirmed"].includes(result.status.status)) { terminal = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(terminal, true);
    await fixture.controller.dispatch(envelope({ type: "remote.reconcile", executionId: execution.id }));
    assert.equal(fixture.session().status, "partial"); assert.equal(fixture.session().usage[0]?.totalTokens, 42);
    assert.equal(fixture.session().usage[0]?.quality, "provider-reported");
    assert.equal(fixture.controller.snapshot().budgetEntries[0]?.reportedTokens, 42);
    assert.equal(fixture.controller.snapshot().budgetEntries[0]?.status, "settled");
    assert.equal(fixture.controller.events(0).filter((event) => event.event_type === "model.late_usage").length, 1);
    await fixture.controller.dispatch(envelope({ type: "remote.reconcile", executionId: execution.id }));
    assert.equal(fixture.requests.length, 1); assert.equal(fixture.session().usage.length, 1);
    assert.equal(fixture.controller.snapshot().budgetEntries.length, 1);
  } finally { await fixture.close(); }
});

test("configured remote-local endpoints are discovered through SSH with one explicit source and the actual environment binding", native, async () => {
  const fixture = await remoteFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const settings = structuredClone(fixture.controller.snapshot().settings.values);
    settings.remote!.allowCopilot = false;
    settings.remote!.models = [{ id: "generated", name: "Generated remote endpoint", baseUrl: fixture.baseUrl, enabled: true, auth: "none", models: [{ id: fixture.modelId, name: "Generated remote model", contextWindow: fixture.contextWindow, maxTokens: 256, imageInput: false }] }];
    await fixture.controller.dispatch(envelope({ type: "settings.update", settings, expectedRevision: fixture.controller.snapshot().settings.revision, acknowledgePromptRisk: false }));
    await fixture.probe(); await sdk.refresh();
    const offerings = sdk.models.catalogue().models.find((model) => model.apiModelId === fixture.modelId)!.offerings;
    assert.equal(offerings.length, 2);
    assert.equal(new Set(offerings.map((offering) => offering.model.id)).size, 2);
    assert.equal(fixture.controller.snapshot().provider.models.filter((model) => !model.synthetic).length, 0);
    await sdk.models.selectSource(fixture.modelId, fixture.modelId);
    await assert.rejects(() => fixture.select(), /not.*approved.*environment|not.*discovered/i);
    const model = offerings.find((offering) => offering.model.id.startsWith("remote."))!.model;
    assert.ok(model); assert.deepEqual(model.environments, ["Remote"]);
    await sdk.models.selectSource(fixture.modelId, model.id);
    assert.deepEqual(fixture.controller.snapshot().provider.models.filter((model) => !model.synthetic).map((model) => model.id), [model.id]);
    await fixture.select(model.id); await fixture.send("generated remote-local answer");
    await waitFor(() => fixture.session().status === "completed");
    assert.equal(fixture.requests.length, 1); assert.equal(fixture.headers[0], undefined);
    assert.equal(fixture.session().usage[0]?.modelId, model.id); assert.equal(fixture.session().usage[0]?.apiModelId, fixture.modelId);
    assert.equal(fixture.session().usage[0]?.source, "local");
  } finally { sdk.disconnect(); await fixture.close(); }
});
test("SSH model connectivity is checked before paid inference and cannot fall back to the local controller", native, async () => {
  const fixture = await remoteFixture({ exposeModels: false });
  try {
    await fixture.probe(); await fixture.select(); await fixture.send("generated unavailable remote model metadata");
    await waitFor(() => fixture.session().status === "failed");
    assert.equal(fixture.requests.length, 0);
    assert.equal(fixture.session().usage.length, 0);
    assert.match(fixture.session().lastError!, /SSH host.*metadata.*HTTP 500/);
  } finally { await fixture.close(); }
});

test("approved images transfer as bounded context, not local filesystem access, to a real SSH worker", native, async () => {
  const fixture = await remoteFixture({ imageInput: true }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.probe(); await fixture.select();
    const image = await sharp({ create: { width: 12, height: 10, channels: 3, background: { r: 70, g: 100, b: 90 } } }).png().toBuffer();
    const selectedLocalPath = join(fixture.directory, "generated-local-only-image.png"); await writeFile(selectedLocalPath, image);
    await sdk.attachments.file(fixture.sessionId, selectedLocalPath, "image");
    await fixture.send("Generated SSH image context.");
    await waitFor(() => fixture.session().status === "completed");
    assert.equal(fixture.requests.length, 1);
    assert.match(JSON.stringify(fixture.requests[0]!.messages), /data:image\/png;base64,/);
    assert.equal(JSON.stringify(fixture.requests[0]!.messages).includes(selectedLocalPath), false);
    assert.equal(fixture.session().messages.find((message) => message.role === "user")?.attachments?.[0]?.kind, "image");
  } finally { sdk.disconnect(); await fixture.close(); }
});
test("project-free SSH chats retain null workspace authority instead of reusing the configured project root", native, async () => {
  const fixture = await remoteFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.probe();
    const created = await sdk.sessions.create(null, "Generated SSH general chat", { env: "Remote", modelId: fixture.modelId });
    await sdk.command({ type: "draft.save", sessionId: created.id!, expectedRevision: 0, text: "generated forbidden write", attachments: [] });
    await sdk.command({ type: "message.send", sessionId: created.id!, expectedRevision: 1, delivery: "queue" });
    await waitFor(() => fixture.controller.snapshot().sessions.find((session) => session.id === created.id)?.status === "completed");
    const execution = fixture.controller.snapshot().executions.find((value) => value.sessionId === created.id)!;
    assert.equal(execution.projectId, null); assert.equal(execution.workspace, null);
    assert.equal(fixture.requests.length, 2);
    assert.equal(fixture.controller.snapshot().sessions.find((session) => session.id === created.id)?.pendingApproval, null);
    assert.equal(await readFile(join(fixture.workspace, "fixture.txt"), "utf8"), "generated actual remote source\n");
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("remote workspace changes invalidate an exact pending approval instead of sending it to the old worker root", native, async () => {
  const fixture = await remoteFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await reviewNativeTools(sdk);
    await fixture.probe(); await fixture.select(); await fixture.send("generated write");
    const approval = await waitFor(() => fixture.session().pendingApproval);
    const configuration = (await sdk.projects.configuration(fixture.session().projectId)).configuration;
    const changed = join(await realpath(fixture.directory), "changed-remote-root"); await mkdir(changed);
    await sdk.projects.configure(configuration.projectId, { ...configuration.values, remotePath: changed }, configuration.revision);
    await assert.rejects(() => sdk.command({ type: "approval.respond", sessionId: fixture.sessionId, approvalId: approval.id, allow: true }), /expired|no longer|pending|changed/i);
    await waitFor(() => ["failed", "partial"].includes(fixture.session().status));
    const execution = fixture.controller.snapshot().executions.at(-1)!;
    await waitFor(() => !fixture.controller.remote.owns(execution.id));
    assert.equal(fixture.controller.snapshot().executions.find((value) => value.id === execution.id)?.cleanup, "owned-worker-stopped");
    assert.equal(await readFile(join(fixture.workspace, "fixture.txt"), "utf8"), "generated actual remote source\n");
    assert.equal(await readFile(join(fixture.project, "fixture.txt"), "utf8"), "generated original\n");
  } finally { sdk.disconnect(); await fixture.close(); }
});
