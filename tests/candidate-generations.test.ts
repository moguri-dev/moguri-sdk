import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { candidateApiFixture } from "./fixtures/candidate-api.ts";
import { waitFor } from "./fixture.ts";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { startService } from "../apps/service/src/server.ts";
import { candidateGenerationFixture as fixture, generatedCandidatePatch as patch } from "./fixtures/candidate-generation-api.ts";

test("owned generation uses the selected real worker/ledger and retains a model proposal without touching either checkout or promoting output to solver context", { skip: process.platform !== "darwin" }, async () => {
  const f = await fixture();
  try {
    const original = await readFile(join(f.project, "fixture.txt"), "utf8"), index = await readFile(join(f.project, ".git/index"));
    const started = await f.generate(), result = await f.settled(started.id);
    assert.equal(result.generation.status, "proposed"); assert.deepEqual(result.proposal?.patch, patch);
    assert.equal(f.requests.length, 1); assert.equal(f.requests[0]?.tools, undefined);
    assert.equal(f.requests[0]?.max_tokens ?? f.requests[0]?.max_completion_tokens, 256);
    assert.equal(await readFile(join(f.project, "fixture.txt"), "utf8"), original);
    assert.equal(await readFile(join(f.workspace.path, "fixture.txt"), "utf8"), original);
    assert.deepEqual(await readFile(join(f.project, ".git/index")), index);
    const calls = (await f.sdk.budgets.calls({ sessionId: f.sessionId })).calls;
    assert.equal(calls.length, 1); assert.equal(calls[0]?.role, "draft"); assert.equal(calls[0]?.reportedTokens, 42);
    const artifact = (await f.sdk.artifacts.read(started.id)).artifact;
    assert.ok(artifact.sources.some((source) => source.actor === "model" && source.modelId === f.modelId));
    assert.equal(JSON.parse((await f.sdk.artifacts.export(started.id)).export.text).schemaVersion, 10);
    await assert.rejects(() => f.sdk.artifacts.update(started.id, { text: "Generated unauthorized replacement." }, artifact.revision), { code: "candidate_generation_document" });
    await f.send("Generated ordinary follow-up after proposal generation."); await f.terminal();
    assert.equal(f.requests.length, 2); assert.equal(JSON.stringify(f.requests[1]?.messages).includes("GENERATED_MODEL_PROPOSAL_NOT_CONTEXT"), false);
  } finally { await f.close(); }
});

test("separate generated staging/application preserves canonical model authorship without converting generation into user acceptance", { skip: process.platform !== "darwin" }, async () => {
  const f = await fixture();
  try {
    const generated = await f.generate(), result = await f.settled(generated.id); assert.equal(result.generation.status, "proposed"); assert.ok(result.proposal);
    const preview = (await f.sdk.candidates.preview(f.sessionId, f.workspace.id, result.proposal.patch)).preview;
    const changed = { ...result.proposal.patch, summary: "Generated changed attribution." }, changedPreview = (await f.sdk.candidates.preview(f.sessionId, f.workspace.id, changed)).preview;
    await assert.rejects(() => f.sdk.candidates.stage(f.sessionId, f.workspace.id, changed, changedPreview.digest, generated.id), { code: "candidate_generation_source" });
    const created = await f.sdk.candidates.stage(f.sessionId, f.workspace.id, result.proposal.patch, preview.digest, generated.id), staged = await f.sdk.candidates.wait(created.id!);
    assert.equal(staged.candidate.generationId, generated.id); assert.equal(staged.candidate.acceptance, null);
    const artifact = (await f.sdk.artifacts.read(created.id!)).artifact;
    assert.ok(artifact.sources.some((source) => source.actor === "model" && source.modelId === f.modelId && source.messageId === result.generation.stepId));
    assert.equal(await readFile(join(f.project, "fixture.txt"), "utf8"), "generated original\n");
    const apply = (await f.sdk.candidates.applyPreview(created.id!, f.sessionId)).preview;
    await f.sdk.candidates.apply(created.id!, f.sessionId, staged.candidate.revision, apply.digest);
    assert.equal((await f.sdk.candidates.wait(created.id!)).candidate.acceptance?.actor, "user");
    assert.equal(await readFile(join(f.project, "fixture.txt"), "utf8"), patch.edits[0]!.text); assert.equal(f.requests.length, 1);
  } finally { await f.close(); }
});

