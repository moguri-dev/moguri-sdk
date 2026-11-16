import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { digest } from "../apps/service/src/store.ts";
import { admitGeneratedSkill, setupFixture, waitFor, type GeneratedProviderOptions } from "./fixture.ts";

async function skillFixture(options: GeneratedProviderOptions = {}) {
  const f = await setupFixture(options), sdk = await new MoguriSdk(f.service.connection).ready();
  try {
    const root = join(f.directory, "generated-explicit-skill"); await mkdir(root);
    const body = "---\nname: generated-explicit-load\ndescription: Generated source loaded only by an exact request\n---\nUse generated fixtures; discovery is not this complete source.\n";
    await writeFile(join(root, "SKILL.md"), body);
    const settings = sdk.settings.get()!;
    await sdk.settings.update({ ...settings.values, skillSources: [{ id: "generated-explicit", name: "Generated explicit source", kind: "local", path: root, enabled: true }] }, settings.revision);
    const skill = (await sdk.skills.find("", { sessionId: f.sessionId })).skills[0]!;
    return { f, sdk, skill, body };
  } catch (error) { sdk.disconnect(); await f.close(); throw error; }
}

test("skill discovery and diagnostic inspection never claim a load; exact complete consumption retains a named source activity", async () => {
  const { f, sdk, skill, body } = await skillFixture();
  try {
    await sdk.skills.read(skill.id, skill.digest, f.sessionId); await sdk.skills.inspect(f.sessionId, skill.id, skill.digest);
    assert.equal(f.service.controller.events(0).some((event) => event.event_type === "skill.loaded"), false);
    const loaded = await sdk.skills.consume(f.sessionId, skill.id, skill.digest);
    const [grant] = (await sdk.skills.audit(f.sessionId)).admissions;
    const enabling = f.service.controller.events(0).findLast((event) => event.event_type === "settings.updated" &&
      Boolean(event.payload.settings.skillSources?.some((source) => source.id === "generated-explicit" && source.enabled)));
    assert.deepEqual([grant?.basis, grant?.actor, grant?.access, grant?.commandId], ["trusted-source", "user", "read-only", enabling?.id]);
    const event = f.service.controller.events(0).find((event) => event.event_type === "skill.loaded");
    assert.ok(event && event.event_type === "skill.loaded");
    assert.equal(event.payload.name, skill.name); assert.equal(event.payload.actor, "model");
    assert.equal(event.payload.contentDigest, digest(loaded.body)); assert.equal(event.payload.bytes, Buffer.byteLength(loaded.body));
    assert.ok(loaded.body.includes(body)); assert.equal(f.service.store.blob(event.payload.contentDigest), loaded.body);
    const activity = (await sdk.activity.list(f.sessionId)).activity.entries.filter((entry) => entry.kind === "load-skill");
    assert.equal(activity.length, 1); assert.equal(activity[0]?.subject, skill.name); assert.equal(activity[0]?.label, "Loaded skill");
    assert.equal(f.requests.length, 0);
  } finally { sdk.disconnect(); await f.close(); }
});

test("an actual native skill-load call records one named operation in its owning turn, not a second inferred skill activity", async () => {
  const options: GeneratedProviderOptions = {};
  const { f, sdk, skill } = await skillFixture(options);
  try {
    await admitGeneratedSkill(sdk, f.sessionId, skill.id, skill.digest);
    options.toolCall = { name: "use_skill", args: { action: "load", id: skill.id, expectedDigest: skill.digest } };
    await f.configure(); await f.send("Generated actual explicit skill loading.");
    await waitFor(() => f.session().pendingApproval || ["completed", "failed", "partial", "stopped"].includes(f.session().status));
    if (f.session().pendingApproval) await f.approve();
    await f.terminal();
    const events = f.service.controller.events(0), event = events.find((event) => event.event_type === "skill.loaded");
    assert.ok(event && event.event_type === "skill.loaded");
    const started = events.find((value) => value.event_type === "tool.started" && value.payload.call.name === "use_skill");
    assert.ok(started && started.event_type === "tool.started");
    assert.equal(event.payload.callId, started.payload.call.id); assert.equal(event.turn_id, started.turn_id);
    const rows = (await sdk.activity.list(f.sessionId)).activity.entries.filter((entry) => entry.kind === "load-skill");
    assert.equal(rows.length, 1); assert.equal(rows[0]?.turnId, event.turn_id); assert.equal(rows[0]?.subject, skill.name);
    assert.ok(f.requests.length >= 2); assert.ok(JSON.stringify(f.requests.at(-1)?.messages).includes("discovery is not this complete source"));
  } finally { sdk.disconnect(); await f.close(); }
});

test("cancelled, changed and revoked skill loads never publish successful source icons or inference", async () => {
  const { f, sdk, skill } = await skillFixture();
  try {
    await admitGeneratedSkill(sdk, f.sessionId, skill.id, skill.digest);
    await assert.rejects(() => sdk.skills.consume(f.sessionId, skill.id, skill.digest, AbortSignal.abort(new Error("Generated exact skill cancellation."))), /cancel|abort/i);
    await assert.rejects(() => sdk.skills.consume(f.sessionId, skill.id, "0".repeat(64)), /changed|source/i);
    const grant = (await sdk.skills.audit(f.sessionId)).admissions[0]!;
    await sdk.skills.revoke(f.sessionId, grant.id, grant.revision, "Generated actual-user revocation.");
    await assert.rejects(() => sdk.skills.consume(f.sessionId, skill.id, skill.digest), /revoked|admission|review/i);
    assert.equal(f.service.controller.events(0).some((event) => event.event_type === "skill.loaded"), false);
    assert.equal((await sdk.activity.list(f.sessionId)).activity.entries.some((entry) => entry.kind === "load-skill"), false);
    assert.equal(f.requests.length, 0);
  } finally { sdk.disconnect(); await f.close(); }
});
