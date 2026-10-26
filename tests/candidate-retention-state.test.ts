import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  factoryControls, projectEvents, projectCandidateCleanup, PROTOCOL_VERSION, type BudgetEntry, type CandidateGenerationRecord,
  type CandidateRecord, type RetainedArtifact, type Usage,
} from "../packages/protocol/src/index.ts";
import { EventStore } from "../apps/service/src/store.ts";
import { ControlPlane } from "../apps/service/src/controller.ts";
import { fixtureProvider } from "./fixture.ts";
import { retainedCiphertextRows } from "./fixtures/legacy-state.ts";
import { legacyCandidateJournal } from "./fixtures/legacy-candidate-journal.ts";

const at = "2026-01-01T00:00:00.000Z", projectId = "generated-project", sessionId = "generated-origin";
const source = { env: "Local" as const, projectId, workspaceId: null, root: "/generated/source", device: "1", inode: "2",
  gitCommonDir: "/generated/source/.git", branch: "generated-source", head: "a".repeat(40) };
const stage = { ...source, workspaceId: "generated-stage", root: "/generated/stage", inode: "3", branch: "generated-stage" };
function artifact(id: string, contentDigest: string): RetainedArtifact {
  return { id, projectId, originSessionId: sessionId, workspaceId: null, folderId: null, workItemId: null, kind: "report",
    name: "Generated legacy proposal", path: null, contentDigest, revision: 0, status: "active", createdAt: at, updatedAt: at,
    origin: "manual", edited: false, sources: [] };
}
function seedSession(store: EventStore, prUrl: string | null = null): void {
  store.commit([
    { event_type: "project.added", profile_id: store.profileId, project_id: projectId, payload: { project: { id: projectId, path: source.root, name: "Generated project" } } },
    { event_type: "session.created", profile_id: store.profileId, project_id: projectId, session_id: sessionId, payload: { title: "Generated origin", controls: factoryControls(), prUrl } },
  ]);
}
function seedCandidate(store: EventStore, id: string, originSessionId: string | null = sessionId): CandidateRecord {
  const documentDigest = store.putBlob(JSON.stringify({ format: "moguri-candidate", version: 1, source, stage,
    authorityDigest: "b".repeat(64), patch: { kind: "patch", summary: `Generated old proposal ${id}`, edits: [{ path: "generated.txt", baseDigest: "absent", text: "Generated proposal bytes.\n" }] } }));
  const candidate: CandidateRecord = { version: 1, id, profileId: store.profileId, projectId, originSessionId, source, stage,
    documentDigest, proposalDigest: "c".repeat(64), paths: ["generated.txt"], revision: 0, status: "staging", createdAt: at, updatedAt: at,
    stageIntent: { commandId: `command-${id}`, commandDigest: "d".repeat(64), jobId: `job-${id}` }, applyIntent: null, acceptance: null,
    stagedPaths: [], attemptedPaths: [], appliedPaths: [], stageResultDigest: null, applyResultDigest: null, diagnostic: null };
  store.commit([
    { event_type: "artifact.revised", profile_id: store.profileId, project_id: projectId, payload: { artifact: artifact(id, documentDigest) } },
    { event_type: "candidate.saved", profile_id: store.profileId, project_id: projectId, payload: { candidate } },
  ]);
  return candidate;
}
function seedGeneration(store: EventStore) {
  const id = "generated-old-generation", stepId = "generated-old-model-step", inputDigest = store.putBlob('{"generated":"original source snapshot"}');
  const resultDigest = store.putBlob('{"generated":"RAW_CANDIDATE_PROPOSAL_NOT_ACCOUNTING"}');
  const generation: CandidateGenerationRecord = { version: 1, id, profileId: store.profileId, projectId, sessionId,
    commandId: "generated-original-paid-command", commandDigest: "d".repeat(64), inputDigest, modelId: "generated-model", modelBindingDigest: "e".repeat(64),
    source, stage, authorityDigest: "f".repeat(64), revision: 0, status: "running", createdAt: at, updatedAt: at, stopRequested: false,
    stepId: null, providerId: null, apiModelId: null, resultDigest: null, proposalDocumentDigest: null, diagnostic: null };
  const usage: Usage = { stepId, modelId: generation.modelId, role: "draft", inputTokens: 30, outputTokens: 12, cacheReadTokens: 0, totalTokens: 42,
    estimatedUsd: null, providerReportedUsd: null, billedUsd: null, requestMs: 10, quality: "provider-reported", outcome: "completed" };
  const entry: BudgetEntry = { id: stepId, sessionId, ownerSessionId: sessionId, projectId, folderId: null, turnId: id, modelId: generation.modelId,
    providerId: "generated-provider", apiModelId: "generated-canonical-model", role: "draft", env: "Local", createdAt: at, imported: false, status: "settled",
    inputEstimate: 100, outputLimit: 100, reservedTokens: 200, reportedTokens: 42, reservedUsdMicros: null, estimatedUsdMicros: null, rate: null, requestMs: 10,
    outcome: "completed", diagnostic: null, inputTokens: 30, outputTokens: 12, cacheReadTokens: 0 };
  const common = { profile_id: store.profileId, project_id: projectId, session_id: sessionId, turn_id: id };
  const started = { ...generation, revision: 1, stepId, providerId: entry.providerId, apiModelId: entry.apiModelId };
  store.commit([
    { event_type: "artifact.revised", profile_id: store.profileId, project_id: projectId, payload: { artifact: artifact(id, inputDigest) } },
    { event_type: "candidate.generation_recorded", profile_id: store.profileId, payload: { generation } },
    { ...common, event_type: "turn.control_started", payload: { purpose: "candidate.generate", generationId: id, controls: factoryControls(), policyRevision: 0, promptDigest: store.putBlob("Generated original system prompt") } },
    { ...common, event_type: "model.started", step_id: stepId, payload: { modelId: generation.modelId, role: "draft" } },
    { event_type: "budget.recorded", profile_id: store.profileId, payload: { entry } },
    { event_type: "candidate.generation_recorded", profile_id: store.profileId, payload: { generation: started } },
    { ...common, event_type: "model.completed", step_id: stepId, payload: { contextDigest: resultDigest, usage,
      message: { id: stepId, turnId: id, role: "notice", text: "Generated proposal report, not solver context.", timestamp: at } } },
    { event_type: "candidate.generation_recorded", profile_id: store.profileId, payload: { generation: { ...started, revision: 2, resultDigest } } },
    { event_type: "candidate.generation_recorded", profile_id: store.profileId, payload: { generation: { ...started, revision: 3, resultDigest, status: "partial", diagnostic: "Generated retained invalid proposal." } } },
    { ...common, event_type: "turn.finished", payload: { outcome: "partial", diagnostic: "Generated bounded proposal did not pass its contract.", workspaceEffects: "none" } },
  ]);
  return { id, resultDigest, inputDigest, entry };
}
function downgrade(store: EventStore): void {
  store.db.exec("BEGIN IMMEDIATE; DELETE FROM retention_metadata WHERE id IN ('project_kanban_schema','session_github_workflows_schema','session_github_convergence_schema','session_navigation_schema','workspace_experience_schema','candidate_retention_schema','lean_tooling_schema','lean_tooling_convergence_schema'); PRAGMA user_version=56; COMMIT;");
}