test("concurrent clients cannot replace the same session's original owned generation after asynchronous review", { skip: process.platform !== "darwin" }, async () => {
  const f = await fixture(), peer = await new MoguriSdk(f.service.connection).ready();
  try {
    const preview = (await f.sdk.candidates.generatePreview(f.sessionId, f.workspace.id, f.input)).preview;
    const results = await Promise.allSettled([f.sdk, peer].map((client) => client.candidates.generate(f.sessionId, f.workspace.id, f.input, preview.digest, true)));
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.filter((result) => result.status === "rejected").length, 1);
    const admitted = results.find((result) => result.status === "fulfilled"); assert.ok(admitted?.status === "fulfilled");
    assert.equal((await f.settled(admitted.value.id!)).generation.status, "proposed");
    assert.equal(f.service.controller.snapshot().candidateGenerations.length, 1); assert.equal(f.requests.length, 1);
  } finally { peer.disconnect(); await f.close(); }
});

test("generation refuses a missing fixed model before looking up a Local root", async (t) => {
  const f = await candidateApiFixture();
  try {
    const root = t.mock.method(f.service.controller.platform.managed, "project", () => { throw new Error("No unconfigured-model root probe."); });
    await assert.rejects(() => f.sdk.query({ type: "candidate.generation.preview", sessionId: f.sessionId, stageWorkspaceId: f.workspace.id,
      input: { task: "Generated no-model request.", files: [{ path: "fixture.txt", baseDigest: patch.edits[0]!.baseDigest }] } }), { code: "candidate_generation_model" });
    assert.equal(root.mock.callCount(), 0); assert.equal(f.requests.length, 0);
  } finally { t.mock.restoreAll(); await f.close(); }
});

test("invalid generated JSON or an unreviewed model path retains actual charges and raw output without staging or quarantining unchanged roots", { skip: process.platform !== "darwin" }, async () => {
  for (const reply of ["Generated not JSON.", JSON.stringify({ ...patch, edits: [{ ...patch.edits[0], path: "second.txt" }] })]) {
    const f = await fixture(reply);
    try {
      const started = await f.generate(), result = await f.settled(started.id);
      assert.equal(result.generation.status, "partial"); assert.equal(result.proposal, null); assert.equal(result.text, reply);
      assert.equal((await f.sdk.budgets.status(f.sessionId)).status.totals.reportedTokens, 42); assert.equal(f.requests.length, 1);
      assert.equal(await readFile(join(f.project, "fixture.txt"), "utf8"), "generated original\n");
      assert.equal(await readFile(join(f.workspace.path, "fixture.txt"), "utf8"), "generated original\n");
      assert.equal(f.service.controller.snapshot().blockedProjects.includes(f.session().projectId), false);
    } finally { await f.close(); }
  }
});

test("stopping an owned generation keeps unknown model usage held and cannot publish a proposal or affect source/staging", { skip: process.platform !== "darwin" }, async () => {
  const f = await fixture();
  try {
    const started = await f.generate({ ...f.input, task: "generated slow code proposal" }); await waitFor(() => f.requests.length === 1);
    await f.sdk.command({ type: "candidate.generation.stop", generationId: started.id });
    const result = await f.settled(started.id);
    assert.ok(["stopped", "partial"].includes(result.generation.status)); assert.equal(result.generation.stopRequested, true); assert.equal(result.proposal, null);
    const status = (await f.sdk.budgets.status(f.sessionId)).status;
    assert.equal(status.totals.reportedTokens, null); assert.ok(status.totals.heldTokens! > 0);
    assert.equal(await readFile(join(f.project, "fixture.txt"), "utf8"), "generated original\n");
    assert.equal(await readFile(join(f.workspace.path, "fixture.txt"), "utf8"), "generated original\n"); assert.equal(f.requests.length, 1);
  } finally { await f.close(); }
});

test("generation cancellation still reaches owned inference when either stop-intent journal append fails", { skip: process.platform !== "darwin" }, async () => {
  for (const failure of ["generation-intent", "turn-request"] as const) {
    const f = await fixture();
    try {
      const started = await f.generate({ ...f.input, task: "generated slow stop-journal failure" }); await waitFor(() => f.requests.length === 1);
      let fail = true;
      f.service.store.db.function("generated_generation_stop_once", () => { if (fail) { fail = false; throw new Error("Generated stop journal failure."); } return 0; });
      const type = failure === "generation-intent" ? "candidate.generation_recorded" : "turn.stop_requested";
      f.service.store.db.exec(`CREATE TRIGGER generated_generation_stop BEFORE INSERT ON events WHEN json_extract(NEW.data,'$.event_type')='${type}'
        BEGIN SELECT generated_generation_stop_once(); END;`);
      await assert.rejects(() => f.sdk.candidates.stopGeneration(started.id));
      const result = await f.settled(started.id);
      assert.ok(["stopped", "partial"].includes(result.generation.status)); assert.equal(result.generation.stopRequested, failure === "turn-request");
      assert.equal(result.proposal, null); assert.equal(f.requests.length, 1);
      const status = (await f.sdk.budgets.status(f.sessionId)).status;
      assert.equal(status.totals.reportedTokens, null); assert.ok(status.totals.heldTokens! > 0);
      assert.equal(await readFile(join(f.project, "fixture.txt"), "utf8"), "generated original\n");
      assert.equal(await readFile(join(f.workspace.path, "fixture.txt"), "utf8"), "generated original\n");
    } finally { await f.close(); }
  }
});

