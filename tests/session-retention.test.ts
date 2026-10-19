import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { EventStore } from "../apps/service/src/store.ts";
import { startService } from "../apps/service/src/server.ts";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { setupFixture, waitFor } from "./fixture.ts";
import { writeLegacyState } from "./fixtures/legacy-state.ts";

test("schema-3 retention migration preserves event identity, scoped attachments and command receipts", async () => {
  const fixture = await setupFixture();
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  let restarted: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    await sdk.command({ type: "attachment.add", sessionId: fixture.sessionId, expectedRevision: 0, path: "fixture.txt" });
    const attachment = fixture.session().draft.attachments[0]!;
    await sdk.command({ type: "draft.save", sessionId: fixture.sessionId, expectedRevision: fixture.session().draft.revision, text: "Generated schema-three private text", attachments: [attachment] }, "generated-schema-three-receipt");
    const before = fixture.service.controller.events(0).map(({ id, seq, event_type }) => ({ id, seq, event_type }));
    sdk.disconnect(); await writeLegacyState(fixture.service, 3);
    restarted = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey });
    assert.deepEqual(restarted.controller.events(0).slice(0, before.length).map(({ id, seq, event_type }) => ({ id, seq, event_type })), before);
    assert.equal(restarted.controller.snapshot().sessions[0]?.draft.text, "Generated schema-three private text");
    assert.equal(restarted.store.blob(attachment.digest), "generated original\n");
    assert.ok(restarted.store.db.prepare("SELECT id FROM receipts WHERE id=?").get("generated-schema-three-receipt"));
    assert.equal((await readFile(restarted.store.path)).includes(Buffer.from("Generated schema-three private text")), false);
    assert.throws(() => restarted!.store.db.exec("DELETE FROM events"), /append-only/);
  } finally { sdk.disconnect(); await restarted?.close(); await fixture.close(); }
});

test("wrong, missing and corrupt retained keys fail closed without deleting state", async () => {
  const fixture = await setupFixture();
  const path = fixture.service.store.path;
  try {
    await fixture.service.close();
    assert.throws(() => new EventStore(path), /explicit retention key/);
    assert.throws(() => new EventStore(path, Buffer.alloc(32, 0x99)), /missing\/corrupt/);
    let store = new EventStore(path, fixture.retentionKey);
    const scope = store.db.prepare("SELECT scope,payload FROM retention_keys LIMIT 1").get()!;
    const original = String(scope.payload);
    store.db.prepare("UPDATE retention_keys SET payload=? WHERE scope=?").run(JSON.stringify({ retention: 1, iv: "", tag: "", data: "" }), String(scope.scope));
    store.close();
    assert.throws(() => new EventStore(path, fixture.retentionKey), /missing\/corrupt/);
    const { DatabaseSync } = await import("node:sqlite");
    const database = new DatabaseSync(path);
    database.prepare("UPDATE retention_keys SET payload=? WHERE scope=?").run(original, String(scope.scope)); database.close();
    store = new EventStore(path, fixture.retentionKey);
    assert.ok(store.events().some((event) => event.event_type === "session.created"));
    const sessionScope = store.db.prepare("SELECT scope FROM retention_keys WHERE session_id=?").get(fixture.sessionId)!;
    store.db.prepare("DELETE FROM retention_keys WHERE scope=?").run(String(sessionScope.scope)); store.close();
    store = new EventStore(path, fixture.retentionKey);
    try { assert.throws(() => store.events(), /missing without a deletion record/); }
    finally { store.close(); }
  } finally { await fixture.close(); }
});

test("retention transaction rollback never leaves cached keys for rolled-back scope rows", () => {
  const store = new EventStore(":memory:");
  try {
    assert.throws(() => store.commit([
      { event_type: "project.added", profile_id: "default", project_id: "generated-project", payload: { project: { id: "generated-project", name: "Generated", path: "/generated" } } },
      { event_type: "artifact.saved", profile_id: "default", project_id: "generated-project", payload: { artifact: { id: "generated-artifact", projectId: "generated-project", originSessionId: null, name: "Generated", path: null, contentDigest: "0".repeat(64), createdAt: "2026-01-01T00:00:00Z" } } },
    ]), /Missing or deleted/);
    assert.equal(store.events().length, 0);
    store.commit([{ event_type: "project.added", profile_id: "default", project_id: "generated-project", payload: { project: { id: "generated-project", name: "Generated", path: "/generated" } } }]);
    assert.equal(store.events().length, 1);
    assert.equal(Number(store.db.prepare("SELECT count(*) AS total FROM retention_keys").get()?.total), 1);
  } finally { store.close(); }
});

