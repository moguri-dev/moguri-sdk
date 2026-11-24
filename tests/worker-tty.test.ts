import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PassThrough } from "node:stream";
import * as pty from "node-pty";
import { JsonLineChannel } from "../apps/service/src/worker-wire.ts";
import { BridgeEnvelopeSchema, type BridgeInfo } from "../apps/service/src/remote-protocol.ts";
import { parse, PROTOCOL_VERSION } from "../packages/protocol/src/index.ts";
import { ciTime } from "./fixtures/time-scale.ts";

test("the real Moguri frontend negotiates its private raw-PTY channel before accepting bounded control input", { skip: process.platform !== "darwin", timeout: ciTime(15_000) }, async () => {
  const input = new PassThrough(), output = new PassThrough(), channel = new JsonLineChannel(input, output, true);
  const workerDigest = createHash("sha256").update(await readFile(resolve("apps/service/src/worker.ts"))).digest("hex");
  const terminal = pty.spawn(process.execPath, ["--import", "tsx", resolve("apps/service/src/remote-bridge.ts")], { cwd: process.cwd(), env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: process.env.HOME, TERM: "xterm-256color" }, cols: 80, rows: 24 });
  let ended = false, info: BridgeInfo | undefined, failure: unknown, bootstraps = 0;
  const done = new Promise<{ exitCode: number; signal?: number }>((resolve) => terminal.onExit((value) => { ended = true; resolve(value); }));
  terminal.onData((data) => input.write(data)); output.on("data", (data: Buffer) => terminal.write(data));
  channel.on("error", (error) => { failure = error; });
  channel.on("message", (raw) => {
    try {
      const message = parse(BridgeEnvelopeSchema, raw);
      if (message.kind === "bootstrap") {
        bootstraps++;
        channel.send({ action: "probe", protocol: PROTOCOL_VERSION, workerDigest, stateDir: "/tmp/moguri-generated-unused-state", root: null });
      } else if (message.kind === "probe") info = message.info;
      else if (message.kind === "error") failure = new Error(message.message);
    } catch (error) { failure = error; }
  });
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    const exit = await Promise.race([done, new Promise<never>((_resolve, reject) => { deadline = setTimeout(() => reject(new Error("Owned Moguri TTY bootstrap timed out.")), 10_000); })]);
    if (failure) throw failure;
    assert.equal(exit.exitCode, 0); assert.equal(exit.signal ?? 0, 0); assert.equal(bootstraps, 1);
    assert.equal(info?.workerDigest, workerDigest); assert.equal(info?.platform, "darwin");
  } finally {
    clearTimeout(deadline);
    if (!ended) { try { process.kill(terminal.pid, "SIGTERM"); } catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error; } await done; }
    input.end(); channel.end();
  }
});
