import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { startService } from "../apps/service/src/server.ts";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { setupFixture } from "./fixture.ts";
import { writeLegacyState } from "./fixtures/legacy-state.ts";

test("schema-1 state migrates to schema 8 with the same sessions, drafts, receipts and immutable history", async () => {
  const fixture = await setupFixture();
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  let restarted: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    await sdk.command({ type: "draft.save", sessionId: fixture.sessionId, expectedRevision: 0, text: "generated schema-one surviving draft", attachments: [] }, "generated-migration-command");
    const count = fixture.service.controller.events(0).length;
    sdk.disconnect();
    await writeLegacyState(fixture.service, 1);
    restarted = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey });
    assert.equal(restarted.store.db.prepare("PRAGMA user_version").get()?.user_version, 8);
    const session = restarted.controller.snapshot().sessions.find((session) => session.id === fixture.sessionId)!;
    assert.equal(session.draft.text, "generated schema-one surviving draft");
    assert.equal(restarted.controller.snapshot().settings.values.appearance.theme, "dark");
    assert.ok(restarted.controller.events(0).length >= count);
    assert.ok(restarted.store.db.prepare("SELECT id FROM receipts WHERE id=?").get("generated-migration-command"));
    assert.throws(() => restarted!.store.db.exec("UPDATE events SET payload='{}'"), /append-only/);
  } finally { sdk.disconnect(); await restarted?.close(); await fixture.close(); }
});
test("schema-7 runtime/default/input state upgrades without changing identity, attachment grants or saved controls", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  let restarted: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    await fixture.configure();
    const captured = await sdk.attachments.file(fixture.sessionId, join(fixture.project, "fixture.txt"));
    const controls = structuredClone(fixture.session().controls), ids = fixture.service.controller.events(0).map((event) => event.id);
    sdk.disconnect(); await writeLegacyState(fixture.service, 7);
    restarted = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey });
    assert.equal(restarted.store.db.prepare("PRAGMA user_version").get()?.user_version, 8);
    assert.deepEqual(restarted.controller.events(0).slice(0, ids.length).map((event) => event.id), ids);
    assert.deepEqual(restarted.controller.snapshot().sessions[0]?.controls, controls);
    assert.equal(restarted.controller.snapshot().settings.values.remote, null);
    assert.deepEqual(restarted.controller.snapshot().executions, []);
    const content = await restarted.controller.platform.query({ type: "attachment.read", sessionId: fixture.sessionId, attachmentId: captured.id! });
    assert.ok(content.type === "attachment.read" && content.content.kind === "text" && content.content.text.includes("generated original"));
  } finally { sdk.disconnect(); await restarted?.close(); await fixture.close(); }
});

test("schema-2 upgrades preserve prior state and new boards survive restart while interrupted installs remain partial", async () => {
  const fixture = await setupFixture();
  const projectId = fixture.session().projectId;
  let sdk = await new MoguriSdk(fixture.service.connection).ready();
  let runtime: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    await sdk.command({ type: "draft.save", sessionId: fixture.sessionId, expectedRevision: 0, text: "Generated schema-two draft", attachments: [] });
    sdk.disconnect(); await writeLegacyState(fixture.service, 2);
    runtime = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey });
    assert.equal(runtime.store.db.prepare("PRAGMA user_version").get()?.user_version, 8);
    assert.equal(runtime.controller.snapshot().sessions[0]?.draft.text, "Generated schema-two draft");
    sdk = await new MoguriSdk(runtime.connection).ready();
    const created = await sdk.issues.create(projectId, { title: "Generated retained issue", body: "Generated", kind: "misc", phaseId: "backlog", pullRequestUrl: null });
    await sdk.issues.move(created.id!, "in-progress", 0);
    runtime.store.commit([{ event_type: "job.started", profile_id: "default", project_id: projectId, payload: { job: {
      id: "generated-interrupted-install", kind: "cache.install", projectId, sessionId: null, parentTurnId: null, status: "running", progress: "Generated interrupted work", resultDigest: null, error: null,
    } } }]);
    sdk.disconnect(); await runtime.close();
    runtime = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey });
    const snapshot = runtime.controller.snapshot();
    assert.equal(snapshot.issues.find((issue) => issue.id === created.id)?.phaseId, "in-progress");
    assert.equal(snapshot.jobs.find((job) => job.id === "generated-interrupted-install")?.status, "partial");
    assert.ok(snapshot.blockedProjects.includes(projectId));
    assert.equal(snapshot.sessions[0]?.draft.text, "Generated schema-two draft");
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await runtime?.close(); await fixture.close(); }
});

test("vector and graph indexes survive restart and remain scoped derived data rather than session state", async () => {
  const fixture = await setupFixture();
  let restarted: Awaited<ReturnType<typeof startService>> | undefined;
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await writeFile(join(fixture.project, "generated.ts"), "export function persistedVectorKnowledge() { return 'generated'; }\n");
    const snapshot = sdk.getState().snapshot!;
    await sdk.settings.update({ ...snapshot.settings.values, memory: { ...snapshot.settings.values.memory, enabled: true } }, snapshot.settings.revision);
    const job = await sdk.memory.index(fixture.session().projectId);
    assert.equal((await sdk.jobs.wait(job.id!)).status, "completed");
    sdk.disconnect();
    await fixture.service.close();
    restarted = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey });
    const result = await restarted.controller.platform.query({ type: "memory.search", projectId: fixture.session().projectId, text: "persisted vector knowledge", limit: 6 });
    assert.ok(result.type === "memory.search" && result.items.some((item) => item.path === "generated.ts" && item.text.includes("persistedVectorKnowledge")));
    const graph = await restarted.controller.platform.query({ type: "memory.graph", projectId: fixture.session().projectId, path: "generated.ts" });
    assert.ok(graph.type === "memory.graph" && graph.nodes.some((node) => node.kind === "symbol"));
  } finally { sdk.disconnect(); await restarted?.close(); await fixture.close(); }
});
