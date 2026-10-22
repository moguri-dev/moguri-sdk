import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { readFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { basename, join } from "node:path";
import { test } from "node:test";
import { startService } from "../apps/service/src/server.ts";
import { CommandSchema, isRecord, MoguriSdk, parse } from "../packages/sdk/src/index.ts";
import { fixtureProvider, GENERATED_RETENTION_KEY, waitFor } from "./fixture.ts";

test("actual public controller SIGKILL retains unknown calls and test intent without replay, stale approval or candidate reset", { skip: process.platform !== "darwin", timeout: 45000 }, async () => {
  for (const phase of ["inflight", "review", "validation"] as const) {
    const child = fork(fileURLToPath(new URL("./fixtures/compound-child.ts", import.meta.url)), [], { execArgv: ["--import", "tsx"], stdio: ["ignore", "pipe", "pipe", "ipc"] });
    let errors = ""; child.stderr?.on("data", (data) => { errors = (errors + data).slice(-8192); });
    const provider = await fixtureProvider({ responseMode: "text" });
    let service: Awaited<ReturnType<typeof startService>> | undefined, sdk: MoguriSdk | undefined, directory: string | undefined;
    try {
      const ready = new Promise<unknown>((resolve, reject) => {
        child.once("message", resolve); child.once("exit", () => reject(new Error(`Generated public controller exited before its owned phase: ${errors}`))); child.once("error", reject);
      });
      child.send({ phase }); const value = await ready;
      assert.ok(isRecord(value) && typeof value.directory === "string" && typeof value.stateDir === "string" && typeof value.project === "string" &&
        typeof value.sessionId === "string" && typeof value.workflowId === "string" && typeof value.commandId === "string" && typeof value.originalCalls === "number" && typeof value.stageId === "string" && isRecord(value.command));
      directory = value.directory;
      assert.ok(basename(directory).startsWith("moguri-generated-"));
      const workflowId = value.workflowId, command = parse(CommandSchema, { id: value.commandId, profileId: "default", command: value.command });
      const exit = once(child, "exit"); child.kill("SIGKILL"); await exit;
      service = await startService({ stateDir: value.stateDir, provider: provider.provider, retentionKey: GENERATED_RETENTION_KEY });
      sdk = await new MoguriSdk(service.connection).ready();
      const read = await sdk.compound.read(value.workflowId);
      assert.equal(read.workflow.status, "partial"); assert.equal(service.controller.snapshot().budgetEntries.length, value.originalCalls);
      assert.equal(service.controller.events(0).filter((event) => event.event_type === "model.started" && event.turn_id === value.workflowId).length, value.originalCalls);
      assert.equal(service.controller.snapshot().jobs.some((job) => job.parentTurnId === value.workflowId && job.status === "running"), false);
      assert.equal(read.pendingValidation, null); assert.equal(provider.requests.length, 0);
      assert.equal(await readFile(join(value.project, "fixture.txt"), "utf8"), "generated original\n");
      if (phase === "inflight") {
        assert.equal(read.workflow.steps[0]?.state, "unconfirmed");
        assert.equal(service.controller.snapshot().budgetEntries[0]?.status, "unknown");
        assert.ok(service.controller.snapshot().budgetEntries[0]!.reservedTokens! > 0);
      } else {
        const validation = read.workflow.validations[0]!;
        await assert.rejects(() => sdk!.compound.review(workflowId, validation.id, read.workflow.revision, validation.reviewDigest, true), /current|changed|stopped|owner|ended/i);
        assert.ok(service.controller.snapshot().budgetPlans.filter((plan) => plan.role === "escalation").every((plan) => plan.status === "released"));
        if (phase === "validation") {
          assert.equal(validation.dispatched, true); assert.equal(validation.status, "partial");
          assert.equal(service.controller.snapshot().blockedWorkspaces.includes(value.stageId), true);
          assert.equal(service.controller.events(0).filter((event) => event.event_type === "process.started" && event.turn_id === value.workflowId).length, 1);
          assert.ok(typeof value.testPid === "number");
          const pid = value.testPid;
          await waitFor(() => { try { process.kill(pid, 0); return false; } catch (error) { if (error instanceof Error && "code" in error && error.code === "ESRCH") return true; throw error; } });
        }
      }
      service.store.db.prepare("DELETE FROM receipts WHERE id=?").run(value.commandId);
      const replay = await sdk.command(command.command, command.id);
      assert.equal(replay.id, value.workflowId); assert.equal(provider.requests.length, 0);
      assert.equal(service.controller.snapshot().budgetEntries.length, value.originalCalls);
    } finally {
      sdk?.disconnect(); await service?.close(); await provider.close();
      if (child.exitCode === null && child.signalCode === null) { const exit = once(child, "exit"); child.kill("SIGKILL"); await exit; }
      if (directory) await rm(directory, { recursive: true, force: true });
    }
  }
});
