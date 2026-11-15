import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { LocalDictation, NEMOTRON_MODEL } from "../apps/service/src/voice.ts";
import { readModelHeader } from "../apps/service/src/voice-models.ts";
import { EventStore } from "../apps/service/src/store.ts";
import { startService } from "../apps/service/src/server.ts";
import { defaultSettings, encodeSpeechWav, MoguriSdk, PROTOCOL_VERSION, type UserSettings, type VoiceModelInspection } from "../packages/sdk/src/index.ts";
import { setupFixture } from "./fixture.ts";
import { retainedCiphertextRows, removeExternalVoiceModelFixtureMarker } from "./fixtures/legacy-state.ts";
import { generatedGguf, legacyWhisperBin, nemoOfflineGguf, nemoStreamingGguf, sha256, transcribeStreamingGguf, transcribeWhisperGguf } from "./fixtures/voice-models.ts";

const fakeSpeech = resolve("tests/fixtures/fake-speech.mjs"), fakeHost = [process.execPath, resolve("tests/fixtures/fake-transcribe-host.mjs")];
const speech = { executable: process.execPath, prefixArgs: [fakeSpeech], transcribeHost: fakeHost };
const trusted = (inspection: VoiceModelInspection): UserSettings["voice"] => {
  const { fingerprint: _f, streaming: _s, license: _l, languages: _languages, ...fields } = inspection;
  return { ...defaultSettings().voice, model: { source: "external", ...fields, trustedAt: "2026-11-15T00:00:00.000Z" } };
};
const touch = (path: string, offsetMs: number) => utimes(path, new Date(), new Date(Date.now() + offsetMs));

test("model review reads headers, accepts only streaming models and never touches the chosen file", async () => {
  assert.deepEqual(readModelHeader(nemoStreamingGguf()), { format: "gguf", architecture: "asr", name: ".generated-nemotron-streaming", cacheSupported: true });
  assert.equal(readModelHeader(legacyWhisperBin()).format, "whisper-ggml");
  assert.equal(readModelHeader(Buffer.from("generated unknown bytes, not a model")).format, "unknown");
  assert.equal(readModelHeader(nemoStreamingGguf().subarray(0, 40)).architecture, undefined);
  const directory = await mkdtemp(join(tmpdir(), "moguri-generated-voice-review-"));
  const dictation = new LocalDictation(directory, speech);
  const write = async (name: string, bytes: Buffer) => { const path = join(directory, name); await writeFile(path, bytes); return path; };
  try {
    const nemo = await write("nemo.gguf", nemoStreamingGguf()), before = await stat(nemo);
    const reviewed = await dictation.inspect(nemo, AbortSignal.timeout(10_000), () => {});
    assert.deepEqual({ ...reviewed, path: undefined, fingerprint: undefined }, { path: undefined, fingerprint: undefined, sha256: sha256(nemoStreamingGguf()),
      bytes: before.size, runtime: "nemo-speech", architecture: "nemo-asr", name: "generated-nemotron-streaming", streaming: true, license: null, languages: [] });
    assert.equal((await stat(nemo)).mtimeMs, before.mtimeMs);
    const moonshine = await write("moonshine.gguf", transcribeStreamingGguf()), link = join(directory, "linked.gguf");
    await symlink(moonshine, link);
    const linked = await dictation.inspect(link, AbortSignal.timeout(10_000), () => {});
    assert.equal(linked.path, await realpath(moonshine));
    assert.deepEqual([linked.runtime, linked.architecture, linked.license, linked.languages], ["transcribe", "moonshine_streaming", "mit", ["en"]]);
    for (const [name, bytes, expected] of [
      ["parakeet-offline.gguf", nemoOfflineGguf(), { code: "speech_model_streaming" }],
      ["whisper.gguf", transcribeWhisperGguf(), { code: "speech_model_streaming", message: /Whisper models transcribe only after recording/ }],
      ["ggml-whisper.bin", legacyWhisperBin(), { code: "speech_model_streaming", message: /Whisper/ }],
      ["unknown.bin", Buffer.from("generated unknown bytes, not a speech model"), { code: "speech_model_format" }],
    ] as const) await assert.rejects(async () => dictation.inspect(await write(name, bytes), AbortSignal.timeout(10_000), () => {}), expected);
    await assert.rejects(() => dictation.inspect(join(directory, "missing.gguf"), AbortSignal.timeout(1000), () => {}), { code: "speech_model_missing" });
    await assert.rejects(() => dictation.inspect("relative/model.gguf", AbortSignal.timeout(1000), () => {}), { code: "speech_model_path" });
    await mkdir(join(directory, "speech-models"));
    await assert.rejects(async () => dictation.inspect(await write("speech-models/copy.gguf", nemoStreamingGguf()), AbortSignal.timeout(1000), () => {}), { code: "speech_model_managed" });
    await assert.rejects(() => dictation.inspect(directory, AbortSignal.timeout(1000), () => {}), { code: "speech_model_file" });
  } finally { await dictation.close(); await rm(directory, { recursive: true, force: true }); }
});

