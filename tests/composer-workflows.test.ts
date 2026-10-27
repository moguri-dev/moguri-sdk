import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MoguriSdk, slashCommands } from "../packages/sdk/src/index.ts";
import { setupFixture, waitFor } from "./fixture.ts";
import { startService } from "../apps/service/src/server.ts";

test("the complete shared slash catalog lists builtins first and every fresh configured skill last across pages", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const root = join(fixture.directory, "generated-command-skills"); await mkdir(root);
    for (let index = 0; index < 12; index++) {
      const directory = join(root, `skill-${index}`); await mkdir(directory);
      await writeFile(join(directory, "SKILL.md"), `---\nname: generated-command-${index}\ndescription: Generated selectable skill ${index}\n---\nUse generated fixtures only.\n`);
    }
    const settings = sdk.settings.get()!;
    await sdk.settings.update({ ...settings.values, skillSources: [{ id: "generated-commands", name: "Generated commands", kind: "local", path: root, enabled: true }] }, settings.revision);
    const catalog = await sdk.commands.list(fixture.sessionId);
    assert.deepEqual(catalog.slice(0, slashCommands.length).map((entry) => entry.name), slashCommands.map((entry) => entry.name));
    const skills = catalog.filter((entry) => entry.kind === "skill");
    assert.equal(skills.length, 12); assert.ok(catalog.slice(slashCommands.length).every((entry) => entry.kind === "skill"));
    const selected = skills[0]!; assert.equal(selected.kind, "skill");
    if (selected.kind !== "skill") throw new Error("Generated skill missing.");
    await sdk.skills.use(fixture.sessionId, selected.skill.id, selected.skill.digest, fixture.session().draft.revision, "Generated remaining task.");
    assert.match(fixture.session().draft.text, /Generated remaining task.*user-selected-skill/s);
    assert.equal(fixture.service.controller.events(0).filter((event) => event.event_type === "skill.used").length, 1);
    assert.equal(fixture.requests.length, 0);
    assert.deepEqual(sdk.settings.get()!.values.permissions.tools, []);
    const saved = fixture.session().draft.text;
    await writeFile(join(root, "skill-0", "SKILL.md"), "---\nname: generated-command-0\ndescription: Generated changed source\n---\nChanged unreviewed content.\n");
    const old = skills.find((entry) => entry.kind === "skill" && entry.name === "generated-command-0")!;
    if (old.kind !== "skill") throw new Error("Generated source missing.");
    await assert.rejects(() => sdk.skills.use(fixture.sessionId, old.skill.id, old.skill.digest, fixture.session().draft.revision, ""), /changed|fresh digest/i);
    assert.equal(fixture.session().draft.text, saved);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("side admission rolls back creation, queued prompt and main consumption together, then a lost receipt cannot replay after restart", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture({ responseMode: "text" }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  let restarted: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    await fixture.configure();
    await sdk.command({ type: "draft.save", sessionId: fixture.sessionId, expectedRevision: 0, text: "/side Generated retained atomic side request.", attachments: [] });
    const command = { type: "session.side.prompt" as const, sessionId: fixture.sessionId, prompt: "Generated retained atomic side request.", expectedDraftRevision: 1 };
    const id = "generated-atomic-side-command";
    fixture.service.store.db.exec(`CREATE TRIGGER generated_side_queue_failure BEFORE INSERT ON events WHEN json_extract(NEW.data,'$.event_type')='queue.enqueued'
      BEGIN SELECT RAISE(ABORT,'Generated side queue interruption'); END;`);
    await assert.rejects(() => sdk.command(command, id), /queue interruption|failed/i);
    assert.equal(fixture.service.controller.snapshot().sessions.length, 1);
    assert.equal(fixture.session().draft.text, "/side Generated retained atomic side request.");
    assert.equal(fixture.requests.length, 0);
    fixture.service.store.db.exec("DROP TRIGGER generated_side_queue_failure");
    const side = await sdk.command(command, id);
    await waitFor(() => fixture.service.controller.snapshot().sessions.find((entry) => entry.id === side.id)?.status === "completed");
    sdk.disconnect(); await fixture.service.close();
    restarted = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey });
    restarted.store.db.prepare("DELETE FROM receipts WHERE id=?").run(id);
    const reopened = await new MoguriSdk(restarted.connection).ready();
    try { assert.equal((await reopened.command(command, id)).id, side.id); assert.equal(fixture.requests.length, 1); }
    finally { reopened.disconnect(); }
  } finally { sdk.disconnect(); await restarted?.close(); await fixture.close(); }
});

test("side prompt admission preserves an existing side draft, consumes only the exact main slash draft and never runs the main model", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture({ responseMode: "text" }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.configure();
    const side = await sdk.sessions.side(fixture.sessionId);
    await sdk.command({ type: "draft.save", sessionId: side.id!, expectedRevision: 0, text: "Generated side draft stays here.", attachments: [] });
    await sdk.command({ type: "draft.save", sessionId: fixture.sessionId, expectedRevision: fixture.session().draft.revision, text: "/side Generated actual routed question.", attachments: [] });
    const revision = fixture.session().draft.revision;
    await sdk.sessions.askSide(fixture.sessionId, "Generated actual routed question.", revision);
    await waitFor(() => fixture.service.controller.snapshot().sessions.find((entry) => entry.id === side.id)?.status === "completed");
    const saved = fixture.service.controller.snapshot().sessions.find((entry) => entry.id === side.id)!;
    assert.equal(saved.draft.text, "Generated side draft stays here.");
    assert.equal(saved.messages.find((entry) => entry.role === "user")?.text, "Generated actual routed question.");
    assert.equal(saved.mode, "read-only"); assert.equal(fixture.session().messages.length, 0);
    assert.equal(fixture.session().draft.text, ""); assert.equal(fixture.requests.length, 1);
    await assert.rejects(() => sdk.sessions.askSide(fixture.sessionId, "Generated actual routed question.", revision), /revision|changed this data|draft changed/i);
    assert.equal(fixture.requests.length, 1);
  } finally { sdk.disconnect(); await fixture.close(); }
});
