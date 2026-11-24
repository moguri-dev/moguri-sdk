import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ownedRoleContext, type OwnedRoleInput } from "../apps/service/src/owned-roles.ts";
import { estimateModelContext } from "../apps/service/src/model-controls.ts";
import { ManagedWorkspaces } from "../apps/service/src/managed-workspaces.ts";
import { startService } from "../apps/service/src/server.ts";
import { digest } from "../apps/service/src/store.ts";
import { isRecord, MoguriSdk } from "../packages/sdk/src/index.ts";
import { ownedSequenceFixture as fixture, ownedRoleMarker } from "./fixtures/owned-sequence-api.ts";
import { waitFor, GENERATED_RETENTION_KEY } from "./fixture.ts";
import type { GeneratedProviderOptions } from "./fixture.ts";
import { ciTime } from "./fixtures/time-scale.ts";

test("actual control plane owns complete planned roles, real serial worker starts/results and explicit data contexts without touching either checkout", { skip: process.platform !== "darwin" }, async () => {
  const f = await fixture();
  try {
    const index = await readFile(join(f.project, ".git/index")), head = f.git(["rev-parse", "HEAD"]);
    const started = await f.start(), record = await f.settled(started.id);
    assert.equal(record.status, "completed"); assert.deepEqual(record.steps.map((step) => step.role), ["draft", "critic", "revision"]);
    assert.equal(f.requests.length, 3);
    for (const [position, request] of f.requests.entries()) {
      assert.equal(request.tools, undefined); assert.equal(request.max_tokens ?? request.max_completion_tokens, 64);
      assert.ok(Array.isArray(request.messages));
      const user = request.messages.filter(isRecord).findLast((message) => message.role === "user");
      assert.ok(typeof user?.content === "string");
      const context: unknown = JSON.parse(user.content);
      assert.ok(isRecord(context) && Array.isArray(context.untrustedPriorResults));
      assert.equal(context.untrustedPriorResults.length, position);
      assert.ok(context.untrustedPriorResults.every((value) => isRecord(value) && value.text === ownedRoleMarker));
      const read = await f.sdk.roleSequences.read(record.id, position);
      assert.ok(read.step?.input?.includes("untrustedPriorResults")); assert.ok(read.step?.result?.includes(ownedRoleMarker));
    }
    const calls = (await f.sdk.budgets.calls({ sessionId: f.sessionId })).calls, plans = (await f.sdk.budgets.plans({ turnId: started.id })).plans;
    assert.deepEqual(calls.map((call) => call.role).sort(), ["critic", "draft", "revision"]);
    assert.equal(calls.reduce((total, call) => total + (call.reportedTokens ?? NaN), 0), 126);
    assert.ok(plans.every((plan) => plan.status === "consumed"));
    for (const [position, step] of record.steps.entries()) {
      const plan = plans.find((plan) => plan.id === step.planId), call = calls.find((call) => call.id === step.stepId);
      assert.ok(plan && call); assert.equal(plan.consumedStepId, call.id); assert.ok(call.inputEstimate! <= step.inputBound);
      if (position) assert.ok(step.inputBound > record.steps[position - 1]!.inputBound);
    }
    assert.equal(await readFile(join(f.project, "fixture.txt"), "utf8"), "generated original\n");
    assert.equal(await readFile(join(f.workspace.path, "fixture.txt"), "utf8"), "generated original\n");
    assert.deepEqual(await readFile(join(f.project, ".git/index")), index); assert.equal(f.git(["rev-parse", "HEAD"]), head);
    assert.equal(JSON.parse((await f.sdk.artifacts.export(record.id)).export.text).schemaVersion, 4);
    await f.send("Generated ordinary follow-up after retained roles."); await f.terminal();
    assert.equal(f.requests.length, 4); assert.equal(JSON.stringify(f.requests[3]?.messages).includes(ownedRoleMarker), false);
  } finally { await f.close(); }
});

