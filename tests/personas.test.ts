import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  personaMentions, personaPresets, personaTask, projectPersona, projectPersonaRun, stricterBudget, validatePersonaDefinition,
  type Persona, type PersonaRun, type Snapshot, type StoredEvent,
} from "../packages/protocol/src/index.ts";
import { MoguriSdk, personasSlash, personasSummary } from "../packages/sdk/src/index.ts";
import { PersonaRuntime } from "../apps/service/src/personas.ts";
import { DependencyRoundupRuntime } from "../apps/service/src/dependency-roundups.ts";
import { EventStore, personasSchemaMarker, dependencyRoundupsSchemaMarker } from "../apps/service/src/store.ts";
import { startService } from "../apps/service/src/server.ts";
import { setupFixture, waitFor } from "./fixture.ts";
import { GeneratedIntakeClock } from "./fixtures/intake-clock.ts";

const at = "2030-01-01T10:00:00.000Z";
const persona = (changes: Partial<Persona> = {}): Persona => ({ version: 1, id: "generated-persona", revision: 1, profileId: "default", preset: "docs",
  ...personaPresets.docs, status: "enabled", commandId: "generated-command", commandDigest: "a".repeat(64), createdAt: at, updatedAt: at, ...changes });
const run = (changes: Partial<PersonaRun> = {}): PersonaRun => ({ version: 1, id: "generated-run", revision: 0, profileId: "default", personaId: "generated-persona",
  personaRevision: 1, handle: "docs", name: "Docs", trigger: "mention", source: { sessionId: "generated-parent", turnId: "generated-turn", itemId: "generated-item", actor: "user", automationRunId: null },
  projectId: "generated-project", childSessionId: null, childItemId: null, childTurnId: null, stopRequested: null, controls: null, deadlineAt: null,
  status: "starting", createdAt: at, updatedAt: at, diagnostic: null, ...changes });

test("mentions are explicit @handles outside code, never emails, paths or files", () => {
  assert.deepEqual(personaMentions("@Docs and @product-manager, please. Also @docs again."), ["docs", "product-manager"]);
  assert.deepEqual(personaMentions("Mail someone@docs.example or see a/@docs and `@docs` or\n```\n@maintenance\n```"), []);
  assert.deepEqual(personaMentions("Open @README.md, then ask @docs."), ["docs"]);
  assert.deepEqual(personaMentions("(@incident-commander) @sre: help"), ["incident-commander", "sre"]);
});

test("definitions validate, start disabled, keep unique reserved-free handles and only tighten budgets", () => {
  assert.throws(() => validatePersonaDefinition({ ...personaPresets.docs, handle: "all" }), /reserved/);
  assert.throws(() => validatePersonaDefinition({ ...personaPresets.docs, handle: "Docs" }), /handle|instructions/);
  assert.throws(() => validatePersonaDefinition({ ...personaPresets.docs, budget: { kind: "limited" } }), /token or USD/);
  assert.throws(() => validatePersonaDefinition({ ...personaPresets.docs, budget: { kind: "limited", tokens: 10 } }), /estimate-based accounting/);
  assert.throws(() => projectPersona(undefined, { ...persona(), revision: 0 }), /persona/i, "a persona is created disabled");
  assert.deepEqual(projectPersona(undefined, persona({ revision: 0, status: "disabled" })).status, "disabled");
  assert.throws(() => projectPersona(persona({ revision: 0, status: "disabled" }), persona({ preset: null })), /persona/i);
  assert.deepEqual(stricterBudget({ kind: "unlimited" }, { kind: "limited", tokens: 500 }), { kind: "limited", tokens: 500 });
  assert.deepEqual(stricterBudget({ kind: "limited", tokens: 100, usd: 2 }, { kind: "limited", tokens: 500, usd: 1 }), { kind: "limited", tokens: 100, usd: 1 });
  assert.deepEqual(stricterBudget({ kind: "limited", usd: 2 }, null), { kind: "limited", usd: 2 });
  const task = personaTask(personaPresets["product-manager"], { title: "Generated launch", text: "@product-manager scope a new product", actor: "user" });
  assert.match(task, /You are @product-manager \(Product Manager\)/); assert.match(task, /read-only here/); assert.match(task, /grants no permission/);
  assert.match(task, /installing analytics/i); assert.ok(task.endsWith("@product-manager scope a new product"));
});

