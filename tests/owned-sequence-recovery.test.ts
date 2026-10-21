import test from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { join, resolve } from "node:path";
import { rm } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { isRecord, MoguriSdk, parse, RoleSequenceRecordSchema, type RoleSequenceRecord } from "../packages/sdk/src/index.ts";
import { ManagedWorkspaces } from "../apps/service/src/managed-workspaces.ts";
import { startService } from "../apps/service/src/server.ts";
import { GENERATED_RETENTION_KEY, fixtureProvider } from "./fixture.ts";

test("actual owned-role controller SIGKILL before dispatch, in inference, after result retention and after completion never replays a role or probes source", { skip: process.platform !== "darwin", timeout: 90_000 }, async (t) => {
  for (const contracts of [false, true]) for (const phase of ["pending", "inflight", "recorded", "completed"] as const) {
    const started = performance.now(), child = fork(resolve("tests/fixtures/owned-sequence-child.ts"), [], { execPath: process.execPath, execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "pipe", "ipc"] });
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    let stderr = "", directory: string | undefined, reopened: Awaited<ReturnType<typeof startService>> | undefined, timer: ReturnType<typeof setTimeout> | undefined;
    const provider = await fixtureProvider();
    child.stderr?.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-4000); });
    try {
      const ready = new Promise<{ directory: string; sequence: RoleSequenceRecord; requests: number }>((resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`Actual role recovery child did not retain ${phase}: ${stderr}`)), 15_000);
        child.once("error", reject);
        child.once("message", (raw: unknown) => {
          clearTimeout(timer);
          if (!isRecord(raw) || typeof raw.directory !== "string" || typeof raw.requests !== "number") { reject(new Error("Generated actual-role phase metadata is invalid.")); return; }
          resolve({ directory: raw.directory, sequence: parse(RoleSequenceRecordSchema, raw.sequence), requests: raw.requests });
        });
      });
      child.send({ phase, contracts }); const original = await ready; directory = original.directory;
      const completeCalls = contracts ? 4 : 3;
      assert.equal(original.requests, phase === "pending" ? 0 : phase === "completed" ? completeCalls : 1);
      child.kill("SIGKILL"); await exited;
      const roots = t.mock.method(ManagedWorkspaces.prototype, "project", () => { throw new Error("Owned role recovery cannot resolve its original checkout."); });
      const models = t.mock.method(provider.provider, "prepare", async () => { throw new Error("Owned role recovery cannot prepare another model."); });
      reopened = await startService({ stateDir: join(directory, "state"), provider: provider.provider, retentionKey: GENERATED_RETENTION_KEY });
      const sdk = await new MoguriSdk(reopened.connection).ready();
      try {
        const read = await sdk.roleSequences.read(original.sequence.id, 0), sequence = read.sequence;
        assert.equal(sequence.status, phase === "completed" ? "completed" : "partial");
        assert.equal(sequence.steps[0]?.state, phase === "pending" ? "pending" : phase === "inflight" ? "unconfirmed" : "recorded");
        assert.equal(sequence.steps[0]?.stepId, original.sequence.steps[0]?.stepId);
        assert.equal(read.step?.result !== null, phase === "recorded" || phase === "completed");
        const status = (await sdk.budgets.status(sequence.sessionId)).status;
        assert.equal(status.totals.calls, original.requests); assert.equal(status.totals.plannedHolds, 0);
        assert.equal(status.totals.reportedTokens, phase === "pending" ? 0 : phase === "inflight" ? null : phase === "recorded" ? 42 : completeCalls * 42);
        if (phase === "inflight") assert.ok(status.totals.heldTokens! > 0); else assert.equal(status.totals.heldTokens, 0);
        assert.deepEqual(reopened.controller.platform.roles.original(sequence.commandId, sequence.commandDigest), { id: sequence.id, revision: sequence.revision });
        assert.equal(roots.mock.callCount(), 0); assert.equal(models.mock.callCount(), 0); assert.equal(provider.requests.length, 0);
        assert.equal(JSON.parse((await sdk.artifacts.export(sequence.id)).export.text).schemaVersion, 4);
        if (contracts) {
          const contract = await sdk.roleSequences.contract(sequence.id, 0);
          assert.equal(sequence.inputVersion, 2); assert.equal(contract.inputVersion, 2);
          assert.equal(contract.result.status, phase === "recorded" || phase === "completed" ? "valid" : "invalid");
        }
        console.log(JSON.stringify({ primitive: "actual-owned-role-controller-sigkill", phase, ms: performance.now() - started,
          inputVersion: contracts ? 2 : 1, originalRequests: original.requests, restartedRequests: provider.requests.length, productionCompound: false }));
      } finally { sdk.disconnect(); }
    } finally {
      clearTimeout(timer);
      if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await exited; }
      await reopened?.close(); t.mock.restoreAll(); await provider.close();
      if (directory) await rm(directory, { recursive: true, force: true });
    }
  }
});