test("a trusted transcribe.cpp model streams through its isolated host and a changed digest blocks use until reviewed again", async () => {
  const directory = await mkdtemp(join(tmpdir(), "moguri-generated-voice-external-"));
  const dictation = new LocalDictation(directory, speech), path = join(directory, "moonshine.gguf"), original = transcribeStreamingGguf();
  try {
    await writeFile(path, original);
    const voice = trusted(await dictation.inspect(path, AbortSignal.timeout(10_000), () => {}));
    const ready = await dictation.status(voice);
    assert.deepEqual([ready.runtimeReady, ready.modelReady, ready.model?.trust, ready.model?.runtime, ready.languageLocales.length], [true, true, "trusted", "transcribe", 0]);
    const partials: string[] = [];
    const stream = await dictation.stream("generated-external-stream", voice, new AbortController().signal, (text) => partials.push(text));
    await stream.append(new Uint8Array(6400)); await stream.append(new Uint8Array(6400));
    assert.deepEqual(partials, ["Generated", "Generated transcribe"]);
    assert.deepEqual(await stream.finish(), { text: "Generated transcribe dictation.", modelId: "Generated Moonshine Streaming", language: "auto", source: "local" });
    const wav = join(directory, "generated.wav");
    await writeFile(wav, encodeSpeechWav(new Float32Array(16_000)));
    assert.equal((await dictation.transcribe("generated-external-file", wav, voice, AbortSignal.timeout(10_000))).text, "Generated transcribe dictation.");
    await assert.rejects(() => dictation.transcribe("generated-external-mic", "microphone", voice, AbortSignal.timeout(1000)), { code: "speech_runtime_microphone" });

    const replaced = Buffer.from(original); replaced.writeUInt8(replaced.readUInt8(replaced.length - 1) ^ 1, replaced.length - 1);
    await writeFile(path, replaced); await touch(path, 5000);
    assert.equal((await dictation.status(voice)).model?.trust, "unverified");
    await assert.rejects(() => dictation.prepare(voice, AbortSignal.timeout(10_000)), { code: "speech_model_changed", message: /Review and trust it again/ });
    const changed = await dictation.status(voice);
    assert.deepEqual([changed.modelReady, changed.model?.trust, changed.model?.observedSha256], [false, "changed", sha256(replaced)]);
    await assert.rejects(() => dictation.stream("generated-blocked", voice, new AbortController().signal, () => {}), { code: "speech_model_changed" });
    await writeFile(path, Buffer.concat([original, Buffer.from("x")])); await touch(path, 6000);
    assert.equal((await dictation.status(voice)).model?.trust, "changed");

    await writeFile(path, original); await touch(path, 7000);
    await dictation.prepare(voice, AbortSignal.timeout(10_000));
    assert.equal((await dictation.status(voice)).model?.trust, "trusted");
    assert.deepEqual(await readFile(path), original);
  } finally { await dictation.close(); await rm(directory, { recursive: true, force: true }); }
});

