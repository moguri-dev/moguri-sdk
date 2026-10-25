import test from "node:test";
import assert from "node:assert/strict";
import { MoguriSdk, resolveControls } from "../packages/sdk/src/index.ts";
import { setupFixture } from "./fixture.ts";
import { startService } from "../apps/service/src/server.ts";
import { join } from "node:path";
import { profileFixture } from "./fixtures/profiles.ts";
import { initializeGeneratedRepository } from "./fixtures/git-project.ts";

test("last explicit model/effort is a fallback, while explicit defaults and non-model controls retain precedence", () => {
  const recent = { modelId: "generated-model", thinkingEffort: "high" as const };
  const revisions = { settingsRevision: 0, projectRevision: null };
  const inherited = resolveControls([], revisions, recent);
  assert.equal(inherited.controls.modelId, recent.modelId);
  assert.deepEqual(inherited.controls.modelOptions, { thinkingEffort: "high" });
  assert.equal(inherited.defaults.sources.modelId, "last-used");
  assert.equal(inherited.controls.env, "Local"); assert.equal(inherited.controls.autonomy, "Manual");
  assert.deepEqual(inherited.controls.budget, { kind: "unlimited" });
  const fixed = resolveControls([{ source: "global", values: { modelId: "generated-fixed" } }], revisions, recent);
  assert.equal(fixed.controls.modelId, "generated-fixed"); assert.equal(fixed.controls.modelOptions, undefined);
  const cleared = resolveControls([{ source: "session", values: { modelId: null } }], revisions, recent);
  assert.equal(cleared.controls.modelId, null); assert.equal(cleared.controls.modelOptions, undefined);
});

