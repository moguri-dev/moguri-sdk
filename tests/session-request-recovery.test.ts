import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { EventStore } from "../apps/service/src/store.ts";
import { startService } from "../apps/service/src/server.ts";
import { MoguriSdk, PROTOCOL_VERSION, QUERY_TIMEOUT_MS, QUERY_REPLY_GRACE_MS, type Command } from "../packages/sdk/src/index.ts";
import { appendLegacyAutopilot, removeRecoveryFixtureMarkers, retainedCiphertextRows } from "./fixtures/legacy-state.ts";
import { setupFixture, waitFor } from "./fixture.ts";
import { githubApplicationFixture } from "./github-workflows-fixture.ts";
import { setTimeout as delay } from "node:timers/promises";

test("reselecting legacy Autopilot retains explicit consent across clients, subsequent turns and restart without upgrading on load", { skip: process.platform !== "darwin" }, async () => {
  const f = await setupFixture({ toolCall: { name: "run_command", args: { command: "printf 'Generated persistent automatic approval\\n'", timeoutMs: 2000 } } });
  let sdk = await new MoguriSdk(f.service.connection).ready(), restarted: Awaited<ReturnType<typeof startService>> | undefined;
  const peer = await new MoguriSdk(f.service.connection).ready();
  try {
    await f.configure(); appendLegacyAutopilot(f.service, f.sessionId); await sdk.refresh(); await peer.refresh();
    assert.equal(f.session().controls.automaticApprovals, undefined);
    await sdk.sessions.configure(f.sessionId, { ...f.session().controls, budget: { kind: "unlimited" } }, f.session().revision);
    assert.equal(f.session().controls.automaticApprovals, undefined, "unrelated control edits cannot upgrade old consent");
    const revision = f.session().revision;
    await sdk.sessions.autonomy(f.sessionId, "Autopilot", revision);
    await assert.rejects(() => peer.sessions.autonomy(f.sessionId, "Guided", revision), { code: "revision_conflict" });
    await peer.refresh(); assert.equal(peer.getState().snapshot?.sessions[0]?.controls.automaticApprovals, true);
    for (const prompt of ["Generated explicit first turn.", "Generated explicit second turn."]) {
      await f.send(prompt); assert.equal((await f.terminal()).status, "completed"); assert.equal(f.session().pendingApproval, null);
    }
    const selection = f.service.controller.events(0).findLast((event) => event.event_type === "session.configured" && event.payload.autonomySelection);
    assert.equal(selection?.event_type === "session.configured" && selection.payload.autonomySelection?.actor, "user");
    const calls = f.requests.length, decisions = f.service.controller.events(0).filter((event) => event.event_type === "tool.decided");
    assert.ok(decisions.length === 2 && decisions.every((event) => event.event_type === "tool.decided" && event.payload.actor === "autonomy"));
    sdk.disconnect(); peer.disconnect(); await f.service.close();
    restarted = await startService({ stateDir: join(f.directory, "state"), provider: f.provider, retentionKey: f.retentionKey });
    sdk = await new MoguriSdk(restarted.connection).ready();
    assert.equal(sdk.getState().snapshot?.sessions[0]?.controls.automaticApprovals, true); assert.equal(f.requests.length, calls);
    const settings = sdk.settings.get()!;
    await sdk.settings.update({ ...settings.values, startup: { ...settings.values.startup, profile: { autonomy: "Autopilot", automaticApprovals: true } } }, settings.revision);
    const created = await sdk.sessions.create(f.session().projectId);
    const inherited = sdk.getState().snapshot?.sessions.find((session) => session.id === created.id);
    assert.equal(inherited?.controls.automaticApprovals, true); assert.equal(inherited?.defaults?.sources.automaticApprovals, "profile");
  } finally { sdk.disconnect(); peer.disconnect(); await restarted?.close(); await f.close(); }
});

test("a real generic autonomy change cannot carry Manual's false automatic-approval marker into Autopilot", { skip: process.platform !== "darwin" }, async () => {
  const f = await setupFixture(), sdk = await new MoguriSdk(f.service.connection).ready();
  try {
    await sdk.sessions.autonomy(f.sessionId, "Manual");
    assert.equal(f.session().controls.automaticApprovals, false);
    await sdk.sessions.configure(f.sessionId, { ...f.session().controls, autonomy: "Autopilot" }, f.session().revision);
    assert.equal(f.session().controls.automaticApprovals, true);
    await sdk.sessions.autonomy(f.sessionId, "Guided"); assert.equal(f.session().controls.automaticApprovals, false);
  } finally { sdk.disconnect(); await f.close(); }
});

