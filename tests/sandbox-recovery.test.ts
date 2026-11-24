import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { startService } from "../apps/service/src/server.ts";
import { captureSandboxResult } from "../apps/service/src/sandbox-results.ts";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { fixtureProvider, GENERATED_RETENTION_KEY, waitFor } from "./fixture.ts";
import { nativeConfiguration, nativeFixtureCommand } from "./fixtures/native-target.ts";
import { GeneratedFileVault } from "./fixtures/generated-vault.ts";
import { launchRuntimeChild } from "./fixtures/runtime-process.ts";
import { ciTime } from "./fixtures/time-scale.ts";

const configuration = await nativeConfiguration();
test("actual controller SIGKILL retains original native ownership and late metering without a replacement guest, model call or resumed context", { skip: !configuration, timeout: ciTime(90_000) }, async () => {
  assert.ok(configuration);
  await mkdir(".native/qualification", { recursive: true, mode: 0o700 });
  const root = await realpath(await mkdtemp(".native/qualification/native-recovery-")), state = join(root, "state"), vaultPath = join(root, "generated-vault.json");
  await mkdir(state, { mode: 0o700 });
  const provider = await fixtureProvider({ exposeModels: true }), command = await nativeFixtureCommand(provider.modelId);
  const runtime = await launchRuntimeChild({ stateDir: state, vaultPath, modelId: provider.modelId, baseUrl: "https://api.githubcopilot.com", nativeCommand: command, holdNativeResult: true });
  let sdk = await new MoguriSdk(runtime.connection).ready(), restarted: Awaited<ReturnType<typeof startService>> | undefined, passed = false;
  try {
    const settings = structuredClone(sdk.settings.get()!);
    settings.values.sandbox = { ...configuration, qualification: { ...configuration.qualification!, allowedDomains: ["api.githubcopilot.com"], allowCopilot: true } };
    await sdk.settings.update(settings.values, settings.revision); await sdk.sandbox.probe();
    const created = await sdk.sessions.create(null), session = () => sdk.getState().snapshot!.sessions.find((value) => value.id === created.id)!;
    await sdk.sessions.configure(created.id!, { ...session().controls, env: "Sandbox", modelId: provider.modelId });
    const preview = (await sdk.sandbox.preview(created.id!, [])).preview;
    await sdk.sandbox.prepare(created.id!, [], preview.digest, session().revision);
    await sdk.command({ type: "draft.save", sessionId: created.id!, expectedRevision: 0, text: "generated native text", attachments: [] });
    await sdk.command({ type: "message.send", sessionId: created.id!, expectedRevision: 1, delivery: "queue" });
    await waitFor(() => runtime.heldExecution, 20_000);
    runtime.child.kill("SIGKILL"); await runtime.exited; sdk.disconnect();
    const vault = new GeneratedFileVault(vaultPath);
    restarted = await startService({ stateDir: state, provider: provider.provider, retentionKey: GENERATED_RETENTION_KEY, platform: { vault, sandbox: { vault, command } } });
    sdk = await new MoguriSdk(restarted.connection).ready();
    const execution = sdk.getState().snapshot!.sandboxExecutions![0]!;
    assert.equal(session().status, "partial");
    assert.equal((await sdk.sandbox.status()).sandbox.ready, false);
    assert.equal(execution.cleanup, "unconfirmed");
    assert.equal(sdk.getState().snapshot!.budgetEntries[0]?.status, "unknown");
    assert.ok(sdk.getState().snapshot!.budgetEntries[0]!.reservedTokens! > 0);
    let retained = false, pendingEvidence: unknown;
    for (let index = 0; index < 100; index++) {
      try { await captureSandboxResult(execution, await restarted.controller.sandbox.key(execution.id), []); retained = true; break; }
      catch (error) { pendingEvidence = error; await new Promise((resolve) => setTimeout(resolve, 50)); }
    }
    assert.equal(retained, true, pendingEvidence instanceof Error ? pendingEvidence.message : "Actual SendBox finalization must retain after-state without launching another guest.");
    const messages = structuredClone(session().messages);
    await sdk.sandbox.reconcile(execution.id);
    assert.equal(session().status, "partial");
    assert.equal(sdk.getState().snapshot!.sandboxExecutions!.length, 1);
    assert.equal((await sdk.sandbox.execution(execution.id)).execution.cleanup, "owned-guest-stopped");
    const calls = (await sdk.budgets.calls()).calls;
    assert.equal(calls.length, 1); assert.equal(calls[0]?.status, "settled"); assert.equal(calls[0]?.reportedTokens, 42);
    assert.equal(provider.requests.length, 0);
    assert.deepEqual(session().messages, messages, "Late model output cannot replace the original partial UI fragments.");
    assert.equal(restarted.controller.events(0).filter((event) => event.turn_id === execution.turnId && event.event_type === "model.completed").length, 0,
      "Late receipts never create a completed model message eligible for normal solver context.");
    await sdk.sandbox.reconcile(execution.id);
    assert.equal((await sdk.budgets.dashboard()).totals.calls, 1);
    assert.equal((await sdk.budgets.dashboard()).totals.reportedTokens, 42);
    passed = true;
  } finally {
    sdk.disconnect(); await runtime.stop(); await restarted?.close(); await provider.close();
    if (passed) await rm(root, { recursive: true, force: true });
    else console.error("Generated native crash diagnostics retained:", root);
  }
});
