import { ciTime } from "./fixtures/time-scale.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { performance } from "node:perf_hooks";
import { createConnection } from "node:net";
import { terminalPrototype, connectTerminalPrototype } from "./fixtures/terminal-broker-prototype.ts";

const native = { skip: process.platform !== "darwin", timeout: ciTime(20_000) };
test("an actual controller SIGKILL preserves the same authenticated PTY and volatile output without relaunching or replaying input", native, async () => {
  const started = performance.now(), fixture = await terminalPrototype();
  const first = fixture.client;
  let second: typeof first | undefined;
  try {
    await first.input("GENERATED_BEFORE\n");
    for (let index = 0; index < 100 && !(await first.read()).data.includes("GENERATED_BEFORE"); index++) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.match((await first.read()).data, /GENERATED_BEFORE/);
    fixture.parent.kill("SIGKILL"); await fixture.parentExit; first.disconnect();
    second = await connectTerminalPrototype(fixture.connection);
    const info = await second.info();
    assert.equal(info.pid, fixture.info.pid); assert.equal(info.brokerPid, fixture.info.brokerPid);
    assert.equal(info.status, "running");
    await second.input("GENERATED_AFTER\n");
    for (let index = 0; index < 100 && !(await second.read()).data.includes("GENERATED_AFTER"); index++) await new Promise((resolve) => setTimeout(resolve, 10));
    const output = (await second.read()).data;
    assert.match(output, /GENERATED_BEFORE/); assert.match(output, /GENERATED_AFTER/);
    assert.equal(output.split("GENERATED_AFTER").length - 1, 1);
    assert.equal((await readFile(fixture.launches, "utf8")).trim(), "generated-start");
    console.log(JSON.stringify({ primitive: "owned-pty-controller-restart", brokerPid: info.brokerPid, ptyPid: info.pid, launches: 1, durationMs: performance.now() - started, containment: false }));
  } finally { first.disconnect(); second?.disconnect(); await fixture.close(); }
});

test("private endpoint authentication rejects wrong keys/scope without exposing terminal bytes or persisting its secret", native, async () => {
  const fixture = await terminalPrototype();
  try {
    await assert.rejects(() => connectTerminalPrototype({ ...fixture.connection, key: randomBytes(32).toString("base64") }), /auth|closed|proof/i);
    await assert.rejects(() => connectTerminalPrototype({ ...fixture.connection, scopeDigest: "f".repeat(64) }), /scope|auth|closed/i);
    assert.equal((await stat(fixture.runtime)).mode & 0o077, 0);
    assert.equal((await stat(fixture.connection.socket)).mode & 0o077, 0);
    assert.deepEqual(await readdir(fixture.runtime), ["control.sock"]);
    const client = await connectTerminalPrototype(fixture.connection);
    try { assert.equal((await client.info()).status, "running"); } finally { client.disconnect(); }
  } finally { await fixture.close(); }
});

test("an oversized unauthenticated private control frame is rejected without stopping the real PTY", native, async () => {
  const fixture = await terminalPrototype();
  try {
    const socket = createConnection(fixture.connection.socket), started = performance.now();
    let received = "";
    socket.on("data", (data: Buffer) => { received += data.toString("utf8"); });
    let socketError: NodeJS.ErrnoException | undefined;
    socket.on("error", (error) => { socketError = error; });
    const closed = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { socket.destroy(); reject(new Error("Oversized private frame was not closed.")); }, 2500);
      socket.once("close", () => { clearTimeout(timer); resolve(); });
    });
    socket.once("connect", () => socket.write(Buffer.alloc(512 * 1024 + 1, 0x61)));
    await closed;
    assert.ok(performance.now() - started < 1500, "Frame rejection must precede the separate two-second unauthenticated idle timeout.");
    assert.equal(received.includes("GENERATED_READY"), false);
    if (socketError) assert.ok(["EPIPE", "ECONNRESET"].includes(socketError.code ?? ""), "Only the expected rejected-frame transport error is accepted.");
    assert.equal((await fixture.client.info()).status, "running");
  } finally { await fixture.close(); }
});

