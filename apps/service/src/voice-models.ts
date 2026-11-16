import { createHash } from "node:crypto";
import { createReadStream, type Stats } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { basename, isAbsolute, relative, sep } from "node:path";
import { isRecord, MAX_EXTERNAL_VOICE_MODEL_BYTES, MoguriError, type VoiceModelInspection } from "../../../packages/protocol/src/index.ts";
import type { TranscribeModelInfo } from "./transcribe-stream.ts";

const HEADER_BYTES = 16 * 1024 * 1024;
const WHISPER_GGML_MAGIC = 0x67676d6c;
export const modelFingerprint = (metadata: Stats): string => `${metadata.dev}:${metadata.ino}:${metadata.size}:${metadata.mtimeMs}`;

export interface ModelHeader { format: "gguf" | "whisper-ggml" | "unknown"; architecture?: string; name?: string; license?: string; cacheSupported?: boolean }

/** Reads only the identifying GGUF keys from a bounded header prefix; it never loads tensors. */
export function readModelHeader(buffer: Buffer): ModelHeader {
  if (buffer.length >= 4 && buffer.readUInt32LE(0) === WHISPER_GGML_MAGIC) return { format: "whisper-ggml", architecture: "whisper" };
  if (buffer.length < 24 || buffer.toString("ascii", 0, 4) !== "GGUF") return { format: "unknown" };
  const header: ModelHeader = { format: "gguf" };
  let offset = 8;
  const need = (bytes: number) => { if (offset + bytes > buffer.length) throw new RangeError("truncated"); };
  const u64 = () => { need(8); const value = buffer.readBigUInt64LE(offset); offset += 8; return value; };
  const u32 = () => { need(4); const value = buffer.readUInt32LE(offset); offset += 4; return value; };
  const string = () => { const length = Number(u64()); need(length); const value = buffer.toString("utf8", offset, offset + length); offset += length; return value; };
  const sizes: Record<number, number> = { 0: 1, 1: 1, 2: 2, 3: 2, 4: 4, 5: 4, 6: 4, 7: 1, 10: 8, 11: 8, 12: 8 };
  const value = (type: number): unknown => {
    if (type === 8) return string();
    if (type === 7) { need(1); return buffer[offset++] === 1; }
    if (type === 9) {
      const item = u32(), count = u64();
      if (item === 8) { for (let index = 0n; index < count; index++) string(); return undefined; }
      const size = sizes[item]; if (size === undefined) throw new RangeError("type");
      const bytes = Number(count) * size; need(bytes); offset += bytes; return undefined;
    }
    const size = sizes[type]; if (size === undefined) throw new RangeError("type");
    need(size); offset += size; return undefined;
  };
  try {
    u64();
    const count = Number(u64());
    for (let index = 0; index < count && index < 100_000; index++) {
      const key = string(), parsed = value(u32());
      if (key === "general.architecture" && typeof parsed === "string") header.architecture = parsed.slice(0, 128);
      else if (key === "general.name" && typeof parsed === "string") header.name = parsed.trim().slice(0, 256);
      else if (key === "general.license" && typeof parsed === "string") header.license = parsed.trim().slice(0, 128);
      else if (key === "asr.encoder.cache_supported" && typeof parsed === "boolean") header.cacheSupported = parsed;
    }
  } catch (error) { if (!(error instanceof RangeError)) throw error; }
  return header;
}

export async function sha256File(path: string, size: number, signal: AbortSignal, progress: (message: string) => void = () => {}): Promise<string> {
  const hash = createHash("sha256"), total = Math.max(1, Math.ceil(size / 1024 / 1024));
  let read = 0, reported = 0;
  for await (const chunk of createReadStream(path, { signal, highWaterMark: 4 * 1024 * 1024 }) as AsyncIterable<Buffer>) {
    hash.update(chunk); read += chunk.byteLength;
    if (read - reported >= 64 * 1024 * 1024) { reported = read; progress(`Hashing the model: ${Math.floor(read / 1024 / 1024)} of ${total} MiB.`); }
  }
  if (read !== size) throw new MoguriError("speech_model_changed", "The model file changed size while it was hashed. Nothing was trusted.", 409);
  return hash.digest("hex");
}

const notStreaming = (architecture: string | undefined) => new MoguriError("speech_model_streaming", architecture === "whisper" ?
  "Whisper models transcribe only after recording ends, so they can't stream live dictation. Choose a streaming model such as Nemotron streaming, Parakeet or Moonshine streaming." :
  "This model can't stream live dictation. Moguri accepts only streaming models, such as Nemotron streaming, Parakeet or Moonshine streaming.", 409);

