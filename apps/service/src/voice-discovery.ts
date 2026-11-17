import { homedir } from "node:os";
import { lstat, open, readdir, realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, join } from "node:path";
import { MoguriError, type VoiceModelCandidate, type VoiceModelDiscovery } from "../../../packages/protocol/src/index.ts";
import { insideDirectory, readModelHeader } from "./voice-models.ts";

/** Speech architectures that transcribe.cpp or NeMo-Speech can load; anything else (LLMs, VAD, diarizers) is not a transcription model. */
const SPEECH_ARCHITECTURES = new Set([
  "asr", "whisper", "parakeet", "qwen3_asr", "voxtral", "voxtral_realtime", "cohere", "cohere_asr", "canary", "canary_qwen",
  "moonshine", "moonshine_streaming", "sensevoice", "gigaam", "granite", "granite_speech", "granite_nar", "granite_speech_nar",
  "funasr_nano", "granite5_ctc", "medasr", "moss",
]);
const HEADER_BYTES = 4 * 1024 * 1024;
const SKIPPED_DIRECTORIES = new Set(["blobs", "refs", "xet", "node_modules"]);
const partial = (name: string) => name.startsWith(".") || /\.(partial|extracting|incomplete|download|tmp)$/i.test(name);
const missing = (error: unknown) => error instanceof Error && "code" in error && ["ENOENT", "ENOTDIR"].includes(String(error.code));
const denied = (error: unknown) => error instanceof Error && "code" in error && ["EACCES", "EPERM"].includes(String(error.code));

export interface DiscoveryLimits { depth: number; entries: number; ms: number; headers: number; results: number }
const DEFAULT_LIMITS: DiscoveryLimits = { depth: 6, entries: 50_000, ms: 10_000, headers: 300, results: 200 };

