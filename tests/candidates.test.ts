import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { MoguriSdk, type CandidatePatch, type Command } from "../packages/sdk/src/index.ts";
import { digest } from "../apps/service/src/store.ts";
import { setupFixture, waitFor } from "./fixture.ts";
import { initializeGeneratedRepository } from "./fixtures/git-project.ts";
import { candidateApiFixture as candidateFixture } from "./fixtures/candidate-api.ts";

test("the shared SDK stages an exact Local candidate without a model, then applies only separately reviewed bytes while preserving source Git state", { timeout: 30_000 }, async () => {
  const f = await setupFixture(), sdk = await new MoguriSdk(f.service.connection).ready();
  try {
    const git = initializeGeneratedRepository(f.project), projectId = f.session().projectId;
    const created = await sdk.workspaces.create(projectId, "moguri/generated-public-candidate"), workspace = await sdk.workspaces.wait(created.id!);
    await writeFile(join(f.project, "unrelated.txt"), "Generated user's unrelated untracked file.\n");
    const index = await readFile(join(f.project, ".git/index")), head = git(["rev-parse", "HEAD"]);
    const patch: CandidatePatch = { kind: "patch", summary: "Generated reviewed Local candidate.", edits: [
      { path: "fixture.txt", baseDigest: digest("generated original\n"), text: "Generated public candidate.\n" },
    ] };
    const preview = (await sdk.candidates.preview(f.sessionId, workspace.id, patch)).preview;
    assert.equal(preview.document.source.env, "Local"); assert.equal(preview.document.stage.workspaceId, workspace.id);
    const staged = await sdk.candidates.stage(f.sessionId, workspace.id, patch, preview.digest);
    const proposal = await sdk.candidates.wait(staged.id!);
    assert.equal(proposal.candidate.status, "staged");
    assert.equal(await readFile(join(workspace.path, "fixture.txt"), "utf8"), patch.edits[0]!.text);
    assert.equal(await readFile(join(f.project, "fixture.txt"), "utf8"), "generated original\n");
    assert.equal(proposal.candidate.acceptance, null); assert.equal(proposal.document.patch.edits[0]?.text, patch.edits[0]!.text);
    const review = (await sdk.candidates.applyPreview(staged.id!, f.sessionId)).preview;
    await assert.rejects(() => sdk.candidates.apply(staged.id!, f.sessionId, proposal.candidate.revision, "0".repeat(64)), /review|changed/i);
    await sdk.candidates.apply(staged.id!, f.sessionId, proposal.candidate.revision, review.digest);
    const applied = await sdk.candidates.wait(staged.id!);
    assert.equal(applied.candidate.status, "applied"); assert.equal(applied.candidate.acceptance?.actor, "user");
    assert.equal(await readFile(join(f.project, "fixture.txt"), "utf8"), patch.edits[0]!.text);
    assert.deepEqual(await readFile(join(f.project, ".git/index")), index);
    assert.equal(git(["rev-parse", "HEAD"]), head); assert.equal(git(["branch", "--show-current"]), "main");
    assert.equal(await readFile(join(f.project, "unrelated.txt"), "utf8"), "Generated user's unrelated untracked file.\n");
    assert.equal(f.requests.length, 0); assert.equal(sdk.getState().snapshot!.artifacts.find((artifact) => artifact.id === staged.id)?.kind, "report");
  } finally { sdk.disconnect(); await f.close(); }
});

