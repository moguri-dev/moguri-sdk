import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { LocalDictation, NEMOTRON_MODEL } from "../apps/service/src/voice.ts";
import { defaultSettings } from "../packages/sdk/src/index.ts";

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
    const deadline = Date.now() + 3000;
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
