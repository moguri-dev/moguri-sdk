import type { IntakeClock } from "../../apps/service/src/session-intake.ts";

export class GeneratedIntakeClock implements IntakeClock {
  private instant: number;
  private id = 0;
  private timers = new Map<number, { at: number; callback: () => void }>();
  constructor(at = "2030-01-01T10:00:00.000Z") { this.instant = Date.parse(at); }
  now = () => this.instant;
  after = (callback: () => void, delay: number): (() => void) => {
    const id = ++this.id;
    this.timers.set(id, { at: this.instant + Math.max(0, delay), callback });
    return () => { this.timers.delete(id); };
  };
  advanceBy(ms: number): void {
    const target = this.instant + ms;
    let remaining = 1000;
    for (;;) {
      const next = [...this.timers].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!next) break;
      if (--remaining < 0) throw new Error("Generated intake timer loop did not settle.");
      this.instant = next[1].at; this.timers.delete(next[0]); next[1].callback();
    }
    this.instant = target;
  }
}