test("candidate admission rejects stale bases, dirty staging roots and invalid paths before a job or artifact is created", { timeout: 30_000 }, async () => {
  const f = await candidateFixture();
  try {
    const preview = (await f.sdk.candidates.preview(f.sessionId, f.workspace.id, f.patch)).preview;
    await writeFile(join(f.project, "fixture.txt"), "Generated newer user base.\n");
    await assert.rejects(() => f.sdk.candidates.stage(f.sessionId, f.workspace.id, f.patch, preview.digest), { code: "candidate_conflict" });
    await writeFile(join(f.project, "fixture.txt"), "generated original\n");
    await writeFile(join(f.workspace.path, "fixture.txt"), "Generated user's staging edit.\n");
    await assert.rejects(() => f.sdk.candidates.preview(f.sessionId, f.workspace.id, f.patch), { code: "candidate_stage_busy" });
    await assert.rejects(() => f.sdk.candidates.preview(f.sessionId, f.workspace.id, { ...f.patch, edits: [{ ...f.patch.edits[0]!, path: ".git/config" }] }), { code: "candidate_patch" });
    assert.equal(f.sdk.getState().snapshot!.candidates.length, 0);
    assert.equal(await readFile(join(f.workspace.path, "fixture.txt"), "utf8"), "Generated user's staging edit.\n");
    assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});

test("read-only, Remote and excluded-Local candidate scopes fail before resolving a Local project", { timeout: 30_000 }, async (t) => {
  const f = await candidateFixture();
  try {
    const root = t.mock.method(f.service.controller.platform.managed, "project", () => { throw new Error("Generated forbidden Local candidate-root lookup."); });
    await f.sdk.sessions.mode(f.sessionId, "read-only");
    await assert.rejects(() => f.sdk.candidates.preview(f.sessionId, f.workspace.id, f.patch), { code: "read_only" });
    await f.sdk.sessions.mode(f.sessionId, "agent");
    const imported = f.session();
    f.service.store.commit([{ event_type: "session.configured", profile_id: "default", project_id: imported.projectId, session_id: imported.id,
      payload: { controls: { ...imported.controls, env: "Remote" } } }]);
    f.service.controller.refreshProfile(); await f.sdk.refresh();
    await assert.rejects(() => f.sdk.candidates.preview(f.sessionId, f.workspace.id, f.patch), { code: "candidate_env" });
    f.service.store.commit([{ event_type: "session.configured", profile_id: "default", project_id: imported.projectId, session_id: imported.id,
      payload: { controls: imported.controls } }]);
    f.service.controller.refreshProfile(); await f.sdk.refresh();
    await f.sdk.command({ type: "policy.set", allowedEnvs: ["Remote"] });
    await assert.rejects(() => f.sdk.candidates.preview(f.sessionId, f.workspace.id, f.patch), { code: "candidate_env" });
    assert.equal(root.mock.callCount(), 0); assert.equal(f.requests.length, 0);
  } finally { t.mock.restoreAll(); await f.close(); }
});

test("two SDK clients cannot stage the same source/target roots concurrently or duplicate the retained candidate", { timeout: 30_000 }, async () => {
  const f = await candidateFixture(), peer = await new MoguriSdk(f.service.connection).ready();
  try {
    const preview = (await f.sdk.candidates.preview(f.sessionId, f.workspace.id, f.patch)).preview;
    const results = await Promise.allSettled([
      f.sdk.candidates.stage(f.sessionId, f.workspace.id, f.patch, preview.digest),
      peer.candidates.stage(f.sessionId, f.workspace.id, f.patch, preview.digest),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.filter((result) => result.status === "rejected").length, 1);
    const admitted = results.find((result) => result.status === "fulfilled"); assert.ok(admitted?.status === "fulfilled");
    assert.equal((await f.sdk.candidates.wait(admitted.value.id!)).candidate.status, "staged");
    assert.equal(f.sdk.getState().snapshot!.candidates.length, 1);
    assert.equal(f.sdk.getState().snapshot!.jobs.filter((job) => job.candidate).length, 1);
    assert.equal(await readFile(join(f.project, "fixture.txt"), "utf8"), "generated original\n");
  } finally { peer.disconnect(); await f.close(); }
});

test("a stale apply review or changed staged bytes cannot overwrite newer user work", { timeout: 30_000 }, async () => {
  const f = await candidateFixture();
  try {
    const staged = await f.stage(), preview = (await f.sdk.candidates.applyPreview(staged.candidate.id, f.sessionId)).preview;
    await writeFile(join(f.project, "fixture.txt"), "Generated source change while review was open.\n");
    await assert.rejects(() => f.sdk.candidates.apply(staged.candidate.id, f.sessionId, staged.candidate.revision, preview.digest), { code: "candidate_conflict" });
    await writeFile(join(f.project, "fixture.txt"), "generated original\n");
    await writeFile(join(f.workspace.path, "fixture.txt"), "Generated newer stage edit.\n");
    await assert.rejects(() => f.sdk.candidates.applyPreview(staged.candidate.id, f.sessionId), { code: "candidate_changed" });
    assert.equal(await readFile(join(f.project, "fixture.txt"), "utf8"), "generated original\n");
    assert.equal((await f.sdk.candidates.read(staged.candidate.id)).candidate.acceptance, null);
  } finally { await f.close(); }
});

test("a real terminal SQLite append failure after file publication stays partial instead of recording a successful candidate", { timeout: 30_000 }, async () => {
  const f = await candidateFixture();
  try {
    const staged = await f.stage(), preview = (await f.sdk.candidates.applyPreview(staged.candidate.id, f.sessionId)).preview;
    let interrupt = true;
    f.service.store.db.function("generated_candidate_terminal", () => { if (interrupt) { interrupt = false; throw new Error("Generated candidate terminal append interruption."); } return 0; });
    f.service.store.db.exec(`CREATE TRIGGER generated_candidate_finish BEFORE INSERT ON events WHEN json_extract(NEW.data,'$.event_type')='job.finished'
      BEGIN SELECT generated_candidate_terminal(); END;`);
    await f.sdk.candidates.apply(staged.candidate.id, f.sessionId, staged.candidate.revision, preview.digest);
    const result = await f.sdk.candidates.wait(staged.candidate.id);
    assert.equal(result.candidate.status, "partial"); assert.equal(result.applyJob?.status, "partial");
    assert.deepEqual(result.candidate.appliedPaths, ["fixture.txt"]); assert.equal(result.candidate.applyResultDigest, null);
    assert.equal(await readFile(join(f.project, "fixture.txt"), "utf8"), f.patch.edits[0]!.text);
    assert.ok(f.sdk.getState().snapshot!.blockedProjects.includes(f.session().projectId));
    assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});

test("owned job/session stopping before candidate file effects settles cancelled without changing the source or staging root", { timeout: 30_000 }, async (t) => {
  for (const stop of ["job", "session"] as const) {
    const f = await candidateFixture(); let held = false, release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; }), original = f.service.controller.platform.managed.assert.bind(f.service.controller.platform.managed);
    const hook = t.mock.method(f.service.controller.platform.managed, "assert", async (...args: Parameters<typeof original>) => {
      if (!held && f.service.controller.snapshot().candidates.some((candidate) => candidate.status === "staging")) { held = true; await gate; }
      return original(...args);
    });
    try {
      const preview = (await f.sdk.candidates.preview(f.sessionId, f.workspace.id, f.patch)).preview;
      const created = await f.sdk.candidates.stage(f.sessionId, f.workspace.id, f.patch, preview.digest);
      await waitFor(() => held);
      const record = (await f.sdk.candidates.read(created.id!)).candidate;
      if (stop === "job") await f.sdk.jobs.cancel(record.stageIntent.jobId); else await f.sdk.command({ type: "session.stop", sessionId: f.sessionId });
      assert.equal((await f.sdk.candidates.read(record.id)).candidate.stopRequested, true);
      release();
      const result = await f.sdk.candidates.wait(record.id);
      assert.equal(result.candidate.status, "cancelled"); assert.equal(result.stageJob?.status, "cancelled");
      assert.equal(await readFile(join(f.project, "fixture.txt"), "utf8"), "generated original\n");
      assert.equal(await readFile(join(f.workspace.path, "fixture.txt"), "utf8"), "generated original\n");
      assert.equal(f.requests.length, 0);
    } finally { release(); hook.mock.restore(); await f.close(); }
  }
});

test("cancellation after one accepted source publication preserves the remaining file and never claims rollback or success", { timeout: 30_000 }, async (t) => {
  const f = await candidateFixture(); let held = false, release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  try {
    const patch = { ...f.patch, edits: [...f.patch.edits, { path: "second.txt", baseDigest: digest("Generated second base.\n"), text: "Generated second proposed file.\n" }] };
    const staged = await f.stage(patch), preview = (await f.sdk.candidates.applyPreview(staged.candidate.id, f.sessionId)).preview;
    const original = f.service.controller.platform.managed.assert.bind(f.service.controller.platform.managed);
    const hook = t.mock.method(f.service.controller.platform.managed, "assert", async (...args: Parameters<typeof original>) => {
      if (!held && f.service.controller.snapshot().candidates.some((candidate) => candidate.id === staged.candidate.id && candidate.status === "applying" && candidate.appliedPaths.length === 1)) { held = true; await gate; }
      return original(...args);
    });
    await f.sdk.candidates.apply(staged.candidate.id, f.sessionId, staged.candidate.revision, preview.digest);
    await waitFor(() => held);
    const applying = (await f.sdk.candidates.read(staged.candidate.id)).candidate;
    await f.sdk.jobs.cancel(applying.applyIntent!.jobId); release();
    const result = await f.sdk.candidates.wait(staged.candidate.id);
    assert.equal(result.candidate.status, "partial"); assert.equal(result.applyJob?.status, "partial");
    assert.equal(result.candidate.stopRequested, true); assert.deepEqual(result.candidate.appliedPaths, ["fixture.txt"]);
    assert.equal(await readFile(join(f.project, "fixture.txt"), "utf8"), f.patch.edits[0]!.text);
    assert.equal(await readFile(join(f.project, "second.txt"), "utf8"), "Generated second base.\n");
    assert.equal(await readFile(join(f.workspace.path, "second.txt"), "utf8"), "Generated second proposed file.\n");
    assert.equal(result.candidate.applyResultDigest, null); assert.equal(f.requests.length, 0);
    hook.mock.restore();
  } finally { release(); t.mock.restoreAll(); await f.close(); }
});

test("a reviewed instruction write cannot enter a source root already owned by a candidate job", { timeout: 30_000 }, async (t) => {
  const f = await candidateFixture(); let held = false, release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  try {
    const meta = await f.sdk.metachat.create(f.session().projectId), proposal = await f.sdk.configuration.propose(meta.id!, {
      target: "repo-instructions", section: "AGENTS.md", value: "Generated reviewed instruction text.", reason: "Generated exact repository instruction review.",
    });
    const review = await f.sdk.configuration.review(proposal.id!);
    const original = f.service.controller.platform.managed.assert.bind(f.service.controller.platform.managed);
    const hook = t.mock.method(f.service.controller.platform.managed, "assert", async (...args: Parameters<typeof original>) => {
      if (!held && f.service.controller.snapshot().candidates.some((candidate) => candidate.status === "staging")) { held = true; await gate; }
      return original(...args);
    });
    const preview = (await f.sdk.candidates.preview(f.sessionId, f.workspace.id, f.patch)).preview;
    const admitted = await f.sdk.candidates.stage(f.sessionId, f.workspace.id, f.patch, preview.digest); await waitFor(() => held);
    await assert.rejects(() => f.sdk.configuration.decide(proposal.id!, true, review.proposal.contentDigest, true), { code: "workspace_busy" });
    await assert.rejects(() => readFile(join(f.project, "AGENTS.md")), /ENOENT/);
    const candidate = (await f.sdk.candidates.read(admitted.id!)).candidate;
    await f.sdk.jobs.cancel(candidate.stageIntent.jobId); release();
    assert.equal((await f.sdk.candidates.wait(candidate.id)).candidate.status, "cancelled");
    hook.mock.restore();
  } finally { release(); t.mock.restoreAll(); await f.close(); }
});

test("candidate admission cannot enter a root while a reviewed instruction publication holds its write lease", { timeout: 30_000 }, async (t) => {
  const f = await candidateFixture(); let held = false, release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; }); let settled: Promise<{ ok: true } | { ok: false; error: unknown }> | undefined;
  try {
    const meta = await f.sdk.metachat.create(f.session().projectId), proposal = await f.sdk.configuration.propose(meta.id!, {
      target: "repo-instructions", section: "AGENTS.md", value: "Generated exclusively owned instructions.", reason: "Generated explicit instruction publication.",
    });
    const review = await f.sdk.configuration.review(proposal.id!), root = f.sdk.getState().snapshot!.projects.find((project) => project.id === f.session().projectId)!.path;
    const original = fs.promises.open;
    t.mock.method(fs.promises, "open", async (...args: Parameters<typeof original>) => {
      const file = await original(...args);
      if (!held && String(args[0]).startsWith(`${root}/.moguri-write-`)) { held = true; await gate; }
      return file;
    });
    syncBuiltinESMExports();
    settled = f.sdk.configuration.decide(proposal.id!, true, review.proposal.contentDigest, true).then(() => ({ ok: true as const }), (error: unknown) => ({ ok: false as const, error }));
    await waitFor(() => held);
    await assert.rejects(() => f.sdk.candidates.preview(f.sessionId, f.workspace.id, f.patch), { code: "workspace_busy" });
    assert.ok(f.service.controller.ownedWriteRoots().includes(root));
    release(); const result = await settled; if (!result.ok) throw result.error;
    assert.equal(await readFile(join(f.project, "AGENTS.md"), "utf8"), "Generated exclusively owned instructions.");
    assert.equal(f.requests.length, 0);
  } finally { release(); if (settled) await settled; t.mock.restoreAll(); syncBuiltinESMExports(); await f.close(); }
});