test("complete future context reserves worst exact JSON escaping, not empty prior results or a token-to-byte assumption", async () => {
  const f = await fixture();
  try {
    const { document } = await f.execution.preview(f.input), last = document.roles[2]!;
    const texts = ["\0".repeat(32 * 1024), '"'.repeat(32 * 1024), "\\".repeat(32 * 1024), "x".repeat(32 * 1024), "\r\n".repeat(16 * 1024), "🦇".repeat(8 * 1024)];
    for (const [index, text] of texts.entries()) {
      assert.equal(Buffer.byteLength(text), document.maxResultBytes);
      const context = ownedRoleContext(document, 2, [text, text]), estimated = estimateModelContext({ systemPrompt: last.systemPrompt, messages: context, tools: [] });
      assert.ok(estimated <= last.inputBound);
      if (!index) assert.equal(estimated, last.inputBound);
    }
    assert.throws(() => ownedRoleContext(document, 2, ["", "x".repeat(document.maxResultBytes + 1)]), { code: "owned_role_context" });
    assert.throws(() => ownedRoleContext(document, 2, ["", "\ud800"]), { code: "owned_role_context" });
    assert.throws(() => ownedRoleContext(document, 2, [""]), { code: "owned_role_context" });
    assert.equal(f.requests.length, 0); assert.equal(f.control.snapshot().budgetPlans.length, 0);
  } finally { await f.close(); }
});

