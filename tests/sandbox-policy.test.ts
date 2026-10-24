import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultSettings, type SandboxConfiguration } from "../packages/sdk/src/index.ts";
import { sandboxConfiguration, sandboxProviderDestination, sandboxRunConfiguration } from "../apps/service/src/sandbox-policy.ts";

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