test("candidate writer ownership follows the physical source root across two isolated SDK profiles", { timeout: 30_000 }, async (t) => {
  const f = await candidateFixture(); let peer: MoguriSdk | undefined, held = false, release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  try {
    const creating = await f.sdk.profiles.create("Generated candidate Work"), profile = await f.sdk.profiles.wait(creating.id!);
    peer = await f.sdk.profiles.open(profile.id);
    const project = await peer.command({ type: "project.add", path: f.project }), session = await peer.sessions.create(project.id!);
    const created = await peer.workspaces.create(project.id!, "moguri/generated-foreign-profile-candidate"), stage = await peer.workspaces.wait(created.id!);
    const original = f.service.controller.platform.managed.assert.bind(f.service.controller.platform.managed);
    const hook = t.mock.method(f.service.controller.platform.managed, "assert", async (...args: Parameters<typeof original>) => {
      if (!held && f.service.controller.snapshot().candidates.some((candidate) => candidate.status === "staging")) { held = true; await gate; }
      return original(...args);
    });
    const preview = (await f.sdk.candidates.preview(f.sessionId, f.workspace.id, f.patch)).preview;
    const admitted = await f.sdk.candidates.stage(f.sessionId, f.workspace.id, f.patch, preview.digest); await waitFor(() => held);
    await assert.rejects(() => peer!.candidates.preview(session.id!, stage.id, f.patch), { code: "workspace_busy" });
    assert.equal(peer.getState().snapshot!.candidates.length, 0);
    const record = (await f.sdk.candidates.read(admitted.id!)).candidate;
    await f.sdk.jobs.cancel(record.stageIntent.jobId); release();
    assert.equal((await f.sdk.candidates.wait(record.id)).candidate.status, "cancelled");
    assert.equal(await readFile(join(f.project, "fixture.txt"), "utf8"), "generated original\n");
    hook.mock.restore();
  } finally { release(); t.mock.restoreAll(); peer?.disconnect(); await f.close(); }
});

