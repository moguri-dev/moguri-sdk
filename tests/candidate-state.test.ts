import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { performance } from "node:perf_hooks";
import { EventStore, digest } from "../apps/service/src/store.ts";
import { ArtifactRuntime } from "../apps/service/src/artifacts.ts";
import { startService } from "../apps/service/src/server.ts";
import { setupFixture } from "./fixture.ts";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { CandidateRecordSchema, parse, PROTOCOL_VERSION, projectEvents, type CandidateRecord, type CapabilityJob, type RetainedArtifact, type Snapshot, type StoredEvent } from "../packages/protocol/src/index.ts";

function candidate(store: EventStore, id = "generated-candidate", projectId = "generated-project") {
  const source = { env: "Local" as const, projectId, workspaceId: null, root: "/generated/source", device: "1", inode: "2",
    gitCommonDir: "/generated/source/.git", branch: "generated/source-branch", head: "a".repeat(40) };
  const stage = { ...source, workspaceId: "generated-stage", root: "/generated/stage", inode: "3", branch: "generated/stage-branch" };
  const patch = { kind: "patch" as const, summary: "Generated unaccepted candidate.", edits: [
    { path: "generated.ts", baseDigest: "absent", text: "export const generated = true;\n" },
  ] };
  const document = { format: "moguri-candidate", version: 1, source, stage, authorityDigest: "b".repeat(64), patch };
  const text = JSON.stringify(document), documentDigest = store.putBlob(text);
  const proposalDigest = createHash("sha256").update("moguri-candidate-v1\0").update(text).digest("hex");
  const createdAt = "2026-01-01T00:00:00.000Z";
  const artifact: RetainedArtifact = { id, projectId: source.projectId, originSessionId: "generated-origin", workspaceId: null, folderId: null, workItemId: null,
    kind: "report", name: "Generated candidate report", path: null, contentDigest: documentDigest, revision: 0, status: "active", createdAt, updatedAt: createdAt,
    origin: "manual", edited: false, sources: [{ eventId: null, sessionId: null, messageId: null, actor: "unknown", modelId: null, outcome: "user-imported-proposal", contentDigest: digest(JSON.stringify(patch)) }] };
  const record: CandidateRecord = { version: 1, id, profileId: store.profileId, projectId: source.projectId, originSessionId: artifact.originSessionId,
    source, stage, documentDigest, proposalDigest, paths: ["generated.ts"], revision: 0, status: "staging", createdAt, updatedAt: createdAt,
    stageIntent: { commandId: `stage-${id}`, commandDigest: "c".repeat(64), jobId: `job-${id}` }, applyIntent: null, acceptance: null,
    stagedPaths: [], attemptedPaths: [], appliedPaths: [], stageResultDigest: null, applyResultDigest: null, diagnostic: null };
  return { artifact, record, document, text };
}
function seed(store: EventStore, f: ReturnType<typeof candidate>) {
  store.commit([
    { event_type: "artifact.revised", profile_id: f.record.profileId, project_id: f.record.projectId, payload: { artifact: f.artifact } },
    { event_type: "candidate.saved", profile_id: f.record.profileId, project_id: f.record.projectId, payload: { candidate: f.record } },
  ]);
  return store.events();
}
function append(history: StoredEvent[], records: CandidateRecord[]): StoredEvent[] {
  const last = history.at(-1)!; assert.ok(last.event_type === "candidate.saved");
  return [...history, ...records.map((record, index) => ({ ...last, seq: last.seq + index + 1, id: randomUUID(), payload: { candidate: record } }))];
}

function retainedRows(db: DatabaseSync) {
  return {
    events: db.prepare("SELECT seq,id,data,payload FROM events ORDER BY seq").all(),
    keys: db.prepare("SELECT scope,payload FROM retention_keys ORDER BY scope").all(),
    receipts: db.prepare("SELECT profile_id,id,digest,result FROM receipts ORDER BY profile_id,id").all(),
    blobs: db.prepare("SELECT digest,scope,payload FROM blob_payloads ORDER BY digest,scope").all(),
    scopes: db.prepare("SELECT locator,scope_id,profile_id,project_id,workspace_id,metadata FROM memory_scopes ORDER BY locator").all(),
  };
}

