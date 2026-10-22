import * as pty from "node-pty";
import { setTimeout as sleep } from "node:timers/promises";
import { MAX_TEXT, MoguriError } from "../../../packages/protocol/src/core.ts";
import { stripVTControlCharacters } from "node:util";

function signalGroup(pid: number, signal: NodeJS.Signals | 0): "present" | "absent" | "unconfirmed" {
  try { process.kill(-pid, signal); return "present"; } catch (error) {
    if (error instanceof Error && "code" in error) {
      if (error.code === "ESRCH") return "absent";
      if (error.code === "EPERM") return "unconfirmed";
    }
    throw error;
  }
}
const groupExists = (pid: number) => signalGroup(pid, 0) !== "absent";
export async function stopGroup(pid: number): Promise<boolean> {
  if (!Number.isInteger(pid) || pid <= 1) throw new MoguriError("process_ownership", "An owned process group must have a PID greater than one.");
  if (signalGroup(pid, "SIGTERM") === "absent") return true;
  // macOS can transiently return EPERM while an owned group exits. Only ESRCH confirms cleanup.
  for (let i = 0; i < 10 && groupExists(pid); i++) await sleep(30);
  if (groupExists(pid) && signalGroup(pid, "SIGKILL") === "absent") return true;
  for (let i = 0; i < 20 && groupExists(pid); i++) await sleep(30);
  return !groupExists(pid);
}
export async function runCommand(root: string, command: string, timeoutMs: number, signal: AbortSignal, output: (text: string) => void, started: (pid: number) => void): Promise<{ text: string; isError: boolean; outcome: string; exitCode: number; signal: number | null }> {
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
    const hadBackgroundSurvivors = !stopped && signalGroup(terminal.pid, 0) === "present";
    const clean = stopped ? await stopped : await stopGroup(terminal.pid);
    const observed = { exitCode: exit.exitCode, signal: exit.signal || null };
    const cancelled = signal.aborted || timedOut;
    const suffix = `${clipped ? "\n[Output truncated to 128 KiB.]" : ""}${timedOut ? "\n[Command deadline exceeded.]" : ""}`;
    if (!clean) return { ...observed, text: text + suffix + `\n[Process group ${terminal.pid} cleanup is unconfirmed.]`, isError: true, outcome: "partial" };
    if (hadBackgroundSurvivors) return { ...observed, text: text + suffix + "\n[Background descendants survived their shell and were stopped. Background execution is unsupported.]", isError: true, outcome: "partial" };
    if (cancelled) return {
      text: text + suffix + `\n[Process group ${terminal.pid} stopped. Detached/reparented descendants cannot be fully verified by this checkpoint's supervisor. Inspect processes before resuming.]`,
      ...observed, isError: true, outcome: "partial",
    };
    return {
      ...observed, text: text + suffix + `\n[exit=${exit.exitCode}${exit.signal ? ` signal=${exit.signal}` : ""}]`,
      isError: exit.exitCode !== 0 || Boolean(exit.signal),
      outcome: exit.exitCode === 0 && !exit.signal ? "completed" : "failed",
    };
  } finally { clearTimeout(timer); signal.removeEventListener("abort", stop); }
}
