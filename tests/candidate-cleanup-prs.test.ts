import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { candidateApiFixture } from "./fixtures/candidate-api.ts";
import { candidateGenerationFixture } from "./fixtures/candidate-generation-api.ts";
import { waitFor } from "./fixture.ts";
import { sessionPrScope } from "../packages/sdk/src/index.ts";
import { ciTime } from "./fixtures/time-scale.ts";

const url = (number: number) => `https://github.com/generated/project/pull/${number}`;
const response = (number: number, merged = false) => ({ number, html_url: url(number), state: merged ? "closed" : "open",
  draft: false, merged, merged_at: merged ? "2026-01-01T00:00:00Z" : null });

test("automatic observation detects external merges for archived-session candidates without restoring the session", { timeout: ciTime(30_000) }, async () => {
  let merged = false, reads = 0;
  const f = await candidateApiFixture({ platform: { integrations: { prRefreshMs: 25, fetch: async () => {
    reads++; return Response.json(response(7, merged));
  } } } });
  try {
    await f.sdk.sessions.organize(f.sessionId, { prUrl: url(7) });
    const candidate = await f.stage();
    await f.sdk.command({ type: "session.archive", sessionId: f.sessionId });
    assert.ok(f.service.controller.snapshot().candidates.some((value) => value.id === candidate.candidate.id));
    merged = true;
    await waitFor(() => !f.service.controller.snapshot().candidates.some((value) => value.id === candidate.candidate.id));
    assert.equal(f.session().status, "archived"); assert.ok(reads > 1);
    assert.equal(await readFile(join(f.project, "fixture.txt"), "utf8"), "generated original\n");
    assert.ok(f.service.controller.snapshot().managedWorkspaces.some((workspace) => workspace.id === f.workspace.id && workspace.status === "ready"));
  } finally { await f.close(); }
});

test("fresh authoritative board merge observations schedule exact cleanup even while an older candidate read is in flight", { timeout: ciTime(30_000) }, async () => {
  let merged = false, holdNext = false, held = false, mergedReads = 0;
  const gate = Promise.withResolvers<Response>();
  const f = await candidateApiFixture({ platform: { integrations: { fetch: async () => {
    if (holdNext) { holdNext = false; held = true; return gate.promise; }
    if (merged) mergedReads++;
    return Response.json(response(7, merged));
  } } } });
  try {
    await f.sdk.sessions.organize(f.sessionId, { prUrl: url(7) });
    const candidate = await f.stage();
    await f.service.controller.candidateCleanup.refresh();
    holdNext = true;
    const oldRead = f.service.controller.candidateCleanup.refresh();
    await waitFor(() => held);
    merged = true;
    await f.sdk.issues.create(f.session().projectId, { title: "Generated authoritative PR observation", body: "", kind: "misc", phaseId: "backlog", pullRequestUrl: url(7) });
    const job = await f.sdk.issues.refresh(f.session().projectId);
    await f.sdk.jobs.wait(job.id!);
    gate.resolve(Response.json(response(7)));
    await oldRead;
    await waitFor(() => !f.service.controller.snapshot().candidates.some((record) => record.id === candidate.candidate.id), 3000);
    assert.ok(mergedReads >= 2, "cleanup must obtain its own fresh exact identity verification after the board observation");
    assert.equal(f.requests.length, 0);
  } finally { gate.resolve(Response.json(response(7))); await f.close(); }
});

test("public exact PR cleanup still works after an archived origin explicitly detached and removed its old source worktree", { timeout: ciTime(30_000) }, async () => {
  let merged = false, authenticated = 0;
  const f = await candidateApiFixture({ platform: { integrations: {
    fetch: async () => Response.json(response(7, merged)),
    githubCliRead: async () => { authenticated++; throw new Error("No replacement authenticated root is allowed."); },
  } } });
  try {
    await f.sdk.sessions.organize(f.sessionId, { prUrl: url(7) });
    await f.sdk.workspaces.bind(f.sessionId, f.workspace.id);
    const stage = await f.sdk.workspaces.wait((await f.sdk.workspaces.create(f.session().projectId, "moguri/generated-retained-stage")).id!);
    const preview = (await f.sdk.candidates.preview(f.sessionId, stage.id, f.patch)).preview;
    const candidate = await f.sdk.candidates.wait((await f.sdk.candidates.stage(f.sessionId, stage.id, f.patch, preview.digest)).id!);
    await f.sdk.workspaces.bind(f.sessionId, null);
    await f.sdk.workspaces.remove(f.workspace.id, f.workspace.revision, true);
    await f.sdk.workspaces.wait(f.workspace.id);
    await f.sdk.command({ type: "session.archive", sessionId: f.sessionId });
    merged = true;
    await f.service.controller.candidateCleanup.refresh();
    assert.equal(f.service.controller.snapshot().candidates.some((record) => record.id === candidate.candidate.id), false);
    assert.equal(authenticated, 0);
    assert.equal(f.session().status, "archived");
    assert.equal(await readFile(join(stage.path, "fixture.txt"), "utf8"), f.patch.edits[0]!.text);
  } finally { await f.close(); }
});

