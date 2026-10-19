import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { parseArgs } from "node:util";
import { performance } from "node:perf_hooks";

const { values } = parseArgs({ options: { image: { type: "string" }, bundle: { type: "string" }, key: { type: "string" } } });
if (!values.image || !/@sha256:[a-f0-9]{64}$/.test(values.image)) throw new Error("Pass --image REGISTRY/IMAGE@sha256:DIGEST for a generated-workspace live qualification.");
const root = resolve(".native/qualification"); await mkdir(root, { recursive: true, mode: 0o700 });
const directory = await mkdtemp(join(root, "sendbox-"));
let passed = false;
try {
  const workspace = join(directory, "workspace"); await mkdir(workspace, { mode: 0o700 });
  await writeFile(join(workspace, "generated.txt"), "Generated SendBox qualification, no personal data.\n");
  const config = join(directory, "sendbox.json");
  await writeFile(config, JSON.stringify({
    name: `moguri-spike-${directory.split("/").at(-1)}`,
    project_path: workspace,
    runtime: { provider: "apple" },
    resources: { cpus: 2, memory_mb: 2048, disk_size_mb: 2048 },
    policy: {
      commands: { default_action: "deny", log_blocked: true, allowlist: ["/bin/sh -c *"], denylist: [] },
      boundaries: { enabled: true, tool_calls: { servers: {} }, syscalls: { additional_denylist: [], log_blocked: true } },
      network: { default_action: "deny", allow_dns: false, max_connections: 1, allowed_domains: [], blocked_domains: [] },
      packages: { enabled: false },
    },
    secrets: [],
    github: { forward_auth: false, forward_copilot_auth: false, allow_private_repository_access: false, branch_protection: { enabled: false, protected_branches: [], allowed_branch_patterns: [] } },
    devcontainer: { auto_generate: false, extensions: [] },
    observability: { mcp_inspection: { enabled: false } },
  }, null, 2), { mode: 0o600 });
  const started = performance.now();
  execFileSync("/usr/local/bin/sendbox", ["policy", "validate", "--config", config], { encoding: "utf8", timeout: 10_000 });
  const output = execFileSync("/usr/local/bin/sendbox", ["run", "--json", "--runtime", "apple", "--config", config, "--image", values.image, "--bundle", values.bundle ?? "/opt/sendbox-0.2.0-macos-arm64/guest/aarch64/bundle", "--trust-root", values.key ?? "/opt/sendbox-0.2.0-macos-arm64/guest/aarch64/release-public.key", "--", "/bin/sh", "-c", "printf 'GENERATED_MOGURI_SENDBOX_READY\\n'"], { encoding: "utf8", timeout: 90_000, maxBuffer: 2 * 1024 * 1024 });
  const events = output.trim().split("\n").map((line) => JSON.parse(line));
  const serialized = JSON.stringify(events);
  assert.ok(serialized.includes("GENERATED_MOGURI_SENDBOX_READY") || serialized.includes(Buffer.from("GENERATED_MOGURI_SENDBOX_READY\n").toString("hex")), "The real guest must confirm its generated output.");
  console.log(JSON.stringify({ status: "PASS", primitive: "Real SendBox Apple VM, signed guest and generated workload output", image: values.image, ms: performance.now() - started, events }, null, 2));
  passed = true;
} catch (error) {
  console.error(`Real SendBox qualification FAILED. Generated configuration/diagnostics retained at ${directory}. No Local fallback or VM-containment claim.`);
  throw error;
} finally { if (passed) await rm(directory, { recursive: true, force: true }); }
