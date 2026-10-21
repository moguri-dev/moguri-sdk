import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { startService } from "../apps/service/src/server.ts";
import { ManagedWorkspaces } from "../apps/service/src/managed-workspaces.ts";
import { MoguriSdk, projectCandidateRecord } from "../packages/sdk/src/index.ts";
import { ownedSequenceFixture } from "./fixtures/owned-sequence-api.ts";
import { roleProposalPatch as patch } from "./fixtures/role-proposal-api.ts";

test("actual final role proposal reads canonical model/context/result evidence without another model, root write or acceptance", { skip: process.platform !== "darwin" }, async () => {
  const f = await ownedSequenceFixture({ replyText: JSON.stringify(patch) });
  try {
    const created = await f.start(), sequence = await f.settled(created.id), result = await f.sdk.candidates.roleProposal(sequence.id);
    assert.deepEqual(result.document.patch, patch);
    assert.equal(result.document.roleOrigin.sequenceId, sequence.id); assert.equal(result.document.roleOrigin.roleIndex, 2);
    assert.equal(result.document.roleOrigin.role, "revision"); assert.equal(result.document.roleOrigin.stepId, sequence.steps[2]!.stepId);
    assert.equal(result.document.roleOrigin.modelId, f.modelId);
    assert.equal(result.document.roleOrigin.sequenceInputDigest, sequence.inputDigest);
    assert.equal(result.document.roleOrigin.roleInputDigest, sequence.steps[2]!.inputDigest);
    assert.equal(result.document.roleOrigin.resultDigest, sequence.steps[2]!.resultDigest);
    assert.equal(result.sourceFiles[0]?.text, "generated original\n");
    assert.equal(f.requests.length, 3); assert.equal(f.control.snapshot().candidates.length, 0);
    assert.equal(await readFile(join(f.project, "fixture.txt"), "utf8"), "generated original\n");
    assert.equal(await readFile(join(f.workspace.path, "fixture.txt"), "utf8"), "generated original\n");
  } finally { await f.close(); }
});

test("exact role origin is review-bound, immutable through separate stage/apply and independent of source report deletion", { skip: process.platform !== "darwin" }, async () => {
  const f = await ownedSequenceFixture({ replyText: JSON.stringify(patch) });
  try {
    const created = await f.start(); await f.settled(created.id);
    const reference = { roleSequenceId: created.id }, proposal = await f.sdk.candidates.roleProposal(created.id);
    const plain = (await f.sdk.candidates.preview(f.sessionId, f.workspace.id, patch)).preview;
    const preview = (await f.sdk.candidates.preview(f.sessionId, f.workspace.id, patch, reference)).preview;
    assert.notEqual(preview.digest, plain.digest); assert.deepEqual(preview.document.roleOrigin, proposal.document.roleOrigin);
    await assert.rejects(() => f.sdk.candidates.stage(f.sessionId, f.workspace.id, patch, plain.digest, reference), { code: "candidate_review" });
    const staged = await f.sdk.candidates.wait((await f.sdk.candidates.stage(f.sessionId, f.workspace.id, patch, preview.digest, reference)).id!);
    assert.equal(staged.candidate.status, "staged"); assert.equal(staged.candidate.acceptance, null);
    assert.deepEqual(staged.candidate.roleOrigin, proposal.document.roleOrigin);
    assert.ok((await f.sdk.artifacts.read(staged.candidate.id)).artifact.sources.some((source) => source.actor === "model" && source.modelId === f.modelId && source.messageId === proposal.document.roleOrigin.stepId));
    const source = (await f.sdk.artifacts.read(created.id)).artifact;
    await f.sdk.artifacts.delete(created.id, source.revision, true);
    assert.deepEqual((await f.sdk.candidates.read(staged.candidate.id)).candidate.roleOrigin, proposal.document.roleOrigin);
    const copied = JSON.parse((await f.sdk.artifacts.export(staged.candidate.id)).export.text);
    assert.equal(copied.schemaVersion, 5);
    const hashes = copied.documents[0].candidate.results.map((result: { digest: string }) => result.digest);
    assert.ok(hashes.includes(proposal.document.roleOrigin.sequenceInputDigest));
    assert.ok(hashes.includes(proposal.document.roleOrigin.roleInputDigest));
    assert.ok(hashes.includes(proposal.document.roleOrigin.resultDigest));
    assert.equal(await readFile(join(f.project, "fixture.txt"), "utf8"), "generated original\n");
    const apply = (await f.sdk.candidates.applyPreview(staged.candidate.id, f.sessionId)).preview;
    await f.sdk.candidates.apply(staged.candidate.id, f.sessionId, staged.candidate.revision, apply.digest);
    const completed = await f.sdk.candidates.wait(staged.candidate.id);
    assert.equal(completed.candidate.status, "applied"); assert.equal(completed.candidate.acceptance?.actor, "user");
    assert.deepEqual(completed.candidate.roleOrigin, proposal.document.roleOrigin);
    assert.equal(await readFile(join(f.project, "fixture.txt"), "utf8"), patch.edits[0]!.text); assert.equal(f.requests.length, 3);
  } finally { await f.close(); }
});

