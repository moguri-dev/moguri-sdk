import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { startService } from "../apps/service/src/server.ts";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { budgetPlanFixture } from "./fixtures/budget-plan-api.ts";

type Fixture = Awaited<ReturnType<typeof budgetPlanFixture>>;
const inputs = (f: Fixture) => [0, 1].map(() => ({ ...f.request, id: randomUUID() }));
async function limit(f: Fixture, scope: "session" | "profile" | "global", tokens: number) {
  if (scope === "session") await f.sdk.sessions.configure(f.sessionId, { ...f.session().controls, budget: { kind: "limited", basis: "estimate", tokens } }, f.session().revision);
  else if (scope === "profile") await f.sdk.budgets.policy({ basis: "estimate", tokens }, f.control.snapshot().budgetPolicy.revision, true);
  else await f.sdk.profiles.globalBudget({ basis: "estimate", tokens }, (await f.sdk.profiles.list()).catalog.globalBudget.revision, true);
}

test("an entire planned-capacity batch must fit current session/profile/global limits, never independent overlapping views of the same capacity", async () => {
  for (const scope of ["session", "profile", "global"] as const) {
    const f = await budgetPlanFixture();
    try {
      const requests = inputs(f); await limit(f, scope, 59);
      assert.throws(() => f.budget.planBatch(f.session(), requests), { code: "budget_plan_capacity" });
      assert.equal(f.control.snapshot().budgetPlans.length, 0); assert.equal(f.budget.status(f.sessionId).totals.calls, 0);
      await limit(f, scope, 60);
      const planned = f.budget.planBatch(f.session(), requests);
      assert.equal(planned.plans.length, 2); assert.equal(f.control.snapshot().budgetPlans.length, 0);
      f.append(planned.events);
      const status = f.budget.status(f.sessionId);
      assert.equal(status.totals.plannedHolds, 2); assert.equal(status.totals.heldTokens, 60); assert.equal(status.remainingTokens, 0);
      assert.equal(status.totals.calls, 0); assert.equal(status.totals.billedUsd, null); assert.equal(f.requests.length, 0);
    } finally { await f.close(); }
  }
});

