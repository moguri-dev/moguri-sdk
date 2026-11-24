import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { readFile, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { PassThrough } from "node:stream";
import * as pty from "node-pty";
import { BridgeEnvelopeSchema, type BridgeStatus } from "../apps/service/src/remote-protocol.ts";
import { JsonLineChannel } from "../apps/service/src/worker-wire.ts";
import { tools } from "../apps/service/src/tools.ts";
import { foregroundEnvironment } from "../apps/service/src/foreground-bridge.ts";
import { defaultProjectSettings, parse, PROTOCOL_VERSION } from "../packages/protocol/src/index.ts";
import { setupFixture } from "./fixture.ts";
import { inspectExecutionJournal } from "../apps/service/src/execution-journal.ts";
import { PrivateControl } from "../apps/service/src/private-control.ts";
import { ciTime } from "./fixtures/time-scale.ts";

test("foreground worker environment preserves enforced proxy variables without inheriting arbitrary secrets or NODE_OPTIONS", () => {
  const before = { proxy: process.env.HTTP_PROXY, flag: process.env.NODE_USE_ENV_PROXY, secret: process.env.MOGURI_GENERATED_SECRET, node: process.env.NODE_OPTIONS };
  try {
    process.env.HTTP_PROXY = "http://127.0.0.1:15083"; process.env.NODE_USE_ENV_PROXY = "1"; process.env.MOGURI_GENERATED_SECRET = "generated-private"; process.env.NODE_OPTIONS = "--generated-forbidden";
    const env = foregroundEnvironment("generated-owned-run");
    assert.equal(env.HTTP_PROXY, "http://127.0.0.1:15083"); assert.equal(env.NODE_USE_ENV_PROXY, "1");
    assert.equal(env.MOGURI_GENERATED_SECRET, undefined); assert.equal(env.NODE_OPTIONS, undefined); assert.equal(env.MOGURI_TURN_ID, "generated-owned-run");
  } finally {
    for (const [key, value] of Object.entries({ HTTP_PROXY: before.proxy, NODE_USE_ENV_PROXY: before.flag, MOGURI_GENERATED_SECRET: before.secret, NODE_OPTIONS: before.node })) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
for (const journaled of [false, true]) for (const acknowledged of [true, false]) test(`foreground TTY uses real worker IPC and root writes; terminal acknowledgement ${acknowledged ? "confirms completion" : "cannot be invented"}${journaled ? " with authenticated durable frames" : ""}`, { skip: process.platform !== "darwin", timeout: ciTime(20_000) }, async (t) => {
  const fixture = await setupFixture({ exposeModels: true }), input = new PassThrough(), output = new PassThrough(), wire = new JsonLineChannel(input, output, true);
  t.after(() => fixture.close());
  const root = await realpath(fixture.project);
  const workerDigest = createHash("sha256").update(await readFile(resolve("apps/service/src/worker.ts"))).digest("hex"), runId = randomUUID();
  const terminal = pty.spawn(process.execPath, ["--import", "tsx", resolve("apps/service/src/remote-bridge.ts"), "--foreground"], { cwd: process.cwd(), env: { PATH: process.env.PATH, HOME: process.env.HOME, TERM: "xterm-256color" }, cols: 100, rows: 30 });
  let ended = false, failure: unknown, queue = Promise.resolve(), calls = 0, queries = 0, final: BridgeStatus | undefined;
  let control: PrivateControl | undefined;
  const send = (value: unknown) => wire.send(control ? control.encode(value) : value);
  const held = createServer(() => send({ kind: "query-cancel", requestId: "generated-cancelled-catalog" }));
  await new Promise<void>((resolve) => held.listen(0, "127.0.0.1", resolve));
  t.after(async () => { held.closeAllConnections(); await new Promise<void>((resolve) => held.close(() => resolve())); });
  const address = held.address();
  if (!address || typeof address === "string") throw new Error("Generated held catalog failed to bind.");
  const queryDone = () => {
    queries++;
    if (queries === 4) send({ kind: "parent", message: { kind: "start", root, readOnly: false, context: [{ role: "user", content: "generated write", timestamp: Date.now() }] } });
  };
  const done = new Promise<{ exitCode: number; signal?: number }>((resolve) => terminal.onExit((value) => { ended = true; resolve(value); }));
  terminal.onData((data) => input.write(data)); output.on("data", (data: Buffer) => terminal.write(data));
  wire.on("error", (error) => { failure = error; });
  wire.on("message", (raw) => {
    queue = queue.then(async () => {
      const message = parse(BridgeEnvelopeSchema, control ? control.decode(raw) : raw);
      if (message.kind === "bootstrap") {
        if (journaled) control = new PrivateControl(runId, Buffer.from("7".repeat(64), "hex"), "controller");
        wire.send({ action: "start", protocol: PROTOCOL_VERSION, workerDigest,
          stateDir: journaled ? join(root, ".moguri", "execution", runId) : "/generated-unused-native-state", root, runId, key: "7".repeat(64), ...(journaled ? { journal: true, sealed: true } : {}) });
      }
      else if (message.kind === "ready") {
        assert.equal(message.status.port, 0);
        send({ kind: "query", requestId: "generated-context", query: { type: "context", settings: { ...defaultProjectSettings(), instructions: "Generated guest-side instruction context." } } });
        send({ kind: "query", requestId: "generated-catalog", query: { type: "catalog", catalog: { url: `${fixture.baseUrl}/v1`, key: null } } });
        send({ kind: "query", requestId: "generated-forbidden-native-readiness", query: { type: "model.readiness.binding" } });
        send({ kind: "query", requestId: "generated-cancelled-catalog", query: { type: "catalog", catalog: { url: `http://127.0.0.1:${address.port}/v1`, key: null } } });
      } else if (message.kind === "query-result") {
        assert.equal(message.runId, runId);
        if (message.result.type === "context") assert.match(message.result.text, /Generated guest-side instruction context/);
        else {
          assert.equal(message.result.type, "catalog");
          if (message.result.type !== "catalog") throw new Error("The generated catalog read returned an unrelated result.");
          assert.equal(message.result.status, 200); assert.equal(JSON.parse(Buffer.from(message.result.body, "base64").toString()).data[0].id, fixture.modelId);
        }
        queryDone();
      } else if (message.kind === "query-error") {
        assert.equal(message.runId, runId);
        if (message.requestId === "generated-forbidden-native-readiness") {
          assert.equal(message.code, "model_readiness_provenance"); assert.match(message.message, /original active sealed native|cannot claim/i);
        } else if (message.requestId === "generated-cancelled-catalog") assert.match(message.message, /cancelled|no fallback/i);
        else throw new Error(message.message);
        queryDone();
      }
      else if (message.kind === "status") final = message.status;
      else if (message.kind === "error") throw new Error(message.message);
      else if (message.kind === "frame") {
        const request = message.request, reply = (value: unknown) => send({ kind: "parent", message: { kind: "reply", requestId: "requestId" in request ? request.requestId : "", value } });
        if (request.kind === "boundary") reply({ ...await fixture.provider.prepare(fixture.modelId, AbortSignal.timeout(5000)), steers: [], systemPrompt: "Generated foreground fixture only.", tools: tools.filter((tool) => tool.name === "read_file" || tool.name === "write_file"), mode: "agent", folders: { denied: [], readOnly: [] }, maxTokens: 512 });
        else if (request.kind === "model.complete") { calls++; reply({ accepted: true }); }
        else if (request.kind === "approval") { assert.ok(["read_file", "write_file"].includes(request.call.name)); reply({ allow: true, mode: "agent", folders: { denied: [], readOnly: [] } }); }
        else if (request.kind === "tool.complete" || request.kind === "finished") { reply({ accepted: request.kind === "finished" ? acknowledged : true }); if (request.kind === "tool.complete") assert.equal(request.isError, false); else assert.equal(request.outcome, "completed"); }
        send({ kind: "ack", sequence: message.sequence });
      }
    }).catch((error) => { failure = error; send({ kind: "parent", message: { kind: "stop" } }); });
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const exit = await Promise.race([done, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("Foreground owned worker timed out.")), 15_000); })]);
    await queue; if (failure) throw failure;
    assert.equal(exit.exitCode, acknowledged ? 0 : 2); assert.equal(calls, 3); assert.equal(queries, 4); assert.equal(final?.status, acknowledged ? "completed" : "partial"); assert.equal(final?.cleanup, "owned-worker-stopped");
    assert.equal(await readFile(`${fixture.project}/fixture.txt`, "utf8"), "generated replacement\n");
    if (journaled) {
      const retained = await inspectExecutionJournal(join(root, ".moguri", "execution", runId), Buffer.from("7".repeat(64), "hex"), final!.acknowledged);
      assert.equal(retained.status.status, final!.status);
      assert.equal(retained.status.cleanup, "owned-worker-stopped");
      assert.equal(retained.info.workerDigest, workerDigest);
    }
  } finally {
    clearTimeout(timer);
    if (!ended) { process.kill(terminal.pid, "SIGTERM"); await done; }
    input.end(); wire.end(); await fixture.close();
  }
});
