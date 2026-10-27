import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { stripVTControlCharacters } from "node:util";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import { isRecord, MoguriError } from "../../../packages/protocol/src/core.ts";
import { MAX_SPEECH_SAMPLES } from "../../../packages/protocol/src/audio.ts";

export interface SpeechServer {
  origin: string; key: string;
  readonly closed: boolean;
  close(): Promise<void>;
}
export interface SpeechStream {
  append(bytes: Uint8Array): Promise<void>;
  finish(): Promise<{ text: string }>;
  cancel(): Promise<void>;
}

export async function startSpeechServer(executable: string, prefix: string[], model: string, backend: string, signal: AbortSignal, own?: (server: SpeechServer) => void): Promise<SpeechServer> {
  signal.throwIfAborted();
  const reservation = createServer();
  await new Promise<void>((resolve, reject) => { reservation.once("error", reject); reservation.listen(0, "127.0.0.1", resolve); });
  const address = reservation.address();
  await new Promise<void>((resolve, reject) => reservation.close((error) => error ? reject(error) : resolve()));
  if (!address || typeof address === "string") throw new MoguriError("speech_listener", "The private local recognizer did not obtain an exact loopback port.");
  signal.throwIfAborted();
  const origin = `http://127.0.0.1:${address.port}`, key = randomBytes(32).toString("base64url");
  const host = fileURLToPath(new URL(import.meta.url.endsWith(".ts") ? "./speech-host.ts" : "./speech-host.mjs", import.meta.url));
  const child = spawn(process.execPath, [host, executable, ...prefix, "--json", "serve", "--host", "127.0.0.1", "--port", String(address.port),
    "--asr-model", model, "--backend", backend, "--no-ui", "--threads", "2", "--max-upload-mb", "8", "--read-timeout", "180", "--write-timeout", "60"], {
    stdio: ["pipe", "pipe", "pipe"], env: { PATH: process.env.PATH, HOME: process.env.HOME, NO_COLOR: "1", NEMO_SPEECH_HTTP_API_KEY: key },
  });
  const ready = Promise.withResolvers<SpeechServer>(), exited = Promise.withResolvers<void>();
  let ended = false, stopping: Promise<void> | undefined, buffered = "", diagnostic = "", bytes = 0;
  const detail = () => stripVTControlCharacters(diagnostic).replaceAll(key, "[redacted]").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim().slice(-1200);
  const close = () => stopping ??= (async () => {
    if (ended) return;
    child.kill("SIGTERM");
    const escalation = setTimeout(() => child.kill("SIGKILL"), 3000);
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([exited.promise, new Promise<never>((_, reject) => {
        deadline = setTimeout(() => reject(new MoguriError("speech_partial", "The exact private recognizer did not acknowledge process cleanup. No replacement microphone or recognizer was started.", 409)), 6000);
      })]);
    } finally { clearTimeout(escalation); clearTimeout(deadline); }
  })();
  const owner: SpeechServer = { origin, key, close, get closed() { return ended || Boolean(stopping); } };
  own?.(owner);
  child.once("error", () => { ended = true; exited.resolve(); ready.reject(new MoguriError("speech_spawn", "The pinned local streaming recognizer could not start. Check its installed runtime; no cloud fallback was used.")); });
  child.once("close", (code, exitSignal) => {
    ended = true; exited.resolve();
    ready.reject(new MoguriError("speech_server", `Local streaming recognition stopped (${exitSignal ?? code ?? "unknown"}).${detail() ? ` ${detail()}` : " Check the selected backend and verified local model."}`));
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => { diagnostic = (diagnostic + chunk).slice(-4096); });
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    bytes += Buffer.byteLength(chunk);
    if (bytes > 128 * 1024) { ready.reject(new MoguriError("speech_protocol", "The private recognizer exceeded its bounded startup output.")); void close().catch((error: unknown) => console.error("Streaming recognizer cleanup failed:", error instanceof MoguriError ? error.code : "speech_partial")); return; }
    buffered += chunk;
    let newline: number;
    while ((newline = buffered.indexOf("\n")) >= 0) {
      const line = buffered.slice(0, newline).trim(); buffered = buffered.slice(newline + 1);
      if (!line.startsWith("{")) { diagnostic = (diagnostic + line).slice(-4096); continue; }
      let event: unknown;
      try { event = JSON.parse(line); } catch { ready.reject(new MoguriError("speech_protocol", "The pinned recognizer emitted malformed readiness metadata.")); continue; }
      if (isRecord(event) && event.event === "listener.ready") {
        if (event.transport !== "http" || event.url !== `${origin}/` || !Array.isArray(event.capabilities) || !event.capabilities.includes("asr")) {
          ready.reject(new MoguriError("speech_protocol", "The recognizer did not confirm the exact owned loopback ASR listener. No other endpoint was used.")); continue;
        }
        ready.resolve(owner);
      }
    }
  });
  const abort = () => ready.reject(signal.reason ?? new DOMException("Streaming recognition cancelled.", "AbortError"));
  signal.addEventListener("abort", abort, { once: true });
  const deadline = setTimeout(() => ready.reject(new MoguriError("speech_timeout", `The local streaming model did not become ready within sixty seconds.${detail() ? ` ${detail()}` : ""}`)), 60_000);
  try { signal.throwIfAborted(); return await ready.promise; }
  catch (error) { await close(); throw error; }
  finally { clearTimeout(deadline); signal.removeEventListener("abort", abort); }
}