test("schema-56 rollback preserves ciphertext, keys and accounting; successful replay binds original provenance, never the latest link or an unknown owner", async () => {
  const directory = await mkdtemp(join(tmpdir(), "moguri-candidate-owner-migration-")), path = join(directory, "state.sqlite"), key = randomBytes(32);
  let store: EventStore | undefined = new EventStore(path, key);
  const provider = await fixtureProvider(); let control: ControlPlane | undefined;
  try {
    seedSession(store, "https://github.com/generated/project/pull/7");
    seedCandidate(store, "generated-original");
    seedCandidate(store, "generated-unknown", null);
    store.commit([{ event_type: "session.organized", profile_id: "default", project_id: projectId, session_id: sessionId, payload: { changes: { prUrl: "https://github.com/generated/project/pull/8" } } }]);
    const before = retainedCiphertextRows(store.db);
    downgrade(store); store.close(); store = undefined;
    const raw = new DatabaseSync(path);
    raw.exec(`CREATE TRIGGER generated_candidate_marker BEFORE INSERT ON retention_metadata WHEN NEW.id='candidate_retention_schema'
      BEGIN SELECT RAISE(ABORT,'Generated candidate migration failure'); END;`); raw.close();
    assert.throws(() => new EventStore(path, key), /migration failure/);
    const failed = new DatabaseSync(path);
    assert.equal(failed.prepare("PRAGMA user_version").get()?.user_version, 56);
    assert.deepEqual(retainedCiphertextRows(failed), before);
    failed.exec("DROP TRIGGER generated_candidate_marker"); failed.close();
    const start = performance.now(); store = new EventStore(path, key);
    assert.equal(store.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
    assert.deepEqual(retainedCiphertextRows(store.db), before);
    control = new ControlPlane(store, provider.provider, undefined, { stateDir: directory });
    control.candidateCleanup.migrate();
    const owners = control.snapshot().candidateOwners;
    assert.equal(owners.find((owner) => owner.id === "generated-original")?.originSessionId, sessionId);
    assert.equal(owners.find((owner) => owner.id === "generated-original")?.pullRequest?.number, 7);
    assert.equal(owners.find((owner) => owner.id === "generated-unknown")?.originSessionId, null);
    assert.equal(owners.find((owner) => owner.id === "generated-unknown")?.pullRequest, null);
    assert.equal(store.events().filter((event) => event.event_type === "candidate.owner_bound").length, 2);
    control.candidateCleanup.migrate();
    assert.equal(store.events().filter((event) => event.event_type === "candidate.owner_bound").length, 2);
    assert.equal(provider.requests.length, 0);
    console.log(JSON.stringify({ primitive: "candidate-retention-schema-56-to-57", ms: performance.now() - start, provenanceOnly: true }));
  } finally { await control?.close(); store?.close(); await provider.close(); await rm(directory, { recursive: true, force: true }); }
});

test("migration rekeys only an exactly recorded generation result and erases its old session-only copy, retaining required accounting", async () => {
  const directory = await mkdtemp(join(tmpdir(), "moguri-candidate-result-migration-")), path = join(directory, "state.sqlite"), key = randomBytes(32);
  let store: EventStore | undefined = new EventStore(path, key);
  const provider = await fixtureProvider(); let control: ControlPlane | undefined;
  try {
    seedSession(store);
    const generation = seedGeneration(store), old = store.events().find((event) => event.event_type === "model.completed")!;
    const before = retainedCiphertextRows(store.db);
    downgrade(store); store.close(); store = undefined;
    const raw = new DatabaseSync(path);
    raw.exec(`CREATE TRIGGER generated_result_marker BEFORE INSERT ON retention_metadata WHEN NEW.id='candidate_retention_schema'
      BEGIN SELECT RAISE(ABORT,'Generated rekey rollback'); END;`); raw.close();
    assert.throws(() => new EventStore(path, key), /rekey rollback/);
    const failed = new DatabaseSync(path);
    assert.equal(failed.prepare("PRAGMA user_version").get()?.user_version, 56);
    assert.deepEqual(retainedCiphertextRows(failed), before);
    failed.exec("DROP TRIGGER generated_result_marker"); failed.close();
    store = new EventStore(path, key);
    const moved = store.events().find((event) => event.id === old.id)!;
    assert.equal(moved.seq, old.seq); assert.equal(moved.timestamp, old.timestamp); assert.equal(moved.artifact_id, generation.id);
    assert.ok(moved.event_type === "model.completed"); assert.equal(moved.payload.candidateGenerationId, generation.id);
    assert.equal(Number(store.db.prepare("SELECT count(*) AS count FROM blob_payloads WHERE digest=?").get(generation.resultDigest)?.count), 1);
    control = new ControlPlane(store, provider.provider, undefined, { stateDir: directory });
    const events = control.platform.artifacts.deleteCandidates([generation.id]);
    store.commit(events, undefined, { artifacts: [generation.id] });
    const snapshot = projectEvents(store.events());
    assert.equal(snapshot.candidateGenerations.length, 0);
    assert.deepEqual(snapshot.budgetEntries, [generation.entry]);
    assert.equal(snapshot.sessions[0]?.usage[0]?.totalTokens, 42);
    assert.throws(() => store!.blob(generation.resultDigest), /Missing or deleted/);
    assert.throws(() => store!.blob(generation.inputDigest), /Missing or deleted/);
    assert.throws(() => store!.db.exec("DELETE FROM events"), /append-only/);
    assert.equal(provider.requests.length, 0);
  } finally { await control?.close(); store?.close(); await provider.close(); await rm(directory, { recursive: true, force: true }); }
});

test("upgrade cleans previously deleted canonical origins without probing roots, but never assigns an ownerless legacy proposal", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "moguri-candidate-orphan-migration-")), path = join(directory, "state.sqlite"), key = randomBytes(32);
  let store: EventStore | undefined = new EventStore(path, key);
  const provider = await fixtureProvider(); let control: ControlPlane | undefined;
  try {
    seedSession(store);
    const owned = seedCandidate(store, "generated-old-orphan"), unknown = seedCandidate(store, "generated-old-unassigned", null);
    store.commit([{ event_type: "session.deleted", profile_id: "default", project_id: projectId, payload: { deletedSessionId: sessionId, usage: [] } }], undefined, { sessions: [sessionId] });
    downgrade(store); store.close(); store = undefined; store = new EventStore(path, key);
    control = new ControlPlane(store, provider.provider, undefined, { stateDir: directory });
    const root = t.mock.method(control.platform.managed, "project", () => { throw new Error("Legacy cleanup cannot inspect or adopt a missing root."); });
    const model = t.mock.method(provider.provider, "prepare", async () => { throw new Error("Legacy cleanup cannot redispatch a model."); });
    await control.initialize();
    assert.deepEqual(control.snapshot().candidates.map((record) => record.id), [unknown.id]);
    assert.equal(control.snapshot().candidateOwners[0]?.originSessionId, null);
    assert.throws(() => store!.blob(owned.documentDigest), /Missing or deleted/);
    assert.ok(store.blob(unknown.documentDigest));
    assert.ok(control.snapshot().candidateCleanups.some((cleanup) => cleanup.status === "completed" && cleanup.targets.includes(owned.id)));
    assert.equal(root.mock.callCount(), 0); assert.equal(model.mock.callCount(), 0); assert.equal(provider.requests.length, 0);
  } finally { await control?.close(); t.mock.restoreAll(); store?.close(); await provider.close(); await rm(directory, { recursive: true, force: true }); }
});

