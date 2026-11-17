import { createHash, randomUUID } from "node:crypto";
import { discoverVoiceModels, expandHome } from "./voice-discovery.ts";
import { spawn, type ChildProcess } from "node:child_process";
import { createReadStream } from "node:fs";
import { access, lstat, mkdir, open, readFile, rename, stat, statfs, unlink } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";
import { MoguriError, type VoiceModel, type VoiceModelInspection, type VoiceModelDiscovery, type VoiceStatus, type UserSettings } from "../../../packages/protocol/src/index.ts";
import { openSpeechStream, startSpeechServer, type SpeechStream } from "./speech-stream.ts";
import { defaultTranscribeHost, loadTranscribeModel, openTranscribeStream, probeTranscribeModel } from "./transcribe-stream.ts";
import { inspectVoiceModel, modelFingerprint } from "./voice-models.ts";
import { validateSpeechWav } from "../../../packages/protocol/src/audio.ts";

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
  /** Exact argv of the private transcribe.cpp host; defaults to bundled Node, transcribe-host and the pinned library. */
  transcribeHost?: string[];
  transcribeLibrary?: string;
  model?: typeof NEMOTRON_MODEL;
  fetch?: typeof globalThis.fetch;
  modelDirectory?: string;
  managedModelDirectory?: boolean;
  finalizationTimeoutMs?: number;
  /** Home folder used for model discovery and `~` paths; tests pass a generated folder. */
  home?: string;
}
export interface VoiceModelOwner { profileId: string; jobId: string; recover: (jobId: string) => boolean }
const modelOperations = new Map<string, symbol>();
interface ActiveModel { source: "managed" | "external"; path: string; sha256: string; bytes: number; runtime: VoiceModel["runtime"]; id: string; name: string; architecture?: string }
interface Recognizer { readonly closed: boolean; close(): Promise<void>; open(language: string, signal: AbortSignal, changed: (text: string) => void): Promise<SpeechStream> }
const MANAGED_NAME = "Nemotron 3.5 ASR Streaming 0.6B";
export class LocalDictation {
  private readonly executable: string;
  private readonly model;
  private readonly modelPath: string;
  private readonly transcribeLibrary: string;
  private readonly transcribeCommand: string[];
  private readonly digests = new Map<string, { fingerprint: string; digest: string }>();
  private streaming?: { key: string; server: Promise<Recognizer>; ready: boolean; readonly owner?: Recognizer };
  private active = new Map<string, { child: ChildProcess | null; stopping: boolean; ready: boolean; terminate?: (signal: NodeJS.Signals) => void }>();
  constructor(stateDir: string, private readonly options: SpeechOptions = {}) {
    this.executable = options.executable ?? fileURLToPath(new URL(import.meta.url.endsWith(".ts") ? "../../../.native/speech/bin/nemo-speech" : "./native/speech/bin/nemo-speech", import.meta.url));
    this.model = options.model ?? NEMOTRON_MODEL;
    if (!/^[A-Za-z0-9._-]+\.gguf$/.test(this.model.filename) || !/^[a-f0-9]{64}$/.test(this.model.sha256) ||
      !Number.isSafeInteger(this.model.bytes) || this.model.bytes < 1 || this.model.bytes > 2 * 1024 * 1024 * 1024) throw new MoguriError("speech_model", "The configured speech artifact has invalid bounded identity/size. No path was adopted.");
    this.modelPath = join(options.modelDirectory ?? join(stateDir, "speech-models"), this.model.filename);
    this.transcribeLibrary = options.transcribeLibrary ?? fileURLToPath(new URL(`${import.meta.url.endsWith(".ts") ? "../../../.native" : "./native"}/transcribe/libtranscribe.${process.platform === "darwin" ? "dylib" : "so"}`, import.meta.url));
    this.transcribeCommand = options.transcribeHost ?? defaultTranscribeHost(this.transcribeLibrary);
  }
  private selected(voice?: UserSettings["voice"]): ActiveModel {
    const model = voice?.model;
    return model ? { source: "external", path: model.path, sha256: model.sha256, bytes: model.bytes, runtime: model.runtime, id: model.name, name: model.name, architecture: model.architecture } :
      { source: "managed", path: this.modelPath, sha256: this.model.sha256, bytes: this.model.bytes, runtime: "nemo-speech", id: this.model.id, name: MANAGED_NAME };
  }
  private async transcribeRuntimeReady(): Promise<boolean> {
    if (this.options.transcribeHost) return true;
    try { await access(this.transcribeLibrary, constants.R_OK); return true; }
    catch (error) { if (error instanceof Error && "code" in error && ["ENOENT", "EACCES"].includes(String(error.code))) return false; throw error; }
  }
  async status(voice?: UserSettings["voice"]): Promise<VoiceStatus> {
    const active = this.selected(voice);
    let nemoReady = false;
    try { await access(this.executable, constants.X_OK); nemoReady = true; }
    catch (error) { if (!(error instanceof Error && "code" in error && ["ENOENT", "EACCES"].includes(String(error.code)))) throw error; }
    const transcribeReady = await this.transcribeRuntimeReady();
    const runtimeReady = active.runtime === "nemo-speech" ? nemoReady : transcribeReady;
    let present = false, fingerprint = "";
    try {
      const metadata = active.source === "external" ? await lstat(active.path) : await stat(active.path);
      present = metadata.isFile() && metadata.size === active.bytes; fingerprint = modelFingerprint(metadata);
    } catch (error) { if (!(error instanceof Error && "code" in error && ["ENOENT", "ENOTDIR"].includes(String(error.code)))) throw error; }
    const cached = this.digests.get(active.path);
    const changed = active.source === "external" && present && cached?.fingerprint === fingerprint && cached.digest !== active.sha256;
    const trust = !present ? fingerprint ? "changed" : "missing" : changed ? "changed" : cached?.fingerprint === fingerprint ? "trusted" : "unverified";
    const modelReady = present && !changed;
    const external = active.source === "external";
    const short = (digest: string) => `${digest.slice(0, 12)}…`;
    return {
      runtimeReady, modelReady, modelId: active.id, bytes: active.bytes, license: external ? "Set by the model's publisher; reviewed when you trusted it." : this.model.license,
      languageLocales: external ? [] : VOICE_LOCALES,
      prepared: Boolean(this.streaming?.ready && this.streaming.owner && !this.streaming.owner.closed && (!voice || this.streaming.key === this.recognizerKey(active, voice.backend))),
      managed: this.options.modelDirectory === undefined || this.options.managedModelDirectory === true,
      model: { source: active.source, runtime: active.runtime, name: active.name, sha256: active.sha256, trust,
        ...(external ? { path: active.path, architecture: active.architecture } : {}), ...(changed ? { observedSha256: cached.digest } : {}) },
      transcribeReady,
      diagnostic: !runtimeReady ? active.runtime === "nemo-speech" ? "Install the pinned local NeMo-Speech.cpp runtime. No cloud fallback is used." : "Install the pinned local transcribe.cpp runtime. No cloud fallback is used." :
        external && trust === "missing" ? `The trusted model file is missing at ${active.path}. Moguri never deletes it; restore it or choose another model in Settings / Voice.` :
        external && trust === "changed" ? `The trusted model file changed${changed ? ` (SHA-256 is now ${short(cached.digest)}, trusted ${short(active.sha256)})` : " size"}. Review and trust it again in Settings / Voice (or moguri dictate model inspect) before dictating.` :
        !modelReady ? "Download the Nemotron model once after accepting its license. Recording never downloads it implicitly." :
        external ? "Audio stays local. The external model is re-checked against its trusted SHA-256 whenever the file changes, and is never deleted by Moguri." :
        "Audio stays local. Model integrity is checked before use; adaptation-tier locales require fine-tuning.",
    };
  }
  private recognizerKey(active: ActiveModel, backend: string): string { return JSON.stringify([active.runtime, active.path, active.sha256, backend]); }
  private async modelOperation<T>(owner: VoiceModelOwner | undefined, signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
    signal.throwIfAborted();
    const lock = `${this.modelPath}.operation`, token = Symbol("owned speech model operation");
    if (modelOperations.has(lock)) throw new MoguriError("speech_download_pending", "Another exact speech model operation owns this shared model. No file was replaced or deleted.", 409);
    modelOperations.set(lock, token);
    let file: Awaited<ReturnType<typeof open>> | undefined;
    try {
      await mkdir(dirname(this.modelPath), { recursive: true, mode: 0o700 });
      const directory = await lstat(dirname(this.modelPath));
      if (!directory.isDirectory() || directory.isSymbolicLink() || directory.uid !== process.getuid?.()) throw new MoguriError("speech_model_directory", "Speech models require an actual owned directory, not a symlink or another user's files.");
      try { file = await open(lock, "wx", 0o600); }
      catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
        if (!owner) throw new MoguriError("speech_download_pending", "An original shared model operation is still retained. Inspect it before another download.", 409);
        const metadata = await lstat(lock);
        if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 4096) throw new MoguriError("speech_model_owner", "The original model-operation owner is invalid. No file was removed.", 409);
        const retained: unknown = JSON.parse(await readFile(lock, "utf8"));
        if (!retained || typeof retained !== "object" || !("version" in retained) || retained.version !== 1 ||
          !("profileId" in retained) || retained.profileId !== owner.profileId || !("jobId" in retained) || typeof retained.jobId !== "string" ||
          !("digest" in retained) || retained.digest !== this.model.sha256 || !owner.recover(retained.jobId)) {
          throw new MoguriError("speech_model_owner", "The shared model still has an unknown or other-profile operation owner. Inspect that original job before retrying; no work was replayed or deleted.", 409);
        }
        await this.removeModelFile(`${this.modelPath}.download`);
        await unlink(lock);
        file = await open(lock, "wx", 0o600);
      }
      await file.writeFile(JSON.stringify({ version: 1, profileId: owner?.profileId ?? "embedded", jobId: owner?.jobId ?? randomUUID(), digest: this.model.sha256 }));
      await file.sync(); signal.throwIfAborted();
      return await operation();
    } finally {
      try {
        if (file) {
          const original = await file.stat();
          let current;
          try { current = await lstat(lock); } finally { await file.close(); }
          if (original.ino !== current.ino || original.dev !== current.dev) throw new MoguriError("speech_partial", "The original model-operation lock changed. Cleanup is unconfirmed; no replacement lock was deleted.", 409);
          await unlink(lock);
        }
      } finally { if (modelOperations.get(lock) === token) modelOperations.delete(lock); }
    }
  }
  private async removeModelFile(path: string): Promise<void> {
    let metadata;
    try { metadata = await lstat(path); }
    catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") return; throw error; }
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.uid !== process.getuid?.()) throw new MoguriError("speech_model_owner", "The exact managed model/staging file is not an owned regular file. No external file was removed.", 409);
    await unlink(path);
  }
  async removeManaged(signal: AbortSignal, owner: VoiceModelOwner): Promise<{ removed: true; modelId: string }> {
    if (this.options.modelDirectory !== undefined && this.options.managedModelDirectory !== true) throw new MoguriError("speech_external_model", "Dictation is disabled, but this externally selected model directory is not Moguri-owned. No user-selected model was deleted.", 409);
    return this.modelOperation(owner, signal, async () => {
      signal.throwIfAborted();
      await this.removeModelFile(`${this.modelPath}.download`);
      await this.removeModelFile(this.modelPath);
      this.digests.delete(this.modelPath);
      return { removed: true, modelId: this.model.id };
    });
  }
  async download(signal: AbortSignal, progress: (message: string) => void, owner?: VoiceModelOwner): Promise<{ installed: boolean; modelId: string }> {
    return this.modelOperation(owner, signal, () => this.install(signal, progress));
  }
  private async install(signal: AbortSignal, progress: (message: string) => void): Promise<{ installed: boolean; modelId: string }> {
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
      this.digests.delete(this.modelPath);
      return { installed: true, modelId: this.model.id };
    } finally {
      await file.close();
      await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
    }
  }
  private async verify(signal: AbortSignal, voice?: UserSettings["voice"]): Promise<ActiveModel> {
    const active = this.selected(voice), status = await this.status(voice);
    if (!status.runtimeReady || !status.modelReady) throw new MoguriError(status.model?.trust === "changed" ? "speech_model_changed" : "speech_not_ready", status.diagnostic!, 409);
    const metadata = active.source === "external" ? await lstat(active.path) : await stat(active.path);
    if (!metadata.isFile()) throw new MoguriError("speech_not_ready", status.diagnostic!, 409);
    const fingerprint = modelFingerprint(metadata), cached = this.digests.get(active.path);
    let digest = cached?.fingerprint === fingerprint ? cached.digest : undefined;
    if (!digest) {
      const hash = createHash("sha256");
      for await (const chunk of createReadStream(active.path, { signal })) hash.update(chunk);
      digest = hash.digest("hex");
      this.digests.set(active.path, { fingerprint, digest });
    }
    if (digest !== active.sha256) {
      if (active.source === "managed") throw new MoguriError("speech_integrity", "Installed model integrity failed. Reinstall it explicitly; no download or cloud fallback was attempted.");
      await this.close();
      throw new MoguriError("speech_model_changed", `The trusted model file changed: its SHA-256 is now ${digest.slice(0, 12)}…, not the trusted ${active.sha256.slice(0, 12)}…. Review and trust it again in Settings / Voice (or moguri dictate model inspect); nothing was loaded.`, 409);
    }
    return active;
  }
  async prepare(settings: UserSettings["voice"], signal: AbortSignal): Promise<void> {
    const active = await this.verify(signal, settings);
    if (active.source === "managed" && settings.language !== "auto" && !VOICE_LOCALES.some((locale) => locale.code === settings.language && locale.tier !== "adaptation")) {
      throw new MoguriError("speech_language", "Choose auto or a qualified ready/broad-coverage locale.");
    }
    const key = this.recognizerKey(active, settings.backend);
    if (this.streaming?.key !== key || (await this.streaming.server).closed) {
      await this.close();
      let owner: Recognizer | undefined;
      const own = (recognizer: Recognizer) => { owner = recognizer; };
      const server: Promise<Recognizer> = active.runtime === "nemo-speech" ?
        startSpeechServer(this.executable, this.options.prefixArgs ?? [], active.path, settings.backend, signal, (value) => own({
          get closed() { return value.closed; }, close: () => value.close(), open: (language, streamSignal, changed) => openSpeechStream(value, language, streamSignal, changed) })).then(() => owner!) :
        loadTranscribeModel(this.transcribeCommand, active.path, settings.backend, signal, (value) => own({
          get closed() { return value.closed; }, close: () => value.close(), open: (_language, streamSignal, changed) => openTranscribeStream(value, streamSignal, changed) })).then(() => owner!);
      this.streaming = { key, ready: false, server, get owner() { return owner; } };
    }
    const owned = this.streaming!;
    let server: Recognizer;
    try { server = await owned.server; } catch (error) {
      if (this.streaming === owned && !(error instanceof MoguriError && error.code === "speech_partial")) this.streaming = undefined;
      throw error;
    }
    owned.ready = !server.closed;
    signal.throwIfAborted();
  }
  async stream(jobId: string, settings: UserSettings["voice"], signal: AbortSignal, changed: (text: string) => void) {
    if (!jobId) throw new MoguriError("speech_scope", "Streaming recognition needs its exact capture owner.");
    await this.prepare(settings, signal);
    const owned = this.streaming!, server = await owned.server, active = this.selected(settings);
    const language = active.source === "managed" ? settings.language : "auto";
    const stream = await server.open(language, signal, changed);
    return { append: stream.append,
      finish: async () => ({ ...await stream.finish(), modelId: active.id, language, source: "local" as const }),
      cancel: async () => { await stream.cancel(); if (signal.aborted && this.streaming === owned) this.streaming = undefined; },
    };
  }
  /** Explicit, read-only search of model caches or one chosen file/folder. Results are not saved. */
  discover(path: string | undefined, signal: AbortSignal): Promise<VoiceModelDiscovery> {
    return discoverVoiceModels({ path, home: this.options.home, env: this.options.home ? {} : process.env, skip: [dirname(this.modelPath)], signal });
  }
  /** Read-only review of a user-chosen file; it never copies, moves or deletes the file. */
  async inspect(path: string, signal: AbortSignal, progress: (message: string) => void): Promise<VoiceModelInspection> {
    const inspection = await inspectVoiceModel(expandHome(path, this.options.home), { managedDirectory: dirname(this.modelPath), signal, progress, probe: async (model, probeSignal) => {
      if (!await this.transcribeRuntimeReady()) throw new MoguriError("speech_not_ready", "Install the pinned local transcribe.cpp runtime before reviewing this model. No cloud fallback is used.", 409);
      return probeTranscribeModel(this.transcribeCommand, model, probeSignal);
    } });
    this.digests.set(inspection.path, { fingerprint: inspection.fingerprint, digest: inspection.sha256 });
    return inspection;
  }
  /** Binds trust to the reviewed bytes: any write after review changes the fingerprint and needs a new review. */
  async unchangedSince(inspection: VoiceModelInspection): Promise<void> {
    let metadata;
    try { metadata = await lstat(inspection.path); }
    catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") throw new MoguriError("speech_model_missing", "The reviewed model file is gone. Nothing was trusted.", 404); throw error; }
    if (!metadata.isFile() || modelFingerprint(metadata) !== inspection.fingerprint) throw new MoguriError("speech_model_changed", "The model file changed after it was reviewed. Inspect it again; nothing was trusted.", 409);
  }
  async close(): Promise<void> {
    const owned = this.streaming;
    if (owned) { await (owned.owner ?? await owned.server).close(); if (this.streaming === owned) this.streaming = undefined; }
  }
  async transcribe(jobId: string, source: string | "microphone", settings: UserSettings["voice"], signal: AbortSignal, progress: (message: string) => void = () => {}): Promise<{ text: string; modelId: string; language: string; source: "local" }> {
    if (source === "microphone" && settings.inputDeviceId && settings.inputDeviceId !== "default") throw new MoguriError("speech_input_device", "This native capture supports only the default microphone. Use the selected device through desktop capture, or explicitly choose Default in Voice settings. No device was substituted.", 409);
    const active: { child: ChildProcess | null; stopping: boolean; ready: boolean; terminate?: (signal: NodeJS.Signals) => void } = { child: null, stopping: false, ready: source !== "microphone" };
    this.active.set(jobId, active);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let escalation: ReturnType<typeof setTimeout> | undefined;
    let finalization: ReturnType<typeof setTimeout> | undefined;
    const cancel = () => active.terminate?.("SIGTERM");
    try {
      progress("Preparing local dictation...");
      const model = await this.verify(signal, settings);
      if (active.stopping) throw new MoguriError("speech_stopped", "Recording was stopped before microphone startup. No audio was captured and the draft is unchanged.", 409);
      if (model.runtime === "transcribe" && source === "microphone") throw new MoguriError("speech_runtime_microphone", "Native microphone recording runs only on the NeMo runtime. Dictate with this model from the desktop composer, or transcribe a mono 16-kHz PCM16 WAV file.", 409);
      const language = model.source === "managed" ? settings.language : "auto";
      if (language !== "auto" && !VOICE_LOCALES.some((locale) => locale.code === language && locale.tier !== "adaptation")) {
        throw new MoguriError("speech_language", "Choose auto or a ready/broad-coverage locale. Adaptation-tier languages are not claimed ready.");
      }
      if (source !== "microphone") {
        const metadata = await stat(source);
        if (!metadata.isFile() || metadata.size > 64 * 1024 * 1024 || !source.toLowerCase().endsWith(".wav")) throw new MoguriError("speech_audio", "Select a regular PCM WAV file up to 64 MiB. Convert unsupported audio explicitly.");
      }
      if (model.runtime === "transcribe") return await this.transcribeFile(jobId, source, settings, signal, progress);
      signal.throwIfAborted();
      if (active.stopping) throw new MoguriError("speech_stopped", "Recording was stopped before microphone startup. No audio was captured and the draft is unchanged.", 409);
      const args = [...(this.options.prefixArgs ?? []), ...(source === "microphone" ? [] : ["--quiet"]), "transcribe", ...(source === "microphone" ? ["--live"] : [source]), "--model", model.path, "--format", "text", ...(language === "auto" ? [] : ["--language", language]), "--backend", settings.backend];
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
          progress("Finalizing local dictation. Your draft is unchanged.");
          child.kill("SIGINT");
          finalization = setTimeout(() => { finalizationTimedOut = true; active.terminate!("SIGTERM"); }, this.options.finalizationTimeoutMs ?? 60_000);
        } else {
          if (terminating) return;
          terminating = true; clearTimeout(finalization);
          child.kill(requested);
          escalation = setTimeout(() => child.kill("SIGKILL"), 3000);
        }
      };
      progress(source === "microphone" ? "Preparing the local microphone. Wait for Recording before speaking." : "Transcribing the local WAV. Your draft is unchanged.");
      child.stdout.on("data", (chunk: Buffer) => {
        if (oversized) return;
        bytes += chunk.byteLength;
        if (bytes > 128 * 1024) { oversized = true; active.terminate!("SIGTERM"); }
        else chunks.push(chunk);
      });
      const finishRecording = () => {
        active.stopping = true;
        timedOut = source !== "microphone";
        active.terminate!(source === "microphone" ? "SIGINT" : "SIGTERM");
      };
      child.stderr.on("data", (chunk: Buffer) => {
        diagnostic = Buffer.concat([diagnostic, chunk]).subarray(-8192);
        if (source === "microphone" && !active.ready && /^\[live\] listening on .+ at [1-9]\d* Hz; press Ctrl-C to stop\r?$/m.test(diagnostic.toString("utf8"))) {
          active.ready = true; diagnostic = Buffer.alloc(0); clearTimeout(timer);
          progress("Recording locally. Stop to transcribe.");
          timer = setTimeout(finishRecording, 120_000);
        }
      });
      if (source === "microphone") timer = setTimeout(() => { timedOut = true; active.terminate!("SIGTERM"); }, 120_000);
      else { progress("Transcribing local audio..."); timer = setTimeout(finishRecording, 300_000); }
      signal.addEventListener("abort", cancel, { once: true });
      if (signal.aborted) cancel();
      const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
        child.once("close", (code, signal) => resolve({ code, signal }));
        child.once("error", (error) => reject(new MoguriError("speech_spawn", `Local speech could not start: ${error.message}. Your draft is unchanged.`)));
      });
      signal.throwIfAborted();
      if (oversized) throw new MoguriError("speech_limit", "Local transcription exceeded the bounded output limit.");
      if (timedOut) throw new MoguriError("speech_timeout", source === "microphone" ? "Local microphone initialization exceeded two minutes. Cancelled startup produced no transcript; your draft is unchanged." : "Local transcription exceeded its five-minute deadline. The draft is unchanged.");
      if (finalizationTimedOut) throw new MoguriError("speech_finalize_timeout", "Local speech did not finish within its finalization deadline. The recognizer was stopped and your draft is unchanged. Try a shorter recording or a faster backend.");
      if (exit.code !== 0) {
        const detail = stripVTControlCharacters(diagnostic.toString("utf8")).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim().slice(-2048);
        throw new MoguriError("speech_failed", `Local speech exited with ${exit.signal ? `signal ${exit.signal}` : `status ${exit.code}`}.${detail ? ` ${detail}` : " Check microphone permission, WAV format and the selected native backend in Voice dictation settings."} Your draft is unchanged; no cloud fallback was used.`);
      }
      if (source === "microphone" && !active.ready) throw new MoguriError("speech_readiness", "The pinned runtime did not confirm microphone readiness. No transcript was inserted; inspect its version, startup and microphone permissions before retrying.");
      const text = Buffer.concat(chunks).toString("utf8");
      if (!text.trim()) throw new MoguriError("speech_empty", "No speech was recognized. The existing draft was not changed.");
      return { text: text.trim(), modelId: model.id, language, source: "local" };
    } finally {
      clearTimeout(timer); clearTimeout(escalation); clearTimeout(finalization);
      signal.removeEventListener("abort", cancel);
      this.active.delete(jobId);
    }
  }
  private async transcribeFile(jobId: string, source: string, settings: UserSettings["voice"], signal: AbortSignal, progress: (message: string) => void) {
    const bytes = await readFile(source);
    try {
      try { validateSpeechWav(bytes); }
      catch { throw new MoguriError("speech_audio", "This model reads exact mono 16-kHz PCM16 WAV files up to two minutes. Convert the file explicitly; nothing was resampled."); }
      progress("Transcribing the local WAV. Your draft is unchanged.");
      const stream = await this.stream(jobId, settings, signal, () => {});
      try {
        for (let offset = 44; offset < bytes.length; offset += 32_000) await stream.append(bytes.subarray(offset, Math.min(offset + 32_000, bytes.length)));
        return await stream.finish();
      } catch (error) { await stream.cancel(); throw error; }
    } finally { bytes.fill(0); }
  }
  stop(jobId: string): void {
    const active = this.active.get(jobId);
    if (!active) throw new MoguriError("speech_not_recording", "This recording is no longer running.", 409);
    if (active.stopping) return;
    if (active.child && !active.ready) throw new MoguriError("speech_preparing", "The local recognizer is still initializing the microphone. Wait for Recording, or cancel and discard setup; no transcript is available yet.", 409);
    active.stopping = true;
    active.terminate?.("SIGINT");
  }
}
