import assert from "node:assert/strict";
import test from "node:test";
import { encodeSpeechWav, MAX_SPEECH_SAMPLES, validateSpeechWav } from "../packages/protocol/src/audio.ts";

test("generated mono 16-kHz audio has an exact bounded PCM16 WAV shape and sample polarity", () => {
  const samples = new Float32Array(32_000);
  samples[0] = -1; samples[1] = 0; samples[2] = 1;
  const wav = encodeSpeechWav(samples);
  const parsed = validateSpeechWav(wav);
  assert.equal(wav.byteLength, 44 + samples.length * 2);
  assert.deepEqual(parsed, { sampleRate: 16_000, channels: 1, samples: 32_000, durationMs: 2000 });
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  assert.equal(view.getInt16(44, true), -32768);
  assert.equal(view.getInt16(46, true), 0);
  assert.equal(view.getInt16(48, true), 32767);
});

test("WAV limits include exactly two minutes and reject excess, nonfinite PCM and misdeclared native headers", () => {
  assert.equal(validateSpeechWav(encodeSpeechWav(new Float32Array(MAX_SPEECH_SAMPLES))).durationMs, 120_000);
  assert.throws(() => encodeSpeechWav(new Float32Array(MAX_SPEECH_SAMPLES + 1)), /two minutes/);
  assert.throws(() => encodeSpeechWav(new Float32Array()), /non-empty/);
  assert.throws(() => encodeSpeechWav(new Float32Array([Number.NaN])), /non-finite/);
  const changed = encodeSpeechWav(new Float32Array(160));
  new DataView(changed.buffer).setUint32(24, 48_000, true);
  assert.throws(() => validateSpeechWav(changed), /not relabeled or substituted/);
  assert.throws(() => validateSpeechWav(changed.subarray(0, 43)), /canonical/);
});
