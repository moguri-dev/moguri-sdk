import assert from "node:assert/strict";
import test from "node:test";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { setupFixture, waitFor } from "./fixture.ts";

test("an enabled turn-start hook requires real tool approval before model admission and never supplies model context", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture();
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.configure();
    const hook = await sdk.hooks.import(fixture.session().projectId!, {
      schemaVersion: 1, name: "generated-turn-start", description: "Generated turn-start check", trigger: "turn.start",
      command: "printf 'generated hook proof\\n'", timeoutMs: 2000,
    });
    await sdk.capabilities.toggle(hook.id!, true, 0);
    await fixture.send("generated normal task");
    await waitFor(() => fixture.session().pendingApproval || fixture.requests.length > 0);
    assert.equal(fixture.requests.length, 0);
    assert.equal(fixture.service.controller.snapshot().budgetEntries.length, 0);
    assert.equal(fixture.session().pendingApproval?.call.hook?.id, hook.id);
    await fixture.approve();
    await fixture.terminal();
    assert.equal(fixture.session().status, "completed");
    assert.equal(fixture.requests.length, 1);
    const output = fixture.service.controller.events(0).find((event) => event.event_type === "tool.completed" && event.payload.call.hook?.id === hook.id);
    assert.equal(output?.event_type, "tool.completed");
    if (output?.event_type === "tool.completed") assert.match(output.payload.text, /generated hook proof/);
    assert.equal(JSON.stringify(fixture.requests).includes("generated hook proof"), false);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("denied or failed hooks never become a successful turn or an extra paid call", { skip: process.platform !== "darwin" }, async () => {
  for (const trigger of ["turn.start", "turn.end"] as const) {
    const fixture = await setupFixture();
    const sdk = await new MoguriSdk(fixture.service.connection).ready();
    try {
      await fixture.configure();
      const hook = await sdk.hooks.import(fixture.session().projectId!, {
        schemaVersion: 1, name: "generated-denied", description: "Generated denied lifecycle hook", trigger,
        command: "printf 'generated denied hook must not run\\n'", timeoutMs: 2000,
      });
      await sdk.capabilities.toggle(hook.id!, true, 0);
      await fixture.send("generated normal task");
      await waitFor(() => fixture.session().pendingApproval);
      assert.equal(fixture.requests.length, trigger === "turn.start" ? 0 : 1);
      await assert.rejects(() => sdk.capabilities.toggle(hook.id!, false, 1), { code: "extension_busy" });
      await fixture.approve(false); await fixture.terminal();
      assert.equal(fixture.session().status, "failed");
      assert.equal(fixture.requests.length, trigger === "turn.start" ? 0 : 1);
      assert.equal(fixture.service.controller.events(0).some((event) => event.event_type === "process.started"), false);
    } finally { sdk.disconnect(); await fixture.close(); }
  }
});

test("stopping a running hook propagates cancellation without admitting a model", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture();
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.configure();
    const hook = await sdk.hooks.import(fixture.session().projectId!, {
      schemaVersion: 1, name: "generated-cancel", description: "Generated cancellation fixture", trigger: "turn.start",
      command: "sleep 30", timeoutMs: 60000,
    });
    await sdk.capabilities.toggle(hook.id!, true, 0); await fixture.send("generated normal task");
    await waitFor(() => fixture.session().pendingApproval); await fixture.approve();
    await waitFor(() => fixture.session().processes.length > 0);
    await sdk.command({ type: "session.stop", sessionId: fixture.sessionId }); await fixture.terminal();
    assert.equal(fixture.session().status, "partial");
    assert.equal(fixture.requests.length, 0);
    assert.equal(fixture.service.controller.snapshot().budgetEntries.length, 0);
    assert.ok(fixture.service.controller.events(0).some((event) => event.event_type === "turn.stop_acknowledged"));
  } finally { sdk.disconnect(); await fixture.close(); }
});
