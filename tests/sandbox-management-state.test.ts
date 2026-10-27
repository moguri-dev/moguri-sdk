import assert from "node:assert/strict";
import { lstat, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { Header, type HeaderData } from "tar";
import { test } from "node:test";
import { defaultSandboxManagement, defaultSettings, PROTOCOL_VERSION, projectEvents } from "../packages/protocol/src/index.ts";
import { EventStore } from "../apps/service/src/store.ts";
import { extractSandboxRelease, sandboxDistributionCacheKey, SENDBOX_023, SENDBOX_024 } from "../apps/service/src/sandbox-distribution.ts";
import { sandboxRunConfiguration } from "../apps/service/src/sandbox-policy.ts";

test("the producer cache binds the complete pinned release as well as worker inputs", () => {
  const payload = "1".repeat(64), current = sandboxDistributionCacheKey(payload, SENDBOX_024);
  assert.equal(defaultSandboxManagement().version, SENDBOX_024.version);
  assert.equal(current, sandboxDistributionCacheKey(payload, { ...SENDBOX_024 }));
  assert.notEqual(current, sandboxDistributionCacheKey(payload, SENDBOX_023));
  assert.notEqual(current, sandboxDistributionCacheKey("2".repeat(64), SENDBOX_024));
  for (const vendor of [
    { ...SENDBOX_024, archiveSha256: "3".repeat(64) }, { ...SENDBOX_024, hostSha256: "4".repeat(64) },
    { ...SENDBOX_024, keySha256: "5".repeat(64) }, { ...SENDBOX_024, manifestSha256: "6".repeat(64) },
    { ...SENDBOX_024, minimumReleaseSequence: SENDBOX_024.minimumReleaseSequence + 1 },
  ]) assert.notEqual(current, sandboxDistributionCacheKey(payload, vendor));
});

test("protocol-51 migration preserves encrypted settings and manual grants without enabling managed permissions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "moguri-managed-sandbox-migration-")), path = join(directory, "state.sqlite"), key = Buffer.alloc(32, 51);
  try {
    const original = new EventStore(path, key);
    const legacy = defaultSettings(); delete legacy.sandboxManagement;
    legacy.instructions = "Generated retained original instructions.";
    original.commit([{ event_type: "settings.updated", profile_id: "default", payload: { settings: legacy, revision: 4, permissionRevision: 3 } }]);
    const rows = original.db.prepare("SELECT seq,data FROM events ORDER BY seq").all();
    original.db.exec("DELETE FROM retention_metadata WHERE id IN ('model_preferences_schema','composer_workflows_schema','side_context_schema','retained_telemetry_schema','session_reliability_schema','kanban_interactions_schema','session_kupo_kanban_schema','automatic_kupo_schema','project_kanban_schema','session_github_workflows_schema','session_github_convergence_schema','session_navigation_schema','workspace_experience_schema','lean_tooling_schema','lean_tooling_convergence_schema','candidate_retention_schema','browser_control_schema','model_defaults_schema','managed_sandbox_schema','session_indicators_schema'); PRAGMA user_version=51;");
    original.close();
    const reopened = new EventStore(path, key);
    try {
      assert.equal(reopened.db.prepare("PRAGMA user_version").get()!.user_version, PROTOCOL_VERSION);
      assert.deepEqual(reopened.db.prepare("SELECT seq,data FROM events ORDER BY seq").all(), rows);
      const state = projectEvents(reopened.events());
      assert.equal(state.settings.values.instructions, legacy.instructions);
      assert.equal(state.settings.values.sandboxManagement?.enabled, false);
      assert.equal(state.settings.values.sandboxManagement?.version, "0.2.4");
      assert.equal(state.settings.revision, 4); assert.equal(state.settings.permissionRevision, 3);
    } finally { reopened.close(); }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("explicit tool rules survive encrypted reopen without granting model access or relabeling retained settings", async () => {
  const directory = await mkdtemp(join(tmpdir(), "moguri-wildcard-reopen-")), path = join(directory, "state.sqlite"), key = Buffer.alloc(32, 52);
  const settings = defaultSettings(), hash = "1".repeat(64), domains = ["api.generated.test", "*.tools.generated.test"];
  settings.sandboxManagement = { ...defaultSandboxManagement(), version: "0.2.3" };
  settings.sandbox = { executable: "/generated/sendbox", configPath: null, image: `generated/worker@sha256:${hash}`,
    bundlePath: "/generated/bundle", trustRootPath: "/generated/key", qualification: { release: "0.2.3",
      hostSha256: hash, keySha256: hash, manifestSha256: hash, workerDigest: hash, bridgeDigest: hash,
      trustRootId: "generated", minimumReleaseSequence: 7, allowedDomains: domains, allowCopilot: false,
      resources: { cpus: 2, memoryMb: 2048, diskMb: 2048 } } };
  try {
    const original = new EventStore(path, key);
    original.commit([{ event_type: "settings.updated", profile_id: "default", payload: { settings, revision: 6, permissionRevision: 7 } }]);
    const rows = original.db.prepare("SELECT seq,data FROM events ORDER BY seq").all(); original.close();
    const reopened = new EventStore(path, key);
    try {
      const state = projectEvents(reopened.events());
      assert.deepEqual(reopened.db.prepare("SELECT seq,data FROM events ORDER BY seq").all(), rows);
      assert.deepEqual(state.settings.values.sandbox.qualification!.allowedDomains, domains);
      assert.equal(state.settings.values.sandbox.qualification!.allowCopilot, false);
      assert.equal(state.settings.values.sandboxManagement?.enabled, false);
      assert.equal(state.settings.values.sandboxManagement?.version, "0.2.3");
      assert.equal(state.settings.revision, 6); assert.equal(state.settings.permissionRevision, 7);
      const policy = sandboxRunConfiguration(state.settings.values.sandbox, "generated-reopen", "/generated/private-stage",
        ["/usr/local/bin/node", "/opt/moguri/dist/remote-bridge.mjs", "--foreground"]);
      assert.deepEqual(policy.policy.network.allowed_domains, domains);
      assert.equal(state.sandboxExecutions?.length, 0); assert.equal(state.budgetEntries.length, 0);
    } finally { reopened.close(); }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("release archive traversal, links, unsafe modes and case-colliding paths fail before extraction", async () => {
  const directory = await mkdtemp(join(tmpdir(), "moguri-managed-sandbox-tar-"));
  const fixtures: HeaderData[][] = [
    [{ path: "../generated-escape", type: "File", mode: 0o644, size: 0 }],
    [{ path: "sendbox-0.2.3-macos-arm64/linked", type: "SymbolicLink", linkpath: "/generated/outside", mode: 0o777, size: 0 }],
    [{ path: "sendbox-0.2.3-macos-arm64/unsafe", type: "File", mode: 0o666, size: 0 }],
    [{ path: "sendbox-0.2.3-macos-arm64/FILE", type: "File", mode: 0o644, size: 0 },
      { path: "sendbox-0.2.3-macos-arm64/file", type: "File", mode: 0o644, size: 0 }],
  ];
  try {
    for (let index = 0; index < fixtures.length; index++) {
      const blocks = fixtures[index]!.map((data) => {
        const header = new Header(data); header.encode();
        if (!header.block) throw new Error("Generated TAR fixture has no encoded header.");
        return header.block;
      });
      const bytes = gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)])), path = join(directory, `generated-${index}.tar.gz`);
      await writeFile(path, bytes);
      await assert.rejects(() => extractSandboxRelease(path, join(directory, `unpacked-${index}`), "0.2.3",
        createHash("sha256").update(bytes).digest("hex"), AbortSignal.timeout(5000)), /archive|artifact path/);
      await assert.rejects(() => lstat(join(directory, `unpacked-${index}`)), { code: "ENOENT" });
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