test("lost stage/apply receipts return the original candidate before filesystem probes after origin archival or later user edits", { timeout: 30_000 }, async (t) => {
  for (const phase of ["stage", "apply"] as const) {
    const f = await candidateFixture();
    try {
      let command: Command, candidateId: string;
      if (phase === "stage") {
        const preview = (await f.sdk.candidates.preview(f.sessionId, f.workspace.id, f.patch)).preview;
        command = { type: "candidate.stage", sessionId: f.sessionId, stageWorkspaceId: f.workspace.id, patch: f.patch, expectedDigest: preview.digest, confirm: true };
      } else {
        const staged = await f.stage(), preview = (await f.sdk.candidates.applyPreview(staged.candidate.id, f.sessionId)).preview;
        command = { type: "candidate.apply", candidateId: staged.candidate.id, sessionId: f.sessionId, expectedRevision: staged.candidate.revision, expectedDigest: preview.digest, confirm: true };
      }
      const commandId = randomUUID(), admitted = await f.sdk.command(command, commandId); candidateId = admitted.id!;
      await f.sdk.candidates.wait(candidateId);
      const originalJobs = f.sdk.getState().snapshot!.jobs.filter((job) => job.candidate?.candidateId === candidateId).map((job) => job.id);
      f.service.store.db.prepare("DELETE FROM receipts WHERE profile_id=? AND id=?").run("default", commandId);
      if (phase === "stage") await f.sdk.command({ type: "session.archive", sessionId: f.sessionId });
      else await writeFile(join(f.project, "fixture.txt"), "Generated newer user edit after completed application.\n");
      const root = t.mock.method(f.service.controller.platform.managed, "project", () => { throw new Error("A candidate replay cannot re-probe a source/stage root."); });
      assert.deepEqual(await f.sdk.command(command, commandId), admitted);
      assert.equal(root.mock.callCount(), 0);
      assert.deepEqual(f.sdk.getState().snapshot!.jobs.filter((job) => job.candidate?.candidateId === candidateId).map((job) => job.id), originalJobs);
      if (phase === "apply") assert.equal(await readFile(join(f.project, "fixture.txt"), "utf8"), "Generated newer user edit after completed application.\n");
      root.mock.restore();
    } finally { t.mock.restoreAll(); await f.close(); }
  }
});

