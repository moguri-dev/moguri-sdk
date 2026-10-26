import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { EventStore } from "../apps/service/src/store.ts";
import { factoryControls, PROTOCOL_VERSION } from "../packages/protocol/src/index.ts";
import { retainedCiphertextRows } from "./fixtures/legacy-state.ts";

const tooling = "lean_tooling_schema", candidate = "candidate_retention_schema", convergence = "lean_tooling_convergence_schema";
const markers = (db: DatabaseSync) => db.prepare("SELECT id,value FROM retention_metadata ORDER BY id").all();
async function fixture(lineage: "main" | "tooling") {
  const directory = await mkdtemp(join(tmpdir(), "moguri-tooling-convergence-")), path = join(directory, "state.sqlite"), key = Buffer.alloc(32, 0x72);
  const store = new EventStore(path, key);
  store.commit([{ event_type: "session.created", profile_id: "default", session_id: "generated-parent", payload: { title: "Generated preserved parent", controls: factoryControls() } }]);
  let raw: string | null = null, snapshot: string | null = null;
  if (lineage === "tooling") {
    raw = store.putBlob("Generated original retained source.\n"); snapshot = store.putBlob('{"generated":"original parent snapshot"}');
    store.commit([
      { event_type: "tool.completed", profile_id: "default", session_id: "generated-parent", turn_id: "generated-turn", step_id: "generated-step",
        payload: { call: { id: "generated-call", name: "read_file", arguments: { path: "generated.txt" } }, text: '{"complete":false}', rawDigest: raw, rawComplete: true, isError: false, outcome: "completed" } },
      { event_type: "session.created", profile_id: "default", session_id: "generated-child", payload: { title: "Generated preserved child", controls: factoryControls(),
        parentSessionId: "generated-parent", kind: "side", mode: "read-only", parentSnapshotDigest: snapshot } },
    ]);
  }
  store.db.prepare("DELETE FROM retention_metadata WHERE id=?").run(lineage === "main" ? tooling : candidate);
  store.db.prepare("DELETE FROM retention_metadata WHERE id=?").run(convergence);
  store.db.exec("DELETE FROM retention_metadata WHERE id IN ('session_github_workflows_schema','session_github_convergence_schema','session_navigation_schema','workspace_experience_schema')");
  store.db.exec("PRAGMA user_version=57");
  const rows = retainedCiphertextRows(store.db); store.close();
  return { directory, path, key, rows, raw, snapshot, close: () => rm(directory, { recursive: true, force: true }) };
}

for (const lineage of ["main", "tooling"] as const) {
  test(`the actual ${lineage} schema-57 lineage converges without rewriting ordinary ciphertext or losing source grants`, async () => {
    const f = await fixture(lineage); let store: EventStore | undefined;
    try {
      store = new EventStore(f.path, f.key);
      assert.equal(store.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
      for (const marker of [tooling, candidate, convergence]) assert.equal(store.db.prepare("SELECT value FROM retention_metadata WHERE id=?").get(marker)?.value, "1");
      assert.deepEqual(retainedCiphertextRows(store.db), f.rows);
      if (f.raw) assert.equal(store.blob(f.raw), "Generated original retained source.\n");
      if (f.snapshot) assert.equal(store.blob(f.snapshot), '{"generated":"original parent snapshot"}');
      store.close(); store = new EventStore(f.path, f.key);
      assert.deepEqual(retainedCiphertextRows(store.db), f.rows);
    } finally { store?.close(); await f.close(); }
  });
  test(`failed ${lineage} lineage convergence rolls back all new markers/version and preserves original state`, async () => {
    const f = await fixture(lineage);
    try {
      const raw = new DatabaseSync(f.path), original = markers(raw);
      raw.exec(`CREATE TRIGGER generated_convergence_failure BEFORE INSERT ON retention_metadata WHEN NEW.id='${convergence}'
        BEGIN SELECT RAISE(ABORT,'Generated convergence failure'); END;`); raw.close();
      assert.throws(() => new EventStore(f.path, f.key), /Generated convergence failure/);
      const after = new DatabaseSync(f.path);
      try {
        assert.equal(after.prepare("PRAGMA user_version").get()?.user_version, 57);
        assert.deepEqual(markers(after), original); assert.deepEqual(retainedCiphertextRows(after), f.rows);
      } finally { after.close(); }
    } finally { await f.close(); }
  });
}
for (const invalid of ["missing", "ambiguous", "corrupt", "premature-convergence"] as const) {
  test(`invalid ${invalid} protocol-57 provenance fails without repairing markers or rewriting state`, async () => {
    const f = await fixture("main");
    try {
      const raw = new DatabaseSync(f.path);
      if (invalid === "missing") raw.prepare("DELETE FROM retention_metadata WHERE id=?").run(candidate);
      else if (invalid === "corrupt") raw.prepare("UPDATE retention_metadata SET value='2' WHERE id=?").run(candidate);
      else raw.prepare("INSERT INTO retention_metadata(id,value) VALUES (?,?)").run(invalid === "ambiguous" ? tooling : convergence, "1");
      const original = markers(raw); raw.close();
      assert.throws(() => new EventStore(f.path, f.key), /lineage/);
      const after = new DatabaseSync(f.path);
      try { assert.deepEqual(markers(after), original); assert.deepEqual(retainedCiphertextRows(after), f.rows); }
      finally { after.close(); }
    } finally { await f.close(); }
  });
}
for (const marker of [candidate, tooling, convergence]) {
  test(`current schema refuses missing ${marker} without repairing retained provenance`, async () => {
    const f = await fixture("main");
    try {
      new EventStore(f.path, f.key).close();
      const raw = new DatabaseSync(f.path); raw.prepare("DELETE FROM retention_metadata WHERE id=?").run(marker);
      const original = markers(raw); raw.close();
      assert.throws(() => new EventStore(f.path, f.key), /schema marker/);
      const after = new DatabaseSync(f.path);
      try { assert.deepEqual(markers(after), original); assert.deepEqual(retainedCiphertextRows(after), f.rows); }
      finally { after.close(); }
    } finally { await f.close(); }
  });
}
