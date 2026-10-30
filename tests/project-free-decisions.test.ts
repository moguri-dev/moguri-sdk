import assert from "node:assert/strict";
import test from "node:test";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { setupDecisions } from "./fixtures/decisions-api.ts";
import { automaticHome, homeCommand, waitFor } from "./fixture.ts";
import { appendLegacyAutopilot } from "./fixtures/legacy-state.ts";

test("legacy bounded Max applies its actual decision through the same retained Home writer and executor binding as ordinary approvals", { skip: process.platform !== "darwin", timeout: 15_000 }, async () => {
  const fixture = await setupDecisions({ delegated: false, primary: { toolCall: { name: "write_file",
    args: { path: "generated-bounded-max.txt", text: "GENERATED_BOUNDED_HOME_MAX\n", expectedDigest: "absent" } } } });
  try {
    const sdk = fixture.sdk, created = await sdk.sessions.create(null, "Generated bounded Home Max", { modelId: fixture.modelId });
    const current = () => fixture.service.controller.snapshot().sessions.find((session) => session.id === created.id)!;
    appendLegacyAutopilot(fixture.service, created.id!, "Autopilot Max"); await sdk.refresh();
    const settings = sdk.settings.get()!;
    await sdk.settings.update({ ...settings.values, permissions: { ...settings.values.permissions, tools: [{
      id: "generated-home-max-delegation", tool: "write_file", pathPrefix: "generated-bounded-max.txt", decision: "allow",
    }] } }, settings.revision);
    await sdk.command({ type: "draft.save", sessionId: created.id!, expectedRevision: 0, text: "Generated bounded Home Max exact delegated write.", attachments: [] });
    await sdk.command({ type: "message.send", sessionId: created.id!, expectedRevision: 1, delivery: "queue" });
    await waitFor(() => current().status === "completed");
    assert.equal(await readFile(join(fixture.home, "generated-bounded-max.txt"), "utf8"), "GENERATED_BOUNDED_HOME_MAX\n");
    const writer = fixture.service.controller.snapshot().chatWriters.find((writer) => writer.sessionId === created.id);
    assert.ok(writer); assert.equal(writer.status, "settled"); assert.deepEqual(writer.root, current().homeRoot);
    const decision = fixture.service.controller.events(0).find((event) => event.session_id === created.id && event.event_type === "tool.decided");
    assert.ok(decision?.event_type === "tool.decided"); assert.equal(decision.payload.actor, "decision-provider");
    assert.equal(decision.payload.ruleId, "generated-home-max-delegation");
    assert.equal(fixture.advice.requests.length, 1); assert.equal(fixture.requests.length, 2);
    assert.deepEqual(fixture.service.controller.snapshot().budgetEntries.filter((entry) => entry.sessionId === created.id).map((entry) => entry.role), ["solver", "decision", "solver"]);
  } finally { await fixture.close(); }
});

test("legacy bounded Max waits for the actual Home writer without another decision call and cannot override a real human denial while waiting", { skip: process.platform !== "darwin", timeout: 25_000 }, async (t) => {
  for (const humanDenial of [false, true]) await t.test(humanDenial ? "actual human denial" : "exact approved release", async () => {
    const fixture = await setupDecisions({ delegated: false, primary: { toolCall: { name: "write_file",
      args: { path: "generated-bounded-wait.txt", text: "GENERATED_BOUNDED_WAIT\n", expectedDigest: "absent" } } } });
    try {
      const sdk = fixture.sdk, created = await sdk.sessions.create(null, "Generated waiting bounded Home Max", { modelId: fixture.modelId });
      const current = () => fixture.service.controller.snapshot().sessions.find((session) => session.id === created.id)!;
      appendLegacyAutopilot(fixture.service, created.id!, "Autopilot Max"); await sdk.refresh();
      const settings = sdk.settings.get()!;
      await sdk.settings.update({ ...settings.values, permissions: { ...settings.values.permissions, tools: [{
        id: "generated-home-max-wait-delegation", tool: "write_file", pathPrefix: "generated-bounded-wait.txt", decision: "allow",
      }] } }, settings.revision);
      const blocker = await automaticHome(sdk, "Generated original Home writer");
      const command = await homeCommand(sdk, blocker, "printf ready > generated-boundary-ready; while ! test -f generated-boundary-release; do sleep 0.02; done");
      await waitFor(() => existsSync(join(fixture.home, "generated-boundary-ready")));
      await sdk.command({ type: "draft.save", sessionId: created.id!, expectedRevision: 0, text: "Generated bounded Home Max waits for its real root.", attachments: [] });
      await sdk.command({ type: "message.send", sessionId: created.id!, expectedRevision: 1, delivery: "queue" });
      await waitFor(() => fixture.service.controller.snapshot().decisions.find((record) => record.sessionId === created.id && record.resultDigest));
      assert.equal(existsSync(join(fixture.home, "generated-bounded-wait.txt")), false);
      assert.ok(current().pendingApproval);
      assert.equal(fixture.service.controller.events(0).some((event) => event.session_id === created.id && event.event_type === "tool.started"), false);
      if (humanDenial) {
        await sdk.approvals.respond(created.id!, current().pendingApproval!.id, false);
        await waitFor(() => current().status === "completed");
      }
      await writeFile(join(fixture.home, "generated-boundary-release"), "Generated actual release.\n");
      await waitFor(() => fixture.service.controller.snapshot().jobs.find((job) => job.id === command.id)?.status === "completed");
      await waitFor(() => current().status === "completed");
      assert.equal(existsSync(join(fixture.home, "generated-bounded-wait.txt")), !humanDenial);
      const writer = fixture.service.controller.snapshot().chatWriters.find((writer) => writer.sessionId === created.id);
      if (humanDenial) assert.equal(writer, undefined);
      else { assert.ok(writer); assert.equal(writer.status, "settled"); }
      assert.equal(fixture.advice.requests.length, 1); assert.equal(fixture.requests.length, 2);
      assert.equal(current().projectId, null);
    } finally { await fixture.close(); }
  });
});
