import assert from "node:assert/strict";
import test from "node:test";
import { open, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { startService } from "../apps/service/src/server.ts";
import { digest } from "../apps/service/src/store.ts";
import { reviewNativeTools, setupFixture, waitFor } from "./fixture.ts";

async function workspaceFixture() {
  const f = await setupFixture({ toolCall: { name: "write_file", args: { path: "fixture.txt", text: "Generated owned change.\n", expectedDigest: digest("generated original\n") } } });
  const sdk = await new MoguriSdk(f.service.connection).ready();
  try {
    await reviewNativeTools(f, ["write_file"]); await f.configure(); await f.send("Generated rewind preservation."); await f.approve(); await f.terminal();
    const checkpoint = (await sdk.checkpoints.list(f.sessionId)).checkpoints[0]!;
    return { f, sdk, checkpoint };
  } catch (error) { sdk.disconnect(); await f.close(); throw error; }
}
test("Local rewind retains the actual displaced inode and later writes through an already-open external handle", async () => {
  const { f, sdk, checkpoint } = await workspaceFixture(), handle = await open(join(f.project, "fixture.txt"), "r+");
  try {
    const calls = f.requests.length, budget = structuredClone(f.service.controller.snapshot().budgetEntries);
    const { preview } = await sdk.checkpoints.preview(f.sessionId, checkpoint.id, "workspace");
    const result = await sdk.checkpoints.apply(f.sessionId, checkpoint.id, "workspace", preview.digest);
    await handle.truncate(0); await handle.write("Generated later external inode bytes.\n", 0, "utf8"); await handle.sync();
    assert.equal(await readFile(join(f.project, "fixture.txt"), "utf8"), "generated original\n");
    const inspected = await sdk.checkpoints.inspect(f.sessionId, result.id!);
    assert.equal(inspected.effects[0]?.backupDigest, digest("Generated later external inode bytes.\n"));
    assert.equal(inspected.record.status, "completed");
    assert.deepEqual(f.service.controller.snapshot().budgetEntries, budget); assert.equal(f.requests.length, calls);
  } finally { await handle.close(); sdk.disconnect(); await f.close(); }
});

test("competing clients and external bytes invalidate exact previews before any restore intent or file effect", async () => {
  const { f, sdk, checkpoint } = await workspaceFixture(), peer = await new MoguriSdk(f.service.connection).ready();
  try {
    const { preview } = await sdk.checkpoints.preview(f.sessionId, checkpoint.id, "workspace");
    await writeFile(join(f.project, "fixture.txt"), "Generated unreviewed external bytes.\n");
    await assert.rejects(() => peer.checkpoints.apply(f.sessionId, checkpoint.id, "workspace", preview.digest), /preview|changed|stale/i);
    assert.equal(f.service.controller.snapshot().rewinds.length, 0);
    const fresh = (await sdk.checkpoints.preview(f.sessionId, checkpoint.id, "workspace")).preview;
    await peer.command({ type: "draft.save", sessionId: f.sessionId, expectedRevision: f.session().draft.revision, text: "Generated competing newer draft.", attachments: [] });
    await peer.sessions.autonomy(f.sessionId, "Guided");
    await assert.rejects(() => sdk.checkpoints.apply(f.sessionId, checkpoint.id, "workspace", fresh.digest,
      [{ root: fresh.files[0]!.root, path: "fixture.txt", choice: "restore-checkpoint" }]), /preview|changed|stale/i);
    assert.equal(f.service.controller.snapshot().rewinds.length, 0);
    assert.equal(await readFile(join(f.project, "fixture.txt"), "utf8"), "Generated unreviewed external bytes.\n");
    assert.equal(f.session().draft.text, "Generated competing newer draft.");
  } finally { peer.disconnect(); sdk.disconnect(); await f.close(); }
});

test("another actual session writer remains owned and cannot be cancelled or overwritten by this session's rewind settlement", async () => {
  const { f, sdk, checkpoint } = await workspaceFixture();
  try {
    const other = (await sdk.sessions.create(f.session().projectId, "Generated independent writer", { modelId: f.modelId })).id!;
    const calls = f.requests.length;
    await sdk.command({ type: "draft.save", sessionId: other, expectedRevision: 0, text: "generated slow independent writer", attachments: [] });
    await sdk.command({ type: "message.send", sessionId: other, expectedRevision: 1, delivery: "queue" });
    await waitFor(() => f.requests.length > calls && f.service.controller.snapshot().sessions.find((session) => session.id === other)?.turnId);
    const budget = structuredClone(f.service.controller.snapshot().budgetEntries);
    const { preview } = await sdk.checkpoints.preview(f.sessionId, checkpoint.id, "workspace");
    assert.match(preview.blockers.join(" "), /competing writer|console/i);
    await sdk.checkpoints.settle(f.sessionId);
    assert.ok(f.service.controller.snapshot().sessions.find((session) => session.id === other)?.turnId);
    assert.deepEqual(f.service.controller.snapshot().budgetEntries, budget);
    await assert.rejects(() => sdk.checkpoints.apply(f.sessionId, checkpoint.id, "workspace", preview.digest), /writer|preview|blocked|unavailable/i);
    assert.equal(await readFile(join(f.project, "fixture.txt"), "utf8"), "Generated owned change.\n");
    await sdk.command({ type: "session.stop", sessionId: other });
  } finally { sdk.disconnect(); await f.close(); }
});

test("encrypted pruning and permanent session deletion preserve active context, independent artifacts, backups and spent accounting", async () => {
  const { f, sdk, checkpoint } = await workspaceFixture();
  let restarted: Awaited<ReturnType<typeof startService>> | undefined, current: MoguriSdk | undefined;
  try {
    const artifact = await sdk.artifacts.create(f.sessionId, { kind: "research-note", name: "Generated independent output", text: "Generated output survives session retention." });
    const { preview } = await sdk.checkpoints.preview(f.sessionId, checkpoint.id, "workspace");
    const restored = await sdk.checkpoints.apply(f.sessionId, checkpoint.id, "workspace", preview.digest);
    const backup = (await sdk.checkpoints.inspect(f.sessionId, restored.id!)).record.files[0]!.backup!;
    const budget = structuredClone(f.service.controller.snapshot().budgetEntries), calls = f.requests.length;
    await sdk.checkpoints.prune(f.sessionId, checkpoint.id, checkpoint.revision);
    assert.equal((await sdk.checkpoints.read(f.sessionId, checkpoint.id)).state, null);
    assert.throws(() => f.service.store.blob(checkpoint.stateDigest!), /missing|forgotten|retained|unavailable/i);
    assert.equal(await readFile(backup, "utf8"), "Generated owned change.\n");
    sdk.disconnect(); await f.service.close();
    restarted = await startService({ stateDir: join(f.directory, "state"), provider: f.provider, retentionKey: f.retentionKey,
      platform: { terminal: { defaultRoot: f.home } } });
    current = await new MoguriSdk(restarted.connection).ready();
    assert.equal((await current.checkpoints.read(f.sessionId, checkpoint.id)).state, null);
    assert.equal((await current.checkpoints.list(f.sessionId)).rewinds[0]?.status, "completed");
    const owner = current.getState().snapshot!.sessions.find((session) => session.id === f.sessionId)!;
    await current.sessions.delete(owner.id, true, owner.revision);
    assert.equal((await current.artifacts.read(artifact.id!)).text, "Generated output survives session retention.");
    assert.deepEqual(restarted.controller.snapshot().budgetEntries, budget); assert.equal(f.requests.length, calls);
    assert.equal(await readFile(backup, "utf8"), "Generated owned change.\n");
    assert.equal(restarted.controller.snapshot().checkpoints.length, 0);
  } finally { sdk.disconnect(); current?.disconnect(); await restarted?.close(); await f.close(); }
});

test("a missing later workspace compartment blocks complete workspace rewind instead of skipping its unprovable effects", async () => {
  const f = await setupFixture({ responseMode: "text" }), sdk = await new MoguriSdk(f.service.connection).ready();
  try {
    await f.configure(); await f.send("Generated earlier retained target."); await f.terminal();
    const target = (await sdk.checkpoints.list(f.sessionId)).checkpoints[0]!;
    await f.send("Generated later pruned boundary."); await f.terminal();
    const later = (await sdk.checkpoints.list(f.sessionId)).checkpoints[0]!;
    await sdk.checkpoints.prune(f.sessionId, later.id, later.revision);
    assert.match((await sdk.checkpoints.preview(f.sessionId, target.id, "workspace")).preview.blockers.join(" "), /no complete proven|unavailable/i);
    assert.deepEqual((await sdk.checkpoints.preview(f.sessionId, target.id, "conversation")).preview.blockers, []);
  } finally { sdk.disconnect(); await f.close(); }
});
