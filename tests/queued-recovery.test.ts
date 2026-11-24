import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import test from "node:test";
import { startService } from "../apps/service/src/server.ts";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { setupFixture, waitFor } from "./fixture.ts";
import { launchRuntimeChild } from "./fixtures/runtime-process.ts";
import { ciTime } from "./fixtures/time-scale.ts";

for (const position of ["running", "waiting-client", "claimed"] as const) test(`actual controller SIGKILL preserves ${position} command ownership and never replays uncertain work`, { timeout: ciTime(20000) }, async () => {
  const fixture = await setupFixture(), stateDir = join(fixture.directory, "state");
  await fixture.service.close();
  const runtime = await launchRuntimeChild({ stateDir, vaultPath: join(fixture.directory, "generated-vault.json"), modelId: fixture.modelId,
    baseUrl: fixture.baseUrl, holdQueuedFile: position === "running" });
  let sdk = await new MoguriSdk(runtime.connection).ready(), restarted: Awaited<ReturnType<typeof startService>> | undefined;
  const text = position === "running" ? "/file fixture.txt" : "/queue", clientId = randomUUID();
  try {
    let revision = sdk.getState().snapshot!.sessions.find((session) => session.id === fixture.sessionId)!.draft.revision;
    await sdk.command({ type: "draft.save", sessionId: fixture.sessionId, expectedRevision: revision, text, attachments: [] });
    await sdk.commands.submit(fixture.sessionId, { client: "cli", expectedDraftRevision: revision + 1 });
    const execution = await waitFor(() => sdk.getState().snapshot!.commandExecutions.find((execution) => execution.status === (position === "running" ? "running" : "waiting-client")));
    if (position === "running") await waitFor(() => runtime.heldQueuedCommandId === execution.id);
    if (position === "claimed") {
      await sdk.command({ type: "slash.client.attach", clientId, client: "cli", handlers: ["panel"] });
      await sdk.commands.claim(clientId, execution.id, execution.revision);
    }
    revision = sdk.getState().snapshot!.sessions.find((session) => session.id === fixture.sessionId)!.draft.revision;
    await sdk.command({ type: "draft.save", sessionId: fixture.sessionId, expectedRevision: revision, text: "/theme rose dark", attachments: [] });
    await sdk.commands.submit(fixture.sessionId, { client: "cli", expectedDraftRevision: revision + 1 });
    runtime.child.kill("SIGKILL"); await runtime.exited; sdk.disconnect();
    restarted = await startService({ stateDir, provider: fixture.provider, retentionKey: fixture.retentionKey });
    sdk = await new MoguriSdk(restarted.connection).ready();
    const retained = await sdk.commands.read(execution.id);
    assert.equal(retained.item.text, text); assert.equal(retained.execution.status, position === "waiting-client" ? "waiting-client" : "partial");
    if (position === "waiting-client") {
      assert.equal(retained.result?.kind, "panel");
      let applied = 0;
      const client = await sdk.commands.attach("cli", { panel: async () => { applied++; return { outcome: "completed" }; } });
      try {
        await waitFor(() => restarted!.controller.snapshot().commandExecutions.find((value) => value.id === execution.id)?.status === "completed");
        assert.equal(restarted.controller.snapshot().settings.values.appearance.palette, "moguri");
        await sdk.command({ type: "session.resume", sessionId: fixture.sessionId });
        await waitFor(() => restarted!.controller.snapshot().settings.values.appearance.palette === "rose");
        assert.equal(applied, 1); assert.equal((await sdk.commands.read(execution.id)).execution.status, "completed");
      } finally { await client.dispose(); }
    } else {
      const session = sdk.getState().snapshot!.sessions.find((session) => session.id === fixture.sessionId)!;
      assert.equal(session.queue.length, 1); assert.equal(session.queue[0]?.held, true);
      assert.match(retained.execution.diagnostic ?? "", /restarted|unknown|replayed/i);
      assert.equal(restarted.controller.snapshot().settings.values.appearance.palette, "moguri");
      assert.equal(restarted.controller.events(0).filter((event) => event.event_type === "slash.command_recorded" && event.payload.execution.id === execution.id && event.payload.execution.revision === 0).length, 1);
    }
    assert.equal(fixture.requests.length, 0); assert.equal(restarted.controller.snapshot().budgetEntries.length, 0);
  } finally { sdk.disconnect(); await runtime.stop(); await restarted?.close(); await fixture.close(); }
});

test("a lost client completion acknowledgement cannot repeat an applied UI effect after service restart", { timeout: ciTime(20000) }, async (t) => {
  const fixture = await setupFixture(), stateDir = join(fixture.directory, "state"), clientId = randomUUID();
  let sdk = await new MoguriSdk(fixture.service.connection).ready(), restarted: Awaited<ReturnType<typeof startService>> | undefined, applied = 0;
  try {
    await sdk.command({ type: "draft.save", sessionId: fixture.sessionId, expectedRevision: 0, text: "/queue", attachments: [] });
    await sdk.commands.submit(fixture.sessionId, { client: "cli", expectedDraftRevision: 1 });
    const execution = await waitFor(() => fixture.service.controller.snapshot().commandExecutions.find((execution) => execution.status === "waiting-client"));
    await sdk.command({ type: "slash.client.attach", clientId, client: "cli", handlers: ["panel"] });
    const claim = await sdk.commands.claim(clientId, execution.id, execution.revision); applied++;
    const original = sdk.command.bind(sdk);
    t.mock.method(sdk, "command", async (...args: Parameters<typeof original>) => {
      const value = await original(...args);
      if (args[0].type === "slash.client.complete") throw new Error("Generated acknowledgement lost after actual commit.");
      return value;
    });
    await assert.rejects(() => sdk.commands.complete(clientId, claim.executionId, claim.revision, claim.token, { outcome: "completed" }), /acknowledgement lost/);
    t.mock.restoreAll(); sdk.disconnect(); await fixture.service.close();
    restarted = await startService({ stateDir, provider: fixture.provider, retentionKey: fixture.retentionKey });
    sdk = await new MoguriSdk(restarted.connection).ready();
    const client = await sdk.commands.attach("cli", { panel: async () => { applied++; return { outcome: "completed" }; } });
    try {
      assert.equal((await sdk.commands.read(execution.id)).execution.status, "completed");
      await new Promise((resolve) => setTimeout(resolve, 100)); assert.equal(applied, 1);
      assert.equal((await sdk.commands.read(execution.id)).item.text, "/queue"); assert.equal(fixture.requests.length, 0);
    } finally { await client.dispose(); }
  } finally { t.mock.restoreAll(); sdk.disconnect(); await restarted?.close(); await fixture.close(); }
});
