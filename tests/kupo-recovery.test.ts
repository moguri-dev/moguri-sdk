import test from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { access, readFile, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { startService } from "../apps/service/src/server.ts";
import { isRecord, MoguriSdk } from "../packages/sdk/src/index.ts";
import { fixtureProvider, GENERATED_RETENTION_KEY } from "./fixture.ts";

for (const schema of ["current", "automatic-61"] as const) test(`actual ${schema} controller SIGKILL during gate or selected-response approval never replays paid calls or proposed tools`, { skip: process.platform !== "darwin", timeout: 35_000 }, async () => {
  for (const phase of ["gate", "selected"] as const) {
    const child = fork(fileURLToPath(new URL("./fixtures/kupo-child.ts", import.meta.url)), [], { execArgv: ["--import", "tsx"], stdio: ["ignore", "pipe", "pipe", "ipc"] });
    const provider = await fixtureProvider({ responseMode: "text" });
    let errors = "", directory: string | undefined, service: Awaited<ReturnType<typeof startService>> | undefined, sdk: MoguriSdk | undefined;
    child.stderr?.on("data", (data) => { errors = (errors + data).slice(-8192); });
    try {
      const ready = new Promise<unknown>((resolve, reject) => {
        child.once("message", resolve); child.once("error", reject);
        child.once("exit", () => reject(new Error(`Generated Kupo controller exited before the owned phase: ${errors}`)));
      });
      child.send({ phase }); const value = await ready;
      assert.ok(isRecord(value) && typeof value.directory === "string" && typeof value.project === "string" &&
        typeof value.sessionId === "string" && typeof value.turnId === "string" && typeof value.originalCalls === "number");
      directory = value.directory;
      const project = value.project;
      assert.ok(basename(directory).startsWith("moguri-generated-"));
      const exited = once(child, "exit"); child.kill("SIGKILL"); await exited;
      if (schema === "automatic-61") {
        const raw = new DatabaseSync(join(directory, "state", "state.sqlite"));
        try {
          raw.exec("BEGIN IMMEDIATE; DELETE FROM retention_metadata WHERE id IN ('retained_telemetry_schema','session_reliability_schema','kanban_interactions_schema','session_kupo_kanban_schema','project_kanban_schema','session_github_workflows_schema','session_github_convergence_schema'); PRAGMA user_version=61; COMMIT");
        } finally { raw.close(); }
      }
      service = await startService({ stateDir: join(directory, "state"), provider: provider.provider, retentionKey: GENERATED_RETENTION_KEY });
      sdk = await new MoguriSdk(service.connection).ready();
      const state = service.controller.snapshot(), session = state.sessions.find((session) => session.id === value.sessionId)!;
      assert.equal(session.status, "partial");
      assert.equal(session.pendingApproval, null);
      assert.equal(sdk.routing.history(session.id)[0]?.status, "partial");
      assert.equal(state.budgetEntries.length, value.originalCalls);
      assert.equal(provider.requests.length, 0);
      assert.equal(service.controller.events(0).filter((event) => event.event_type === "model.started" && event.turn_id === value.turnId).length, value.originalCalls);
      assert.equal(service.controller.events(0).filter((event) => event.event_type === "routing.response_selected").length, phase === "gate" ? 0 : 1);
      assert.equal(service.controller.events(0).some((event) => event.event_type === "tool.started"), false);
      if (phase === "gate") {
        assert.equal(state.budgetEntries.at(-1)?.status, "unknown");
        assert.ok(state.budgetEntries.at(-1)!.reservedTokens! > 0);
      }
      const selected = service.controller.events(0).find((event) => event.event_type === "routing.response_selected");
      if (selected?.event_type === "routing.response_selected") assert.match(service.store.blob(selected.payload.contextDigest), /unselected\.txt/);
      assert.equal(await readFile(join(project, "fixture.txt"), "utf8"), "generated original\n");
      await assert.rejects(() => access(join(project, "unselected.txt")), { code: "ENOENT" });
    } finally {
      sdk?.disconnect(); await service?.close(); await provider.close();
      if (child.exitCode === null && child.signalCode === null) { const exited = once(child, "exit"); child.kill("SIGKILL"); await exited; }
      if (directory) await rm(directory, { recursive: true, force: true });
    }
  }
});
