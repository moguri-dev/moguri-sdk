import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { encodeSpeechWav } from "../packages/protocol/src/audio.ts";
import { NEMOTRON_MODEL } from "../apps/service/src/voice.ts";
import { setupFixture, waitFor } from "./fixture.ts";

async function captureFixture(args: string[] = []) {
  const weights = Buffer.from("generated client-capture recognizer weights");
  const fixture = await setupFixture({ platform: { speech: {
    executable: process.execPath, prefixArgs: [resolve("tests/fixtures/fake-speech.mjs"), ...args],
    model: { ...NEMOTRON_MODEL, filename: "generated-client-capture.gguf", bytes: weights.length, sha256: createHash("sha256").update(weights).digest("hex") },
    fetch: async () => new Response(weights),
  } } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  await sdk.jobs.wait((await sdk.voice.download(true)).id!);
  return { fixture, sdk };
}

test("an exact original client capture accepts bounded PCM once, uses file ASR and retains no audio or upload credential", async () => {
  const { fixture, sdk } = await captureFixture();
  try {
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
    assert.equal(await sdk.voice.transcript(fixture.sessionId, result.id), "Generated local dictation.");
    const other = await sdk.sessions.create(null);
    await assert.rejects(() => sdk.voice.transcript(other.id!, result.id), /this session/i);
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
  const { fixture, sdk } = await captureFixture();
  try {
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

test("the exact capture admission does not wait for an unrelated full conversation snapshot", async (t) => {
  const { fixture, sdk } = await captureFixture(), snapshot = Promise.withResolvers<void>();
  const original = sdk.refresh.bind(sdk);
  const refresh = t.mock.method(sdk, "refresh", () => snapshot.promise);
  let lease: { id: string; token: string } | undefined;
  const pending = sdk.voice.startCapture(fixture.sessionId).then((value) => { lease = value; return value; });
  try {
    await waitFor(() => lease, 1000);
    assert.ok(lease); assert.ok(fixture.service.controller.snapshot().jobs.some((job) => job.id === lease!.id && job.status === "running"));
    await sdk.voice.cancelCapture(fixture.sessionId, lease.id, lease.token);
    assert.equal(fixture.requests.length, 0);
  } finally {
    snapshot.resolve(); await pending; refresh.mock.restore(); await original();
    sdk.disconnect(); await fixture.close();
  }
});

test("failed recognition remains the original owned capture error rather than a misleading missing lease", async () => {
  const { fixture, sdk } = await captureFixture(["--fail-with-diagnostic"]);
  try {
    const lease = await sdk.voice.startCapture(fixture.sessionId, undefined, { streaming: true });
    const result = await sdk.jobs.wait(lease.id);
    assert.equal(result.status, "failed"); assert.match(result.error!, /Generated recognizer could not initialize/);
    await assert.rejects(() => sdk.voice.readCapture(fixture.sessionId, lease.id, lease.token), { message: result.error! });
    await assert.rejects(() => sdk.voice.appendCapture(fixture.sessionId, lease.id, lease.token, 1, new Uint8Array(6400)), { message: result.error! });
    const other = await sdk.sessions.create(null);
    await assert.rejects(() => sdk.voice.readCapture(other.id!, lease.id, lease.token), /original.*capture/i);
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("streamed client capture returns partial text before release and commits one exact final transcript without retaining PCM", async () => {
  const { fixture, sdk } = await captureFixture();
  try {
    const lease = await sdk.voice.startCapture(fixture.sessionId, undefined, { streaming: true });
    const pcm = new Uint8Array(6400).fill(1);
    await sdk.voice.appendCapture(fixture.sessionId, lease.id, lease.token, 1, pcm);
    let partial = "";
    const deadline = Date.now() + 5000;
    while (!partial && Date.now() < deadline) {
      partial = (await sdk.voice.readCapture(fixture.sessionId, lease.id, lease.token)).text;
      if (!partial) await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(partial, "Generated ");
    await assert.rejects(() => sdk.voice.appendCapture(fixture.sessionId, lease.id, lease.token, 1, pcm), /sequence|original/i);
    await sdk.voice.finishCapture(fixture.sessionId, lease.id, lease.token, 1);
    assert.equal((await sdk.jobs.wait(lease.id)).status, "completed");
    assert.equal(await sdk.voice.transcript(fixture.sessionId, lease.id), "Generated local dictation.");
    assert.equal((await sdk.voice.readCapture(fixture.sessionId, lease.id, lease.token)).text, "Generated local dictation.");
    const events = JSON.stringify(fixture.service.controller.events(0));
    assert.equal(events.includes(lease.token), false);
    assert.equal(events.includes(Buffer.from(pcm).toString("base64")), false);
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("paged and JSON-escaped transcripts are reviewed and inserted completely, without submitting a model request", async () => {
  for (const [flag, text] of [
    ["--long-transcript", "Generated paged local dictation. ".repeat(2000).trim()],
    ["--escaped-transcript", '"'.repeat(80_000)],
  ] as const) {
    const { fixture, sdk } = await captureFixture([flag]);
    try {
      const capture = await sdk.voice.startCapture(fixture.sessionId);
      await assert.rejects(() => sdk.voice.transcript(fixture.sessionId, capture.id), /completed/i);
      await sdk.voice.uploadCapture(fixture.sessionId, capture.id, capture.token, encodeSpeechWav(new Float32Array(160).fill(0.1)));
      assert.equal((await sdk.jobs.wait(capture.id)).status, "completed");
      assert.equal(await sdk.voice.transcript(fixture.sessionId, capture.id), text);
      await sdk.voice.insert(fixture.sessionId, capture.id, fixture.session().draft.revision);
      assert.equal(fixture.session().draft.text, text);
      assert.equal(fixture.requests.length, 0);
    } finally { sdk.disconnect(); await fixture.close(); }
  }
});
