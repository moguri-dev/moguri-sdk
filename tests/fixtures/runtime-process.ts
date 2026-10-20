import { fork } from "node:child_process";
import { resolve } from "node:path";
import { isRecord, type Connection } from "../../packages/protocol/src/index.ts";

export async function launchRuntimeChild(input: { stateDir: string; vaultPath: string; modelId: string; baseUrl: string; holdUserPlan?: "approval" | "result" }) {
  const child = fork(resolve("tests/fixtures/runtime-child.ts"), [], { execPath: process.execPath, execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "pipe", "ipc"] });
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  let heldExecution: string | null = null;
  child.on("message", (raw: unknown) => { if (isRecord(raw) && raw.kind === "held-user-plan" && typeof raw.executionId === "string") heldExecution = raw.executionId; });
  const stop = async () => { if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await exited; } };
  try {
    const ready = new Promise<Connection>((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error("Generated child runtime did not start.")), 8000);
      child.once("error", reject);
      child.once("message", (raw: unknown) => {
        clearTimeout(deadline);
        if (!isRecord(raw) || !isRecord(raw.connection)) { reject(new Error("Invalid generated runtime connection.")); return; }
        const value = raw.connection;
        if (typeof value.protocolVersion !== "number" || typeof value.baseUrl !== "string" || typeof value.wsUrl !== "string" || typeof value.token !== "string" || typeof value.pid !== "number") { reject(new Error("Incomplete generated connection.")); return; }
        resolve({ protocolVersion: value.protocolVersion, baseUrl: value.baseUrl, wsUrl: value.wsUrl, token: value.token, pid: value.pid });
      });
    });
    child.send(input);
    return { child, exited, connection: await ready, get heldExecution() { return heldExecution; }, stop };
  } catch (error) { await stop(); throw error; }
}