/** Expands a leading `~` so typed paths behave like the shell. */
export function expandHome(path: string, home = homedir()): string {
  const trimmed = path.replace(/^(['"])(.*)\1$/, "$2");
  return trimmed === "~" ? home : trimmed.startsWith("~/") ? join(home, trimmed.slice(2)) : trimmed;
}

/** Model caches Moguri searches by default: Handy's model folder and the Hugging Face cache, honoring its environment overrides. */
export function defaultModelRoots(home = homedir(), env: NodeJS.ProcessEnv = process.env): string[] {
  const hfHome = env.HF_HOME ? expandHome(env.HF_HOME, home) : join(home, ".cache", "huggingface");
  const hub = env.HF_HUB_CACHE ?? env.HUGGINGFACE_HUB_CACHE;
  const roots = [join(home, "Library", "Application Support", "com.pais.handy", "models"), hfHome];
  if (hub && !insideDirectory(hfHome, expandHome(hub, home))) roots.push(expandHome(hub, home));
  return roots.filter((root) => isAbsolute(root));
}

async function classify(path: string, bytes: number): Promise<VoiceModelCandidate | "other"> {
  const file = await open(path, "r");
  let prefix: Buffer;
  try {
    prefix = Buffer.alloc(Math.min(bytes, HEADER_BYTES));
    const { bytesRead } = await file.read(prefix, 0, prefix.length, 0);
    prefix = prefix.subarray(0, bytesRead);
  } finally { await file.close(); }
  const header = readModelHeader(prefix), name = header.name?.replace(/^\.+/, "") || basename(path);
  const candidate = (status: VoiceModelCandidate["status"], architecture: string, reason: string | null): VoiceModelCandidate =>
    ({ path, name: name.slice(0, 256), architecture: architecture.slice(0, 128), bytes, status, reason });
  if (header.format === "whisper-ggml") return candidate("unsupported", "whisper", "Whisper transcribes only after recording ends, so it can't stream dictation.");
  if (header.format !== "gguf" || !header.architecture || !SPEECH_ARCHITECTURES.has(header.architecture)) return "other";
  if (header.architecture === "whisper") return candidate("unsupported", "whisper", "Whisper transcribes only after recording ends, so it can't stream dictation.");
  if (header.architecture === "asr") {
    if (header.cacheSupported === false) return candidate("unsupported", "nemo-asr", "This NeMo model is offline-only, so it can't stream dictation.");
    return candidate(header.cacheSupported ? "streaming" : "review", "nemo-asr", null);
  }
  return candidate(/streaming|realtime/.test(header.architecture) ? "streaming" : "review", header.architecture, null);
}

/**
 * Read-only, bounded search for speech models. It never follows folder links, enters hidden folders or Hugging Face blob storage,
 * or reads more than a small header from each file. Results are not saved; reviewing and trusting a model stays a separate step.
 */
export async function discoverVoiceModels(options: {
  path?: string; home?: string; env?: NodeJS.ProcessEnv; skip: string[]; signal: AbortSignal; limits?: DiscoveryLimits;
}): Promise<VoiceModelDiscovery> {
  const home = options.home ?? homedir(), limits = options.limits ?? DEFAULT_LIMITS, signal = options.signal;
  const deadline = Date.now() + limits.ms, seen = new Set<string>(), models: VoiceModelCandidate[] = [];
  let entries = 0, headers = 0, skipped = 0, complete = true, diagnostic: string | null = null;
  const stop = (reason: string) => { complete = false; diagnostic ??= reason; };
  const skip = await Promise.all(options.skip.map((path) => realpath(path).catch(() => path)));
  const requested = options.path === undefined ? null : expandHome(options.path, home);
  if (requested !== null && !isAbsolute(requested)) throw new MoguriError("speech_model_path", "Enter an absolute path, or one starting with ~/.", 400);
  const roots = requested === null ? defaultModelRoots(home, options.env) : [requested];
  const searched: VoiceModelDiscovery["searched"] = [];
  const consider = async (path: string, scope: string): Promise<void> => {
    if (models.length >= limits.results) { stop(`Found more than ${limits.results} models. Choose a narrower folder.`); return; }
    if (headers >= limits.headers) { stop("Too many model files to check. Choose a narrower folder."); return; }
    let actual: string;
    try { actual = await realpath(path); } catch (error) { if (missing(error) || denied(error)) return; throw error; }
    if (seen.has(actual) || skip.some((directory) => insideDirectory(directory, actual))) return;
    if (!insideDirectory(scope, actual) && !insideDirectory(home, actual)) return;
    seen.add(actual);
    const metadata = await stat(actual).catch(() => null);
    if (!metadata?.isFile() || metadata.size < 24) return;
    headers++;
    const result = await classify(actual, metadata.size).catch((error: unknown) => { if (missing(error) || denied(error)) return "other" as const; throw error; });
    if (result === "other") skipped++; else models.push(result);
  };
  for (const root of roots) {
    signal.throwIfAborted();
    let canonical: string;
    try { canonical = await realpath(root); } catch (error) {
      if (missing(error)) { searched.push({ path: root, found: false }); continue; }
      if (denied(error)) { searched.push({ path: root, found: false }); stop(`Moguri can't read ${root}.`); continue; }
      throw error;
    }
    const metadata = await lstat(canonical);
    searched.push({ path: canonical, found: true, kind: metadata.isFile() ? "file" : "folder" });
    if (metadata.isFile()) { await consider(canonical, canonical); continue; }
    if (!metadata.isDirectory()) continue;
    const pending = [{ directory: canonical, depth: 0 }];
    while (pending.length) {
      signal.throwIfAborted();
      if (Date.now() >= deadline) { stop("The search took too long and stopped early. Choose a narrower folder to see everything."); break; }
      const { directory, depth } = pending.shift()!;
      if (skip.some((excluded) => insideDirectory(excluded, directory))) continue;
      let children;
      try { children = await readdir(directory, { withFileTypes: true }); } catch (error) { if (missing(error) || denied(error)) continue; throw error; }
      for (const child of children.sort((left, right) => left.name.localeCompare(right.name))) {
        if (++entries > limits.entries) { stop("The folder has too many entries and the search stopped early. Choose a narrower folder."); break; }
        if (partial(child.name)) continue;
        const path = join(directory, child.name);
        if (child.isDirectory()) {
          if (depth + 1 <= limits.depth && !SKIPPED_DIRECTORIES.has(child.name)) pending.push({ directory: path, depth: depth + 1 });
        } else if ((child.isFile() || child.isSymbolicLink()) && /\.(gguf|bin)$/i.test(child.name)) await consider(path, canonical);
      }
      if (!complete && models.length >= limits.results) break;
    }
  }
  const order = { streaming: 0, review: 1, unsupported: 2 } as const;
  models.sort((left, right) => order[left.status] - order[right.status] || left.name.localeCompare(right.name));
  return { searched, models, skipped, complete, diagnostic };
}