test("candidate records bind independent artifact identity instead of the origin conversation's retention grant", () => {
  const store = new EventStore(":memory:");
  try {
    const f = candidate(store);
    store.commit([
      { event_type: "artifact.revised", profile_id: "default", project_id: f.record.projectId, payload: { artifact: f.artifact } },
      { event_type: "candidate.saved", profile_id: "default", project_id: f.record.projectId, payload: { candidate: f.record } },
    ]);
    const events = store.events(), saved = events.at(-1)!;
    assert.equal(saved.artifact_id, f.record.id);
    assert.deepEqual(projectEvents(events).candidates, [f.record]);
    assert.deepEqual(projectEvents(events, "generated-other-profile").candidates, []);
    const key = store.db.prepare("SELECT project_id,session_id FROM retention_keys WHERE scope=?").get(`profile/default/artifact/${f.record.id}`);
    assert.equal(key?.project_id, null); assert.equal(key?.session_id, null);
    assert.equal(store.blob(f.record.documentDigest), f.text);
  } finally { store.close(); }
});

test("one original candidate command cannot be duplicated across records or rebound to a different job/root/phase", () => {
  const store = new EventStore(":memory:");
  try {
    const f = candidate(store), history = seed(store, f);
    const job: CapabilityJob = { id: f.record.stageIntent.jobId, kind: "candidate.stage", sessionId: null, projectId: f.record.projectId, workspaceId: f.record.stage.workspaceId,
      parentTurnId: null, status: "running", progress: "Generated original candidate intent.", resultDigest: null, error: null,
      candidate: { candidateId: f.record.id, phase: "stage", commandId: f.record.stageIntent.commandId, commandDigest: f.record.stageIntent.commandDigest } };
    const tail = history.at(-1)!;
    const event: StoredEvent = { ...tail, seq: tail.seq + 1, event_type: "job.started", id: randomUUID(), artifact_id: f.record.id, payload: { job } };
    assert.equal(projectEvents([...history, event]).jobs[0]?.candidate?.commandId, f.record.stageIntent.commandId);
    for (const changed of [
      { ...job, id: "generated-substitute-job" }, { ...job, workspaceId: null }, { ...job, kind: "candidate.apply" },
      { ...job, candidate: { ...job.candidate!, commandDigest: "0".repeat(64) } },
      { ...job, candidate: { ...job.candidate!, candidateId: "generated-foreign-candidate" } },
      { ...job, candidate: undefined },
    ]) assert.throws(() => projectEvents([...history, { ...event, payload: { job: changed } }]), { code: "candidate_corrupt" });
    const other = candidate(store, "generated-other-candidate");
    store.commit([
      { event_type: "artifact.revised", profile_id: "default", project_id: other.record.projectId, payload: { artifact: other.artifact } },
      { event_type: "candidate.saved", profile_id: "default", project_id: other.record.projectId, payload: { candidate: { ...other.record, stageIntent: f.record.stageIntent } } },
    ]);
    assert.throws(() => projectEvents(store.events()), { code: "candidate_corrupt" });
  } finally { store.close(); }
});

test("failed candidate intent append atomically retains no artifact grant, job identity or command receipt", () => {
  const store = new EventStore(":memory:");
  try {
    const f = candidate(store);
    store.db.exec(`CREATE TRIGGER generated_candidate_intent BEFORE INSERT ON events WHEN json_extract(NEW.data,'$.event_type')='candidate.saved'
      BEGIN SELECT RAISE(ABORT,'Generated candidate intent failure'); END;`);
    assert.throws(() => store.commit([
      { event_type: "artifact.revised", profile_id: "default", project_id: f.record.projectId, payload: { artifact: f.artifact } },
      { event_type: "candidate.saved", profile_id: "default", project_id: f.record.projectId, payload: { candidate: f.record } },
    ], { id: f.record.stageIntent.commandId, digest: f.record.stageIntent.commandDigest, result: { id: f.record.id } }), /Generated candidate intent failure/);
    assert.equal(store.events().length, 0); assert.equal(store.receipt(f.record.stageIntent.commandId, f.record.stageIntent.commandDigest), undefined);
    assert.equal(store.db.prepare("SELECT count(*) AS count FROM retention_keys").get()?.count, 0);
    assert.equal(store.db.prepare("SELECT count(*) AS count FROM blob_payloads").get()?.count, 0);
  } finally { store.close(); }
});