export async function inspectVoiceModel(requested: string, options: {
  managedDirectory: string; signal: AbortSignal; progress: (message: string) => void;
  probe: (path: string, signal: AbortSignal) => Promise<TranscribeModelInfo>;
}): Promise<VoiceModelInspection> {
  const { signal, progress } = options;
  if (!isAbsolute(requested)) throw new MoguriError("speech_model_path", "Choose the model file by its absolute path.");
  let path: string;
  try { path = await realpath(requested); }
  catch (error) {
    if (error instanceof Error && "code" in error && ["ENOENT", "ENOTDIR", "EACCES"].includes(String(error.code))) throw new MoguriError("speech_model_missing", "The model file is missing or unreadable. Nothing was trusted.", 404);
    throw error;
  }
  const managed = await realpath(options.managedDirectory).catch(() => null);
  if (managed && insideDirectory(managed, path)) {
    throw new MoguriError("speech_model_managed", "This file is Moguri's own managed model. Use the managed Nemotron option instead, so disabling dictation can't delete a shared file.", 409);
  }
  const metadata = await lstat(path);
  if (!metadata.isFile()) throw new MoguriError("speech_model_file", "Choose a regular model file, not a folder or device.");
  if (metadata.size < 24 || metadata.size > MAX_EXTERNAL_VOICE_MODEL_BYTES) throw new MoguriError("speech_model_file", "The model file must be between 24 bytes and 8 GiB.");
  const fingerprint = modelFingerprint(metadata);
  progress("Reading the model header.");
  const file = await open(path, "r");
  let prefix: Buffer;
  try {
    prefix = Buffer.alloc(Math.min(metadata.size, HEADER_BYTES));
    const { bytesRead } = await file.read(prefix, 0, prefix.length, 0);
    prefix = prefix.subarray(0, bytesRead);
  } finally { await file.close(); }
  signal.throwIfAborted();
  const header = readModelHeader(prefix);
  let runtime: VoiceModelInspection["runtime"], architecture: string, languages: string[] = [];
  if (header.format === "whisper-ggml") throw notStreaming("whisper");
  if (header.format !== "gguf" || !header.architecture) throw new MoguriError("speech_model_format", "Moguri reads NeMo-Speech GGUF, transcribe.cpp GGUF and whisper.cpp files. This file is none of them.");
  if (header.architecture === "asr") {
    if (header.cacheSupported !== true) throw notStreaming(header.architecture);
    runtime = "nemo-speech"; architecture = "nemo-asr";
  } else {
    progress("Checking that the model can stream.");
    const info = await options.probe(path, signal);
    if (!info.streaming || info.sampleRate !== 16_000) throw notStreaming(info.architecture);
    runtime = "transcribe"; architecture = info.architecture || header.architecture; languages = info.languages;
  }
  signal.throwIfAborted();
  progress(`Hashing the model: 0 of ${Math.ceil(metadata.size / 1024 / 1024)} MiB.`);
  const sha256 = await sha256File(path, metadata.size, signal, progress);
  const after = await lstat(path);
  if (!after.isFile() || modelFingerprint(after) !== fingerprint) throw new MoguriError("speech_model_changed", "The model file changed while it was inspected. Inspect it again; nothing was trusted.", 409);
  return { path, sha256, bytes: metadata.size, runtime, architecture, name: header.name?.replace(/^\.+/, "") || basename(path).slice(0, 256),
    fingerprint, streaming: true, license: header.license ?? null, languages };
}

export const insideDirectory = (directory: string, path: string): boolean => {
  const relation = relative(directory, path);
  return relation === "" || !relation.startsWith(`..${sep}`) && relation !== ".." && !isAbsolute(relation);
};

/** Validates a retained voice.inspect result before it can become a trusted selection. */
export function voiceInspection(value: unknown): VoiceModelInspection {
  if (!isRecord(value) || typeof value.path !== "string" || !isAbsolute(value.path) || value.path.length > 4096 ||
    typeof value.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.sha256) ||
    typeof value.bytes !== "number" || !Number.isSafeInteger(value.bytes) || value.bytes < 1 || value.bytes > MAX_EXTERNAL_VOICE_MODEL_BYTES ||
    value.runtime !== "nemo-speech" && value.runtime !== "transcribe" || value.streaming !== true ||
    typeof value.architecture !== "string" || !value.architecture || value.architecture.length > 128 ||
    typeof value.name !== "string" || !value.name || value.name.length > 256 || typeof value.fingerprint !== "string" ||
    value.license !== null && typeof value.license !== "string" || !Array.isArray(value.languages) || !value.languages.every((item) => typeof item === "string")) {
    throw new MoguriError("speech_model_review", "The retained model review is not a complete streaming-model inspection. Nothing was trusted.", 409);
  }
  return { path: value.path, sha256: value.sha256, bytes: value.bytes, runtime: value.runtime, architecture: value.architecture, name: value.name,
    fingerprint: value.fingerprint, streaming: true, license: value.license, languages: value.languages };
}