test("failed stop-intent persistence still revokes the owned candidate job without recording a false successful request", { timeout: 30_000 }, async (t) => {
  const f = await candidateFixture(); let held = false, release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  try {
    const original = f.service.controller.platform.managed.assert.bind(f.service.controller.platform.managed);
    const hook = t.mock.method(f.service.controller.platform.managed, "assert", async (...args: Parameters<typeof original>) => {
      if (!held && f.service.controller.snapshot().candidates.some((candidate) => candidate.status === "staging")) { held = true; await gate; }
      return original(...args);
    });
    const preview = (await f.sdk.candidates.preview(f.sessionId, f.workspace.id, f.patch)).preview;
    const created = await f.sdk.candidates.stage(f.sessionId, f.workspace.id, f.patch, preview.digest); await waitFor(() => held);
    const candidate = (await f.sdk.candidates.read(created.id!)).candidate; let fail = true;
    f.service.store.db.function("generated_candidate_stop_once", () => { if (fail) { fail = false; throw new Error("Generated stop-intent append failure."); } return 0; });
    f.service.store.db.exec(`CREATE TRIGGER generated_candidate_stop BEFORE INSERT ON events WHEN json_extract(NEW.data,'$.event_type')='candidate.saved'
      BEGIN SELECT generated_candidate_stop_once(); END;`);
    await assert.rejects(() => f.sdk.jobs.cancel(candidate.stageIntent.jobId));
    release();
    const result = await f.sdk.candidates.wait(candidate.id);
    assert.equal(result.candidate.status, "cancelled"); assert.equal(result.stageJob?.status, "cancelled");
    assert.equal(result.candidate.stopRequested, false); assert.equal(result.candidate.stageAttemptedPaths?.length, 0);
    assert.equal(await readFile(join(f.project, "fixture.txt"), "utf8"), "generated original\n");
    assert.equal(await readFile(join(f.workspace.path, "fixture.txt"), "utf8"), "generated original\n");
    hook.mock.restore();
  } finally { release(); t.mock.restoreAll(); await f.close(); }
});

