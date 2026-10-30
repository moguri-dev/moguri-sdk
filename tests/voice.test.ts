import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { LocalDictation, NEMOTRON_MODEL, type SpeechOptions } from "../apps/service/src/voice.ts";
import { defaultSettings } from "../packages/protocol/src/platform.ts";
import { waitFor } from "./fixture.ts";

const weights = Buffer.from("generated recognizer weights");
async function recognizer(extra: string[] = [], options: Pick<SpeechOptions, "finalizationTimeoutMs"> = {}) {
  const directory = await mkdtemp(join(tmpdir(), "moguri-generated-voice-"));
  const marker = join(directory, "started");
  const voice = new LocalDictation(directory, {
    executable: process.execPath,
    prefixArgs: [resolve("tests/fixtures/fake-speech.mjs"), "--started-marker", marker, ...extra],
    model: { ...NEMOTRON_MODEL, filename: "generated.gguf", bytes: weights.length, sha256: createHash("sha256").update(weights).digest("hex") },
    fetch: async () => new Response(weights),
    ...options,
  });
  await voice.download(new AbortController().signal, () => {});
  const controllers = new Set<AbortController>(), pending = new Set<Promise<unknown>>(), recording = new Set<string>();
  const capture = (id: string, signal = new AbortController().signal, progress: (phase: string) => void = () => {}) => {
    const abort = new AbortController(); controllers.add(abort);
    const work = voice.transcribe(id, "microphone", defaultSettings().voice, AbortSignal.any([signal, abort.signal]), (phase) => {
      if (phase.startsWith("Recording")) recording.add(id);
      progress(phase);
    });
    pending.add(work);
    const settled = () => { pending.delete(work); controllers.delete(abort); recording.delete(id); };
    void work.then(settled, settled);
    return work;
  };
  return { voice, marker, capture, ready: (id: string) => waitFor(() => recording.has(id)), close: async () => {
    for (const abort of controllers) abort.abort();
    await Promise.allSettled(pending); await rm(directory, { recursive: true, force: true });
  } };
}
test("stopping during model verification cannot start microphone capture afterward", async () => {
  const fixture = await recognizer();
  try {
    const capture = fixture.capture("generated-early-stop");
    fixture.voice.stop("generated-early-stop");
    await assert.rejects(capture, /stopped before microphone startup/);
    await assert.rejects(access(fixture.marker), { code: "ENOENT" });
  } finally { await fixture.close(); }
});
test("a user stop finalizes only the owned local recording", async () => {
  const fixture = await recognizer();
  try {
    const capture = fixture.capture("generated-finalize");
    await fixture.ready("generated-finalize");
    fixture.voice.stop("generated-finalize");
    assert.equal((await capture).text, "Generated local dictation.");
  } finally { await fixture.close(); }
});
test("microphone initialization is not mislabeled as recording and can only be cancelled before readiness", async () => {
  const fixture = await recognizer(["--no-ready"]), abort = new AbortController(), phases: string[] = [];
  try {
    const capture = fixture.capture("generated-preparing", abort.signal, (phase) => phases.push(phase));
    await waitFor(() => existsSync(fixture.marker));
    assert.equal(phases.some((phase) => phase.startsWith("Recording")), false);
    assert.throws(() => fixture.voice.stop("generated-preparing"), /still initializing/);
    abort.abort(); await assert.rejects(capture, { name: "AbortError" });
  } finally { await fixture.close(); }
});
test("unconfirmed microphone output cannot become a successful transcript", async () => {
  const fixture = await recognizer(["--unconfirmed-output"]);
  try {
    await assert.rejects(fixture.capture("generated-unconfirmed"), /microphone readiness/);
  } finally { await fixture.close(); }
});
test("graceful stop drains a slow final transcript instead of applying the cancellation kill deadline", { timeout: 12_000 }, async () => {
  const fixture = await recognizer(["--finalize-delay", "3400"]);
  try {
    const capture = fixture.capture("generated-slow-finalize");
    await fixture.ready("generated-slow-finalize");
    fixture.voice.stop("generated-slow-finalize");
    assert.equal((await capture).text, "Generated local dictation.");
  } finally { await fixture.close(); }
});
test("slow native finalization is not killed after three seconds or interrupted by another stop", { timeout: 10_000 }, async () => {
  const fixture = await recognizer(["--finalize-delay", "3300"]);
  try {
    const capture = fixture.capture("generated-slow-finalize");
    await fixture.ready("generated-slow-finalize");
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
    const capture = fixture.capture("generated-cancel-finalize", abort.signal);
    await fixture.ready("generated-cancel-finalize");
    fixture.voice.stop("generated-cancel-finalize");
    abort.abort();
    await assert.rejects(capture, /aborted/i);
    const pid = Number(await readFile(fixture.marker, "utf8"));
    assert.ok(Number.isSafeInteger(pid) && pid > 1, "readiness must follow a complete owned PID marker");
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  } finally { await fixture.close(); }
});
test("cancellation during finalization discards the transcript and stops the exact recognizer", async () => {
  const fixture = await recognizer(["--finalize-delay", "3400"]), abort = new AbortController();
  try {
    const capture = fixture.capture("generated-cancel-finalize", abort.signal);
    await fixture.ready("generated-cancel-finalize");
    fixture.voice.stop("generated-cancel-finalize"); abort.abort();
    await assert.rejects(capture, { name: "AbortError" });
    const pid = Number(await readFile(fixture.marker, "utf8"));
    assert.ok(Number.isSafeInteger(pid) && pid > 1, "readiness must follow a complete owned PID marker");
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  } finally { await fixture.close(); }
});
test("a recognizer exceeding the finalization deadline fails explicitly without returning partial text", async () => {
  const fixture = await recognizer(["--finalize-delay", "1000"], { finalizationTimeoutMs: 50 });
  try {
    const capture = fixture.capture("generated-finalization-deadline");
    await fixture.ready("generated-finalization-deadline");
    fixture.voice.stop("generated-finalization-deadline");
    await assert.rejects(capture, /finalization deadline/);
    const pid = Number(await readFile(fixture.marker, "utf8"));
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  } finally { await fixture.close(); }
});
test("failed recognition exposes its bounded runtime diagnostic rather than losing stderr", async () => {
  const fixture = await recognizer(["--fail-with-diagnostic"]);
  try {
    await assert.rejects(fixture.capture("generated-audio-error"), /Generated recognizer could not initialize the audio device/);
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
  const fixture = await recognizer(["--ignore-stop"], { finalizationTimeoutMs: 30_000 });
  try {
    const capture = fixture.capture("generated-finalize-deadline");
    await fixture.ready("generated-finalize-deadline");
    context.mock.timers.enable({ apis: ["setTimeout"] });
    fixture.voice.stop("generated-finalize-deadline");
    context.mock.timers.tick(30_000);
    context.mock.timers.reset();
    await assert.rejects(capture, /finalization deadline/);
    const pid = Number(await readFile(fixture.marker, "utf8"));
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  } finally { context.mock.timers.reset(); await fixture.close(); }
});
test("oversized recognizer output escalates to kill when TERM is ignored and never returns a transcript", { timeout: 10_000 }, async () => {
  const fixture = await recognizer(["--ignore-signals"]);
  try {
    await assert.rejects(fixture.capture("generated-output-limit"), /output limit/);
    const pid = Number(await readFile(fixture.marker, "utf8"));
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  } finally { await fixture.close(); }
});
