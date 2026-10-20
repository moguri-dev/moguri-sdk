import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MoguriSdk, type ArtifactKind } from "../packages/sdk/src/index.ts";
import { EventStore } from "../apps/service/src/store.ts";
import { startService } from "../apps/service/src/server.ts";
import { setupFixture } from "./fixture.ts";
import { writeLegacyState } from "./fixtures/legacy-state.ts";
import { saveArtifactExport } from "../packages/sdk/src/node.ts";

test("typed artifacts retain independent content revisions, optimistic edits and grants after origin deletion", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const kinds: ArtifactKind[] = ["plan", "decision", "answer", "research-note", "report"], created: string[] = [];
    for (const kind of kinds) created.push((await sdk.artifacts.create(fixture.sessionId, { kind, name: `Generated ${kind}`, text: "Generated shared independent artifact content." })).id!);
    await sdk.artifacts.update(created[0]!, { text: "Generated second revision.", name: "Generated revised plan" }, 0);
    await assert.rejects(() => sdk.artifacts.update(created[0]!, { text: "Generated stale overwrite." }, 0), /changed|Reload/);
    assert.equal((await sdk.artifacts.read(created[0]!, 0)).text, "Generated shared independent artifact content.");
    assert.equal((await sdk.artifacts.read(created[0]!)).text, "Generated second revision.");
    const history = await sdk.artifacts.history(created[0]!, 0, 1);
    assert.equal(history.revisions[0]?.revision, 1); assert.equal(history.nextOffset, 1);
    await sdk.artifacts.update(created[0]!, { status: "archived" }, 1);
    assert.equal((await sdk.artifacts.read(created[0]!)).artifact.status, "archived");
    await sdk.sessions.delete(fixture.sessionId, true);
    const standalone = await sdk.artifacts.create(null, { kind: "research-note", name: "Generated standalone profile note", text: "Generated without any conversation." });
    assert.equal((await sdk.artifacts.read(standalone.id!)).artifact.originSessionId, null);
    assert.equal(fixture.service.controller.snapshot().sessions.length, 0);
    assert.equal((await sdk.artifacts.read(created[1]!)).artifact.kind, "decision");
    await sdk.artifacts.delete(created[1]!, 0, true);
    await assert.rejects(() => sdk.artifacts.read(created[1]!), /missing|deleted|outside/);
    assert.equal((await sdk.artifacts.read(created[2]!)).text, "Generated shared independent artifact content.");
    assert.equal(Number(fixture.service.store.db.prepare("SELECT count(*) AS count FROM retention_keys WHERE scope=?").get(`profile/default/artifact/${created[1]}`)?.count), 0);
    assert.equal((await readFile(fixture.service.store.path)).includes(Buffer.from("Generated shared independent artifact content.")), false);
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});
test("concurrent artifact edits claim one revision and exports persist exactly without overwriting other files", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready(), peer = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const created = await sdk.artifacts.create(null, { kind: "decision", name: "Generated concurrent decision", text: "Generated original." });
    const outcomes = await Promise.allSettled([sdk.artifacts.update(created.id!, { text: "Generated first candidate." }, 0), peer.artifacts.update(created.id!, { text: "Generated second candidate." }, 0)]);
    assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
    assert.equal(outcomes.filter((outcome) => outcome.status === "rejected").length, 1);
    const exported = (await sdk.artifacts.export(created.id!)).export, path = join(fixture.directory, "generated-independent-export.json");
    const saved = await saveArtifactExport(path, exported);
    assert.equal(saved.digest, exported.digest); assert.equal(await readFile(path, "utf8"), exported.text);
    await assert.rejects(() => saveArtifactExport(path, exported), /already exists.*preserved/);
    assert.equal(await readFile(path, "utf8"), exported.text);
    await assert.rejects(() => saveArtifactExport(join(fixture.directory, "generated-wrong-hash.json"), { ...exported, digest: "0".repeat(64) }), /No file was written/);
    assert.equal((await sdk.artifacts.history(created.id!)).revisions.length, 2);
  } finally { sdk.disconnect(); peer.disconnect(); await fixture.close(); }
});

