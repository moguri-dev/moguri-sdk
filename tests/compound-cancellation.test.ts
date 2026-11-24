import assert from "node:assert/strict";
import { test } from "node:test";
import { compoundApiFixture } from "./fixtures/compound-api.ts";
import { waitFor } from "./fixture.ts";
import { ciTime } from "./fixtures/time-scale.ts";

test("stop reaches the actual approved project-test process group, retains partial evidence and quarantines its exact candidate without another paid role", { skip: process.platform !== "darwin", timeout: ciTime(25000) }, async () => {
  const f = await compoundApiFixture();
  try {
    const project = (await f.sdk.projects.configuration(f.session().projectId)).configuration;
    await f.sdk.projects.configure(project.projectId, { ...project.values, scripts: [{ id: "generated-validation", name: "Generated cancellable validation",
      command: `node -e "console.log('GENERATED_ACTUAL_VALIDATION_STARTED');setTimeout(()=>{},60000)"` }] }, project.revision);
    f.input.validationTimeoutMs = 60000;
    await f.configure();
    const preview = await f.sdk.compound.preview(f.input), created = await f.sdk.compound.start(f.input, preview.preview.digest, true); assert.ok(created.id);
    const pending = await waitFor(() => {
      const value = f.service.controller.snapshot().compoundWorkflows[0];
      return value?.status === "waiting_validation" ? value : null;
    });
    const review = await f.sdk.compound.validationPreview(created.id);
    await f.sdk.compound.review(created.id, review.review.validationId, pending.revision, review.review.digest, true);
    const processEvent = await waitFor(() => f.service.controller.events(0).find((event) => event.event_type === "process.started" && event.turn_id === created.id && event.payload.callId === review.review.validationId));
    assert.ok(processEvent.event_type === "process.started");
    const pid = processEvent.payload.pid;
    await f.sdk.compound.stop(created.id); await waitFor(() => !f.session().turnId, 12000);
    const result = await f.sdk.compound.read(created.id);
    assert.equal(result.workflow.status, "partial"); assert.equal(result.workflow.stopRequested, true);
    assert.equal(result.workflow.validations[0]?.dispatched, true); assert.equal(result.workflow.validations[0]?.status, "partial");
    assert.ok(result.validations[0]?.result?.text.includes("Detached/reparented"));
    assert.equal(f.service.controller.snapshot().blockedWorkspaces.includes(f.workspace.id), true);
    assert.equal(result.workflow.selectedCandidateId, null);
    assert.equal(f.providers[2]!.requests.length, 0); assert.equal(f.service.controller.snapshot().budgetEntries.length, 2);
    assert.equal(await f.source(), "generated original\n");
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
    assert.ok(f.service.controller.events(0).some((event) => event.event_type === "turn.stop_acknowledged" && event.turn_id === created.id));
  } finally { await f.close(); }
});

test("a failed public stop-intent append still cancels actual inference without pretending the request was durably retained", { skip: process.platform !== "darwin", timeout: ciTime(20000) }, async () => {
  const f = await compoundApiFixture();
  try {
    f.input.input.task = "generated slow bounded public classifier for failed stop journal";
    await f.configure();
    const preview = await f.sdk.compound.preview(f.input), created = await f.sdk.compound.start(f.input, preview.preview.digest, true); assert.ok(created.id);
    await waitFor(() => f.requests.length === 1);
    let attempts = 0;
    f.service.store.db.function("generated_compound_stop_failure", () => {
      if (++attempts === 1) throw new Error("Generated original public stop append failure.");
      return 0;
    });
    f.service.store.db.exec(`CREATE TRIGGER generated_compound_stop BEFORE INSERT ON events
      WHEN json_extract(NEW.data,'$.event_type')='compound.recorded' BEGIN SELECT generated_compound_stop_failure(); END;`);
    await assert.rejects(() => f.sdk.compound.stop(created.id!));
    await waitFor(() => !f.session().turnId, 6000);
    const result = await f.sdk.compound.read(created.id);
    assert.equal(result.workflow.stopRequested, false);
    assert.ok(["stopped", "partial"].includes(result.workflow.status));
    assert.equal(f.requests.length, 1); assert.ok(f.providers.every((provider) => provider.requests.length === 0));
    assert.equal(f.service.controller.snapshot().budgetEntries[0]?.status, "unknown");
    assert.ok(f.service.controller.events(0).some((event) => event.event_type === "turn.stop_acknowledged" && event.turn_id === created.id));
    f.service.store.db.exec("DROP TRIGGER generated_compound_stop");
  } finally { await f.close(); }
});