test("a trusted NeMo streaming GGUF keeps using the pinned NeMo runtime with its exact file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "moguri-generated-voice-nemo-"));
  const dictation = new LocalDictation(directory, speech), path = join(directory, "nemotron.gguf");
  try {
    await writeFile(path, nemoStreamingGguf());
    const voice = trusted(await dictation.inspect(path, AbortSignal.timeout(10_000), () => {}));
    assert.equal((await dictation.status(voice)).model?.runtime, "nemo-speech");
    const stream = await dictation.stream("generated-nemo-external", voice, new AbortController().signal, () => {});
    await stream.append(new Uint8Array(6400));
    assert.equal((await stream.finish()).text, "Generated local dictation.");
  } finally { await dictation.close(); await rm(directory, { recursive: true, force: true }); }
});

test("SDK review, trust, generic-settings guard, managed switch, disable and restart never delete the external file", async () => {
  const weights = Buffer.from("generated managed model bytes");
  const model = { ...NEMOTRON_MODEL, filename: "generated-managed.gguf", bytes: weights.length, sha256: sha256(weights) };
  const platform = { speech: { ...speech, model, fetch: async () => new Response(weights) } };
  const fixture = await setupFixture({ platform });
  let sdk = await new MoguriSdk(fixture.service.connection).ready(), service: Awaited<ReturnType<typeof startService>> | undefined;
  const path = join(fixture.directory, "shared-models", "moonshine.gguf"), bytes = transcribeStreamingGguf();
  try {
    await mkdir(join(fixture.directory, "shared-models")); await writeFile(path, bytes);
    const review = async () => {
      const job = await sdk.voice.inspectModel(path);
      assert.equal((await sdk.jobs.wait(job.id!)).status, "completed");
      return job.id!;
    };
    const stale = await review();
    assert.equal((await sdk.voice.inspection(stale)).sha256, sha256(bytes));
    await touch(path, 5000);
    await assert.rejects(() => sdk.voice.trustModel(stale), { code: "speech_model_changed" });
    assert.equal(sdk.settings.get()!.values.voice.model, undefined);
    await sdk.voice.trustModel(await review());
    const selected = sdk.settings.get()!.values.voice;
    assert.deepEqual([selected.enabled, selected.model?.path, selected.model?.sha256, selected.model?.runtime], [true, await realpath(path), sha256(bytes), "transcribe"]);
    assert.equal((await sdk.voice.status()).voice.model?.trust, "trusted");
    const values = sdk.settings.get()!.values;
    await assert.rejects(() => sdk.settings.update({ ...values, voice: { ...values.voice, model: { ...values.voice.model!, sha256: "0".repeat(64) } } }, sdk.settings.get()!.revision), { code: "speech_model_review" });
    await assert.rejects(() => sdk.settings.update({ ...values, voice: { ...values.voice, model: undefined } }, sdk.settings.get()!.revision), { code: "speech_model_review" });
    await sdk.settings.update({ ...values, voice: { ...values.voice, standby: true } }, sdk.settings.get()!.revision);
    assert.equal(sdk.settings.get()!.values.voice.model?.sha256, sha256(bytes));

    const lease = await sdk.voice.startCapture(fixture.sessionId, undefined, { streaming: true });
    await sdk.voice.appendCapture(fixture.sessionId, lease.id, lease.token, 1, new Uint8Array(6400));
    await sdk.voice.finishCapture(fixture.sessionId, lease.id, lease.token, 1);
    assert.equal((await sdk.jobs.wait(lease.id)).status, "completed");
    assert.equal(await sdk.voice.transcript(fixture.sessionId, lease.id), "Generated transcribe dictation.");

    assert.equal((await sdk.jobs.wait((await sdk.voice.disable(true)).id!)).status, "completed");
    assert.deepEqual(await readFile(path), bytes);
    await sdk.settings.update({ ...sdk.settings.get()!.values, voice: { ...sdk.settings.get()!.values.voice, enabled: true } }, sdk.settings.get()!.revision);

    sdk.disconnect(); await fixture.service.close();
    service = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey,
      platform: { ...platform, terminal: { defaultRoot: fixture.home, vault: fixture.terminalVault } } });
    sdk = await new MoguriSdk(service.connection).ready();
    assert.equal(sdk.settings.get()!.values.voice.model?.sha256, sha256(bytes));
    const restarted = (await sdk.voice.status()).voice;
    assert.deepEqual([restarted.modelReady, restarted.model?.trust], [true, "unverified"]);
    await sdk.voice.useManagedModel();
    assert.equal(sdk.settings.get()!.values.voice.model, undefined);
    assert.equal((await sdk.voice.status()).voice.model?.source, "managed");
    assert.deepEqual(await readFile(path), bytes);
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await service?.close(); await fixture.close(); }
});