export async function openSpeechStream(server: SpeechServer, language: string, signal: AbortSignal, changed: (text: string) => void): Promise<SpeechStream> {
  signal.throwIfAborted();
  const socket = new WebSocket(`${server.origin.replace(/^http:/, "ws:")}/v1/audio/transcriptions/realtime`, {
    headers: { Authorization: `Bearer ${server.key}` }, handshakeTimeout: 10_000, maxPayload: 128 * 1024,
  });
  const ready = Promise.withResolvers<void>(), complete = Promise.withResolvers<{ text: string }>(), closed = Promise.withResolvers<void>();
  void complete.promise.catch(() => {});
  const finals: string[] = [];
  let partial = "", text = "", bytes = 0, committed = false, settled = false, failure: Error | undefined, cancellation: Promise<void> | undefined;
  const fail = (error: Error) => { failure ??= error; ready.reject(error); complete.reject(error); };
  const publish = () => {
    text = finals.join(" ") + (partial && finals.length ? " " : "") + partial;
    if (Buffer.byteLength(text) > 128 * 1024 || !text.isWellFormed()) throw new MoguriError("speech_limit", "The exact local transcript exceeded its text bound or was invalid. Already inserted text was preserved.");
    changed(text);
  };
  const send = (value: string | Uint8Array) => new Promise<void>((resolve, reject) => {
    if (failure || socket.readyState !== WebSocket.OPEN) { reject(failure ?? new MoguriError("speech_socket", "The original streaming connection is no longer open.")); return; }
    socket.send(value, (error) => error ? reject(new MoguriError("speech_socket", "The original audio frame was not acknowledged by its local transport. It was not replayed.")) : resolve());
  });
  socket.on("message", (data, binary) => {
    if (signal.aborted || failure) return;
    try {
      if (binary) throw new MoguriError("speech_protocol", "The transcription endpoint returned unexpected binary data.");
      const event: unknown = JSON.parse(data.toString());
      if (!isRecord(event) || typeof event.type !== "string") throw new MoguriError("speech_protocol", "The recognizer returned an invalid realtime event.");
      switch (event.type) {
        case "session.created":
          if (!isRecord(event.session) || event.session.sample_rate !== 16_000) throw new MoguriError("speech_protocol", "The recognizer did not confirm mono 16-kHz audio. No rate was relabelled.");
          void send(JSON.stringify({ type: "session.update", session: { sample_rate: 16_000, automatic_punctuation: true,
            ...(language === "auto" ? {} : { language }), endpointing_ms: 800 } })).catch((error: unknown) => fail(error instanceof Error ? error : new Error("Local stream configuration failed.")));
          break;
        case "session.updated": ready.resolve(); break;
        case "conversation.item.input_audio_transcription.delta":
          if (typeof event.delta !== "string") throw new MoguriError("speech_protocol", "The recognizer omitted its partial transcript.");
          partial += event.delta; publish(); break;
        case "conversation.item.input_audio_transcription.completed":
          if (typeof event.transcript !== "string") throw new MoguriError("speech_protocol", "The recognizer omitted its final transcript.");
          if (event.transcript.trim()) finals.push(event.transcript.trim());
          partial = ""; publish(); break;
        case "input_audio_buffer.committed":
          if (!text.trim()) throw new MoguriError("speech_empty", "No speech was recognized. Existing draft text was preserved.");
          if (!committed || partial) throw new MoguriError("speech_protocol", "The recognizer did not acknowledge a complete final transcript. Already inserted text was preserved.");
          complete.resolve({ text: text.trim() }); break;
        case "input_audio_buffer.cleared": break;
        case "error": throw new MoguriError("speech_failed", "The pinned local recognizer rejected this audio stream. Check the selected language/backend; already inserted text is preserved.");
        default: throw new MoguriError("speech_protocol", "The pinned recognizer returned an unsupported realtime event. No transcript or endpoint was substituted.");
      }
    } catch (error) { fail(error instanceof MoguriError ? error : new MoguriError("speech_protocol", "The recognizer returned malformed realtime metadata.")); }
  });
  socket.once("error", () => fail(new MoguriError("speech_socket", "The private local recognition transport failed. No audio was sent to a different endpoint.")));
  socket.once("close", () => { closed.resolve(); if (!settled) fail(new MoguriError("speech_partial", "The original recognizer connection closed before final acknowledgement. Already inserted text is preserved.", 409)); });
  const cancel = () => cancellation ??= (async () => {
    fail(new DOMException("The original streaming capture was cancelled.", "AbortError"));
    settled = true; socket.terminate();
    await server.close();
  })();
  const abort = () => { void cancel().catch((error: unknown) => console.error("Original streaming recognition cleanup failed:", error instanceof MoguriError ? error.code : "speech_partial")); };
  signal.addEventListener("abort", abort, { once: true });
  const startup = setTimeout(() => fail(new MoguriError("speech_timeout", "The private recognizer did not acknowledge its stream configuration.")), 15_000);
  try { signal.throwIfAborted(); await ready.promise; }
  catch (error) { signal.removeEventListener("abort", abort); await cancel(); throw error; }
  finally { clearTimeout(startup); }
  return {
    append: async (pcm) => {
      signal.throwIfAborted();
      if (committed || settled || !pcm.length || pcm.length % 2 || pcm.length > 64 * 1024 || bytes + pcm.length > MAX_SPEECH_SAMPLES * 2) throw new MoguriError("speech_audio", "Use the next bounded PCM16 frame of the original recording. No audio was replayed or truncated.");
      bytes += pcm.length; await send(pcm);
    },
    finish: async () => {
      if (committed) throw new MoguriError("speech_capture_no_replay", "The original audio buffer was already committed.");
      signal.throwIfAborted(); committed = true;
      let deadline: ReturnType<typeof setTimeout> | undefined, closing: ReturnType<typeof setTimeout> | undefined;
      try {
        await send(JSON.stringify({ type: "input_audio_buffer.commit" }));
        const result = await Promise.race([complete.promise, new Promise<never>((_, reject) => {
          deadline = setTimeout(() => reject(new MoguriError("speech_finalize_timeout", "The local recognizer did not flush its original buffer within sixty seconds. Already inserted text is preserved.")), 60_000);
        })]);
        signal.throwIfAborted(); settled = true; socket.close(1000);
        await Promise.race([closed.promise, new Promise<never>((_, reject) => {
          closing = setTimeout(() => reject(new MoguriError("speech_partial", "The original recognizer did not acknowledge stream cleanup.", 409)), 3000);
        })]);
        return result;
      } catch (error) { await cancel(); throw error; }
      finally { clearTimeout(deadline); clearTimeout(closing); signal.removeEventListener("abort", abort); }
    },
    cancel: async () => { signal.removeEventListener("abort", abort); if (cancellation) await cancellation; else if (!settled) await cancel(); },
  };
}
