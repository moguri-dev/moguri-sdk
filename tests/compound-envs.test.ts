import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { remoteCompoundFixture } from "./fixtures/compound-env-api.ts";
import { waitFor } from "./fixture.ts";

async function waiting(f: Awaited<ReturnType<typeof remoteCompoundFixture>>, id: string) {
  try {
    return await waitFor(() => {
      const record = f.service.controller.snapshot().compoundWorkflows.find((record) => record.id === id);
      if (record && !["running", "waiting_validation", "validating"].includes(record.status)) throw new Error(`Generated actual workflow ended ${record.status}: ${record.diagnostic}`);
      return record?.status === "waiting_validation" ? record : null;
    }, 60000);
  } catch (error) {
    const record = f.service.controller.snapshot().compoundWorkflows.find((record) => record.id === id);
    const transports = f.service.controller.platform.candidateEnvs.transports.records().filter((record) => record.sessionId === f.sessionId).slice(-3)
      .map(({ status, sequence, diagnostic, terminalAcknowledged, cleanupConfirmed }) => ({ status, sequence, diagnostic, terminalAcknowledged, cleanupConfirmed }));
    throw new Error(`${error instanceof Error ? error.message : "Generated wait failed"}\n${JSON.stringify({ workflow: record, transports, requests: [f.requests.length, ...f.providers.map((provider) => provider.requests.length)] })}`);
  }
}

test("actual SSH Cascade owns tool-less model roles, real configured project tests and a separately accepted original-peer application", { timeout: 120000 }, async () => {
  const f = await remoteCompoundFixture();
  try {
    const index = await readFile(join(f.peer, ".git/index")), head = f.peerGit(["rev-parse", "HEAD"]), local = await readFile(join(f.project, "fixture.txt"), "utf8");
    const preview = await f.sdk.compound.preview(f.input);
    assert.equal(preview.preview.document.version, 2); assert.equal(preview.preview.document.source.env, "Remote");
    const started = await f.sdk.compound.start(f.input, preview.preview.digest, true);
    const pending = await waiting(f, started.id!);
    assert.equal(await f.source(), "generated original\n"); assert.equal(pending.env, "Remote");
    const review = (await f.sdk.compound.read(started.id!)).pendingValidation!;
    await f.sdk.compound.review(started.id!, review.validationId, pending.revision, review.digest, true);
    const done = await waitFor(() => {
      const record = f.service.controller.snapshot().compoundWorkflows.find((record) => record.id === started.id);
      if (record && (!["running", "validating", "proposed"].includes(record.status) || record.validations.length > 1)) {
        throw new Error(`Generated unexpected actual validation outcome: ${JSON.stringify(record)}`);
      }
      return record?.status === "proposed" && !f.session().turnId ? record : null;
    }, 30000);
    const read = await f.sdk.compound.read(done.id);
    assert.match(read.validations[0]!.result!.text, /GENERATED_REAL_PROJECT_TEST_PASSED/);
    assert.equal(read.validations[0]!.result!.stage.env, "Remote");
    assert.equal((await f.sdk.candidates.read(done.selectedCandidateId!)).candidate.acceptance, null);
    assert.equal(await f.source(), "generated original\n");
    assert.ok(f.service.controller.snapshot().budgetEntries.every((entry) => entry.env === "Remote" && entry.status === "settled"));
    await waitFor(() => f.service.controller.snapshot().executions.some((execution) => execution.turnId === done.id && execution.cleanup === "owned-worker-stopped"), 8000);
    const candidate = await f.sdk.candidates.read(done.selectedCandidateId!), apply = (await f.sdk.candidates.applyPreview(candidate.candidate.id, f.sessionId)).preview;
    await f.sdk.candidates.apply(candidate.candidate.id, f.sessionId, apply.revision, apply.digest);
    assert.equal((await f.sdk.candidates.wait(candidate.candidate.id)).candidate.status, "applied");
    assert.equal(await f.source(), f.proposal.patch.edits[0]!.text);
    assert.deepEqual(await readFile(join(f.peer, ".git/index")), index); assert.equal(f.peerGit(["rev-parse", "HEAD"]), head);
    assert.equal(await readFile(join(f.project, "fixture.txt"), "utf8"), local);
    assert.equal(f.providers[2]!.requests.length, 0); assert.equal(f.providers[3]!.requests.length, 0);
    assert.equal(JSON.stringify(f.providers[1]!.requests).includes("GENERATED_PEER_ROUTER_REASON_NOT_CONTEXT"), false);
  } catch (error) {
    const records = f.service.controller.snapshot().compoundWorkflows.map(({ status, phase, diagnostic, validations }) => ({ status, phase, diagnostic, validations }));
    console.error("Generated SSH compound failure:", error instanceof Error ? error.message : "unknown", JSON.stringify(records));
    throw error;
  } finally { await f.close(); }
});