test("first recorded PR association is immutable across session relinking and cannot delete newer or unrelated candidates", { timeout: ciTime(30_000) }, async () => {
  const merged = new Set<number>();
  const f = await candidateApiFixture({ platform: { integrations: { fetch: async (input) => {
    const number = Number(String(input).match(/\/pulls\/(\d+)$/)?.[1]);
    return Response.json(response(number, merged.has(number)));
  } } } });
  try {
    const original = await f.stage();
    assert.equal(f.service.controller.snapshot().candidateOwners.find((owner) => owner.id === original.candidate.id)?.pullRequest, null);
    await f.sdk.sessions.organize(f.sessionId, { prUrl: url(7) });
    await f.sdk.sessions.organize(f.sessionId, { prUrl: url(8) });
    const nextStage = await f.sdk.workspaces.wait((await f.sdk.workspaces.create(f.session().projectId, "moguri/generated-new-pr")).id!);
    const preview = (await f.sdk.candidates.preview(f.sessionId, nextStage.id, f.patch)).preview;
    const newer = await f.sdk.candidates.wait((await f.sdk.candidates.stage(f.sessionId, nextStage.id, f.patch, preview.digest)).id!);
    const unrelatedSession = await f.sdk.sessions.create(f.session().projectId, "Generated unrelated origin");
    const unrelatedStage = await f.sdk.workspaces.wait((await f.sdk.workspaces.create(f.session().projectId, "moguri/generated-unrelated-pr")).id!);
    const unrelatedPreview = (await f.sdk.candidates.preview(unrelatedSession.id!, unrelatedStage.id, f.patch)).preview;
    const unrelated = await f.sdk.candidates.wait((await f.sdk.candidates.stage(unrelatedSession.id!, unrelatedStage.id, f.patch, unrelatedPreview.digest)).id!);
    const owners = f.service.controller.snapshot().candidateOwners;
    assert.equal(owners.find((owner) => owner.id === original.candidate.id)?.pullRequest?.url, url(7));
    assert.equal(owners.find((owner) => owner.id === newer.candidate.id)?.pullRequest?.url, url(8));
    merged.add(7);
    await f.service.controller.candidateCleanup.refresh();
    assert.equal(f.service.controller.snapshot().candidates.some((value) => value.id === original.candidate.id), false);
    assert.equal((await f.sdk.candidates.read(newer.candidate.id)).candidate.status, "staged");
    assert.equal((await f.sdk.candidates.read(unrelated.candidate.id)).candidate.status, "staged");
    await f.sdk.sessions.delete(f.sessionId, true);
    assert.equal((await f.sdk.candidates.read(unrelated.candidate.id)).candidate.originSessionId, unrelatedSession.id);
  } finally { await f.close(); }
});

test("a cached merged session observation cannot delete a candidate when the fresh exact PR read is open", { timeout: ciTime(30_000) }, async () => {
  let reads = 0;
  const f = await candidateApiFixture({ platform: { integrations: { fetch: async () => { reads++; return Response.json(response(7)); } } } });
  try {
    await f.sdk.sessions.organize(f.sessionId, { prUrl: url(7) });
    const snapshot = f.service.controller.snapshot(), scope = sessionPrScope(f.session(), snapshot)!;
    f.service.store.commit([{ event_type: "session.pr_observed", profile_id: "default", project_id: f.session().projectId, session_id: f.sessionId,
      payload: { observation: { version: 1, profileId: "default", sessionId: f.sessionId, scope,
        pullRequest: { url: url(7), repo: "generated/project", number: 7, state: "merged", draft: false,
          checkedAt: new Date(Date.now() - 86400_000).toISOString(), diagnostic: null } } } }]);
    f.service.controller.refreshProfile();
    const candidate = await f.stage();
    await f.service.controller.candidateCleanup.refresh();
    assert.ok(reads >= 2);
    assert.equal((await f.sdk.candidates.read(candidate.candidate.id)).candidate.status, "staged");
    assert.equal(f.service.controller.snapshot().candidateCleanups.length, 0);
  } finally { await f.close(); }
});

