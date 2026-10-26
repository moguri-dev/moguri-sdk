import { spawn } from "node:child_process";
import { MoguriError } from "../../../packages/protocol/src/index.ts";
import { hostExecutablePath } from "../../../packages/client/src/host-environment.ts";

export async function runProgram(executable: string, args: string[], options: {
  cwd: string; signal: AbortSignal; env?: NodeJS.ProcessEnv; timeoutMs?: number; maxBytes?: number; label: string;
}): Promise<string> {
  options.signal.throwIfAborted();
  const child = spawn(executable, args, {
    cwd: options.cwd, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"],
    env: { PATH: hostExecutablePath(process.env.PATH), HOME: process.env.HOME, NO_COLOR: "1", ...options.env },
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
  child.stdout.on("data", (chunk: Buffer) => {
    bytes += chunk.byteLength;
    if (bytes > (options.maxBytes ?? 128 * 1024)) stop("Output limit exceeded");
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
    if (code !== 0) throw new MoguriError("program_failed", `${options.label} exited with ${code ?? "a signal"}. ${diagnostic.trim() || "Inspect the retained local diagnostic; nothing was reported successful."}`, 409);
    return Buffer.concat(chunks).toString("utf8");
  } finally { clearTimeout(timer); clearTimeout(escalation); options.signal.removeEventListener("abort", cancel); }
}
