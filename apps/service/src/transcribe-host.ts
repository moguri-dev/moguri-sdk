// Private transcribe.cpp host. It runs in its own process so a native fault cannot take down the control plane.
// Protocol: one JSON request per stdin line, one JSON reply per stdout line, strictly in order.
import { dlopen, getUint64, toString } from "node:ffi";
import { createInterface } from "node:readline";

const VERSION = "0.4.2";
const ABI_MODEL_LOAD_PARAMS = 0, ABI_CAPABILITIES = 4;
const BACKENDS: Record<string, number> = { auto: 0, cpu: 1, metal: 2 };
const MAX_LINE = 256 * 1024, MAX_LANGUAGES = 512;
const library = process.argv[2];
if (!library) { console.error("The private transcribe host needs its exact pinned library path."); process.exit(2); }

const { functions: f } = dlopen(library, {
  transcribe_version: { return: "pointer", arguments: [] },
  transcribe_status_string: { return: "pointer", arguments: ["int32"] },
  transcribe_init_backends_default: { return: "int32", arguments: [] },
  transcribe_abi_struct_size: { return: "uint64", arguments: ["int32"] },
  transcribe_model_load_params_init: { return: "void", arguments: ["buffer"] },
  transcribe_open: { return: "int32", arguments: ["string", "buffer", "pointer", "buffer"] },
  transcribe_get_model: { return: "pointer", arguments: ["pointer"] },
  transcribe_capabilities_init: { return: "void", arguments: ["buffer"] },
  transcribe_model_get_capabilities: { return: "int32", arguments: ["pointer", "buffer"] },
  transcribe_model_arch_string: { return: "pointer", arguments: ["pointer"] },
  transcribe_model_variant_string: { return: "pointer", arguments: ["pointer"] },
  transcribe_model_backend: { return: "pointer", arguments: ["pointer"] },
  transcribe_stream_begin: { return: "int32", arguments: ["pointer", "pointer", "pointer"] },
  transcribe_stream_feed: { return: "int32", arguments: ["pointer", "buffer", "int32", "pointer"] },
  transcribe_stream_finalize: { return: "int32", arguments: ["pointer", "pointer"] },
  transcribe_stream_reset: { return: "void", arguments: ["pointer"] },
  transcribe_full_text: { return: "pointer", arguments: ["pointer"] },
  transcribe_session_free: { return: "void", arguments: ["pointer"] },
});

class HostError extends Error {
  readonly status: number | undefined;
  constructor(message: string, status?: number) { super(message); this.status = status; }
}
const text = (pointer: bigint) => pointer ? toString(pointer) ?? "" : "";
const check = (status: number, operation: string) => {
  if (status !== 0) throw new HostError(`transcribe.cpp ${operation} failed: ${text(f.transcribe_status_string(status)) || `status ${status}`}.`, status);
};
const version = text(f.transcribe_version());
if (version !== VERSION) { console.error(`The pinned transcribe.cpp library reports ${version || "no version"}, not ${VERSION}. No other ABI was used.`); process.exit(2); }
check(f.transcribe_init_backends_default(), "backend initialization");