test("an actual lost input acknowledgement remains unconfirmed and reconnect never resends the accepted bytes", native, async () => {
  const fixture = await terminalPrototype({ holdInputAck: true });
  let recovered: Awaited<ReturnType<typeof connectTerminalPrototype>> | undefined;
  try {
    const pending = fixture.client.input("GENERATED_UNACKNOWLEDGED\n").then(() => ({ status: "acknowledged" as const }), (error: unknown) => ({ status: "unconfirmed" as const, error }));
    for (let index = 0; index < 100 && !fixture.inputHeld; index++) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(fixture.inputHeld, true);
    fixture.parent.kill("SIGKILL");
    const result = await pending; assert.equal(result.status, "unconfirmed");
    if (result.status === "unconfirmed") assert.match(result.error instanceof Error ? result.error.message : "", /closed|unconfirmed/i);
    await fixture.parentExit;
    recovered = await connectTerminalPrototype(fixture.connection);
    let output = await recovered.read();
    for (let index = 0; index < 100 && !output.data.includes("GENERATED_UNACKNOWLEDGED"); index++) { await new Promise((resolve) => setTimeout(resolve, 10)); output = await recovered.read(); }
    assert.equal(output.data.split("GENERATED_UNACKNOWLEDGED").length - 1, 1);
    assert.equal((await readFile(fixture.launches, "utf8")).trim(), "generated-start");
  } finally { recovered?.disconnect(); await fixture.close(); }
});

test("reattached output keeps an explicit bounded UTF-8-safe gap rather than a durable transcript", native, async () => {
  const fixture = await terminalPrototype(), client = await connectTerminalPrototype(fixture.connection);
  try {
    await client.input("GENERATED_BIG\n");
    const snapshot = async () => {
      const page = await client.read(), tail = await client.read(page.nextOffset);
      if (tail.baseOffset !== page.baseOffset) return null;
      return { ...page, data: page.data + tail.data, nextOffset: tail.nextOffset };
    };
    let output = await snapshot();
    for (let index = 0; index < 100 && (!output?.baseOffset || !output.data.includes("GENERATED_BIG_END")); index++) {
      await new Promise((resolve) => setTimeout(resolve, 10)); output = await snapshot();
    }
    assert.ok(output, "The retained window must stabilize within the bounded observation.");
    assert.ok(output.baseOffset > 0); assert.ok(Buffer.byteLength(output.data) <= 128 * 1024);
    assert.ok(Buffer.byteLength(output.data) >= 128 * 1024 - 3, "Read the complete UTF-8-safe window, not merely its last page.");
    assert.equal(output.data.includes("\ufffd"), false); assert.ok(output.data.includes("GENERATED_BIG_END"), "The complete retained window must include the observed end marker.");
    assert.ok(output.nextOffset > output.baseOffset);

    const previous = await client.read();
    await client.input("GENERATED_BIG\n");
    let following = await client.read(previous.nextOffset);
    for (let index = 0; index < 100 && following.baseOffset <= previous.nextOffset; index++) {
      await new Promise((resolve) => setTimeout(resolve, 10)); following = await client.read(previous.nextOffset);
    }
    assert.ok(following.baseOffset > previous.nextOffset, "New output must expose the gap behind the previous page's cursor.");
    assert.ok(Buffer.byteLength(previous.data) <= 128 * 1024);
    assert.ok(Buffer.byteLength(following.data) <= 128 * 1024);
    assert.ok(Buffer.byteLength(previous.data + following.data) > 128 * 1024, "Pages from different live windows are not one bounded retained snapshot.");
    assert.equal(following.data.includes("\ufffd"), false);
    assert.deepEqual(await readdir(fixture.runtime), ["control.sock"]);
  } finally { client.disconnect(); await fixture.close(); }
});

test("real resize and exact owned stop are acknowledged without claiming arbitrary descendant containment", native, async () => {
  const fixture = await terminalPrototype(), client = await connectTerminalPrototype(fixture.connection);
  try {
    await client.resize(111, 37);
    let output = await client.read();
    for (let index = 0; index < 100 && !output.data.includes("GENERATED_SIZE=111x37"); index++) { await new Promise((resolve) => setTimeout(resolve, 10)); output = await client.read(); }
    assert.match(output.data, /GENERATED_SIZE=111x37/);
    const info = await client.info(); assert.equal(info.cols, 111); assert.equal(info.rows, 37);
    const stopped = await client.stop(); assert.equal(stopped.status, "closed"); assert.match(stopped.diagnostic ?? "", /not proven|not.*contained/i);
  } finally { client.disconnect(); await fixture.close(); }
});

test("broker loss is an explicit failed control outcome, never another shell or success-shaped replay", native, async () => {
  const fixture = await terminalPrototype(), client = await connectTerminalPrototype(fixture.connection);
  try {
    process.kill(fixture.info.brokerPid, "SIGKILL");
    await assert.rejects(() => client.info(), /closed|channel|connection|unconfirmed/i);
    await assert.rejects(() => connectTerminalPrototype(fixture.connection), /connect|ENOENT|ECONNREFUSED|closed/i);
    assert.equal((await readFile(fixture.launches, "utf8")).trim(), "generated-start");
  } finally { client.disconnect(); await fixture.close(); }
});