test("combined80 migration appends both justified markers atomically and preserves ciphertext, receipts, controls and all original lineage", async () => {
  const f = await setupFixture(), path = f.service.store.path;
  let reopened: EventStore | undefined;
  try {
    appendLegacyAutopilot(f.service, f.sessionId);
    const rows = retainedCiphertextRows(f.service.store.db), events = f.service.store.events();
    await f.service.close();
    const raw = new DatabaseSync(path);
    removeRecoveryFixtureMarkers(raw, events);
    raw.exec("PRAGMA user_version=80; CREATE TRIGGER generated_recovery_failure BEFORE INSERT ON retention_metadata WHEN NEW.id='builtin_git_schema' BEGIN SELECT RAISE(ABORT,'Generated recovery migration interruption'); END;");
    raw.close();
    assert.throws(() => new EventStore(path, f.retentionKey), /Generated recovery migration interruption/);
    const failed = new DatabaseSync(path);
    try {
      assert.equal(failed.prepare("PRAGMA user_version").get()?.user_version, 80);
      assert.equal(failed.prepare("SELECT value FROM retention_metadata WHERE id='session_request_recovery_schema'").get(), undefined);
      assert.deepEqual(retainedCiphertextRows(failed), rows); failed.exec("DROP TRIGGER generated_recovery_failure");
    } finally { failed.close(); }
    reopened = new EventStore(path, f.retentionKey);
    assert.equal(reopened.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
    for (const id of ["model_selection_continuity_schema", "theme_catalog_schema", "queued_slash_schema", "project_folder_actions_schema",
      "sandbox_multi_root_schema", "theme_model_workspace_convergence_schema", "session_request_recovery_schema", "builtin_git_schema"]) {
      assert.equal(reopened.db.prepare("SELECT value FROM retention_metadata WHERE id=?").get(id)?.value, "1");
    }
    assert.deepEqual(retainedCiphertextRows(reopened.db), rows);
    reopened.close(); reopened = new EventStore(path, f.retentionKey);
    assert.deepEqual(retainedCiphertextRows(reopened.db), rows);
    assert.equal(f.requests.length, 0);
  } finally { reopened?.close(); await f.close(); }
});

test("actual explicit consent history and missing current markers cannot be relabelled as protocol80", { skip: process.platform !== "darwin" }, async (t) => {
  for (const defect of ["downgrade", "missing", "corrupt"] as const) await t.test(defect, async () => {
    const f = await setupFixture(), sdk = await new MoguriSdk(f.service.connection).ready(), path = f.service.store.path;
    try {
      await sdk.sessions.autonomy(f.sessionId, "Autopilot"); sdk.disconnect(); await f.service.close();
      const raw = new DatabaseSync(path);
      if (defect === "downgrade") raw.exec("DELETE FROM retention_metadata WHERE id IN ('session_request_recovery_schema','builtin_git_schema'); PRAGMA user_version=80;");
      if (defect === "missing") raw.exec("DELETE FROM retention_metadata WHERE id='builtin_git_schema'");
      if (defect === "corrupt") raw.exec("UPDATE retention_metadata SET value='0' WHERE id='session_request_recovery_schema'");
      const rows = retainedCiphertextRows(raw); raw.close();
      assert.throws(() => new EventStore(path, f.retentionKey), /recovery marker|recovery.*schema marker/i);
      const preserved = new DatabaseSync(path);
      try { assert.deepEqual(retainedCiphertextRows(preserved), rows); } finally { preserved.close(); }
    } finally { sdk.disconnect(); await f.close(); }
  });
});

test("a pending original mutation is inspected, not resent, and its late acknowledgement remains recoverable exactly once", async (t) => {
  const f = await setupFixture(), sdk = await new MoguriSdk(f.service.connection).ready(), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const dispatch = f.service.controller.dispatch.bind(f.service.controller), originalFetch = globalThis.fetch;
  const command: Command = { type: "draft.save", sessionId: f.sessionId, expectedRevision: 0, text: "Generated original pending edit.", attachments: [] };
  let writes = 0, response: Promise<Response> | undefined;
  try {
    t.mock.method(f.service.controller, "dispatch", async (...args: Parameters<typeof dispatch>) => { entered.resolve(); await release.promise; return dispatch(...args); });
    t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith("/v1/commands")) {
        writes++; response = originalFetch(input, init); await entered.promise; throw new DOMException("Signal timed out", "TimeoutError");
      }
      return originalFetch(input, init);
    });

    await assert.rejects(() => sdk.command(command, "generated-pending-command"), { code: "command_pending" });
    assert.deepEqual(await sdk.commandReceipt(command, "generated-pending-command"), { status: "pending" });
    release.resolve(); await response; await waitFor(() => f.session().draft.revision === 1);
    assert.deepEqual(await sdk.commandReceipt(command, "generated-pending-command"), { status: "committed", result: { revision: 1 } });
    await assert.rejects(() => sdk.commandReceipt({ ...command, text: "Generated mismatched receipt input." }, "generated-pending-command"), { code: "idempotency_conflict" });
    assert.equal(writes, 1);
    assert.equal(f.service.controller.events(0).filter((event) => event.event_type === "draft.saved").length, 1);
  } finally { release.resolve(); await response; t.mock.restoreAll(); sdk.disconnect(); await f.close(); }
});

