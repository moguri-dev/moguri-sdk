import test from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { JsonLineChannel, MAX_WORKER_FRAME, TTY_FRAME_PREFIX } from "../apps/service/src/worker-wire.ts";

test("worker frames retain split UTF-8 and close both halves after peer EOF", async () => {
  const input = new PassThrough(), output = new PassThrough(), channel = new JsonLineChannel(input, output);
  const received: unknown[] = [], errors: Error[] = [];
  channel.on("message", (value) => received.push(value)); channel.on("error", (error) => errors.push(error));
  const data = Buffer.from(`${JSON.stringify({ generated: "\u{1f600}" })}\n`);
  const closed = new Promise<void>((resolve) => channel.once("close", resolve));
  for (const byte of data) input.write(Buffer.from([byte]));
  input.end(); await closed;
  assert.deepEqual(received, [{ generated: "\u{1f600}" }]); assert.equal(errors.length, 0);
  channel.end(); assert.equal(output.writableEnded, true);
});
test("frame limits apply to each exact UTF-8 frame, not a batch of valid frames", async () => {
  const input = new PassThrough(), output = new PassThrough(), channel = new JsonLineChannel(input, output);
  const received: unknown[] = [], errors: Error[] = [];
  channel.on("message", (value) => received.push(value)); channel.on("error", (error) => errors.push(error));
  const overhead = Buffer.byteLength(JSON.stringify({ generated: "" }) + "\n");
  const first = JSON.stringify({ generated: "x".repeat(MAX_WORKER_FRAME - overhead) }) + "\n";
  const closed = new Promise<void>((resolve) => channel.once("close", resolve));
  assert.equal(Buffer.byteLength(first), MAX_WORKER_FRAME);
  input.end(Buffer.from(first + '{"second":true}\n')); await closed;
  assert.equal(errors.length, 0); assert.equal(received.length, 2);
  channel.end();
});
test("oversized and incomplete invalid UTF-8 frames fail explicitly", async () => {
  for (const data of [Buffer.from('{"generated":"' + "x".repeat(MAX_WORKER_FRAME) + '"}\n'), Buffer.from([0xc3])]) {
    const input = new PassThrough(), output = new PassThrough(), channel = new JsonLineChannel(input, output);
    const failure = new Promise<Error>((resolve) => channel.once("error", resolve));
    input.end(data); assert.match((await failure).message, /exceeded|invalid UTF-8/);
    channel.end();
  }
});

test("truncated worker frames are explicit failures, not accepted empty replies", async () => {
  const input = new PassThrough(), output = new PassThrough(), channel = new JsonLineChannel(input, output);
  const failure = new Promise<Error>((resolve) => channel.once("error", resolve));
  input.end('{"generated":"incomplete');
  assert.match((await failure).message, /incomplete frame/);
  channel.end(); assert.equal(output.writableEnded, true);
});
test("TTY frames separate expected terminal diagnostics from canonical bounded control data", async () => {
  const input = new PassThrough(), output = new PassThrough(), channel = new JsonLineChannel(input, output, true);
  const messages: unknown[] = [], diagnostics: string[] = [], errors: Error[] = [];
  channel.on("message", (value) => messages.push(value)); channel.on("diagnostic", (text) => diagnostics.push(text)); channel.on("error", (error) => errors.push(error));
  const message = { kind: "generated", text: "Generated TTY \u{1f600} data." };
  const frame = `${TTY_FRAME_PREFIX}${Buffer.from(JSON.stringify(message)).toString("base64")}\r\n`;
  input.write("\u001b[32mGenerated native runtime startup\u001b[0m\r\n");
  for (let offset = 0; offset < frame.length; offset += 7) input.write(frame.slice(offset, offset + 7));
  const closed = new Promise<void>((resolve) => channel.once("close", resolve)); input.end(); await closed;
  assert.deepEqual(messages, [message]); assert.deepEqual(diagnostics, ["Generated native runtime startup"]); assert.equal(errors.length, 0);
  channel.end();
});
test("malformed TTY frames are not silently treated as startup diagnostics", async () => {
  const input = new PassThrough(), output = new PassThrough(), channel = new JsonLineChannel(input, output, true);
  const failure = new Promise<Error>((resolve) => channel.once("error", resolve));
  input.end(`${TTY_FRAME_PREFIX}not-canonical-base64\n`);
  assert.match((await failure).message, /canonical TTY/); channel.end();
});