test("original generation commands cannot re-probe/re-dispatch after lost receipts, source changes or explicit artifact deletion", { skip: process.platform !== "darwin" }, async (t) => {
  const f = await fixture();
  try {
    const started = await f.generate(), result = await f.settled(started.id); assert.equal(result.generation.status, "proposed");
    f.service.store.db.prepare("DELETE FROM receipts WHERE profile_id=? AND id=?").run("default", started.commandId);
    await writeFile(join(f.project, "fixture.txt"), "Generated later user edit.\n");
    const root = t.mock.method(f.service.controller.platform.managed, "project", () => { throw new Error("Canonical replay must not probe a root."); });
    assert.equal((await f.sdk.command(started.command, started.commandId)).id, started.id); assert.equal(root.mock.callCount(), 0); root.mock.restore();
    const artifact = (await f.sdk.artifacts.read(started.id)).artifact;
    await f.sdk.artifacts.delete(started.id, artifact.revision, true);
    f.service.store.db.prepare("DELETE FROM receipts WHERE profile_id=? AND id=?").run("default", started.commandId);
    await assert.rejects(() => f.sdk.command(started.command, started.commandId), { code: "candidate_generation_deleted" });
    assert.equal(f.requests.length, 1); assert.equal(await readFile(join(f.project, "fixture.txt"), "utf8"), "Generated later user edit.\n");
    assert.equal((await f.sdk.budgets.status(f.sessionId)).status.totals.reportedTokens, 42);
  } finally { t.mock.restoreAll(); await f.close(); }
});

test("generation history survives source archival/reopen, then permanent source deletion removes proposals without refunding charges or allowing paid resurrection", { skip: process.platform !== "darwin" }, async () => {
  const f = await fixture(); let reopened: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    const started = await f.generate(), result = await f.settled(started.id);
    assert.equal(result.generation.status, "proposed");
    const hashes = [result.generation.inputDigest, result.generation.resultDigest!, result.generation.proposalDocumentDigest!];
    const exported = JSON.parse((await f.sdk.artifacts.export(started.id)).export.text);
    assert.equal(exported.schemaVersion, 10); assert.ok(exported.documents[0].generation.events.length >= 3);
    assert.ok(exported.documents[0].generation.events.some((event: { event_type: string }) => event.event_type === "candidate.owner_bound"));
    assert.equal(exported.documents[0].generation.results.length, 3);
    await f.sdk.command({ type: "session.archive", sessionId: f.sessionId });
    assert.deepEqual((await f.sdk.candidates.generation(started.id)).input, result.input);
    f.sdk.disconnect(); await f.service.close();
    reopened = await startService({ stateDir: join(f.directory, "state"), provider: f.provider, retentionKey: f.retentionKey, platform: { terminal: { vault: f.terminalVault } } });
    const current = await new MoguriSdk(reopened.connection).ready();
    try {
      assert.deepEqual((await current.candidates.generation(started.id)).proposal, result.proposal);
      const artifact = (await current.artifacts.read(started.id)).artifact;
      assert.ok(artifact.sources.some((source) => source.actor === "model" && source.messageId === result.generation.stepId));
      assert.equal((await current.budgets.calls({ role: "draft" })).calls[0]?.reportedTokens, 42);
      for (const hash of hashes) assert.ok(reopened.store.blob(hash));
      reopened.store.db.prepare("DELETE FROM receipts WHERE profile_id=? AND id=?").run("default", started.commandId);
      assert.equal((await current.command(started.command, started.commandId)).id, started.id);
      await current.sessions.delete(f.sessionId, true);
      await assert.rejects(() => current.candidates.generation(started.id), { code: "candidate_generation_missing" });
      for (const hash of hashes) assert.throws(() => reopened!.store.blob(hash), /Missing or deleted/);
      reopened.store.db.prepare("DELETE FROM receipts WHERE profile_id=? AND id=?").run("default", started.commandId);
      await assert.rejects(() => current.command(started.command, started.commandId), { code: "candidate_generation_deleted" });
      assert.equal((await current.budgets.calls({ role: "draft" })).calls[0]?.reportedTokens, 42); assert.equal(f.requests.length, 1);
    } finally { current.disconnect(); }
  } finally { await reopened?.close(); await f.close(); }
});

