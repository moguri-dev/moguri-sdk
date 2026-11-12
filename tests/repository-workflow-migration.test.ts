import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventStore, repositoryWorkflowSchemaMarkers } from "../apps/service/src/store.ts";
import { startService } from "../apps/service/src/server.ts";
import { factoryControls, MoguriSdk, PROTOCOL_VERSION, projectEvents } from "../packages/sdk/src/index.ts";
import { setupFixture } from "./fixture.ts";
import { initializeGeneratedRepository } from "./fixtures/git-project.ts";
import { removeNativeCandidateIdentityFixtureMarker, removeRepositoryWorkflowFixtureMarkers, retainedCiphertextRows } from "./fixtures/legacy-state.ts";

test("a genuine100 upgrade atomically adds current metadata and preserves exact legacy roots, ciphertext, drafts and receipts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "moguri-generated-workflow-upgrade-")), path = join(directory, "state.sqlite"), key = Buffer.alloc(32, 0x68);
  let store: EventStore | undefined;
  try {
    store = new EventStore(path, key);
    store.commit([
      { event_type: "session.created", profile_id: "default", session_id: "generated-existing", payload: { title: "Generated original100", controls: factoryControls() } },
      { event_type: "draft.saved", profile_id: "default", session_id: "generated-existing", payload: { text: "Generated original unsent100 text.", attachments: [] } },
    ], { id: "generated-receipt100", digest: "generated-digest100", result: { id: "generated-existing" } });
    const events = store.events(); store.close(); store = undefined;
    const original = new DatabaseSync(path);
    removeRepositoryWorkflowFixtureMarkers(original, events); original.exec("PRAGMA user_version=100");
    const retained = retainedCiphertextRows(original);
    original.exec("CREATE TRIGGER generated101_failure BEFORE INSERT ON retention_metadata WHEN NEW.id='project_workflow_defaults_schema' BEGIN SELECT RAISE(ABORT,'Generated atomic101 interruption'); END"); original.close();
    assert.throws(() => new EventStore(path, key), /Generated atomic101 interruption/);
    const failed = new DatabaseSync(path);
    assert.equal(failed.prepare("PRAGMA user_version").get()?.user_version, 100);
    assert.deepEqual(retainedCiphertextRows(failed), retained);
    for (const id of repositoryWorkflowSchemaMarkers) assert.equal(failed.prepare("SELECT value FROM retention_metadata WHERE id=?").get(id), undefined);
    failed.exec("DROP TRIGGER generated101_failure"); failed.close();
    for (let restart = 0; restart < 2; restart++) {
      store = new EventStore(path, key);
      assert.equal(store.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
      assert.deepEqual(retainedCiphertextRows(store.db), retained);
      const session = projectEvents(store.events()).sessions[0]!;
      assert.equal(session.workspaceId, null); assert.equal(session.workspaceOrigin, undefined);
      assert.equal(session.draft.text, "Generated original unsent100 text.");
      store.close(); store = undefined;
    }
  } finally { store?.close(); await rm(directory, { recursive: true, force: true }); }
});

for (const variant of ["missing", "premature", "default-root-downgrade", "trust-downgrade", "forgotten-trust-downgrade"] as const) {
  test(`invalid101 ${variant} cannot relabel actual roots or actual-user trust and preserves source state`, async () => {
    const f = await setupFixture(), sdk = await new MoguriSdk(f.service.connection).ready();
    try {
      await writeFile(join(f.project, "generated-existing.sh"), "printf GENERATED_EXISTING\n");
      initializeGeneratedRepository(f.project, ["fixture.txt", "generated-existing.sh"]);
      if (variant === "default-root-downgrade") await sdk.sessions.create(f.session().projectId, "Generated actual default root");
      else if (variant.includes("trust")) {
        await sdk.repositoryTrust.trust((await sdk.repositoryTrust.preview(f.session().projectId)).preview);
        if (variant === "forgotten-trust-downgrade") {
          const { configuration } = await sdk.projects.configuration(f.session().projectId);
          await sdk.projects.remove(f.session().projectId, true, configuration.revision);
        }
      }
      const events = f.service.store.events();
      sdk.disconnect(); await f.service.close();
      const raw = new DatabaseSync(f.service.store.path);
      if (variant !== "missing") removeNativeCandidateIdentityFixtureMarker(raw, events);
      if (variant === "missing") raw.prepare("DELETE FROM retention_metadata WHERE id=?").run(repositoryWorkflowSchemaMarkers[0]);
      else if (variant === "premature") raw.exec("PRAGMA user_version=100");
      else raw.exec("DELETE FROM retention_metadata WHERE id IN ('repository_trust_schema','project_workflow_defaults_schema','partial_tool_recovery_schema'); PRAGMA user_version=100");
      const retained = retainedCiphertextRows(raw); raw.close();
      assert.throws(() => new EventStore(f.service.store.path, f.retentionKey), /repository workflow|pre-101/i);
      const preserved = new DatabaseSync(f.service.store.path);
      try { assert.deepEqual(retainedCiphertextRows(preserved), retained); } finally { preserved.close(); }
    } finally { sdk.disconnect(); await f.close(); }
  });
}

test("an explicitly trusted baseline survives service restart independently of sessions without executing or adopting source", async () => {
  const f = await setupFixture(), original = await new MoguriSdk(f.service.connection).ready();
  let service: Awaited<ReturnType<typeof startService>> | undefined, sdk: MoguriSdk | undefined;
  try {
    await writeFile(join(f.project, "generated-existing.sh"), "printf GENERATED_EXISTING\n");
    initializeGeneratedRepository(f.project, ["fixture.txt", "generated-existing.sh"]);
    const preview = (await original.repositoryTrust.preview(f.session().projectId)).preview;
    await original.repositoryTrust.trust(preview);
    const trust = structuredClone(original.repositoryTrust.get(f.session().projectId));
    await original.sessions.delete(f.sessionId, true, f.session().revision);
    original.disconnect(); await f.service.close();
    service = await startService({ stateDir: join(f.directory, "state"), provider: f.provider, retentionKey: f.retentionKey });
    sdk = await new MoguriSdk(service.connection).ready();
    assert.deepEqual(sdk.repositoryTrust.get(preview.projectId), trust);
    assert.equal(JSON.parse(service.store.blob(preview.baselineDigest)).files[0].path, "generated-existing.sh");
    assert.equal(f.requests.length, 0); assert.equal(sdk.getState().snapshot!.trustedScriptAttempts.length, 0);
  } finally { original.disconnect(); sdk?.disconnect(); await service?.close(); await f.close(); }
});