test("schema 106 upgrades to the external voice model marker and refuses premature markers or relabelled selections", async (t) => {
  await t.test("upgrade", async () => {
    const fixture = await setupFixture(), path = fixture.service.store.path;
    let reopened: EventStore | undefined;
    try {
      await fixture.service.close();
      const raw = new DatabaseSync(path);
      try { removeExternalVoiceModelFixtureMarker(raw, fixture.service.controller.events(0)); raw.exec("PRAGMA user_version=106"); }
      finally { raw.close(); }
      const original = (() => { const db = new DatabaseSync(path); try { return retainedCiphertextRows(db); } finally { db.close(); } })();
      reopened = new EventStore(path, fixture.retentionKey);
      assert.equal(reopened.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
      assert.equal(reopened.db.prepare("SELECT value FROM retention_metadata WHERE id='external_voice_model_schema'").get()?.value, "1");
      assert.deepEqual(retainedCiphertextRows(reopened.db), original);
    } finally { reopened?.close(); await fixture.close(); }
  });
  for (const change of ["missing", "premature", "selection-history"] as const) await t.test(change, async () => {
    const fixture = await setupFixture({ platform: { speech } }), sdk = await new MoguriSdk(fixture.service.connection).ready();
    try {
      if (change === "selection-history") {
        const path = join(fixture.directory, "nemotron.gguf");
        await writeFile(path, generatedGguf({ "general.architecture": "asr", "asr.encoder.cache_supported": true }));
        const job = await sdk.voice.inspectModel(path);
        assert.equal((await sdk.jobs.wait(job.id!)).status, "completed");
        await sdk.voice.trustModel(job.id!);
        assert.throws(() => removeExternalVoiceModelFixtureMarker(new DatabaseSync(":memory:"), fixture.service.controller.events(0)), /genuine pre-107 history/);
      }
      sdk.disconnect(); await fixture.service.close();
      const raw = new DatabaseSync(fixture.service.store.path);
      let original;
      try {
        raw.exec(change === "missing" ? "DELETE FROM retention_metadata WHERE id='external_voice_model_schema'" :
          change === "premature" ? "PRAGMA user_version=106" : "DELETE FROM retention_metadata WHERE id='external_voice_model_schema'; PRAGMA user_version=106");
        original = retainedCiphertextRows(raw);
      } finally { raw.close(); }
      assert.throws(() => new EventStore(fixture.service.store.path, fixture.retentionKey),
        change === "missing" ? /Missing or invalid external voice model schema marker/ : change === "premature" ? /Premature external voice model/ : /pre-107 lineage/);
      const preserved = new DatabaseSync(fixture.service.store.path);
      try { assert.deepEqual(retainedCiphertextRows(preserved), original); } finally { preserved.close(); }
    } finally { sdk.disconnect(); await fixture.close(); }
  });
});