test("a real capability read past twenty seconds succeeds within its service-owned deadline instead of Signal timed out", { timeout: 35000 }, async () => {
  let reads = 0;
  const f = await githubApplicationFixture({ beforeRead: async (path) => {
    if (path.startsWith("repos/generated-owner/fixture/pulls?")) { reads++; await delay(20_100); }
  } });
  try {
    const started = Date.now(), result = await f.sdk.github.pulls(f.scope, "generated-owner/fixture", "generated-owner");
    assert.ok(Date.now() - started >= 20_000);
    assert.equal(result.items[0]?.number, 11); assert.equal(reads, 1);
    assert.equal(f.sdk.getState().status, "connected");
    assert.deepEqual(f.writes(), { issues: 0, pulls: 0 });
  } finally { await f.close(); }
});

test("the actual service read deadline cancels its original source and returns an actionable error without poisoning edits", async (t) => {
  const f = await setupFixture(), sdk = await new MoguriSdk(f.service.connection).ready(), originalTimeout = AbortSignal.timeout;
  const query = f.service.controller.platform.query.bind(f.service.controller.platform);
  const deadlines: number[] = []; let cancelled = false;
  try {
    t.mock.method(AbortSignal, "timeout", (milliseconds: number) => {
      deadlines.push(milliseconds); return originalTimeout(milliseconds === QUERY_TIMEOUT_MS ? 20 : milliseconds);
    });
    t.mock.method(f.service.controller.platform, "query", async (...args: Parameters<typeof query>) => {
      if (args[0].type !== "tooling.results") return query(...args);
      const signal = args[1]; assert.ok(signal);
      return new Promise<never>((_resolve, reject) => {
        signal.addEventListener("abort", () => { cancelled = true; reject(signal.reason); }, { once: true });
      });
    });
    await assert.rejects(() => sdk.tools.results(f.sessionId), (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "query_timeout" && /source read|deadline/.test(error.message));
    assert.equal(cancelled, true); assert.ok(deadlines.includes(QUERY_TIMEOUT_MS));
    assert.ok(deadlines.includes(QUERY_TIMEOUT_MS + QUERY_REPLY_GRACE_MS));
    assert.equal(sdk.getState().status, "connected");
    await sdk.command({ type: "draft.save", sessionId: f.sessionId, expectedRevision: 0, text: "Generated edit after a failed read.", attachments: [] });
    assert.equal(f.session().draft.text, "Generated edit after a failed read."); assert.equal(f.requests.length, 0);
  } finally { t.mock.restoreAll(); sdk.disconnect(); await f.close(); }
});

test("a legacy denied unknown Git tool name is not invented feature provenance that blocks a genuine80 upgrade", async () => {
  const f = await setupFixture(), path = f.service.store.path;
  try {
    f.service.store.commit([{ event_type: "tool.completed", profile_id: "default", project_id: f.session().projectId,
      session_id: f.sessionId, turn_id: "generated-legacy-denied-turn", step_id: "generated-legacy-denied-step",
      payload: { call: { id: "generated-legacy-denied-call", name: "git_read", arguments: {} },
        text: "Generated unknown tool was denied. No operation was executed.", isError: true, outcome: "denied" } }]);
    f.service.controller.refreshProfile();
    const history = f.service.store.events(), rows = retainedCiphertextRows(f.service.store.db);
    await f.service.close();
    const raw = new DatabaseSync(path);
    try { removeRecoveryFixtureMarkers(raw, history); raw.exec("PRAGMA user_version=80"); } finally { raw.close(); }
    const reopened = new EventStore(path, f.retentionKey);
    try { assert.deepEqual(retainedCiphertextRows(reopened.db), rows); assert.equal(reopened.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION); }
    finally { reopened.close(); }
  } finally { await f.close(); }
});