test("batch planning resolves current authoritative controls rather than a caller's stale generous session", async () => {
  const f = await budgetPlanFixture();
  try {
    const stale = f.session(); await limit(f, "session", 30);
    assert.throws(() => f.budget.planBatch(stale, inputs(f)), { code: "budget_exhausted" });
    assert.equal(f.control.snapshot().budgetPlans.length, 0); assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});

test("invalid, repeated or mixed-turn batch identities cannot leave a prefix or change the original requested bounds", async () => {
  const f = await budgetPlanFixture();
  try {
    const requests = inputs(f);
    for (const invalid of [[], [requests[0]!, requests[0]!], [requests[0]!, { ...requests[1]!, turnId: randomUUID() }], Array.from({ length: 33 }, () => ({ ...requests[0]!, id: randomUUID() }))]) {
      assert.throws(() => f.budget.planBatch(f.session(), invalid), { code: "budget_plan_batch" });
    }
    const planned = f.budget.planBatch(f.session(), requests);
    requests[0]!.inputEstimate = 99; requests[0]!.maxOutputTokens = 999;
    assert.equal(planned.plans[0]?.inputBound, 10); assert.equal(planned.plans[0]?.outputBound, 20);
    f.append(planned.events);
    assert.throws(() => f.budget.planBatch(f.session(), [{ ...f.request, id: planned.plans[1]!.id }]), { code: "budget_plan_duplicate" });
    assert.equal(f.control.snapshot().budgetPlans.length, 2); assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});

test("batch USD admission includes every prospective captured price and refuses stale/unknown prices instead of partial capacity", async () => {
  const f = await budgetPlanFixture();
  try {
    const settings = structuredClone(f.sdk.settings.get()!.values);
    settings.budgets.rates = [{ modelId: f.modelId, inputUsdPerMillion: 1, outputUsdPerMillion: 2, effectiveAt: new Date().toISOString().slice(0, 10), source: "user-estimate" }];
    await f.sdk.settings.update(settings, f.sdk.settings.get()!.revision);
    await f.sdk.profiles.globalBudget({ basis: "estimate", usd: 0.000099 }, 0, true);
    assert.throws(() => f.budget.planBatch(f.session(), inputs(f)), { code: "budget_plan_capacity" }); assert.equal(f.control.snapshot().budgetPlans.length, 0);
    await f.sdk.settings.update({ ...settings, budgets: { ...settings.budgets, rates: [{ ...settings.budgets.rates[0]!, effectiveAt: "2000-01-01" }] } }, f.sdk.settings.get()!.revision);
    assert.throws(() => f.budget.planBatch(f.session(), inputs(f)), { code: "budget_unavailable" }); assert.equal(f.control.snapshot().budgetPlans.length, 0);
    await f.sdk.settings.update(settings, f.sdk.settings.get()!.revision);
    await f.sdk.profiles.globalBudget({ basis: "estimate", usd: 0.000100 }, 1, true);
    const unknown = inputs(f); unknown[1] = { ...unknown[1]!, modelId: "generated-unpriced-model" };
    assert.throws(() => f.budget.planBatch(f.session(), unknown), { code: "budget_unavailable" }); assert.equal(f.control.snapshot().budgetPlans.length, 0);
    const planned = f.budget.planBatch(f.session(), inputs(f)); f.append(planned.events);
    assert.equal(f.budget.status(f.sessionId).remainingUsd, 0); assert.equal(f.budget.status(f.sessionId).totals.plannedHeldUsd, 0.000100);
    assert.deepEqual(planned.plans.map((plan) => plan.usdMicros), [50, 50]); assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});

test("batch planning includes foreign-profile capacity without exposing or reusing its holds", async () => {
  const f = await budgetPlanFixture();
  try {
    await limit(f, "global", 89); f.create();
    const created = await f.sdk.profiles.create("Generated batch capacity peer"); await f.sdk.profiles.wait(created.id!);
    const peer = await f.sdk.profiles.open(created.id!);
    try {
      const owner = await peer.sessions.create(null, "Generated batch peer owner"), control = await f.service.profiles.control(peer.profileId);
      const session = control.snapshot().sessions.find((session) => session.id === owner.id)!;
      assert.throws(() => control.platform.budgets.planBatch(session, inputs(f)), { code: "budget_plan_capacity" });
      assert.equal(control.snapshot().budgetPlans.length, 0); assert.equal((await peer.budgets.plans()).plans.length, 0);
      assert.equal(f.control.snapshot().budgetPlans.length, 1); assert.equal(f.requests.length, 0);
    } finally { peer.disconnect(); }
  } finally { await f.close(); }
});

test("failure appending the last planned hold rolls back the complete batch with no phantom call, prefix or receipt", async () => {
  const f = await budgetPlanFixture();
  try {
    const planned = f.budget.planBatch(f.session(), inputs(f)), before = f.service.store.db.prepare("SELECT seq,id,data,payload FROM events ORDER BY seq").all();
    f.service.store.db.exec(`CREATE TRIGGER generated_batch_failure BEFORE INSERT ON events
      WHEN json_extract(NEW.data,'$.event_type')='budget.plan_recorded' AND (SELECT count(*) FROM events WHERE json_extract(data,'$.event_type')='budget.plan_recorded')=1
      BEGIN SELECT RAISE(ABORT,'Generated last-plan failure'); END;`);
    const commandId = randomUUID(), commandDigest = "a".repeat(64);
    assert.throws(() => f.service.store.commit(planned.events, { id: commandId, digest: commandDigest, result: { id: planned.plans[0]!.id } }), /last-plan failure/);
    assert.equal(f.service.store.receipt(commandId, commandDigest), undefined);
    assert.deepEqual(f.service.store.db.prepare("SELECT seq,id,data,payload FROM events ORDER BY seq").all(), before);
    assert.equal(f.control.snapshot().budgetPlans.length, 0); assert.equal(f.control.snapshot().budgetEntries.length, 0); assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});

test("competing batch admissions append synchronously so only one complete batch owns the finite capacity", async () => {
  const f = await budgetPlanFixture();
  try {
    await limit(f, "profile", 60);
    const results = await Promise.allSettled([0, 1].map(async () => {
      await new Promise<void>((resolve) => setImmediate(resolve));
      const planned = f.budget.planBatch(f.session(), inputs(f)); f.append(planned.events); return planned;
    }));
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1); assert.equal(results.filter((result) => result.status === "rejected").length, 1);
    assert.equal(f.control.snapshot().budgetPlans.length, 2); assert.equal(f.budget.status(f.sessionId).totals.heldTokens, 60); assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});

test("batch capacity keeps an unreported consumed reservation held while unused plans release across source deletion and restart", async () => {
  const f = await budgetPlanFixture(); let reopened: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    const planned = f.budget.planBatch(f.session(), inputs(f)); f.append(planned.events); f.consume(planned.plans[0]!.id);
    await f.sdk.sessions.delete(f.sessionId, true, f.session().revision); await f.service.close();
    reopened = await startService({ stateDir: join(f.directory, "state"), provider: f.provider, retentionKey: f.retentionKey });
    const peer = await new MoguriSdk(reopened.connection).ready();
    try {
      const retained = (await peer.budgets.plans()).plans;
      assert.equal(retained.find((plan) => plan.id === planned.plans[0]!.id)?.status, "consumed");
      assert.equal(retained.find((plan) => plan.id === planned.plans[1]!.id)?.status, "released");
      const calls = await peer.budgets.calls(); assert.equal(calls.calls.length, 1); assert.equal(calls.calls[0]?.status, "reserved"); assert.equal(calls.calls[0]?.reportedTokens, null);
      assert.equal(calls.calls[0]?.reservedTokens, 30); assert.equal(f.requests.length, 0);
    } finally { peer.disconnect(); }
  } finally { await reopened?.close(); await f.close(); }
});

test("individually safe role envelopes cannot overflow the complete planned token amount into unknown or free capacity", { timeout: 10_000 }, async () => {
  const f = await budgetPlanFixture();
  try {
    const requests = inputs(f).map((input) => ({ ...input, inputEstimate: 0, maxOutputTokens: Number.MAX_SAFE_INTEGER }));
    const source = `
      import {BudgetRuntime} from ${JSON.stringify(new URL("../apps/service/src/budgets.ts", import.meta.url).href)};
      let text="";for await(const chunk of process.stdin)text+=chunk;
      const {snapshot,sessionId,requests}=JSON.parse(text),runtime=new BudgetRuntime({snapshot:()=>snapshot,events:()=>[]});
      try {runtime.planBatch(snapshot.sessions.find(session=>session.id===sessionId),requests);throw new Error("Unsafe batch overflow was accepted.");}
      catch(error){if(error.code!=="budget_overflow")throw error;process.stdout.write(error.code);}
    `;
    const execution = promisify(execFile)(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", source], { timeout: 5000 });
    execution.child.stdin?.end(JSON.stringify({ snapshot: f.control.snapshot(), sessionId: f.sessionId, requests }));
    assert.equal((await execution).stdout, "budget_overflow");
    assert.equal(f.control.snapshot().budgetPlans.length, 0); assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});