test("persona runs bind the exact child task and turn, settle from actual outcomes and never re-dispatch a turn", () => {
  const started = run({ revision: 1, status: "running", childSessionId: "generated-child", childItemId: "generated-task", controls: { env: "Local", modelId: "generated", autonomy: "Manual", budget: { kind: "unlimited" } },
    deadlineAt: "2030-01-01T11:00:00.000Z" });
  assert.deepEqual(projectPersonaRun(run(), started), started);
  assert.throws(() => projectPersonaRun(undefined, started), /persona/i, "runs begin as starting");
  assert.throws(() => projectPersonaRun(started, { ...started, revision: 2, childItemId: "generated-other" }), /persona/i);
  assert.throws(() => projectPersonaRun(started, { ...started, revision: 2, status: "completed", childSessionId: "generated-other" }), /persona/i);
  assert.throws(() => projectPersonaRun(undefined, run({ trigger: "automation" })), /persona/i, "automation trigger keeps automation provenance");
  let snapshot = { profileId: "default", personas: [persona()], personaRuns: [] as PersonaRun[], sessions: [{ id: "generated-parent", kind: "agent", projectId: "generated-project" }], modelFailures: [],
    automationRuns: [{ id: "generated-automation-run", steps: [{ kind: "prompt", text: "Generated saved step." }] }] } as unknown as Snapshot;
  const runtime = new PersonaRuntime({ snapshot: () => snapshot, commit: () => {}, finish: () => { throw new Error("unused"); }, now: () => Date.parse(at),
    sourceText: () => null, validate: () => {}, controls: (parent) => parent.controls, spawn: () => ({}), notice: () => [], stop: () => {}, closing: () => false });
  const event = (event_type: string, payload: unknown, extra: Record<string, unknown> = {}) =>
    ({ event_type, payload, profile_id: "default", timestamp: at, schema_version: 1, id: `${event_type}-${Math.random()}`, seq: 1, ...extra }) as unknown as StoredEvent;
  const item = { id: "generated-item", text: "@docs and @unknown please", attachments: [], delivery: "queue" };
  const tagged = runtime.derived(snapshot, [event("turn.started", { item }, { session_id: "generated-parent", turn_id: "generated-turn" })]);
  assert.equal(tagged.length, 1);
  const created = (tagged[0]!.payload as { run: PersonaRun }).run;
  assert.equal(created.status, "starting"); assert.equal(created.source.actor, "user"); assert.equal(created.trigger, "mention");
  snapshot = { ...snapshot, personaRuns: [created] } as Snapshot;
  assert.equal(runtime.derived(snapshot, [event("turn.started", { item }, { session_id: "generated-parent", turn_id: "generated-turn" })]).length, 0, "one turn dispatches each persona once");
  const automation = runtime.derived(snapshot, [event("turn.started", { item: { ...item, id: "generated-step", automation: { automationId: "generated-automation", runId: "generated-automation-run", step: 0 } } },
    { session_id: "generated-parent", turn_id: "generated-automation-turn" })]);
  assert.deepEqual((automation[0]!.payload as { run: PersonaRun }).run.source, { sessionId: "generated-parent", turnId: "generated-automation-turn", itemId: "generated-step", actor: "automation", automationRunId: "generated-automation-run" });
  assert.equal(runtime.derived(snapshot, [event("turn.started", { item: { ...item, origin: { messageId: "m", fromSessionId: "x", fromTurnId: null, origin: { actor: "user" } } } },
    { session_id: "generated-parent", turn_id: "generated-delegated" })]).length, 0, "a delegated task never dispatches personas");
  snapshot = { ...snapshot, personas: [persona({ status: "paused" })], personaRuns: [] } as unknown as Snapshot;
  assert.equal(runtime.derived(snapshot, [event("turn.started", { item }, { session_id: "generated-parent", turn_id: "generated-paused" })]).length, 0, "paused personas ignore mentions");
  snapshot = { ...snapshot, personas: [persona({ projectId: "generated-other-project" })] } as unknown as Snapshot;
  assert.equal(runtime.derived(snapshot, [event("turn.started", { item }, { session_id: "generated-parent", turn_id: "generated-scope" })]).length, 0, "out-of-scope personas ignore mentions");
  snapshot = { ...snapshot, personas: [persona()], personaRuns: [started] } as unknown as Snapshot;
  const bound = runtime.derived(snapshot, [event("turn.started", { item: { id: "generated-task", text: "task", attachments: [], delivery: "queue" } }, { session_id: "generated-child", turn_id: "generated-child-turn" })]);
  const running = (bound[0]!.payload as { run: PersonaRun }).run;
  assert.equal(running.childTurnId, "generated-child-turn");
  snapshot = { ...snapshot, personaRuns: [running], modelFailures: [{ id: "generated-failure", status: "retrying" }] } as unknown as Snapshot;
  assert.equal(runtime.derived(snapshot, [event("turn.finished", { outcome: "failed", modelFailureId: "generated-failure" }, { session_id: "generated-child", turn_id: "generated-child-turn" })]).length, 0,
    "a turn the existing model recovery retries keeps the run running");
  const stopping = { ...running, revision: running.revision + 1, stopRequested: "user" as const };
  snapshot = { ...snapshot, personaRuns: [stopping] } as unknown as Snapshot;
  const partial = (runtime.derived(snapshot, [event("turn.finished", { outcome: "partial" }, { session_id: "generated-child", turn_id: "generated-child-turn" })])[0]!.payload as { run: PersonaRun }).run;
  assert.equal(partial.status, "partial", "a requested stop whose cleanup is unconfirmed stays partial");
  assert.match(partial.diagnostic!, /by the user/);
  snapshot = { ...snapshot, personaRuns: [started] } as unknown as Snapshot;
  const removed = (runtime.derived(snapshot, [event("queue.removed", { messageId: "generated-task" }, { session_id: "generated-child" })])[0]!.payload as { run: PersonaRun }).run;
  assert.equal(removed.status, "stopped");
  const held = runtime.derived(snapshot, [event("queue.held", { messageIds: ["generated-task"] }, { session_id: "generated-child", project_id: "generated-project" })]);
  assert.equal((held[0]!.payload as { run: PersonaRun }).run.status, "stopped", "stopping the child before its task starts ends the run");
  assert.deepEqual(held[1], { event_type: "queue.removed", profile_id: "default", project_id: "generated-project", session_id: "generated-child", payload: { messageId: "generated-task" } });
  const recovering = { ...running, revision: running.revision + 1 };
  snapshot = { ...snapshot, personaRuns: [recovering], sessions: [...snapshot.sessions, { id: "generated-child", kind: "agent", turnId: null }],
    modelFailures: [{ id: "generated-failure", sessionId: "generated-child", turnId: "generated-child-turn", status: "exhausted", diagnostic: "Generated retries exhausted." }] } as unknown as Snapshot;
  const exhausted = runtime.derived(snapshot, []).map((value) => (value.payload as { run: PersonaRun }).run);
  assert.deepEqual(exhausted.map((value) => [value.status, value.diagnostic]), [["failed", "Generated retries exhausted."]], "a run whose model recovery gave up never stays active");
  snapshot = { ...snapshot, personaRuns: [{ ...recovering, stopRequested: "timeout" }], modelFailures: [{ id: "generated-failure", sessionId: "generated-child", turnId: "generated-child-turn", status: "cancelled", diagnostic: "Generated retry cancelled." }] } as unknown as Snapshot;
  assert.equal((runtime.derived(snapshot, [])[0]!.payload as { run: PersonaRun }).run.status, "stopped");
  snapshot = { ...snapshot, personaRuns: [], modelFailures: [], personas: [persona()], automationRuns: [{ id: "generated-automation-run", steps: [{ kind: "script", path: "scripts/@docs.sh", interpreter: "sh" }] }],
    sessions: [{ id: "generated-parent", kind: "agent", projectId: "generated-project" }, { id: "generated-subagent", kind: "subagent", projectId: "generated-project" }] } as unknown as Snapshot;
  assert.equal(runtime.derived(snapshot, [event("turn.started", { item }, { session_id: "generated-subagent", turn_id: "generated-subagent-turn" })]).length, 0,
    "a model's subagent prompt never tags a persona");
  assert.equal(runtime.derived(snapshot, [event("turn.started", { item: { ...item, id: "project-work-generated-run", text: "<untrusted-work-item>cc @docs</untrusted-work-item>" } },
    { session_id: "generated-parent", turn_id: "generated-work-turn" })]).length, 0, "issue text in a project work prompt never tags a persona");
  assert.equal(runtime.derived(snapshot, [event("turn.started", { item: { ...item, text: "Automation step: run @docs", automation: { automationId: "a", runId: "generated-automation-run", step: 0 } } },
    { session_id: "generated-parent", turn_id: "generated-script-turn" })]).length, 0, "an automation's script step is not a saved prompt");
  snapshot = { ...snapshot, personaRuns: [running] } as unknown as Snapshot;
  const deleted = (runtime.derived(snapshot, [event("session.deleted", { deletedSessionId: "generated-child", usage: [] })])[0]!.payload as { run: PersonaRun }).run;
  assert.equal(deleted.status, "partial");
});

