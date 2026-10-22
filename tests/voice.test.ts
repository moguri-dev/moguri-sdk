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
test("slow native finalization is not killed after three seconds or interrupted by another stop", { timeout: 10_000 }, async () => {
  const fixture = await recognizer(["--finalize-delay", "3300"]);
  try {
    const capture = fixture.voice.transcribe("generated-slow-finalize", "microphone", defaultSettings().voice, new AbortController().signal);
    await waitFor(() => existsSync(fixture.marker));
    fixture.voice.stop("generated-slow-finalize");
    await new Promise((resolve) => setTimeout(resolve, 50));
    fixture.voice.stop("generated-slow-finalize");
    assert.equal((await capture).text, "Generated local dictation.");
  } finally { await fixture.close(); }
});
test("cancellation during graceful finalization discards the transcript and reaps the recognizer", async () => {
  const fixture = await recognizer(["--finalize-delay", "3300"]);
  const abort = new AbortController();
  try {
    const capture = fixture.voice.transcribe("generated-cancel-finalize", "microphone", defaultSettings().voice, abort.signal);
    await waitFor(() => existsSync(fixture.marker));
    fixture.voice.stop("generated-cancel-finalize");
    abort.abort();
    await assert.rejects(capture, /aborted/i);
    const pid = Number(await readFile(fixture.marker, "utf8"));
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  } finally { await fixture.close(); }
});
test("native speech failure retains the actual signal and actionable stderr instead of an anonymous signal", async () => {
  const fixture = await recognizer(["--exit-signal", "SIGTERM"]);
  try {
    await assert.rejects(fixture.voice.transcribe("generated-native-signal", "microphone", defaultSettings().voice, new AbortController().signal),
      /SIGTERM.*Generated native capture failed/s);
  } finally { await fixture.close(); }
});
test("native speech failure retains its numeric status and bounded backend diagnostic", async () => {
  const fixture = await recognizer(["--exit-code", "7"]);
  try {
    await assert.rejects(fixture.voice.transcribe("generated-native-status", "microphone", defaultSettings().voice, new AbortController().signal),
      /7.*Generated native model backend is unavailable/s);
  } finally { await fixture.close(); }
});
test("native stderr is bounded without losing the final backend error", async () => {
  const fixture = await recognizer(["--stderr-bytes", "65536", "--exit-code", "7"]);
  try {
    await assert.rejects(fixture.voice.transcribe("generated-bounded-error", "microphone", defaultSettings().voice, new AbortController().signal),
      (error: unknown) => error instanceof Error && error.message.length < 2400 && error.message.includes("Generated native model backend is unavailable"));
  } finally { await fixture.close(); }
});
test("graceful finalization enforces its separate thirty-second deadline and reaps the recognizer", async (context) => {
  const fixture = await recognizer(["--ignore-stop"]);
  try {
    const capture = fixture.voice.transcribe("generated-finalize-deadline", "microphone", defaultSettings().voice, new AbortController().signal);
    await waitFor(() => existsSync(fixture.marker));
    context.mock.timers.enable({ apis: ["setTimeout"] });
    fixture.voice.stop("generated-finalize-deadline");
    context.mock.timers.tick(30_000);
    context.mock.timers.reset();
    await assert.rejects(capture, /30 seconds after stopping/);
    const pid = Number(await readFile(fixture.marker, "utf8"));
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  } finally { context.mock.timers.reset(); await fixture.close(); }
});
test("oversized recognizer output escalates to kill when TERM is ignored and never returns a transcript", { timeout: 10_000 }, async () => {
  const fixture = await recognizer(["--ignore-signals"]);
  try {
    await assert.rejects(fixture.voice.transcribe("generated-output-limit", "microphone", defaultSettings().voice, new AbortController().signal), /output limit/);
    const pid = Number(await readFile(fixture.marker, "utf8"));
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  } finally { await fixture.close(); }
});
