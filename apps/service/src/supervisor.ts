import * as pty from "node-pty";
import { setTimeout as sleep } from "node:timers/promises";
import { MAX_TEXT } from "../../../packages/protocol/src/index.ts";
import { stripVTControlCharacters } from "node:util";

function groupExists(pid: number): boolean {
  try { process.kill(-pid, 0); return true; } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH") return false;
    throw error;
  }
}
function signalGroup(pid: number, signal: NodeJS.Signals): void {
  try { process.kill(-pid, signal); } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error;
  }
}
export async function stopGroup(pid: number): Promise<boolean> {
  signalGroup(pid, "SIGTERM");
  for (let i = 0; i < 10 && groupExists(pid); i++) await sleep(30);
  if (groupExists(pid)) signalGroup(pid, "SIGKILL");
  for (let i = 0; i < 20 && groupExists(pid); i++) await sleep(30);
  return !groupExists(pid);
}
export async function runCommand(root: string, command: string, timeoutMs: number, signal: AbortSignal, output: (text: string) => void, started: (pid: number) => void): Promise<{ text: string; isError: boolean; outcome: string }> {
  signal.throwIfAborted();
  const terminal = pty.spawn("/bin/sh", ["-c", command], {
    cwd: root, cols: 120, rows: 30,
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: process.env.HOME ?? root, TERM: "dumb", LANG: "en_US.UTF-8", NO_COLOR: "1" },
  });
  started(terminal.pid);
  let text = "";
  let clipped = false;
  terminal.onData((chunk) => {
    chunk = stripVTControlCharacters(chunk);
    if (Buffer.byteLength(text + chunk) > MAX_TEXT) clipped = true;
    text = (text + chunk).slice(-MAX_TEXT);
    output(chunk.slice(0, 16_384));
  });
  let stopped: Promise<boolean> | undefined;
  let timedOut = false;
  const stop = () => { stopped ??= stopGroup(terminal.pid); };
  signal.addEventListener("abort", stop, { once: true });
  const timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
  try {
    if (signal.aborted) stop();
    const exit = await new Promise<{ exitCode: number; signal?: number }>((resolve) => terminal.onExit(resolve));
    const hadBackgroundSurvivors = !stopped && groupExists(terminal.pid);
    const clean = stopped ? await stopped : await stopGroup(terminal.pid);
    const cancelled = signal.aborted || timedOut;
    const suffix = `${clipped ? "\n[Output truncated to 128 KiB.]" : ""}${timedOut ? "\n[Command deadline exceeded.]" : ""}`;
    if (!clean) return { text: text + suffix + `\n[Process group ${terminal.pid} cleanup is unconfirmed.]`, isError: true, outcome: "partial" };
    if (hadBackgroundSurvivors) return { text: text + suffix + "\n[Background descendants survived their shell and were stopped. Background execution is unsupported.]", isError: true, outcome: "partial" };
    if (cancelled) return {
      text: text + suffix + `\n[Process group ${terminal.pid} stopped. Detached/reparented descendants cannot be fully verified by this checkpoint's supervisor. Inspect processes before resuming.]`,
      isError: true, outcome: "partial",
    };
    return {
      text: text + suffix + `\n[exit=${exit.exitCode}${exit.signal ? ` signal=${exit.signal}` : ""}]`,
      isError: exit.exitCode !== 0 || Boolean(exit.signal),
      outcome: exit.exitCode === 0 && !exit.signal ? "completed" : "failed",
    };
  } finally { clearTimeout(timer); signal.removeEventListener("abort", stop); }
}
