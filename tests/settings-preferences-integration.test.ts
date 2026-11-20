import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { MoguriSdk, PROTOCOL_VERSION, type UserSettings } from "../packages/sdk/src/index.ts";
import { startService } from "../apps/service/src/server.ts";
import { EventStore } from "../apps/service/src/store.ts";
import { setupFixture } from "./fixture.ts";
import { writeLegacyState } from "./fixtures/legacy-state.ts";

test("a failed schema-45 marker rolls back without rewriting retained events or accepting a partial upgrade", async () => {
  const fixture = await setupFixture();
  try {
    await writeLegacyState(fixture.service, 44);
    const path = fixture.service.store.path, before = new DatabaseSync(path);
    const rows = before.prepare("SELECT seq,data,payload FROM events ORDER BY seq").all();
    before.exec("CREATE TRIGGER generated_preferences_failure BEFORE INSERT ON retention_metadata WHEN NEW.id='settings_preferences_schema' BEGIN SELECT RAISE(ABORT,'generated migration failure'); END");
    before.close();
    assert.throws(() => new EventStore(path, fixture.retentionKey), /generated migration failure/);
    const inspect = new DatabaseSync(path);
    assert.equal(inspect.prepare("PRAGMA user_version").get()?.user_version, 44);
    assert.deepEqual(inspect.prepare("SELECT seq,data,payload FROM events ORDER BY seq").all(), rows);
    assert.equal(inspect.prepare("SELECT id FROM retention_metadata WHERE id='settings_preferences_schema'").get(), undefined);
    inspect.exec("DROP TRIGGER generated_preferences_failure"); inspect.close();
    const restored = new EventStore(path, fixture.retentionKey);
    try { assert.equal(restored.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION); }
    finally { restored.close(); }
  } finally { await fixture.close(); }
});

test("schema-44 upgrade preserves original ciphertext, grants, receipts, preferences and hard policy", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  let restarted: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    const settings: UserSettings = structuredClone(sdk.settings.get()!.values);
    settings.appearance = { theme: "light" };
    settings.permissions = { tools: [], commands: [] };
    settings.voice = { language: "it-IT", backend: "cpu" };
    settings.notifications = { inApp: true, os: false, previewContent: false };
    settings.retention = { deleteArchived: false, afterDays: 91 };
    delete settings.guidance; delete settings.shortcuts; delete settings.lifecycle;
    await sdk.settings.update(settings, sdk.settings.get()!.revision);
    await sdk.budgets.policy({ basis: "estimate", tokens: 500 }, 0, true);
    const artifact = await sdk.artifacts.create(fixture.sessionId, { kind: "decision", name: "Generated migration document", text: "Generated independent encrypted document." });
    await sdk.command({ type: "draft.save", sessionId: fixture.sessionId, expectedRevision: fixture.session().draft.revision, text: "Generated migration draft.", attachments: [] }, "generated-preferences-receipt");
    const rows = fixture.service.store.db.prepare("SELECT seq,data,payload FROM events ORDER BY seq").all();
    sdk.disconnect(); await writeLegacyState(fixture.service, 44);
    restarted = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey });
    const client = await new MoguriSdk(restarted.connection).ready();
    try {
      assert.equal(restarted.store.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
      assert.deepEqual(restarted.store.db.prepare("SELECT seq,data,payload FROM events ORDER BY seq LIMIT ?").all(rows.length), rows);
      const state = client.getState().snapshot!;
      assert.equal(state.settings.values.appearance.theme, "light");
      assert.equal(state.settings.values.appearance.palette, "moguri");
      assert.equal(state.settings.values.retention.afterDays, 91);
      assert.equal(state.settings.values.retention.archiveCompleted, false);
      assert.equal(state.settings.values.voice.inputDeviceId, "default");
      assert.equal(state.settings.values.permissions.defaultDecision, "ask");
      assert.equal(state.budgetPolicy.limit?.tokens, 500);
      assert.equal(state.sessions[0]?.draft.text, "Generated migration draft.");
      assert.equal((await client.artifacts.read(artifact.id!)).text, "Generated independent encrypted document.");
      assert.ok(restarted.store.db.prepare("SELECT id FROM receipts WHERE id=?").get("generated-preferences-receipt"));
      assert.equal(fixture.requests.length, 0);
    } finally { client.disconnect(); }
  } finally { sdk.disconnect(); await restarted?.close(); await fixture.close(); }
});

