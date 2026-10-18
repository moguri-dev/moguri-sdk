import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { startService } from "../apps/service/src/server.ts";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { setupFixture } from "./fixture.ts";

test("schema-1 state migrates to schema 2 with the same sessions, drafts, receipts and immutable history", async () => {
  const fixture = await setupFixture();
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  let restarted: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    await sdk.command({ type: "draft.save", sessionId: fixture.sessionId, expectedRevision: 0, text: "generated schema-one surviving draft", attachments: [] }, "generated-migration-command");
    const count = fixture.service.controller.events(0).length;
    sdk.disconnect();
    await fixture.service.close();
    const path = join(fixture.directory, "state", "state.sqlite");
    const old = new DatabaseSync(path);
    old.exec("DROP TABLE memory_files; DROP TABLE memory_chunks; DROP TABLE memory_graph_nodes; DROP TABLE memory_graph_edges; PRAGMA user_version=1");
    old.close();
    restarted = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider });
    assert.equal(restarted.store.db.prepare("PRAGMA user_version").get()?.user_version, 2);
    const session = restarted.controller.snapshot().sessions.find((session) => session.id === fixture.sessionId)!;
    assert.equal(session.draft.text, "generated schema-one surviving draft");
    assert.equal(restarted.controller.snapshot().settings.values.appearance.theme, "dark");
    assert.ok(restarted.controller.events(0).length >= count);
    assert.ok(restarted.store.db.prepare("SELECT id FROM receipts WHERE id=?").get("generated-migration-command"));
    assert.throws(() => restarted!.store.db.exec("UPDATE events SET payload='{}'"), /append-only/);
  } finally { sdk.disconnect(); await restarted?.close(); await fixture.close(); }
});

test("vector and graph indexes survive restart and remain scoped derived data rather than session state", async () => {
  const fixture = await setupFixture();
  let restarted: Awaited<ReturnType<typeof startService>> | undefined;
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await writeFile(join(fixture.project, "generated.ts"), "export function persistedVectorKnowledge() { return 'generated'; }\n");
    const snapshot = sdk.getState().snapshot!;
    await sdk.settings.update({ ...snapshot.settings.values, memory: { ...snapshot.settings.values.memory, enabled: true } }, snapshot.settings.revision);
    const job = await sdk.memory.index(fixture.session().projectId);
    assert.equal((await sdk.jobs.wait(job.id!)).status, "completed");
    sdk.disconnect();
    await fixture.service.close();
    restarted = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider });
    const result = await restarted.controller.platform.query({ type: "memory.search", projectId: fixture.session().projectId, text: "persisted vector knowledge", limit: 6 });
    assert.ok(result.type === "memory.search" && result.items.some((item) => item.path === "generated.ts" && item.text.includes("persistedVectorKnowledge")));
    const graph = await restarted.controller.platform.query({ type: "memory.graph", projectId: fixture.session().projectId, path: "generated.ts" });
    assert.ok(graph.type === "memory.graph" && graph.nodes.some((node) => node.kind === "symbol"));
  } finally { sdk.disconnect(); await restarted?.close(); await fixture.close(); }
});
