import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { isRecord, MoguriSdk, type CandidateTransportRecord } from "../packages/sdk/src/index.ts";
import { ProfileRuntime } from "../apps/service/src/profiles.ts";
import { remoteRootLease } from "../apps/service/src/remote.ts";
import { remoteFixture } from "./fixtures/remote-service.ts";
import { initializeGeneratedRepository } from "./fixtures/git-project.ts";

test("v2 candidate transport receipts stay exported and quarantined through every artifact-deletion surface", {
  skip: process.platform !== "darwin", timeout: 45_000,
}, async (t) => {
  const f = await remoteFixture(), sdk = new MoguriSdk(f.service.connection);
  t.after(() => f.close()); t.after(() => sdk.disconnect());
  await sdk.ready();
  try {
    initializeGeneratedRepository(f.workspace);
    await f.probe(); await f.select(); await sdk.refresh();
    const workspacePreview = (await sdk.candidates.workspacePreview(f.sessionId, "Generated retained peer stage")).preview;
    const workspace = await sdk.candidates.waitWorkspace((await sdk.candidates.createWorkspace(f.sessionId, workspacePreview.name, workspacePreview.digest, true)).id!);
    const source = await sdk.candidates.source(f.sessionId, ["fixture.txt"]);
    const patch = { kind: "patch" as const, summary: "Generated retained peer candidate",
      edits: [{ path: "fixture.txt", baseDigest: source.files[0]!.baseDigest, text: "Generated retained peer replacement.\n" }] };
    const preview = (await sdk.candidates.preview(f.sessionId, workspace.id, patch)).preview;
    const staged = await sdk.candidates.wait((await sdk.candidates.stage(f.sessionId, workspace.id, patch, preview.digest)).id!);
    const candidateId = staged.candidate.id, events = f.controller.events(0);
    const completed = events.findLast((event) => event.event_type === "candidate.transport_recorded" &&
      event.payload.transport.ownerId === candidateId && event.payload.transport.resultDigest);
    assert.ok(completed?.event_type === "candidate.transport_recorded");
    const resultDigest = completed.payload.transport.resultDigest;
    assert.ok(resultDigest);
    await t.test("the exact export includes transport events and their original retained result bytes under version11", async () => {
      const exported = (await sdk.artifacts.export(candidateId)).export, document: unknown = JSON.parse(exported.text);
      assert.ok(isRecord(document));
      assert.equal(document.schemaVersion, 11);
      assert.match(exported.text, /"candidate\.transport_recorded"/);
      assert.ok(exported.text.includes(resultDigest));
      assert.ok(exported.text.includes(JSON.stringify(f.service.store.blob(resultDigest))));
    });

    const initial = events.find((event) => event.event_type === "candidate.transport_recorded" &&
      event.payload.transport.ownerId === candidateId && event.payload.transport.revision === 0);
    assert.ok(initial?.event_type === "candidate.transport_recorded");
    const id = randomUUID(), launch: unknown = JSON.parse(initial.payload.transport.launchJson);
    assert.ok(isRecord(launch) && isRecord(launch.execution));
    const running: CandidateTransportRecord = { ...initial.payload.transport, id,
      operationDigest: "e".repeat(64), launchJson: JSON.stringify({ ...launch, execution: { ...launch.execution, id } }) };
    const event = (transport: CandidateTransportRecord) => ({ event_type: "candidate.transport_recorded" as const,
      profile_id: sdk.profileId, project_id: f.session().projectId, artifact_id: candidateId, payload: { transport } });
    f.service.store.commit([event(running), event({ ...running, revision: 1, status: "partial",
      diagnostic: "Generated lost terminal/cleanup receipt; no process completion was asserted." })]);
    f.controller.refreshProfile(); await sdk.refresh();

    await t.test("an unloaded foreign profile retains exact peer leases, never its Local checkout mapping", () => {
      const unloaded = new ProfileRuntime(f.service.store, join(f.directory, "state"), {
        controller: () => { throw new Error("A content-free lease lookup must not load a foreign controller."); },
        changed: () => { throw new Error("A content-free lease lookup must not publish foreign data."); },
      });
      const lease = remoteRootLease({ hostKey: f.ssh.target.hostKey }, f.workspace);
      assert.ok(lease);
      assert.equal(unloaded.hooks.foreignRootBusy("generated-another-profile", lease), true);
      assert.equal(unloaded.hooks.foreignRootBusy("generated-another-profile", f.project, true), false);
      assert.equal(unloaded.hooks.foreignRootBusy("generated-another-profile", `${lease}/not-the-original-root`, true), false);
    });
    await t.test("candidate cleanup cannot forget grants behind an unsettled owned transport", () => {
      assert.throws(() => f.controller.platform.artifacts.deleteCandidates([candidateId]), { code: "candidate_cleanup_pending" });
    });
    await t.test("project removal cannot forget the exact unsettled candidate transport", async () => {
      const removal = f.controller.platform.artifacts.preview(f.session().projectId);
      await assert.rejects(() => f.controller.platform.artifacts.removal(f.session().projectId,
        { action: "delete", expectedDigest: removal.digest }), { code: "candidate_cleanup_pending" });
    });
    await t.test("direct artifact deletion cannot discard the retained ownership or encrypted receipt grants", async () => {
      const artifact = (await sdk.artifacts.read(candidateId)).artifact;
      await assert.rejects(() => sdk.artifacts.delete(candidateId, artifact.revision, true), { code: "candidate_cleanup_pending" });
      assert.equal((await sdk.candidates.read(candidateId)).candidate.status, "staged");
      assert.equal(f.service.store.blob(resultDigest).length > 0, true);
    });
    assert.equal(f.requests.length, 0);
  } finally { sdk.disconnect(); await f.close(); }
});