test("a cancelled generation waiter cannot cancel owned inference or delete/archive its active report", { skip: process.platform !== "darwin" }, async () => {
  const f = await fixture();
  try {
    const started = await f.generate({ ...f.input, task: "generated slow generation waiter" }); await waitFor(() => f.requests.length === 1);
    const waiting = new AbortController(); waiting.abort(new Error("Generated wait-only cancellation."));
    await assert.rejects(() => f.sdk.candidates.waitGeneration(started.id, { signal: waiting.signal }), /wait-only cancellation/);
    await assert.rejects(() => f.sdk.candidates.waitGeneration("generated-absent-generation", { timeoutMs: 1000 }), { code: "candidate_generation_missing" });
    const record = (await f.sdk.candidates.generation(started.id)).generation, artifact = (await f.sdk.artifacts.read(started.id)).artifact;
    assert.equal(record.status, "running"); assert.equal(record.stopRequested, false);
    await assert.rejects(() => f.sdk.artifacts.delete(started.id, artifact.revision, true), { code: "candidate_generation_busy" });
    await assert.rejects(() => f.sdk.artifacts.update(started.id, { status: "archived" }, artifact.revision), { code: "candidate_generation_busy" });
    await f.sdk.candidates.stopGeneration(started.id); assert.notEqual((await f.settled(started.id)).generation.status, "proposed");
    assert.equal(f.requests.length, 1);
  } finally { await f.close(); }
});

test("generation uses the same finite token cap, preserves missing telemetry and rejects a provider output-bound violation", { skip: process.platform !== "darwin" }, async () => {
  for (const mode of ["finite", "blocked", "missing-usage", "output-violation"] as const) {
    const f = await fixture(JSON.stringify(patch), { ...(mode === "missing-usage" ? { omitUsage: true } : {}), ...(mode === "output-violation" ? { maxOutputTokens: 8 } : {}) });
    try {
      if (mode === "finite" || mode === "blocked") {
        const preview = (await f.sdk.candidates.generatePreview(f.sessionId, f.workspace.id, f.input)).preview;
        await f.sdk.sessions.configure(f.sessionId, { ...f.session().controls, budget: { kind: "limited", basis: "estimate", tokens: mode === "finite" ? preview.estimatedInputTokens + 16 : 1 } });
      }
      const started = await f.generate(), result = await f.settled(started.id), budget = (await f.sdk.budgets.status(f.sessionId)).status;
      assert.equal(result.generation.status, mode === "finite" ? "proposed" : "partial"); assert.equal(f.requests.length, mode === "blocked" ? 0 : 1);
      if (mode === "finite") { assert.equal(f.requests[0]?.max_tokens ?? f.requests[0]?.max_completion_tokens, 16); assert.equal(budget.totals.reportedTokens, 42); }
      if (mode === "missing-usage") { assert.equal(budget.totals.reportedTokens, null); assert.ok(budget.totals.heldTokens! > 0); assert.equal(result.text, JSON.stringify(patch)); }
      if (mode === "output-violation") { assert.equal(budget.totals.reportedTokens, 42); assert.equal(f.service.controller.snapshot().budgetEntries[0]?.outputLimitViolation, true); }
      assert.equal(budget.totals.billedUsd, null); assert.equal(await readFile(join(f.project, "fixture.txt"), "utf8"), "generated original\n");
      assert.equal(await readFile(join(f.workspace.path, "fixture.txt"), "utf8"), "generated original\n");
    } finally { await f.close(); }
  }
});

test("changed source after a model request retains raw output/charges but cannot publish a fresh-input proposal", { skip: process.platform !== "darwin" }, async () => {
  const f = await fixture();
  try {
    const started = await f.generate({ ...f.input, task: "generated delayed source change" }); await waitFor(() => f.requests.length === 1);
    await writeFile(join(f.project, "fixture.txt"), "Generated newer actual user source.\n");
    const result = await f.settled(started.id);
    assert.equal(result.generation.status, "partial"); assert.equal(result.proposal, null); assert.equal(result.text, JSON.stringify(patch));
    assert.equal(result.input.files[0]?.text, "generated original\n"); assert.equal((await f.sdk.budgets.status(f.sessionId)).status.totals.reportedTokens, 42);
    assert.equal(await readFile(join(f.project, "fixture.txt"), "utf8"), "Generated newer actual user source.\n");
    assert.equal(await readFile(join(f.workspace.path, "fixture.txt"), "utf8"), "generated original\n"); assert.equal(f.requests.length, 1);
  } finally { await f.close(); }
});
