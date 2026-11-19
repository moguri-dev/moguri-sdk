import { RECOVERY_DELAYS_MS, recoveryDueRound, type RecoveryCycle, type ScheduledPrompt } from "../../../packages/protocol/src/index.ts";

export interface IntakeClock {
  now(): number;
  after(callback: () => void, delayMs: number): () => void;
}
export const intakeClock: IntakeClock = {
  now: Date.now,
  after: (callback, ms) => {
    const timer = setTimeout(callback, ms);
    timer.unref();
    return () => clearTimeout(timer);
  },
};
interface IntakeHost {
  scheduled(): ScheduledPrompt[];
  deliver(prompt: ScheduledPrompt): void;
  recovery(): RecoveryCycle | null;
  recover(cycle: RecoveryCycle, round: number): void | Promise<void>;
  /** Next due instants of active automations (protocol 113). */
  automations(): number[];
  /** Records due automation occurrences; run launch continues in the background. */
  fire(): void;
}
export class SessionIntake {
  private cancelTimer?: () => void;
  private started = false;
  private faulted = false;
  private ticking = false;
  constructor(private readonly host: IntakeHost, readonly clock: IntakeClock = intakeClock) {}
  start(): void { this.started = true; this.changed(); }
  changed(): void {
    this.cancelTimer?.(); this.cancelTimer = undefined;
    if (!this.started || this.faulted || this.ticking) return;
    const due = this.host.scheduled().filter((prompt) => prompt.status === "scheduled").map((prompt) => Date.parse(prompt.dueAt));
    const cycle = this.host.recovery();
    if (cycle?.status === "active" && cycle.round < RECOVERY_DELAYS_MS.length) due.push(Date.parse(cycle.startedAt) + RECOVERY_DELAYS_MS[cycle.round]!);
    due.push(...this.host.automations());
    if (!due.length) return;
    this.cancelTimer = this.clock.after(() => { void this.tick(); }, Math.min(2147483647, Math.max(0, Math.min(...due) - this.clock.now())));
  }
  private async tick(): Promise<void> {
    this.cancelTimer = undefined;
    if (!this.started || this.ticking) return;
    this.ticking = true;
    try {
      const cycle = this.host.recovery(), round = recoveryDueRound(cycle, this.clock.now());
      if (cycle && round !== null) await this.host.recover(cycle, round);
      if (!this.started) return;
      for (const prompt of this.host.scheduled().filter((prompt) => prompt.status === "scheduled" && Date.parse(prompt.dueAt) <= this.clock.now())
        .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt) || a.id.localeCompare(b.id))) this.host.deliver(prompt);
      if (this.host.automations().some((at) => at <= this.clock.now())) this.host.fire();
    } catch (error) {
      this.faulted = true;
      console.error("Session intake persistence failed. Automatic intake is paused; inspect original receipts before retrying:", error);
    } finally { this.ticking = false; this.changed(); }
  }
  close(): void { this.started = false; this.cancelTimer?.(); this.cancelTimer = undefined; }
}
