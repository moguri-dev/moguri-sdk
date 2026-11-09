import assert from "node:assert/strict";
import test from "node:test";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { reviewNativeTools, setupFixture } from "./fixture.ts";
import { runProgram } from "../apps/service/src/program.ts";
import { digest } from "../apps/service/src/store.ts";

test("every admitted turn owns real before/terminal checkpoints, not a reconstruction of current files", async () => {
  const fixture = await setupFixture({ responseMode: "text" }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await writeFile(join(fixture.project, "generated.txt"), "Generated before-turn dirty bytes.");
    await fixture.configure(); await fixture.send("Generated checkpointed conversation."); await fixture.terminal();
    await writeFile(join(fixture.project, "generated.txt"), "Generated later external bytes.");
    const listed = await sdk.checkpoints.list(fixture.sessionId);
    assert.equal(listed.checkpoints.length, 1);
    const checkpoint = listed.checkpoints[0]!;
    assert.equal(checkpoint.terminal?.outcome, "completed");
    const original = await sdk.checkpoints.read(fixture.sessionId, checkpoint.id);
    assert.equal(original.before?.roots[0]?.files.find((file) => file.path === "generated.txt")?.content,
      Buffer.from("Generated before-turn dirty bytes.").toString("base64"));
    assert.equal(fixture.requests.length > 0, true);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("conversation rewind preserves later history, drafts, controls and accounting without replay", async () => {
  const fixture = await setupFixture({ responseMode: "text" }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.configure(); await fixture.send("Generated retained first turn."); await fixture.terminal();
    await fixture.send("Generated abandoned second turn."); await fixture.terminal();
    await sdk.checkpoints.settle(fixture.sessionId);
    await sdk.command({ type: "draft.save", sessionId: fixture.sessionId, text: "Generated unsent current draft.", attachments: [], expectedRevision: fixture.session().draft.revision });
    const listed = await sdk.checkpoints.list(fixture.sessionId), target = listed.checkpoints[0]!;
    const history = fixture.service.controller.events(0), entries = structuredClone(fixture.service.controller.snapshot().budgetEntries);
    const controls = structuredClone(fixture.session().controls), calls = fixture.requests.length;
    const { preview } = await sdk.checkpoints.preview(fixture.sessionId, target.id, "conversation");
    assert.deepEqual(preview.blockers, []);
    await sdk.checkpoints.apply(fixture.sessionId, target.id, "conversation", preview.digest);
    assert.equal(fixture.session().draft.text, "Generated unsent current draft.");
    assert.deepEqual(fixture.session().controls, controls);
    assert.deepEqual(fixture.service.controller.snapshot().budgetEntries, entries);
    assert.equal(fixture.requests.length, calls);
    assert.ok(fixture.session().messages.some((message) => message.text.includes("Generated abandoned second turn.")));
    assert.deepEqual(fixture.service.controller.events(0).slice(0, history.length), history);
    await fixture.send("Generated new branch third turn."); await fixture.terminal();
    assert.doesNotMatch(JSON.stringify(fixture.requests.at(-1)), /Generated abandoned second turn/);
    assert.match(JSON.stringify(fixture.requests.at(-1)), /Generated retained first turn/);
    assert.equal((await sdk.checkpoints.list(fixture.sessionId)).rewinds[0]?.status, "completed");
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("workspace rewind requires exact external-edit decisions and preserves staged, untracked and displaced bytes", async () => {
  const before = "Generated original dirty bytes.", changed = "Generated owned turn bytes.";
  const fixture = await setupFixture({ toolCall: { name: "write_file", args: { path: "generated.txt", text: changed, expectedDigest: digest(before) } } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await writeFile(join(fixture.project, "generated.txt"), "Generated staged bytes.");
    const git = (args: string[]) => runProgram("git", args, { cwd: fixture.project, signal: AbortSignal.timeout(5000), timeoutMs: 5000, label: "Generated checkpoint Git intent" });
    await git(["init", "-q"]); await git(["add", "--", "generated.txt"]);
    const index = await git(["ls-files", "--stage"]);
    await writeFile(join(fixture.project, "generated.txt"), before);
    await writeFile(join(fixture.project, "untracked.txt"), "Generated pre-existing untracked file.");
    await reviewNativeTools(fixture, ["write_file"]);
    await fixture.configure(); await fixture.send("Generated owned workspace change."); await fixture.approve(); await fixture.terminal();
    await sdk.checkpoints.settle(fixture.sessionId);
    await writeFile(join(fixture.project, "generated.txt"), "Generated later external edit.");
    await writeFile(join(fixture.project, "external.txt"), "Generated unrelated external file.");
    const checkpoint = (await sdk.checkpoints.list(fixture.sessionId)).checkpoints[0]!;
    const { preview } = await sdk.checkpoints.preview(fixture.sessionId, checkpoint.id, "workspace");
    assert.deepEqual(preview.blockers, []);
    assert.equal(preview.files.length, 1); assert.match(preview.files[0]!.conflict!, /External/);
    await assert.rejects(() => sdk.checkpoints.apply(fixture.sessionId, checkpoint.id, "workspace", preview.digest), /conflict.*decision/i);
    const restored = await sdk.checkpoints.apply(fixture.sessionId, checkpoint.id, "workspace", preview.digest, [
      { root: await realpath(fixture.project), path: "generated.txt", choice: "restore-checkpoint" },
    ]);
    assert.equal(await readFile(join(fixture.project, "generated.txt"), "utf8"), before);
    assert.equal(await readFile(join(fixture.project, "untracked.txt"), "utf8"), "Generated pre-existing untracked file.");
    assert.equal(await readFile(join(fixture.project, "external.txt"), "utf8"), "Generated unrelated external file.");
    assert.equal(await git(["ls-files", "--stage"]), index);
    const inspected = await sdk.checkpoints.inspect(fixture.sessionId, restored.id!);
    assert.equal(inspected.record.status, "completed");
    assert.equal(inspected.effects[0]?.backupDigest, digest("Generated later external edit."));
  } finally { sdk.disconnect(); await fixture.close(); }
});
