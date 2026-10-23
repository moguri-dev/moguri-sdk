import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import type { PowerStatus, Snapshot } from "../../../packages/protocol/src/index.ts";

export interface PowerLease { stop(): Promise<void> }
export interface PowerDriver { start(exited: (diagnostic: string) => void): Promise<PowerLease> }
type PowerLauncher = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;

export class NativePowerDriver implements PowerDriver {
  constructor(private readonly platform: NodeJS.Platform = process.platform, private readonly launch: PowerLauncher = spawn) {}
  start(exited: (diagnostic: string) => void): Promise<PowerLease> {
    if (this.platform !== "darwin") return Promise.reject(new Error("Idle-sleep prevention is currently qualified only on macOS."));
    return new Promise((resolve, reject) => {
      const child = this.launch("/usr/bin/caffeinate", ["-i", "-w", String(process.pid)], { stdio: "ignore", env: { PATH: "/usr/bin:/bin" } });
      let closed = false, stopping = false, stopTask: Promise<void> | undefined;
      child.once("error", reject);
      child.once("close", (code, signal) => {
        closed = true;
        if (!stopping) exited(`The owned idle-sleep helper exited with ${signal ? `signal ${signal}` : `status ${code}`}.`);
      });
      const stop = async () => {
        if (closed) return;
        stopping = true;
        await new Promise<void>((done, failed) => {
          let hard: ReturnType<typeof setTimeout> | undefined, deadline: ReturnType<typeof setTimeout> | undefined;
          const clear = () => { clearTimeout(hard); clearTimeout(deadline); child.removeListener("close", close); child.removeListener("error", error); };
          const close = () => { clear(); done(); };
          const error = (value: Error) => { clear(); failed(value); };
          child.once("close", close); child.once("error", error);
          child.kill("SIGTERM");
          hard = setTimeout(() => { if (!closed) child.kill("SIGKILL"); }, 1000);
          deadline = setTimeout(() => { clear(); failed(new Error("The original idle-sleep helper did not acknowledge shutdown. Its exact handle was retained for inspection/retry.")); }, 3000);
        });
      };
      child.once("spawn", () => resolve({ stop: () => stopTask ??= stop().catch((error: unknown) => { stopTask = undefined; throw error; }) }));
    });
  }
}

export class KeepAwake {
  private lease?: PowerLease;
  private starting?: Promise<void>;
  private stopping?: Promise<void>;
  private wanted = false;
  private closed = false;
  private generation = 0;
  private failure: string | null = null;
  private preference = "";
  private owner: symbol | undefined;
  private latestFinish = 0;
  private workingBefore = false;
  private current: PowerStatus = { enabled: false, status: "idle", until: null, diagnostic: null };
  constructor(private readonly snapshot: () => Snapshot, private readonly driver: PowerDriver = new NativePowerDriver(), private readonly now = Date.now) {}
  status(): PowerStatus { return { ...this.current }; }
  private fail(error: unknown): void {
    this.failure = error instanceof Error ? error.message : "Idle-sleep prevention failed. Inspect the original helper before retrying.";
    console.error("Moguri idle-sleep prevention:", this.failure);
  }
  update(): void {
    const snapshot = this.snapshot(), policy = snapshot.settings.values.lifecycle ?? { keepAwake: false, tailMinutes: 5 };
    const preference = JSON.stringify(policy);
    if (preference !== this.preference) { this.preference = preference; if (!this.lease && !this.stopping) this.failure = null; }
    if (!policy.keepAwake && !this.lease && !this.starting && !this.stopping) {
      this.wanted = false;
      this.workingBefore = false;
      this.current = { enabled: false, status: this.failure ? "failed" : "idle", until: null, diagnostic: this.failure };
      return;
    }
    const working = snapshot.sessions.some((session) => Boolean(session.turnId)) ||
      snapshot.jobs.some((job) => Boolean(job.sessionId) && ["running", "waiting_input"].includes(job.status));
    const finished = snapshot.sessions.reduce((latest, session) => {
      const time = Date.parse(session.finishedAt ?? "");
      return Number.isFinite(time) ? Math.max(latest, time) : latest;
    }, 0);
    this.latestFinish = Math.max(this.latestFinish, finished, this.workingBefore && !working ? this.now() : 0);
    this.workingBefore = working;
    const until = this.latestFinish + policy.tailMinutes * 60_000;
    const wanted = !this.closed && policy.keepAwake && (working || until > this.now());
    if (wanted !== this.wanted) { this.wanted = wanted; this.generation++; }
    this.current = { enabled: policy.keepAwake, status: this.failure ? "failed" : this.stopping ? "stopping" :
      !wanted ? "idle" : !this.lease ? "starting" : working ? "working" : "tail",
      until: wanted && !working ? new Date(until).toISOString() : null, diagnostic: this.failure };
    if (!wanted && this.lease && !this.stopping && !this.failure) {
      const lease = this.lease;
      this.stopping = lease.stop().then(() => { if (this.lease === lease) this.lease = undefined; })
        .catch((error: unknown) => this.fail(error)).finally(() => { this.stopping = undefined; this.update(); });
    } else if (wanted && !this.lease && !this.starting && !this.stopping && !this.failure) {
      const generation = this.generation, owner = Symbol("owned idle-sleep helper");
      this.owner = owner;
      this.starting = Promise.resolve().then(() => {
        if (!this.wanted || this.closed || generation !== this.generation) return null;
        return this.driver.start((diagnostic) => {
        if (this.owner !== owner) return;
        this.owner = undefined; this.lease = undefined;
        if (this.wanted && !this.closed) this.fail(new Error(diagnostic));
        this.update();
        });
      }).then(async (lease) => {
        if (!lease) return;
        if (this.owner !== owner) { await lease.stop(); return; }
        this.lease = lease;
        if (!this.wanted || this.closed || generation !== this.generation) {
          await lease.stop(); if (this.lease === lease) this.lease = undefined;
        }
      }).catch((error: unknown) => this.fail(error)).finally(() => { this.starting = undefined; this.update(); });
    }
  }
  async retry(): Promise<void> {
    if (this.starting || this.stopping) throw new Error("Wait for the current owned idle-sleep transition.");
    if (this.lease) { await this.lease.stop(); this.lease = undefined; }
    this.failure = null; this.generation++; this.update(); await this.starting;
    if (this.failure) throw new Error(this.failure);
  }
  async close(): Promise<void> {
    this.closed = true; this.wanted = false; this.generation++;
    await this.starting; await this.stopping;
    if (this.lease) { await this.lease.stop(); this.lease = undefined; }
    this.update();
  }
}