test("identical candidate content and IDs retain separate profile grants across deletion and reopen", async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "moguri-candidate-profiles-"))), path = join(directory, "state.sqlite"), key = randomBytes(32);
  let root: EventStore | undefined = new EventStore(path, key), work: EventStore | undefined;
  try {
    const f = candidate(root); seed(root, f); work = root.view("generated-work");
    const other = candidate(work); seed(work, other);
    assert.equal(other.record.documentDigest, f.record.documentDigest);
    assert.equal(projectEvents(root.events()).candidates[0]?.profileId, "default");
    assert.equal(projectEvents(work.events(), "generated-work").candidates[0]?.profileId, "generated-work");
    root.commit([{ event_type: "artifact.deleted", profile_id: "default", payload: { artifactId: f.record.id } }], undefined, { artifacts: [f.record.id] });
    assert.throws(() => root!.blob(f.record.documentDigest), /Missing or deleted/);
    assert.equal(work.blob(other.record.documentDigest), other.text);
    work.close(); work = undefined; root.close(); root = new EventStore(path, key); work = root.view("generated-work");
    assert.equal(projectEvents(root.events()).candidates.length, 0);
    assert.equal(projectEvents(work.events(), "generated-work").candidates.length, 1);
    assert.equal(work.blob(other.record.documentDigest), other.text);
  } finally { work?.close(); root?.close(); await rm(directory, { recursive: true, force: true }); }
});

test("candidate schemas and projection reject foreign roots, fabricated outcomes, aliases and unsupported authority", () => {
  const store = new EventStore(":memory:");
  try {
    const f = candidate(store), history = seed(store, f), original = history.at(-1)!; assert.ok(original.event_type === "candidate.saved");
    assert.throws(() => parse(CandidateRecordSchema, { ...f.record, version: 2 }), { code: "invalid_request" });
    assert.throws(() => parse(CandidateRecordSchema, { ...f.record, source: { ...f.record.source, env: "Remote" } }), { code: "invalid_request" });
    assert.throws(() => parse(CandidateRecordSchema, { ...f.record, acceptance: { actor: "model", confidence: 1 } }), { code: "invalid_request" });
    for (const change of [
      { revision: 4 }, { status: "applied" }, { profileId: "generated-other-profile" },
      { source: { ...f.record.source, projectId: "generated-other-project" } },
      { stage: { ...f.record.stage, workspaceId: null } },
      { stage: { ...f.record.source, workspaceId: f.record.stage.workspaceId } },
      { stage: { ...f.record.stage, head: "f".repeat(40) } },
      { paths: ["../generated.ts"] }, { paths: ["generated.ts", "GENERATED.TS"] }, { updatedAt: "2026-02-31T00:00:00.000Z" },
    ] satisfies Partial<CandidateRecord>[]) assert.throws(() => projectEvents([
      ...history.slice(0, -1), { ...original, payload: { candidate: { ...f.record, ...change } } },
    ]), { code: "candidate_corrupt" });
  } finally { store.close(); }
});

