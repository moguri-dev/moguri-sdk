import { writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { digest } from "../../apps/service/src/store.ts";
import { reviewNativeTools, setupFixture } from "../fixture.ts";

const phase = process.argv[2];
if (phase !== "capture" && phase !== "restore" || !process.send) throw new Error("Run only as the generated checkpoint crash fixture.");
const f = await setupFixture({ toolCall: { name: "write_file", args: { path: "generated.txt", text: "Generated owned change.", expectedDigest: digest("Generated original.") } } });
await writeFile(join(f.project, "generated.txt"), "Generated original.");
await reviewNativeTools(f, ["write_file"]); await f.configure();
if (phase === "restore") { await f.send("Generated checkpoint crash setup."); await f.approve(); await f.terminal(); }
const original = f.service.store.commit;
const pause = () => {
  writeFileSync(join(f.directory, "generated-checkpoint-crash-boundary"), phase, { mode: 0o600 });
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
};
f.service.store.commit = (inputs, receipt, forget, derive) => {
  const result = original.call(f.service.store, inputs, receipt, forget, (events) => {
    const derived = derive?.(events) ?? [];
    if (phase === "capture" && derived.some((event) => event.event_type === "checkpoint.recorded")) pause();
    return derived;
  });
  if (phase === "restore" && inputs.some((event) => event.event_type === "rewind.recorded" &&
    event.payload.record.files.some((file) => file.phase === "written"))) pause();
  return result;
};
process.on("message", (message: unknown) => {
  if (message !== "capture") return;
  void f.send("Generated capture whose admission transaction will be killed.").catch((error: unknown) => {
    console.error("Generated capture unexpectedly returned:", error instanceof Error ? error.message : "unknown"); process.exitCode = 1;
  });
});
process.send({ kind: "ready", directory: f.directory, project: f.project, home: f.home, sessionId: f.sessionId,
  connection: f.service.connection, requests: f.requests.length, budget: f.service.controller.snapshot().budgetEntries });
