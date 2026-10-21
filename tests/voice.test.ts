import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { LocalDictation, NEMOTRON_MODEL } from "../apps/service/src/voice.ts";
import { defaultSettings } from "../packages/protocol/src/platform.ts";
import { waitFor } from "./fixture.ts";

const weights = Buffer.from("generated recognizer weights");
async function recognizer(extra: string[] = []) {
  const directory = await mkdtemp(join(tmpdir(), "moguri-generated-voice-"));
  const marker = join(directory, "started");
  const voice = new LocalDictation(directory, {
    executable: process.execPath,
    prefixArgs: [resolve("tests/fixtures/fake-speech.mjs"), "--started-marker", marker, ...extra],
    model: { ...NEMOTRON_MODEL, filename: "generated.gguf", bytes: weights.length, sha256: createHash("sha256").update(weights).digest("hex") },
    fetch: async () => new Response(weights),
  });
  await voice.download(new AbortController().signal, () => {});
  return { voice, marker, close: () => rm(directory, { recursive: true, force: true }) };
}
test("stopping during model verification cannot start microphone capture afterward", async () => {
  const fixture = await recognizer();
  try {
    const capture = fixture.voice.transcribe("generated-early-stop", "microphone", defaultSettings().voice, new AbortController().signal);
    fixture.voice.stop("generated-early-stop");
    await assert.rejects(capture, /stopped before microphone startup/);
    await assert.rejects(access(fixture.marker), { code: "ENOENT" });
  } finally { await fixture.close(); }
});
test("a user stop finalizes only the owned local recording", async () => {
  const fixture = await recognizer();
  try {
    const capture = fixture.voice.transcribe("generated-finalize", "microphone", defaultSettings().voice, new AbortController().signal);
    await waitFor(() => existsSync(fixture.marker));
    fixture.voice.stop("generated-finalize");
    assert.equal((await capture).text, "Generated local dictation.");
  } finally { await fixture.close(); }
});
test("oversized recognizer output escalates to kill when TERM is ignored and never returns a transcript", { timeout: 10_000 }, async () => {
  const fixture = await recognizer(["--ignore-signals"]);
  try {
    await assert.rejects(fixture.voice.transcribe("generated-output-limit", "microphone", defaultSettings().voice, new AbortController().signal), /output limit/);
    const pid = Number(await readFile(fixture.marker, "utf8"));
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  } finally { await fixture.close(); }
});
