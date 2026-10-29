import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { readFile, writeFile } from "node:fs/promises";
import { createConnection, isIP } from "node:net";
import { performance } from "node:perf_hooks";
import { probeSocksDomain } from "../../apps/service/src/proxy-probe.ts";
import { publicAddress } from "../../apps/service/src/public-network.ts";

const input = JSON.parse(await readFile("/workspace/generated-network-input.json", "utf8"));
const status = await readFile("/proc/self/status", "utf8"), payload = JSON.parse(await readFile("/opt/moguri/payload.json", "utf8"));
assert.ok(process.getuid() > 0);
assert.match(status, /^NoNewPrivs:\s*1$/m);
assert.match(status, /^Seccomp:\s*2$/m);
assert.match(status, /^CapEff:\s*0+$/m);
assert.equal(process.env.NODE_USE_ENV_PROXY, "1");
assert.ok(process.env.HTTPS_PROXY && process.env.ALL_PROXY);
for (const name of ["GITHUB_TOKEN", "GH_TOKEN", "COPILOT_GITHUB_TOKEN", "GITHUB_COPILOT_TOKEN", "SSH_AUTH_SOCK",
  "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"]) assert.equal(process.env[name], undefined);
assert.equal(payload.protocol, input.protocol);
assert.equal(process.versions.node, "26.12.0");
const started = performance.now(), proof = { uid: process.getuid(), node: process.versions.node, kernel: (await import("node:os")).release(),
  protocol: payload.protocol, enforcedProxy: true, credentials: false, modelCalls: 0, requests: [], providerAliases: [] };
await writeFile("/workspace/generated-network-started.json", JSON.stringify({ id: input.id, provider: input.provider }), { mode: 0o600 });
const get = async (url, accepted) => {
  const began = performance.now();
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(15_000),
    headers: { "User-Agent": "Moguri generated native qualification", Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" } });
  const observed = { url, status: response.status, ms: performance.now() - began };
  proof.requests.push(observed);
  assert.ok(accepted.includes(response.status), `Credential-free resource ${url} returned HTTP ${response.status}.`);
  return response;
};
try {
  // This is the first workload request: no guest DNS warm-up, alternate endpoint or retry.
  const cold = await get(`${input.provider}/models`, [400, 401, 403]);
  await cold.body?.cancel();
  proof.coldProviderMs = proof.requests[0].ms;
  for (const host of input.providerHosts) {
    const result = await probeSocksDomain(process.env.ALL_PROXY, host, 443, AbortSignal.timeout(12_000));
    proof.providerAliases.push({ host, ...result });
    assert.equal(result.classification, "connected", `Captured provider host ${host} was not admitted.`);
  }
  const meta = await get("https://api.github.com/meta", [200]), chunks = [];
  let bytes = 0;
  for await (const chunk of meta.body) {
    bytes += chunk.length; assert.ok(bytes <= 2 * 1024 * 1024, "Public Meta response exceeded the native bound."); chunks.push(chunk);
  }
  const metaBytes = Buffer.concat(chunks);
  await writeFile("/workspace/generated-github-meta.json", metaBytes, { mode: 0o600 });
  proof.metaSha256 = createHash("sha256").update(metaBytes).digest("hex");
  proof.delegatedDomain = { host: "raw.githubusercontent.com",
    ...await probeSocksDomain(process.env.ALL_PROXY, "raw.githubusercontent.com", 443, AbortSignal.timeout(12_000)) };
  assert.equal(proof.delegatedDomain.classification, "connected", "Published GitHub Meta domain was not effective.");
  proof.deniedDomain = { host: "example.com",
    ...await probeSocksDomain(process.env.ALL_PROXY, "example.com", 443, AbortSignal.timeout(12_000)) };
  assert.equal(proof.deniedDomain.classification, "policy-denied", "Unapproved control destination was not policy-denied.");
  const connect = (host) => new Promise((resolve, reject) => {
    assert.ok(isIP(host), "Only literal control IPs reach the generated CONNECT diagnostic.");
    const proxy = new URL(process.env.HTTPS_PROXY);
    assert.ok(["http:", "https:"].includes(proxy.protocol) && ["127.0.0.1", "localhost", "[::1]"].includes(proxy.hostname));
    const socket = createConnection({ host: proxy.hostname.replace(/^\[|\]$/g, ""), port: Number(proxy.port) });
    let response = "", settled = false;
    const finish = (error, value) => {
      if (settled) return; settled = true; socket.destroy();
      if (error) reject(error); else resolve(value);
    };
    socket.setTimeout(12_000, () => finish(new Error("Owned CONNECT diagnostic timed out.")));
    socket.on("error", (error) => finish(error));
    socket.on("end", () => finish(new Error("Owned CONNECT diagnostic ended before a complete status.")));
    const authority = isIP(host) === 6 ? `[${host}]:443` : `${host}:443`;
    socket.on("connect", () => socket.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`));
    socket.on("data", (chunk) => {
      response += chunk.toString("ascii");
      if (response.length > 4096) { finish(new Error("Owned CONNECT diagnostic exceeded its bound.")); return; }
      const match = /^HTTP\/1\.[01] (\d{3})[^\r\n]*\r\n/.exec(response);
      if (match) finish(null, { address: host, status: Number(match[1]) });
    });
  });
  const addresses = await lookup("api.github.com", { all: true });
  assert.ok(addresses.length && addresses.every((entry) => publicAddress(entry.address)));
  const target = addresses.find((entry) => entry.family === 4)?.address;
  assert.ok(target, "An actual public IPv4 GitHub API destination is required for the CIDR control.");
  proof.delegatedAddress = await connect(target);
  assert.equal(proof.delegatedAddress.status, 200, "The published Meta CIDR was not effective for a literal-IP CONNECT.");
  proof.deniedAddresses = [];
  for (const host of ["1.1.1.1", "127.0.0.1", "169.254.169.254"]) {
    const result = await connect(host); proof.deniedAddresses.push(result);
    assert.equal(result.status, 403, "Unapproved or restricted literal address was not policy-denied.");
  }
  proof.direct = await new Promise((resolve) => {
    const socket = createConnection({ host: target, port: 443 });
    const finish = (value) => { socket.destroy(); resolve(value); };
    socket.setTimeout(1000, () => finish({ address: target, connected: false, observation: "deadline-without-connect" }));
    socket.on("error", (error) => finish({ address: target, connected: false, observation: error.code }));
    socket.on("connect", () => finish({ address: target, connected: true, observation: "connected" }));
  });
  assert.equal(proof.direct.connected, false, "Direct socket bypass reached a proxy-only destination.");
  proof.status = "PASS";
} finally {
  proof.ms = performance.now() - started;
  await writeFile("/workspace/generated-network-proof.json", JSON.stringify(proof), { mode: 0o600 });
}
