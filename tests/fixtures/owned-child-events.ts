import { isRecord } from "../../packages/protocol/src/index.ts";

process.once("message", (value: unknown) => {
  if (!isRecord(value)) throw new Error("Choose an explicit generated child event.");
  if (value.mode === "early-exit") { process.exitCode = 17; process.disconnect?.(); return; }
  setInterval(() => {}, 1000);
  if (value.mode === "failure") process.send?.({ kind: "fixture.failed", diagnostic: "Generated bootstrap failed after acquiring an owned handle." });
  if (value.mode === "stderr") {
    process.stderr.write(Buffer.alloc(512 * 1024, 0x67), () => process.send?.({ kind: "ready" }));
  }
});
