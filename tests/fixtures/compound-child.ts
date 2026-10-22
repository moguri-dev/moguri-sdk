import { randomUUID } from "node:crypto";
import { compoundApiFixture } from "./compound-api.ts";
import { waitFor } from "../fixture.ts";
import { isRecord } from "../../packages/protocol/src/index.ts";

process.once("message", (value: unknown) => {
  void (async () => {
    if (!isRecord(value) || !["inflight", "review", "validation"].includes(String(value.phase))) throw new Error("Choose one generated compound controller-loss phase.");
    const phase = value.phase, f = await compoundApiFixture();
    if (phase === "inflight") f.input.input.task = "generated slow public classifier for actual controller loss";
    if (phase === "validation") {
      const project = (await f.sdk.projects.configuration(f.session().projectId)).configuration;
      await f.sdk.projects.configure(project.projectId, { ...project.values, scripts: [{ id: "generated-validation", name: "Generated owned loss check",
        command: `node -e "console.log('GENERATED_CONTROLLER_LOSS_VALIDATION');setTimeout(()=>{},60000)"` }] }, project.revision);
      f.input.validationTimeoutMs = 60000;
    }
    await f.configure();
    const preview = await f.sdk.compound.preview(f.input), commandId = randomUUID();
    const command = { type: "compound.start" as const, input: f.input, expectedDigest: preview.preview.digest, confirmCost: true as const };
    const created = await f.sdk.command(command, commandId); if (!created.id) throw new Error("Generated actual public workflow has no original identity.");
    if (phase === "inflight") await waitFor(() => f.requests.length === 1);
    else {
      await waitFor(() => f.service.controller.snapshot().compoundWorkflows[0]?.status === "waiting_validation");
      if (phase === "validation") {
        const review = await f.sdk.compound.validationPreview(created.id);
        await f.sdk.compound.review(created.id, review.review.validationId, review.revision, review.review.digest, true);
        await waitFor(() => f.service.controller.events(0).some((event) => event.event_type === "process.started" && event.turn_id === created.id));
      }
    }
    const record = f.service.controller.snapshot().compoundWorkflows[0]!;
    const processEvent = f.service.controller.events(0).find((event) => event.event_type === "process.started" && event.turn_id === record.id);
    process.send?.({ directory: f.directory, project: f.project, stateDir: f.directory + "/state", sessionId: f.sessionId, workflowId: record.id,
      commandId, command, originalCalls: f.service.controller.snapshot().budgetEntries.length, stageId: f.workspace.id,
      testPid: processEvent?.event_type === "process.started" ? processEvent.payload.pid : null });
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
  })().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Generated public controller-loss setup failed.");
    process.exitCode = 1; process.disconnect?.();
  });
});
