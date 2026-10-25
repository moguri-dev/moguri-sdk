import * as pty from "node-pty";
import { setTimeout as sleep } from "node:timers/promises";
import { MAX_TEXT, MoguriError } from "../../../packages/protocol/src/core.ts";
import { stripVTControlCharacters } from "node:util";
import { performance } from "node:perf_hooks";
import { textFilePage } from "./files.ts";

export function commandTail(text: string, maximum = MAX_TEXT): string {
  const bytes = Buffer.from(text);
  let start = Math.max(0, bytes.length - maximum);
  while (start < bytes.length && (bytes[start]! & 0xc0) === 0x80) start++;
  return bytes.subarray(start).toString("utf8");
}

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
export async function runCommand(root: string, command: string, timeoutMs: number, signal: AbortSignal, output: (text: string) => void, started: (pid: number) => void) {
  signal.throwIfAborted();
  const beginning = performance.now();
  const terminal = pty.spawn("/bin/sh", ["-c", command], {
    cwd: root, cols: 120, rows: 30,
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: process.env.HOME ?? root, TERM: "dumb", LANG: "en_US.UTF-8", NO_COLOR: "1" },
  });
  started(terminal.pid);
  let text = "";
  let clipped = false;
  let outputBytes = 0;
  terminal.onData((chunk) => {
    chunk = stripVTControlCharacters(chunk);
    outputBytes += Buffer.byteLength(chunk);
    if (Buffer.byteLength(text + chunk) > MAX_TEXT) clipped = true;
    text = commandTail(text + chunk);
    for (let offset = 0; offset < Buffer.byteLength(chunk);) {
      const page = textFilePage(chunk, { offset, limit: 16384 });
      output(page.text); offset = page.nextOffset ?? Buffer.byteLength(chunk);
    }
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
    const observed = { exitCode: exit.exitCode, signal: exit.signal || null, elapsedMs: performance.now() - beginning, outputBytes,
      retainedBytes: Buffer.byteLength(text), outputComplete: !clipped, cleanup: clean ? "known-group-stopped" : "unconfirmed", statisticsBasis: "Observed wall time and normalized UTF-8 output; child CPU/RSS are unavailable." };
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
