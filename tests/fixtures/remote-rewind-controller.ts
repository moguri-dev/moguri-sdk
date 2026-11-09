import { appendFile, readFile } from "node:fs/promises";
import type { CheckpointRestorePlan, ProjectSettings, RemoteTarget } from "../../packages/protocol/src/index.ts";
import { RemoteRuntime } from "../../apps/service/src/remote.ts";
import { runRemoteCheckpointRewind, type RemoteCheckpointScope } from "../../apps/service/src/remote-checkpoint-workspace.ts";
import { GeneratedFileVault } from "./generated-vault.ts";

const input = JSON.parse(await readFile(process.argv[2]!, "utf8")) as {
  stateDir: string; target: RemoteTarget; workerPath: string; vaultPath: string; receiptsPath: string;
  scope: RemoteCheckpointScope; plan: CheckpointRestorePlan; settings: ProjectSettings;
};
const runtime = new RemoteRuntime(input.stateDir, () => input.target, input.workerPath, { vault: new GeneratedFileVault(input.vaultPath) });
const retain = async (kind: string, value: unknown) => {
  await appendFile(input.receiptsPath, `${JSON.stringify({ kind, value })}\n`, { mode: 0o600 });
};
try {
  await runtime.probe();
  await runRemoteCheckpointRewind(runtime, input.scope, input.plan.operationId, input.plan, input.settings, AbortSignal.timeout(30_000), {
    intent: (execution) => retain("intent", execution),
    status: (execution, frame, request) => retain("status", { execution, frame, request }),
    boundary: async (index, phase, result) => {
      await retain(phase, { index, result });
      if (phase === "observed") {
        process.send?.({ kind: "effect-retained" });
        await new Promise<void>(() => {});
      }
    },
    result: (result) => retain("result", result),
  });
  process.send?.({ kind: "unexpected-completion" });
} catch (error) {
  process.send?.({ kind: "error", message: error instanceof Error ? error.message : "Generated child failed." });
} finally {
  await runtime.close(); process.disconnect?.();
}