test("candidate revisions preserve original roots/intents and cannot erase an effect, invent acceptance or replay a terminal result", () => {
  const store = new EventStore(":memory:");
  try {
    const f = candidate(store), history = seed(store, f);
    const tail = history.at(-1)!;
    assert.throws(() => projectEvents([...history, { ...tail, event_type: "artifact.revised", seq: tail.seq + 1, id: randomUUID(),
      payload: { artifact: { ...f.artifact, revision: 1, contentDigest: "0".repeat(64) } } }]), { code: "candidate_corrupt" });
    const staged: CandidateRecord = { ...f.record, revision: 1, status: "staged", stagedPaths: f.record.paths, stageResultDigest: "d".repeat(64) };
    const applyIntent = { commandId: "generated-apply", commandDigest: "e".repeat(64), jobId: "generated-apply-job" };
    const acceptance: NonNullable<CandidateRecord["acceptance"]> = { actor: "user", commandId: applyIntent.commandId, commandDigest: applyIntent.commandDigest,
      proposalDigest: f.record.proposalDigest, reviewDigest: "f".repeat(64), authorityDigest: "1".repeat(64), at: f.record.createdAt };
    const applying: CandidateRecord = { ...staged, revision: 2, status: "applying", applyIntent, acceptance, attemptedPaths: f.record.paths };
    const applied: CandidateRecord = { ...applying, revision: 3, status: "applied", appliedPaths: f.record.paths, applyResultDigest: "2".repeat(64) };
    assert.equal(projectEvents(append(history, [staged, applying, applied])).candidates[0]?.status, "applied");
    for (const changed of [
      { ...staged, revision: 3 }, { ...staged, source: { ...staged.source, root: "/generated/other" } },
      { ...staged, stageIntent: { ...staged.stageIntent, commandDigest: "9".repeat(64) } },
      { ...staged, stagedPaths: [] }, { ...staged, paths: ["other.ts"] }, { ...staged, stageResultDigest: null },
      { ...applying, acceptance: null }, { ...applying, acceptance: { ...acceptance, proposalDigest: "0".repeat(64) } },
    ] satisfies CandidateRecord[]) assert.throws(() => projectEvents(append(history, [changed])), { code: "candidate_corrupt" });
    assert.throws(() => projectEvents(append(history, [staged, applying, { ...applying, revision: 3, attemptedPaths: [] }])), { code: "candidate_corrupt" });
    assert.throws(() => projectEvents(append(history, [staged, applying, { ...applied, applyIntent: { ...applyIntent, commandId: "generated-substitute" } }])), { code: "candidate_corrupt" });
    assert.throws(() => projectEvents(append(history, [staged, applying, applied, { ...applied, revision: 4, status: "applying", applyResultDigest: null }])), { code: "candidate_corrupt" });
    const partial: CandidateRecord = { ...applying, revision: 3, status: "partial", diagnostic: "Generated interrupted acknowledgement." };
    const acknowledged: CandidateRecord = { ...partial, revision: 4, status: "acknowledged" };
    assert.equal(projectEvents(append(history, [staged, applying, partial, acknowledged])).candidates[0]?.status, "acknowledged");
    assert.throws(() => projectEvents(append(history, [staged, applying, partial, { ...applied, revision: 4 }])), { code: "candidate_corrupt" });
  } finally { store.close(); }
});

test("candidate documents and records survive source retention but disappear only with their independent artifact grant", () => {
  const store = new EventStore(":memory:");
  try {
    const f = candidate(store); seed(store, f);
    store.commit([{ event_type: "session.deleted", profile_id: "default", payload: { deletedSessionId: "generated-origin", usage: [] } }], undefined, { sessions: ["generated-origin"] });
    assert.equal(projectEvents(store.events()).candidates.length, 1);
    store.commit([
      { event_type: "artifact.revised", profile_id: "default", payload: { artifact: { ...f.artifact, projectId: null, revision: 1 } } },
      { event_type: "project.removed", profile_id: "default", payload: { deletedProjectId: f.record.projectId, usage: [], artifactChoice: "retain" } },
    ], undefined, { projects: [f.record.projectId] });
    assert.equal(projectEvents(store.events()).candidates.length, 1);
    assert.equal(store.blob(f.record.documentDigest), f.text);
    store.commit([{ event_type: "artifact.deleted", profile_id: "default", payload: { artifactId: f.record.id } }], undefined, { artifacts: [f.record.id] });
    assert.equal(projectEvents(store.events()).candidates.length, 0);
    assert.throws(() => store.blob(f.record.documentDigest), /Missing or deleted/);
  } finally { store.close(); }
});

