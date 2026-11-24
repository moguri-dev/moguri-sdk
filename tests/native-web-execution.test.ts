import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { digest } from "../apps/service/src/store.ts";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { automaticHome, homeCommand, reviewNativeTools, setupFixture, waitFor } from "./fixture.ts";
import { ciTime } from "./fixtures/time-scale.ts";

test("actual Manual and Guided turns read and edit through policy without an approval response", { skip: process.platform !== "darwin" }, async (t) => {
  for (const autonomy of ["Manual", "Guided"] as const) await t.test(autonomy, async () => {
    const fixture = await setupFixture({ toolBatches: [[{ name: "read_file", args: { path: "fixture.txt" } }],
      [{ name: "edit_file", args: { path: "fixture.txt", expectedDigest: digest("generated original\n"), edits: [{ oldText: "generated original", newText: "generated native update" }] } }]] });
    const sdk = await new MoguriSdk(fixture.service.connection).ready();
    try {
      await fixture.configure(); await sdk.refresh(); await sdk.sessions.autonomy(fixture.sessionId, autonomy);
      await fixture.send(`Generated ${autonomy} native operation.`);
      await waitFor(() => fixture.session().pendingApproval || ["completed", "failed", "partial"].includes(fixture.session().status));
      assert.equal(fixture.session().pendingApproval, null);
      assert.equal((await fixture.terminal()).status, "completed");
      assert.equal(await readFile(join(fixture.project, "fixture.txt"), "utf8"), "generated native update\n");
      const decisions = fixture.service.controller.events(0).filter((event) => event.event_type === "tool.decided");
      assert.equal(decisions.length, 2);
      assert.ok(decisions.every((event) => event.event_type === "tool.decided" && event.payload.actor === "policy"));
      assert.equal(fixture.service.controller.snapshot().decisions.length, 0);
    } finally { sdk.disconnect(); await fixture.close(); }
  });
});

test("native defaults retain an explicitly stricter review rule and scripts still require an actual user response", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture({ toolBatches: [[{ name: "read_file", args: { path: "fixture.txt" } }],
    [{ name: "run_command", args: { command: "printf 'Generated reviewed script\\n'", timeoutMs: 2000 } }]] });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const current = sdk.settings.get()!;
    await sdk.settings.update({ ...current.values, permissions: { ...current.values.permissions,
      tools: [{ id: "generated-explicit-read-review", tool: "read_file", pathPrefix: "", decision: "ask" }] } }, current.revision);
    await fixture.configure(); await fixture.send("Generated stricter file review and ordinary script.");
    await waitFor(() => fixture.session().pendingApproval?.call.name === "read_file");
    await fixture.approve();
    await waitFor(() => fixture.session().pendingApproval?.call.name === "run_command");
    await fixture.approve();
    assert.equal((await fixture.terminal()).status, "completed");
    assert.ok(fixture.service.controller.events(0).filter((event) => event.event_type === "tool.decided").every((event) =>
      event.event_type === "tool.decided" && event.payload.actor === "user"));
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("a native policy grant cannot survive a stricter review rule arriving while Home writer admission waits", { skip: process.platform !== "darwin", timeout: ciTime(20_000) }, async () => {
  const fixture = await setupFixture({ toolCall: { name: "write_file", args: { path: "generated-must-not-write.txt", text: "Generated stale permission.", expectedDigest: "absent" } } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  let changed: Promise<unknown> | undefined, target: string | undefined;
  const changeReview = () => {
    if (changed || !target || !fixture.service.controller.snapshot().chatWriters.some((writer) => writer.sessionId === target && writer.status === "active")) return;
    changed = Promise.resolve();
    changed = reviewNativeTools(fixture, ["write_file"]);
  };
  fixture.service.controller.on("change", changeReview);
  try {
    const blocking = await automaticHome(sdk, "Generated original Home writer");
    const started = await homeCommand(sdk, blocking, "printf ready > generated-root-busy; while ! test -f generated-root-release; do sleep 0.02; done", 5000);
    await waitFor(() => existsSync(join(fixture.home, "generated-root-busy")));
    const writer = await sdk.sessions.create(null, "Generated native permission waiter", { modelId: fixture.modelId });
    target = writer.id;
    await sdk.command({ type: "draft.save", sessionId: writer.id!, expectedRevision: 0, text: "Generated native file.", attachments: [] });
    await sdk.command({ type: "message.send", sessionId: writer.id!, expectedRevision: 1, delivery: "queue" });
    await waitFor(() => fixture.service.controller.events(0).some((event) => event.session_id === writer.id && event.event_type === "model.completed"));
    await writeFile(join(fixture.home, "generated-root-release"), "Generated original writer release.\n");
    assert.equal((await sdk.jobs.wait(started.id!)).status, "completed");
    await waitFor(() => fixture.service.controller.snapshot().sessions.find((session) => session.id === writer.id)?.turnId === null);
    assert.ok(changed); await changed;
    assert.equal(existsSync(join(fixture.home, "generated-must-not-write.txt")), false);
    assert.equal(fixture.service.controller.events(0).some((event) => event.session_id === writer.id && event.event_type === "tool.started"), false);
  } finally { fixture.service.controller.off("change", changeReview); sdk.disconnect(); await fixture.close(); }
});
