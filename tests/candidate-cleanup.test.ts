import test from "node:test";
import assert from "node:assert/strict";
import { readFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { candidateApiFixture } from "./fixtures/candidate-api.ts";
import { startService } from "../apps/service/src/server.ts";
import { DraftEditor, MoguriSdk } from "../packages/sdk/src/index.ts";
import { setupFixture, waitFor } from "./fixture.ts";
import { digest } from "../apps/service/src/store.ts";
import { candidateGenerationFixture } from "./fixtures/candidate-generation-api.ts";
import { compoundApiFixture } from "./fixtures/compound-api.ts";

const prUrl = (number = 7) => `https://github.com/generated/project/pull/${number}`;
const prResponse = (number = 7, merged = false) => ({ number, html_url: prUrl(number), state: "closed", draft: false, merged,
  merged_at: merged ? "2026-01-01T00:00:00Z" : null });

test("deleting the canonical origin removes applied candidates and their grants, not the applying session, ordinary artifacts or code", { timeout: 30_000 }, async () => {
  const f = await candidateApiFixture();
  try {
    const staged = await f.stage(), id = staged.candidate.id;
    const ordinary = await f.sdk.artifacts.create(f.sessionId, { kind: "research-note", name: "Generated independent note", text: "Generated independent content." });
    const applying = await f.sdk.sessions.create(f.session().projectId, "Generated applying session");
    const review = (await f.sdk.candidates.applyPreview(id, applying.id!)).preview;
    await f.sdk.candidates.apply(id, applying.id!, staged.candidate.revision, review.digest);
    const applied = await f.sdk.candidates.wait(id);
    await f.sdk.sessions.delete(f.sessionId, true);
    assert.equal(f.sdk.getState().snapshot!.candidates.some((candidate) => candidate.id === id), false);
    assert.equal(f.sdk.getState().snapshot!.artifacts.some((artifact) => artifact.id === id), false);
    assert.equal(f.sdk.getState().snapshot!.jobs.some((job) => job.candidate?.candidateId === id), false);
    assert.equal(f.sdk.getState().snapshot!.sessions.some((session) => session.id === applying.id), true);
    assert.equal((await f.sdk.artifacts.read(ordinary.id!)).text, "Generated independent content.");
    for (const hash of [applied.candidate.documentDigest, applied.candidate.stageResultDigest!, applied.candidate.applyResultDigest!]) {
      assert.throws(() => f.service.store.blob(hash), /Missing or deleted/);
    }
    assert.equal(f.service.store.db.prepare("SELECT scope FROM retention_keys WHERE scope=?").get(`profile/default/artifact/${id}`), undefined);
    assert.equal(await readFile(join(f.project, "fixture.txt"), "utf8"), f.patch.edits[0]!.text);
    assert.equal(await readFile(join(f.workspace.path, "fixture.txt"), "utf8"), f.patch.edits[0]!.text);
    assert.equal(f.requests.length, 0);
    assert.deepEqual(await f.sdk.sessions.delete(f.sessionId, true), { id: f.sessionId });
  } finally { await f.close(); }
});

test("candidate deletion removes only its own grants, preserving an ordinary artifact's independently retained identical bytes", { timeout: 30_000 }, async () => {
  const f = await candidateApiFixture();
  try {
    const staged = await f.stage(), text = JSON.stringify(staged.document);
    const shared = await f.sdk.artifacts.create(null, { kind: "research-note", name: "Generated independent shared bytes", text });
    assert.equal((await f.sdk.artifacts.read(shared.id!)).artifact.contentDigest, staged.candidate.documentDigest);
    await f.sdk.sessions.delete(f.sessionId, true);
    assert.equal(f.service.controller.snapshot().candidates.length, 0);
    assert.equal((await f.sdk.artifacts.read(shared.id!)).text, text);
    assert.equal(f.service.store.blob(staged.candidate.documentDigest), text);
    await assert.rejects(() => f.sdk.candidates.read(staged.candidate.id), { code: "candidate_missing" });
    const retained = (await f.sdk.artifacts.read(shared.id!)).artifact;
    await f.sdk.artifacts.delete(retained.id, retained.revision, true);
    assert.throws(() => f.service.store.blob(staged.candidate.documentDigest), /Missing or deleted/);
  } finally { await f.close(); }
});

test("source deletion stays profile-isolated even when two profiles own candidates for the same physical repository", { timeout: 30_000 }, async () => {
  const f = await candidateApiFixture(); let peer: MoguriSdk | undefined;
  try {
    const profile = await f.sdk.profiles.wait((await f.sdk.profiles.create("Generated cleanup profile")).id!);
    peer = await f.sdk.profiles.open(profile.id);
    const project = await peer.command({ type: "project.add", path: f.project }), source = await peer.sessions.create(project.id!);
    const workspace = await peer.workspaces.wait((await peer.workspaces.create(project.id!, "moguri/generated-isolated-cleanup")).id!);
    const preview = (await peer.candidates.preview(source.id!, workspace.id, f.patch)).preview;
    const other = await peer.candidates.wait((await peer.candidates.stage(source.id!, workspace.id, f.patch, preview.digest)).id!);
    const own = await f.stage();
    await f.sdk.sessions.delete(f.sessionId, true);
    assert.equal(f.service.controller.snapshot().candidates.length, 0);
    assert.equal((await peer.candidates.read(other.candidate.id)).candidate.profileId, profile.id);
    await assert.rejects(() => peer!.candidates.read(own.candidate.id), { code: "candidate_missing" });
    assert.equal(await readFile(join(f.project, "fixture.txt"), "utf8"), "generated original\n");
  } finally { peer?.disconnect(); await f.close(); }
});

test("deleting in-flight generation settles its exact worker and preserves unknown budget capacity after its proposal disappears", { timeout: 30_000 }, async () => {
  const f = await candidateGenerationFixture();
  try {
    const started = await f.generate({ ...f.input, task: "generated slow candidate cleanup" });
    await waitFor(() => f.requests.length === 1);
    const before = f.service.controller.snapshot().budgetEntries.find((entry) => entry.turnId === started.id)!;
    await f.sdk.sessions.delete(f.sessionId, true, f.session().revision);
    assert.equal(f.service.controller.snapshot().candidateGenerations.length, 0);
    const after = f.service.controller.snapshot().budgetEntries.find((entry) => entry.id === before.id)!;
    assert.equal(after.status, "unknown"); assert.equal(after.reportedTokens, null);
    assert.equal(after.reservedTokens, before.reservedTokens); assert.ok(after.reservedTokens! > 0);
    f.service.store.db.prepare("DELETE FROM receipts WHERE profile_id=? AND id=?").run("default", started.commandId);
    await assert.rejects(() => f.sdk.command(started.command, started.commandId), { code: "candidate_generation_deleted" });
    assert.equal(f.requests.length, 1);
    assert.equal(await readFile(join(f.project, "fixture.txt"), "utf8"), "generated original\n");
    assert.equal(await readFile(join(f.workspace.path, "fixture.txt"), "utf8"), "generated original\n");
  } finally { await f.close(); }
});

test("failed candidate stop persistence still aborts real work, leaves deletion explicitly failed and allows one durable retry", { timeout: 30_000 }, async (t) => {
  const f = await candidateApiFixture(), gate = Promise.withResolvers<void>(); let held = false;
  const original = f.service.controller.platform.managed.assert.bind(f.service.controller.platform.managed);
  const hook = t.mock.method(f.service.controller.platform.managed, "assert", async (...args: Parameters<typeof original>) => {
    if (!held && f.service.controller.snapshot().candidates.some((candidate) => candidate.status === "staging")) { held = true; await gate.promise; }
    return original(...args);
  });
  try {
    const preview = (await f.sdk.candidates.preview(f.sessionId, f.workspace.id, f.patch)).preview;
    const created = await f.sdk.candidates.stage(f.sessionId, f.workspace.id, f.patch, preview.digest);
    await waitFor(() => held);
    let fail = true;
    f.service.store.db.function("generated_cleanup_stop", () => { if (fail) { fail = false; throw new Error("Generated stop persistence failure"); } return 0; });
    f.service.store.db.exec(`CREATE TRIGGER generated_cleanup_stop BEFORE INSERT ON events WHEN json_extract(NEW.data,'$.event_type')='candidate.saved'
      BEGIN SELECT generated_cleanup_stop(); END;`);
    await assert.rejects(() => f.sdk.sessions.delete(f.sessionId, true), { code: "candidate_cleanup_pending" });
    assert.ok(f.service.controller.snapshot().candidateCleanups.some((cleanup) => cleanup.status === "failed" && cleanup.targets.includes(created.id!)));
    assert.ok(f.service.controller.snapshot().artifacts.some((artifact) => artifact.id === created.id));
    gate.resolve();
    const stopped = await f.sdk.candidates.wait(created.id!);
    assert.equal(stopped.candidate.status, "cancelled"); assert.equal(stopped.candidate.stopRequested, false);
    await f.sdk.sessions.delete(f.sessionId, true, f.session().revision);
    assert.equal(f.service.controller.snapshot().candidates.length, 0);
    assert.equal(await readFile(join(f.workspace.path, "fixture.txt"), "utf8"), "generated original\n");
    assert.equal(f.requests.length, 0);
  } finally { gate.resolve(); hook.mock.restore(); await f.close(); }
});

test("project removal cannot retain session-owned proposals through the ordinary-artifact retain choice", { timeout: 30_000 }, async () => {
  const f = await candidateGenerationFixture();
  try {
    const generated = await f.generate(), proposal = await f.settled(generated.id), projectId = f.session().projectId;
    const ordinary = await f.sdk.artifacts.create(f.sessionId, { kind: "research-note", name: "Generated independent project note", text: "Generated ordinary retained note." });
    await f.sdk.workspaces.remove(f.workspace.id, f.workspace.revision, true);
    await f.sdk.workspaces.wait(f.workspace.id);
    const preview = (await f.sdk.artifacts.projectPreview(projectId)).preview, configuration = (await f.sdk.projects.configuration(projectId)).configuration;
    await f.sdk.projects.remove(projectId, true, configuration.revision, { action: "retain", expectedDigest: preview.digest });
    assert.equal(f.service.controller.snapshot().candidateGenerations.length, 0);
    assert.equal((await f.sdk.artifacts.read(ordinary.id!)).text, "Generated ordinary retained note.");
    assert.equal((await f.sdk.artifacts.read(ordinary.id!)).artifact.projectId, null);
    for (const hash of [proposal.generation.inputDigest, proposal.generation.resultDigest!, proposal.generation.proposalDocumentDigest!]) assert.throws(() => f.service.store.blob(hash), /Missing or deleted/);
    assert.equal((await f.sdk.budgets.calls({ role: "draft" })).calls[0]?.reportedTokens, 42);
    assert.equal(f.requests.length, 1);
  } finally { await f.close(); }
});

test("project-free and plain-folder sessions cannot create manual, generated or compound candidates or inherit a previous root", { timeout: 30_000 }, async (t) => {
  const f = await setupFixture(), sdk = await new MoguriSdk(f.service.connection).ready();
  try {
    await f.configure(); await sdk.refresh();
    const free = await sdk.sessions.create(null, "Generated project-free source"), input = { task: "Generated repository change", files: [{ path: "fixture.txt", baseDigest: digest("generated original\n") }] };
    const patch = { kind: "patch" as const, summary: input.task, edits: [{ ...input.files[0]!, text: "Generated proposed change\n" }] };
    const before = f.service.controller.snapshot(), prepare = t.mock.method(f.provider, "prepare", async () => { throw new Error("No provider preparation is allowed."); });
    const root = t.mock.method(f.service.controller.platform.managed, "project", () => { throw new Error("A project-free candidate must not resolve a root."); });
    assert.equal((await sdk.candidates.eligibility(free.id!)).eligible, false);
    for (const action of [
      () => sdk.candidates.preview(free.id!, "generated-stage", patch),
      () => sdk.candidates.stage(free.id!, "generated-stage", patch, "0".repeat(64)),
      () => sdk.candidates.generatePreview(free.id!, "generated-stage", input),
      () => sdk.candidates.generate(free.id!, "generated-stage", input, "0".repeat(64), true),
      () => sdk.compound.start({ sessionId: free.id!, draftWorkspaceId: "generated-stage", alternateWorkspaceId: "generated-alternate",
        input, requestPlan: null, requestArchitecture: null, validationScriptId: "generated-script", validationTimeoutMs: 1000 }, "0".repeat(64), true),
    ]) await assert.rejects(action, /project|repository/i);
    assert.equal(root.mock.callCount(), 0); root.mock.restore();
    assert.equal((await sdk.candidates.eligibility(f.sessionId)).eligible, false);
    await assert.rejects(() => sdk.candidates.preview(f.sessionId, "generated-stage", patch), { code: "candidate_repository_required" });
    await assert.rejects(() => sdk.candidates.generate(f.sessionId, "generated-stage", input, "0".repeat(64), true), { code: "candidate_repository_required" });
    const after = f.service.controller.snapshot();
    assert.deepEqual(after.jobs, before.jobs); assert.deepEqual(after.artifacts, before.artifacts);
    assert.deepEqual(after.budgetEntries, before.budgetEntries); assert.deepEqual(after.budgetPlans, before.budgetPlans);
    assert.equal(prepare.mock.callCount(), 0); assert.equal(f.requests.length, 0);
    assert.equal(await readFile(join(f.project, "fixture.txt"), "utf8"), "generated original\n");
  } finally { t.mock.restoreAll(); sdk.disconnect(); await f.close(); }
});

test("an otherwise configured compound workflow rejects a non-Git source before preparing models, reserving budget or retaining a report", { timeout: 30_000 }, async (t) => {
  const f = await compoundApiFixture();
  const original = join(f.project, ".git"), displaced = join(f.project, "generated-detached-git");
  let moved = false;
  try {
    await f.configure();
    const before = f.service.controller.snapshot();
    const prepare = t.mock.method(f.service.controller.provider, "prepare", async () => { throw new Error("A repository-free compound must not prepare a model."); });
    await rename(original, displaced); moved = true;
    await assert.rejects(() => f.sdk.compound.preview(f.input), { code: "candidate_repository_required" });
    await assert.rejects(() => f.sdk.compound.start(f.input, "0".repeat(64), true), { code: "candidate_repository_required" });
    const after = f.service.controller.snapshot();
    assert.deepEqual(after.jobs, before.jobs); assert.deepEqual(after.artifacts, before.artifacts);
    assert.deepEqual(after.budgetPlans, before.budgetPlans); assert.deepEqual(after.budgetEntries, before.budgetEntries);
    assert.equal(prepare.mock.callCount(), 0); assert.equal(f.requests.length, 0);
    assert.ok(f.providers.every((provider) => provider.requests.length === 0));
    assert.equal(await readFile(join(f.project, "fixture.txt"), "utf8"), "generated original\n");
  } finally { if (moved) await rename(displaced, original); t.mock.restoreAll(); await f.close(); }
});

test("archiving preserves candidates until the existing expiry policy permanently deletes their origin", { timeout: 30_000 }, async () => {
  const f = await candidateApiFixture({ platform: { now: () => Date.now() + 40 * 86400_000 } });
  try {
    const staged = await f.stage();
    await f.sdk.command({ type: "session.archive", sessionId: f.sessionId });
    assert.equal((await f.sdk.candidates.read(staged.candidate.id)).candidate.status, "staged");
    assert.equal((await f.service.controller.platform.sessions.retention()).deleted, 0);
    const settings = f.sdk.settings.get()!;
    await f.sdk.settings.update({ ...settings.values, retention: { ...settings.values.retention, deleteArchived: true, afterDays: 30 } }, settings.revision);
    assert.equal((await f.service.controller.platform.sessions.retention()).deleted, 1);
    await f.sdk.refresh();
    assert.equal(f.sdk.getState().snapshot!.candidates.length, 0);
    assert.throws(() => f.service.store.blob(staged.candidate.documentDigest), /Missing or deleted/);
    assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});

test("only fresh exact merged PR verification removes archived candidates, never closed, wrong-identity or unavailable observations", { timeout: 30_000 }, async () => {
  let result: unknown = prResponse(), unavailable = false;
  const f = await candidateApiFixture({ platform: { integrations: { fetch: async () => {
    if (unavailable) throw new Error("Generated unavailable metadata account");
    return Response.json(result);
  } } } });
  try {
    await f.sdk.sessions.organize(f.sessionId, { prUrl: prUrl() });
    const staged = await f.stage(), id = staged.candidate.id;
    await f.sdk.command({ type: "session.archive", sessionId: f.sessionId });
    for (const response of [prResponse(), prResponse(8, true), { ...prResponse(7, true), merged_at: null }]) {
      result = response;
      await f.service.controller.candidateCleanup.refresh();
      assert.ok(f.service.controller.snapshot().candidates.some((candidate) => candidate.id === id));
    }
    unavailable = true;
    await f.service.controller.candidateCleanup.refresh();
    assert.ok(f.service.controller.snapshot().candidates.some((candidate) => candidate.id === id));
    unavailable = false; result = prResponse(7, true);
    await f.service.controller.candidateCleanup.refresh();
    await f.sdk.refresh();
    assert.equal(f.sdk.getState().snapshot!.candidates.length, 0);
    assert.equal(f.sdk.getState().snapshot!.sessions[0]?.status, "archived");
    assert.throws(() => f.service.store.blob(staged.candidate.documentDigest), /Missing or deleted/);
    assert.equal(await readFile(join(f.project, "fixture.txt"), "utf8"), "generated original\n");
    assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});

test("failed final deletion preserves candidate grants and durable intent, then restart finishes cleanup without replay", { timeout: 30_000 }, async () => {
  const f = await candidateApiFixture();
  let restarted: Awaited<ReturnType<typeof startService>> | undefined, sdk: MoguriSdk | undefined;
  try {
    const staged = await f.stage();
    f.service.store.db.exec(`CREATE TRIGGER generated_cleanup_failure BEFORE INSERT ON events
      WHEN json_extract(NEW.data,'$.event_type')='session.deleted'
      BEGIN SELECT RAISE(ABORT,'Generated final cleanup interruption'); END;`);
    await assert.rejects(() => f.sdk.sessions.delete(f.sessionId, true), /cleanup|interruption/i);
    assert.ok(f.service.controller.snapshot().candidates.some((candidate) => candidate.id === staged.candidate.id));
    assert.ok(f.service.store.events().some((event) => String(event.event_type) === "candidate.cleanup_recorded"));
    assert.ok(f.service.store.blob(staged.candidate.documentDigest));
    f.service.store.db.exec("DROP TRIGGER generated_cleanup_failure");
    f.sdk.disconnect(); await f.service.close();
    restarted = await startService({ stateDir: join(f.directory, "state"), provider: f.provider, retentionKey: f.retentionKey });
    sdk = await new MoguriSdk(restarted.connection).ready();
    assert.equal(sdk.getState().snapshot!.sessions.some((session) => session.id === f.sessionId), false);
    assert.equal(sdk.getState().snapshot!.candidates.length, 0);
    assert.throws(() => restarted!.store.blob(staged.candidate.documentDigest), /Missing or deleted/);
    assert.equal(await readFile(join(f.project, "fixture.txt"), "utf8"), "generated original\n");
    assert.equal(await readFile(join(f.workspace.path, "fixture.txt"), "utf8"), f.patch.edits[0]!.text);
    assert.equal(f.requests.length, 0);
  } finally { sdk?.disconnect(); await restarted?.close(); await f.close(); }
});

test("failed cleanup-intent persistence explicitly rejects deletion without claiming work stopped or removing grants", { timeout: 30_000 }, async () => {
  const f = await candidateApiFixture();
  try {
    const candidate = await f.stage();
    f.service.store.db.exec(`CREATE TRIGGER generated_cleanup_intent_failure BEFORE INSERT ON events
      WHEN json_extract(NEW.data,'$.event_type')='candidate.cleanup_recorded'
      BEGIN SELECT RAISE(ABORT,'Generated cleanup admission failure'); END;`);
    await assert.rejects(() => f.sdk.sessions.delete(f.sessionId, true), { code: "candidate_cleanup_intent" });
    assert.equal(f.service.controller.snapshot().candidateCleanups.length, 0);
    assert.equal((await f.sdk.candidates.read(candidate.candidate.id)).candidate.status, "staged");
    assert.ok(f.service.store.blob(candidate.candidate.documentDigest));
    assert.equal(f.session().status, "idle");
    f.service.store.db.exec("DROP TRIGGER generated_cleanup_intent_failure");
    await f.sdk.sessions.delete(f.sessionId, true);
    assert.equal(f.service.controller.snapshot().candidates.length, 0);
  } finally { await f.close(); }
});

test("a retention-grant rollback cannot mutate the live generation notice into a false deletion receipt", { timeout: 30_000 }, async () => {
  const f = await candidateGenerationFixture();
  try {
    const started = await f.generate(), proposal = await f.settled(started.id), stepId = proposal.generation.stepId!;
    const before = f.session().messages.find((message) => message.id === stepId)!.text;
    f.service.store.db.exec(`CREATE TRIGGER generated_cleanup_grant_failure BEFORE DELETE ON retention_keys
      WHEN OLD.scope='profile/default/artifact/${proposal.generation.id}'
      BEGIN SELECT RAISE(ABORT,'Generated cleanup grant rollback'); END;`);
    await assert.rejects(() => f.sdk.sessions.delete(f.sessionId, true, f.session().revision), { code: "candidate_cleanup_pending" });
    assert.equal(f.session().messages.find((message) => message.id === stepId)!.text, before);
    assert.equal((await f.sdk.candidates.generation(started.id)).generation.status, "proposed");
    assert.ok(f.service.store.blob(proposal.generation.resultDigest!));
    f.service.store.db.exec("DROP TRIGGER generated_cleanup_grant_failure");
    await f.sdk.sessions.delete(f.sessionId, true, f.session().revision);
    assert.equal(f.service.controller.snapshot().candidateGenerations.length, 0);
  } finally { await f.close(); }
});

test("failed deletion still permits the draft flush required by desktop retry, without admitting new candidate work", { timeout: 30_000 }, async () => {
  const f = await candidateApiFixture();
  const editor = new DraftEditor(f.sdk, f.sessionId, f.session().draft);
  try {
    await f.stage();
    f.service.store.db.exec(`CREATE TRIGGER generated_cleanup_retry_failure BEFORE INSERT ON events
      WHEN json_extract(NEW.data,'$.event_type')='session.deleted'
      BEGIN SELECT RAISE(ABORT,'Generated retry fixture interruption'); END;`);
    await assert.rejects(() => f.sdk.sessions.delete(f.sessionId, true), { code: "candidate_cleanup_pending" });
    f.service.store.db.exec("DROP TRIGGER generated_cleanup_retry_failure");
    editor.edit("Generated unsent edit preserved until deletion succeeds.");
    await editor.flush();
    assert.equal(f.session().draft.text, editor.getState().text);
    await assert.rejects(() => f.sdk.candidates.preview(f.sessionId, f.workspace.id, f.patch), { code: "candidate_cleanup_pending" });
    await f.sdk.sessions.delete(f.sessionId, true, f.session().revision);
    assert.equal(f.service.controller.snapshot().sessions.length, 0);
    assert.equal(f.service.controller.snapshot().candidates.length, 0);
    assert.equal(f.requests.length, 0);
  } finally { editor.dispose(); await f.close(); }
});