test("a stale completed stage-job stop cannot cancel or relabel the candidate's later apply job", { timeout: 30_000 }, async (t) => {
  const f = await candidateFixture(); let held = false, release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  try {
    const staged = await f.stage(), preview = (await f.sdk.candidates.applyPreview(staged.candidate.id, f.sessionId)).preview;
    const original = f.service.controller.platform.managed.assert.bind(f.service.controller.platform.managed);
    const hook = t.mock.method(f.service.controller.platform.managed, "assert", async (...args: Parameters<typeof original>) => {
      if (!held && f.service.controller.snapshot().candidates.some((candidate) => candidate.id === staged.candidate.id && candidate.status === "applying")) { held = true; await gate; }
      return original(...args);
    });
    await f.sdk.candidates.apply(staged.candidate.id, f.sessionId, staged.candidate.revision, preview.digest); await waitFor(() => held);
    await f.sdk.jobs.cancel(staged.candidate.stageIntent.jobId);
    assert.equal((await f.sdk.candidates.read(staged.candidate.id)).candidate.stopRequested, false);
    release();
    const result = await f.sdk.candidates.wait(staged.candidate.id);
    assert.equal(result.candidate.status, "applied"); assert.equal(result.applyJob?.status, "completed");
    assert.equal(await readFile(join(f.project, "fixture.txt"), "utf8"), f.patch.edits[0]!.text);
    hook.mock.restore();
  } finally { release(); t.mock.restoreAll(); await f.close(); }
});

test("candidate acceptance after origin archival belongs to the explicit applying session without changing canonical origin ownership", { timeout: 30_000 }, async () => {
  const f = await candidateFixture();
  try {
    const staged = await f.stage();
    await f.sdk.command({ type: "session.archive", sessionId: f.sessionId });
    const retained = await f.sdk.candidates.read(staged.candidate.id);
    assert.equal(retained.candidate.originSessionId, f.sessionId); assert.equal(retained.stageJob?.status, "completed");
    const source = await f.sdk.sessions.create(retained.candidate.projectId, "Generated new explicit candidate owner");
    const review = (await f.sdk.candidates.applyPreview(retained.candidate.id, source.id!)).preview;
    await f.sdk.candidates.apply(retained.candidate.id, source.id!, retained.candidate.revision, review.digest);
    const applied = await f.sdk.candidates.wait(retained.candidate.id);
    assert.equal(applied.candidate.status, "applied"); assert.equal(applied.candidate.applyIntent?.sessionId, source.id);
    assert.equal(applied.candidate.stageIntent.sessionId, f.sessionId); assert.equal(applied.candidate.acceptance?.actor, "user");
    assert.equal((await f.sdk.artifacts.read(applied.candidate.id)).artifact.sources[0]?.actor, "unknown");
    assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});
