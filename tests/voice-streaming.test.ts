import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { LocalDictation, NEMOTRON_MODEL } from "../apps/service/src/voice.ts";
import { defaultSettings } from "../packages/sdk/src/index.ts";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { startSpeechServer, type SpeechServer } from "../apps/service/src/speech-stream.ts";
import { ciTime } from "./fixtures/time-scale.ts";

test("native buffered stdout cannot hide an already ready authenticated recognizer", { skip: process.platform === "win32", timeout: ciTime(10_000) }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "moguri-generated-buffered-speech-")), executable = join(directory, "buffered-speech");
  let server: SpeechServer | undefined;
  try {
    await promisify(execFile)("cc", ["-std=c11", "-O2", resolve("tests/fixtures/buffered-speech-host.c"), "-o", executable], { timeout: ciTime(5000) });
    server = await startSpeechServer(executable, [process.execPath, resolve("tests/fixtures/fake-speech.mjs")],
      "generated-model-only.gguf", "cpu", AbortSignal.timeout(2500));
    const denied = await fetch(`${server.origin}/v1/models`, { headers: { Authorization: "Bearer generated-wrong-key" } });
    assert.equal(denied.status, 401); await denied.body?.cancel();
    const ready = await fetch(`${server.origin}/v1/models`, { headers: { Authorization: `Bearer ${server.key}` } });
    assert.equal(ready.status, 200);
    const body = await ready.json();
    assert.ok(typeof body === "object" && body !== null && "data" in body);
  } finally { await server?.close(); await rm(directory, { recursive: true, force: true }); }
});

test("listener readiness rejects unauthorized, redirected, oversized and missing-capability metadata without substituting an endpoint", async () => {
  for (const [flag, expected] of [
    ["--reject-readiness", /HTTP 401/], ["--redirect-readiness", /authenticated readiness/],
    ["--oversized-readiness", /bounded model inventory/], ["--no-asr-readiness", /no ready transcription model/],
  ] as const) {
    let owner: SpeechServer | undefined;
    await assert.rejects(() => startSpeechServer(process.execPath, [resolve("tests/fixtures/fake-speech.mjs"), flag],
      "generated-unloaded.gguf", "cpu", AbortSignal.timeout(3000), (server) => { owner = server; }), expected);
    assert.ok(owner?.closed);
  }
});

test("cancelling startup joins the exact recognizer before another listener can be admitted", async () => {
  const abort = new AbortController(), admitted = Promise.withResolvers<SpeechServer>();
  const starting = startSpeechServer(process.execPath, [resolve("tests/fixtures/fake-speech.mjs"), "--listener-delay", "2000"],
    "generated-unloaded.gguf", "cpu", abort.signal, (server) => admitted.resolve(server));
  const rejected = assert.rejects(starting, { name: "AbortError" });
  const original = await admitted.promise; abort.abort(); await rejected;
  assert.equal(original.closed, true);
});

test("the owned native realtime adapter streams partial text and commits the exact final buffer without a microphone or cloud request", async () => {
  const directory = await mkdtemp(join(tmpdir(), "moguri-generated-stream-")), models = join(directory, "speech-models");
  await mkdir(models);
  const bytes = Buffer.from("Generated recognizer model, not real speech weights.");
  const model = { ...NEMOTRON_MODEL, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
  await writeFile(join(models, model.filename), bytes);
  const executable = resolve("tests/fixtures/fake-speech.mjs");
  const dictation = new LocalDictation(directory, { executable: process.execPath, prefixArgs: [executable], model });
  const partials: string[] = [];
  try {
    const stream = await dictation.stream("generated-stream", defaultSettings().voice, new AbortController().signal, (text) => partials.push(text));
    await stream.append(new Uint8Array(6400));
    const deadline = Date.now() + ciTime(3000);
    while (!partials.length && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(partials.at(-1), "Generated ");
    const result = await stream.finish();
    assert.equal(result.text, "Generated local dictation.");
    assert.equal(result.source, "local");
    assert.equal(partials.at(-1), result.text);
    const cancelled = await dictation.stream("generated-cancel", defaultSettings().voice, new AbortController().signal, () => {});
    await cancelled.cancel();
    const replacement = await dictation.stream("generated-new-owner", defaultSettings().voice, new AbortController().signal, () => {});
    await replacement.append(new Uint8Array(6400));
    assert.equal((await replacement.finish()).text, "Generated local dictation.");
  } finally { await dictation.close?.(); await rm(directory, { recursive: true, force: true }); }
});
