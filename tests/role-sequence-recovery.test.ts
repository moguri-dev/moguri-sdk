import test from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { join, resolve } from "node:path";
import { rm } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { MoguriSdk, isRecord, parse, RoleSequenceRecordSchema, type Connection, type RoleSequenceRecord } from "../packages/sdk/src/index.ts";
import { startService } from "../apps/service/src/server.ts";
import { ManagedWorkspaces } from "../apps/service/src/managed-workspaces.ts";
import { fixtureProvider, GENERATED_RETENTION_KEY } from "./fixture.ts";
import { ciTime } from "./fixtures/time-scale.ts";

test("actual controller SIGKILL preserves role metadata before/after admission and retained output without paid/root replay", { timeout: ciTime(45_000) }, async (t) => {
  for (const phase of ["pending", "started", "recorded", "completed"] as const) {
    const startedAt = performance.now(), child = fork(resolve("tests/fixtures/role-sequence-child.ts"), [], { execPath: process.execPath, execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "pipe", "ipc"] });
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    let directory: string | undefined, restarted: Awaited<ReturnType<typeof startService>> | undefined;
    const provider = await fixtureProvider(); let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const ready = new Promise<{ connection: Connection; directory: string; sequence: RoleSequenceRecord }>((resolve, reject) => {
        timer = setTimeout(() => reject(new Error("Generated role child did not publish its retained phase.")), 8000);
        child.once("error", reject);
        child.once("message", (raw: unknown) => {
          clearTimeout(timer);
          if (!isRecord(raw) || typeof raw.directory !== "string" || !isRecord(raw.connection) || raw.requests !== 0) { reject(new Error("Invalid generated role recovery metadata.")); return; }
          const connection = raw.connection;
          if (typeof connection.baseUrl !== "string" || typeof connection.wsUrl !== "string" || typeof connection.token !== "string" || typeof connection.pid !== "number" || typeof connection.protocolVersion !== "number") { reject(new Error("Generated role connection is incomplete.")); return; }
          resolve({ directory: raw.directory, sequence: parse(RoleSequenceRecordSchema, raw.sequence),
            connection: { baseUrl: connection.baseUrl, wsUrl: connection.wsUrl, token: connection.token, pid: connection.pid, protocolVersion: connection.protocolVersion } });
        });
      });
      child.send({ phase }); const original = await ready; directory = original.directory;
      child.kill("SIGKILL"); await exited;
      const root = t.mock.method(ManagedWorkspaces.prototype, "project", () => { throw new Error("Role metadata recovery must not probe a checkout."); });
      const model = t.mock.method(provider.provider, "prepare", async () => { throw new Error("Role metadata recovery must not prepare inference."); });
      const keys = new Map<string, string>(), vault = { read: async (id: string) => keys.get(id) ?? null, write: async (id: string, value: string) => { keys.set(id, value); }, remove: async (id: string) => { keys.delete(id); } };
      restarted = await startService({ stateDir: join(directory, "state"), provider: provider.provider, retentionKey: GENERATED_RETENTION_KEY, platform: { terminal: { vault } } });
      const current = await new MoguriSdk(restarted.connection).ready();
      try {
        const recovered = (await current.roleSequences.read(original.sequence.id, 0)).sequence;
        assert.equal(recovered.status, phase === "completed" ? "completed" : "partial");
        assert.equal(recovered.steps[0]?.state, phase === "started" ? "unconfirmed" : phase === "pending" ? "pending" : "recorded");
        assert.equal(recovered.steps[0]?.stepId, original.sequence.steps[0]?.stepId);
        const status = (await current.budgets.status(original.sequence.sessionId)).status;
        assert.equal(status.totals.calls, phase === "pending" ? 0 : phase === "completed" ? 2 : 1);
        assert.equal(status.totals.plannedHolds, 0); assert.equal(status.totals.heldTokens, phase === "started" ? 164 : 0);
        assert.equal(status.totals.reportedTokens, phase === "started" ? null : phase === "pending" ? 0 : phase === "completed" ? 84 : 42);
        assert.deepEqual(restarted.controller.platform.roles.original(original.sequence.commandId, original.sequence.commandDigest), { id: original.sequence.id, revision: recovered.revision });
        assert.equal(root.mock.callCount(), 0); assert.equal(model.mock.callCount(), 0); assert.equal(provider.requests.length, 0);
        console.log(JSON.stringify({ primitive: "actual-role-metadata-controller-sigkill", phase, ms: performance.now() - startedAt, replay: false, productionCompound: false }));
      } finally { current.disconnect(); }
    } finally {
      clearTimeout(timer); if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await exited; }
      await restarted?.close(); t.mock.restoreAll(); await provider.close(); if (directory) await rm(directory, { recursive: true, force: true });
    }
  }
});
