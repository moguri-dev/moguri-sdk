import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { EventStore } from "../apps/service/src/store.ts";
import { startService } from "../apps/service/src/server.ts";
import { profileFixture } from "./fixtures/profiles.ts";
import { setupFixture, waitFor } from "./fixture.ts";

test("restart preserves group colors and removal tombstones without losing a removed group's exact captured roots", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  let restarted: Awaited<ReturnType<typeof startService>> | undefined, client: MoguriSdk | undefined;
  try {
    const path = join(fixture.directory, "generated-ungrouped-member"); await mkdir(path);
    const first = fixture.session().projectId!, second = (await sdk.projects.add(path)).id!;
    const group = await sdk.projects.group("Generated removable group", [{ projectId: first, revision: 0 }, { projectId: second, revision: 0 }]);
    const created = await sdk.sessions.createFolder(group.id!, "Generated retained removed-group chat");
    const original = fixture.service.controller.snapshot().sessions.find((session) => session.id === created.id)!;
    await sdk.projects.folder("Generated retained palette", 1, undefined, 0, "#1F72A3");
    await sdk.projects.ungroup(group.id!, [{ projectId: first, revision: 1 }, { projectId: second, revision: 1 }], 0);
    const folders = fixture.service.controller.snapshot().projectFolders;
    sdk.disconnect(); await fixture.service.close();
    restarted = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey });
    client = await new MoguriSdk(restarted.connection).ready();
    assert.deepEqual(client.getState().snapshot!.projectFolders, folders);
    assert.equal(folders[0]?.color, "#1f72a3");
    const retained = client.getState().snapshot!.sessions.find((session) => session.id === original.id)!;
    assert.deepEqual(retained.repositories, original.repositories); assert.equal(retained.projectFolderId, original.projectFolderId);
    assert.ok((await client.workspaces.files(retained.id, ".", first)).entries.includes("fixture.txt"));
    assert.deepEqual((await client.workspaces.files(retained.id, ".", second)).entries, []);
    await assert.rejects(() => client!.projects.folder("Must stay removed", 0, group.id, 0), { code: "group_missing" });
    assert.equal(fixture.requests.length, 0);
  } finally { client?.disconnect(); sdk.disconnect(); await restarted?.close(); await fixture.close(); }
});

test("a folder writer blocks the same actual repository in another profile without sharing private sessions or model context", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await profileFixture();
  try {
    const firstPath = join(fixture.directory, "generated-first"), secondPath = join(fixture.directory, "generated-second");
    await mkdir(firstPath); await mkdir(secondPath);
    const first = (await fixture.sdk.command({ type: "project.add", path: firstPath })).id!;
    const second = (await fixture.sdk.command({ type: "project.add", path: secondPath })).id!;
    const folder = await fixture.sdk.projects.group("Generated private Alpha folder", [{ projectId: first, revision: 0 }, { projectId: second, revision: 0 }]);
    const owner = await fixture.sdk.sessions.createFolder(folder.id!, "Generated private Alpha work", { modelId: fixture.providers[0]!.modelId });
    await fixture.send(fixture.sdk, owner.id!, "generated slow private Alpha folder work");
    await waitFor(() => fixture.providers[0]!.requests.length === 1);
    const { client: beta } = await fixture.create("Generated Beta");
    const project = (await beta.command({ type: "project.add", path: secondPath })).id!;
    const queued = await beta.sessions.create(project, "Generated private Beta member", { modelId: fixture.providers[1]!.modelId });
    await fixture.send(beta, queued.id!, "Generated private Beta work after original root owner.");
    await new Promise((resolve) => setTimeout(resolve, 75));
    assert.equal(fixture.providers[1]!.requests.length, 0);
    assert.equal(fixture.session(beta, queued.id!).queue.length, 1);
    assert.equal(JSON.stringify(beta.getState()).includes("Generated private Alpha"), false);
    await fixture.sdk.command({ type: "session.stop", sessionId: owner.id! });
    await waitFor(() => fixture.session(beta, queued.id!).status === "completed");
    assert.equal(fixture.providers[1]!.requests.length, 1);
    assert.equal(JSON.stringify(fixture.providers[1]!.requests).includes("private Alpha folder work"), false);
  } finally { await fixture.close(); }
});

test("restart retains exact folder roots and all-root uncertainty while preserving undispatched work without replay", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  let restarted: Awaited<ReturnType<typeof startService>> | undefined, client: MoguriSdk | undefined;
  try {
    const other = join(fixture.directory, "generated-recovery-member"); await mkdir(other);
    const first = fixture.session().projectId!, second = (await sdk.command({ type: "project.add", path: other })).id!;
    const folder = await sdk.projects.group("Generated recovery folder", [{ projectId: first, revision: 0 }, { projectId: second, revision: 0 }]);
    const created = await sdk.sessions.createFolder(folder.id!, "Generated captured root recovery");
    const original = fixture.service.controller.snapshot().sessions.find((session) => session.id === created.id)!;
    sdk.disconnect(); await fixture.service.close();
    const stateDir = join(fixture.directory, "state"), store = new EventStore(join(stateDir, "state.sqlite"), fixture.retentionKey);
    const scope = { profile_id: "default", project_id: null, session_id: original.id };
    const item = { id: "generated-interrupted-group-input", text: "Generated original dispatched group work.", attachments: [], delivery: "queue" as const };
    store.commit([
      { ...scope, event_type: "queue.enqueued", payload: { item } },
      { ...scope, turn_id: "generated-interrupted-group-turn", event_type: "turn.started", payload: { item, controls: original.controls, policyRevision: 0 } },
      { ...scope, event_type: "queue.enqueued", payload: { item: { ...item, id: "generated-held-group-input", text: "Generated preserved group hold.", held: true } } },
    ]);
    store.close();
    restarted = await startService({ stateDir, provider: fixture.provider, retentionKey: fixture.retentionKey });
    client = await new MoguriSdk(restarted.connection).ready();
    const session = restarted.controller.snapshot().sessions.find((session) => session.id === original.id)!;
    assert.deepEqual(session.repositories, original.repositories);
    assert.equal(session.projectFolderId, original.projectFolderId);
    assert.equal(session.turnId, null);
    assert.equal(session.queue[0]?.id, "generated-held-group-input");
    assert.equal(session.queue[0]?.held, true);
    assert.ok(restarted.controller.snapshot().blockedSessions.includes(session.id));
    assert.ok(original.repositories!.every((binding) => restarted!.controller.ownedLocalRoots().includes(binding.root.root)));
    await assert.rejects(() => client!.sessions.delete(session.id, true), /inspect|unconfirmed|root/i);
    assert.ok((await client.workspaces.files(session.id, ".", first)).entries.includes("fixture.txt"));
    assert.equal(fixture.requests.length, 0);
  } finally { client?.disconnect(); sdk.disconnect(); await restarted?.close(); await fixture.close(); }
});
