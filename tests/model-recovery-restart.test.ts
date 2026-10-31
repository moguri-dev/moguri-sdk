import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { MoguriSdk, retryFailure } from "../packages/sdk/src/index.ts";
import { startService } from "../apps/service/src/server.ts";
import { setupFixture, waitFor, type GeneratedProviderOptions } from "./fixture.ts";
import { GeneratedIntakeClock } from "./fixtures/intake-clock.ts";
import { launchRuntimeChild } from "./fixtures/runtime-process.ts";

for (const phase of ["undispatched", "missed-rounds", "unknown-attempt"] as const) {
  test(`actual controller SIGKILL preserves ${phase} recovery ownership without input/effect replay`, { skip: process.platform !== "darwin", timeout: 25_000 }, async () => {
    const clock = new GeneratedIntakeClock(), configuration: GeneratedProviderOptions & { platform: { intakeClock: GeneratedIntakeClock } } = {
      httpFailure: { status: 408, message: "Generated exact recovery crash.", ...(phase !== "missed-rounds" ? { remaining: 1 } : {}) },
      responseMode: "text", maxOutputTokens: 128, platform: { intakeClock: clock },
    };
    const fixture = await setupFixture(configuration), stateDir = join(fixture.directory, "state");
    let runtime: Awaited<ReturnType<typeof launchRuntimeChild>> | undefined;
    let service: Awaited<ReturnType<typeof startService>> | undefined, sdk: MoguriSdk | undefined;
    try {
      await fixture.configure(); await fixture.send("Generated original crash-safe model request."); await fixture.terminal();
      const original = fixture.service.controller.snapshot().modelFailures[0]!, cycle = fixture.service.controller.snapshot().modelRecoveryCycle!;
      const hold = fixture.service.controller.snapshot().budgetEntries[0]!.reservedTokens!;
      await fixture.service.close();
      if (phase === "unknown-attempt") configuration.respond = () => ({ text: "Generated incomplete owned retry.", hold: true });
      runtime = await launchRuntimeChild({ stateDir, vaultPath: join(fixture.directory, "generated-vault.json"), modelId: fixture.modelId,
        baseUrl: fixture.baseUrl, homeRoot: fixture.home, modelInfo: fixture.provider.state.models[0], intakeAt: "2030-01-01T10:00:10.000Z" });
      sdk = await new MoguriSdk(runtime.connection).ready();
      assert.equal(sdk.getState().snapshot!.modelFailures[0]?.requestDigest, original.requestDigest);
      assert.equal(sdk.getState().snapshot!.modelRecoveryCycle?.startedAt, cycle.startedAt);
      const draftRevision = sdk.getState().snapshot!.sessions.find((session) => session.id === fixture.sessionId)!.draft.revision;
      await sdk.command({ type: "draft.save", sessionId: fixture.sessionId, expectedRevision: draftRevision, text: "Generated newer crash-surviving draft.", attachments: [] });
      if (phase === "unknown-attempt") {
        runtime.child.send({ kind: "intake.advance", ms: 20_000 });
        await waitFor(() => runtime?.intakeInstant === "2030-01-01T10:00:30.000Z" && fixture.requests.length === 2);
        await waitFor(() => sdk!.getState().snapshot!.modelFailures[0]?.attemptStepId);
      }
      runtime.child.kill("SIGKILL"); await runtime.exited; sdk.disconnect();
      const restartedClock = new GeneratedIntakeClock(phase === "missed-rounds" ? "2030-01-01T10:02:00.000Z" : phase === "unknown-attempt" ? "2030-01-01T10:00:31.000Z" : "2030-01-01T10:00:10.000Z");
      service = await startService({ stateDir, provider: fixture.provider, retentionKey: fixture.retentionKey,
        platform: { intakeClock: restartedClock, terminal: { defaultRoot: fixture.home, vault: fixture.terminalVault } } });
      sdk = await new MoguriSdk(service.connection).ready();
      const current = () => service!.controller.snapshot(), session = () => current().sessions.find((entry) => entry.id === fixture.sessionId)!;
      assert.equal(session().draft.text, "Generated newer crash-surviving draft.");
      assert.equal(current().modelFailures[0]?.requestDigest, original.requestDigest);
      assert.equal(current().budgetEntries[0]?.status, "unknown"); assert.equal(current().budgetEntries[0]?.reservedTokens, hold);
      if (phase === "unknown-attempt") {
        assert.equal(session().status, "partial"); assert.equal(current().modelFailures[0]?.status, "blocked");
        assert.equal(current().modelFailures[0]?.lastRetryable, false); assert.equal(retryFailure(session(), current().modelFailures), undefined);
        await assert.rejects(async () => sdk!.sessions.retry(session().id, original.id), /not eligible|not settled/);
        restartedClock.advanceBy(500_000);
        assert.equal(fixture.requests.length, 2); assert.equal(current().budgetEntries.length, 2);
        assert.ok(current().budgetEntries.every((entry) => entry.status === "unknown" && entry.reservedTokens! > 0));
      } else {
        restartedClock.advanceBy(phase === "missed-rounds" ? 0 : 19_999);
        if (phase === "undispatched") assert.equal(fixture.requests.length, 1);
        if (phase === "undispatched") restartedClock.advanceBy(1);
        await waitFor(() => fixture.requests.length === 2 && !session().turnId);
        assert.deepEqual(fixture.requests[0]!.messages, fixture.requests[1]!.messages);
        if (phase === "missed-rounds") {
          assert.equal(current().modelRecoveryCycle?.round, 3); assert.deepEqual(current().modelRecoveryCycle?.skippedRounds, [0, 1]);
          assert.equal(current().modelRecoveryCycle?.roundAt, "2030-01-01T10:02:00.000Z");
          restartedClock.advanceBy(59_999); assert.equal(fixture.requests.length, 2);
          restartedClock.advanceBy(1); await waitFor(() => fixture.requests.length === 3 && !session().turnId);
          assert.equal(current().modelRecoveryCycle?.status, "exhausted");
        } else {
          assert.equal(session().status, "completed"); assert.equal(current().modelFailures[0]?.status, "recovered");
          assert.equal(current().modelRecoveryCycle?.generation, 1);
        }
      }
      assert.equal(session().messages.filter((message) => message.role === "user").length, 1);
      assert.equal(service.controller.events(0).some((event) => event.event_type === "tool.started"), false);
      assert.equal(session().draft.text, "Generated newer crash-surviving draft.");
    } finally { sdk?.disconnect(); await runtime?.stop(); await service?.close(); await fixture.close(); }
  });
}
