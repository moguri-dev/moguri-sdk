import { fork } from "node:child_process";
import { createRequire } from "node:module";
import { isRecord, MoguriError } from "../../../packages/protocol/src/core.ts";
import type { McpOperation } from "./mcp-worker.ts";

export async function runMcpConnector(operation: McpOperation, workerPath: string, signal: AbortSignal,
  started?: (pid: number) => void): Promise<unknown> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = fork(workerPath, [], {
      execPath: process.execPath, execArgv: [...(workerPath.endsWith(".ts") ? ["--import", createRequire(import.meta.url).resolve("tsx")] : []), "--max-old-space-size=128"],
      detached: true, stdio: ["ignore", "ignore", "pipe", "ipc"],
      env: { PATH: process.env.PATH, HOME: process.env.HOME },
    });
    child.stderr?.resume();
    let settled = false, received = false, terminating = false;
    let result: unknown, failure: Error | undefined;
    let force: ReturnType<typeof setTimeout> | undefined, completion: ReturnType<typeof setTimeout> | undefined, abandon: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => { clearTimeout(timer); clearTimeout(force); clearTimeout(completion); clearTimeout(abandon); signal.removeEventListener("abort", cancel); child.stderr?.destroy(); };
    const settle = (error?: Error) => { if (settled) return; settled = true; cleanup(); if (error) reject(error); else resolve(result); };
    const stopGroup = (kind: NodeJS.Signals) => {
      if (!child.pid) return;
      try { process.kill(-child.pid, kind); }
      catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) console.error("Moguri MCP process-group cleanup is unconfirmed."); }
    };
    const fail = (error: Error) => {
      if (settled || terminating) return;
      terminating = true; failure = error; clearTimeout(completion); stopGroup("SIGTERM");
      if (!child.pid) { settle(error); return; }
      force = setTimeout(() => {
        stopGroup("SIGKILL"); abandon = setTimeout(() => settle(error), 1000);
      }, 1000);
    };
    const cancel = () => fail(new MoguriError("mcp_cancelled", "MCP cancellation requested. Owned process-group cleanup and remote side effects may be partial."));
    const timer = setTimeout(() => fail(new MoguriError("mcp_timeout", "MCP operation exceeded its deadline. Remote effects and process cleanup are unconfirmed.")), 70_000);
    signal.addEventListener("abort", cancel, { once: true });
    child.once("error", () => fail(new MoguriError("mcp_worker", "The MCP connector could not start. Rebuild the SDK.")));
    child.once("message", (message: unknown) => {
      if (settled || terminating || received) return;
      if (!isRecord(message) || typeof message.ok !== "boolean") { fail(new MoguriError("mcp_protocol", "MCP connector returned an invalid response.")); return; }
      received = true;
      if (message.ok) result = message.result;
      else failure = new MoguriError("mcp_failed", typeof message.error === "string" ? message.error : "MCP connection or tool call failed.");
      completion = setTimeout(() => fail(new MoguriError("mcp_cleanup", "The MCP connector returned data but did not shut down. Owned process cleanup and external effects may be partial.")), 1000);
    });
    child.once("exit", (code) => {
      if (failure) settle(failure);
      else if (received && code === 0) settle();
      else settle(new MoguriError("mcp_worker", "MCP connector exited before confirming its result and shutdown. No operation was retried."));
    });
    if (child.pid && started) {
      try { started(child.pid); }
      catch { fail(new MoguriError("mcp_process_observer", "MCP process ownership could not be retained before dispatch. No connector request was sent.")); return; }
    }
    if (signal.aborted) { cancel(); return; }
    child.send(operation, (error) => { if (error) fail(new MoguriError("mcp_worker", "The MCP connector IPC channel failed. No operation was retried.")); });
  });
}