test("candidate job lifecycle and results share independent retention and cannot upgrade a partial job into success", () => {
  const store = new EventStore(":memory:");
  try {
    const f = candidate(store); seed(store, f);
    const job: CapabilityJob = { id: f.record.stageIntent.jobId, kind: "candidate.stage", projectId: f.record.projectId, sessionId: null,
      workspaceId: f.record.stage.workspaceId, parentTurnId: null, status: "running", progress: "Generated stage.", resultDigest: null, error: null,
      candidate: { candidateId: f.record.id, phase: "stage", commandId: f.record.stageIntent.commandId, commandDigest: f.record.stageIntent.commandDigest } };
    store.commit([{ event_type: "job.started", profile_id: "default", project_id: job.projectId, payload: { job } }]);
    const history = store.events(), tail = history.at(-1)!;
    const falseCompletion: StoredEvent = { ...tail, event_type: "job.finished", id: randomUUID(), seq: tail.seq + 1,
      payload: { jobId: job.id, candidateId: f.record.id, status: "completed", resultDigest: "f".repeat(64), error: null } };
    assert.throws(() => projectEvents([...history, falseCompletion]), { code: "candidate_corrupt" });
    const unboundProgress: StoredEvent = { ...tail, event_type: "job.progress", id: randomUUID(), seq: tail.seq + 1, payload: { jobId: job.id, progress: "Generated unbound." } };
    assert.throws(() => projectEvents([...history, unboundProgress]), { code: "candidate_corrupt" });
    const resultDigest = store.putBlob("{\"generated\":\"partial-stage-result\"}");
    store.commit([
      { event_type: "job.progress", profile_id: "default", project_id: job.projectId, payload: { jobId: job.id, candidateId: f.record.id, progress: "Generated known interruption." } },
      { event_type: "candidate.saved", profile_id: "default", project_id: job.projectId, payload: { candidate: { ...f.record, revision: 1, status: "partial", diagnostic: "Generated interrupted stage." } } },
      { event_type: "job.finished", profile_id: "default", project_id: job.projectId, payload: { jobId: job.id, candidateId: f.record.id, status: "partial", resultDigest, error: "Generated interrupted stage." } },
    ]);
    const partial = projectEvents(store.events()); assert.equal(partial.jobs[0]?.status, "partial");
    assert.ok(partial.blockedWorkspaces.includes(f.record.stage.workspaceId!));
    assert.ok(store.events().filter((event) => event.event_type.startsWith("job.")).every((event) => event.artifact_id === f.record.id));
    assert.throws(() => projectEvents([...store.events(), { ...falseCompletion, seq: store.events().at(-1)!.seq + 1 }]), { code: "candidate_corrupt" });
    store.commit([
      { event_type: "artifact.revised", profile_id: "default", payload: { artifact: { ...f.artifact, projectId: null, revision: 1 } } },
      { event_type: "project.removed", profile_id: "default", payload: { deletedProjectId: f.record.projectId, usage: [], artifactChoice: "retain" } },
    ], undefined, { projects: [f.record.projectId] });
    assert.equal(projectEvents(store.events()).jobs[0]?.status, "partial"); assert.equal(store.blob(resultDigest), "{\"generated\":\"partial-stage-result\"}");
    store.commit([{ event_type: "artifact.deleted", profile_id: "default", payload: { artifactId: f.record.id } }], undefined, { artifacts: [f.record.id] });
    assert.equal(projectEvents(store.events()).jobs.length, 0);
    assert.throws(() => store.blob(resultDigest), /Missing or deleted/);
  } finally { store.close(); }
});

