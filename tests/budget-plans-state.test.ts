import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { performance } from "node:perf_hooks";
import { EventStore } from "../apps/service/src/store.ts";
import { projectEvents, PROTOCOL_VERSION } from "../packages/protocol/src/index.ts";
import { budgetPlanFixture } from "./fixtures/budget-plan-api.ts";
import { retainedCiphertextRows as retained, writeLegacyState } from "./fixtures/legacy-state.ts";

test("schema-29-to-30 planning marker preserves raw ciphertext/keys/receipts and rolls back an actual marker failure", async () => {
  const f = await budgetPlanFixture(); let opened: EventStore | undefined;
  try {
    const path = f.service.store.path, before = retained(f.service.store.db);
    await writeLegacyState(f.service, 29);
    const raw = new DatabaseSync(path);
    try {
      raw.exec(`CREATE TRIGGER generated_planning_marker BEFORE INSERT ON retention_metadata WHEN NEW.id='budget_planning_schema'
        BEGIN SELECT RAISE(ABORT,'Generated planning marker failure'); END;`);
    } finally { raw.close(); }
    assert.throws(() => new EventStore(path, f.retentionKey), /planning marker failure/);
    const failed = new DatabaseSync(path);
    try {
      assert.equal(failed.prepare("PRAGMA user_version").get()?.user_version, 29);
      assert.equal(failed.prepare("SELECT value FROM retention_metadata WHERE id='budget_planning_schema'").get(), undefined);
      assert.deepEqual(retained(failed), before); failed.exec("DROP TRIGGER generated_planning_marker");
    } finally { failed.close(); }
    const started = performance.now(); opened = new EventStore(path, f.retentionKey);
    assert.equal(opened.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
    assert.deepEqual(retained(opened.db), before); assert.deepEqual(projectEvents(opened.events()).budgetPlans, []);
    console.log(JSON.stringify({ primitive: "budget-planning-schema-29-to-30", ms: performance.now() - started, ciphertextUnchanged: true, fabricatedHolds: false }));
  } finally { opened?.close(); await f.close(); }
});

test("legacy fixture generation refuses future plan events rather than relabeling them as old recoverable data", async () => {
  const f = await budgetPlanFixture();
  try { f.create(); await assert.rejects(() => writeLegacyState(f.service, 29), /pre-planning history/); }
  finally { await f.close(); }
});
