import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { agentParentMessage, type AgentParentMessage, type AgentWorkerMessage } from "./agent-harness-protocol.ts";

/** Shared IPC and process-group ownership for external harness workers (one harness process per Moguri turn). */
export type Outcome = "completed" | "stopped" | "failed" | "partial";
type Reply = { value?: unknown; error?: string };
export const send = (message: AgentWorkerMessage) => { if (process.connected) process.send?.(message); };
const pending = new Map<string, (reply: Reply) => void>();
export function request(message: Extract<AgentWorkerMessage, { requestId: string }>): Promise<Reply> {
  if (!process.connected) return Promise.resolve({ error: "The Moguri control plane disconnected." });
  return new Promise((resolve) => { pending.set(message.requestId, resolve); send(message); });
}
/** Answers outstanding approval requests locally, without waiting for the control plane. */
export function failPending(ids: Iterable<string>, error: string): void {
  for (const id of ids) { pending.get(id)?.({ error }); pending.delete(id); }
}
export const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class HarnessProcess {
  child?: ChildProcess;
  stderrTail = "";
  constructor(public label: string) {}
  spawn(command: string, args: string[], cwd: string, environment: Record<string, string | undefined>): ChildProcess {
    if (this.child) throw new Error(`Moguri owns exactly one ${this.label} process per turn.`);
    const owned = spawn(command, args, { cwd, env: environment, detached: true, stdio: ["pipe", "pipe", "pipe"] });
    this.child = owned;
    if (owned.pid) send({ kind: "agent.process", pid: owned.pid });
    owned.stderr?.on("data", (chunk: Buffer) => { this.stderrTail = (this.stderrTail + chunk.toString("utf8")).slice(-4096); });
    return owned;
  }
  /** The group outlives its leader: tools the harness started stay members after it exits. Only ESRCH confirms an empty group. */
  signal(signal: NodeJS.Signals | 0): boolean {
    if (!this.child?.pid) return false;
    try { process.kill(-this.child.pid, signal); return true; }
    catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ESRCH") return false;
      console.error(`${this.label} process-group signal failed; cleanup is unconfirmed.`);
      return true;
    }
  }
  async settle(): Promise<boolean> {
    if (!this.signal(0)) return true;
    this.signal("SIGTERM"); await pause(1000);
    if (!this.signal(0)) return true;
    this.signal("SIGKILL"); await pause(500);
    return !this.signal(0);
  }
  exited(timeoutMs: number): Promise<boolean> {
    const owned = this.child;
    if (!owned || owned.exitCode !== null || owned.signalCode !== null) return Promise.resolve(true);
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), timeoutMs);
      owned.once("exit", () => { clearTimeout(timer); resolve(true); });
    });
  }
  /** Settles the group after the turn, downgrades unconfirmed cleanup to partial, then reports the terminal outcome once. */
  async finish(outcome: Outcome, diagnostic: string | null, escalations: ReturnType<typeof setTimeout>[]): Promise<void> {
    if (this.stderrTail.trim()) process.stderr.write(`${this.label} stderr tail:\n${this.stderrTail}\n`);
    const leaderExited = await this.exited(3000), groupSettled = await this.settle();
    if (!leaderExited || !groupSettled || !await this.exited(500)) {
      outcome = "partial";
      diagnostic = `${diagnostic ?? ""} ${groupSettled ? `${this.label} did not exit after its turn; Moguri terminated its process group.` :
        `Processes in ${this.label}'s process group survived termination. Inspect them; cleanup is unconfirmed.`}`.trim();
    }
    for (const timer of escalations) clearTimeout(timer);
    const reply = await request({ kind: "finished", requestId: randomUUID(), outcome, diagnostic });
    if (reply.error) console.error(`${this.label} terminal outcome was not acknowledged; the control plane reconciles it.`);
    if (process.connected) process.disconnect?.();
  }
}
/** Wires parent IPC: one start frame, replies to pending requests, and stop/control-lost. */
export function serveWorker(owner: HarnessProcess, start: (message: AgentParentMessage) => boolean, stop: () => void): void {
  let started = false;
  process.on("SIGTERM", () => { owner.signal("SIGKILL"); process.exit(1); });
  process.on("disconnect", () => { owner.signal("SIGKILL"); });
  process.on("message", (raw: unknown) => {
    const message = agentParentMessage(raw);
    if (!message) { console.error("Invalid agent harness parent message ignored."); return; }
    if (message.kind === "reply") {
      const waiter = pending.get(message.requestId);
      pending.delete(message.requestId);
      waiter?.({ ...(message.value !== undefined ? { value: message.value } : {}), ...(message.error !== undefined ? { error: message.error } : {}) });
    } else if (message.kind === "stop" || message.kind === "control-lost") stop();
    else if (!started && start(message)) started = true;
  });
}
