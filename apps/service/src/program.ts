import { spawn } from "node:child_process";
import { MoguriError } from "../../../packages/protocol/src/index.ts";

export async function runProgram(executable: string, args: string[], options: {
  cwd: string; signal: AbortSignal; env?: NodeJS.ProcessEnv; timeoutMs?: number; maxBytes?: number; label: string;
  /** Exit codes that still return stdout, for commands such as `git merge-tree` that report results through exit 1. */
  okCodes?: readonly number[];
  /** Keep only the last maxBytes of stdout instead of stopping, and report whether earlier output was dropped. */
  tail?: { truncated?: () => void };
}): Promise<string> {
  options.signal.throwIfAborted();
  const child = spawn(executable, args, {
    cwd: options.cwd, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"],
    env: { PATH: process.env.PATH, HOME: process.env.HOME, NO_COLOR: "1", ...options.env },
  });
  const chunks: Buffer[] = [];
  let diagnostic = "";
  let bytes = 0;
  let stopped = "";
  let escalation: ReturnType<typeof setTimeout> | undefined;
  const kill = (signal: NodeJS.Signals) => {
    if (!child.pid) return;
    try { if (process.platform === "win32") child.kill(signal); else process.kill(-child.pid, signal); }
    catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) console.error(`${options.label}: process cleanup unconfirmed.`); }
  };
  const stop = (reason: string) => {
    if (stopped) return;
    stopped = reason; kill("SIGTERM"); escalation = setTimeout(() => kill("SIGKILL"), 1500);
  };
  const cancel = () => stop("Cancellation requested");
  options.signal.addEventListener("abort", cancel, { once: true });
  if (options.signal.aborted) cancel();
  const timer = setTimeout(() => stop("Deadline exceeded"), options.timeoutMs ?? 120_000);
  let kept = 0;
  child.stdout.on("data", (chunk: Buffer) => {
    const limit = options.maxBytes ?? 128 * 1024;
    if (options.tail) {
      chunks.push(chunk); kept += chunk.byteLength;
      while (kept > limit) {
        const first = chunks[0]!, excess = kept - limit;
        if (first.byteLength <= excess) { chunks.shift(); kept -= first.byteLength; } else { chunks[0] = first.subarray(excess); kept -= excess; }
        options.tail.truncated?.();
      }
      return;
    }
    bytes += chunk.byteLength;
    if (bytes > limit) stop("Output limit exceeded");
    else chunks.push(chunk);
  });
  child.stderr.on("data", (chunk: Buffer) => {
    bytes += chunk.byteLength; diagnostic = (diagnostic + chunk.toString("utf8")).slice(-3000);
    if (bytes > (options.maxBytes ?? 128 * 1024)) stop("Output limit exceeded");
  });
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once("error", (error) => reject(new MoguriError("program_unavailable", `${options.label} could not start: ${error.message}. Install the configured tool explicitly.`, 503)));
      child.once("close", resolve);
    });
    if (stopped) throw new MoguriError("program_partial", `${options.label}: ${stopped}. Files or process cleanup may be partial; inspect before retrying.`, 409);
    if (code !== 0 && !(code !== null && options.okCodes?.includes(code))) throw new MoguriError("program_failed", `${options.label} exited with ${code ?? "a signal"}. ${diagnostic.trim() || "Inspect the retained local diagnostic; nothing was reported successful."}`, 409);
    return Buffer.concat(chunks).toString("utf8");
  } finally { clearTimeout(timer); clearTimeout(escalation); options.signal.removeEventListener("abort", cancel); }
}
