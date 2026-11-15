import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";
import { isRecord, MoguriError } from "../../../packages/protocol/src/core.ts";
import { MAX_SPEECH_SAMPLES } from "../../../packages/protocol/src/audio.ts";
import type { SpeechStream } from "./speech-stream.ts";

export interface TranscribeModelInfo { architecture: string; variant: string; backend: string; sampleRate: number; streaming: boolean; languages: string[] }
export interface TranscribeHost {
  readonly closed: boolean;
  request(message: Record<string, unknown>, timeoutMs?: number): Promise<Record<string, unknown>>;
  close(): Promise<void>;
}
const MAX_REPLY = 512 * 1024, MAX_TEXT = 128 * 1024;

export const defaultTranscribeHost = (library: string): string[] => [process.execPath, "--disable-warning=ExperimentalWarning",
  fileURLToPath(new URL(import.meta.url.endsWith(".ts") ? "./transcribe-host.ts" : "./transcribe-host.mjs", import.meta.url)), library];

/** The startup signal owns the host only until the caller unbinds it after readiness, like the NeMo listener. */
export function startTranscribeHost(command: string[], signal: AbortSignal, own?: (host: TranscribeHost) => void): { host: TranscribeHost; unbind: () => void } {
  signal.throwIfAborted();
  const [executable, ...args] = command;
  if (!executable) throw new MoguriError("speech_spawn", "The private transcribe host needs its exact configured command.");
  const child = spawn(executable, args, { stdio: ["pipe", "pipe", "pipe"], env: { PATH: process.env.PATH, HOME: process.env.HOME, NO_COLOR: "1" } });
  const pending: { resolve: (reply: Record<string, unknown>) => void; reject: (error: Error) => void }[] = [];
  const exited = Promise.withResolvers<void>();
  let ended = false, stopping: Promise<void> | undefined, buffered = "", diagnostic = "", failure: Error | undefined;
  const detail = () => stripVTControlCharacters(diagnostic).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim().slice(-1200);
  const fail = (error: Error) => { failure ??= error; for (const waiter of pending.splice(0)) waiter.reject(failure); };
  child.once("error", () => { ended = true; exited.resolve(); fail(new MoguriError("speech_spawn", "The pinned transcribe.cpp host could not start. Check its installed runtime; no cloud fallback was used.")); });
  child.once("close", (code, exitSignal) => {
    ended = true; exited.resolve();
    fail(new MoguriError("speech_server", `Local transcribe.cpp recognition stopped (${exitSignal ?? code ?? "unknown"}).${detail() ? ` ${detail()}` : ""}`));
  });
  child.stderr.setEncoding("utf8");
  child.stdin.on("error", () => fail(new MoguriError("speech_server", "The private transcribe host stopped accepting requests. No audio was replayed.")));
  child.stderr.on("data", (chunk: string) => { diagnostic = (diagnostic + chunk).slice(-4096); });
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    buffered += chunk;
    if (buffered.length > MAX_REPLY) { fail(new MoguriError("speech_protocol", "The private transcribe host exceeded its bounded reply.")); void close(); return; }
    let newline: number;
    while ((newline = buffered.indexOf("\n")) >= 0) {
      const line = buffered.slice(0, newline); buffered = buffered.slice(newline + 1);
      const waiter = pending.shift();
      let reply: unknown;
      try { reply = JSON.parse(line); } catch { reply = undefined; }
      if (!waiter || !isRecord(reply) || typeof reply.ok !== "boolean") { fail(new MoguriError("speech_protocol", "The private transcribe host returned an unrequested or malformed reply.")); void close(); return; }
      if (reply.ok) waiter.resolve(reply);
      else waiter.reject(new MoguriError("speech_failed", `${typeof reply.error === "string" ? reply.error.slice(0, 1000) : "The local transcribe.cpp recognizer failed."} Already inserted text is preserved; no cloud fallback was used.`));
    }
  });
  const close = () => stopping ??= (async () => {
    fail(new MoguriError("speech_server", "The private transcribe host was closed."));
    if (ended) return;
    child.stdin.end(); child.kill("SIGTERM");
    const escalation = setTimeout(() => child.kill("SIGKILL"), 3000);
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([exited.promise, new Promise<never>((_, reject) => {
        deadline = setTimeout(() => reject(new MoguriError("speech_partial", "The exact transcribe.cpp host did not acknowledge process cleanup. No replacement recognizer was started.", 409)), 6000);
      })]);
    } finally { clearTimeout(escalation); clearTimeout(deadline); }
  })();
  const host: TranscribeHost = {
    get closed() { return ended || Boolean(stopping); },
    request: (message, timeoutMs = 60_000) => {
      if (failure || host.closed) return Promise.reject(failure ?? new MoguriError("speech_server", "The private transcribe host is closed."));
      const reply = Promise.withResolvers<Record<string, unknown>>();
      pending.push(reply);
      child.stdin.write(`${JSON.stringify(message)}\n`);
      let timer: ReturnType<typeof setTimeout> | undefined;
      return Promise.race([reply.promise, new Promise<never>((_, reject) => {
        timer = setTimeout(() => { reject(new MoguriError("speech_timeout", "The local transcribe.cpp recognizer did not answer in time. It was stopped.")); void close(); }, timeoutMs);
      })]).finally(() => clearTimeout(timer));
    },
    close,
  };
  own?.(host);
  const abort = () => { void close().catch((error: unknown) => console.error("Transcribe host cleanup failed:", error instanceof MoguriError ? error.code : "speech_partial")); };
  const unbind = () => signal.removeEventListener("abort", abort);
  signal.addEventListener("abort", abort, { once: true });
  void exited.promise.then(unbind);
  return { host, unbind };
}

