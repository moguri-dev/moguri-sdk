import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { mkdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { EventStore } from "../apps/service/src/store.ts";
import { startService } from "../apps/service/src/server.ts";
import { MoguriSdk, PROTOCOL_VERSION, projectEvents, sessionRepositoryProposal, type ChatWriter, type StoredEvent } from "../packages/sdk/src/index.ts";
import { setupFixture, waitFor } from "./fixture.ts";
import { removeChatRepositoryBindingFixtureMarker, retainedCiphertextRows } from "./fixtures/legacy-state.ts";

type Call = { name: string; args: Record<string, unknown> };
const darwin = { skip: process.platform !== "darwin" };
const write = (path: string): Call => ({ name: "write_file", args: { path, text: "export const generated = true;\n", expectedDigest: "absent" } });
function scripted(plan: Record<string, Call[]>) {
  return (request: Record<string, unknown>) => {
    const messages = (request.messages as Record<string, unknown>[]);
    const user = messages.findLastIndex((message) => message.role === "user");
    const prompt = String(messages[user]?.content ?? ""), done = messages.slice(user + 1).filter((message) => message.role === "tool").length;
    const calls = Object.entries(plan).find(([key]) => prompt.includes(key))?.[1] ?? [];
    return done < calls.length ? { tool: calls[done] } : { text: "Generated scripted turn complete." };
  };
}
async function repository(path: string): Promise<string> {
  await mkdir(join(path, "src"), { recursive: true });
  execFileSync("git", ["init", "-q", path]);
  return realpath(path);
}
async function chat(sdk: MoguriSdk, modelId: string, title: string): Promise<string> {
  const created = await sdk.sessions.create(null, title, { modelId });
  await sdk.sessions.autonomy(created.id!, "Autopilot");
  return created.id!;
}
async function send(sdk: MoguriSdk, sessionId: string, text: string) {
  const draft = sdk.getState().snapshot!.sessions.find((session) => session.id === sessionId)!.draft;
  await sdk.command({ type: "draft.save", sessionId, expectedRevision: draft.revision, text, attachments: [] });
  await sdk.command({ type: "message.send", sessionId, expectedRevision: draft.revision + 1, delivery: "queue" });
}
const settled = (sdk: MoguriSdk, id: string) => waitFor(() => {
  const session = sdk.getState().snapshot?.sessions.find((value) => value.id === id);
  return session && !session.turnId && !session.queue.length && session.status === "completed" ? session : false;
});

test("only successful writes inside a nested Git repository propose it; Home, plain folders and a dismissed root never are", darwin, async () => {
  const fixture = await setupFixture({ respond: scripted({
    "generated home write": [write("generated-notes/plain.txt"), write("top-level.txt")],
    "generated repo write": [write("generated-notes/plain.txt"), write("code/generated-repo/src/main.ts"), write("generated-notes/later.txt")],
    "generated repeated write": [write("code/generated-repo/src/second.ts")],
  }) });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    execFileSync("git", ["init", "-q", fixture.home]);
    await mkdir(join(fixture.home, "generated-notes"), { recursive: true });
    const repo = await repository(join(fixture.home, "code", "generated-repo"));
    const id = await chat(sdk, fixture.modelId, "Generated Home coding chat");
    await send(sdk, id, "generated home write"); await settled(sdk, id);
    assert.equal(sdk.sessions.get(id)!.repositoryProposal, undefined);
    assert.equal(fixture.service.controller.events(0).some((event) => event.event_type === "session.repository_observed"), false);
    await send(sdk, id, "generated repo write"); const after = await settled(sdk, id);
    assert.equal(after.repositoryProposal?.status, "pending");
    assert.equal(after.repositoryProposal?.root.root, repo);
    assert.equal(after.projectId, null); assert.ok(after.homeRoot);
    const proposal = sessionRepositoryProposal(after, sdk.getState().snapshot);
    assert.deepEqual(proposal && { root: proposal.root.root, project: proposal.project, confirm: proposal.confirm }, { root: repo, project: null, confirm: true });
    const observed = fixture.service.controller.events(0).filter((event) => event.event_type === "session.repository_observed");
    const finished = fixture.service.controller.events(0).findLast((event) => event.event_type === "turn.finished" && event.session_id === id);
    assert.equal(observed.length, 1); assert.equal(observed[0]!.seq + 1, finished?.seq);
    await sdk.sessions.dismissRepository(id);
    assert.equal(sdk.sessions.get(id)!.repositoryProposal?.status, "dismissed");
    assert.equal(sessionRepositoryProposal(sdk.sessions.get(id), sdk.getState().snapshot), null);
    await assert.rejects(() => sdk.sessions.dismissRepository(id), /no pending repository proposal/);
    await send(sdk, id, "generated repeated write"); await settled(sdk, id);
    assert.equal(fixture.service.controller.events(0).filter((event) => event.event_type === "session.repository_observed").length, 1);
    assert.equal(sdk.sessions.get(id)!.projectId, null);
    assert.equal(sdk.getState().snapshot!.projects.some((project) => project.path === repo), false);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("an already imported repository moves the chat tree automatically before its next queued turn runs in the repository", darwin, async () => {
  const fixture = await setupFixture({ respond: scripted({
    "generated repo write": [write("generated-existing/src/main.ts")],
    "generated pwd": [{ name: "run_command", args: { command: "pwd", timeoutMs: 2000 } }],
  }) });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const repo = await repository(join(fixture.home, "generated-existing"));
    const projectId = (await sdk.projects.add(repo)).id!;
    const id = await chat(sdk, fixture.modelId, "Generated movable chat");
    const side = (await sdk.sessions.spawn(id, "side", "Generated side chat")).id!;
    await send(sdk, id, "generated repo write");
    await send(sdk, id, "generated pwd");
    await waitFor(() => sdk.sessions.get(id)?.projectId === projectId);
    const moved = sdk.sessions.get(id)!, child = sdk.sessions.get(side)!;
    assert.equal(moved.homeRoot, undefined); assert.equal(moved.repositoryProposal, undefined);
    assert.equal(moved.workspaceOrigin, "explicit-checkout"); assert.equal(moved.workspaceId, null);
    assert.equal(child.projectId, projectId); assert.equal(child.homeRoot, undefined); assert.equal(child.parentSessionId, id);
    const bound = fixture.service.controller.events(0).filter((event) => event.event_type === "session.project_bound");
    assert.deepEqual(bound.map((event) => [event.session_id, event.project_id, event.event_type === "session.project_bound" && event.payload.actor]).sort(),
      [[id, projectId, "service"], [side, projectId, "service"]].sort());
    await settled(sdk, id);
    const pwd = fixture.service.controller.events(0).findLast((event) => event.event_type === "tool.completed" && event.session_id === id && event.payload.call.name === "run_command");
    assert.ok(pwd?.event_type === "tool.completed"); assert.equal(pwd.project_id, projectId);
    assert.equal(String(JSON.parse(pwd.payload.text).output).split(/\r?\n/)[0], repo);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("confirmed import adds and binds atomically, and the saved preference imports automatically without asking", darwin, async () => {
  const fixture = await setupFixture({ respond: scripted({
    "generated first write": [write("first-repo/src/main.ts")],
    "generated second write": [write("second-repo/src/main.ts")],
  }) });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const first = await repository(join(fixture.home, "first-repo")), second = await repository(join(fixture.home, "second-repo"));
    const id = await chat(sdk, fixture.modelId, "Generated confirmed import chat");
    await send(sdk, id, "generated first write"); await settled(sdk, id);
    assert.equal(sdk.sessions.get(id)!.repositoryProposal?.status, "pending");
    await assert.rejects(() => sdk.sessions.importRepository(id, second, true), /exact repository/);
    const revision = sdk.sessions.get(id)!.revision;
    const imported = await sdk.sessions.importRepository(id, first, true);
    const project = sdk.getState().snapshot!.projects.find((value) => value.path === first)!;
    assert.equal(imported.id, project.id); assert.equal(imported.revision, revision + 1);
    assert.equal(sdk.sessions.get(id)!.projectId, project.id);
    const events = fixture.service.controller.events(0);
    const added = events.find((event) => event.event_type === "project.added" && event.project_id === project.id)!;
    const bound = events.find((event) => event.event_type === "session.project_bound" && event.session_id === id)!;
    assert.equal(added.seq + 1, bound.seq);
    assert.ok(bound.event_type === "session.project_bound"); assert.equal(bound.payload.actor, "user");
    const current = sdk.settings.get()!;
    await sdk.settings.update({ ...current.values, interactions: { ...current.values.interactions, confirmRepositoryImport: false } }, current.revision);
    const other = await chat(sdk, fixture.modelId, "Generated preference import chat");
    await send(sdk, other, "generated second write");
    await waitFor(() => sdk.sessions.get(other)?.projectId);
    const automatic = sdk.getState().snapshot!.projects.find((value) => value.path === second)!;
    assert.equal(sdk.sessions.get(other)!.projectId, automatic.id);
    const service = fixture.service.controller.events(0).find((event) => event.event_type === "session.project_bound" && event.session_id === other);
    assert.ok(service?.event_type === "session.project_bound"); assert.equal(service.payload.actor, "service");
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("binding rejects an active turn, an unconfirmed Home writer and a child chat without changing anything", async () => {
  const fixture = await setupFixture({ respond: (request) => {
    const messages = request.messages as Record<string, unknown>[];
    return String(messages.findLast((message) => message.role === "user")?.content ?? "").includes("generated hold") ? { hold: true } : { text: "Generated reply." };
  } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const repo = await repository(join(fixture.home, "generated-guarded"));
    const projectId = (await sdk.projects.add(repo)).id!;
    const id = (await sdk.sessions.create(null, "Generated guarded chat", { modelId: fixture.modelId })).id!;
    const side = (await sdk.sessions.spawn(id, "side")).id!, home = sdk.sessions.get(id)!.homeRoot!;
    await assert.rejects(() => sdk.sessions.bindProject(side, projectId), /parent chat/);
    const now = new Date().toISOString(), writer: ChatWriter = { id: "generated-unconfirmed-writer", profileId: sdk.profileId, sessionId: side,
      turnId: "generated-writer-turn", root: home, revision: 0, status: "active", startedAt: now, updatedAt: now, backgroundJobs: [], diagnostic: null };
    fixture.service.store.commit([{ event_type: "chat.writer_recorded", profile_id: sdk.profileId, payload: { writer } },
      { event_type: "chat.writer_recorded", profile_id: sdk.profileId, payload: { writer: { ...writer, revision: 1, status: "unconfirmed", diagnostic: "Generated unknown cleanup." } } }]);
    fixture.service.controller.refreshProfile(); await sdk.refresh();
    const revision = sdk.sessions.get(id)!.revision;
    await assert.rejects(() => sdk.sessions.bindProject(id, projectId), /unconfirmed/);
    assert.equal(sdk.sessions.get(id)!.revision, revision); assert.equal(sdk.sessions.get(side)!.projectId, null);
    const busy = (await sdk.sessions.create(null, "Generated busy chat", { modelId: fixture.modelId })).id!;
    await send(sdk, busy, "generated hold");
    await waitFor(() => sdk.sessions.get(busy)?.turnId);
    await assert.rejects(() => sdk.sessions.bindProject(busy, projectId), /not settled/);
    assert.equal(sdk.sessions.get(busy)!.projectId, null);
    assert.equal(fixture.service.controller.events(0).some((event) => event.event_type === "session.project_bound"), false);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("an explicit move survives restart and project removal forgets the moved chat instead of resurrecting it in Home", async () => {
  const fixture = await setupFixture();
  let sdk = await new MoguriSdk(fixture.service.connection).ready(), service: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    const repo = await repository(join(fixture.home, "generated-removable"));
    const projectId = (await sdk.projects.add(repo)).id!;
    const id = (await sdk.sessions.create(null, "Generated removable chat")).id!;
    await sdk.command({ type: "draft.save", sessionId: id, expectedRevision: 0, text: "Generated retained draft.", attachments: [] });
    await sdk.sessions.bindProject(id, projectId);
    assert.equal(sdk.sessions.get(id)!.projectId, projectId);
    const deleted = (await sdk.sessions.create(null, "Generated deleted moved chat")).id!;
    await sdk.sessions.bindProject(deleted, projectId);
    await sdk.sessions.delete(deleted, true);
    const options = { stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey,
      platform: { terminal: { defaultRoot: fixture.home, vault: fixture.terminalVault } } };
    sdk.disconnect(); await fixture.service.close();
    service = await startService(options); sdk = await new MoguriSdk(service.connection).ready();
    const restored = sdk.sessions.get(id)!;
    assert.equal(restored.projectId, projectId); assert.equal(restored.homeRoot, undefined);
    assert.equal(restored.draft.text, "Generated retained draft.");
    assert.equal(sdk.sessions.get(deleted), undefined);
    assert.equal(service.controller.events(0).some((event) => event.session_id === deleted && event.event_type !== "session.deleted"), false);
    const configuration = (await sdk.projects.configuration(projectId)).configuration;
    await sdk.projects.remove(projectId, true, configuration.revision);
    assert.equal(sdk.sessions.get(id), undefined);
    sdk.disconnect(); await service.close();
    service = await startService(options); sdk = await new MoguriSdk(service.connection).ready();
    assert.equal(sdk.sessions.get(id), undefined);
    assert.equal(service.controller.events(0).some((event) => event.session_id === id), false);
  } finally { sdk.disconnect(); await service?.close(); await fixture.close(); }
});

test("binding events reject roots outside Home, Home itself and projects at a different path", () => {
  const store = new EventStore(":memory:");
  try {
    const home = { root: "/generated/home", device: "1", inode: "2" }, repo = { root: "/generated/home/repo", device: "1", inode: "3" };
    const base = store.commit([
      { event_type: "project.added", profile_id: "default", project_id: "generated-project", payload: { project: { id: "generated-project", name: "repo", path: "/generated/other" } } },
      { event_type: "session.created", profile_id: "default", session_id: "generated-chat", payload: { title: "Generated", homeRoot: home,
        controls: { env: "Local", modelId: null, autonomy: "Manual", budget: { kind: "unlimited" } } } },
    ]);
    const event = (type: StoredEvent["event_type"], payload: unknown, projectId: string | null = null): StoredEvent =>
      ({ ...base[1]!, seq: base[1]!.seq + 1, id: `generated-${type}`, event_type: type, project_id: projectId, payload } as StoredEvent);
    for (const root of [home, { ...home, root: "/generated/elsewhere" }, { ...home, root: "/generated/homework" }]) {
      assert.throws(() => projectEvents([...base, event("session.repository_observed", { root, turnId: "generated-turn" })]), /strictly inside/);
    }
    assert.equal(projectEvents([...base, event("session.repository_observed", { root: repo, turnId: "generated-turn" })]).sessions[0]!.repositoryProposal?.status, "pending");
    assert.throws(() => projectEvents([...base, event("session.repository_dismissed", {})]), /pending repository proposal/);
    assert.throws(() => projectEvents([...base, event("session.project_bound", { projectId: "generated-project", root: repo, actor: "service", previousHomeRoot: home }, "generated-project")]), /exact project-free/);
  } finally { store.close(); }
});

test("schema 104 upgrades to the repository binding marker atomically and refuses premature markers or relabelled history", async (t) => {
  await t.test("upgrade", async () => {
    const fixture = await setupFixture(), path = fixture.service.store.path;
    let reopened: EventStore | undefined;
    try {
      await fixture.service.close();
      const raw = new DatabaseSync(path);
      try {
        removeChatRepositoryBindingFixtureMarker(raw, fixture.service.controller.events(0));
        raw.exec("PRAGMA user_version=104; CREATE TRIGGER generated105_interruption BEFORE INSERT ON retention_metadata WHEN NEW.id='chat_repository_binding_schema' BEGIN SELECT RAISE(ABORT,'Generated atomic105 interruption'); END;");
      } finally { raw.close(); }
      const original = (() => { const db = new DatabaseSync(path); try { return retainedCiphertextRows(db); } finally { db.close(); } })();
      assert.throws(() => new EventStore(path, fixture.retentionKey), /Generated atomic105 interruption/);
      const interrupted = new DatabaseSync(path);
      try {
        assert.equal(interrupted.prepare("PRAGMA user_version").get()?.user_version, 104);
        assert.equal(interrupted.prepare("SELECT value FROM retention_metadata WHERE id='chat_repository_binding_schema'").get(), undefined);
        assert.deepEqual(retainedCiphertextRows(interrupted), original);
        interrupted.exec("DROP TRIGGER generated105_interruption");
      } finally { interrupted.close(); }
      reopened = new EventStore(path, fixture.retentionKey);
      assert.equal(reopened.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
      assert.equal(reopened.db.prepare("SELECT value FROM retention_metadata WHERE id='chat_repository_binding_schema'").get()?.value, "1");
      assert.deepEqual(retainedCiphertextRows(reopened.db), original);
    } finally { reopened?.close(); await fixture.close(); }
  });
  for (const change of ["missing", "premature", "binding-history", "preference-history"] as const) await t.test(change, async () => {
    const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
    try {
      if (change === "binding-history") {
        const projectId = (await sdk.projects.add(await repository(join(fixture.home, "generated-history")))).id!;
        await sdk.sessions.bindProject((await sdk.sessions.create(null, "Generated history chat")).id!, projectId);
      }
      if (change === "preference-history") {
        const current = sdk.settings.get()!;
        await sdk.settings.update({ ...current.values, interactions: { ...current.values.interactions, confirmRepositoryImport: false } }, current.revision);
      }
      sdk.disconnect(); await fixture.service.close();
      const raw = new DatabaseSync(fixture.service.store.path);
      let original;
      try {
        raw.exec(change === "missing" ? "DELETE FROM retention_metadata WHERE id='chat_repository_binding_schema'" :
          change === "premature" ? "PRAGMA user_version=104" : "DELETE FROM retention_metadata WHERE id='chat_repository_binding_schema'; PRAGMA user_version=104");
        original = retainedCiphertextRows(raw);
      } finally { raw.close(); }
      assert.throws(() => new EventStore(fixture.service.store.path, fixture.retentionKey),
        change === "missing" ? /Missing or invalid chat repository binding schema marker/ : change === "premature" ? /Premature chat repository binding/ : /pre-105 lineage/);
      const preserved = new DatabaseSync(fixture.service.store.path);
      try { assert.deepEqual(retainedCiphertextRows(preserved), original); } finally { preserved.close(); }
    } finally { sdk.disconnect(); await fixture.close(); }
  });
});
