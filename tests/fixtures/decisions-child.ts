import { isRecord } from "../../packages/sdk/src/index.ts";
import { setupDecisions, generatedAdvice } from "./decisions-api.ts";
import { waitFor } from "../fixture.ts";

process.once("message", (value: unknown) => {
  void (async () => {
    if (!isRecord(value) || value.phase !== "inflight" && value.phase !== "before-effect") throw new Error("Choose one original generated decision loss boundary.");
    const f = await setupDecisions(value.phase === "inflight" ? { advice: { stream: { chunks: [generatedAdvice()], delayMs: 60000 } } } : {});
    const publish = () => {
      const record = f.service.controller.snapshot().decisions[0];
      if (!record) throw new Error("The actual generated decision owner was not retained.");
      process.send?.({ directory: f.directory, stateDir: f.directory + "/state", sessionId: f.sessionId, decisionId: record.id,
        originalCalls: f.service.controller.snapshot().budgetEntries.length, inputDigest: record.inputDigest });
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
    };
    if (value.phase === "before-effect") f.service.controller.on("change", () => {
      if (f.service.controller.snapshot().decisions[0]?.status === "ready") publish();
    });
    await f.send("generated tool actual decision controller loss");
    if (value.phase === "inflight") { await waitFor(() => f.advice.requests.length === 1); publish(); }
  })().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Generated owned decision loss setup failed."); process.exitCode = 1; process.disconnect?.(); });
});
