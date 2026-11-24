import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { startService } from "../apps/service/src/server.ts";
import { setupFixture, waitFor } from "./fixture.ts";
import { launchRuntimeChild } from "./fixtures/runtime-process.ts";
import { ciTime } from "./fixtures/time-scale.ts";

test("actual controller SIGKILL preserves an unknown prerequisite and never releases or replays its dependent", { skip: process.platform !== "darwin", timeout: ciTime(25000) }, async () => {
  const f = await setupFixture({ maxOutputTokens: 128, respond: () => ({ text: "Generated incomplete prerequisite.", hold: true }) });
  const stateDir = join(f.directory, "state");
  let runtime: Awaited<ReturnType<typeof launchRuntimeChild>> | undefined;
  let service: Awaited<ReturnType<typeof startService>> | undefined;
  let sdk = await new MoguriSdk(f.service.connection).ready();
  try {
    await f.configure();
    const target = (await sdk.sessions.create(f.session().projectId, "Generated crash prerequisite", f.session().controls)).id!;
    await sdk.command({ type: "draft.save", sessionId: target, text: "Generated crash-safe prerequisite.", attachments: [], expectedRevision: 0 });
    await sdk.command({ type: "message.send", sessionId: target, expectedRevision: sdk.sessions.get(target)!.draft.revision, delivery: "queue", held: true });
    await sdk.sessions.waitFor((await sdk.sessions.waitPreview(f.sessionId, target)).preview, true);
    const originalWait = f.session().wait!;
    await f.send("Generated dependent must stay retained.");
    const originalQueued = structuredClone(f.session().queue[0]);
    sdk.disconnect(); await f.service.close();
    runtime = await launchRuntimeChild({ stateDir, vaultPath: join(f.directory, "generated-wait-vault.json"),
      modelId: f.modelId, modelInfo: f.provider.state.models[0], baseUrl: f.baseUrl, homeRoot: f.home });
    sdk = await new MoguriSdk(runtime.connection).ready();
    const queued = sdk.sessions.get(target)!;
    await sdk.prompts.release(target, queued.queue[0]!.id, queued.queueRevision);
    await waitFor(() => f.requests.length === 1 && sdk.getState().snapshot!.budgetEntries.some((entry) => entry.sessionId === target));
    runtime.child.kill("SIGKILL"); await runtime.exited; sdk.disconnect();
    service = await startService({ stateDir, provider: f.provider, retentionKey: f.retentionKey,
      platform: { terminal: { defaultRoot: f.home, vault: f.terminalVault } } });
    sdk = await new MoguriSdk(service.connection).ready();
    await waitFor(() => sdk.sessions.get(f.sessionId)?.wait?.status === "blocked");
    const dependent = sdk.sessions.get(f.sessionId)!;
    assert.equal(dependent.wait?.id, originalWait.id);
    assert.deepEqual(dependent.wait?.task, originalWait.task);
    assert.equal(dependent.queue[0]?.text, "Generated dependent must stay retained.");
    assert.deepEqual(dependent.queue[0], originalQueued);
    assert.equal(dependent.turnId, null);
    assert.equal(f.requests.length, 1);
    const entry = sdk.getState().snapshot!.budgetEntries.find((entry) => entry.sessionId === target)!;
    assert.equal(entry.status, "unknown"); assert.ok(entry.reservedTokens! > 0);
  } finally { sdk.disconnect(); await runtime?.stop(); await service?.close(); await f.close(); }
});