test("service restart preserves original candidate intent and marks interrupted work partial without probing or replaying missing roots", async () => {
  const fixture = await setupFixture(); let restarted: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    const f = candidate(fixture.service.store);
    const job: CapabilityJob = { id: f.record.stageIntent.jobId, kind: "candidate.stage", projectId: f.record.projectId, sessionId: null,
      workspaceId: f.record.stage.workspaceId, parentTurnId: null, status: "running", progress: "Generated held stage.", resultDigest: null, error: null,
      candidate: { candidateId: f.record.id, phase: "stage", commandId: f.record.stageIntent.commandId, commandDigest: f.record.stageIntent.commandDigest } };
    fixture.service.store.commit([
      { event_type: "artifact.revised", profile_id: "default", project_id: f.record.projectId, payload: { artifact: f.artifact } },
      { event_type: "candidate.saved", profile_id: "default", project_id: f.record.projectId, payload: { candidate: f.record } },
      { event_type: "job.started", profile_id: "default", project_id: f.record.projectId, payload: { job } },
    ], { id: f.record.stageIntent.commandId, digest: f.record.stageIntent.commandDigest, result: { id: f.record.id } });
    fixture.service.store.db.prepare("DELETE FROM receipts WHERE profile_id=? AND id=?").run("default", f.record.stageIntent.commandId);
    const before = fixture.service.store.events().map((event) => event.id);
    await fixture.service.close();
    restarted = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey });
    const recovered = restarted.controller.snapshot().candidates.find((value) => value.id === f.record.id)!;
    assert.equal(recovered.status, "partial"); assert.equal(recovered.revision, 1);
    assert.deepEqual(recovered.stageIntent, f.record.stageIntent);
    assert.equal(restarted.controller.snapshot().jobs.find((value) => value.id === job.id)?.status, "partial");
    assert.ok(restarted.controller.snapshot().blockedWorkspaces.includes(f.record.stage.workspaceId!));
    assert.deepEqual(restarted.store.events().slice(0, before.length).map((event) => event.id), before);
    assert.equal(restarted.store.blob(recovered.documentDigest), f.text); assert.equal(fixture.requests.length, 0);
    const candidateEvents = restarted.store.events().filter((event) => event.event_type === "candidate.saved").map((event) => event.id);
    await restarted.close();
    restarted = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey });
    assert.deepEqual(restarted.store.events().filter((event) => event.event_type === "candidate.saved").map((event) => event.id), candidateEvents);
    assert.equal(restarted.store.receipt(f.record.stageIntent.commandId, f.record.stageIntent.commandDigest), undefined);
    assert.equal(fixture.requests.length, 0);
  } finally { await restarted?.close(); await fixture.close(); }
});

test("shared artifact APIs preserve immutable candidate documents, active ownership and exact exported workflow history", async () => {
  const fixture = await setupFixture(), f = candidate(fixture.service.store, "generated-sdk-candidate", fixture.session().projectId);
  let sdk: MoguriSdk | undefined;
  try {
    const job: CapabilityJob = { id: f.record.stageIntent.jobId, kind: "candidate.stage", projectId: f.record.projectId, sessionId: null, workspaceId: f.record.stage.workspaceId,
      parentTurnId: null, status: "running", progress: "Generated stage.", resultDigest: null, error: null,
      candidate: { candidateId: f.record.id, phase: "stage", commandId: f.record.stageIntent.commandId, commandDigest: f.record.stageIntent.commandDigest } };
    seed(fixture.service.store, f);
    fixture.service.store.commit([{ event_type: "job.started", profile_id: "default", project_id: job.projectId, payload: { job } }]);
    fixture.service.controller.refreshProfile();
    sdk = await new MoguriSdk(fixture.service.connection).ready();
    await assert.rejects(() => sdk!.artifacts.update(f.record.id, { text: "Generated unreviewed substitute." }, 0), { code: "candidate_document" });
    await assert.rejects(() => sdk!.artifacts.delete(f.record.id, 0, true), { code: "candidate_busy" });
    const before = (await sdk.artifacts.projectPreview(f.record.projectId)).preview.digest;
    const resultDigest = fixture.service.store.putBlob("{\"generated\":\"retained-candidate-result\"}");
    fixture.service.store.commit([
      { event_type: "candidate.saved", profile_id: "default", project_id: f.record.projectId, payload: { candidate: { ...f.record, revision: 1, status: "partial", diagnostic: "Generated interrupted stage." } } },
      { event_type: "job.finished", profile_id: "default", project_id: f.record.projectId, payload: { jobId: job.id, candidateId: f.record.id, status: "partial", resultDigest, error: "Generated interrupted stage." } },
    ]);
    fixture.service.controller.refreshProfile(); await sdk.refresh();
    assert.notEqual((await sdk.artifacts.projectPreview(f.record.projectId)).preview.digest, before);
    await sdk.artifacts.update(f.record.id, { name: "Generated reviewed candidate name" }, 0);
    const exported = (await sdk.artifacts.export(f.record.id)).export;
    const archive = JSON.parse(exported.text); assert.equal(archive.schemaVersion, 2);
    const document = archive.documents[0];
    assert.equal(document.revisions[0].text, f.text);
    assert.equal(document.candidate.events.filter((event: StoredEvent) => event.event_type === "candidate.saved").length, 2);
    assert.ok(document.candidate.events.some((event: StoredEvent) => event.event_type === "job.finished"));
    assert.deepEqual(document.candidate.results, [{ digest: resultDigest, text: "{\"generated\":\"retained-candidate-result\"}" }]);
    await sdk.artifacts.delete(f.record.id, 1, true);
    assert.equal(sdk.getState().snapshot!.candidates.length, 0); assert.equal(fixture.requests.length, 0);
  } finally { sdk?.disconnect(); await fixture.close(); }
});

