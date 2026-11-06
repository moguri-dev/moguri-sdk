import { fork, type Serializable } from "node:child_process";
import { isRecord } from "../../packages/protocol/src/index.ts";

export function forkOwnedFixture(path: string) {
  const child = fork(path, [], { execPath: process.execPath, execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "pipe", "ipc"] });
  let diagnostic = "";
  child.stderr?.on("data", (data: Buffer) => { diagnostic = (diagnostic + data.toString("utf8")).slice(-8192); });
  const exited = new Promise<void>((resolve) => { child.once("exit", () => resolve()); child.once("error", () => { if (!child.pid) resolve(); }); });
  const stop = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return exited;
    child.kill("SIGKILL");
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([exited, new Promise<never>((_, reject) => {
        deadline = setTimeout(() => reject(new Error(`Generated owned child cleanup is unconfirmed: ${diagnostic}`)), 5000);
      })]);
    } finally { clearTimeout(deadline); }
  };
  const ready = async (input: Serializable, options: { signal?: AbortSignal; timeoutMs?: number } = {}) => {
    try {
      return await new Promise<unknown>((resolve, reject) => {
        const finish = (error?: Error, value?: unknown) => {
          clearTimeout(deadline); child.off("message", message); child.off("error", failed); child.off("exit", ended);
          options.signal?.removeEventListener("abort", aborted);
          if (error) reject(error); else resolve(value);
        };
        const failed = (error: Error) => finish(error);
        const ended = () => finish(new Error(`Generated owned child exited before readiness (${child.exitCode ?? child.signalCode}): ${diagnostic}`));
        const aborted = () => finish(new Error("Generated owned child startup was cancelled."));
        const message = (value: unknown) => {
          if (isRecord(value) && value.kind === "fixture.failed") finish(new Error(typeof value.diagnostic === "string" ?
            value.diagnostic.slice(-8192) : "Generated owned child bootstrap failed."));
          else finish(undefined, value);
        };
        const deadline = setTimeout(() => finish(new Error(`Generated owned child did not become ready: ${diagnostic}`)), options.timeoutMs ?? 8000);
        child.once("message", message); child.once("error", failed); child.once("exit", ended);
        options.signal?.addEventListener("abort", aborted, { once: true });
        if (options.signal?.aborted) aborted();
        else child.send(input, (error) => { if (error) failed(error); });
      });
    } catch (error) {
      try { await stop(); } catch (cleanup) { throw new AggregateError([error, cleanup], "Generated child startup and owned cleanup both failed."); }
      throw error;
    }
  };
  return { child, exited, ready, stop, get diagnostic() { return diagnostic; } };
}
