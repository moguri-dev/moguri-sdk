import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { isUtf8 } from "node:buffer";
import { performance } from "node:perf_hooks";
import { Type } from "typebox";
import type { DebugProtocol } from "@vscode/debugprotocol";
import { isRecord, MoguriError, parse } from "../../../packages/protocol/src/core.ts";
import { DebugToolSchema } from "../../../packages/protocol/src/tooling.ts";
import { stopGroup } from "./supervisor.ts";

const responseSchema = Type.Object({
  type: Type.Literal("response"), seq: Type.Integer({ minimum: 0 }), request_seq: Type.Integer({ minimum: 1 }),
  command: Type.String(), success: Type.Boolean(), message: Type.Optional(Type.String()), body: Type.Optional(Type.Unknown()),
});
const mutates = (command: string) => !["initialize", "threads", "stackTrace", "scopes", "variables"].includes(command);
export type DebugProcessOutcome = "completed" | "stopped" | "failed" | "partial";
export class OwnedDebugRuntime {
  private child: ChildProcessWithoutNullStreams | undefined;
  private sequence = 0;
  private buffer: Buffer = Buffer.alloc(0);
  private pending = new Map<number, { command: string; resolve(value: DebugProtocol.Response): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  private events: unknown[] = [];
  private omittedEvents = 0;
  private stderr = "";
  private closing: Promise<boolean> | undefined;
  private ended: ((pid: number, outcome: DebugProcessOutcome) => Promise<void>) | undefined;
  private removeAbort: (() => void) | undefined;
  private target: "none" | "launch" | "attach" = "none";
  private disconnected = false;
  get quiescent(): boolean { return !this.child && !this.pending.size; }

  private rejectPending(message: string) {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new MoguriError(mutates(pending.command) ? "tool_partial" : "dap_failed", message));
      this.pending.delete(id);
    }
  }
  private write(value: unknown): void {
    if (!this.child || this.child.stdin.destroyed) throw new MoguriError("dap_closed", "The owned adapter is not writable. No adapter or target was substituted.");
    const body = JSON.stringify(value);
    this.child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`, (error) => {
      if (error) this.rejectPending("The adapter did not acknowledge input. A dispatched debugger action may already have happened.");
    });
  }
  private receive(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    try {
      while (this.buffer.length) {
        const end = this.buffer.indexOf("\r\n\r\n");
        if (end < 0) { if (this.buffer.length > 4096) throw new Error("DAP header exceeds 4 KiB."); return; }
        const matches = [...this.buffer.subarray(0, end).toString("ascii").matchAll(/^Content-Length:\s*(\d+)\s*$/gim)];
        const bytes = matches.length === 1 ? Number(matches[0]![1]) : NaN;
        if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > 512 * 1024 || end > 4096) throw new Error("DAP requires one bounded Content-Length header.");
        if (this.buffer.length < end + 4 + bytes) return;
        const body = this.buffer.subarray(end + 4, end + 4 + bytes);
        this.buffer = this.buffer.subarray(end + 4 + bytes);
        if (!isUtf8(body)) throw new Error("DAP output is not valid UTF-8.");
        const value: unknown = JSON.parse(body.toString("utf8"));
        if (!isRecord(value)) throw new Error("DAP returned a non-object.");
        if (value.type === "response") {
          const response = parse(responseSchema, value), pending = this.pending.get(response.request_seq);
          if (!pending || pending.command !== response.command) throw new Error("DAP response does not match an actual pending request.");
          clearTimeout(pending.timer); this.pending.delete(response.request_seq); pending.resolve(response);
        } else if (value.type === "request" && typeof value.seq === "number" && typeof value.command === "string") {
          this.write({ seq: ++this.sequence, type: "response", request_seq: value.seq, command: value.command, success: false,
            message: "Reverse requests cannot spawn a terminal or execute unreviewed client code. Configure a stdio adapter with its own reviewed launch boundary." });
        } else if (value.type === "event" && typeof value.event === "string") {
          this.events.push(value);
          while (this.events.length > 20 || Buffer.byteLength(JSON.stringify(this.events)) > 16000) { this.events.shift(); this.omittedEvents++; }
        } else throw new Error("Unsupported DAP frame.");
      }
    } catch (error) {
      this.rejectPending(`Invalid debugger output: ${error instanceof Error ? error.message : "protocol failure"}. No successful action was inferred.`);
      void this.close();
    }
  }
  private request(command: string, args: Record<string, unknown>, signal: AbortSignal, timeoutMs = 15000): Promise<DebugProtocol.Response> {
    signal.throwIfAborted();
    const id = ++this.sequence;
    const result = new Promise<DebugProtocol.Response>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new MoguriError(mutates(command) ? "tool_partial" : "dap_timeout", `DAP ${command} exceeded ${timeoutMs} ms. A dispatched action was not replayed.`));
      }, timeoutMs);
      this.pending.set(id, { command, resolve, reject, timer });
      try { this.write({ seq: id, type: "request", command, arguments: args }); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
    const cancel = () => {
      const pending = this.pending.get(id);
      if (!pending) return;
      clearTimeout(pending.timer); this.pending.delete(id);
      pending.reject(new MoguriError(mutates(command) ? "tool_partial" : "dap_cancelled", "Debugger request was cancelled. Actual target effects may already have occurred."));
    };
    signal.addEventListener("abort", cancel, { once: true });
    return result.finally(() => signal.removeEventListener("abort", cancel));
  }
  async execute(root: string, input: Record<string, unknown>, signal: AbortSignal, started: (pid: number) => void,
    ended: (pid: number, outcome: DebugProcessOutcome) => Promise<void>) {
    const args = parse(DebugToolSchema, input);
    if (args.action === "stop") {
      const clean = await this.close();
      return { text: JSON.stringify({ adapter: clean ? "stopped" : "cleanup-unconfirmed", boundary: "Known adapter group only; external attached targets are not adopted or implicitly terminated." }), isError: !clean, outcome: clean ? "completed" : "partial" };
    }
    if (args.action === "start") {
      if (this.child || !args.adapter) throw new MoguriError("dap_adapter", "Select one exact adapter executable and stop any existing owned adapter first.");
      this.closing = undefined; this.buffer = Buffer.alloc(0); this.events = []; this.stderr = ""; this.omittedEvents = 0; this.ended = ended; this.target = "none"; this.disconnected = false;
      const child = spawn(args.adapter, args.args ?? [], { cwd: root, detached: true, stdio: ["pipe", "pipe", "pipe"],
        env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: root, LANG: "en_US.UTF-8" } });
      this.child = child;
      child.stdout.on("data", (chunk: Buffer) => this.receive(chunk));
      child.stderr.on("data", (chunk: Buffer) => { this.stderr = (this.stderr + chunk.toString("utf8")).slice(-8000); });
      child.stdin.on("error", () => this.rejectPending("The adapter input stream closed; debugger effects may be unconfirmed."));
      child.on("error", (error) => this.rejectPending(`The selected adapter failed: ${error.message}. No installation or fallback was attempted.`));
      child.on("close", () => { this.rejectPending("The owned adapter exited before a response."); void this.close(); });
      await new Promise<void>((resolve, reject) => { child.once("spawn", () => { started(child.pid!); resolve(); }); child.once("error", reject); });
      const cancel = () => { void this.close(); };
      signal.addEventListener("abort", cancel, { once: true });
      this.removeAbort = () => signal.removeEventListener("abort", cancel);
      const response = await this.request("initialize", { clientID: "moguri", clientName: "Moguri", adapterID: args.adapter,
        pathFormat: "path", linesStartAt1: true, columnsStartAt1: true, supportsRunInTerminalRequest: false }, signal);
      if (!response.success) { await this.close(); throw new MoguriError("dap_initialize", response.message ?? "Adapter initialization failed."); }
      return { text: JSON.stringify({ adapter: "running", pid: child.pid, initialized: true, capabilities: response.body, boundary: "Actual approved stdio adapter; no target was inferred." }), isError: false, outcome: "completed" };
    }
    if (!args.command || !this.child) throw new MoguriError("dap_request", "Start an owned adapter and select one DAP request. No target was guessed.");
    if (args.command === "launch" || args.command === "attach") {
      if (this.target !== "none") throw new MoguriError("dap_target", "This adapter already owns a dispatched target. Disconnect it before selecting another.");
      this.target = args.command;
    }
    const start = performance.now(), response = await this.request(args.command, args.arguments ?? {}, signal);
    if (args.command === "disconnect" && response.success) {
      this.disconnected = true;
      if (!await this.close()) return { text: "DAP disconnect was acknowledged, but adapter group cleanup was not confirmed. Inspect before resuming.", isError: true, outcome: "partial" };
    }
    const result = { response, events: this.events, omittedEvents: this.omittedEvents, elapsedMs: performance.now() - start, stderr: this.stderr };
    const rawText = JSON.stringify(result);
    if (rawText.length > 512 * 1024) throw new MoguriError(mutates(args.command) ? "tool_partial" : "dap_limit", "The debugger response exceeded its retained bound. Narrow the request; no complete response was invented.");
    return { text: rawText.length <= 12000 ? rawText : JSON.stringify({ command: args.command, success: response.success, complete: false, preview: rawText.slice(0, 8000), elapsedMs: result.elapsedMs }),
      rawText, rawComplete: this.omittedEvents === 0, isError: !response.success, outcome: response.success ? "completed" : "failed" };
  }
  close(): Promise<boolean> {
    if (this.closing) return this.closing;
    const child = this.child;
    if (!child) return Promise.resolve(true);
    this.closing = (async () => {
      this.removeAbort?.(); this.removeAbort = undefined;
      this.rejectPending("The owning debugger was stopped. No pending action was replayed.");
      let disconnected = this.disconnected;
      if (!disconnected && child.exitCode === null && child.signalCode === null && !child.stdin.destroyed) {
        try {
          const response = await this.request("disconnect", { terminateDebuggee: this.target === "launch", suspendDebuggee: false }, new AbortController().signal, 1000);
          disconnected = response.success;
          if (!response.success) console.error("Owned DAP disconnect was rejected:", response.message ?? "No successful target disposition was acknowledged.");
        } catch (error) { console.error("Owned DAP disconnect was not acknowledged:", error instanceof Error ? error.message : "Unknown transport failure."); }
      }
      const groupClean = child.pid ? await stopGroup(child.pid) : true;
      const clean = groupClean && (disconnected || this.target === "none");
      try { if (child.pid) await this.ended?.(child.pid, clean ? "stopped" : "partial"); }
      catch (error) { console.error("Debugger cleanup acknowledgement failed:", error instanceof Error ? error.message : "unknown"); return false; }
      finally { this.child = undefined; }
      return clean;
    })();
    return this.closing;
  }
}