let session = 0n, streaming = false;
const release = () => { if (session) f.transcribe_session_free(session); session = 0n; streaming = false; };
function open(path: unknown, backend: unknown): { session: bigint; describe: () => Record<string, unknown> } {
  if (typeof path !== "string" || !path.startsWith("/") || path.includes("\0")) throw new HostError("Use the exact absolute model path.");
  const requested = BACKENDS[typeof backend === "string" ? backend : "auto"];
  if (requested === undefined) throw new HostError("Choose auto, cpu or metal.");
  const params = Buffer.alloc(Number(f.transcribe_abi_struct_size(ABI_MODEL_LOAD_PARAMS)));
  f.transcribe_model_load_params_init(params);
  params.writeInt32LE(requested, 8);
  const out = Buffer.alloc(8);
  check(f.transcribe_open(path, params, 0n, out), "model load");
  const owned = out.readBigUInt64LE(0);
  const describe = () => {
    const model = f.transcribe_get_model(owned);
    const capabilities = Buffer.alloc(Number(f.transcribe_abi_struct_size(ABI_CAPABILITIES)));
    f.transcribe_capabilities_init(capabilities);
    check(f.transcribe_model_get_capabilities(model, capabilities), "capability query");
    const count = Math.min(capabilities.readInt32LE(12), MAX_LANGUAGES), list = capabilities.readBigUInt64LE(16), languages: string[] = [];
    for (let index = 0; list && index < count; index++) languages.push(text(getUint64(list, index * 8)));
    return { architecture: text(f.transcribe_model_arch_string(model)), variant: text(f.transcribe_model_variant_string(model)),
      backend: text(f.transcribe_model_backend(model)), sampleRate: capabilities.readInt32LE(8), streaming: capabilities[30] === 1, languages };
  };
  return { session: owned, describe };
}
function handle(request: Record<string, unknown>): Record<string, unknown> {
  switch (request.op) {
    case "probe": {
      const probe = open(request.path, request.backend);
      try { return probe.describe(); } finally { f.transcribe_session_free(probe.session); }
    }
    case "load": {
      release();
      const loaded = open(request.path, request.backend);
      session = loaded.session;
      const info = loaded.describe();
      if (info.streaming !== true || info.sampleRate !== 16_000) { release(); throw new HostError("This model cannot stream 16-kHz live dictation. No other model was loaded."); }
      return info;
    }
    case "begin":
      if (!session) throw new HostError("Load the exact trusted model before streaming.");
      if (streaming) f.transcribe_stream_reset(session);
      check(f.transcribe_stream_begin(session, 0n, 0n), "stream begin");
      streaming = true; return {};
    case "feed": {
      if (!session || !streaming || typeof request.pcm !== "string") throw new HostError("Feed only base64 PCM16 into the active stream.");
      const pcm = Buffer.from(request.pcm, "base64");
      if (!pcm.length || pcm.length % 2 || pcm.length > 64 * 1024) throw new HostError("Use bounded mono 16-kHz PCM16 frames.");
      const samples = new Float32Array(pcm.length / 2);
      for (let index = 0; index < samples.length; index++) samples[index] = pcm.readInt16LE(index * 2) / 32768;
      try { check(f.transcribe_stream_feed(session, Buffer.from(samples.buffer), samples.length, 0n), "stream feed"); }
      finally { samples.fill(0); pcm.fill(0); }
      return { text: text(f.transcribe_full_text(session)) };
    }
    case "finish": {
      if (!session || !streaming) throw new HostError("No active stream to finalize.");
      streaming = false;
      check(f.transcribe_stream_finalize(session, 0n), "stream finalize");
      return { text: text(f.transcribe_full_text(session)) };
    }
    case "reset":
      if (session) f.transcribe_stream_reset(session);
      streaming = false; return {};
    default: throw new HostError("Unsupported private transcribe request.");
  }
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on("line", (line) => {
  let reply: Record<string, unknown>;
  try {
    if (line.length > MAX_LINE) throw new HostError("The private transcribe request exceeded its bound.");
    const request: unknown = JSON.parse(line);
    if (!request || typeof request !== "object" || Array.isArray(request)) throw new HostError("Malformed private transcribe request.");
    reply = { ok: true, ...handle(request as Record<string, unknown>) };
  } catch (error) {
    reply = { ok: false, error: error instanceof Error ? error.message : "The private transcribe request failed.", ...(error instanceof HostError && error.status !== undefined ? { status: error.status } : {}) };
  }
  process.stdout.write(`${JSON.stringify(reply)}\n`);
});
lines.once("close", () => { release(); process.exit(0); });
for (const signal of ["SIGTERM", "SIGINT"] as const) process.once(signal, () => { release(); process.exit(0); });
