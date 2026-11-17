import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { setupFixture } from "./fixture.ts";
import { discoverVoiceModels, expandHome, defaultModelRoots } from "../apps/service/src/voice-discovery.ts";
import { generatedGguf, legacyWhisperBin, nemoOfflineGguf, nemoStreamingGguf, transcribeStreamingGguf, transcribeWhisperGguf } from "./fixtures/voice-models.ts";

async function write(path: string, bytes: Buffer) { await mkdir(dirname(path), { recursive: true }); await writeFile(path, bytes); return path; }
/** A generated home with Handy's folder, a Hugging Face hub snapshot layout and files discovery must skip or reject. */
async function generatedHome() {
  const home = await mkdtemp(join(tmpdir(), "moguri-generated-home-")), hf = join(home, ".cache", "huggingface");
  await write(join(home, "Library", "Application Support", "com.pais.handy", "models", "moonshine-streaming.gguf"), transcribeStreamingGguf());
  const repository = join(hf, "hub", "models--generated--nemotron-streaming"), blob = await write(join(repository, "blobs", "generated-blob"), nemoStreamingGguf());
  for (const revision of ["generated-a", "generated-b"]) {
    await mkdir(join(repository, "snapshots", revision), { recursive: true });
    await symlink(join("..", "..", "blobs", "generated-blob"), join(repository, "snapshots", revision, "model.gguf"));
  }
  await write(join(hf, "generated", "whisper.gguf"), transcribeWhisperGguf());
  await write(join(hf, "generated", "ggml-whisper.bin"), legacyWhisperBin());
  await write(join(hf, "generated", "parakeet-offline.gguf"), nemoOfflineGguf());
  await write(join(hf, "generated", "language-model.gguf"), generatedGguf({ "general.architecture": "llama", "general.name": "Generated LLM" }));
  await write(join(hf, "generated", "canary.gguf"), generatedGguf({ "general.architecture": "canary", "general.name": "Generated Canary" }));
  await write(join(hf, "generated", "partial.gguf.incomplete"), nemoStreamingGguf());
  await write(join(hf, ".locks", "hidden.gguf"), nemoStreamingGguf());
  const outside = await mkdtemp(join(tmpdir(), "moguri-generated-outside-"));
  await symlink(await write(join(outside, "outside.gguf"), nemoStreamingGguf()), join(hf, "generated", "outside-link.gguf"));
  await write(join(home, "Documents", "never-read.gguf"), nemoStreamingGguf());
  return { home, hf, blob, outside, close: async () => { await rm(home, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); } };
}

test("default discovery finds speech models in Handy and Hugging Face caches only, deduplicated and classified by header", async () => {
  const fixture = await generatedHome();
  try {
    assert.deepEqual(defaultModelRoots(fixture.home, {}), [join(fixture.home, "Library", "Application Support", "com.pais.handy", "models"), fixture.hf]);
    assert.deepEqual(defaultModelRoots(fixture.home, { HF_HOME: "~/hf", HF_HUB_CACHE: "/generated/hub" }), [join(fixture.home, "Library", "Application Support", "com.pais.handy", "models"), join(fixture.home, "hf"), "/generated/hub"]);
    const result = await discoverVoiceModels({ home: fixture.home, env: {}, skip: [], signal: AbortSignal.timeout(10_000) });
    assert.equal(result.complete, true);
    assert.deepEqual(result.models.map((model) => [model.name, model.status]), [
      ["Generated Moonshine Streaming", "streaming"], ["generated-nemotron-streaming", "streaming"], ["Generated Canary", "review"],
      ["Generated Whisper", "unsupported"], ["generated-parakeet-tdt", "unsupported"], ["ggml-whisper.bin", "unsupported"],
    ]);
    assert.equal(result.models.find((model) => model.architecture === "nemo-asr" && model.status === "streaming")?.path, await realpath(fixture.blob));
    assert.match(result.models.find((model) => model.name === "Generated Whisper")!.reason!, /can't stream/);
    assert.equal(result.skipped, 1);
    assert.ok(result.models.every((model) => !model.path.includes("Documents") && !model.path.includes("outside") && !model.path.includes(".locks")));
  } finally { await fixture.close(); }
});

test("an explicit file or folder is searched on its own, with ~ expansion, missing paths and limits reported", async () => {
  const fixture = await generatedHome();
  try {
    assert.equal(expandHome("'~/models'", "/generated/home"), "/generated/home/models");
    assert.equal(expandHome("/generated/folder ", "/generated/home"), "/generated/folder ");
    const file = await discoverVoiceModels({ path: "~/Library/Application Support/com.pais.handy/models/moonshine-streaming.gguf", home: fixture.home, env: {}, skip: [], signal: AbortSignal.timeout(10_000) });
    assert.equal(file.searched[0]?.kind, "file"); assert.equal(file.models.length, 1); assert.equal(file.models[0]!.status, "streaming");
    const folder = await discoverVoiceModels({ path: fixture.outside, home: fixture.home, env: {}, skip: [], signal: AbortSignal.timeout(10_000) });
    assert.equal(folder.searched[0]?.kind, "folder"); assert.equal(folder.models.length, 1);
    const missing = await discoverVoiceModels({ path: join(fixture.home, "missing"), home: fixture.home, env: {}, skip: [], signal: AbortSignal.timeout(10_000) });
    assert.deepEqual(missing.searched, [{ path: join(fixture.home, "missing"), found: false }]);
    await assert.rejects(discoverVoiceModels({ path: "relative/model.gguf", home: fixture.home, env: {}, skip: [], signal: AbortSignal.timeout(10_000) }), { code: "speech_model_path" });
    const skipped = await discoverVoiceModels({ home: fixture.home, env: {}, skip: [join(fixture.hf, "hub")], signal: AbortSignal.timeout(10_000) });
    assert.ok(!skipped.models.some((model) => model.architecture === "nemo-asr" && model.status === "streaming"));
    const limited = await discoverVoiceModels({ home: fixture.home, env: {}, skip: [], signal: AbortSignal.timeout(10_000), limits: { depth: 6, entries: 50_000, ms: 10_000, headers: 2, results: 200 } });
    assert.equal(limited.complete, false); assert.match(limited.diagnostic ?? "", /Too many model files/);
  } finally { await fixture.close(); }
});

test("the SDK searches only when asked and reviews a typed ~ path without trusting it", async () => {
  const fixture = await generatedHome();
  const f = await setupFixture({ platform: { speech: { executable: process.execPath, prefixArgs: [resolve("tests/fixtures/fake-speech.mjs")],
    transcribeHost: [process.execPath, resolve("tests/fixtures/fake-transcribe-host.mjs")], home: fixture.home } } });
  const sdk = await new MoguriSdk(f.service.connection).ready();
  try {
    const events = f.service.store.events().length;
    const discovery = await sdk.voice.discoverModels();
    assert.ok(discovery.models.some((model) => model.name === "Generated Moonshine Streaming"));
    assert.equal(f.service.store.events().length, events, "searching appends nothing");
    const job = await sdk.voice.inspectModel("~/Library/Application Support/com.pais.handy/models/moonshine-streaming.gguf");
    assert.equal((await sdk.jobs.wait(job.id!)).status, "completed");
    assert.equal((await sdk.voice.inspection(job.id!)).name, "Generated Moonshine Streaming");
    assert.equal(sdk.settings.get()!.values.voice.model, undefined);
  } finally { sdk.disconnect(); await f.close(); await fixture.close(); }
});
