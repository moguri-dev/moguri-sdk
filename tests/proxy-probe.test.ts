import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type Socket } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import { probeSocksDomain } from "../apps/service/src/proxy-probe.ts";

async function proxyFixture(reply: Buffer, fragment = false, hold = false) {
  const sockets = new Set<Socket>(), requests: Buffer[] = [];
  let failure: unknown;
  const server = createServer((socket) => {
    sockets.add(socket); socket.on("close", () => sockets.delete(socket)); socket.on("error", () => {});
    let buffer: Buffer = Buffer.alloc(0), negotiated = false;
    socket.on("data", (part: Buffer) => {
      buffer = Buffer.concat([buffer, part]);
      if (!negotiated && buffer.length >= 3) {
        assert.deepEqual(buffer.subarray(0, 3), Buffer.from([5, 1, 0])); buffer = buffer.subarray(3); negotiated = true;
        socket.write(Buffer.from([5])); setImmediate(() => socket.write(Buffer.from([0])));
      }
      if (negotiated && buffer.length >= 5 && buffer.length >= 7 + buffer[4]!) {
        requests.push(buffer);
        if (hold) return;
        const send = async () => {
          if (fragment) for (const byte of reply) { socket.write(Buffer.from([byte])); await sleep(1); }
          else socket.write(reply);
          socket.end();
        };
        void send().catch((error) => { failure = error; socket.destroy(); });
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Generated proxy did not bind.");
  return { url: `socks5h://127.0.0.1:${address.port}`, requests,
    close: async () => { for (const socket of sockets) socket.destroy(); await new Promise<void>((resolve) => server.close(() => resolve())); if (failure) throw failure; } };
}

test("SOCKS diagnostics frame split replies and preserve per-request gateway failure classes", async () => {
  for (const [code, classification] of [[0, "connected"], [2, "policy-denied"], [4, "resolution-failed"], [5, "connect-failed"], [8, "other"]] as const) {
    const fixture = await proxyFixture(Buffer.from([5, code, 0, 1, 0, 0, 0, 0, 0, 0]), true);
    try {
      assert.deepEqual(await probeSocksDomain(fixture.url, "api.githubcopilot.com", 443, AbortSignal.timeout(2000)), { reply: code, classification });
      const request = fixture.requests[0]!;
      assert.deepEqual(request.subarray(0, 4), Buffer.from([5, 1, 0, 3]));
      assert.equal(request.subarray(5, -2).toString("ascii"), "api.githubcopilot.com"); assert.equal(request.readUInt16BE(request.length - 2), 443);
    } finally { await fixture.close(); }
  }
});

test("SOCKS diagnostics consume complete IPv6 and domain reply addresses rather than one TCP chunk", async () => {
  for (const reply of [Buffer.concat([Buffer.from([5, 0, 0, 4]), Buffer.alloc(18)]), Buffer.from([5, 0, 0, 3, 3, 103, 101, 110, 0, 0])]) {
    const fixture = await proxyFixture(reply);
    try { assert.equal((await probeSocksDomain(fixture.url, "api.githubcopilot.com", 443, AbortSignal.timeout(2000))).classification, "connected"); }
    finally { await fixture.close(); }
  }
});

test("truncated and malformed SOCKS replies remain explicit diagnostic failures", async () => {
  for (const reply of [Buffer.from([5, 0, 0]), Buffer.from([4, 0, 0, 1, 0, 0, 0, 0, 0, 0]), Buffer.from([5, 0, 0, 9])]) {
    const fixture = await proxyFixture(reply);
    try { await assert.rejects(() => probeSocksDomain(fixture.url, "api.githubcopilot.com", 443, AbortSignal.timeout(2000)), /closed|Malformed|Unsupported/); }
    finally { await fixture.close(); }
  }
});

test("owned SOCKS diagnostic cancellation closes a pending transport without assuming network success", async () => {
  const fixture = await proxyFixture(Buffer.alloc(0), false, true), abort = new AbortController();
  try {
    const pending = probeSocksDomain(fixture.url, "api.githubcopilot.com", 443, abort.signal);
    const stopped = assert.rejects(pending, /cancelled|abort/i);
    await sleep(20); abort.abort(); await stopped;
  } finally { await fixture.close(); }
});

test("SOCKS diagnostics cannot silently expand to literal IPs, wildcard targets or an unrelated proxy host", async () => {
  for (const [proxy, target] of [["socks5h://127.0.0.1:1080", "140.82.112.21"], ["socks5h://127.0.0.1:1080", "*.github.com"], ["socks5h://generated.invalid:1080", "api.githubcopilot.com"]]) {
    await assert.rejects(() => probeSocksDomain(proxy!, target!, 443, AbortSignal.timeout(2000)), /exact DNS|loopback/);
  }
});
