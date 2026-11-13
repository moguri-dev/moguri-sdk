import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultSettings, type SandboxConfiguration } from "../packages/sdk/src/index.ts";
import { sandboxConfiguration, sandboxProviderDestination, sandboxRunConfiguration } from "../apps/service/src/sandbox-policy.ts";
import { sandboxContainerInventory, sandboxImageIdentity } from "../apps/service/src/apple-container.ts";

const configured = (): SandboxConfiguration => ({
  ...defaultSettings().sandbox, executable: "/opt/generated/sendbox", image: `generated/image@sha256:${"a".repeat(64)}`,
  bundlePath: "/opt/generated/bundle", trustRootPath: "/opt/generated/release.key",
  qualification: { release: "0.2.3", hostSha256: "b".repeat(64), keySha256: "c".repeat(64), manifestSha256: "d".repeat(64),
    workerDigest: "e".repeat(64), bridgeDigest: "f".repeat(64), trustRootId: "generated-release", minimumReleaseSequence: 7,
    allowedDomains: ["api.generated.invalid", "alias.generated.invalid"], allowCopilot: true,
    resources: { cpus: 2, memoryMb: 2048, diskMb: 2048 } },
});
test("native admission requires exact reviewed release/image artifacts and never widens network or legacy policy", () => {
  assert.throws(() => sandboxConfiguration(defaultSettings().sandbox), /configure|review|qualification/i);
  const config = configured();
  assert.equal(sandboxConfiguration(config).qualification.release, "0.2.3");
  for (const domain of ["*", "*.*.generated.invalid", "api.*.generated.invalid", "*generated.invalid", "*.GENERATED.invalid", "*.generated.invalid.",
    "*.127.0.0.1", "*.localhost", "127.0.0.1", "api.generated.invalid:443", "api.generated.invalid/path"]) {
    assert.throws(() => sandboxConfiguration({ ...config, qualification: { ...config.qualification!, allowedDomains: [domain] } }), /exact|domain|host/i);
  }
  assert.throws(() => sandboxConfiguration({ ...config, configPath: "/tmp/unreviewed-legacy-policy.json" }), /legacy|managed|policy/i);
  assert.equal(sandboxProviderDestination(config, "https://api.generated.invalid/v1").hostname, "api.generated.invalid");
  for (const url of ["http://127.0.0.1:1234/v1", "https://unreviewed.invalid/v1", "https://user:password@api.generated.invalid/v1"]) assert.throws(() => sandboxProviderDestination(config, url), /approved|scope|HTTPS|credential/i);
  const run = sandboxRunConfiguration(config, "generated-owned", "/private/generated/stage", ["/usr/local/bin/node", "/opt/moguri/dist/remote-bridge.mjs", "--foreground"]);
  assert.equal(run.project_path, "/private/generated/stage");
  assert.equal(run.policy.network.default_action, "deny");
  assert.deepEqual(run.policy.network.allowed_domains, config.qualification!.allowedDomains);
  assert.equal(run.github.forward_auth, false);
  assert.equal(run.github.forward_copilot_auth, false);
  assert.deepEqual(run.secrets, []);
});

test("explicit tool-domain wildcards reach the native policy without becoming an implicit provider grant", () => {
  const base = configured(), domains = ["*.generated.invalid"];
  const config = { ...base, qualification: { ...base.qualification!, allowedDomains: domains } };
  const run = sandboxRunConfiguration(config, "generated-wildcard", "/private/generated/stage",
    ["/usr/local/bin/node", "/opt/moguri/dist/remote-bridge.mjs", "--foreground"]);
  assert.deepEqual(run.policy.network.allowed_domains, domains);
  assert.equal(run.policy.network.default_action, "deny");
  assert.throws(() => sandboxProviderDestination(config, "https://api.generated.invalid/v1"), /exact|scope|approved/i);
  assert.deepEqual(base.qualification!.allowedDomains, ["api.generated.invalid", "alias.generated.invalid"]);
});

test("legacy and current Apple Container inspection bind the actual immutable descriptor, not a tag or variant", () => {
  const digest = `sha256:${"a".repeat(64)}`, name = `generated/worker@${digest}`;
  assert.deepEqual(sandboxImageIdentity([{ name, index: { digest } }]), { name, digest });
  assert.deepEqual(sandboxImageIdentity([{ configuration: { name, descriptor: { digest } }, id: digest.slice(7),
    variants: [{ descriptor: { digest: `sha256:${"b".repeat(64)}` } }] }]), { name, digest });
  for (const value of [
    [], [{ name }], [{ name, index: { digest: "generated-tag" } }], [{ name, index: { digest } }, { name, index: { digest } }],
    [{ configuration: { name, descriptor: { digest } }, id: "c".repeat(64) }],
    [{ name, index: { digest }, configuration: { name, descriptor: { digest } }, id: digest.slice(7) }],
    [{ configuration: { name, descriptor: {} }, id: digest.slice(7) }],
  ]) assert.throws(() => sandboxImageIdentity(value), /unsupported|ambiguous|incomplete/);
});

test("native guest inventory preserves non-terminal status and rejects unknown rows instead of inferring absence", () => {
  const configuration = { id: "generated-owned-guest", initProcess: { executable: "/generated/guest" } };
  for (const status of ["created", "running", "stopping", "stopped"]) {
    assert.deepEqual(sandboxContainerInventory([{ configuration, status }]), [{ id: configuration.id, configuration, status }]);
    assert.deepEqual(sandboxContainerInventory([{ id: configuration.id, configuration, status: { state: status, networks: [] } }]),
      [{ id: configuration.id, configuration, status }]);
  }
  assert.deepEqual(sandboxContainerInventory([]), []);
  for (const value of [
    {}, [null], [{ status: "stopped" }], [{ configuration, id: "generated-different-guest", status: "stopped" }],
    [{ configuration, status: { state: "stopped", status: "running" } }], [{ configuration, status: {} }],
    [{ configuration, status: "unqualified-future-state" }],
  ]) assert.throws(() => sandboxContainerInventory(value), /unsupported|ambiguous|unconfirmed/);
});
