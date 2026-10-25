import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";
import { isRecord } from "../../../packages/protocol/src/core.ts";

console.log = (...values: unknown[]) => console.error(...values);
if (!isMainThread) {
  if (!isRecord(workerData) || typeof workerData.deadline !== "number" || workerData.deadline > Date.now() + 10000) throw new Error("Invalid data-worker watchdog.");
  const deadline = workerData.deadline;
  const check = () => { if (Date.now() >= deadline || process.memoryUsage().rss > 384 * 1024 * 1024) process.kill(process.pid, "SIGKILL"); };
  check(); setInterval(check, 25); parentPort!.postMessage("ready");
} else {
  process.once("message", (request: unknown) => {
    const watchdog = new Worker(new URL(import.meta.url), { workerData: { deadline: Date.now() + 10000 },
      resourceLimits: { maxOldGenerationSizeMb: 32, maxYoungGenerationSizeMb: 8, stackSizeMb: 2 } });
    let stopping = false;
    watchdog.on("exit", () => { if (!stopping) process.kill(process.pid, "SIGKILL"); });
    void (async () => {
      await new Promise<void>((resolve, reject) => { watchdog.once("message", (value) => value === "ready" ? resolve() : reject(new Error("Invalid watchdog readiness."))); watchdog.once("error", reject); });
      if (!isRecord(request) || typeof request.kind !== "string" || !isRecord(request.arguments)) throw new Error("Invalid bounded data request.");
      const { authorDocument, editDocument, projectSql } = await import("./data-operations.ts");
      if (request.kind === "sqlite_query" || request.kind === "sqlite_transaction") {
        if (typeof request.path !== "string") throw new Error("Missing exact project database.");
        return projectSql(request.kind, request.arguments, request.path);
      }
      if (request.kind !== "write_document" && request.kind !== "edit_document") throw new Error("Unknown data operation.");
      const { extractDocument } = await import("./document-extract.ts");
      const source = typeof request.source === "string" ? Buffer.from(request.source, "base64") : null;
      const bytes = request.kind === "write_document" ? await authorDocument(request.arguments) :
        source ? await editDocument(request.arguments, source) : (() => { throw new Error("Missing original document."); })();
      if (!bytes.length || bytes.length > 8 * 1024 * 1024) throw new Error("Generated document exceeds 8 MiB.");
      const format = request.kind === "write_document" ? request.arguments.format : String(request.arguments.path).split(".").at(-1);
      if (format !== "pdf" && format !== "docx" && format !== "xlsx") throw new Error("Unsupported document output format.");
      const validated = await extractDocument(bytes, format);
      return { bytes: bytes.toString("base64"), summary: validated.summary };
    })().then((value) => {
      if (Buffer.byteLength(JSON.stringify(value)) > 12 * 1024 * 1024) throw new Error("Data-worker result exceeds 12 MiB.");
      process.send?.({ ok: true, value, maxRssKiB: process.resourceUsage().maxRSS });
    }).catch((error: unknown) => {
      process.send?.({ ok: false, code: error instanceof Error && "code" in error ? String(error.code) : "tool_data",
        message: error instanceof Error ? error.message.slice(0, 2000) : "Structured data operation failed." });
    }).finally(async () => { stopping = true; await watchdog.terminate(); if (process.connected) process.disconnect?.(); });
  });
  process.on("disconnect", () => { process.exitCode = process.exitCode ?? 0; });
}
