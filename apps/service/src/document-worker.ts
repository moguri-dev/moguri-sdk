import { DOCUMENT_LIMITS as L, DocumentFormatSchema } from "../../../packages/protocol/src/documents.ts";
import { Value } from "typebox/value";
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";

console.log = (...values: unknown[]) => console.error(...values);
if (!isMainThread) {
  const data: unknown = workerData;
  if (!data || typeof data !== "object" || !("deadline" in data) || typeof data.deadline !== "number" ||
    !Number.isSafeInteger(data.deadline) || data.deadline > Date.now() + L.timeoutMs ||
    !("rssBytes" in data) || typeof data.rssBytes !== "number" || data.rssBytes < 1 || data.rssBytes > L.rssMiB * 1024 * 1024) throw new Error("Invalid owned document watchdog boundary.");
  const { deadline, rssBytes } = data;
  const check = () => {
    if (Date.now() >= deadline || process.memoryUsage().rss > rssBytes) process.kill(process.pid, "SIGKILL");
  };
  check(); setInterval(check, 25); parentPort!.postMessage("ready");
} else {
  const watchdog = new Worker(new URL(import.meta.url), { workerData: { deadline: Date.now() + L.timeoutMs, rssBytes: L.rssMiB * 1024 * 1024 },
    resourceLimits: { maxOldGenerationSizeMb: 32, maxYoungGenerationSizeMb: 8, stackSizeMb: 2 } });
  let stopping = false;
  watchdog.on("exit", () => { if (!stopping) process.kill(process.pid, "SIGKILL"); });
  try {
    await new Promise<void>((resolve, reject) => { watchdog.once("message", (value) => value === "ready" ? resolve() : reject(new Error("Invalid watchdog readiness."))); watchdog.once("error", reject); });
    const { DocumentExtractionError, extractDocument } = await import("./document-extract.ts");
    const format = process.argv[2];
    if (!Value.Check(DocumentFormatSchema, format)) throw new DocumentExtractionError("document_format", "Choose PDF, DOCX or XLSX.");
    const buffers: Buffer[] = []; let bytes = 0;
    for await (const chunk of process.stdin) {
      const value = Buffer.from(chunk); bytes += value.length;
      if (bytes > L.originalBytes) throw new DocumentExtractionError("document_limit", "The document exceeds 8 MiB.");
      buffers.push(value);
    }
    const document = await extractDocument(Buffer.concat(buffers), format);
    process.stdout.write(JSON.stringify({ ok: true, document, maxRssKiB: process.resourceUsage().maxRSS }));
  } catch (error) {
    const known = error instanceof Error && "code" in error && typeof error.code === "string" && error.code.startsWith("document_");
    process.stdout.write(JSON.stringify({ ok: false, code: known ? error.code : "document_parse",
      message: known ? error.message : error instanceof Error && error.name === "PasswordException" ? "Encrypted/password-protected documents are unsupported." : "Document parsing failed: malformed or unsupported content. Nothing was attached." }));
    process.exitCode = 1;
  } finally {
    stopping = true; await watchdog.terminate();
  }
}