test("a future role that cannot fit rejects the whole operation without a hold, report, receipt or model request", async () => {
  const f = await fixture();
  try {
    f.provider.state.models[0]!.contextWindow = 8192; f.provider.onChange();
    const before = f.control.events(0).length;
    await assert.rejects(() => f.execution.preview(f.input), { code: "owned_role_bound" });
    assert.equal(f.control.snapshot().roleSequences.length, 0); assert.equal(f.control.snapshot().budgetPlans.length, 0);
    assert.equal(f.control.events(0).length, before); assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});

test("failure inside complete initial-plan admission rolls back every prefix before launching the actual worker", { skip: process.platform !== "darwin" }, async () => {
  const f = await fixture();
  try {
    const artifacts = f.control.snapshot().artifacts.length;
    let plans = 0;
    f.service.store.db.function("generated_owned_plan_count", () => {
      if (++plans === 2) throw new Error("Generated second planned role failure.");
      return 0;
    });
    f.service.store.db.exec(`CREATE TRIGGER generated_owned_plan BEFORE INSERT ON events
      WHEN json_extract(NEW.data,'$.event_type')='budget.plan_recorded' BEGIN SELECT generated_owned_plan_count(); END;`);
    await assert.rejects(() => f.start());
    assert.equal(f.control.snapshot().artifacts.length, artifacts); assert.equal(f.control.snapshot().budgetPlans.length, 0);
    assert.equal(f.control.snapshot().roleSequences.length, 0); assert.equal(f.requests.length, 0); assert.equal(f.session().turnId, null);
    f.service.store.db.exec("DROP TRIGGER generated_owned_plan");
    const created = await f.start(); assert.equal((await f.settled(created.id)).status, "completed"); assert.equal(f.requests.length, 3);
  } finally { await f.close(); }
});

test("actual initial-start and result-insert failures dispatch no unauthorized next role and retain only admitted unknown capacity", { skip: process.platform !== "darwin" }, async () => {
  for (const event of ["model.started", "model.completed"]) {
    const f = await fixture();
    try {
      f.service.store.db.exec(`CREATE TRIGGER generated_owned_receipt BEFORE INSERT ON events
        WHEN json_extract(NEW.data,'$.event_type')='${event}' BEGIN SELECT RAISE(ABORT,'Generated owned model receipt failure'); END;`);
      const created = await f.start(), record = await f.settled(created.id), started = event === "model.completed";
      assert.ok(["failed", "partial"].includes(record.status)); assert.equal(f.requests.length, started ? 1 : 0);
      const calls = f.control.snapshot().budgetEntries;
      assert.equal(calls.length, started ? 1 : 0);
      assert.equal(f.control.snapshot().budgetPlans.filter((plan) => plan.status === "held").length, 0);
      if (started) { assert.equal(calls[0]?.status, "unknown"); assert.ok(calls[0]!.reservedTokens! > 0); assert.equal(record.steps[0]?.state, "unconfirmed"); }
      assert.equal(await readFile(join(f.project, "fixture.txt"), "utf8"), "generated original\n");
    } finally { await f.close(); }
  }
});

test("owned sequence stop reaches actual inference, releases undispatched roles and never records stopped work as completed", { skip: process.platform !== "darwin" }, async () => {
  const f = await fixture();
  try {
    const created = await f.start({ ...f.input, input: { ...f.input.input, task: "generated slow bounded roles" } });
    await waitFor(() => f.requests.length === 1);
    await f.sdk.command({ type: "session.stop", sessionId: f.sessionId });
    const record = await f.settled(created.id);
    assert.ok(["stopped", "partial"].includes(record.status)); assert.equal(record.stopRequested, true); assert.equal(f.requests.length, 1);
    const status = (await f.sdk.budgets.status(f.sessionId)).status;
    assert.equal(status.totals.reportedTokens, null); assert.ok(status.totals.heldTokens! > 0);
    assert.equal(f.control.snapshot().budgetPlans.filter((plan) => plan.status === "released").length, 2);
    assert.ok(f.control.events(0).some((event) => event.event_type === "turn.stop_acknowledged" && event.turn_id === created.id));
    assert.equal(f.control.snapshot().blockedProjects.includes(f.session().projectId), false);
  } finally { await f.close(); }
});

test("whole finite capacity fits exactly, rejects one token less without a prefix and settles every real role once", { skip: process.platform !== "darwin" }, async () => {
  const f = await fixture();
  try {
    const preview = await f.execution.preview(f.input), tokens = preview.document.roles.reduce((total, role) => total + role.inputBound + role.outputBound, 0);
    await f.sdk.budgets.policy({ basis: "estimate", tokens: tokens - 1 }, 0, true);
    await assert.rejects(() => f.start(), { code: "budget_plan_capacity" });
    assert.equal(f.control.snapshot().budgetPlans.length, 0); assert.equal(f.control.snapshot().roleSequences.length, 0); assert.equal(f.requests.length, 0);
    await f.sdk.budgets.policy({ basis: "estimate", tokens }, 1, true);
    const started = await f.start(); assert.equal((await f.settled(started.id)).status, "completed");
    const status = (await f.sdk.budgets.status(f.sessionId)).status;
    assert.equal(status.totals.reportedTokens, 126); assert.equal(status.totals.heldTokens, 0); assert.equal(status.totals.plannedHolds, 0);
    assert.equal(f.requests.length, 3);
  } finally { await f.close(); }
});

test("concurrent internal admissions cannot replace the same session's actual owned sequence after source review", { skip: process.platform !== "darwin" }, async () => {
  const f = await fixture();
  try {
    const results = await Promise.allSettled([f.start(), f.start()]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.filter((result) => result.status === "rejected").length, 1);
    const accepted = results.find((result) => result.status === "fulfilled"); assert.ok(accepted?.status === "fulfilled");
    assert.equal((await f.settled(accepted.value.id)).status, "completed");
    assert.equal(f.control.snapshot().roleSequences.length, 1); assert.equal(f.control.snapshot().budgetPlans.length, 3); assert.equal(f.requests.length, 3);
  } finally { await f.close(); }
});

test("the real controller deduplicates one pending original intent and rejects different arguments before any second admission", { skip: process.platform !== "darwin" }, async () => {
  const f = await fixture();
  try {
    const preview = await f.execution.preview(f.input), review = { digest: preview.digest, confirmCost: true as const }, id = randomUUID();
    const first = f.control.executeOwnedRoles(f.input, review, id), second = f.control.executeOwnedRoles(f.input, review, id);
    assert.equal(first, second);
    const changed = structuredClone(f.input); changed.roles[0]!.instruction = "Generated different original role instruction.";
    await assert.rejects(() => f.control.executeOwnedRoles(changed, review, id), { code: "idempotency_conflict" });
    const started = await first; assert.ok(started.id); assert.equal((await f.settled(started.id)).status, "completed");
    assert.equal(f.requests.length, 3); assert.equal(f.control.snapshot().roleSequences.length, 1);
  } finally { await f.close(); }
});

test("changed original source or model metadata during later preparation preserves the first raw result and dispatches no second call", { skip: process.platform !== "darwin" }, async (t) => {
  for (const change of ["source", "model"] as const) {
    const f = await fixture();
    try {
      const prepare = f.provider.prepare.bind(f.provider); let prepares = 0;
      t.mock.method(f.provider, "prepare", async (id: string, signal: AbortSignal) => {
        if (++prepares === 2) {
          if (change === "source") await writeFile(join(f.project, "fixture.txt"), "Generated concurrent actual user change.\n");
          else { f.provider.state.models[0]!.name = "Generated changed canonical metadata"; f.provider.onChange(); }
        }
        return prepare(id, signal);
      });
      const started = await f.start(), record = await f.settled(started.id);
      assert.equal(record.status, "partial"); assert.equal(f.requests.length, 1); assert.equal(record.steps[0]?.state, "recorded");
      assert.equal(record.steps[1]?.state, "pending"); assert.equal(f.control.snapshot().budgetEntries[0]?.reportedTokens, 42);
      assert.equal(f.control.snapshot().budgetPlans.filter((plan) => plan.status === "released").length, 2);
      assert.equal(await readFile(join(f.project, "fixture.txt"), "utf8"), change === "source" ? "Generated concurrent actual user change.\n" : "generated original\n");
    } finally { t.mock.restoreAll(); await f.close(); }
  }
});

test("unknown, over-limit, incomplete, tool-calling or empty results retain their actual observations without authorizing another role", { skip: process.platform !== "darwin" }, async () => {
  const cases: GeneratedProviderOptions[] = [
    { omitUsage: true }, { finishReason: "length" }, { replyText: "x".repeat(32 * 1024 + 1) }, { replyText: "" },
    { usage: { prompt_tokens: 30, completion_tokens: 65, total_tokens: 95 } }, { responseMode: "auto" },
  ];
  for (const options of cases) {
    const f = await fixture(options);
    try {
      const value = options.responseMode === "auto" ? { ...f.input, input: { ...f.input.input, task: "generated tool in unaccepted role data" } } : f.input;
      const started = await f.start(value), record = await f.settled(started.id);
      assert.ok(["partial", "failed"].includes(record.status)); assert.equal(f.requests.length, 1);
      assert.equal(record.steps[0]?.state, "recorded"); assert.ok(record.steps[0]?.resultDigest);
      assert.equal(record.steps[1]?.state, "pending"); assert.equal(f.control.snapshot().budgetEntries.length, 1);
      assert.equal(f.control.snapshot().budgetPlans.filter((plan) => plan.status === "released").length, 2);
      assert.equal(f.control.events(0).filter((event) => event.turn_id === started.id && event.event_type === "tool.started").length, 0);
      const entry = f.control.snapshot().budgetEntries[0]!;
      if (options.omitUsage) {
        assert.equal(entry.status, "unknown"); assert.equal(entry.reportedTokens, null);
        assert.throws(() => f.execution.context(record, f.execution.document(record), 1), { code: "owned_role_usage" });
      }
      if (options.usage) { assert.equal(entry.reportedTokens, 95); assert.equal(entry.outputLimitViolation, true); }
      assert.equal(await readFile(join(f.project, "fixture.txt"), "utf8"), "generated original\n");
      assert.equal(await readFile(join(f.workspace.path, "fixture.txt"), "utf8"), "generated original\n");
    } finally { await f.close(); }
  }
});

test("stop during the next actual preparation prevents its planned capacity from transferring or another request from dispatching", { skip: process.platform !== "darwin" }, async (t) => {
  const f = await fixture(); let preparingSecond = false;
  try {
    const prepare = f.provider.prepare.bind(f.provider); let prepares = 0;
    t.mock.method(f.provider, "prepare", async (id: string, signal: AbortSignal) => {
      if (++prepares === 2) {
        preparingSecond = true;
        await new Promise<void>((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
      }
      return prepare(id, signal);
    });
    const started = await f.start(); await waitFor(() => preparingSecond);
    await f.sdk.command({ type: "session.stop", sessionId: f.sessionId });
    const record = await f.settled(started.id);
    assert.ok(["stopped", "partial"].includes(record.status)); assert.equal(record.stopRequested, true); assert.equal(f.requests.length, 1);
    assert.equal(f.control.snapshot().budgetEntries.length, 1); assert.equal(f.control.snapshot().budgetEntries[0]?.reportedTokens, 42);
    assert.equal(f.control.snapshot().budgetPlans.filter((plan) => plan.status === "released").length, 2);
  } finally { t.mock.restoreAll(); await f.close(); }
});

test("failed atomic stop-intent journals still cancel actual inference without pretending that the request was retained", { skip: process.platform !== "darwin" }, async () => {
  for (const type of ["turn.stop_requested", "role.sequence_recorded"]) {
    const f = await fixture();
    try {
      const started = await f.start({ ...f.input, input: { ...f.input.input, task: "generated slow role stop journal" } });
      await waitFor(() => f.requests.length === 1); let fail = true;
      f.service.store.db.function("generated_owned_stop_once", () => { if (fail) { fail = false; throw new Error("Generated owned stop append failure."); } return 0; });
      f.service.store.db.exec(`CREATE TRIGGER generated_owned_stop BEFORE INSERT ON events
        WHEN json_extract(NEW.data,'$.event_type')='${type}' BEGIN SELECT generated_owned_stop_once(); END;`);
      await assert.rejects(() => f.sdk.command({ type: "session.stop", sessionId: f.sessionId }));
      const record = await f.settled(started.id);
      assert.ok(["stopped", "partial"].includes(record.status)); assert.equal(record.stopRequested, false); assert.equal(f.requests.length, 1);
      assert.equal(f.control.events(0).filter((event) => event.turn_id === started.id && event.event_type === "turn.stop_requested").length, 0);
      assert.ok(f.control.events(0).some((event) => event.turn_id === started.id && event.event_type === "turn.stop_acknowledged"));
      assert.equal(f.control.snapshot().budgetPlans.filter((plan) => plan.status === "released").length, 2);
    } finally { await f.close(); }
  }
});

test("the captured operation deadline stops actual in-flight work and cannot launch a replacement role", { skip: process.platform !== "darwin" }, async () => {
  const f = await fixture();
  try {
    const started = await f.start({ ...f.input, timeoutMs: 4000, input: { ...f.input.input, task: "generated slow owned deadline" } });
    await waitFor(() => f.requests.length === 1);
    const record = await f.settled(started.id);
    assert.ok(["stopped", "partial"].includes(record.status)); assert.match(record.diagnostic ?? "", /deadline expired/);
    assert.equal(record.stopRequested, true); assert.equal(f.requests.length, 1);
    assert.equal(f.control.snapshot().budgetPlans.filter((plan) => plan.status === "released").length, 2);
  } finally { await f.close(); }
});

test("lost receipts and explicitly deleted original intent never look up a root/model or dispatch paid work again", { skip: process.platform !== "darwin" }, async (t) => {
  const f = await fixture();
  try {
    const started = await f.start(), record = await f.settled(started.id);
    f.service.store.db.prepare("DELETE FROM receipts WHERE profile_id=? AND id=?").run(f.control.profileId, started.commandId);
    const preview = t.mock.method(f.execution, "preview", async () => { throw new Error("Original role intent must be checked before preview or root/model lookup."); });
    assert.deepEqual(await f.control.executeOwnedRoles(started.value, started.review, started.commandId), { id: record.id, revision: record.revision });
    assert.equal(preview.mock.callCount(), 0); assert.equal(f.requests.length, 3);
    await assert.rejects(() => f.execution.execute(started.value, started.review, f.finish(started.commandId, "b".repeat(64))), { code: "command_reused" });
    const artifact = (await f.sdk.artifacts.read(record.id)).artifact;
    await f.sdk.artifacts.delete(record.id, artifact.revision, true);
    f.service.store.db.prepare("DELETE FROM receipts WHERE profile_id=? AND id=?").run(f.control.profileId, started.commandId);
    await assert.rejects(() => f.control.executeOwnedRoles(started.value, started.review, started.commandId), { code: "role_sequence_deleted" });
    assert.equal(preview.mock.callCount(), 0); assert.equal(f.requests.length, 3);
  } finally { t.mock.restoreAll(); await f.close(); }
});

test("an alternate advertised model without an approved privacy-eligible pool cannot receive the original data", async () => {
  const f = await fixture();
  try {
    const alternative = `${f.modelId}-generated-alias`;
    f.provider.state.models.push({ ...f.provider.state.models[0]!, id: alternative }); f.provider.onChange();
    const value = structuredClone(f.input); value.roles[1]!.modelId = alternative;
    await assert.rejects(() => f.execution.preview(value), { code: "routing_disabled" });
    assert.equal(f.requests.length, 0); assert.equal(f.control.snapshot().roleSequences.length, 0); assert.equal(f.control.snapshot().budgetPlans.length, 0);
  } finally { await f.close(); }
});

test("an automatic composer pool cannot approve alternate models for the private owned-role executor", async () => {
  const f = await fixture();
  try {
    const alternative = `${f.modelId}-generated-private-alias`;
    f.provider.state.models.push({ ...f.provider.state.models[0]!, id: alternative }); f.provider.onChange();
    await f.sdk.refresh();
    const policy = f.sdk.routing.policy(); assert.ok(policy?.workflow === "auto");
    await f.sdk.routing.configure({ ...policy, classifierModelId: f.modelId, approvedModelIds: [alternative] }, f.sdk.settings.get()!.revision);
    const value = structuredClone(f.input); value.roles[1]!.modelId = alternative;
    await assert.rejects(() => f.execution.preview(value), { code: "routing_disabled" });
    assert.equal(f.requests.length, 0); assert.equal(f.control.snapshot().roleSequences.length, 0); assert.equal(f.control.snapshot().budgetPlans.length, 0);
  } finally { await f.close(); }
});

test("owned admission snapshots caller input and cost review before yielding rather than following later object mutation", { skip: process.platform !== "darwin", timeout: ciTime(20_000) }, async (t) => {
  const f = await fixture(), gate = Promise.withResolvers<void>(), captured = Promise.withResolvers<void>();
  try {
    const preview = f.execution.preview.bind(f.execution), input = structuredClone(f.input), prepared = await preview(input);
    const review = { digest: prepared.digest, confirmCost: true as const };
    t.mock.method(f.execution, "preview", async (value: OwnedRoleInput, signal?: AbortSignal) => {
      const result = await preview(value, signal); captured.resolve(); await gate.promise; return result;
    });
    const pending = f.execution.execute(input, review, f.finish(randomUUID(), digest(JSON.stringify({ input, review }))));
    await captured.promise;
    input.sessionId = "generated-foreign-mutation"; input.input.task = "Generated mutated task not authorized by this review.";
    input.roles[0]!.instruction = "Generated mutated instruction not authorized by this review."; review.digest = "f".repeat(64); gate.resolve();
    const started = await pending; assert.ok(started.id);
    const record = await f.settled(started.id), document = f.execution.document(record);
    assert.equal(record.status, "completed"); assert.equal(document.base.task, f.input.input.task);
    assert.equal(document.roles[0]!.instruction, f.input.roles[0]!.instruction); assert.equal(f.requests.length, 3);
  } finally { gate.resolve(); t.mock.restoreAll(); await f.close(); }
});

test("changed original receipt ownership while source review is held cannot be adopted as a new paid intent", { timeout: ciTime(15_000) }, async (t) => {
  const f = await fixture(), gate = Promise.withResolvers<void>(), captured = Promise.withResolvers<void>();
  try {
    const preview = f.execution.preview.bind(f.execution), prepared = await preview(f.input), review = { digest: prepared.digest, confirmCost: true as const };
    t.mock.method(f.execution, "preview", async (value: OwnedRoleInput, signal?: AbortSignal) => {
      const result = await preview(value, signal); captured.resolve(); await gate.promise; return result;
    });
    const finish = f.finish(randomUUID(), digest("Generated original immutable role intent.")), pending = f.execution.execute(f.input, review, finish);
    await captured.promise; finish.intent!.digest = digest("Generated changed receipt ownership."); gate.resolve();
    await assert.rejects(() => pending, { code: "owned_role_intent" });
    assert.equal(f.requests.length, 0); assert.equal(f.control.snapshot().roleSequences.length, 0); assert.equal(f.control.snapshot().budgetPlans.length, 0);
  } finally { gate.resolve(); t.mock.restoreAll(); await f.close(); }
});

test("actual generated role inputs/results survive source deletion and service reopen without a checkout or model preparation", { skip: process.platform !== "darwin" }, async (t) => {
  const f = await fixture(); let reopened: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    const started = await f.start(), original = await f.settled(started.id);
    await f.sdk.sessions.delete(f.sessionId, true, f.session().revision); await f.service.close();
    const roots = t.mock.method(ManagedWorkspaces.prototype, "project", () => { throw new Error("Retained roles must not recover a deleted source root."); });
    const models = t.mock.method(f.provider, "prepare", async () => { throw new Error("Retained roles must not redispatch a model."); });
    reopened = await startService({ stateDir: join(f.directory, "state"), provider: f.provider, retentionKey: GENERATED_RETENTION_KEY });
    const sdk = await new MoguriSdk(reopened.connection).ready();
    try {
      const read = await sdk.roleSequences.read(started.id, 2);
      assert.equal(read.sequence.status, "completed"); assert.equal(read.sequence.inputDigest, original.inputDigest);
      assert.ok(read.step?.input?.includes(ownedRoleMarker)); assert.ok(read.step?.result?.includes(ownedRoleMarker));
      assert.equal(JSON.parse((await sdk.artifacts.export(started.id)).export.text).schemaVersion, 4);
      assert.equal((await sdk.budgets.dashboard()).totals.reportedTokens, 126);
      assert.deepEqual(reopened.controller.platform.roles.original(started.commandId, started.commandDigest), { id: started.id, revision: original.revision });
      assert.equal(roots.mock.callCount(), 0); assert.equal(models.mock.callCount(), 0); assert.equal(f.requests.length, 3);
    } finally { sdk.disconnect(); }
  } finally { await reopened?.close(); t.mock.restoreAll(); await f.close(); }
});
