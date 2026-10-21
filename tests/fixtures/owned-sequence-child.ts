import { isRecord, projectEvents } from "../../packages/protocol/src/index.ts";
import { ownedSequenceFixture } from "./owned-sequence-api.ts";

process.once("message", (raw: unknown) => {
  void (async () => {
    if (!isRecord(raw) || !["pending", "inflight", "recorded", "completed"].includes(String(raw.phase))) throw new Error("Choose one generated actual owned-role recovery phase.");
    const phase = raw.phase, f = await ownedSequenceFixture();
    let published = false;
    const publish = () => {
      if (published) return;
      published = true;
      const sequence = projectEvents(f.service.store.events(), f.control.profileId).roleSequences[0];
      if (!sequence) throw new Error("The actual controller did not retain its original role sequence.");
      process.send?.({ directory: f.directory, sequence, requests: f.requests.length });
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
    };
    const commit = f.service.store.commit.bind(f.service.store);
    f.service.store.commit = (...args: Parameters<typeof commit>) => {
      const result = commit(...args), events = args[0];
      if (phase === "pending" && events.some((event) => event.event_type === "turn.control_started" && event.payload.purpose === "role.sequence") ||
        phase === "recorded" && events.some((event) => event.event_type === "model.completed") ||
        phase === "completed" && events.some((event) => event.event_type === "turn.finished")) publish();
      return result;
    };
    const timer = phase === "inflight" ? setInterval(() => { if (f.requests.length === 1) publish(); }, 5) : undefined;
    try { await f.start(phase === "inflight" ? { ...f.input, input: { ...f.input.input, task: "generated slow controller SIGKILL role" } } : f.input); }
    catch (error) { clearInterval(timer); await f.close(); throw error; }
  })().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Generated owned-role recovery child failed.");
    process.exitCode = 1; process.disconnect?.();
  });
});
