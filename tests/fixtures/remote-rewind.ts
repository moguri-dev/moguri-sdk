import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { defaultProjectSettings, type CheckpointRestorePlan, type CheckpointWorkspace, type RemoteExecution, type RemoteTarget } from "../../packages/protocol/src/index.ts";
import { RemoteRuntime } from "../../apps/service/src/remote.ts";
import { captureRemoteCheckpoint, runRemoteCheckpointRewind, type RemoteCheckpointRewindCallbacks, type RemoteCheckpointScope } from "../../apps/service/src/remote-checkpoint-workspace.ts";
import { frameDigest } from "../../apps/service/src/worker-wire.ts";
import { createSshTarget } from "./ssh-target.ts";

export async function remoteRewindFixture(options: { bundled?: boolean } = {}) {
  const generated = resolve(".test-output", "remote-rewind", randomUUID());
  await mkdir(generated, { recursive: true, mode: 0o700 });
  const root = await realpath(generated), peer = join(root, "peer"), workspace = join(root, "remote-root"), controllerRoot = join(root, "controller-root");
  await Promise.all([mkdir(peer, { mode: 0o700 }), mkdir(workspace), mkdir(controllerRoot, { mode: 0o700 })]);
  await writeFile(join(workspace, "fixture.txt"), "Generated original peer bytes.\n");
  await writeFile(join(controllerRoot, "fixture.txt"), "Generated untouched controller bytes.\n");
  const ssh = await createSshTarget(peer).catch(async (error: unknown) => { await rm(root, { recursive: true, force: true }); throw error; });
  const secrets = new Map<string, string>(), writes: string[] = [];
  let target: RemoteTarget = structuredClone(ssh.target), workerPath = resolve("apps/service/src/worker.ts");
  if (options.bundled) {
    try {
      const { build } = await import("esbuild");
      const directory = join(peer, "installed");
      await mkdir(directory, { mode: 0o700 });
      await build({ entryPoints: { worker: resolve("apps/service/src/worker.ts"), "remote-bridge": resolve("apps/service/src/remote-bridge.ts") },
        outdir: directory, outExtension: { ".js": ".mjs" }, bundle: true, packages: "external", platform: "node", format: "esm", target: "node26", logLevel: "silent" });
      workerPath = join(directory, "worker.mjs"); target.command = [process.execPath, join(directory, "remote-bridge.mjs")];
    } catch (error) { try { await ssh.close(); } finally { await rm(root, { recursive: true, force: true }); } throw error; }
  }
  const vault = {
    read: async (id: string, signal?: AbortSignal) => { signal?.throwIfAborted(); return secrets.get(id) ?? null; },
    write: async (id: string, key: string, signal?: AbortSignal) => { signal?.throwIfAborted(); secrets.set(id, key); writes.push(id); },
    remove: async (id: string) => { secrets.delete(id); },
  };
  let runtime = new RemoteRuntime(controllerRoot, () => target, workerPath, { vault });
  const executions = new Map<string, RemoteExecution>();
  const receipts: Array<{ kind: string; value: unknown }> = [];
  const retain = async (id: string, kind: string, value: unknown) => {
    const record = { kind, value: structuredClone(value) };
    await appendFile(join(controllerRoot, `${id}.jsonl`), `${JSON.stringify(record)}\n`, { mode: 0o600 });
    receipts.push(record);
  };
  try {
    await runtime.probe();
    const settings = { ...defaultProjectSettings(), remotePath: workspace };
    const scope: RemoteCheckpointScope = { profileId: "generated-profile", sessionId: randomUUID(), projectId: randomUUID(), root: workspace,
      identityDigest: frameDigest({ profile: "generated-profile", root: workspace }), target: structuredClone(target),
      workerDigest: runtime.readiness.workerDigest! };
    const callbacks = (id: string, overrides: Partial<RemoteCheckpointRewindCallbacks> = {}): RemoteCheckpointRewindCallbacks => ({
      intent: async (execution) => {
        await mkdir(join(controllerRoot, execution.id), { mode: 0o700 });
        await retain(id, "intent", execution); executions.set(id, execution);
        await overrides.intent?.(execution);
      },
      status: async (execution, frame, request) => {
        await retain(id, "status", { execution, ...(frame ? { frame, request } : {}) }); executions.set(id, execution);
        await overrides.status?.(execution, frame, request);
      },
      boundary: async (index, phase, result) => {
        await retain(id, phase, { index, result: result ?? null }); await overrides.boundary?.(index, phase, result);
      },
      result: async (result) => { await overrides.result?.(result); await retain(id, "result", result); },
    });
    return {
      root, workspace, controllerRoot, ssh, secrets, writes, settings, scope, receipts, executions, workerPath,
      get runtime() { return runtime; },
      setTarget: (next: RemoteTarget) => { target = structuredClone(next); runtime.synchronize(); },
      capture: (signal = AbortSignal.timeout(15_000)) => captureRemoteCheckpoint(runtime, scope, settings, signal),
      run: (plan: CheckpointRestorePlan, overrides: Partial<RemoteCheckpointRewindCallbacks> = {}, signal = AbortSignal.timeout(20_000)) =>
        runRemoteCheckpointRewind(runtime, scope, plan.operationId, plan, settings, signal, callbacks(plan.operationId, overrides)),
      restart: async () => {
        await runtime.close(); runtime = new RemoteRuntime(controllerRoot, () => target, workerPath, { vault });
        await runtime.probe();
      },
      retained: async (id: string) => (await readFile(join(controllerRoot, `${id}.jsonl`), "utf8")).trim().split("\n").map((line) => JSON.parse(line) as { kind: string; value: unknown }),
      close: async () => { try { await runtime.close(); } finally { try { await ssh.close(); } finally { await rm(root, { recursive: true, force: true }); } } },
    };
  } catch (error) {
    try { await runtime.close(); } finally { try { await ssh.close(); } finally { await rm(root, { recursive: true, force: true }); } }
    throw error;
  }
}

export function remoteRestorePlan(before: CheckpointWorkspace, current: CheckpointWorkspace, paths = before.roots[0]!.files.map((file) => file.path)): CheckpointRestorePlan {
  return { version: 1, operationId: randomUUID(), root: current.roots[0]!.binding,
    expectedWorkspaceDigest: current.boundary!.sourceDigest, expectedGit: current.roots[0]!.git,
    files: paths.map((path) => {
      const live = current.roots[0]!.files.find((file) => file.path === path), target = before.roots[0]!.files.find((file) => file.path === path);
      const descriptor = live ? (({ content: _content, ...rest }) => rest)(live) : null;
      return { path, current: descriptor, target: target ?? null, choice: "restore-checkpoint" };
    }) };
}

export async function waitForRemote<T>(read: () => T | false | undefined | null, timeout = 10_000): Promise<T> {
  const deadline = Date.now() + timeout;
  do {
    const value = read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  } while (Date.now() < deadline);
  throw new Error("Generated exact Remote condition did not settle.");
}