const modelInfo = (reply: Record<string, unknown>): TranscribeModelInfo => {
  const languages = Array.isArray(reply.languages) ? reply.languages.filter((value): value is string => typeof value === "string").slice(0, 512) : [];
  if (typeof reply.architecture !== "string" || typeof reply.streaming !== "boolean" || typeof reply.sampleRate !== "number") throw new MoguriError("speech_protocol", "The private transcribe host returned invalid model metadata.");
  return { architecture: reply.architecture.slice(0, 128), variant: typeof reply.variant === "string" ? reply.variant.slice(0, 128) : "",
    backend: typeof reply.backend === "string" ? reply.backend.slice(0, 64) : "", sampleRate: reply.sampleRate, streaming: reply.streaming, languages };
};

export async function probeTranscribeModel(command: string[], path: string, signal: AbortSignal): Promise<TranscribeModelInfo> {
  const { host, unbind } = startTranscribeHost(command, signal);
  try { return modelInfo(await host.request({ op: "probe", path, backend: "cpu" }, 120_000)); }
  finally { unbind(); await host.close(); }
}

export async function loadTranscribeModel(command: string[], path: string, backend: string, signal: AbortSignal, own?: (host: TranscribeHost) => void): Promise<TranscribeHost> {
  const { host, unbind } = startTranscribeHost(command, signal, own);
  try {
    const info = modelInfo(await host.request({ op: "load", path, backend }, 120_000));
    if (!info.streaming || info.sampleRate !== 16_000) throw new MoguriError("speech_model_streaming", "The trusted model no longer reports 16-kHz streaming. Review it again; no other model was used.", 409);
    signal.throwIfAborted();
    return host;
  } catch (error) { await host.close(); throw error; }
  finally { unbind(); }
}

export async function openTranscribeStream(host: TranscribeHost, signal: AbortSignal, changed: (text: string) => void): Promise<SpeechStream> {
  signal.throwIfAborted();
  let text = "", bytes = 0, committed = false, settled = false, cancellation: Promise<void> | undefined, queue = Promise.resolve();
  const publish = (value: unknown) => {
    if (typeof value !== "string" || Buffer.byteLength(value) > MAX_TEXT || !value.isWellFormed()) throw new MoguriError("speech_limit", "The exact local transcript exceeded its text bound or was invalid. Already inserted text was preserved.");
    const next = value.trim();
    if (next !== text) { text = next; changed(text); }
  };
  const cancel = () => cancellation ??= (async () => { settled = true; await host.close(); })();
  const abort = () => { void cancel().catch((error: unknown) => console.error("Original transcribe stream cleanup failed:", error instanceof MoguriError ? error.code : "speech_partial")); };
  signal.addEventListener("abort", abort, { once: true });
  const serial = <T>(work: () => Promise<T>): Promise<T> => { const next = queue.then(work); queue = next.then(() => {}, () => {}); return next; };
  try { await host.request({ op: "begin" }, 15_000); signal.throwIfAborted(); }
  catch (error) { signal.removeEventListener("abort", abort); await cancel(); throw error; }
  return {
    append: (pcm) => serial(async () => {
      signal.throwIfAborted();
      if (committed || settled || !pcm.length || pcm.length % 2 || pcm.length > 64 * 1024 || bytes + pcm.length > MAX_SPEECH_SAMPLES * 2) throw new MoguriError("speech_audio", "Use the next bounded PCM16 frame of the original recording. No audio was replayed or truncated.");
      bytes += pcm.length;
      try { publish((await host.request({ op: "feed", pcm: Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength).toString("base64") })).text); }
      catch (error) { await cancel(); throw error; }
    }),
    finish: () => serial(async () => {
      if (committed) throw new MoguriError("speech_capture_no_replay", "The original audio buffer was already committed.");
      signal.throwIfAborted(); committed = true;
      try {
        publish((await host.request({ op: "finish" })).text);
        signal.throwIfAborted();
        if (!text) throw new MoguriError("speech_empty", "No speech was recognized. Existing draft text was preserved.");
        settled = true; return { text };
      } catch (error) { await cancel(); throw error; }
      finally { signal.removeEventListener("abort", abort); }
    }),
    cancel: async () => { signal.removeEventListener("abort", abort); if (cancellation) await cancellation; else if (!settled) await cancel(); },
  };
}
