import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { withSpeechSpool } from "../apps/service/src/voice-spool.ts";
import { encodeSpeechWav } from "../packages/protocol/src/audio.ts";

for (const fail of [false, true]) test(`the owned generated WAV is removed and its memory wiped after ${fail ? "failed" : "completed"} recognition`, async () => {
  const root = await mkdtemp(join(tmpdir(), "moguri-generated-wav-cleanup-")), bytes = encodeSpeechWav(new Float32Array(1600).fill(0.1));
  try {
    const expected = Buffer.from(bytes);
    const result = withSpeechSpool(root, randomUUID(), bytes, new AbortController().signal, async (path) => {
      assert.deepEqual(await readFile(path), expected);
      if (fail) throw new Error("Generated recognizer failure.");
      return "Generated transcript already read from its original WAV.";
    });
    if (fail) await assert.rejects(result, /Generated recognizer failure/);
    else assert.equal(await result, "Generated transcript already read from its original WAV.");
    assert.equal(bytes.every((value) => value === 0), true);
    assert.deepEqual(await readdir(join(root, "speech-captures")), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("WAV cleanup preserves a replaced file and retains an explicit partial outcome instead of deleting another writer", async () => {
  const root = await mkdtemp(join(tmpdir(), "moguri-generated-wav-replacement-")), id = randomUUID(), path = join(root, "speech-captures", `${id}.wav`);
  const bytes = encodeSpeechWav(new Float32Array(1600).fill(0.1)), replacement = Buffer.from("Generated external replacement, not audio.");
  try {
    await assert.rejects(withSpeechSpool(root, id, bytes, new AbortController().signal, async (original) => {
      await rename(original, `${original}.displaced`);
      await writeFile(original, replacement, { mode: 0o600 });
      return "Generated original result.";
    }), { code: "speech_partial" });
    assert.deepEqual(await readFile(path), replacement);
    assert.equal(bytes.every((value) => value === 0), true);
  } finally { await rm(root, { recursive: true, force: true }); }
});
