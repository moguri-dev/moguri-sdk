import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { encodeSpeechWav } from "../packages/protocol/src/audio.ts";
import { NEMOTRON_MODEL } from "../apps/service/src/voice.ts";
import { setupFixture, waitFor } from "./fixture.ts";

test("an exact original client capture accepts bounded PCM once, uses file ASR and retains no audio or upload credential", async () => {
  const weights = Buffer.from("generated client-capture recognizer weights");
  const fixture = await setupFixture({ platform: { speech: {
    executable: process.execPath, prefixArgs: [resolve("tests/fixtures/fake-speech.mjs")],
    model: { ...NEMOTRON_MODEL, filename: "generated-client-capture.gguf", bytes: weights.length, sha256: createHash("sha256").update(weights).digest("hex") },
    fetch: async () => new Response(weights),
  } } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await sdk.jobs.wait((await sdk.voice.download(true)).id!);
    const settings = sdk.settings.get()!;
    await sdk.settings.update({ ...settings.values, voice: { ...settings.values.voice, inputDeviceId: "generated-exact-client-device" } }, settings.revision);
    const capture = await sdk.voice.startCapture(fixture.sessionId);
    const samples = new Float32Array(16_000);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.sin(i * 0.17) * 0.2;
    const audio = encodeSpeechWav(samples);
    await sdk.voice.uploadCapture(fixture.sessionId, capture.id, capture.token, audio);
    const result = await sdk.jobs.wait(capture.id);
    assert.equal(result.kind, "voice.capture"); assert.equal(result.status, "completed");
    assert.equal(JSON.parse((await sdk.mcp.readResult(result.id)).text).text, "Generated local dictation.");
    await assert.rejects(() => sdk.voice.uploadCapture(fixture.sessionId, capture.id, capture.token, audio), /original|consumed|running/i);
    const retained = JSON.stringify(fixture.service.controller.events(0));
    assert.equal(retained.includes(capture.token), false);
    assert.equal(retained.includes(Buffer.from(audio).toString("base64")), false);
    assert.equal(retained.includes(createHash("sha256").update(audio).digest("hex")), false);
    assert.deepEqual(await readdir(join(fixture.directory, "state", "speech-captures")), []);
    assert.equal(fixture.session().draft.text, ""); assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("the original capture can be cancelled after its client disconnects without reopening audio or reconnecting a profile", async () => {
  const weights = Buffer.from("generated cancelled-capture weights");
  const fixture = await setupFixture({ platform: { speech: {
    executable: process.execPath, prefixArgs: [resolve("tests/fixtures/fake-speech.mjs")],
    model: { ...NEMOTRON_MODEL, filename: "generated-cancel-capture.gguf", bytes: weights.length, sha256: createHash("sha256").update(weights).digest("hex") },
    fetch: async () => new Response(weights),
  } } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await sdk.jobs.wait((await sdk.voice.download(true)).id!);
    const capture = await sdk.voice.startCapture(fixture.sessionId);
    sdk.disconnect();
    await sdk.voice.cancelCapture(fixture.sessionId, capture.id, capture.token);
    await waitFor(() => fixture.service.controller.snapshot().jobs.find((job) => job.id === capture.id)?.status === "cancelled");
    assert.equal(sdk.getState().status, "disconnected");
    const original = fixture.service.controller.snapshot().jobs.find((job) => job.id === capture.id)!;
    assert.equal(original.resultDigest, null);
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});
