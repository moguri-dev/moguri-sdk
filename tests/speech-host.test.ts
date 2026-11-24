import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { isRecord, MoguriSdk } from "../packages/sdk/src/index.ts";
import { startService } from "../apps/service/src/server.ts";
import { NEMOTRON_MODEL } from "../apps/service/src/voice.ts";
import { fixtureProvider, waitFor } from "./fixture.ts";
import { ciTime } from "./fixtures/time-scale.ts";

test("the private speech host reaps only its exact child when its controller pipe closes", { timeout: ciTime(10_000) }, async () => {
  const host = spawn(process.execPath, [resolve("apps/service/src/speech-host.ts"), process.execPath, "-e",
    "console.log(process.pid); setInterval(()=>{},1000)"], { stdio: ["pipe", "pipe", "pipe"] });
  let output = "", pid: number | undefined;
  const exited = new Promise<number | null>((done) => host.once("close", done));
  host.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); });
  try {
    const deadline = Date.now() + ciTime(3000);
    while (!output.includes("\n") && host.exitCode === null && Date.now() < deadline) await new Promise((done) => setTimeout(done, 10));
    assert.match(output.trim(), /^\d+$/, "The owned host must launch its exact generated child.");
    pid = Number(output.trim()); host.stdin.end();
    assert.equal(await exited, 0);
    assert.throws(() => process.kill(pid!, 0), { code: "ESRCH" });
    pid = undefined;
  } finally {
    if (host.exitCode === null) host.kill("SIGTERM");
    if (pid) { try { process.kill(pid, "SIGKILL"); } catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error; } }
    await exited;
  }
});

test("the private speech host preserves an unexpected recognizer signal in its failure diagnostic", { timeout: ciTime(5000) }, async () => {
  const host = spawn(process.execPath, [resolve("apps/service/src/speech-host.ts"), process.execPath, "-e", "process.kill(process.pid,'SIGTERM')"],
    { stdio: ["pipe", "ignore", "pipe"] });
  let diagnostic = "";
  host.stderr.on("data", (chunk: Buffer) => { diagnostic += chunk.toString(); });
  const exited = new Promise<number | null>((done) => host.once("close", done));
  try { assert.equal(await exited, 1); assert.match(diagnostic, /recognizer.*SIGTERM/); }
  finally { if (host.exitCode === null && host.signalCode === null) host.kill("SIGTERM"); await exited; }
});

test("an actual control-plane SIGKILL reaps its generated realtime recognizer and restart never reopens audio or replays PCM", { timeout: ciTime(20_000) }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "moguri-generated-speech-crash-")), stateDir = join(directory, "state"), marker = join(directory, "recognizer.pid");
  const weights = Buffer.from("Generated crash-only recognizer weights."), key = Buffer.alloc(32, 0x67);
  const model = { ...NEMOTRON_MODEL, filename: "generated-crash.gguf", bytes: weights.length, sha256: createHash("sha256").update(weights).digest("hex") };
  const executable = resolve("tests/fixtures/fake-speech.mjs");
  const source = `
    import { startService } from "./apps/service/src/server.ts";
    import { MoguriSdk } from "./packages/sdk/src/index.ts";
    import { fixtureProvider } from "./tests/fixture.ts";
    const weights = Buffer.from("Generated crash-only recognizer weights.");
    const provider = await fixtureProvider();
    const service = await startService({ stateDir: ${JSON.stringify(stateDir)}, provider: provider.provider, retentionKey: Buffer.alloc(32, 0x67),
      platform: { speech: { executable: process.execPath, prefixArgs: [${JSON.stringify(executable)}, "--started-marker", ${JSON.stringify(marker)}],
        model: ${JSON.stringify(model)}, fetch: async () => new Response(weights) } } });
    const sdk = await new MoguriSdk(service.connection).ready();
    const session = await sdk.sessions.create(null, "Generated owned crash capture");
    await sdk.jobs.wait((await sdk.voice.download(true)).id);
    const capture = await sdk.voice.startCapture(session.id, undefined, { streaming: true });
    await sdk.voice.appendCapture(session.id, capture.id, capture.token, 1, new Uint8Array(6400));
    for (let attempt = 0; attempt < 300; attempt++) {
      if ((await sdk.voice.readCapture(session.id, capture.id, capture.token)).text) {
        process.send({ sessionId: session.id, id: capture.id, token: capture.token }); break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  `;
  const control = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", source], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
  let ready: { sessionId: string; id: string; token: string } | undefined, stderr = "", nativePid: number | undefined;
  const exited = new Promise<void>((done) => control.once("close", () => done()));
  control.stderr?.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-8000); });
  control.on("message", (value: unknown) => {
    if (isRecord(value) && typeof value.sessionId === "string" && typeof value.id === "string" && typeof value.token === "string") {
      ready = { sessionId: value.sessionId, id: value.id, token: value.token };
    }
  });
  const alive = (pid: number) => {
    try { process.kill(pid, 0); return true; }
    catch (error) { if (error instanceof Error && "code" in error && error.code === "ESRCH") return false; throw error; }
  };
  const provider = await fixtureProvider();
  let restarted: Awaited<ReturnType<typeof startService>> | undefined, sdk: MoguriSdk | undefined;
  try {
    const capture = await waitFor(() => {
      if (control.exitCode !== null || control.signalCode !== null) throw new Error(`The generated control plane exited before capture: ${stderr}`);
      return ready;
    }, 10_000);
    const originalMarker = await readFile(marker, "utf8"); nativePid = Number(originalMarker);
    assert.ok(Number.isSafeInteger(nativePid) && nativePid > 1 && alive(nativePid));
    control.kill("SIGKILL"); await exited;
    await waitFor(() => !alive(nativePid!), 5000);
    restarted = await startService({ stateDir, provider: provider.provider, retentionKey: key, platform: { speech: {
      executable: process.execPath, prefixArgs: [executable, "--started-marker", marker], model, fetch: async () => new Response(weights),
    } } });
    sdk = await new MoguriSdk(restarted.connection).ready();
    const jobs = restarted.controller.snapshot().jobs.filter((job) => job.kind === "voice.capture");
    assert.equal(jobs.length, 1); assert.equal(jobs[0]?.id, capture.id);
    assert.ok(jobs[0] && !["running", "waiting_input", "completed"].includes(jobs[0].status));
    assert.equal(jobs[0]?.resultDigest, null);
    await assert.rejects(() => sdk!.voice.appendCapture(capture.sessionId, capture.id, capture.token, 2, new Uint8Array(6400)), { message: jobs[0]!.error! });
    assert.equal(await readFile(marker, "utf8"), originalMarker);
    assert.equal(alive(nativePid), false);
    assert.equal(provider.requests.length, 0);
    assert.equal(restarted.controller.snapshot().budgetEntries.length, 0);
  } finally {
    if (control.exitCode === null && control.signalCode === null) control.kill("SIGTERM");
    await exited;
    if (nativePid && alive(nativePid)) process.kill(nativePid, "SIGKILL");
    sdk?.disconnect(); await restarted?.close(); await provider.close();
    await rm(directory, { recursive: true, force: true });
  }
});
