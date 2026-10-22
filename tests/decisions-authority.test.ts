import assert from "node:assert/strict";
import { test } from "node:test";
import { waitFor, type GeneratedProviderOptions } from "./fixture.ts";
import { generatedAdvice, setupDecisions } from "./fixtures/decisions-api.ts";
import { mkdir, realpath, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

test("exact probabilities, confidence, complete metering and types gate advice independently; invalid/unavailable output keeps the human request and real charges", { skip: process.platform !== "darwin", timeout: 30000 }, async (t) => {
  const cases: Array<{ name: string; advice: GeneratedProviderOptions; unknown?: boolean }> = [
    { name: "low confidence", advice: { replyText: generatedAdvice("allow", 0.2) } },
    { name: "low selected probability", advice: { replyText: JSON.stringify({ answers: { action: { type: "choice", choice: "allow", confidence: 1, probabilities: { allow: 0.5, deny: 0.25, askUser: 0.25 } } } }) } },
    { name: "unreported usage", advice: { omitUsage: true }, unknown: true },
    { name: "malformed JSON", advice: { replyText: "Generated invalid JSON." } },
    { name: "fabricated approval", advice: { replyText: JSON.stringify({ ...JSON.parse(generatedAdvice()), approval: true }) } },
    { name: "foreign answer", advice: { replyText: generatedAdvice().replace('"choice":"allow"', '"choice":"foreign"') } },
    { name: "explicit human escalation", advice: { replyText: generatedAdvice("askUser") } },
    { name: "incomplete provider output", advice: { finishReason: "length" } },
  ];
  for (const example of cases) await t.test(example.name, async () => {
    const f = await setupDecisions({ advice: example.advice });
    try {
      await f.send("generated tool untrusted authority fixture");
      const record = await waitFor(() => f.service.controller.snapshot().decisions.find((record) => ["rejected", "failed", "partial"].includes(record.status)));
      assert.ok(record.diagnostic); assert.equal(record.applied, null); assert.equal(f.session().status, "waiting_input");
      const approval = f.session().pendingApproval; assert.ok(approval);
      assert.equal(f.service.controller.events(0).some((event) => event.event_type === "tool.started"), false);
      const charge = f.service.controller.snapshot().budgetEntries.find((entry) => entry.id === record.stepId); assert.ok(charge);
      assert.equal(charge.status, example.unknown ? "unknown" : "settled"); assert.equal(charge.reportedTokens, example.unknown ? null : 42);
      if (example.unknown) assert.ok(charge.reservedTokens && charge.reservedTokens > 256);
      assert.equal(f.requests.length, 1); assert.equal(f.advice.requests.length, 1);
      await f.sdk.command({ type: "approval.respond", sessionId: f.sessionId, approvalId: approval.id, allow: false }); await f.terminal();
      assert.equal(f.advice.requests.length, 1);
    } finally { await f.close(); }
  });
});

test("Max cannot pay for decisions on human-only requests or hard denials, even with confidence one and an existing competing allow", { skip: process.platform !== "darwin", timeout: 15000 }, async (t) => {
  for (const denied of [false, true]) await t.test(denied ? "hard denial wins" : "human-only request", async () => {
    const f = await setupDecisions({ delegated: denied, advice: { replyText: generatedAdvice("allow", 1) } });
    try {
      if (denied) {
        const settings = structuredClone(f.sdk.settings.get()!.values);
        settings.permissions.tools.push({ id: "generated-exact-denial", tool: "read_file", decision: "deny", pathPrefix: "fixture.txt" });
        await f.sdk.settings.update(settings, f.sdk.settings.get()!.revision);
      }
      await f.send("generated tool without decision authority");
      if (denied) await f.terminal();
      else {
        const approval = await waitFor(() => f.session().pendingApproval);
        await f.sdk.command({ type: "approval.respond", sessionId: f.sessionId, approvalId: approval.id, allow: false }); await f.terminal();
      }
      assert.equal(f.service.controller.snapshot().decisions.length, 0); assert.equal(f.advice.requests.length, 0);
      assert.equal(f.service.controller.events(0).some((event) => event.event_type === "tool.started"), false);
    } finally { await f.close(); }
  });
});

test("actual human approval wins an in-flight decision without fake attribution, duplicate tool start, another paid call or a refunded unknown hold", { skip: process.platform !== "darwin", timeout: 12000 }, async () => {
  const f = await setupDecisions({ advice: { stream: { chunks: [generatedAdvice("allow")], delayMs: 1500 } } });
  try {
    await f.send("generated tool actual human race");
    await waitFor(() => f.advice.requests.length === 1);
    const approval = f.session().pendingApproval; assert.ok(approval);
    await f.sdk.command({ type: "approval.respond", sessionId: f.sessionId, approvalId: approval.id, allow: true }); await f.terminal();
    const record = await waitFor(() => f.service.controller.snapshot().decisions.find((record) => record.status === "partial"));
    assert.equal(record.applied, null); assert.equal(f.advice.requests.length, 1);
    const events = f.service.controller.events(0);
    assert.equal(events.filter((event) => event.event_type === "tool.started").length, 1);
    assert.equal(events.filter((event) => event.event_type === "tool.decided" && event.payload.actor === "user").length, 1);
    assert.equal(events.some((event) => event.event_type === "tool.decided" && event.payload.actor === "decision-provider"), false);
    const charge = f.service.controller.snapshot().budgetEntries.find((entry) => entry.id === record.stepId); assert.ok(charge);
    assert.equal(charge.status, "unknown"); assert.equal(charge.reportedTokens, null); assert.ok(charge.reservedTokens);
    assert.equal(f.session().status, "completed");
  } finally { await f.close(); }
});

test("revoked delegation cancels the actual decision and invalidates confidence-one advice before execution", { skip: process.platform !== "darwin", timeout: 12000 }, async () => {
  const f = await setupDecisions({ advice: { stream: { chunks: [generatedAdvice("allow", 1)], delayMs: 1500 } } });
  try {
    await f.send("generated tool revoked delegation"); await waitFor(() => f.advice.requests.length === 1);
    const settings = structuredClone(f.sdk.settings.get()!.values);
    settings.permissions.tools.push({ id: "generated-revocation", tool: "read_file", decision: "deny", pathPrefix: "fixture.txt" });
    await f.sdk.settings.update(settings, f.sdk.settings.get()!.revision); await f.terminal();
    const record = await waitFor(() => f.service.controller.snapshot().decisions.find((record) => record.status === "partial"));
    assert.equal(record.applied, null); assert.equal(f.advice.requests.length, 1);
    assert.equal(f.service.controller.events(0).some((event) => event.event_type === "tool.started"), false);
    assert.equal(f.service.controller.snapshot().budgetEntries.find((entry) => entry.id === record.stepId)?.status, "unknown");
  } finally { await f.close(); }
});

test("disabling the configured decision provider pauses current Max at its next boundary instead of silently becoming ordinary generative Autopilot", { skip: process.platform !== "darwin", timeout: 12000 }, async () => {
  const f = await setupDecisions({ advice: { stream: { chunks: [generatedAdvice("allow", 1)], delayMs: 1500 } } });
  try {
    await f.send("generated tool revoked decision provider"); await waitFor(() => f.advice.requests.length === 1);
    const settings = structuredClone(f.sdk.settings.get()!.values); settings.decisions.enabled = false;
    await f.sdk.settings.update(settings, f.sdk.settings.get()!.revision); await f.terminal();
    assert.equal(f.session().status, "partial"); assert.equal(f.requests.length, 1); assert.equal(f.advice.requests.length, 1);
    assert.match(f.session().lastError ?? "", /decision provider|configured|configure/i);
    assert.equal(f.service.controller.events(0).some((event) => event.event_type === "tool.started"), false);
    assert.equal((await f.sdk.decisions.status(f.sessionId)).ready, false);
  } finally { await f.close(); }
});

test("an identical pathname with a replaced actual Local directory cannot adopt in-flight decision authority", { skip: process.platform !== "darwin", timeout: 12000 }, async () => {
  const f = await setupDecisions({ advice: { stream: { chunks: [generatedAdvice("allow", 1)], delayMs: 250 } } });
  try {
    await f.send("generated tool changed actual root"); await waitFor(() => f.advice.requests.length === 1);
    const root = await realpath(f.project); await rename(root, root + "-original"); await mkdir(root);
    await writeFile(join(root, "fixture.txt"), "Generated replacement root with distinct directory ownership.\n");
    await waitFor(() => f.service.controller.snapshot().decisions.some((record) => ["partial", "rejected"].includes(record.status)), 2500);
    const record = f.service.controller.snapshot().decisions[0]; assert.ok(record);
    assert.equal(record.applied, null); assert.ok(f.session().pendingApproval);
    assert.equal(f.service.controller.events(0).some((event) => event.event_type === "tool.started"), false);
  } finally { await f.close(); }
});
