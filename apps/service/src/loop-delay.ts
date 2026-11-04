import { monitorEventLoopDelay } from "node:perf_hooks";

export class LoopDelay {
  private readonly histogram = monitorEventLoopDelay({ resolution: 20 });
  private began = performance.now();
  private readonly timer: ReturnType<typeof setInterval>;
  constructor() {
    this.histogram.enable();
    this.timer = setInterval(() => { this.histogram.reset(); this.began = performance.now(); }, 5000);
    this.timer.unref();
  }
  timing(prefix: "service" | "proxy"): string {
    return this.histogram.count ? `, moguri-${prefix}-loop;dur=${Math.max(0, this.histogram.max / 1_000_000 - 20).toFixed(3)}, moguri-${prefix}-window;dur=${(performance.now() - this.began).toFixed(3)}` : "";
  }
  close(): void { clearInterval(this.timer); this.histogram.disable(); }
}
