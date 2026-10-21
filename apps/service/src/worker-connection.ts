import { EventEmitter } from "node:events";
import { fork } from "node:child_process";
import type { ParentMessage } from "./worker-protocol.ts";

export interface WorkerFrame { executionId: string; sequence: number; digest: string }
export type WorkerConnectionEvents = {
  message: [unknown, WorkerFrame?]; error: [Error]; exit: [number | null, NodeJS.Signals | null]; stderr: [string];
};
export interface WorkerConnection {
  readonly events: EventEmitter<WorkerConnectionEvents>;
  readonly connected: boolean;
  send(message: ParentMessage, callback?: (error: Error | null) => void): void;
  kill(signal: NodeJS.Signals): void;
  acknowledge?(sequence: number): void;
}
export function localWorker(path: string, turnId: string): WorkerConnection {
  const child = fork(path, [], {
    execPath: process.execPath, execArgv: path.endsWith(".ts") ? ["--import", "tsx"] : [],
    stdio: ["ignore", "ignore", "pipe", "ipc"],
    env: { PATH: process.env.PATH, HOME: process.env.HOME, MOGURI_TURN_ID: turnId },
  });
  const events = new EventEmitter<WorkerConnectionEvents>();
  child.on("message", (value: unknown) => events.emit("message", value));
  child.on("error", (error) => events.emit("error", error));
  child.on("exit", (code, signal) => events.emit("exit", code, signal));
  child.stderr?.on("data", (data: Buffer) => events.emit("stderr", data.toString()));
  return {
    events, get connected() { return child.connected; },
    send(message, callback) { child.send(message, (error) => callback?.(error ?? null)); },
    kill(signal) { child.kill(signal); },
  };
}
