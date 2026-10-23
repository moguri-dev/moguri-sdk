import { createHash } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { createReadStream } from "node:fs";
import { access, mkdir, open, rename, stat, statfs, unlink } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";
import { MoguriError, type VoiceStatus, type UserSettings } from "../../../packages/protocol/src/index.ts";

export const NEMOTRON_MODEL = {
  id: "nvidia/nemotron-3.5-asr-streaming-0.6b",
  revision: "1c8deaecc64b91f034d73e08dd8b64625eb3395d",
  filename: "nemotron-3.5-asr-streaming-0.6b.q8_0.gguf",
  bytes: 741548352,
  sha256: "a5c435f294eea8f88ce68dd27b8c3bfea7f777cb2fbba04fcd30eaa555f429ae",
  license: "OpenMDW-1.1",
};
export const VOICE_LOCALES: VoiceStatus["languageLocales"] = [
  ...["en-US", "en-GB", "es-US", "es-ES", "fr-FR", "fr-CA", "it-IT", "pt-BR", "pt-PT", "nl-NL", "de-DE", "tr-TR", "ru-RU", "ar-AR", "hi-IN", "ja-JP", "ko-KR", "vi-VN", "uk-UA"].map((code) => ({ code, tier: "ready" as const })),
  ...["pl-PL", "sv-SE", "cs-CZ", "nb-NO", "da-DK", "bg-BG", "fi-FI", "hr-HR", "sk-SK", "zh-CN", "hu-HU", "ro-RO", "et-EE"].map((code) => ({ code, tier: "broad" as const })),
  ...["el-GR", "lt-LT", "lv-LV", "mt-MT", "sl-SI", "he-IL", "th-TH", "nn-NO"].map((code) => ({ code, tier: "adaptation" as const })),
];
export interface SpeechOptions {
  executable?: string;
  prefixArgs?: string[];
  model?: typeof NEMOTRON_MODEL;
  fetch?: typeof globalThis.fetch;
  modelDirectory?: string;
}
export class LocalDictation {
  private readonly executable: string;
  private readonly model;
  private readonly modelPath: string;
  private verified = "";
  private active = new Map<string, { child: ChildProcess | null; stopping: boolean; terminate?: (signal: NodeJS.Signals) => void }>();
  constructor(stateDir: string, private readonly options: SpeechOptions = {}) {
    this.executable = options.executable ?? fileURLToPath(new URL(import.meta.url.endsWith(".ts") ? "../../../.native/speech/bin/nemo-speech" : "./native/speech/bin/nemo-speech", import.meta.url));
    this.model = options.model ?? NEMOTRON_MODEL;
    this.modelPath = join(options.modelDirectory ?? join(stateDir, "speech-models"), this.model.filename);
  }
  async status(): Promise<VoiceStatus> {
    let runtimeReady = false;
    let modelReady = false;
    try { await access(this.executable, constants.X_OK); runtimeReady = true; }
    catch (error) { if (!(error instanceof Error && "code" in error && ["ENOENT", "EACCES"].includes(String(error.code)))) throw error; }
    try { const metadata = await stat(this.modelPath); modelReady = metadata.isFile() && metadata.size === this.model.bytes; }
    catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
    return {
      runtimeReady, modelReady, modelId: this.model.id, bytes: this.model.bytes, license: this.model.license,
      languageLocales: VOICE_LOCALES,
      diagnostic: !runtimeReady ? "Install the pinned local NeMo-Speech.cpp runtime. No cloud fallback is used." : !modelReady ? "Download the Nemotron model once after accepting its license. Recording never downloads it implicitly." : "Audio stays local. Model integrity is checked before use; adaptation-tier locales require fine-tuning.",
    };
  }
  async download(signal: AbortSignal, progress: (message: string) => void): Promise<{ installed: boolean; modelId: string }> {
    await mkdir(dirname(this.modelPath), { recursive: true, mode: 0o700 });
    const info = await statfs(dirname(this.modelPath));
    if (info.bavail * info.bsize < this.model.bytes * 2) throw new MoguriError("speech_disk", "Free at least twice the model download size before installing it.");
    if ((await this.status()).modelReady) {
      await this.verify(signal);
      return { installed: true, modelId: this.model.id };
    }
    const temporary = `${this.modelPath}.download`;
    const file = await open(temporary, "wx", 0o600).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "EEXIST") throw new MoguriError("speech_download_pending", "A speech download or interrupted staging file already exists. Inspect the .download file before retrying.", 409);
      throw error;
    });
    try {
      const response = await (this.options.fetch ?? fetch)(`https://huggingface.co/${this.model.id}/resolve/${this.model.revision}/${this.model.filename}`, { signal });
      if (!response.ok || !response.body) throw new MoguriError("speech_download", `The model download failed (${response.status}). No model was installed.`);
      let bytes = 0;
      let reported = 0;
      const hash = createHash("sha256");
      for await (const chunk of response.body) {
        signal.throwIfAborted();
        bytes += chunk.byteLength;
        if (bytes > this.model.bytes) throw new MoguriError("speech_integrity", "Model exceeded the pinned download size.");
        hash.update(chunk);
        let offset = 0;
        while (offset < chunk.byteLength) {
          signal.throwIfAborted();
          const { bytesWritten } = await file.write(chunk, offset, chunk.byteLength - offset);
          if (!bytesWritten) throw new MoguriError("speech_io", "The staged model could not be written completely. Nothing was installed.");
          offset += bytesWritten;
        }
        if (bytes - reported > 8 * 1024 * 1024) { progress(`Downloaded ${Math.floor(bytes / 1024 / 1024)} of ${Math.ceil(this.model.bytes / 1024 / 1024)} MiB.`); reported = bytes; }
      }
      if (bytes !== this.model.bytes || (await file.stat()).size !== bytes || hash.digest("hex") !== this.model.sha256) throw new MoguriError("speech_integrity", "Model size or SHA-256 did not match NVIDIA's pinned artifact. Nothing was installed.");
      signal.throwIfAborted();
      await file.sync(); await file.close();
      await rename(temporary, this.modelPath);
      this.verified = "";
      return { installed: true, modelId: this.model.id };
    } finally {
      await file.close();
      await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
    }
  }
  private async verify(signal: AbortSignal): Promise<void> {
    const status = await this.status();
    if (!status.runtimeReady || !status.modelReady) throw new MoguriError("speech_not_ready", status.diagnostic!, 409);
    const metadata = await stat(this.modelPath);
    const fingerprint = `${metadata.ino}:${metadata.size}:${metadata.mtimeMs}`;
    if (fingerprint === this.verified) return;
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(this.modelPath, { signal })) hash.update(chunk);
    if (hash.digest("hex") !== this.model.sha256) throw new MoguriError("speech_integrity", "Installed model integrity failed. Reinstall it explicitly; no download or cloud fallback was attempted.");
    this.verified = fingerprint;
  }
  async transcribe(jobId: string, source: string | "microphone", settings: UserSettings["voice"], signal: AbortSignal, progress: (message: string) => void = () => {}): Promise<{ text: string; modelId: string; language: string; source: "local" }> {
    if (source === "microphone" && settings.inputDeviceId && settings.inputDeviceId !== "default") throw new MoguriError("speech_input_device", "This native capture supports only the default microphone. Use the selected device through desktop capture, or explicitly choose Default in Voice settings. No device was substituted.", 409);
    const active: { child: ChildProcess | null; stopping: boolean; terminate?: (signal: NodeJS.Signals) => void } = { child: null, stopping: false };
    this.active.set(jobId, active);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let escalation: ReturnType<typeof setTimeout> | undefined;
    let finalization: ReturnType<typeof setTimeout> | undefined;
    const cancel = () => active.terminate?.("SIGTERM");
    try {
      progress("Verifying the local speech model. Your draft is unchanged.");
      await this.verify(signal);
      if (active.stopping) throw new MoguriError("speech_stopped", "Recording was stopped before microphone startup. No audio was captured and the draft is unchanged.", 409);
      if (settings.language !== "auto" && !VOICE_LOCALES.some((locale) => locale.code === settings.language && locale.tier !== "adaptation")) {
        throw new MoguriError("speech_language", "Choose auto or a ready/broad-coverage locale. Adaptation-tier languages are not claimed ready.");
      }
      if (source !== "microphone") {
        const metadata = await stat(source);
        if (!metadata.isFile() || metadata.size > 64 * 1024 * 1024 || !source.toLowerCase().endsWith(".wav")) throw new MoguriError("speech_audio", "Select a regular PCM WAV file up to 64 MiB. Convert unsupported audio explicitly.");
      }
      signal.throwIfAborted();
      if (active.stopping) throw new MoguriError("speech_stopped", "Recording was stopped before microphone startup. No audio was captured and the draft is unchanged.", 409);
      const args = [...(this.options.prefixArgs ?? []), "--quiet", "transcribe", ...(source === "microphone" ? ["--live"] : [source]), "--model", this.modelPath, "--format", "text", "--language", settings.language, "--backend", settings.backend];
      const child = spawn(this.executable, args, { stdio: ["ignore", "pipe", "pipe"], env: { PATH: process.env.PATH, HOME: process.env.HOME, NO_COLOR: "1" } });
      active.child = child;
      const chunks: Buffer[] = [];
      let diagnostic = Buffer.alloc(0);
      let bytes = 0;
      let oversized = false;
      let timedOut = false;
      let finishing = false, terminating = false, finalizationTimedOut = false;
      active.terminate = (requested) => {
        clearTimeout(timer);
        if (requested === "SIGINT") {
          if (finishing || terminating) return;
          finishing = true;
          progress("Finishing local transcription. Your draft is unchanged.");
          child.kill("SIGINT");
          finalization = setTimeout(() => { finalizationTimedOut = true; active.terminate!("SIGTERM"); }, 30_000);
        } else {
          if (terminating) return;
          terminating = true; clearTimeout(finalization);
          child.kill(requested);
          escalation = setTimeout(() => child.kill("SIGKILL"), 3000);
        }
      };
      progress(source === "microphone" ? "Local dictation is starting. Speak, then press Ctrl+Space to stop and transcribe." : "Transcribing the local WAV. Your draft is unchanged.");
      child.stdout.on("data", (chunk: Buffer) => {
        if (oversized) return;
        bytes += chunk.byteLength;
        if (bytes > 128 * 1024) { oversized = true; active.terminate!("SIGTERM"); }
        else chunks.push(chunk);
      });
      child.stderr.on("data", (chunk: Buffer) => { diagnostic = Buffer.concat([diagnostic, chunk]).subarray(-8192); });
      signal.addEventListener("abort", cancel, { once: true });
      if (signal.aborted) cancel();
      timer = setTimeout(() => {
        active.stopping = true;
        timedOut = source !== "microphone";
        active.terminate!(source === "microphone" ? "SIGINT" : "SIGTERM");
      }, source === "microphone" ? 120_000 : 300_000);
      const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
        child.once("close", (code, signal) => resolve({ code, signal }));
        child.once("error", (error) => reject(new MoguriError("speech_spawn", `Local speech could not start: ${error.message}. Your draft is unchanged.`)));
      });
      signal.throwIfAborted();
      if (oversized) throw new MoguriError("speech_limit", "Local transcription exceeded the bounded output limit.");
      if (timedOut) throw new MoguriError("speech_timeout", "Local transcription exceeded its five-minute deadline. The draft is unchanged.");
      if (finalizationTimedOut) throw new MoguriError("speech_finalize_timeout", "Local speech did not finish within 30 seconds after stopping. No transcript was accepted; the draft is unchanged.");
      if (exit.code !== 0) {
        const detail = stripVTControlCharacters(diagnostic.toString("utf8")).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim().slice(-2048);
        throw new MoguriError("speech_failed", `Local speech exited with ${exit.signal ? `signal ${exit.signal}` : `status ${exit.code}`}.${detail ? ` ${detail}` : " Check microphone permission, WAV format and the selected native backend in Voice dictation settings."} Your draft is unchanged; no cloud fallback was used.`);
      }
      const text = Buffer.concat(chunks).toString("utf8");
      if (!text.trim()) throw new MoguriError("speech_empty", "No speech was recognized. The existing draft was not changed.");
      return { text: text.trim(), modelId: this.model.id, language: settings.language, source: "local" };
    } finally {
      clearTimeout(timer); clearTimeout(escalation); clearTimeout(finalization);
      signal.removeEventListener("abort", cancel);
      this.active.delete(jobId);
    }
  }
  stop(jobId: string): void {
    const active = this.active.get(jobId);
    if (!active) throw new MoguriError("speech_not_recording", "This recording is no longer running.", 409);
    if (active.stopping) return;
    active.stopping = true;
    active.terminate?.("SIGINT");
  }
}
