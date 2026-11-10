import assert from "node:assert/strict";
import test from "node:test";
import { fork } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { Type } from "typebox";
import { MoguriSdk, parse, type Command } from "../packages/sdk/src/index.ts";
import { startService } from "../apps/service/src/server.ts";
import { digest } from "../apps/service/src/store.ts";
import { fixtureProvider, GENERATED_RETENTION_KEY, waitFor } from "./fixture.ts";

const ReadySchema = Type.Object({ kind: Type.Literal("ready"), directory: Type.String(), project: Type.String(), home: Type.String(),
  sessionId: Type.String(), connection: Type.Object({ protocolVersion: Type.Integer(), baseUrl: Type.String(), wsUrl: Type.String(),
    token: Type.String(), pid: Type.Integer(), storeId: Type.Optional(Type.String()) }, { additionalProperties: false }),
  requests: Type.Integer(), budget: Type.Array(Type.Unknown()) }, { additionalProperties: false });
for (const phase of ["capture", "restore"] as const) test(`actual SIGKILL during ${phase} preserves original intent/data and restarts without historical fabrication or effect replay`, { timeout: 30000 }, async () => {
  const child = fork(fileURLToPath(new URL("./fixtures/checkpoint-crash.ts", import.meta.url)), [phase],
    { execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "pipe", "ipc"] });
  const exited = once(child, "exit"); let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString("utf8")).slice(-32768); });
  let directory: string | undefined, sdk: MoguriSdk | undefined, reopened: MoguriSdk | undefined;
  let service: Awaited<ReturnType<typeof startService>> | undefined, provider: Awaited<ReturnType<typeof fixtureProvider>> | undefined, passed = false;
  try {
    const [message] = await Promise.race([once(child, "message"), exited.then(() => { throw new Error(`Generated crash child exited before setup: ${stderr}`); })]);
    const ready = parse(ReadySchema, message); directory = ready.directory;
    assert.ok(relative(tmpdir(), ready.directory).split("/")[0]?.startsWith("moguri-generated-"));
    sdk = await new MoguriSdk(ready.connection).ready();
    let command: Command | undefined, pending: Promise<void> | undefined;
    const commandId = crypto.randomUUID();
    if (phase === "capture") child.send("capture");
    else {
      const checkpoint = (await sdk.checkpoints.list(ready.sessionId)).checkpoints[0]!;
      const { preview } = await sdk.checkpoints.preview(ready.sessionId, checkpoint.id, "workspace");
      assert.deepEqual(preview.blockers, []);
      command = { type: "rewind.apply", sessionId: ready.sessionId, checkpointId: checkpoint.id, mode: "workspace",
        expectedDigest: preview.digest, decisions: [], confirm: true };
      pending = assert.rejects(() => sdk!.command(command!, commandId), /unknown|confirmed|disconnected|fetch|socket|closed/i);
    }
    await waitFor(() => existsSync(join(ready.directory, "generated-checkpoint-crash-boundary")), 10000);
    child.kill("SIGKILL"); await exited; sdk.disconnect(); sdk = undefined; await pending;
    provider = await fixtureProvider({ responseMode: "text" });
    if (phase === "capture") provider.provider.state = { status: "disconnected", models: [], login: null, diagnostic: "Generated post-crash provider remains disconnected." };
    service = await startService({ stateDir: join(ready.directory, "state"), provider: provider.provider, retentionKey: GENERATED_RETENTION_KEY,
      platform: { terminal: { defaultRoot: ready.home } } });
    reopened = await new MoguriSdk(service.connection).ready();
    assert.deepEqual(service.controller.snapshot().budgetEntries, ready.budget);
    assert.equal(provider.requests.length, 0);
    if (phase === "capture") {
      assert.deepEqual((await reopened.checkpoints.list(ready.sessionId)).checkpoints, []);
      const session = service.controller.snapshot().sessions.find((session) => session.id === ready.sessionId)!;
      assert.equal(session.turnId, null); assert.equal(session.queue.length, 1);
      assert.equal(await readFile(join(ready.project, "generated.txt"), "utf8"), "Generated original.");
      assert.equal(service.controller.events(0).some((event) => event.event_type === "turn.started"), false);
    } else {
      const record = service.controller.snapshot().rewinds[0]!;
      assert.equal(record.status, "partial"); assert.equal(record.quarantined, true);
      assert.equal(await readFile(join(ready.project, "generated.txt"), "utf8"), "Generated original.");
      const inspected = await reopened.checkpoints.inspect(ready.sessionId, record.id);
      assert.equal(inspected.operationSettled, true); assert.equal(inspected.effects[0]?.backupDigest, digest("Generated owned change."));
      assert.equal(service.controller.events(0).some((event) => event.event_type === "session.rewound"), false);
      await assert.rejects(() => reopened!.command(command!, commandId), /original.*rewind|already|recorded|stale|retained/i);
      assert.equal(service.controller.snapshot().rewinds.length, 1);
      await reopened.checkpoints.acknowledge(ready.sessionId, record.id, record.revision, inspected.digest);
      assert.equal(service.controller.snapshot().rewinds[0]?.status, "partial");
      assert.equal(service.controller.snapshot().rewinds[0]?.quarantined, false);
      assert.deepEqual(service.controller.snapshot().budgetEntries, ready.budget);
    }
    passed = true;
  } finally {
    sdk?.disconnect(); reopened?.disconnect(); await service?.close(); await provider?.close();
    if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await exited; }
    if (passed && directory) await rm(directory, { recursive: true, force: true });
    else if (directory) console.error("Generated checkpoint crash diagnostics retained:", directory, stderr);
  }
});