test("revoking automatic metadata access during a held merged response invalidates cleanup without another account or fallback", { timeout: ciTime(30_000) }, async () => {
  let armed = false, held = false, publicReads = 0, authenticatedReads = 0;
  const gate = Promise.withResolvers<Response>();
  const f = await candidateApiFixture({ platform: { integrations: {
    fetch: async () => { publicReads++; if (armed) { held = true; return gate.promise; } return Response.json(response(7)); },
    githubCliRead: async () => { authenticatedReads++; return response(7, true); },
  } } });
  try {
    await f.sdk.sessions.organize(f.sessionId, { prUrl: url(7) });
    const candidate = await f.stage();
    await f.service.controller.candidateCleanup.refresh();
    armed = true;
    const observing = f.service.controller.candidateCleanup.refresh();
    await waitFor(() => held);
    const { board } = await f.sdk.issues.board(f.session().projectId);
    await f.sdk.issues.configure(board.projectId, { ...board, autoRefreshPrs: false }, board.revision);
    gate.resolve(Response.json(response(7, true)));
    await observing;
    const before = publicReads;
    await f.service.controller.candidateCleanup.refresh();
    assert.equal(publicReads, before); assert.equal(authenticatedReads, 0);
    assert.equal((await f.sdk.candidates.read(candidate.candidate.id)).candidate.status, "staged");
    assert.equal(f.service.controller.snapshot().candidateCleanups.length, 0);
  } finally { gate.resolve(Response.json(response(7))); await f.close(); }
});

test("authenticated candidate metadata failures never fall back to public reads or a different root", { timeout: ciTime(30_000) }, async () => {
  let publicReads = 0, authenticatedReads = 0;
  const roots: string[] = [];
  const f = await candidateApiFixture({ platform: { integrations: {
    fetch: async () => { publicReads++; throw new Error("Generated forbidden public fallback"); },
    githubCliRead: async (_endpoint, root) => { authenticatedReads++; roots.push(root); throw new Error("Generated expired account"); },
  } } });
  try {
    const { configuration } = await f.sdk.projects.configuration(f.session().projectId);
    await f.sdk.projects.configure(configuration.projectId, { ...configuration.values, repo: { ...configuration.values.repo, githubAccess: "gh-cli" } }, configuration.revision);
    await f.sdk.sessions.organize(f.sessionId, { prUrl: url(7) });
    const candidate = await f.stage();
    await f.sdk.command({ type: "session.archive", sessionId: f.sessionId });
    await f.service.controller.candidateCleanup.refresh();
    assert.ok(authenticatedReads > 0); assert.equal(publicReads, 0);
    assert.ok(roots.every((root) => root === candidate.candidate.source.root));
    assert.equal((await f.sdk.candidates.read(candidate.candidate.id)).candidate.status, "staged");
    assert.equal(f.service.controller.snapshot().candidateCleanups.length, 0);
  } finally { await f.close(); }
});

test("verified merge deletes generation input and raw proposal blobs without discarding session usage or independent accounting", { timeout: ciTime(30_000) }, async () => {
  let merged = false;
  const f = await candidateGenerationFixture(undefined, { platform: { integrations: { fetch: async () => Response.json(response(7, merged)) } } });
  try {
    await f.sdk.refresh();
    await f.sdk.sessions.organize(f.sessionId, { prUrl: url(7) });
    const started = await f.generate(), result = await f.settled(started.id);
    merged = true;
    await f.service.controller.candidateCleanup.refresh();
    await f.sdk.refresh();
    assert.equal(f.service.controller.snapshot().candidateGenerations.length, 0);
    for (const hash of [result.generation.inputDigest, result.generation.resultDigest!, result.generation.proposalDocumentDigest!]) {
      assert.throws(() => f.service.store.blob(hash), /Missing or deleted/);
    }
    assert.equal(f.session().usage.find((usage) => usage.stepId === result.generation.stepId)?.totalTokens, 42);
    assert.match(f.session().messages.find((message) => message.id === result.generation.stepId)?.text ?? "", /proposal permanently deleted/i);
    assert.equal((await f.sdk.budgets.calls({ role: "draft" })).calls[0]?.reportedTokens, 42);
    assert.equal(f.requests.length, 1);
    assert.equal(await readFile(join(f.project, "fixture.txt"), "utf8"), "generated original\n");
  } finally { await f.close(); }
});

