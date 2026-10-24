import assert from "node:assert/strict";
import { lstat, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { Header, type HeaderData } from "tar";
import { test } from "node:test";
import { defaultSettings, PROTOCOL_VERSION, projectEvents } from "../packages/protocol/src/index.ts";
import { EventStore } from "../apps/service/src/store.ts";
import { extractSandboxRelease } from "../apps/service/src/sandbox-distribution.ts";

test("protocol-51 migration preserves encrypted settings and manual grants without enabling managed permissions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "moguri-managed-sandbox-migration-")), path = join(directory, "state.sqlite"), key = Buffer.alloc(32, 51);
  try {
    const original = new EventStore(path, key);
    const legacy = defaultSettings(); delete legacy.sandboxManagement;
    legacy.instructions = "Generated retained original instructions.";
    original.commit([{ event_type: "settings.updated", profile_id: "default", payload: { settings: legacy, revision: 4, permissionRevision: 3 } }]);
    const rows = original.db.prepare("SELECT seq,data FROM events ORDER BY seq").all();
    original.db.exec("DELETE FROM retention_metadata WHERE id='managed_sandbox_schema'; PRAGMA user_version=51;");
    original.close();
    const reopened = new EventStore(path, key);
    try {
      assert.equal(reopened.db.prepare("PRAGMA user_version").get()!.user_version, PROTOCOL_VERSION);
      assert.deepEqual(reopened.db.prepare("SELECT seq,data FROM events ORDER BY seq").all(), rows);
      const state = projectEvents(reopened.events());
      assert.equal(state.settings.values.instructions, legacy.instructions);
      assert.equal(state.settings.values.sandboxManagement?.enabled, false);
      assert.equal(state.settings.values.sandboxManagement?.version, "0.2.3");
      assert.equal(state.settings.revision, 4); assert.equal(state.settings.permissionRevision, 3);
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
