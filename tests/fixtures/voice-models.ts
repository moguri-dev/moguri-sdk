import { createHash } from "node:crypto";

/** A generated GGUF header with string/bool metadata and filler bytes. It contains no tensors or real weights. */
export function generatedGguf(metadata: Record<string, string | boolean>, filler = "generated speech model bytes"): Buffer {
  const u32 = (value: number) => { const bytes = Buffer.alloc(4); bytes.writeUInt32LE(value); return bytes; };
  const u64 = (value: number) => { const bytes = Buffer.alloc(8); bytes.writeBigUInt64LE(BigInt(value)); return bytes; };
  const text = (value: string) => { const bytes = Buffer.from(value); return Buffer.concat([u64(bytes.length), bytes]); };
  const entries = Object.entries(metadata).flatMap(([key, value]) => [text(key), ...typeof value === "boolean" ? [u32(7), Buffer.from([value ? 1 : 0])] : [u32(8), text(value)]]);
  return Buffer.concat([Buffer.from("GGUF"), u32(3), u64(0), u64(Object.keys(metadata).length), ...entries, Buffer.from(filler)]);
}
export const nemoStreamingGguf = () => generatedGguf({ "general.architecture": "asr", "general.name": ".generated-nemotron-streaming", "asr.encoder.cache_supported": true });
export const nemoOfflineGguf = () => generatedGguf({ "general.architecture": "asr", "general.name": "generated-parakeet-tdt", "asr.encoder.cache_supported": false });
export const transcribeStreamingGguf = () => generatedGguf({ "general.architecture": "moonshine_streaming", "general.name": "Generated Moonshine Streaming", "general.license": "mit" });
export const transcribeWhisperGguf = () => generatedGguf({ "general.architecture": "whisper", "general.name": "Generated Whisper" });
export const legacyWhisperBin = () => { const bytes = Buffer.alloc(64, 1); bytes.writeUInt32LE(0x67676d6c, 0); return bytes; };
export const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