test("cleanup projection rejects changed targets, fabricated failure/success and replay of a terminal deletion", () => {
  const pending = projectCandidateCleanup(undefined, { version: 1, id: "generated-cleanup", profileId: "default", revision: 0,
    reason: { kind: "session-delete", sessionId }, targets: ["generated-candidate"], status: "pending", createdAt: at, updatedAt: at, diagnostic: null, quarantinedRoots: [] });
  const completed = projectCandidateCleanup(pending, { ...pending, revision: 1, status: "completed" });
  for (const value of [
    { ...pending, revision: 1, targets: ["generated-unrelated"] },
    { ...pending, revision: 1, status: "failed" },
    { ...pending, revision: 1, status: "completed", diagnostic: "Generated failure cannot become success" },
    { ...pending, revision: 1, reason: { kind: "pr-merged", pullRequest: { url: "https://github.com/generated/other/pull/7", repo: "generated/project", number: 7 }, checkedAt: at } },
  ]) assert.throws(() => projectCandidateCleanup(pending, value), { code: "candidate_retention_corrupt" });
  assert.throws(() => projectCandidateCleanup(completed, { ...completed, revision: 2 }), { code: "candidate_retention_corrupt" });
});

test("pre-57 fixture encoding cannot be installed after candidate history already exists", () => {
  const store = new EventStore(":memory:");
  try {
    seedSession(store); seedCandidate(store, "generated-current-journal");
    const before = retainedCiphertextRows(store.db);
    assert.throws(() => legacyCandidateJournal(store), /before generating candidate history/);
    assert.deepEqual(retainedCiphertextRows(store.db), before);
  } finally { store.close(); }
});