test("denied SSH tests spend no critic; only another explicit reviewed workflow can run real peer critique", { timeout: 180000 }, async () => {
  const f = await remoteCompoundFixture("critique");
  try {
    const preview = await f.sdk.compound.preview(f.input), started = await f.sdk.compound.start(f.input, preview.preview.digest, true);
    const pending = await waiting(f, started.id!);
    const review = (await f.sdk.compound.read(started.id!)).pendingValidation!;
    await f.sdk.compound.review(started.id!, review.validationId, pending.revision, review.digest, false);
    const stopped = await waitFor(() => {
      const record = f.service.controller.snapshot().compoundWorkflows.find((record) => record.id === started.id);
      return record?.status === "stopped" && !f.session().turnId ? record : null;
    }, 15000);
    assert.equal(stopped.validations[0]?.status, "denied");
    assert.equal(f.providers[3]!.requests.length, 0); assert.equal(f.providers[2]!.requests.length, 0);
    assert.equal(await readFile(join(f.draft.stage!.root, "fixture.txt"), "utf8"), "generated original\n");
    assert.equal(await f.source(), "generated original\n");
    assert.equal(f.sdk.getState().snapshot!.candidates.length, 0);
    await waitFor(() => f.service.controller.snapshot().executions.some((execution) => execution.turnId === stopped.id && execution.cleanup === "owned-worker-stopped"), 8000);
    const fresh = await f.sdk.compound.preview(f.input), restarted = await f.sdk.compound.start(f.input, fresh.preview.digest, true);
    assert.notEqual(restarted.id, stopped.id);
    const next = await waiting(f, restarted.id!), nextReview = (await f.sdk.compound.read(restarted.id!)).pendingValidation!;
    await f.sdk.compound.review(restarted.id!, nextReview.validationId, next.revision, nextReview.digest, true);
    const recommended = await waitFor(() => {
      const record = f.service.controller.snapshot().compoundWorkflows.find((record) => record.id === restarted.id);
      if (record && !["running", "validating", "proposed"].includes(record.status)) throw new Error(`Generated peer critique did not complete: ${record.diagnostic}`);
      return record?.status === "proposed" && !f.session().turnId ? record : null;
    }, 60000);
    const actual = await f.sdk.compound.read(recommended.id), critic = actual.roles.find((value) => value.step.role === "critic");
    assert.ok(critic?.result); assert.match(critic.input!, /untrustedValidationEvidence/);
    assert.match(actual.validations[0]!.result!.text, /GENERATED_REAL_PROJECT_TEST_PASSED/);
    assert.equal(f.providers[3]!.requests.length, 1); assert.equal(f.providers[2]!.requests.length, 0);
    assert.equal((await f.sdk.candidates.read(recommended.selectedCandidateId!)).candidate.acceptance, null);
    assert.equal(await f.source(), "generated original\n");
  } catch (error) {
    console.error("Generated SSH critique failure:", error instanceof Error ? error.message : "unknown",
      JSON.stringify({ workflows: f.service.controller.snapshot().compoundWorkflows.map(({ status, phase, diagnostic }) => ({ status, phase, diagnostic })),
        executions: f.service.controller.snapshot().executions.map(({ status, cleanup, diagnostic, lastSequence }) => ({ status, cleanup, diagnostic, lastSequence })),
        transports: f.service.controller.platform.candidateEnvs.transports.records().filter((record) => !record.cleanupConfirmed)
          .map(({ status, sequence, terminalAcknowledged, diagnostic, launchJson }) => ({ status, sequence, terminalAcknowledged, diagnostic, launchKind: JSON.parse(launchJson).kind })) }));
    throw error;
  } finally { await f.close(); }
});
