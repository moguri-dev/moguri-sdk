import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveSandboxNetwork, type SandboxDns } from "../apps/service/src/sandbox-network.ts";
import { sandboxProviderDestination } from "../apps/service/src/sandbox-policy.ts";
import type { SandboxConfiguration } from "../packages/protocol/src/index.ts";

const hash = "1".repeat(64);
const config: SandboxConfiguration = {
  executable: "/generated/sendbox", configPath: null, bundlePath: "/generated/bundle", trustRootPath: "/generated/public.key",
  image: `generated/worker@sha256:${hash}`, qualification: { release: "0.2.3", hostSha256: hash, keySha256: hash,
    manifestSha256: hash, workerDigest: hash, bridgeDigest: hash, trustRootId: "generated-root", minimumReleaseSequence: 7,
    allowedDomains: ["github.com", "api.github.com"], allowCopilot: true, resources: { cpus: 2, memoryMb: 4096, diskMb: 8192 } },
};
const signal = () => AbortSignal.timeout(5000);
const dns: SandboxDns = {
  addresses: async () => ["1.1.1.1"],
  aliases: async (host) => host === "api.individual.githubcopilot.com" ? ["api.githubcopilot.com"] :
    host === "api.githubcopilot.com" ? ["generated-edge.github.com"] : [],
};

test("actual prepared provider hosts and complete DNS aliases enter only the captured execution scope", async () => {
  const before = structuredClone(config);
  const resolved = await resolveSandboxNetwork(config, ["https://api.individual.githubcopilot.com"], signal(), dns);
  assert.deepEqual(resolved.configuration.qualification.allowedDomains,
    ["api.github.com", "api.githubcopilot.com", "api.individual.githubcopilot.com", "generated-edge.github.com", "github.com"]);
  assert.equal(sandboxProviderDestination(resolved.configuration, "https://api.individual.githubcopilot.com").hostname, "api.individual.githubcopilot.com");
  assert.throws(() => sandboxProviderDestination(resolved.configuration, "https://google.com"), /outside the approved/);
  assert.deepEqual(config, before, "DNS discovery must not silently rewrite saved or historical configuration.");
});

test("configured hosted providers use their own actual HTTPS origin without a Copilot substitution", async () => {
  const resolved = await resolveSandboxNetwork(config, ["https://api.generated-provider.test/v1"], signal(), { ...dns, aliases: async () => [] });
  assert.deepEqual(resolved.scope.providerHosts, ["api.generated-provider.test"]);
  assert.deepEqual(resolved.scope.providerUrls, ["https://api.generated-provider.test"]);
  assert.equal(resolved.configuration.qualification.allowedDomains.includes("api.githubcopilot.com"), false);
});

test("credentials, controller loopback and private or metadata addresses are rejected before provider access", async () => {
  for (const url of ["http://127.0.0.1:1234", "https://user:generated-secret@api.test", "https://api.test?key=generated-secret", "https://127.0.0.1"]) {
    await assert.rejects(() => resolveSandboxNetwork(config, [url], signal(), dns), /public HTTPS|credentials/);
  }
  for (const address of ["127.0.0.1", "10.1.2.3", "169.254.169.254", "192.168.1.2", "100.64.0.1", "::1", "fd00::1", "fe90::1", "::ffff:127.0.0.1"]) {
    await assert.rejects(() => resolveSandboxNetwork(config, ["https://api.test"], signal(), { ...dns, addresses: async () => [address] }), /private|reserved/);
  }
});

test("alias cycles, private alias destinations and excessive chains never widen policy", async () => {
  await assert.rejects(() => resolveSandboxNetwork(config, ["https://api.test"], signal(), { ...dns, aliases: async () => ["api.test"] }), /cycle/);
  await assert.rejects(() => resolveSandboxNetwork(config, ["https://api.test"], signal(), { ...dns, aliases: async () => ["127.0.0.1"] }), /DNS hostname/);
  await assert.rejects(() => resolveSandboxNetwork(config, ["https://api.test"], signal(), { ...dns, aliases: async (host) => [`next.${host}`] }), /chain/);
});

test("provider disable, cancellation and failed DNS do not produce an empty success-shaped scope", async () => {
  const denied = { ...config, qualification: { ...config.qualification!, allowCopilot: false } };
  await assert.rejects(() => resolveSandboxNetwork(denied, ["https://api.test"], signal(), dns), /provider access/);
  await assert.rejects(() => resolveSandboxNetwork(config, ["https://api.test"], AbortSignal.abort(), dns), /abort/i);
  await assert.rejects(() => resolveSandboxNetwork(config, ["https://api.test"], signal(), { ...dns, aliases: async () => { throw new Error("Generated DNS unavailable."); } }), /Generated DNS unavailable/);
});
