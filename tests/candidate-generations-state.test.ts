import test from "node:test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { performance } from "node:perf_hooks";
import { projectCandidateGeneration, type CandidateGenerationRecord } from "../packages/protocol/src/candidate-generations.ts";
import { projectEvents, PROTOCOL_VERSION } from "../packages/protocol/src/index.ts";
import { EventStore } from "../apps/service/src/store.ts";
import { candidateApiFixture } from "./fixtures/candidate-api.ts";
import { budgetPlanFixture } from "./fixtures/budget-plan-api.ts";
import { retainedCiphertextRows, writeLegacyState } from "./fixtures/legacy-state.ts";

function record(): CandidateGenerationRecord {
  const root = { env: "Local" as const, projectId: "generated-project", workspaceId: null, root: "/generated/source", device: "1", inode: "2",
    gitCommonDir: "/generated/source/.git", branch: "generated-source", head: "a".repeat(40) };
  return { version: 1, id: "generated-generation", profileId: "default", projectId: root.projectId, sessionId: "generated-session",
    commandId: "generated-command", commandDigest: "b".repeat(64), inputDigest: "c".repeat(64), modelId: "generated-model", modelBindingDigest: "d".repeat(64),
    source: root, stage: { ...root, workspaceId: "generated-stage", root: "/generated/stage", inode: "3", branch: "generated-stage" }, authorityDigest: "e".repeat(64),
    revision: 0, status: "running", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", stopRequested: false,
    stepId: null, providerId: null, apiModelId: null, resultDigest: null, proposalDocumentDigest: null, diagnostic: null };
}

test("a generated proposal starts only with its exact no-dispatch intent and distinct captured source/stage", () => {
  const initial = record(); assert.deepEqual(projectCandidateGeneration(undefined, initial), initial);
  for (const changed of [
    { ...initial, stepId: "generated-step" }, { ...initial, status: "proposed" },
    { ...initial, stage: initial.source }, { ...initial, createdAt: "2026-02-30T00:00:00.000Z" },
  ]) assert.throws(() => projectCandidateGeneration(undefined, changed), { code: "candidate_generation_corrupt" });
});

test("generated model provenance and original ownership become immutable and a requested stop cannot become proposed success", () => {
  const initial = projectCandidateGeneration(undefined, record());
  const started = projectCandidateGeneration(initial, { ...initial, revision: 1, stepId: "generated-step", providerId: "generated-provider", apiModelId: "generated-canonical" });
  const result = projectCandidateGeneration(started, { ...started, revision: 2, resultDigest: "f".repeat(64), proposalDocumentDigest: "1".repeat(64) });
  const proposed = projectCandidateGeneration(result, { ...result, revision: 3, status: "proposed" });
  for (const changed of [
    { ...started, revision: 2, stepId: "generated-other-step" }, { ...started, revision: 2, inputDigest: "2".repeat(64) },
    { ...started, revision: 2, modelId: "generated-other-model" }, { ...started, revision: 2, commandId: "generated-other-command" },
    { ...started, revision: 2, source: { ...started.source, inode: "999" } },
    { ...proposed, revision: 4 },
  ]) assert.throws(() => projectCandidateGeneration(started, changed), { code: "candidate_generation_corrupt" });
  const stopped = projectCandidateGeneration(result, { ...result, revision: 3, stopRequested: true });
  assert.throws(() => projectCandidateGeneration(stopped, { ...stopped, revision: 4, status: "proposed" }), { code: "candidate_generation_corrupt" });
  assert.equal(projectCandidateGeneration(stopped, { ...stopped, revision: 4, status: "stopped", diagnostic: "Generated real stop." }).status, "stopped");
  assert.throws(() => projectCandidateGeneration(proposed, { ...proposed, revision: 4 }), { code: "candidate_generation_corrupt" });
});

test("generation source capture snapshots exact reviewed files without writes, provider access or mutable caller retargeting", async () => {
  const f = await candidateApiFixture();
  try {
    const input = { task: "Generated explicit source selection.", files: [{ path: "fixture.txt", baseDigest: f.patch.edits[0]!.baseDigest }] };
    const capture = f.service.controller.platform.candidates.generationSource(f.sessionId, f.workspace.id, input, AbortSignal.timeout(5000));
    input.files[0]!.path = "second.txt";
    const source = await capture;
    assert.equal(source.files.length, 1); assert.equal(source.files[0]?.path, "fixture.txt"); assert.equal(source.files[0]?.text, "generated original\n");
    assert.notEqual(source.source.root, source.stage.root); assert.equal(f.requests.length, 0);
    await writeFile(join(f.project, "fixture.txt"), "Generated newer source.\n");
    await assert.rejects(() => f.service.controller.platform.candidates.generationSource(f.sessionId, f.workspace.id,
      { task: input.task, files: [{ path: "fixture.txt", baseDigest: f.patch.edits[0]!.baseDigest }] }, AbortSignal.timeout(5000)), { code: "candidate_generation_base" });
    assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});

test("schema-30-to-31 generation marker rolls back without changing retained ciphertext, keys, receipts or existing planned capacity", async () => {
  const f = await budgetPlanFixture(); let opened: EventStore | undefined;
  try {
    const plan = f.create(), path = f.service.store.path, before = retainedCiphertextRows(f.service.store.db);
    await writeLegacyState(f.service, 30);
    const raw = new DatabaseSync(path);
    try {
      assert.equal(raw.prepare("SELECT value FROM retention_metadata WHERE id='budget_planning_schema'").get()?.value, "1");
      raw.exec(`CREATE TRIGGER generated_generation_marker BEFORE INSERT ON retention_metadata WHEN NEW.id='candidate_generation_schema'
        BEGIN SELECT RAISE(ABORT,'Generated generation marker failure'); END;`);
    } finally { raw.close(); }
    assert.throws(() => new EventStore(path, f.retentionKey), /generation marker failure/);
    const failed = new DatabaseSync(path);
    try {
      assert.equal(failed.prepare("PRAGMA user_version").get()?.user_version, 30);
      assert.equal(failed.prepare("SELECT value FROM retention_metadata WHERE id='candidate_generation_schema'").get(), undefined);
      assert.deepEqual(retainedCiphertextRows(failed), before); failed.exec("DROP TRIGGER generated_generation_marker");
    } finally { failed.close(); }
    const started = performance.now(); opened = new EventStore(path, f.retentionKey);
    assert.equal(opened.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
    assert.deepEqual(retainedCiphertextRows(opened.db), before);
    const projection = projectEvents(opened.events());
    assert.deepEqual(projection.candidateGenerations, []); assert.deepEqual(projection.budgetPlans, [plan]); assert.deepEqual(projection.budgetEntries, []);
    console.log(JSON.stringify({ primitive: "generation-schema-30-to-31", ms: performance.now() - started, ciphertextUnchanged: true, fabricatedModelCalls: false }));
  } finally { opened?.close(); await f.close(); }
});

test("legacy fixture generation rejects future draft-only budget roles instead of relabeling them as schema 30", async () => {
  const f = await budgetPlanFixture();
  try {
    const draft = f.budget.plan(f.session(), { ...f.request, id: record().id, role: "draft" }); f.append([draft.event]);
    await assert.rejects(() => writeLegacyState(f.service, 30), /pre-generation history/);
  }
  finally { await f.close(); }
});
