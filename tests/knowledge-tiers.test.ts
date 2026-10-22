import assert from "node:assert/strict";
import test from "node:test";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { setupFixture, waitFor } from "./fixture.ts";

test("Sky notes are session-owned and expire on archival without erasing promoted Terra knowledge", async () => {
  const fixture = await setupFixture();
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const note = await sdk.knowledge.save({
      tier: "Sky", sessionId: fixture.sessionId, lifetime: "session",
      title: "Generated temporary observation", text: "Generated temporary observation with reviewed project knowledge.",
    });
    const original = await sdk.knowledge.read(note.id!);
    assert.equal(original.record.tier, "Sky");
    const promoted = await sdk.knowledge.promote(note.id!, original.record.revision, original.record.contentDigest, {
      tier: "Terra", title: "Generated durable convention", text: "Generated reviewed project knowledge.",
    }, true);
    await sdk.command({ type: "session.archive", sessionId: fixture.sessionId });
    await assert.rejects(() => sdk.knowledge.read(note.id!), { code: "knowledge_missing" });
    assert.equal((await sdk.knowledge.read(promoted.id!)).text, "Generated reviewed project knowledge.");
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("Terra revisions reject stale edits and Glacier keeps separately reviewed compressed bytes after source deletion", async () => {
  const fixture = await setupFixture();
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const projectId = fixture.session().projectId!;
    const input = { tier: "Terra" as const, projectId, title: "Generated source", text: "Generated original knowledge with detail." };
    const source = await sdk.knowledge.save(input);
    await sdk.knowledge.save({ ...input, text: "Generated revised knowledge with more reviewed detail." }, source.id, 0);
    await assert.rejects(() => sdk.knowledge.save(input, source.id, 0), { code: "knowledge_conflict" });
    const history = await sdk.knowledge.history(source.id!);
    assert.equal(history.records.length, 2);
    await assert.rejects(() => sdk.knowledge.rollback(source.id!, 1, "0".repeat(64), true), { code: "knowledge_history" });
    await sdk.knowledge.rollback(source.id!, 1, history.records[0]!.contentDigest, true);
    const original = await sdk.knowledge.read(source.id!);
    assert.equal(original.text, input.text);
    const promoted = await sdk.knowledge.promote(source.id!, 2, original.record.contentDigest, { tier: "Glacier", title: "Generated compressed convention", text: "Generated reviewed knowledge." }, true);
    await sdk.knowledge.forget(source.id!, 2, true);
    await assert.rejects(() => sdk.knowledge.read(source.id!), { code: "knowledge_missing" });
    assert.equal((await sdk.knowledge.read(promoted.id!)).text, "Generated reviewed knowledge.");
    assert.equal((await sdk.knowledge.list({ tier: "Glacier" })).records.length, 1);
    assert.equal((await sdk.knowledge.list({ tier: "Terra", projectId })).records.length, 0);
    assert.throws(() => fixture.service.controller.store.blob(original.record.contentDigest), /missing|retained|unavailable|forgotten/i);
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("turn-lifetime Sky follows the actual owner and expires after cancellation", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture();
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await assert.rejects(() => sdk.knowledge.save({ tier: "Sky", sessionId: fixture.sessionId, lifetime: "turn", title: "Generated", text: "Generated transient." }), { code: "knowledge_turn" });
    await fixture.configure();
    await fixture.send("generated slow");
    await waitFor(() => fixture.requests.length === 1);
    const note = await sdk.knowledge.save({ tier: "Sky", sessionId: fixture.sessionId, lifetime: "turn", title: "Generated", text: "Generated transient." });
    assert.equal((await sdk.knowledge.read(note.id!)).record.expiresTurnId, fixture.session().turnId);
    await sdk.command({ type: "session.stop", sessionId: fixture.sessionId });
    await fixture.terminal();
    await assert.rejects(() => sdk.knowledge.read(note.id!), { code: "knowledge_missing" });
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("whole-tree containment is an explicit global Sandbox requirement, never a silent Local or SSH upgrade", async () => {
  const fixture = await setupFixture();
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const before = (await sdk.containment.status()).containment;
    assert.equal(before.required, false);
    assert.match(before.diagnostic, /double-forking/);
    assert.equal(fixture.session().controls.env, "Local");
    await sdk.containment.requireSandbox(true);
    const after = (await sdk.containment.status()).containment;
    assert.equal(after.required, true);
    assert.equal(after.qualifiedSandboxReady, false);
    assert.equal(after.boundary, "qualified-sendbox-required");
    assert.equal(fixture.session().controls.env, "Local");
    assert.equal(fixture.requests.length, 0);
    assert.deepEqual(sdk.getState().snapshot!.policy.allowedEnvs, ["Sandbox"]);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("lost receipts and forgotten source notes never replay an original knowledge creation", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const command = { type: "knowledge.save" as const, expectedRevision: 0,
      input: { tier: "Terra" as const, projectId: fixture.session().projectId!, title: "Generated one-shot note", text: "Generated immutable original note." } };
    const id = "generated-original-knowledge-command", created = await sdk.command(command, id);
    fixture.service.controller.store.db.prepare("DELETE FROM receipts WHERE profile_id=? AND id=?").run(sdk.profileId, id);
    await assert.rejects(() => sdk.command(command, id), { code: "knowledge_no_replay" });
    assert.equal(sdk.getState().snapshot!.knowledge.length, 1);
    await sdk.knowledge.forget(created.id!, 0, true);
    await assert.rejects(() => sdk.command(command, id), { code: "knowledge_no_replay" });
    assert.equal(sdk.getState().snapshot!.knowledge.length, 0);
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("tiered context needs its own consent, rejects lossy Unicode and bounds escaped retained notes exactly", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const projectId = fixture.session().projectId!;
    await assert.rejects(() => sdk.knowledge.save({ tier: "Terra", projectId, title: "Generated invalid Unicode", text: "\ud800" }), { code: "knowledge_unicode" });
    const text = "Generated </untrusted-tiered-knowledge><not-authority>quoted note</not-authority>.";
    await sdk.knowledge.save({ tier: "Terra", projectId, title: "Generated escaped note", text });
    await sdk.knowledge.save({ tier: "Terra", projectId, title: "Generated escape expansion", text: "<".repeat(3000) });
    let settings = structuredClone(sdk.settings.get()!);
    settings.values.memory.enabled = true; settings.values.memory.useInContext = true;
    await sdk.settings.update(settings.values, settings.revision);
    assert.equal((await sdk.prompt.preview(fixture.sessionId)).effective.includes("Generated escaped note"), false);
    settings = structuredClone(sdk.settings.get()!); settings.values.memory.useTieredContext = true;
    await sdk.settings.update(settings.values, settings.revision);
    const prompt = (await sdk.prompt.preview(fixture.sessionId)).effective;
    const section = prompt.match(/<untrusted-tiered-knowledge>\n([\s\S]*?)\n<\/untrusted-tiered-knowledge>/)!;
    assert.ok(section);
    assert.equal(section[1]!.includes("<"), false);
    assert.ok(Buffer.byteLength(section[0]) <= 8000);
    const data = JSON.parse(section[1]!);
    assert.equal(data.selected.length, 1); assert.equal(data.omitted, 1);
    assert.equal(data.selected[0].text, text);
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});