test("archived cleanup is off by default, preserves independent artifacts and survives restart", async () => {
  const fixture = await setupFixture({ platform: { now: () => Date.now() + 40 * 86400_000 } });
  let sdk = await new MoguriSdk(fixture.service.connection).ready();
  let restarted: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    const projectId = fixture.session().projectId;
    await mkdir(join(fixture.project, "docs"));
    await writeFile(join(fixture.project, "docs", "plan.md"), "Generated retained artifact.");
    const artifact = await sdk.plans.capture(fixture.sessionId);
    await sdk.command({ type: "session.archive", sessionId: fixture.sessionId });
    assert.equal((await fixture.service.controller.platform.sessions.retention()).deleted, 0);
    let settings = sdk.settings.get()!;
    await sdk.settings.update({ ...settings.values, retention: { deleteArchived: true, afterDays: 30 } }, settings.revision);
    assert.equal((await fixture.service.controller.platform.sessions.retention()).deleted, 1);
    await sdk.refresh();
    assert.equal(sdk.getState().snapshot!.sessions.length, 0);
    assert.equal((await sdk.plans.artifact(artifact.id!)).text, "Generated retained artifact.");
    sdk.disconnect(); await fixture.service.close();
    restarted = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey });
    sdk = await new MoguriSdk(restarted.connection).ready();
    assert.equal(sdk.getState().snapshot!.sessions.length, 0);
    assert.equal((await sdk.plans.artifact(artifact.id!)).text, "Generated retained artifact.");
    const configuration = await sdk.projects.configuration(projectId);
    const artifacts = (await sdk.artifacts.projectPreview(projectId)).preview;
    await sdk.projects.remove(projectId, true, configuration.configuration.revision, { action: "delete", expectedDigest: artifacts.digest });
    await assert.rejects(() => sdk.plans.artifact(artifact.id!), /outside|missing/);
    assert.equal(await readFile(join(fixture.project, "docs", "plan.md"), "utf8"), "Generated retained artifact.");
  } finally { sdk.disconnect(); await restarted?.close(); await fixture.close(); }
});

test("deleting active work settles cancellation and detaches surviving user children", { skip: process.platform !== "darwin", timeout: 20_000 }, async () => {
  const fixture = await setupFixture();
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.configure(); await sdk.refresh();
    const child = await sdk.sessions.spawn(fixture.sessionId, "agent");
    await fixture.send("generated slow deletion");
    await waitFor(() => fixture.requests.length === 1);
    await sdk.sessions.mode(fixture.sessionId, "read-only");
    await sdk.sessions.delete(fixture.sessionId, true);
    const snapshot = sdk.getState().snapshot!;
    assert.equal(snapshot.sessions.some((session) => session.id === fixture.sessionId), false);
    const survivingChild = snapshot.sessions.find((session) => session.id === child.id);
    assert.ok(survivingChild);
    assert.equal(survivingChild.parentSessionId, undefined);
    assert.equal(fixture.service.controller.events(0).some((event) => event.session_id === fixture.sessionId), false);
    const deletion = fixture.service.controller.events(0).find((event) => event.event_type === "session.deleted");
    assert.ok(deletion?.event_type === "session.deleted" && deletion.payload.usage.every((usage) => usage.outcome !== "completed"));
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("restart never replays a terminal and unconfirmed ownership needs explicit inspection before deletion", async () => {
  const fixture = await setupFixture();
  let restarted: Awaited<ReturnType<typeof startService>> | undefined;
  let sdk: MoguriSdk | undefined;
  try {
    const projectId = fixture.session().projectId;
    const path = fixture.service.store.path;
    await fixture.service.close();
    const store = new EventStore(path, fixture.retentionKey);
    const scope = { profile_id: "default", project_id: projectId, session_id: fixture.sessionId, turn_id: "generated-unconfirmed-turn" };
    store.commit([
      { ...scope, event_type: "process.started", payload: { callId: "generated-owned-call", pid: 2147000000, processGroup: 2147000000 } },
      { ...scope, event_type: "tool.completed", payload: { call: { id: "generated-owned-call", name: "run_command", arguments: { command: "generated fixture only" } }, text: "Generated unconfirmed cleanup", isError: true, outcome: "unconfirmed" } },
      { ...scope, event_type: "turn.finished", payload: { outcome: "partial", diagnostic: "Generated unconfirmed cleanup." } },
      { ...scope, event_type: "terminal.changed", payload: { terminal: { id: "generated-old-terminal", sessionId: fixture.sessionId, projectId, title: "Generated", pid: 2147000000, cols: 80, rows: 24, status: "running", diagnostic: null } } },
    ]);
    store.close();
    restarted = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey });
    sdk = await new MoguriSdk(restarted.connection).ready();
    assert.equal((await sdk.terminal.read("generated-old-terminal")).terminal.status, "unconfirmed");
    await assert.rejects(() => sdk!.terminal.input("generated-old-terminal", "never replayed"), /no longer|not reattached/);
    await assert.rejects(() => sdk!.sessions.delete(fixture.sessionId, true), /terminal.*unconfirmed/);
    await sdk.terminal.acknowledge("generated-old-terminal", true);
    assert.equal((await sdk.terminal.read("generated-old-terminal")).terminal.status, "acknowledged");
    await assert.rejects(() => sdk!.sessions.delete(fixture.sessionId, true), /effects remain unconfirmed/);
    await sdk.command({ type: "session.resume", sessionId: fixture.sessionId });
    await sdk.sessions.delete(fixture.sessionId, true);
    assert.equal(sdk.getState().snapshot!.sessions.length, 0);
    assert.equal(fixture.requests.length, 0);
  } finally { sdk?.disconnect(); await restarted?.close(); await fixture.close(); }
});
