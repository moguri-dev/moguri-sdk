import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isRecord, MoguriSdk, parse, SlashResultSchema, type SlashResult } from "../packages/sdk/src/index.ts";
import { setupFixture, waitFor } from "./fixture.ts";

test("the actual queued TUI preview/apply uses its original input and never turns rewind into a model prompt", async () => {
  const fixture = await setupFixture({ responseMode: "text" }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.configure(); await fixture.send("Generated original TUI checkpoint."); await fixture.terminal();
    await sdk.checkpoints.settle(fixture.sessionId);
    const checkpoint = (await sdk.checkpoints.list(fixture.sessionId)).checkpoints[0]!, calls = fixture.requests.length;
    const execute = async (text: string): Promise<SlashResult> => {
      const old = new Set(fixture.service.controller.snapshot().commandExecutions.map((entry) => entry.id));
      const saved = await sdk.command({ type: "draft.save", sessionId: fixture.sessionId, expectedRevision: fixture.session().draft.revision, text, attachments: [] });
      await sdk.command({ type: "message.send", sessionId: fixture.sessionId, expectedRevision: saved.revision!, delivery: "queue", client: "tui" });
      const execution = await waitFor(() => fixture.service.controller.snapshot().commandExecutions.find((entry) => !old.has(entry.id) &&
        entry.sessionId === fixture.sessionId && ["completed", "failed", "partial"].includes(entry.status)));
      assert.equal(execution.status, "completed", execution.diagnostic ?? "");
      assert.ok(execution.resultDigest);
      const document: unknown = JSON.parse(fixture.service.store.blob(execution.resultDigest));
      assert.ok(isRecord(document));
      return parse(SlashResultSchema, document.result);
    };
    const reviewed = await execute(`/rewind preview ${checkpoint.id} conversation`);
    assert.equal(reviewed.kind, "text"); if (reviewed.kind !== "text") throw new Error("Missing original preview.");
    const result: unknown = JSON.parse(reviewed.text);
    assert.ok(isRecord(result) && isRecord(result.preview) && typeof result.preview.digest === "string");
    const applied = await execute(`/rewind apply ${checkpoint.id} conversation ${result.preview.digest} confirm-rewind []`);
    assert.equal(applied.kind, "text");
    assert.equal(fixture.service.controller.snapshot().rewinds[0]?.status, "completed");
    assert.equal(fixture.session().queue.length, 0); assert.equal(fixture.requests.length, calls);
    assert.ok(fixture.service.controller.snapshot().commandExecutions.every((entry) => entry.actor === "user"));
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("the shared CLI/TUI skill grammar admits only an exact full source review and retains actual-user revocation", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const root = join(fixture.directory, "generated-command-skill");
    await mkdir(root); await writeFile(join(root, "SKILL.md"), "---\nname: generated-review\ndescription: Generated command review\n---\nGenerated complete instructions.\n");
    const settings = sdk.settings.get()!;
    await sdk.settings.update({ ...settings.values, skillSources: [{ id: "generated-source", name: "Generated command source", kind: "local", path: root, enabled: true }] }, settings.revision);
    const skill = (await sdk.skills.find("", { sessionId: fixture.sessionId })).skills[0]!;
    const read = await sdk.slash(fixture.sessionId, `/skills inspect ${skill.id} ${skill.digest}`, "cli");
    assert.equal(read.kind, "text");
    const inspection = (await sdk.skills.inspect(fixture.sessionId, skill.id, skill.digest)).inspection;
    const input = JSON.stringify({ skillId: skill.id, expectedDigest: skill.digest, publisher: { kind: "unverified-local", acknowledge: "publisher-not-verified" }, access: "read-only", paths: ["."], validHours: 24 });
    const admitted = await sdk.slash(fixture.sessionId, `/skills admit ${inspection.digest} confirm-reviewed ${input}`, "tui");
    assert.equal(admitted.kind, "text");
    const grant = (await sdk.skills.audit(fixture.sessionId)).admissions[0]!;
    await sdk.slash(fixture.sessionId, `/skills revoke ${grant.id} ${grant.revision} confirm-revoke Generated exact source revocation.`, "cli");
    assert.equal((await sdk.skills.audit(fixture.sessionId)).admissions[0]?.state, "revoked");
    await assert.rejects(() => sdk.skills.admit({ sessionId: fixture.sessionId, skillId: skill.id, expectedDigest: skill.digest,
      expectedInspectionDigest: inspection.digest, publisher: { kind: "unverified-local", acknowledge: "publisher-not-verified" }, access: "read-only", paths: ["."], validHours: 24 }), /changed|fresh|review/i);
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});