test("merging an older candidate's PR does not cancel newer generation after the session was relinked", { timeout: ciTime(30_000) }, async () => {
  let merged = false;
  const f = await candidateGenerationFixture(undefined, { platform: { integrations: { fetch: async (input) => {
    const number = Number(String(input).match(/\/pulls\/(\d+)$/)?.[1]);
    return Response.json(response(number, number === 7 && merged));
  } } } });
  try {
    await f.sdk.refresh(); await f.sdk.sessions.organize(f.sessionId, { prUrl: url(7) });
    const old = await f.stage();
    await f.sdk.sessions.organize(f.sessionId, { prUrl: url(8) });
    const stage = await f.sdk.workspaces.wait((await f.sdk.workspaces.create(f.session().projectId, "moguri/generated-newer-model-work")).id!);
    const input = { ...f.input, task: "generated slow newer proposal" };
    const preview = (await f.sdk.candidates.generatePreview(f.sessionId, stage.id, input)).preview;
    const started = await f.sdk.candidates.generate(f.sessionId, stage.id, input, preview.digest, true);
    await waitFor(() => f.requests.length === 1);
    merged = true; await f.service.controller.candidateCleanup.refresh();
    assert.equal(f.service.controller.snapshot().candidates.some((candidate) => candidate.id === old.candidate.id), false);
    const newer = (await f.sdk.candidates.generation(started.id!)).generation;
    assert.equal(newer.status, "running"); assert.equal(newer.stopRequested, false); assert.equal(f.session().turnId, started.id);
    await f.sdk.candidates.stopGeneration(started.id!); await f.settled(started.id!);
    assert.equal(f.requests.length, 1);
  } finally { await f.close(); }
});

test("deleting a generation preserves exact model-source grants independently copied into another origin's candidate", { timeout: ciTime(30_000) }, async () => {
  let merged = false;
  const f = await candidateGenerationFixture(undefined, { platform: { integrations: { fetch: async (input) => {
    const number = Number(String(input).match(/\/pulls\/(\d+)$/)?.[1]);
    return Response.json(response(number, number === 7 && merged));
  } } } });
  try {
    await f.sdk.refresh(); await f.sdk.sessions.organize(f.sessionId, { prUrl: url(7) });
    const generated = await f.generate(), proposal = await f.settled(generated.id);
    const other = await f.sdk.command({ type: "session.create", projectId: f.session().projectId,
      title: "Generated separate staging origin", workspaceMode: "checkout" });
    await f.sdk.sessions.organize(other.id!, { prUrl: url(8) });
    const preview = (await f.sdk.candidates.preview(other.id!, f.workspace.id, proposal.proposal!.patch)).preview;
    const staged = await f.sdk.candidates.wait((await f.sdk.candidates.stage(other.id!, f.workspace.id, proposal.proposal!.patch, preview.digest, proposal.generation.id)).id!);
    merged = true; await f.service.controller.candidateCleanup.refresh();
    assert.equal((await f.sdk.candidates.read(staged.candidate.id)).candidate.originSessionId, other.id);
    await assert.rejects(() => f.sdk.candidates.generation(generated.id), { code: "candidate_generation_missing" });
    const copied = JSON.parse((await f.sdk.artifacts.export(staged.candidate.id)).export.text);
    const hashes = [proposal.generation.inputDigest, proposal.generation.resultDigest!, proposal.generation.proposalDocumentDigest!];
    for (const hash of hashes) {
      assert.ok(copied.documents[0].candidate.results.some((result: { digest: string }) => result.digest === hash));
      assert.ok(f.service.store.blob(hash));
    }
    await f.sdk.sessions.delete(other.id!, true);
    for (const hash of hashes) assert.throws(() => f.service.store.blob(hash), /Missing or deleted/);
    assert.equal((await f.sdk.budgets.calls({ role: "draft" })).calls[0]?.reportedTokens, 42);
    assert.equal(f.requests.length, 1);
  } finally { await f.close(); }
});
