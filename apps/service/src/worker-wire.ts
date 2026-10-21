import { EventEmitter } from "node:events";
import type { Readable, Writable } from "node:stream";
import { createHash } from "node:crypto";
import { stripVTControlCharacters } from "node:util";

export const MAX_WORKER_FRAME = 32 * 1024 * 1024;
export const TTY_FRAME_PREFIX = "MOGURI_PTY_V1:";
export const frameDigest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function sendFrame(channel: JsonLineChannel, value: unknown, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const stopped = () => { signal.removeEventListener("abort", stopped); reject(signal.reason); };
    signal.addEventListener("abort", stopped, { once: true });
    try { channel.send(value, (error) => { signal.removeEventListener("abort", stopped); if (error) reject(error); else resolve(); }); }
    catch (error) { signal.removeEventListener("abort", stopped); reject(error); }
  });
}
export class JsonLineChannel extends EventEmitter<{ message: [unknown]; error: [Error]; close: []; diagnostic: [string] }> {
  private text = "";
  private bytes = 0;
  private pending = 0;
  private closed = false;
  constructor(readonly input: Readable, readonly output: Writable, private readonly tty = false, private readonly maxFrameBytes = MAX_WORKER_FRAME) {
    super();
    if (!Number.isSafeInteger(maxFrameBytes) || maxFrameBytes < 1 || maxFrameBytes > MAX_WORKER_FRAME) throw new Error("Control frame limit must be a positive safe byte count within the worker ceiling.");
    const wireLimit = tty ? Math.ceil(maxFrameBytes * 4 / 3) + TTY_FRAME_PREFIX.length + 4 : maxFrameBytes;
    const decoder = new TextDecoder("utf-8", { fatal: true });
    input.on("data", (data: Buffer) => {
      if (this.closed) return;
      this.bytes += data.length;
      try { this.text += decoder.decode(data, { stream: true }); }
      catch { this.fail(new Error("Worker control frame contains invalid UTF-8.")); return; }
      let end: number;
      while (!this.closed && (end = this.text.indexOf("\n")) >= 0) {
        let line = this.text.slice(0, end);
        if (Buffer.byteLength(line) + 1 > wireLimit) { this.fail(new Error("Worker control frame exceeded its bounded wire limit.")); return; }
        this.text = this.text.slice(end + 1); this.bytes = Buffer.byteLength(this.text);
        try {
          if (tty) {
            line = stripVTControlCharacters(line).trim();
            const start = line.indexOf(TTY_FRAME_PREFIX);
            if (start < 0) { if (line) this.emit("diagnostic", line.slice(0, 4096)); continue; }
            if (start > 0) this.emit("diagnostic", line.slice(0, Math.min(start, 4096)));
            const encoded = line.slice(start + TTY_FRAME_PREFIX.length);
            const value = Buffer.from(encoded, "base64");
            if (value.toString("base64") !== encoded || value.length + 1 > this.maxFrameBytes) throw new Error("Invalid or oversized canonical TTY worker frame.");
            line = new TextDecoder("utf-8", { fatal: true }).decode(value);
          }
          this.emit("message", JSON.parse(line));
        }
        catch (error) { this.fail(error instanceof Error ? error : new Error("Invalid worker control frame.")); }
      }
      if (this.bytes > wireLimit) this.fail(new Error("Worker control frame exceeded its bounded wire limit."));
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
    const json = JSON.stringify(value), frame = this.tty ? `${TTY_FRAME_PREFIX}${Buffer.from(json).toString("base64")}\n` : `${json}\n`, bytes = Buffer.byteLength(frame);
    if (Buffer.byteLength(json) + 1 > this.maxFrameBytes || this.pending + bytes > this.maxFrameBytes * 2) {
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
