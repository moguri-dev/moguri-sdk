import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, realpath, copyFile, symlink, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "esbuild";
import { EventStore, digest } from "../../apps/service/src/store.ts";
import { RemoteRuntime } from "../../apps/service/src/remote.ts";
import { frameDigest } from "../../apps/service/src/worker-wire.ts";
import { WorkerRequestSchema, type WorkerRequest } from "../../apps/service/src/worker-protocol.ts";
import { PROTOCOL_VERSION, parse, type EventInput, type RemoteExecution } from "../../packages/protocol/src/index.ts";
import type { BridgeStatus } from "../../apps/service/src/remote-protocol.ts";
import type { WorkerFrame } from "../../apps/service/src/worker-connection.ts";
import { createSshTarget } from "./ssh-target.ts";
import { waitFor } from "../fixture.ts";
import type { FolderPolicy } from "../../apps/service/src/project-policy.ts";
import { ciTime } from "./time-scale.ts";

interface PrimitiveResult {
  execution: RemoteExecution; frames: WorkerFrame[]; writes: Extract<WorkerRequest, { kind: "tool.complete" }>[];
  terminal: Extract<WorkerRequest, { kind: "finished" }> | null; modelRequests: number;
}
export async function remotePlanPrimitive() {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "moguri-generated-plan-primitive-")));
  const bridge = join(directory, "bridge"), host = join(directory, "host"), sshRoot = join(directory, "ssh"), workspace = join(directory, "remote"), local = join(directory, "local");
  for (const path of [bridge, host, sshRoot, workspace, local]) await mkdir(path, { mode: 0o700 });
  for (const path of [workspace, local]) await mkdir(join(path, "docs"));
  const original = "Generated original Remote plan.\n", text = "Generated exact Remote plan replacement.\n";
  await writeFile(join(workspace, "docs/plan.md"), original); await writeFile(join(local, "docs/plan.md"), "Generated untouched Local plan.\n");
  await copyFile(resolve("dist/remote-bridge.mjs"), join(bridge, "remote-bridge.mjs"));
  await symlink(resolve("node_modules"), join(bridge, "node_modules"), "dir");
  const workerPath = join(bridge, "worker.mjs");
  await build({ entryPoints: [resolve("tests/fixtures/remote-plan-worker.ts")], outfile: workerPath, bundle: true, platform: "node", target: "node26", format: "esm", packages: "external", logLevel: "silent",
    banner: { js: "import {createRequire as __fixtureCreateRequire} from 'node:module';const require=__fixtureCreateRequire(import.meta.url);" } });
  const ssh = await createSshTarget(sshRoot), target = { ...ssh.target, command: [process.execPath, join(bridge, "remote-bridge.mjs")], allowCopilot: false };
  const secrets = new Map<string, string>();
  const runtime = new RemoteRuntime(host, () => target, workerPath, { vault: {
    read: async (id) => secrets.get(id) ?? null, write: async (id, value) => { secrets.set(id, value); }, remove: async (id) => { secrets.delete(id); },
  } });
  const store = new EventStore(join(host, "events.sqlite"), Buffer.alloc(32, 0x68), "generated-plan-primitive-key");
  const executions = new Set<string>();
  const inspect = async (execution: RemoteExecution) => {
    const key = secrets.get(execution.id); if (!key) throw new Error("Generated inspection key is missing.");
    const result = await runtime.query(target, { action: "inspect", protocol: PROTOCOL_VERSION, workerDigest: execution.workerDigest, root: execution.workspace,
      stateDir: target.stateDir, runId: execution.id, key, after: 0 }, AbortSignal.timeout(8000));
    if (result.kind !== "inspection") throw new Error("Generated mutation inspection returned another operation.");
    return result;
  };
  const close = async () => {
    try { await runtime.close(); }
    finally { try { await ssh.close(); } finally { store.close(); await rm(directory, { recursive: true, force: true }); } }
  };
  try {
    await runtime.probe();
    return { directory, workspace, local, original, text, store, inspect, close,
      run: async (options: { stopBeforeAuthorization?: boolean; stopAfterWrite?: boolean; loseResultAcknowledgement?: boolean; folders?: FolderPolicy } = {}): Promise<PrimitiveResult> => {
        const id = randomUUID(), step = { path: "docs/plan.md", text, expectedDigest: digest(original) };
        const execution: RemoteExecution = { id, sessionId: "generated-plan-session", projectId: "generated-plan-project", turnId: id, target, workspace,
          workerDigest: runtime.readiness.workerDigest!, configDigest: frameDigest(target), createdAt: new Date().toISOString(), status: "launching",
          cancellation: "none", cleanup: "pending", diagnostic: null, lastSequence: 0, workerPid: null };
        if (executions.has(id)) throw new Error("Generated run identity was reused."); executions.add(id);
        let status: BridgeStatus | undefined, failure: unknown, disconnected = false, modelRequests = 0;
        const frames: WorkerFrame[] = [], writes: Extract<WorkerRequest, { kind: "tool.complete" }>[] = [];
        let terminal: Extract<WorkerRequest, { kind: "finished" }> | null = null;
        const connection = runtime.launch(execution, (value) => { status = value; });
        const metadata = { profile_id: "default", session_id: execution.sessionId, project_id: execution.projectId, turn_id: id };
        connection.events.on("error", (error) => { if (!options.loseResultAcknowledgement) failure = error; });
        connection.events.on("exit", () => { disconnected = true; });
        connection.events.on("message", (raw, frame) => {
          try {
            const request = parse(WorkerRequestSchema, raw);
            if (!frame || frame.executionId !== id) throw new Error("Generated mutation lost its exact owned frame.");
            frames.push(frame);
            const events: EventInput[] = [];
            if (request.kind === "approval") {
              if (request.call.name !== "write_file" || frameDigest(request.call.arguments) !== frameDigest(step)) throw new Error("Generated mutation arguments changed before authorization.");
              if (options.stopBeforeAuthorization) connection.send({ kind: "stop" });
              else {
                events.push({ ...metadata, event_type: "tool.started", step_id: request.stepId, payload: { call: request.call } });
              }
            } else if (request.kind === "tool.complete") {
              writes.push(request);
              events.push({ ...metadata, step_id: request.stepId, event_type: "tool.completed", payload: { call: request.call, text: request.text, isError: request.isError, outcome: request.outcome } });
            } else if (request.kind === "finished") terminal = request;
            else if (request.kind === "boundary" || request.kind === "model.complete") { modelRequests++; throw new Error("Generated deterministic plan mutation attempted a model request."); }
            store.commit([...events, { ...metadata, event_type: "execution.frame_recorded", payload: frame }]);
            if (request.kind === "tool.complete" && options.loseResultAcknowledgement) { connection.kill("SIGTERM"); return; }
            if (request.kind === "tool.complete" && options.stopAfterWrite) connection.send({ kind: "stop" });
            if (request.kind === "approval" && !options.stopBeforeAuthorization) connection.send({ kind: "reply", requestId: request.requestId, value: { allow: true, mode: "agent", folders: options.folders ?? { denied: [], readOnly: [] } } });
            if (request.kind === "tool.complete" || request.kind === "finished") connection.send({ kind: "reply", requestId: request.requestId, value: { accepted: true } });
            connection.acknowledge?.(frame.sequence);
          } catch (error) { failure = error; connection.kill("SIGTERM"); }
        });
        connection.send({ kind: "start", root: workspace, context: [{ role: "user", content: JSON.stringify(step), timestamp: Date.now() }], readOnly: false });
        await waitFor(() => {
          if (failure) throw failure;
          return options.loseResultAcknowledgement ? disconnected : terminal && status?.cleanup === "owned-worker-stopped";
        }, 12_000);
        if (options.loseResultAcknowledgement) {
          const deadline = Date.now() + ciTime(8000);
          while (Date.now() < deadline) { const saved = await inspect(execution); if (saved.status.cleanup !== "pending") break; await new Promise((resolve) => setTimeout(resolve, 25)); }
        }
        return { execution, frames, writes, terminal, modelRequests };
      } };
  } catch (error) {
    try { await close(); } catch (cleanup) { throw new AggregateError([error, cleanup], "Generated SSH mutation setup and cleanup failed."); }
    throw error;
  }
}