test("edited role bytes cannot borrow canonical model origin, even if current root/base preview is valid", { skip: process.platform !== "darwin" }, async () => {
  const f = await ownedSequenceFixture({ replyText: JSON.stringify(patch) });
  try {
    const created = await f.start(); await f.settled(created.id);
    const edited = { ...patch, summary: "Generated edited summary loses verified attribution." }, reference = { roleSequenceId: created.id };
    await assert.rejects(() => f.sdk.candidates.preview(f.sessionId, f.workspace.id, edited, reference), { code: "role_proposal_source" });
    const unverified = (await f.sdk.candidates.preview(f.sessionId, f.workspace.id, edited)).preview;
    const staged = await f.sdk.candidates.wait((await f.sdk.candidates.stage(f.sessionId, f.workspace.id, edited, unverified.digest)).id!);
    assert.equal(staged.candidate.roleOrigin, undefined);
    assert.equal((await f.sdk.artifacts.read(staged.candidate.id)).artifact.sources.some((source) => source.actor === "model"), false);
    assert.equal(f.requests.length, 3);
  } finally { await f.close(); }
});

test("a final critic cannot be promoted into a code proposer and invalid patch text remains unaccepted charged data", { skip: process.platform !== "darwin" }, async () => {
  for (const invalid of ["critic", "json"] as const) {
    const f = await ownedSequenceFixture({ replyText: invalid === "json" ? "Generated non-JSON role data." : JSON.stringify(patch) });
    try {
      const created = await f.start(invalid === "critic" ? { ...f.input, roles: f.input.roles.slice(0, 2) } : f.input); await f.settled(created.id);
      await assert.rejects(() => f.sdk.candidates.roleProposal(created.id), { code: invalid === "critic" ? "role_proposal_role" : "role_proposal_json" });
      assert.equal(f.control.snapshot().candidates.length, 0);
      assert.equal(f.requests.length, invalid === "critic" ? 2 : 3);
      assert.equal((await f.sdk.budgets.status(f.sessionId)).status.totals.knownReportedTokens, invalid === "critic" ? 84 : 126);
    } finally { await f.close(); }
  }
});

test("an identical patch from another actual role sequence cannot swap the exact reviewed model origin", { skip: process.platform !== "darwin" }, async () => {
  const f = await ownedSequenceFixture({ replyText: JSON.stringify(patch) });
  try {
    const first = await f.start(); await f.settled(first.id);
    const old = (await f.sdk.candidates.preview(f.sessionId, f.workspace.id, patch, { roleSequenceId: first.id })).preview;
    const second = await f.start(); await f.settled(second.id);
    const current = (await f.sdk.candidates.preview(f.sessionId, f.workspace.id, patch, { roleSequenceId: second.id })).preview;
    assert.notEqual(old.digest, current.digest);
    await assert.rejects(() => f.sdk.candidates.stage(f.sessionId, f.workspace.id, patch, old.digest, { roleSequenceId: second.id }), { code: "candidate_review" });
    assert.equal(f.control.snapshot().candidates.length, 0); assert.equal(f.requests.length, 6);
    assert.equal(await readFile(join(f.project, "fixture.txt"), "utf8"), "generated original\n");
  } finally { await f.close(); }
});