test("exact canonical source promotion preserves model versus user provenance, not a streamed fragment or fake human answer", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.configure(); await fixture.send("Generated artifact source question."); await fixture.terminal(); await sdk.refresh();
    const session = fixture.session(), assistant = session.messages.find((message) => message.role === "assistant" && message.text)!, user = session.messages.find((message) => message.role === "user")!;
    const preview = (await sdk.artifacts.source(session.id, "message", assistant.id)).preview;
    assert.equal(preview.source.actor, "model"); assert.equal(preview.source.modelId, fixture.modelId);
    await assert.rejects(() => sdk.artifacts.promote(session.id, { sourceKind: "message", sourceId: assistant.id, kind: "answer", name: "Generated stale model advice", expectedDigest: "0".repeat(64) }), /Review.*canonical source/);
    const model = await sdk.artifacts.promote(session.id, { sourceKind: "message", sourceId: assistant.id, kind: "answer", name: "Generated model answer", expectedDigest: preview.digest });
    const human = (await sdk.artifacts.source(session.id, "message", user.id)).preview;
    assert.equal(human.source.actor, "user");
    const question = await sdk.artifacts.promote(session.id, { sourceKind: "message", sourceId: user.id, kind: "decision", name: "Generated user text", expectedDigest: human.digest });
    await sdk.artifacts.update(model.id!, { text: "Generated human revision of model advice." }, 0);
    const revised = (await sdk.artifacts.read(model.id!)).artifact;
    assert.equal(revised.sources[0]?.actor, "model"); assert.equal(revised.edited, true);
    await sdk.sessions.delete(session.id, true);
    assert.equal((await sdk.artifacts.read(model.id!, 0)).text, preview.text);
    assert.equal((await sdk.artifacts.read(question.id!)).artifact.sources[0]?.actor, "user");
    const general = await sdk.sessions.create(null);
    await assert.rejects(() => sdk.artifacts.source(general.id!, "message", assistant.id), /canonical completed/);
    const artifact = await sdk.artifacts.create(general.id!, { kind: "research-note", name: "Generated project-free note", text: "Generated root-free content." });
    assert.equal((await sdk.artifacts.read(artifact.id!)).artifact.projectId, null);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("project removal binds explicit retain/delete/export choices to the exact artifact set", async () => {
  for (const action of ["retain", "delete", "export"] as const) {
    const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
    let restarted: Awaited<ReturnType<typeof startService>> | undefined;
    try {
      const projectId = fixture.session().projectId, created = await sdk.artifacts.create(fixture.sessionId, { kind: "report", name: "Generated project report", text: `Generated ${action} payload.` });
      const configuration = (await sdk.projects.configuration(projectId)).configuration;
      await assert.rejects(() => sdk.projects.remove(projectId, true, configuration.revision), /explicitly choose/);
      const stale = (await sdk.artifacts.projectPreview(projectId)).preview;
      await sdk.artifacts.update(created.id!, { name: "Generated reviewed report" }, 0);
      await assert.rejects(() => sdk.projects.remove(projectId, true, configuration.revision, { action, expectedDigest: stale.digest }), /artifact set changed/);
      const preview = (await sdk.artifacts.projectPreview(projectId)).preview;
      const retainedHash = (await sdk.artifacts.read(created.id!)).artifact.contentDigest;
      let exportedDigest: string | undefined;
      if (action === "export") {
        await assert.rejects(() => sdk.projects.remove(projectId, true, configuration.revision, { action, expectedDigest: preview.digest }), /Retrieve and save/);
        const exported = (await sdk.artifacts.projectExport(projectId)).export;
        await writeFile(join(fixture.directory, "generated-export.json"), exported.text, { mode: 0o600, flag: "wx" });
        assert.equal(JSON.parse(await readFile(join(fixture.directory, "generated-export.json"), "utf8")).documents[0].revisions.length, 2);
        exportedDigest = exported.digest;
      }
      await sdk.projects.remove(projectId, true, configuration.revision, { action, expectedDigest: preview.digest, ...(exportedDigest ? { exportedDigest } : {}) });
      assert.equal(sdk.getState().snapshot!.projects.length, 0);
      if (action === "retain") {
        assert.equal((await sdk.artifacts.read(created.id!)).artifact.projectId, null);
        sdk.disconnect(); await fixture.service.close();
        restarted = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey });
        assert.equal(restarted.controller.snapshot().artifacts[0]?.projectId, null);
        const retained = await restarted.controller.platform.query({ type: "artifact.read", artifactId: created.id!, revision: 0 });
        assert.ok(retained.type === "artifact.read" && retained.text === "Generated retain payload.");
      } else {
        await assert.rejects(() => sdk.artifacts.read(created.id!), /missing|deleted|outside/);
        assert.throws(() => fixture.service.store.blob(retainedHash), /Missing or deleted/);
      }
      assert.equal(await readFile(join(fixture.project, "fixture.txt"), "utf8"), "generated original\n");
    } finally { sdk.disconnect(); await restarted?.close(); await fixture.close(); }
  }
});

