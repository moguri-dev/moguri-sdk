import { spawn, execFile } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { Value } from "typebox/value";
import { DOCUMENT_LIMITS as L, DocumentDataSchema, type DocumentData, type DocumentFormat } from "../../../packages/protocol/src/documents.ts";
import { MoguriError, isRecord } from "../../../packages/protocol/src/core.ts";

let activeWorkers = 0;
export interface DocumentParserOptions { workerPath?: string; timeoutMs?: number; rssMiB?: number }
export class DocumentParsers {
  private readonly active = new Map<string, { abort: AbortController; done: Promise<unknown> }>();
  private closed = false;
  readonly options: DocumentParserOptions;
  constructor(options: DocumentParserOptions = {}) { this.options = options; }
  parse(key: string, bytes: Buffer, format: DocumentFormat, signal?: AbortSignal): Promise<{ document: DocumentData; maxRssKiB: number }> {
    return this.capture(key, async () => bytes, format, signal);
  }
  capture(key: string, read: () => Promise<Buffer>, format: DocumentFormat, signal?: AbortSignal): Promise<{ document: DocumentData; maxRssKiB: number }> {
    if (this.closed || signal?.aborted) return Promise.reject(new MoguriError("document_cancelled", "Document capture was cancelled. The draft was preserved.", 409));
    if (activeWorkers >= L.concurrency || this.active.has(key)) return Promise.reject(new MoguriError("document_busy", "Two document parsers are already active, or this capture ID is in use. Retry explicitly; your draft was preserved.", 409));
    const abort = new AbortController();
    const cancel = () => abort.abort();
    signal?.addEventListener("abort", cancel, { once: true });
    activeWorkers++;
    const done = Promise.resolve().then(async () => {
      abort.signal.throwIfAborted();
      const bytes = await read();
      abort.signal.throwIfAborted();
      if (!bytes.length || bytes.length > L.originalBytes) throw new MoguriError("document_limit", "Documents must be nonempty and at most 8 MiB.");
      return this.run(bytes, format, abort.signal);
    }).finally(() => {
      signal?.removeEventListener("abort", cancel); this.active.delete(key); activeWorkers--;
    });
    this.active.set(key, { abort, done });
    return done;
  }
  private async settle(): Promise<void> {
    const captures = [...this.active.values()];
    for (const capture of captures) capture.abort.abort();
    await Promise.allSettled(captures.map((capture) => capture.done));
  }
  async close(): Promise<void> { this.closed = true; await this.settle(); }
  private run(bytes: Buffer, format: DocumentFormat, signal: AbortSignal): Promise<{ document: DocumentData; maxRssKiB: number }> {
    const path = this.options.workerPath ?? fileURLToPath(new URL(import.meta.url.endsWith(".ts") ? "../../../dist/document-worker.mjs" : "./document-worker.mjs", import.meta.url));
    const dependency = createRequire(import.meta.url).resolve("pdfjs-dist/package.json");
    if (!dependency.includes("/node_modules/")) throw new MoguriError("document_worker", "The parser dependencies have no qualified installed module boundary. No broader filesystem access was granted.");
    const modules = dependency.slice(0, dependency.indexOf("/node_modules/") + "/node_modules".length);
    const timeoutMs = Math.min(this.options.timeoutMs ?? L.timeoutMs, L.timeoutMs), rssMiB = Math.min(this.options.rssMiB ?? L.rssMiB, L.rssMiB);
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [`--max-old-space-size=${L.heapMiB}`, "--disallow-code-generation-from-strings", "--permission", "--allow-worker",
        `--allow-fs-read=${modules}`, `--allow-fs-read=${path}`, path, format], {
        stdio: ["pipe", "pipe", "pipe"], env: { NODE_NO_WARNINGS: "1" },
      });
      const chunks: Buffer[] = []; let outputBytes = 0, stderr = "", failure: MoguriError | undefined, sampling = false;
      const stop = (error: MoguriError) => { failure ??= error; child.kill("SIGKILL"); };
      const cancelled = () => stop(new MoguriError("document_cancelled", "Document capture was cancelled. The complete draft was preserved.", 409));
      signal.addEventListener("abort", cancelled, { once: true });
      if (signal.aborted) cancelled();
      const timeout = setTimeout(() => stop(new MoguriError("document_timeout", "Local document extraction exceeded 10 seconds (or the stricter configured test deadline). The draft was preserved.", 409)), timeoutMs);
      const memory = setInterval(() => {
        if (sampling || !child.pid || failure) return;
        sampling = true;
        execFile("/bin/ps", ["-o", "rss=", "-p", String(child.pid)], { timeout: 1000, maxBuffer: 1024, env: {} }, (error, stdout) => {
          sampling = false;
          if (child.exitCode !== null || child.signalCode || failure) return;
          if (error) { stop(new MoguriError("document_memory", "The parser's memory bound could not be observed. Capture stopped; the draft was preserved.", 409)); return; }
          const rss = Number(stdout.trim());
          if (!Number.isFinite(rss) || rss > rssMiB * 1024) stop(new MoguriError("document_memory", "The parser exceeded its observed memory ceiling. Capture stopped; the draft was preserved.", 409));
        });
      }, 50);
      child.stdout.on("data", (buffer: Buffer) => {
        outputBytes += buffer.length;
        if (outputBytes > L.outputBytes + 4096) stop(new MoguriError("document_limit", "Complete extraction exceeded 2 MiB; no content was truncated or attached."));
        else chunks.push(buffer);
      });
      child.stderr.on("data", (buffer: Buffer) => { if (stderr.length < 8192) stderr += buffer.toString("utf8").slice(0, 8192 - stderr.length); });
      child.stdin.on("error", (error: NodeJS.ErrnoException) => {
        if (!["EPIPE", "ERR_STREAM_DESTROYED"].includes(error.code ?? "")) stop(new MoguriError("document_worker", "Document bytes could not reach the owned parser. The draft was preserved."));
      });
      child.once("error", () => { failure ??= new MoguriError("document_worker", "The resource-bounded parser could not start. Build Moguri and retry explicitly; the draft was preserved."); });
      child.once("close", (code) => {
        clearTimeout(timeout); clearInterval(memory); signal.removeEventListener("abort", cancelled);
        if (failure) { reject(failure); return; }
        try {
          const result: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          if (isRecord(result) && result.ok === false && typeof result.code === "string" && typeof result.message === "string") throw new MoguriError(result.code, result.message);
          if (code !== 0 || !isRecord(result) || result.ok !== true || !Value.Check(DocumentDataSchema, result.document) ||
            result.document.format !== format || Buffer.byteLength(JSON.stringify(result.document)) > L.outputBytes || typeof result.maxRssKiB !== "number" || result.maxRssKiB > rssMiB * 1024) throw new MoguriError("document_worker", "The parser failed its output/memory contract. No incomplete extraction was attached.");
          resolve({ document: result.document, maxRssKiB: result.maxRssKiB });
        } catch (error) {
          if (!(error instanceof MoguriError)) console.error("Document parser terminated without a valid bounded result:", code, stderr.includes("heap") ? "heap limit" : "invalid worker output");
          reject(error instanceof MoguriError ? error : new MoguriError("document_worker", "Document parsing failed or exceeded its heap bound. No incomplete extraction was attached."));
        }
      });
      child.stdin.end(bytes);
    });
  }
}
