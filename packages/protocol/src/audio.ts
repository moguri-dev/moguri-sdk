import { Type, type Static } from "typebox";

export const SPEECH_SAMPLE_RATE = 16_000;
export const MAX_SPEECH_SAMPLES = SPEECH_SAMPLE_RATE * 120;
export const MAX_SPEECH_BYTES = 44 + MAX_SPEECH_SAMPLES * 2;
const id = Type.String({ pattern: "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$" });
const sessionId = Type.String({ minLength: 1, maxLength: 128 });
export const SpeechCaptureRequestSchema = Type.Union([
  Type.Object({ action: Type.Literal("start"), sessionId, id, streaming: Type.Optional(Type.Literal(true)) }, { additionalProperties: false }),
  Type.Object({ action: Type.Literal("cancel"), sessionId, id, token: id }, { additionalProperties: false }),
  Type.Object({ action: Type.Literal("upload"), sessionId, id, token: id, audio: Type.String({ minLength: 1, maxLength: Math.ceil(MAX_SPEECH_BYTES / 3) * 4 }) }, { additionalProperties: false }),
  Type.Object({ action: Type.Literal("append"), sessionId, id, token: id, sequence: Type.Integer({ minimum: 1, maximum: 10000 }),
    audio: Type.String({ minLength: 4, maxLength: Math.ceil(64 * 1024 / 3) * 4 }) }, { additionalProperties: false }),
  Type.Object({ action: Type.Literal("finish"), sessionId, id, token: id, sequence: Type.Integer({ minimum: 0, maximum: 10000 }) }, { additionalProperties: false }),
  Type.Object({ action: Type.Literal("read"), sessionId, id, token: id }, { additionalProperties: false }),
]);
export type SpeechCaptureRequest = Static<typeof SpeechCaptureRequestSchema>;
export type SpeechCaptureResponse = { id: string; token: string; streaming?: true } | { id: string; accepted: true; text?: string; revision?: number };

export function audioBase64(bytes: Uint8Array): string {
  let text = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) text += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(text);
}
export function audioFromBase64(value: string): Uint8Array {
  const text = atob(value);
  return Uint8Array.from(text, (character) => character.charCodeAt(0));
}

export function encodeSpeechPcm(samples: Float32Array): Uint8Array {
  if (!samples.length || samples.length > MAX_SPEECH_SAMPLES) throw new Error("Capture non-empty audio up to two minutes. No audio was truncated.");
  const bytes = new Uint8Array(samples.length * 2), view = new DataView(bytes.buffer);
  for (let i = 0; i < samples.length; i++) {
    if (!Number.isFinite(samples[i])) throw new Error("Captured PCM contains a non-finite sample. No audio was accepted.");
    const value = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
  }
  return bytes;
}

export function encodeSpeechWav(samples: Float32Array): Uint8Array {
  const pcm = encodeSpeechPcm(samples);
  const bytes = new Uint8Array(44 + samples.length * 2), view = new DataView(bytes.buffer);
  const ascii = (offset: number, text: string) => { for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i)); };
  ascii(0, "RIFF"); view.setUint32(4, bytes.length - 8, true); ascii(8, "WAVE"); ascii(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, SPEECH_SAMPLE_RATE, true); view.setUint32(28, SPEECH_SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); ascii(36, "data"); view.setUint32(40, samples.length * 2, true);
  bytes.set(pcm, 44); pcm.fill(0);
  return bytes;
}

export function validateSpeechWav(bytes: Uint8Array) {
  if (bytes.byteLength <= 44 || bytes.byteLength > MAX_SPEECH_BYTES || (bytes.byteLength - 44) % 2) throw new Error("Use a non-empty canonical PCM16 WAV up to two minutes. No audio was truncated.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (offset: number, value: string) => Array.from(value).every((character, index) => view.getUint8(offset + index) === character.charCodeAt(0));
  if (!ascii(0, "RIFF") || !ascii(8, "WAVE") || !ascii(12, "fmt ") || !ascii(36, "data") ||
    view.getUint32(4, true) !== bytes.length - 8 || view.getUint32(16, true) !== 16 || view.getUint16(20, true) !== 1 ||
    view.getUint16(22, true) !== 1 || view.getUint32(24, true) !== SPEECH_SAMPLE_RATE || view.getUint32(28, true) !== SPEECH_SAMPLE_RATE * 2 ||
    view.getUint16(32, true) !== 2 || view.getUint16(34, true) !== 16 || view.getUint32(40, true) !== bytes.length - 44) {
    throw new Error("Speech capture must be exact mono 16-kHz PCM16 WAV. Unsupported headers, channels and rates are not relabeled or substituted.");
  }
  const samples = (bytes.length - 44) / 2;
  return { sampleRate: SPEECH_SAMPLE_RATE, channels: 1, samples, durationMs: samples / SPEECH_SAMPLE_RATE * 1000 };
}