test("global and project templates enter the actual SDK prompt with explicit override and verbosity provenance", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    assert.doesNotMatch((await sdk.prompt.preview(fixture.sessionId)).effective, /<user-name>/);
    const settings = sdk.settings.get()!;
    await sdk.settings.update({ ...settings.values,
      guidance: { documentation: "Generated inherited documentation.", responseStyle: "Generated user-facing style." },
      startup: { ...settings.values.startup, profile: { verbosity: "minimal" } }, user: { name: "Generated User" },
    }, settings.revision);
    const configuration = (await sdk.projects.configuration(fixture.session().projectId)).configuration;
    await sdk.projects.configure(configuration.projectId, { ...configuration.values, guidance: { documentation: "Generated project documentation." } }, configuration.revision);
    const projectPrompt = (await sdk.prompt.preview(fixture.sessionId)).effective;
    assert.match(projectPrompt, /Generated project documentation/);
    assert.doesNotMatch(projectPrompt, /Generated inherited documentation/);
    assert.match(projectPrompt, /Generated user-facing style/);
    assert.match(projectPrompt, /moguri-execution-contract/);
    assert.match(projectPrompt, /<user-name>\nThe user asked to be addressed as "Generated User"/);
    const chat = await sdk.sessions.create(null, "Generated preferences chat");
    const created = sdk.getState().snapshot!.sessions.find((session) => session.id === chat.id)!;
    assert.equal(created.controls.verbosity, "minimal");
    assert.equal(created.defaults?.sources.verbosity, "profile");
    const chatPrompt = (await sdk.prompt.preview(created.id)).effective;
    assert.match(chatPrompt, /Generated inherited documentation/);
    assert.doesNotMatch(chatPrompt, /Generated project documentation/);
    assert.match(chatPrompt, /<response-verbosity>/);
    const current = (await sdk.projects.configuration(configuration.projectId)).configuration;
    await sdk.projects.configure(current.projectId, { ...current.values, guidance: { documentation: "" } }, current.revision);
    assert.doesNotMatch((await sdk.prompt.preview(fixture.sessionId)).effective, /Generated inherited documentation|Generated project documentation/);
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("automatic archive and delete use distinct canonical seven-day ages and retain independent content", { skip: process.platform !== "darwin" }, async (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-01-01T00:00:00.000Z") });
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.configure(); await fixture.send("Generated completion for explicit retention."); await fixture.terminal();
    const artifact = await sdk.artifacts.create(fixture.sessionId, { kind: "decision", name: "Generated independent retention", text: "Generated survives session retention." });
    const settings = sdk.settings.get()!;
    await sdk.settings.update({ ...settings.values, retention: { archiveCompleted: true, archiveAfterDays: 7, deleteArchived: true, afterDays: 7 } }, settings.revision);
    context.mock.timers.tick(7 * 86_400_000 - 1);
    assert.deepEqual(await fixture.service.controller.platform.sessions.retention(), { archived: 0, deleted: 0 });
    context.mock.timers.tick(1);
    assert.deepEqual(await fixture.service.controller.platform.sessions.retention(), { archived: 1, deleted: 0 });
    assert.equal(fixture.session().status, "archived");
    assert.equal(fixture.session().archivedAt, "2026-01-08T00:00:00.000Z");
    assert.deepEqual(await fixture.service.controller.platform.sessions.retention(), { archived: 0, deleted: 0 });
    context.mock.timers.tick(7 * 86_400_000 - 1);
    assert.equal((await fixture.service.controller.platform.sessions.retention()).deleted, 0);
    context.mock.timers.tick(1);
    assert.equal((await fixture.service.controller.platform.sessions.retention()).deleted, 1);
    await sdk.refresh();
    assert.equal(sdk.getState().snapshot!.sessions.length, 0);
    assert.equal((await sdk.artifacts.read(artifact.id!)).text, "Generated survives session retention.");
    assert.equal(sdk.getState().snapshot!.budgetEntries.length, 1);
  } finally { sdk.disconnect(); await fixture.close(); context.mock.timers.reset(); }
});
