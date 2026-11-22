import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { fixtureProvider, reviewNativeTools, waitFor } from "../fixture.ts";

const installed = resolve(process.argv[2] ?? ".");
const { createRuntime, connectMoguri } = await import(pathToFileURL(join(installed, "dist/sdk/node.mjs")).href);
const { PROTOCOL_VERSION } = await import(pathToFileURL(join(installed, "dist/sdk/index.mjs")).href);
assert.ok(PROTOCOL_VERSION >= 98);
const root = await mkdtemp(join(tmpdir(), "moguri-installed-skills-rewind-")), project = join(root, "project"), stateDir = join(root, "state");
await mkdir(project); await writeFile(join(project, "fixture.txt"), "Generated installed original.\n");
const providerOptions = { toolCall: { name: "write_file", args: { path: "fixture.txt", text: "Generated installed owned change.\n",
  expectedDigest: createHash("sha256").update("Generated installed original.\n").digest("hex") } } };
const generated = await fixtureProvider(providerOptions), options = { stateDir, retentionKey: Buffer.alloc(32, 0x73), provider: generated.provider };
let runtime, sdk, deletedNotificationId;
try {
  runtime = await createRuntime(options); sdk = await connectMoguri({ stateDir, autoStart: false });
  const projectId = (await sdk.projects.add(project)).id, sessionId = (await sdk.sessions.create(projectId, "Generated installed rewind", { modelId: generated.modelId })).id;
  const current = () => sdk.getState().snapshot.sessions.find((session) => session.id === sessionId);
  const slash = async (...argv) => {
    const result = await sdk.slash(sessionId, `/${argv.join(" ")}`, "cli");
    return result.kind === "text" ? JSON.parse(result.text) : result;
  };
  await reviewNativeTools(sdk, ["write_file"]);
  const send = async (text) => {
    const saved = await sdk.command({ type: "draft.save", sessionId, expectedRevision: current().draft.revision, text, attachments: [] });
    await sdk.command({ type: "message.send", sessionId, expectedRevision: saved.revision, delivery: "queue" });
  };
  await send("Generated installed checkpointed write.");
  const approval = await waitFor(() => current()?.pendingApproval);
  await sdk.approvals.respond(sessionId, approval.id, true);
  await waitFor(() => current()?.status === "completed" && !current()?.turnId);
  const original = (await slash("rewind", "list")).checkpoints[0];
  assert.ok(original.beforeDigest && original.terminal.afterDigest);
  const workspace = (await slash("rewind", "preview", original.id, "workspace")).preview;
  assert.deepEqual(workspace.blockers, []); assert.equal(workspace.files.length, 1);
  const initialCalls = generated.requests.length, initialBudget = structuredClone(sdk.getState().snapshot.budgetEntries);
  await slash("rewind", "apply", original.id, "workspace", workspace.digest, "confirm-rewind", "[]");
  assert.equal(await readFile(join(project, "fixture.txt"), "utf8"), "Generated installed original.\n");
  await sdk.refresh(); assert.deepEqual(sdk.getState().snapshot.budgetEntries, initialBudget); assert.equal(generated.requests.length, initialCalls);
  const source = join(root, "source"); await mkdir(source);
  await writeFile(join(source, "SKILL.md"), "---\nname: generated-installed\ndescription: Generated independently installed source\n---\nRead the complete bundled reference.\n");
  await writeFile(join(source, "reference.txt"), "Generated installed transitive source.");
  const settings = sdk.settings.get();
  await sdk.settings.update({ ...settings.values, skillSources: [{ id: "generated-source", name: "Generated installed source", kind: "local", path: source, enabled: true }] }, settings.revision);
  const skill = (await sdk.skills.find("", { sessionId })).skills[0], inspection = (await slash("skills", "inspect", skill.id, skill.digest)).inspection;
  assert.equal(inspection.files.length, 2);
  const admitted = await slash("skills", "admit", inspection.digest, "confirm-reviewed", JSON.stringify({ skillId: skill.id, expectedDigest: skill.digest,
    publisher: { kind: "unverified-local", acknowledge: "publisher-not-verified" }, access: "read-only", paths: ["."], validHours: 24 }));
  const loaded = await sdk.skills.consume(sessionId, skill.id, skill.digest);
  assert.match(loaded.body, /Generated installed transitive source/); assert.equal(loaded.provenance.actor, "model"); assert.equal(loaded.complete, true);
  if(PROTOCOL_VERSION>=99){
    const activity=(await sdk.activity.list(sessionId)).activity.entries.find(entry=>entry.kind==="load-skill"&&entry.subject===skill.name);
    assert.equal(activity?.label,"Loaded skill");assert.equal(activity.actor,"model");
    assert.match((await sdk.activity.read(sessionId,activity.id,"output")).content.text,/Generated installed transitive source/);
  }
  providerOptions.responseMode = "text"; providerOptions.omitUsage = true;
  await send("Generated installed admitted source context."); await waitFor(() => current()?.status === "completed" && !current()?.turnId);
  if(PROTOCOL_VERSION>=99){
    await sdk.refresh();const notification=sdk.attention.list().find(entry=>entry.sessionId===sessionId);
    assert.ok(notification);deletedNotificationId=notification.id;
    const calls=generated.requests.length,budget=structuredClone(sdk.getState().snapshot.budgetEntries);
    const shared=await sdk.slash(sessionId,"/inbox","tui");assert.equal(shared.kind,"text");assert.match(shared.text,new RegExp(notification.id));
    await sdk.attention.delete([notification.id]);await sdk.refresh();
    assert.equal(sdk.attention.list().some(entry=>entry.id===notification.id),false);
    assert.equal(current().status,"completed");assert.deepEqual(sdk.getState().snapshot.budgetEntries,budget);assert.equal(generated.requests.length,calls);
  }
  const consumed = (await sdk.checkpoints.list(sessionId)).checkpoints[0];
  const artifact = await sdk.artifacts.create(sessionId, { kind: "research-note", name: "Generated independent output", text: "Generated independent retained artifact." });
  await slash("skills", "revoke", admitted.id, "0", "confirm-revoke", "Generated installed revocation.");
  assert.equal((await slash("skills", "audit")).admissions[0].state, "revoked");
  await assert.rejects(() => sdk.skills.consume(sessionId, skill.id, skill.digest), /admission|revoked/);
  assert.match((await sdk.checkpoints.preview(sessionId, consumed.id, "conversation")).preview.blockers.join(" "), /source authority.*revoked/i);
  const saved = await sdk.command({ type: "draft.save", sessionId, expectedRevision: current().draft.revision, text: "Generated installed unsent current draft.", attachments: [] });
  assert.ok(saved.revision > 0);
  const calls = generated.requests.length, budget = structuredClone(sdk.getState().snapshot.budgetEntries);
  assert.ok(budget.some((entry) => entry.status === "unknown"));
  const { preview } = await sdk.checkpoints.preview(sessionId, original.id, "conversation");
  assert.deepEqual(preview.blockers, []);
  await sdk.checkpoints.apply(sessionId, original.id, "conversation", preview.digest);
  await sdk.checkpoints.prune(sessionId, consumed.id, consumed.revision);
  assert.equal((await sdk.checkpoints.read(sessionId, consumed.id)).state, null);
  assert.equal(current().draft.text, "Generated installed unsent current draft.");
  assert.equal((await sdk.artifacts.read(artifact.id)).text, "Generated independent retained artifact.");
  assert.deepEqual(sdk.getState().snapshot.budgetEntries, budget); assert.equal(generated.requests.length, calls);
  sdk.disconnect(); await runtime.close(); runtime = await createRuntime(options); sdk = await connectMoguri({ stateDir, autoStart: false });
  assert.equal((await sdk.skills.audit(sessionId)).admissions[0].state, "revoked");
  assert.equal((await sdk.checkpoints.read(sessionId, consumed.id)).state, null);
  assert.equal((await sdk.checkpoints.list(sessionId)).rewinds.length, 2);
  assert.equal((await sdk.artifacts.read(artifact.id)).text, "Generated independent retained artifact.");
  assert.deepEqual(sdk.getState().snapshot.budgetEntries, budget); assert.equal(generated.requests.length, calls);
  assert.equal(sdk.getState().snapshot.sessions.find((session) => session.id === sessionId).draft.text, "Generated installed unsent current draft.");
  if(PROTOCOL_VERSION>=99)assert.equal(sdk.attention.list().some(entry=>entry.id===deletedNotificationId),false);
  console.log(`Installed protocol${PROTOCOL_VERSION} SDK and shared slash commands passed complete source admission/consumption/revocation, ${PROTOCOL_VERSION>=99?"explicit named load activity and independently deleted Inbox notifications, ":""}real per-turn workspace and conversation rewind, current draft/artifact/unknown-accounting retention, encrypted pruning and restart without model/tool replay.`);
} finally { sdk?.disconnect(); await runtime?.close(); await generated.close(); await rm(root, { recursive: true, force: true }); }
