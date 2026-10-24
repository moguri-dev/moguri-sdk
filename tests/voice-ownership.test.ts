import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { encodeSpeechWav, MoguriSdk } from "../packages/sdk/src/index.ts";
import { NEMOTRON_MODEL } from "../apps/service/src/voice.ts";
import { startService } from "../apps/service/src/server.ts";
import { setupFixture, waitFor } from "./fixture.ts";

async function captureFixture() {
  const weights = Buffer.from("Generated ownership-only speech weights.");
  const platform = { speech: {
    executable: process.execPath, prefixArgs: [resolve("tests/fixtures/fake-speech.mjs")],
    model: { ...NEMOTRON_MODEL, filename: "generated-ownership.gguf", bytes: weights.length, sha256: createHash("sha256").update(weights).digest("hex") },
    fetch: async () => new Response(weights),
  } };
  const fixture = await setupFixture({ platform }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  await sdk.jobs.wait((await sdk.voice.download(true)).id!);
  return { ...fixture, sdk, platform };
}

test("concurrent admission owns one original speech job; wrong nonce/session and settled-ID replay cannot deliver audio", async () => {
  const fixture = await captureFixture();
  try {
    const results = await Promise.allSettled([fixture.sdk.voice.startCapture(fixture.sessionId), fixture.sdk.voice.startCapture(fixture.sessionId)]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const started = results.find((result) => result.status === "fulfilled")!; assert.equal(started.status, "fulfilled");
    const capture = started.value, other = await fixture.sdk.sessions.create(null);
    const audio = encodeSpeechWav(new Float32Array(160).fill(0.1));
    await assert.rejects(() => fixture.sdk.voice.uploadCapture(fixture.sessionId, capture.id, randomUUID(), audio), /own.*lease/i);
    await assert.rejects(() => fixture.sdk.voice.uploadCapture(other.id!, capture.id, capture.token, audio), /original.*capture/i);
    await fixture.sdk.voice.cancelCapture(fixture.sessionId, capture.id, capture.token);
    await waitFor(() => fixture.service.controller.snapshot().jobs.find((job) => job.id === capture.id)?.status === "cancelled");
    await assert.rejects(() => fixture.sdk.voice.startCapture(fixture.sessionId, capture.id), /already exists|identity/i);
    assert.equal(fixture.service.controller.snapshot().jobs.filter((job) => job.kind === "voice.capture").length, 1);
    assert.equal(fixture.requests.length, 0);
  } finally { fixture.sdk.disconnect(); await fixture.close(); }
});

test("restart removes only recognized private staged clips and never reattaches a stale upload lease", async () => {
  const fixture = await captureFixture(), directory = join(fixture.directory, "state"), spool = join(directory, "speech-captures");
  let restarted: Awaited<ReturnType<typeof startService>> | undefined, current: MoguriSdk | undefined;
  try {
    const capture = await fixture.sdk.voice.startCapture(fixture.sessionId);
    fixture.sdk.disconnect(); await fixture.service.close();
    await mkdir(spool, { recursive: true, mode: 0o700 });
    await writeFile(join(spool, `${randomUUID()}.wav`), encodeSpeechWav(new Float32Array(160)), { mode: 0o600 });
    restarted = await startService({ stateDir: directory, provider: fixture.provider, retentionKey: fixture.retentionKey, platform: fixture.platform });
    current = await new MoguriSdk(restarted.connection).ready();
    assert.deepEqual(await readdir(spool), []);
    await assert.rejects(() => current!.voice.uploadCapture(fixture.sessionId, capture.id, capture.token, encodeSpeechWav(new Float32Array(160))), /original.*capture/i);
    await assert.rejects(() => current!.voice.startCapture(fixture.sessionId, capture.id), /already exists|identity/i);
    assert.equal(fixture.requests.length, 0);
  } finally { current?.disconnect(); fixture.sdk.disconnect(); await restarted?.close(); await fixture.close(); }
});

test("unknown crash-staging entries survive restart and block capture without disabling ordinary settings", async () => {
  const fixture = await captureFixture(), directory = join(fixture.directory, "state"), spool = join(directory, "speech-captures");
  let restarted: Awaited<ReturnType<typeof startService>> | undefined, current: MoguriSdk | undefined;
  try {
    fixture.sdk.disconnect(); await fixture.service.close();
    await mkdir(spool, { recursive: true, mode: 0o700 });
    await writeFile(join(spool, "generated-unknown.keep"), "Generated unrelated private entry.", { mode: 0o600 });
    restarted = await startService({ stateDir: directory, provider: fixture.provider, retentionKey: fixture.retentionKey, platform: fixture.platform });
    current = await new MoguriSdk(restarted.connection).ready();
    await assert.rejects(() => current!.voice.startCapture(fixture.sessionId), /unrecognized|staging/i);
    assert.deepEqual(await readdir(spool), ["generated-unknown.keep"]);
    assert.equal(current.settings.get()?.values.voice.backend, "auto");
  } finally { current?.disconnect(); fixture.sdk.disconnect(); await restarted?.close(); await fixture.close(); }
});
