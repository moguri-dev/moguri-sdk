import { EventEmitter } from "node:events";
import type { Readable, Writable } from "node:stream";
import { createHash } from "node:crypto";

export const MAX_WORKER_FRAME = 32 * 1024 * 1024;
export const frameDigest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export class JsonLineChannel extends EventEmitter<{ message: [unknown]; error: [Error]; close: [] }> {
  private text = "";
  private bytes = 0;
  private pending = 0;
  private closed = false;
  constructor(readonly input: Readable, readonly output: Writable) {
    super();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    input.on("data", (data: Buffer) => {
      if (this.closed) return;
      this.bytes += data.length;
      try { this.text += decoder.decode(data, { stream: true }); }
      catch { this.fail(new Error("Worker control frame contains invalid UTF-8.")); return; }
      let end: number;
      while (!this.closed && (end = this.text.indexOf("\n")) >= 0) {
        const line = this.text.slice(0, end);
        if (Buffer.byteLength(line) + 1 > MAX_WORKER_FRAME) { this.fail(new Error("Worker control frame exceeded 32 MiB.")); return; }
        this.text = this.text.slice(end + 1); this.bytes = Buffer.byteLength(this.text);
        try { this.emit("message", JSON.parse(line)); }
        catch (error) { this.fail(error instanceof Error ? error : new Error("Invalid worker control frame.")); }
      }
      if (this.bytes > MAX_WORKER_FRAME) this.fail(new Error("Worker control frame exceeded 32 MiB."));
    });
    input.on("end", () => {
      try { this.text += decoder.decode(); } catch { this.fail(new Error("Worker control frame ended with invalid UTF-8.")); return; }
      if (this.text.length) this.fail(new Error("Worker channel ended with an incomplete frame."));
      else this.finish();
    });
    input.on("error", (error: Error) => this.fail(error));
    output.on("error", (error: Error) => this.fail(error));
  }
  send(value: unknown, callback?: (error: Error | null) => void): void {
    if (this.closed) { callback?.(new Error("Worker control channel closed.")); return; }
    const frame = `${JSON.stringify(value)}\n`, bytes = Buffer.byteLength(frame);
    if (bytes > MAX_WORKER_FRAME || this.pending + bytes > MAX_WORKER_FRAME * 2) {
      const error = new Error("Worker control output exceeded its bounded frame/queue limit.");
      callback?.(error); this.fail(error); return;
    }
    this.pending += bytes;
    this.output.write(frame, (error) => { this.pending -= bytes; callback?.(error ?? null); if (error) this.fail(error); });
  }
  end(): void { if (!this.output.writableEnded && !this.output.destroyed) this.output.end(); this.finish(); }
  private fail(error: Error): void { if (!this.closed) { this.emit("error", error); this.finish(); } }
  private finish(): void { if (!this.closed) { this.closed = true; this.emit("close"); } }
}