test("schema-9 artifact rekeying rolls back atomically, preserves identity/shared references and enables independent deletion", async (t) => {
  const fixture = await setupFixture();
  let restarted: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    const id = randomUUID(), other = randomUUID(), unique = randomUUID(), projectId = fixture.session().projectId, contentDigest = fixture.service.store.putBlob("Generated legacy shared plan.");
    for (const artifactId of [id, other]) fixture.service.store.commit([{ event_type: "artifact.saved", profile_id: "default", project_id: projectId, payload: { artifact: { id: artifactId, projectId, originSessionId: fixture.sessionId, name: "Generated legacy plan", path: "docs/plan.md", contentDigest, createdAt: "2026-01-01T00:00:00Z" } } }]);
    const uniqueDigest = fixture.service.store.putBlob("Generated legacy artifact with no other grant.");
    fixture.service.store.commit([{ event_type: "artifact.saved", profile_id: "default", project_id: projectId, payload: { artifact: { id: unique, projectId, originSessionId: fixture.sessionId, name: "Generated unique legacy plan", path: null, contentDigest: uniqueDigest, createdAt: "2026-01-01T00:00:00Z" } } }]);
    fixture.service.store.commit([{ event_type: "capability.saved", profile_id: "default", project_id: projectId, payload: { entry: { id: randomUUID(), projectId, kind: "memory", name: "Generated shared grant", description: "Generated fixture only", contentDigest, source: "user", enabled: false, revision: 0, createdAt: "2026-01-01T00:00:00Z" } } }]);
    const before = fixture.service.store.events().map(({ id, seq }) => ({ id, seq }));
    await writeLegacyState(fixture.service, 3);
    const original = DatabaseSync.prototype.exec;
    const failure = t.mock.method(DatabaseSync.prototype, "exec", function (this: DatabaseSync, sql: string) {
      if (sql.includes("PRAGMA user_version=10")) throw new Error("Generated artifact migration interruption");
      return original.call(this, sql);
    });
    try { assert.throws(() => new EventStore(fixture.service.store.path, fixture.retentionKey), /Generated artifact migration interruption/); }
    finally { failure.mock.restore(); }
    const old = new DatabaseSync(fixture.service.store.path);
    try {
      assert.equal(old.prepare("PRAGMA user_version").get()?.user_version, 9);
      const raw = old.prepare("SELECT data FROM events WHERE id=?").get(before.at(-3)!.id)!;
      assert.match(JSON.parse(String(raw.data)).payload.scope, /\/project\//);
      assert.equal(Number(old.prepare("SELECT count(*) AS count FROM retention_keys WHERE scope LIKE 'profile/default/artifact/%'").get()?.count), 0);
    } finally { old.close(); }
    restarted = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey });
    assert.equal(restarted.store.db.prepare("PRAGMA user_version").get()?.user_version, 12);
    assert.deepEqual(restarted.store.events().slice(0, before.length).map(({ id, seq }) => ({ id, seq })), before);
    const sdk = await new MoguriSdk(restarted.connection).ready();
    try {
      const plan = await sdk.artifacts.read(id);
      assert.equal(plan.text, "Generated legacy shared plan."); assert.equal(plan.artifact.sources[0]?.actor, "unknown");
      await sdk.artifacts.delete(id, 0, true);
      await sdk.artifacts.delete(unique, 0, true);
      assert.throws(() => restarted!.store.blob(uniqueDigest), /Missing or deleted/);
      assert.equal((await sdk.artifacts.read(other)).text, "Generated legacy shared plan.");
      assert.equal(restarted.store.blob(contentDigest), "Generated legacy shared plan.");
      assert.throws(() => restarted!.store.db.exec("UPDATE events SET payload='{}'"), /append-only/);
    } finally { sdk.disconnect(); }
  } finally { await restarted?.close(); await fixture.close(); }
});
