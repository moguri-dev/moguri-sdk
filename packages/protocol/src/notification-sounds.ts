import { Type, type Static } from "typebox";
import { encodeSpeechWav, SPEECH_SAMPLE_RATE, validateSpeechWav } from "./audio.ts";

const id = Type.String({ pattern: "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$" });
const hash = Type.String({ pattern: "^[a-f0-9]{64}$" });
export interface NotificationSound { id: string; commandId: string; name: string; contentDigest: string; bytes: number; durationMs: number; createdAt: string }
export const MAX_NOTIFICATION_AUDIO_BYTES = 44 + 16_000 * 2 * 10;
export const NotificationSoundCommandSchema = Type.Union([
  Type.Object({ type: Type.Literal("notification.sound.import"), name: Type.String({ minLength: 1, maxLength: 80 }),
    audio: Type.String({ minLength: 1, maxLength: Math.ceil(MAX_NOTIFICATION_AUDIO_BYTES / 3) * 4 }) }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("notification.sound.remove"), id, expectedDigest: hash, confirm: Type.Literal(true) }, { additionalProperties: false }),
]);
export const NotificationSoundQuerySchema = Type.Object({ type: Type.Literal("notification.sound.read"), id }, { additionalProperties: false });
export type NotificationSoundCommand = Static<typeof NotificationSoundCommandSchema>;
export type NotificationSoundQuery = Static<typeof NotificationSoundQuerySchema>;
export type NotificationSoundResponse = { type: "notification.sound.read"; sound: NotificationSound; audio: string };
export function validateNotificationWav(bytes: Uint8Array) {
  const value = validateSpeechWav(bytes);
  if (bytes.byteLength > MAX_NOTIFICATION_AUDIO_BYTES || value.durationMs > 10_000) throw new Error("Notification audio must be at most ten seconds of canonical mono 16-kHz PCM16 WAV. No sound was truncated.");
  return value;
}
export type NotificationToneKind = "needs-input" | "completed";
export function defaultNotificationWav(kind: NotificationToneKind): Uint8Array {
  const frequencies = kind === "needs-input" ? [660, 880] : [523.25, 659.25, 783.99];
  const note = Math.round(SPEECH_SAMPLE_RATE * 0.12), gap = Math.round(SPEECH_SAMPLE_RATE * 0.025);
  const samples = new Float32Array(frequencies.length * (note + gap));
  for (let index = 0; index < frequencies.length; index++) for (let sample = 0; sample < note; sample++) {
    const envelope = Math.min(1, sample / 160, (note - sample) / 240);
    samples[index * (note + gap) + sample] = Math.sin(sample / SPEECH_SAMPLE_RATE * Math.PI * 2 * frequencies[index]!) * envelope * 0.16;
  }
  return encodeSpeechWav(samples);
}