test("new independent sessions remember the selected model and effort, not its working window or unsent draft", async () => {
  const fixture = await setupFixture({ reasoning: true, contextWindow: 32768 }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await sdk.sessions.configure(fixture.sessionId, { ...fixture.session().controls, modelId: fixture.modelId, modelOptions: { thinkingEffort: "high", contextWindow: 16384 } });
    await sdk.command({ type: "draft.save", sessionId: fixture.sessionId, expectedRevision: fixture.session().draft.revision, text: "Generated unsent source draft.", attachments: [] });
    const created = await sdk.sessions.create(null, "Generated remembered choice");
    const session = sdk.getState().snapshot!.sessions.find((entry) => entry.id === created.id)!;
    assert.equal(session.controls.modelId, fixture.modelId);
    assert.deepEqual(session.controls.modelOptions, { thinkingEffort: "high" });
    assert.equal(session.defaults?.sources.modelId, "last-used");
    assert.equal(session.projectId, null); assert.equal(session.draft.text, "");
    assert.equal(fixture.session().draft.text, "Generated unsent source draft.");
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("a fixed shared-global model/effort wins, and removing it restores the last explicit selection without rewriting existing sessions", async () => {
  const fixture = await setupFixture({ reasoning: true }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await sdk.sessions.configure(fixture.sessionId, { ...fixture.session().controls, modelId: fixture.modelId, modelOptions: { thinkingEffort: "high" } });
    await sdk.profiles.defaults({ modelId: fixture.modelId, modelOptions: { thinkingEffort: "low" } }, (await sdk.profiles.list()).catalog.globalDefaults.revision);
    const fixed = await sdk.sessions.create(null, "Generated fixed default");
    const current = (id: string) => sdk.getState().snapshot!.sessions.find((entry) => entry.id === id)!;
    assert.deepEqual(current(fixed.id!).controls.modelOptions, { thinkingEffort: "low" });
    assert.equal(current(fixed.id!).defaults?.sources.modelId, "global");
    assert.deepEqual(fixture.session().controls.modelOptions, { thinkingEffort: "high" });
    await sdk.profiles.defaults({}, (await sdk.profiles.list()).catalog.globalDefaults.revision);
    const remembered = await sdk.sessions.create(null, "Generated fallback default");
    assert.equal(current(remembered.id!).controls.modelId, fixture.modelId);
    assert.deepEqual(current(remembered.id!).controls.modelOptions, { thinkingEffort: "high" });
    assert.deepEqual(current(fixed.id!).controls.modelOptions, { thinkingEffort: "low" });
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("an explicit no-model session override cannot resurrect a remembered selection", async () => {
  const fixture = await setupFixture({ reasoning: true }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await sdk.sessions.configure(fixture.sessionId, { ...fixture.session().controls, modelId: fixture.modelId, modelOptions: { thinkingEffort: "high" } });
    const created = await sdk.sessions.create(null, "Generated explicit no-model chat", { modelId: null });
    const session = sdk.getState().snapshot!.sessions.find((entry) => entry.id === created.id)!;
    assert.equal(session.controls.modelId, null); assert.equal(session.controls.modelOptions, undefined);
    assert.equal(session.defaults?.sources.modelId, "session"); assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("tuning an unselected session cannot erase the last model choice; only an explicit model clear does", async () => {
  const fixture = await setupFixture({ reasoning: true }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await sdk.sessions.configure(fixture.sessionId, { ...fixture.session().controls, modelId: fixture.modelId, modelOptions: { thinkingEffort: "high" } });
    const current = await sdk.sessions.create(null, "Generated unselected tuning reset", { modelId: null });
    await assert.rejects(() => sdk.sessions.modelOptions(current.id!, {}, undefined, true), /Choose an available model/);
    await sdk.slash(current.id!, "/model-settings reset", "tui");
    assert.deepEqual(sdk.getState().snapshot!.lastModelSelection, { modelId: fixture.modelId, thinkingEffort: "high" });
    await sdk.sessions.selectModel(current.id!, null);
    assert.equal(sdk.getState().snapshot!.lastModelSelection, null); assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("only explicit model/effort selections are remembered; inheritance, window/autonomy changes and ordinary configuration do not count", async () => {
  const fixture = await setupFixture({ reasoning: true, contextWindow: 32768 }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await sdk.sessions.configure(fixture.sessionId, { ...fixture.session().controls, modelId: fixture.modelId, modelOptions: { thinkingEffort: "high" } });
    const other = await sdk.sessions.create(null, "Generated other selection", { modelId: fixture.modelId, modelOptions: { thinkingEffort: "low" } });
    assert.deepEqual(sdk.getState().snapshot!.lastModelSelection, { modelId: fixture.modelId, thinkingEffort: "high" });
    await sdk.sessions.modelOptions(other.id!, { thinkingEffort: "low" }, undefined, true);
    await sdk.sessions.modelOptions(fixture.sessionId, { thinkingEffort: "high", contextWindow: 16384 });
    await sdk.sessions.configure(fixture.sessionId, { ...fixture.session().controls, autonomy: "Guided" });
    assert.deepEqual(sdk.getState().snapshot!.lastModelSelection, { modelId: fixture.modelId, thinkingEffort: "low" });
    await sdk.sessions.selectModel(fixture.sessionId, fixture.modelId);
    assert.deepEqual(sdk.getState().snapshot!.lastModelSelection, { modelId: fixture.modelId });
    await sdk.sessions.selectModel(fixture.sessionId, null);
    assert.equal(sdk.getState().snapshot!.lastModelSelection, null);
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("failed, stale or interrupted selection persistence cannot partially remember a model", async () => {
  const fixture = await setupFixture({ reasoning: true }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await assert.rejects(() => sdk.sessions.selectModel(fixture.sessionId, "generated-unavailable-model"), /available model|not.*available/i);
    assert.equal(sdk.getState().snapshot!.lastModelSelection, null);
    await assert.rejects(() => sdk.sessions.configure(fixture.sessionId, { ...fixture.session().controls, modelId: fixture.modelId }, 999), /changed|revision/i);
    const before = fixture.service.controller.events(0).length;
    fixture.service.store.db.exec("CREATE TRIGGER generated_model_preference_failure BEFORE INSERT ON events WHEN json_extract(NEW.data,'$.event_type')='model.selection_remembered' BEGIN SELECT RAISE(ABORT,'Generated model preference append failure'); END");
    try {
      await assert.rejects(() => sdk.sessions.selectModel(fixture.sessionId, fixture.modelId), /no success was recorded/);
      assert.equal(fixture.service.controller.events(0).length, before);
      assert.equal(fixture.session().controls.modelId, null); assert.equal(sdk.getState().snapshot!.lastModelSelection, null);
    } finally { fixture.service.store.db.exec("DROP TRIGGER generated_model_preference_failure"); }
    await sdk.sessions.selectModel(fixture.sessionId, fixture.modelId);
    assert.deepEqual(sdk.getState().snapshot!.lastModelSelection, { modelId: fixture.modelId });
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});

for (const removal of ["session", "project"] as const) test(`remembered model/effort survives source ${removal} deletion and an actual service restart without another selection or model call`, async () => {
  const fixture = await setupFixture({ reasoning: true }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  let restarted: Awaited<ReturnType<typeof startService>> | undefined, peer: MoguriSdk | undefined;
  try {
    await sdk.sessions.configure(fixture.sessionId, { ...fixture.session().controls, modelId: fixture.modelId, modelOptions: { thinkingEffort: "high" } });
    const remembered = fixture.service.controller.events(0).find((event) => event.event_type === "model.selection_remembered")!;
    assert.equal(remembered.session_id, null); assert.equal(remembered.project_id, null);
    if (removal === "session") await sdk.sessions.delete(fixture.sessionId, true);
    else {
      const configuration = fixture.service.controller.platform.sessions.projects.configuration(fixture.session().projectId);
      await sdk.projects.remove(fixture.session().projectId, true, configuration.revision);
    }
    sdk.disconnect(); await fixture.service.close();
    restarted = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey });
    peer = await new MoguriSdk(restarted.connection).ready();
    assert.deepEqual(peer.getState().snapshot!.lastModelSelection, { modelId: fixture.modelId, thinkingEffort: "high" });
    const created = await peer.sessions.create(null, "Generated recovered preference");
    const session = peer.getState().snapshot!.sessions.find((entry) => entry.id === created.id)!;
    assert.equal(session.controls.modelId, fixture.modelId); assert.deepEqual(session.controls.modelOptions, { thinkingEffort: "high" });
    assert.equal(fixture.requests.length, 0);
  } finally { peer?.disconnect(); sdk.disconnect(); await restarted?.close(); await fixture.close(); }
});

test("work-item, worktree and unparented settings-chat creation share defaults while explicit parent inheritance remains unchanged", async () => {
  const fixture = await setupFixture({ reasoning: true }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    initializeGeneratedRepository(fixture.project);
    await sdk.sessions.configure(fixture.sessionId, { ...fixture.session().controls, modelId: fixture.modelId, modelOptions: { thinkingEffort: "high" } });
    const issue = await sdk.issues.create(fixture.session().projectId, { title: "Generated default work item", body: "Generated local ticket context.", kind: "misc", phaseId: "backlog", pullRequestUrl: null });
    const work = await sdk.sessions.fromWork(fixture.session().projectId, { issueId: issue.id! });
    const meta = await sdk.metachat.create(null), current = (id: string) => sdk.getState().snapshot!.sessions.find((entry) => entry.id === id)!;
    for (const id of [work.id!, meta.id!]) {
      assert.equal(current(id).controls.modelId, fixture.modelId); assert.deepEqual(current(id).controls.modelOptions, { thinkingEffort: "high" });
      assert.equal(current(id).defaults?.sources.modelId, "last-used");
    }
    await sdk.profiles.defaults({ modelId: fixture.modelId, modelOptions: { thinkingEffort: "low" } }, (await sdk.profiles.list()).catalog.globalDefaults.revision);
    const workspace = await sdk.workspaces.wait((await sdk.workspaces.create(fixture.session().projectId, "moguri/generated-model-default")).id!);
    const bound = await sdk.sessions.create(fixture.session().projectId, "Generated default worktree chat", undefined, workspace.id);
    assert.equal(current(bound.id!).workspaceId, workspace.id); assert.deepEqual(current(bound.id!).controls.modelOptions, { thinkingEffort: "low" });
    const side = await sdk.sessions.spawn(fixture.sessionId, "side");
    assert.deepEqual(current(side.id!).controls.modelOptions, { thinkingEffort: "high" }); assert.equal(current(side.id!).mode, "read-only");
    assert.deepEqual(sdk.getState().snapshot!.lastModelSelection, { modelId: fixture.modelId, thinkingEffort: "high" });
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("last explicit selection stays profile-private while a fixed global default remains shared", async () => {
  const fixture = await profileFixture();
  try {
    const own = await fixture.sdk.sessions.create(null, "Generated Default model owner");
    await fixture.sdk.sessions.selectModel(own.id!, fixture.providers[0]!.modelId);
    const { client: beta } = await fixture.create("Generated model Beta");
    assert.equal(beta.getState().snapshot!.lastModelSelection, null);
    const empty = await beta.sessions.create(null, "Generated Beta no remembered model");
    assert.equal(fixture.session(beta, empty.id!).controls.modelId, null);
    const selected = await beta.sessions.create(null, "Generated Beta explicit model");
    await beta.sessions.selectModel(selected.id!, fixture.providers[1]!.modelId);
    const ownEvents = fixture.service.controller.events(0).filter((event) => event.event_type === "model.selection_remembered");
    assert.equal(ownEvents.length, 1); assert.equal(ownEvents[0]?.profile_id, "default");
    await fixture.sdk.profiles.defaults({ modelId: fixture.providers[0]!.modelId }, (await fixture.sdk.profiles.list()).catalog.globalDefaults.revision);
    const fixed = await beta.sessions.create(null, "Generated Beta shared fixed default");
    assert.equal(fixture.session(beta, fixed.id!).defaults?.sources.modelId, "global");
    assert.equal(fixture.session(beta, fixed.id!).controls.modelId, fixture.providers[0]!.modelId);
    assert.ok(fixture.providers.every((provider) => provider.requests.length === 0));
  } finally { await fixture.close(); }
});

test("an unavailable saved default remains selected and fails admission instead of choosing another model or losing the draft", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await sdk.profiles.defaults({ modelId: "generated-unavailable-fixed-model" }, (await sdk.profiles.list()).catalog.globalDefaults.revision);
    const created = await sdk.sessions.create(null, "Generated unavailable default"), current = () => sdk.getState().snapshot!.sessions.find((entry) => entry.id === created.id)!;
    assert.equal(current().controls.modelId, "generated-unavailable-fixed-model");
    await sdk.command({ type: "draft.save", sessionId: current().id, expectedRevision: current().draft.revision, text: "Generated unavailable-model draft stays intact.", attachments: [] });
    await assert.rejects(() => sdk.command({ type: "message.send", sessionId: current().id, expectedRevision: current().draft.revision, delivery: "queue" }), /available model|not.*available/i);
    assert.equal(current().draft.text, "Generated unavailable-model draft stays intact.");
    assert.equal(current().controls.modelId, "generated-unavailable-fixed-model"); assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});
