import { isRecord } from "../../packages/protocol/src/index.ts";
import { roleSequenceFixture } from "./role-sequence-api.ts";

process.once("message", (value: unknown) => {
  void (async () => {
    if (!isRecord(value) || !["pending", "started", "recorded", "completed"].includes(String(value.phase))) throw new Error("Choose one generated role recovery phase.");
    const f = await roleSequenceFixture();
    try {
      if (value.phase !== "pending") f.start(0);
      if (value.phase === "recorded" || value.phase === "completed") f.result(0);
      if (value.phase === "completed") { f.start(1); f.result(1); f.complete(); }
      process.send?.({ connection: f.service.connection, directory: f.directory, sequence: f.current(), requests: f.requests.length });
    } catch (error) { await f.close(); throw error; }
  })().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Generated role recovery bootstrap failed."); process.exitCode = 1; process.disconnect?.(); });
});