test("candidate exports accept exactly eight MiB and reject the next byte without discarding workflow grants", async () => {
  const generated = (body: string) => {
    const store = new EventStore(":memory:"), f = candidate(store); seed(store, f);
    const resultDigest = store.putBlob(body), job: CapabilityJob = { id: f.record.stageIntent.jobId, kind: "candidate.stage", projectId: f.record.projectId, sessionId: null,
      workspaceId: f.record.stage.workspaceId, parentTurnId: null, status: "running", progress: "Generated stage.", resultDigest: null, error: null,
      candidate: { candidateId: f.record.id, phase: "stage", commandId: f.record.stageIntent.commandId, commandDigest: f.record.stageIntent.commandDigest } };
    store.commit([
      { event_type: "job.started", profile_id: "default", project_id: job.projectId, payload: { job } },
      { event_type: "candidate.saved", profile_id: "default", project_id: f.record.projectId, payload: { candidate: { ...f.record, revision: 1, status: "partial", diagnostic: "Generated partial." } } },
      { event_type: "job.finished", profile_id: "default", project_id: job.projectId, payload: { jobId: job.id, candidateId: f.record.id, status: "partial", resultDigest, error: "Generated partial." } },
    ]);
    const snapshot = (): Snapshot => ({ ...projectEvents(store.events()), profileId: "default", protocolVersion: PROTOCOL_VERSION, seq: store.events().at(-1)!.seq,
      provider: { status: "disconnected", models: [], login: null, diagnostic: null }, capabilities: [] });
    const unused = (): never => { throw new Error("Generated read-only export unexpectedly requested filesystem or job authority."); };
    const runtime = new ArtifactRuntime(store, { snapshot, events: () => store.events(), closingProject: () => false, wake: unused,
      root: unused, assertRoot: unused, projects: unused, foreignRootBusy: () => false, job: unused });
    return { store, artifactId: f.record.id, resultDigest, runtime };
  };
  const baseline = generated(""); let overhead: number;
  try {
    const result = await baseline.runtime.query({ type: "artifact.export", artifactId: baseline.artifactId });
    assert.ok(result.type === "artifact.export"); overhead = Buffer.byteLength(result.export.text);
  } finally { baseline.store.close(); }
  const maximum = 8 * 1024 * 1024;
  for (const extra of [0, 1]) {
    const body = "g".repeat(maximum - overhead + extra), f = generated(body);
    try {
      const query = () => f.runtime.query({ type: "artifact.export", artifactId: f.artifactId });
      if (extra) await assert.rejects(query, { code: "artifact_export_limit" });
      else {
        const result = await query(); assert.ok(result.type === "artifact.export");
        assert.equal(Buffer.byteLength(result.export.text), maximum); assert.equal(result.export.digest, digest(result.export.text));
      }
      assert.equal(projectEvents(f.store.events()).candidates.length, 1);
      assert.equal(f.store.blob(f.resultDigest), body);
    } finally { f.store.close(); }
  }
});