test("restart blocks persona and roundup runs that never started their work, without replaying anything", () => {
  let snapshot = { profileId: "default", personaRuns: [run()], dependencyRoundupRuns: [{ version: 1, id: "generated-roundup", revision: 0, profileId: "default", settingsRevision: 1,
    trigger: "schedule", occurrenceAt: at, missed: 0, sourceIds: ["a".repeat(64)], refreshId: null, status: "starting", summary: null, commandId: "generated-command",
    createdAt: at, updatedAt: at, diagnostic: null }], myWorkRefreshes: [] } as unknown as Snapshot;
  const personas = new PersonaRuntime({ snapshot: () => snapshot, commit: () => {}, finish: () => { throw new Error("unused"); }, now: () => Date.parse(at),
    sourceText: () => null, validate: () => {}, controls: (parent) => parent.controls, spawn: () => { throw new Error("A restart must not spawn."); }, notice: () => [], stop: () => {}, closing: () => false });
  const blocked = personas.recover().map((event) => (event.payload as { run: PersonaRun }).run);
  assert.deepEqual(blocked.map((value) => value.status), ["blocked"]); assert.match(blocked[0]!.diagnostic!, /restarted/);
  const roundups = new DependencyRoundupRuntime({ snapshot: () => snapshot, commit: () => {}, finish: () => { throw new Error("unused"); }, now: () => Date.parse(at),
    myWork: () => { throw new Error("A restart must not read."); }, cancel: async () => ({}), closing: () => false });
  const recovered = roundups.recover().map((event) => (event.payload as { run: { status: string; diagnostic: string } }).run);
  assert.equal(recovered[0]!.status, "blocked"); assert.match(recovered[0]!.diagnostic, /Nothing was read/);
  snapshot = { ...snapshot, personaRuns: [] } as unknown as Snapshot;
});

