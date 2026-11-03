import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { LocalDictation, NEMOTRON_MODEL } from "../apps/service/src/voice.ts";
import { setupFixture, waitFor } from "./fixture.ts";

const weights = Buffer.from("generated single managed voice model");
const model = { ...NEMOTRON_MODEL, filename: "generated-managed.gguf", bytes: weights.length, sha256: createHash("sha256").update(weights).digest("hex") };

test("explicit enable/disable owns preparation, deletion and re-download of one managed model without microphone or provider calls", async () => {
  let downloads = 0;
  const f = await setupFixture({ platform: { speech: { executable: process.execPath, prefixArgs: [resolve("tests/fixtures/fake-speech.mjs")], model,
    fetch: async () => { downloads++; return new Response(weights); } } } });
  const sdk = await new MoguriSdk(f.service.connection).ready();
  try {
    assert.equal(sdk.settings.get()!.values.voice.enabled, false);
    await assert.rejects(() => sdk.voice.record(f.sessionId), { code: "speech_disabled" });
    const installed = await sdk.jobs.wait((await sdk.voice.enable(true)).id!);
    assert.equal(installed.status, "completed"); assert.equal(downloads, 1);
    const prepared = await sdk.voice.prepare();
    assert.ok(prepared.id); assert.equal((await sdk.jobs.wait(prepared.id)).status, "completed");
    assert.equal((await sdk.voice.status()).voice.prepared, true);
    const directory = join((await sdk.runtime.status()).runtime.directory, "speech-models");
    assert.deepEqual((await readdir(directory)).filter((path) => path.endsWith(".gguf")), [model.filename]);
    const removed = await sdk.jobs.wait((await sdk.voice.disable(true)).id!);
    assert.equal(removed.status, "completed");
    assert.equal((await sdk.voice.status()).voice.modelReady, false);
    assert.equal((await sdk.voice.status()).voice.prepared, false);
    assert.deepEqual(await readdir(directory), []);
    await assert.rejects(() => sdk.voice.startCapture(f.sessionId), { code: "speech_disabled" });
    assert.equal((await sdk.jobs.wait((await sdk.voice.enable(true)).id!)).status, "completed");
    assert.equal(downloads, 2);
    assert.equal(f.requests.length, 0);
    assert.equal(f.service.controller.snapshot().jobs.some((job) => job.kind === "voice.capture" || job.kind === "voice.record"), false);
  } finally { sdk.disconnect(); await f.close(); }
});

test("disable settles an interrupted download before deleting its exact staging and never installs partial bytes", async () => {
  let began = false;
  const f = await setupFixture({ platform: { speech: { executable: process.execPath, model, fetch: async (_url, init) => {
    const signal = init?.signal;
    return new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(weights.subarray(0, 8)); began = true;
        signal?.addEventListener("abort", () => controller.error(signal.reason), { once: true });
      },
    }));
  } } } });
  const sdk = await new MoguriSdk(f.service.connection).ready();
  try {
    const download = (await sdk.voice.enable(true)).id!;
    await waitFor(() => began);
    const removal = (await sdk.voice.disable(true)).id!;
    assert.equal((await sdk.jobs.wait(removal)).status, "completed");
    assert.equal((await sdk.jobs.wait(download)).status, "cancelled");
    assert.equal((await sdk.voice.status()).voice.modelReady, false);
    assert.deepEqual(await readdir(join((await sdk.runtime.status()).runtime.directory, "speech-models")), []);
    assert.equal(f.requests.length, 0);
  } finally { sdk.disconnect(); await f.close(); }
});

test("external model selection is never a deletion grant", async () => {
  const directory = await mkdtemp(join(tmpdir(), "moguri-generated-external-model-"));
  try {
    await writeFile(join(directory, model.filename), weights);
    const voice = new LocalDictation(directory, { executable: process.execPath, model, modelDirectory: directory });
    await assert.rejects(() => voice.removeManaged(new AbortController().signal, { profileId: "generated", jobId: "generated-removal", recover: () => false }), { code: "speech_external_model" });
    assert.deepEqual(await readFile(join(directory, model.filename)), weights);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("a retained interrupted model lease needs its exact original profile and terminal job before explicit recovery", async () => {
  const directory = await mkdtemp(join(tmpdir(), "moguri-generated-model-recovery-"));
  try {
    const voice = new LocalDictation(directory, { executable: process.execPath, model, modelDirectory: directory, managedModelDirectory: true, fetch: async () => new Response(weights) });
    const lock = join(directory, `${model.filename}.operation`), staging = join(directory, `${model.filename}.download`);
    await writeFile(lock, JSON.stringify({ version: 1, profileId: "generated-original", jobId: "generated-interrupted-job", digest: model.sha256 }), { mode: 0o600 });
    await writeFile(staging, weights.subarray(0, 8), { mode: 0o600 });
    await assert.rejects(() => voice.download(new AbortController().signal, () => {}, { profileId: "generated-other", jobId: "generated-new", recover: () => true }), { code: "speech_model_owner" });
    assert.equal((await readFile(staging)).length, 8);
    await assert.rejects(() => voice.download(new AbortController().signal, () => {}, { profileId: "generated-original", jobId: "generated-new", recover: () => false }), { code: "speech_model_owner" });
    const result = await voice.download(new AbortController().signal, () => {}, { profileId: "generated-original", jobId: "generated-new", recover: (id) => id === "generated-interrupted-job" });
    assert.equal(result.installed, true);
    assert.deepEqual(await readFile(join(directory, model.filename)), weights);
    assert.deepEqual(await readdir(directory), [model.filename]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
