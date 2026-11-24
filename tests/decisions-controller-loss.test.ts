import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { rm } from "node:fs/promises";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { startService } from "../apps/service/src/server.ts";
import { isRecord, MoguriSdk } from "../packages/sdk/src/index.ts";
import { fixtureProvider, GENERATED_RETENTION_KEY } from "./fixture.ts";
import { ciTime } from "./fixtures/time-scale.ts";

test("actual controller SIGKILL during decision inference or after clean known result never replays a paid call, grants a tool or downgrades known cleanup/accounting", { skip: process.platform !== "darwin", timeout: ciTime(30000) }, async () => {
  for (const phase of ["inflight", "before-effect"] as const) {
    const child = fork(fileURLToPath(new URL("./fixtures/decisions-child.ts", import.meta.url)), [], { execArgv: ["--import", "tsx"], stdio: ["ignore", "pipe", "pipe", "ipc"] });
    let errors = ""; child.stderr?.on("data", (data) => { errors = (errors + data).slice(-8192); });
    const provider = await fixtureProvider({ responseMode: "text" });
    let service: Awaited<ReturnType<typeof startService>> | undefined, sdk: MoguriSdk | undefined, directory: string | undefined;
    try {
      const ready = new Promise<unknown>((resolve, reject) => { child.once("message", resolve); child.once("exit", () => reject(new Error(`Generated decision controller exited before its owned boundary: ${errors}`))); child.once("error", reject); });
      child.send({ phase }); const value = await ready;
      assert.ok(isRecord(value) && typeof value.directory === "string" && typeof value.stateDir === "string" && typeof value.sessionId === "string" &&
        typeof value.decisionId === "string" && typeof value.inputDigest === "string" && typeof value.originalCalls === "number");
      directory = value.directory; assert.ok(basename(directory).startsWith("moguri-generated-"));
      const exit = once(child, "exit"); child.kill("SIGKILL"); await exit;
      service = await startService({ stateDir: value.stateDir, provider: provider.provider, retentionKey: GENERATED_RETENTION_KEY });
      sdk = await new MoguriSdk(service.connection).ready();
      const record = (await sdk.decisions.read(value.decisionId)).decision;
      assert.equal(record.status, phase === "inflight" ? "partial" : "rejected"); assert.equal(record.inputDigest, value.inputDigest);
      assert.equal(record.applied, null); assert.ok(record.diagnostic);
      assert.equal(record.cleanup, phase === "inflight" ? "unconfirmed" : "owned-worker-stopped");
      const charge = service.controller.snapshot().budgetEntries.find((entry) => entry.id === record.stepId); assert.ok(charge);
      assert.equal(charge.status, phase === "inflight" ? "unknown" : "settled"); assert.equal(charge.reportedTokens, phase === "inflight" ? null : 42);
      if (phase === "inflight") assert.ok(charge.reservedTokens);
      assert.equal(service.controller.snapshot().budgetEntries.length, value.originalCalls); assert.equal(provider.requests.length, 0);
      assert.equal(service.controller.events(0).some((event) => event.event_type === "tool.started"), false);
      assert.equal(service.controller.snapshot().sessions.find((session) => session.id === value.sessionId)?.turnId, null);
      await sdk.decisions.stop(record.id);
      assert.equal(provider.requests.length, 0); assert.equal(service.controller.snapshot().budgetEntries.length, value.originalCalls);
    } finally {
      sdk?.disconnect(); await service?.close(); await provider.close();
      if (child.exitCode === null && child.signalCode === null) { const exit = once(child, "exit"); child.kill("SIGKILL"); await exit; }
      if (directory) await rm(directory, { recursive: true, force: true });
    }
  }
});