test("protocol 119 adds both markers atomically and refuses persona or roundup history relabelled as older", async () => {
  const directory = await mkdtemp(join(tmpdir(), "moguri-generated-personas-migration-")), path = join(directory, "state.sqlite"), key = Buffer.alloc(32, 0x5a);
  try {
    new EventStore(path, key).close();
    let raw = new DatabaseSync(path);
    raw.exec(`DELETE FROM retention_metadata WHERE id IN ('${personasSchemaMarker}','${dependencyRoundupsSchemaMarker}'); PRAGMA user_version=118;`); raw.close();
    let store = new EventStore(path, key);
    assert.equal(store.db.prepare("PRAGMA user_version").get()?.user_version, 119);
    assert.deepEqual(store.db.prepare(`SELECT id,value FROM retention_metadata WHERE id IN ('${personasSchemaMarker}','${dependencyRoundupsSchemaMarker}') ORDER BY id`).all().map((row) => ({ ...row })),
      [{ id: dependencyRoundupsSchemaMarker, value: "1" }, { id: personasSchemaMarker, value: "1" }]);
    store.commit([{ event_type: "persona.recorded", profile_id: "default", payload: { persona: persona({ revision: 0, status: "disabled" }) } }]);
    store.close();
    raw = new DatabaseSync(path);
    raw.exec(`DELETE FROM retention_metadata WHERE id IN ('${personasSchemaMarker}','${dependencyRoundupsSchemaMarker}'); PRAGMA user_version=118;`); raw.close();
    assert.throws(() => new EventStore(path, key), /personas or persona runs cannot become a pre-119 lineage/);
    raw = new DatabaseSync(path); raw.exec("PRAGMA user_version=119;"); raw.close();
    assert.throws(() => new EventStore(path, key), /schema/i, "a missing marker fails closed");
    raw = new DatabaseSync(path); raw.exec(`INSERT INTO retention_metadata(id,value) VALUES ('${personasSchemaMarker}','1'),('${dependencyRoundupsSchemaMarker}','1');`); raw.close();
    store = new EventStore(path, key); store.close();
  } finally { await rm(directory, { recursive: true, force: true }); }
});