test("schema-29 ownership migration preserves old independent candidate ciphertext and missing telemetry through failure/reopen", async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "moguri-candidate-execution-schema-"))), path = join(directory, "state.sqlite"), key = randomBytes(32);
  let store: EventStore | undefined = new EventStore(path, key);
  try {
    const f = candidate(store); seed(store, f);
    store.commit([], { id: f.record.stageIntent.commandId, digest: f.record.stageIntent.commandDigest, result: { id: f.record.id } });
    const before = retainedRows(store.db);
    store.db.exec(`BEGIN IMMEDIATE; DELETE FROM retention_metadata WHERE id IN ('candidate_execution_schema','budget_planning_schema','candidate_generation_schema','role_sequence_schema','candidate_role_schema','model_evidence_schema','owned_role_contract_schema','paste_file_schema','native_execution_schema','compound_workflow_schema','budget_winddown_schema'); PRAGMA user_version=28;
      CREATE TRIGGER generated_candidate_execution_marker BEFORE INSERT ON retention_metadata WHEN NEW.id='candidate_execution_schema'
      BEGIN SELECT RAISE(ABORT,'Generated candidate execution migration failure'); END; COMMIT;`);
    store.close(); store = undefined;
    assert.throws(() => new EventStore(path, key), /Generated candidate execution migration failure/);
    const raw = new DatabaseSync(path);
    try {
      assert.equal(raw.prepare("PRAGMA user_version").get()?.user_version, 28);
      assert.deepEqual(retainedRows(raw), before); raw.exec("DROP TRIGGER generated_candidate_execution_marker");
    } finally { raw.close(); }
    const started = performance.now(); store = new EventStore(path, key);
    assert.equal(store.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
    assert.deepEqual(retainedRows(store.db), before);
    const recovered = projectEvents(store.events()).candidates[0]!;
    assert.deepEqual(recovered, f.record);
    assert.equal(recovered.stageIntent.sessionId, undefined); assert.equal(recovered.stageAttemptedPaths, undefined); assert.equal(recovered.stopRequested, undefined);
    assert.equal(store.blob(recovered.documentDigest), f.text);
    assert.deepEqual(store.receipt(f.record.stageIntent.commandId, f.record.stageIntent.commandDigest), { id: f.record.id });
    console.log(JSON.stringify({ primitive: "generated-candidate-schema-28-to-29", ms: performance.now() - started, ciphertextUnchanged: true, missingAttemptsPreserved: true }));
  } finally { store?.close(); await rm(directory, { recursive: true, force: true }); }
});

test("schema-28 marker failure leaves schema-27 ciphertext, keys, receipts and derived scope data exactly reopenable", async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "moguri-candidate-state-"))), path = join(directory, "state.sqlite"), key = randomBytes(32);
  let store: EventStore | undefined = new EventStore(path, key);
  try {
    const f = candidate(store);
    store.commit([{ event_type: "artifact.revised", profile_id: "default", project_id: f.record.projectId, payload: { artifact: f.artifact } }],
      { id: "generated-legacy-command", digest: "7".repeat(64), result: { id: f.record.id } });
    store.db.prepare("INSERT INTO memory_scopes VALUES (?,?,?,?,?,?)").run("generated-locator", "generated-scope", "default", f.record.projectId, null, "{\"generated\":\"retained\"}");
    const before = retainedRows(store.db);
    store.db.exec(`BEGIN IMMEDIATE; DELETE FROM retention_metadata WHERE id IN ('candidate_workflow_schema','candidate_execution_schema','budget_planning_schema','candidate_generation_schema','role_sequence_schema','candidate_role_schema','model_evidence_schema','owned_role_contract_schema','paste_file_schema','native_execution_schema','compound_workflow_schema','budget_winddown_schema'); PRAGMA user_version=27;
      CREATE TRIGGER generated_candidate_marker BEFORE INSERT ON retention_metadata WHEN NEW.id='candidate_workflow_schema'
      BEGIN SELECT RAISE(ABORT,'Generated candidate migration interruption'); END; COMMIT;`);
    store.close(); store = undefined;
    assert.throws(() => new EventStore(path, key), /Generated candidate migration interruption/);
    const raw = new DatabaseSync(path);
    try {
      assert.equal(raw.prepare("PRAGMA user_version").get()?.user_version, 27);
      assert.equal(raw.prepare("SELECT value FROM retention_metadata WHERE id='candidate_workflow_schema'").get(), undefined);
      assert.deepEqual(retainedRows(raw), before); raw.exec("DROP TRIGGER generated_candidate_marker");
    } finally { raw.close(); }
    const started = performance.now(); store = new EventStore(path, key);
    assert.equal(store.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
    assert.deepEqual(retainedRows(store.db), before); assert.equal(projectEvents(store.events()).candidates.length, 0);
    assert.equal(store.blob(f.record.documentDigest), f.text);
    assert.deepEqual(store.receipt("generated-legacy-command", "7".repeat(64)), { id: f.record.id });
    console.log(JSON.stringify({ primitive: "generated-candidate-schema-27-to-28", ms: performance.now() - started, ciphertextUnchanged: true }));
  } finally { store?.close(); await rm(directory, { recursive: true, force: true }); }
});