test("candidate role origin cannot be removed, rebound or combined with generation provenance in later immutable observations", { skip: process.platform !== "darwin" }, async () => {
  const f = await ownedSequenceFixture({ replyText: JSON.stringify(patch) });
  try {
    const generated = await f.start(); await f.settled(generated.id);
    const reference = { roleSequenceId: generated.id }, preview = (await f.sdk.candidates.preview(f.sessionId, f.workspace.id, patch, reference)).preview;
    const staged = await f.sdk.candidates.wait((await f.sdk.candidates.stage(f.sessionId, f.workspace.id, patch, preview.digest, reference)).id!);
    const event = f.control.events(0).find((event) => event.event_type === "candidate.saved" && event.payload.candidate.id === staged.candidate.id);
    assert.ok(event?.event_type === "candidate.saved"); const initial = event.payload.candidate, origin = initial.roleOrigin!;
    for (const roleOrigin of [undefined, { ...origin, roleIndex: 0 }, { ...origin, stepId: "generated-other-step" }, { ...origin, resultDigest: "f".repeat(64) }]) {
      assert.throws(() => projectCandidateRecord(initial, { ...initial, revision: 1, roleOrigin }), { code: "candidate_corrupt" });
    }
    assert.throws(() => projectCandidateRecord(initial, { ...initial, revision: 1, generationId: "generated-conflicting-generation" }), { code: "candidate_corrupt" });
    assert.equal(f.requests.length, 3);
  } finally { await f.close(); }
});

test("the independently staged role origin and all three raw inputs/results survive source-role/session deletion and actual reopen", { skip: process.platform !== "darwin" }, async (t) => {
  const f = await ownedSequenceFixture({ replyText: JSON.stringify(patch) }); let reopened: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    const generated = await f.start(); await f.settled(generated.id);
    const reference = { roleSequenceId: generated.id }, preview = (await f.sdk.candidates.preview(f.sessionId, f.workspace.id, patch, reference)).preview;
    const staged = await f.sdk.candidates.wait((await f.sdk.candidates.stage(f.sessionId, f.workspace.id, patch, preview.digest, reference)).id!);
    const origin = staged.candidate.roleOrigin!;
    const original = (await f.sdk.artifacts.read(generated.id)).artifact;
    await f.sdk.artifacts.delete(original.id, original.revision, true);
    await f.sdk.sessions.delete(f.sessionId, true, f.session().revision); await f.service.close();
    const root = t.mock.method(ManagedWorkspaces.prototype, "project", () => { throw new Error("A retained role-origin copy cannot probe its deleted source session."); });
    const models = t.mock.method(f.provider, "prepare", async () => { throw new Error("A retained role-origin copy cannot call a model."); });
    reopened = await startService({ stateDir: join(f.directory, "state"), provider: f.provider, retentionKey: f.retentionKey });
    const sdk = await new MoguriSdk(reopened.connection).ready();
    try {
      assert.deepEqual((await sdk.candidates.read(staged.candidate.id)).candidate.roleOrigin, origin);
      const copied = JSON.parse((await sdk.artifacts.export(staged.candidate.id)).export.text);
      assert.equal(copied.schemaVersion, 5);
      for (const hash of [origin.sequenceInputDigest, origin.roleInputDigest, origin.resultDigest]) {
        assert.ok(copied.documents[0].candidate.results.some((result: { digest: string; text: string }) => result.digest === hash && result.text.length > 0));
        assert.ok(reopened.store.blob(hash).length > 0);
      }
      assert.equal((await sdk.budgets.dashboard()).totals.knownReportedTokens, 126);
      assert.equal(root.mock.callCount(), 0); assert.equal(models.mock.callCount(), 0); assert.equal(f.requests.length, 3);
    } finally { sdk.disconnect(); }
  } finally { await reopened?.close(); t.mock.restoreAll(); await f.close(); }
});