const childOf = (snapshot: Snapshot, runId: string) => {
  const value = snapshot.personaRuns.find((entry) => entry.id === runId);
  return value?.childSessionId ? snapshot.sessions.find((session) => session.id === value.childSessionId) : undefined;
};

test("tagging an enabled persona starts one scoped Manual subsession attributed to it; disabled, out-of-scope and code mentions start nothing", { skip: process.platform !== "darwin", timeout: 60000 }, async () => {
  const fixture = await setupFixture({ responseMode: "text", maxOutputTokens: 128 });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.configure(); await sdk.refresh();
    await assert.rejects(sdk.personas.createPreset("docs", { budget: { kind: "limited", tokens: 200_000 } }), /estimate-based accounting/);
    const created = await sdk.personas.createPreset("docs", { budget: { kind: "limited", tokens: 200_000, basis: "estimate" } }); await sdk.refresh();
    assert.equal(sdk.personas.get("@docs").status, "disabled");
    await fixture.send("Generated first message for @docs while it is off."); await fixture.terminal();
    assert.equal(fixture.service.controller.snapshot().personaRuns.length, 0, "a disabled persona ignores mentions");
    await sdk.personas.enable(created.id!); await sdk.refresh();
    const otherProject = join(fixture.directory, "other-project"); await mkdir(otherProject);
    const other = (await sdk.projects.add(otherProject)).id!;
    await sdk.personas.create({ ...personaPresets.maintenance, handle: "generated-scoped", name: "Generated scoped", projectId: other }); await sdk.refresh();
    await sdk.personas.enable("generated-scoped"); await sdk.refresh();
    await fixture.send("Please ask @docs to document this and @generated-scoped too; ignore `@maintenance` and mail someone@docs.example.");
    await waitFor(() => fixture.service.controller.snapshot().personaRuns[0]?.status === "completed", 30000);
    const snapshot = fixture.service.controller.snapshot(), [docs] = snapshot.personaRuns;
    assert.equal(snapshot.personaRuns.length, 1, "only the enabled in-scope persona started");
    assert.equal(docs!.handle, "docs"); assert.equal(docs!.trigger, "mention"); assert.equal(docs!.source.actor, "user");
    assert.equal(docs!.source.sessionId, fixture.sessionId);
    const child = childOf(snapshot, docs!.id)!;
    assert.equal(child.title, "@docs · Docs"); assert.equal(child.createdParentSessionId, fixture.sessionId);
    assert.equal(child.controls.autonomy, "Manual", "a mention grants no autonomy");
    assert.deepEqual(child.controls.budget, { kind: "limited", tokens: 200_000, basis: "estimate" });
    const task = fixture.service.controller.events(0).find((event) => event.event_type === "turn.started" && event.session_id === child.id);
    assert.ok(task?.event_type === "turn.started" && task.payload.item.id === docs!.childItemId && task.payload.item.origin?.origin.actor === "user");
    assert.match(task?.event_type === "turn.started" ? task.payload.item.text : "", /You are @docs \(Docs\)[\s\S]*Please ask @docs to document this/);
    assert.ok(snapshot.coordinationLinks.some((link) => link.parentId === fixture.sessionId && link.childId === child.id && link.origin.actor === "user"));
    await waitFor(() => fixture.service.controller.snapshot().coordinationMessages.some((message) => message.toSessionId === fixture.sessionId && message.kind === "result" && message.fromSessionId === child.id));
    const notice = fixture.service.controller.snapshot().coordinationMessages.find((message) => message.toSessionId === fixture.sessionId && message.kind === "message" && message.fromSessionId === child.id);
    assert.equal(notice?.origin.actor, "service"); assert.match(notice!.text, /"persona":"@docs"/);
    await sdk.refresh();
    const listed = await personasSlash(sdk, "list");
    assert.ok(listed.kind === "text" && listed.text.includes("@docs Docs [On]"));
    assert.match(personasSummary(sdk.personas.list(), sdk.personas.runs()), /completed tagged/);
    await assert.rejects(sdk.personas.create({ ...personaPresets.docs }), /already used/);
    await assert.rejects(sdk.personas.delete("generated-scoped", { expectedRevision: 0 }), /changed this persona/);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("stops, time limits and human intervention settle the exact persona task and never claim more than happened", { skip: process.platform !== "darwin", timeout: 60000 }, async () => {
  const clock = new GeneratedIntakeClock();
  const fixture = await setupFixture({ platform: { intakeClock: clock }, respond: (request) => {
    const text = JSON.stringify(request);
    return text.includes("You are @docs") && text.includes("generated persona hold") ? { hold: true } : { text: "Generated persona fixture reply." };
  } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.configure(); await sdk.refresh();
    await sdk.personas.createPreset("docs", { access: "read-only", timeoutMinutes: 1 }); await sdk.refresh();
    await sdk.personas.enable("docs"); await sdk.refresh();
    await fixture.send("@docs generated persona hold for a user stop");
    const first = await waitFor(() => fixture.service.controller.snapshot().personaRuns.find((value) => value.childTurnId && childOf(fixture.service.controller.snapshot(), value.id)?.turnId === value.childTurnId));
    assert.equal(childOf(fixture.service.controller.snapshot(), first.id)?.mode, "read-only");
    await sdk.personas.stopRun(first.id);
    const stopped = await waitFor(() => { const value = fixture.service.controller.snapshot().personaRuns.find((entry) => entry.id === first.id); return value?.status !== "running" ? value : false; });
    assert.equal(stopped.stopRequested, "user"); assert.ok(["stopped", "partial"].includes(stopped.status), stopped.status);
    await fixture.terminal();
    await fixture.send("@docs generated persona hold for the time limit");
    const second = await waitFor(() => fixture.service.controller.snapshot().personaRuns.find((value) => value.id !== first.id && value.childTurnId));
    clock.advanceBy(61_000);
    const timed = await waitFor(() => { const value = fixture.service.controller.snapshot().personaRuns.find((entry) => entry.id === second.id); return value?.status !== "running" ? value : false; });
    assert.equal(timed.stopRequested, "timeout"); assert.match(timed.diagnostic ?? "", /time limit|stopped|partial/i);
    await fixture.terminal();
    await fixture.send("@docs generated persona hold for a human intervention");
    const third = await waitFor(() => fixture.service.controller.snapshot().personaRuns.find((value) => ![first.id, second.id].includes(value.id) && value.childTurnId));
    await sdk.command({ type: "session.stop", sessionId: third.childSessionId! });
    const intervened = await waitFor(() => { const value = fixture.service.controller.snapshot().personaRuns.find((entry) => entry.id === third.id); return value?.status !== "running" ? value : false; });
    assert.equal(intervened.stopRequested, null, "a human stop in the child chat is recorded as the turn's own outcome");
    assert.ok(["stopped", "partial"].includes(intervened.status));
    await fixture.terminal();
    await fixture.send("@docs generated persona hold before deletion");
    const fourth = await waitFor(() => fixture.service.controller.snapshot().personaRuns.find((value) => ![first.id, second.id, third.id].includes(value.id) && value.childTurnId));
    await sdk.refresh();
    await assert.rejects(sdk.personas.delete("docs"), /Confirm stopping/);
    await sdk.personas.delete("docs", { stopRunning: true });
    const deleted = await waitFor(() => { const value = fixture.service.controller.snapshot().personaRuns.find((entry) => entry.id === fourth.id); return value?.status !== "running" ? value : false; });
    assert.equal(deleted.stopRequested, "deleted");
    await sdk.refresh();
    assert.equal(sdk.personas.list().length, 0);
    assert.ok(fixture.service.controller.snapshot().sessions.some((session) => session.id === fourth.childSessionId), "a deleted persona's chats are kept");
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("a restarted service never re-dispatches a tagged persona", { skip: process.platform !== "darwin", timeout: 60000 }, async () => {
  const fixture = await setupFixture({ responseMode: "text", maxOutputTokens: 128 });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  let reopened: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    await fixture.configure(); await sdk.refresh();
    await sdk.personas.createPreset("docs", { access: "read-only" }); await sdk.refresh(); await sdk.personas.enable("docs");
    await fixture.send("Generated restart check for @docs");
    await waitFor(() => fixture.service.controller.snapshot().personaRuns[0]?.status === "completed", 30000);
    await fixture.terminal();
    const children = fixture.service.controller.snapshot().sessions.length, requests = fixture.requests.length;
    sdk.disconnect(); await fixture.service.close();
    reopened = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey });
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(reopened.controller.snapshot().personaRuns.length, 1);
    assert.equal(reopened.controller.snapshot().sessions.length, children);
    assert.equal(fixture.requests.length, requests, "no model call was replayed");
  } finally { await reopened?.close(); sdk.disconnect(); await fixture.close(); }
});

test("an automation prompt step that tags a persona records the automation run as its actual trigger", { skip: process.platform !== "darwin", timeout: 60000 }, async () => {
  const fixture = await setupFixture({ responseMode: "text", maxOutputTokens: 128 });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.configure(); await sdk.refresh();
    await sdk.personas.createPreset("docs", { access: "read-only" }); await sdk.refresh(); await sdk.personas.enable("docs");
    const automation = await sdk.automations.create(fixture.session().projectId, { name: "Generated persona digest",
      schedule: { kind: "interval", minutes: 60, timeZone: "UTC" }, steps: [{ kind: "prompt", text: "Generated scheduled check: @docs review the changelog." }] },
    { enabled: false, controls: { modelId: fixture.modelId } });
    await sdk.refresh(); await sdk.automations.runNow(automation.id!);
    const run = await waitFor(() => fixture.service.controller.snapshot().personaRuns.find((value) => value.status === "completed"), 30000);
    const automationRun = fixture.service.controller.snapshot().automationRuns.find((value) => value.automationId === automation.id)!;
    assert.equal(run.trigger, "automation"); assert.equal(run.source.actor, "automation");
    assert.equal(run.source.automationRunId, automationRun.id); assert.equal(run.source.sessionId, automationRun.sessionId);
    const child = childOf(fixture.service.controller.snapshot(), run.id)!;
    assert.equal(child.createdParentSessionId, automationRun.sessionId);
    const task = fixture.service.controller.events(0).find((event) => event.event_type === "turn.started" && event.session_id === child.id);
    assert.match(task?.event_type === "turn.started" ? task.payload.item.text : "", /the user's automation tagged/);
  } finally { sdk.disconnect(); await fixture.close(); }
});
