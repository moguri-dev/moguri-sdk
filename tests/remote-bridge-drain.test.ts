import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, realpath, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { JsonLineChannel } from "../apps/service/src/worker-wire.ts";
import { BridgeEnvelopeSchema } from "../apps/service/src/remote-protocol.ts";
import { parse, PROTOCOL_VERSION } from "../packages/protocol/src/index.ts";
import { ciTime } from "./fixtures/time-scale.ts";

test("persistent bridge drains the real terminal cursor before closing, with no late journal writes", { timeout: ciTime(15_000) }, async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "moguri-remote-drain-"))), runId = randomUUID();
  const workerDigest = createHash("sha256").update(await readFile(resolve("apps/service/src/worker.ts"))).digest("hex");
  const child = spawn(process.execPath, ["--import", "tsx", resolve("apps/service/src/remote-bridge.ts")], { stdio: ["pipe", "pipe", "pipe"], env: { PATH: process.env.PATH, HOME: process.env.HOME } });
  const wire = new JsonLineChannel(child.stdout, child.stdin);
  let exited = false, failure: unknown, queue = Promise.resolve(), terminalSequence = 0, held = false, release: (() => void) | undefined;
  const delayed = new Promise<void>((resolve) => { release = resolve; });
  const done = new Promise<number | null>((resolve) => child.once("exit", (code) => { exited = true; resolve(code); }));
  wire.on("error", (error) => { failure = error; });
  child.stderr.resume();
  wire.on("message", (raw) => {
    queue = queue.then(async () => {
      const message = parse(BridgeEnvelopeSchema, raw);
      if (message.kind === "ready") wire.send({ kind: "parent", message: { kind: "start", root: null, context: [], readOnly: false } });
      else if (message.kind === "error") throw new Error(message.message);
      else if (message.kind === "frame") {
        const request = message.request;
        if (request.kind === "boundary") wire.send({ kind: "parent", message: { kind: "reply", requestId: request.requestId, error: "Generated no-provider drain fixture." } });
        else if (request.kind === "finished") {
          terminalSequence = message.sequence; held = true;
          wire.send({ kind: "parent", message: { kind: "reply", requestId: request.requestId, value: { accepted: true } } });
          release?.(); return;
        }
        wire.send({ kind: "ack", sequence: message.sequence });
      }
    }).catch((error) => { failure = error; child.kill("SIGTERM"); });
  });
  wire.send({ action: "start", protocol: PROTOCOL_VERSION, workerDigest, stateDir: join(directory, "runs"), root: null, runId, key: "9".repeat(64), after: 0 });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([delayed, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("Generated terminal frame did not arrive.")), 8000); })]);
    clearTimeout(timer); await new Promise((resolve) => setTimeout(resolve, 120));
    if (failure) throw failure;
    assert.equal(held, true); assert.equal(exited, false, "The bridge must not guess that 30ms is enough for durable acknowledgement.");
    wire.send({ kind: "ack", sequence: terminalSequence });
    const code = await Promise.race([done, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("Acknowledged persistent bridge did not close.")), 5000); })]);
    await queue; if (failure) throw failure;
    assert.equal(code, 0);
    const path = join(directory, "runs", runId), saved = JSON.parse(await readFile(join(path, "status.json"), "utf8"));
    assert.equal(saved.status.acknowledged, terminalSequence); assert.equal(saved.status.cleanup, "owned-worker-stopped");
    assert.equal((await readdir(path)).some((name) => /^\d{12}\.bin$/.test(name) || name.endsWith(".tmp")), false);
  } finally { clearTimeout(timer); if (!exited) { child.kill("SIGTERM"); await done; } wire.end(); await rm(directory, { recursive: true, force: true }); }
});
