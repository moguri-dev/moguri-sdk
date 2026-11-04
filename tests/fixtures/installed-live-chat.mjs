import assert from "node:assert/strict";
import { mkdtemp, mkdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { fixtureProvider, waitFor } from "../fixture.ts";
import { generatedIssueRevisions } from "./responsive-history.ts";

const installed = process.argv[2];
if (!installed) throw new Error("Provide the independently installed package root.");
const { createRuntime, connectMoguri } = await import(pathToFileURL(join(installed, "dist/sdk/node.mjs")).href);
const { CHAT_TITLE_PROMPT, DraftEditor, PROTOCOL_VERSION } = await import(pathToFileURL(join(installed, "dist/sdk/index.mjs")).href);
assert.ok(PROTOCOL_VERSION >= 90);
const provider = await fixtureProvider({ respond: (request) => {
  const text = JSON.stringify(request.messages);
  return text.includes(CHAT_TITLE_PROMPT.split("\n")[0]) ? { text: '{"title":"Generated installed topic summary"}' } :
    text.includes("GENERATED_INSTALLED_LIVE_OWNER") ? { hold: true } : { text: "Generated installed solver result." };
} });
const directory = await realpath(await mkdtemp(join(tmpdir(), "moguri-installed-live-chat-"))), project = join(directory, "project"), stateDir = join(directory, "state"), home = join(directory, "home");
await mkdir(project); await mkdir(home);
const secrets = new Map(), vault = { read: async (id) => secrets.get(id) ?? null,
  write: async (id, value) => { secrets.set(id, value); }, remove: async (id) => { secrets.delete(id); } };
const options = { stateDir, retentionKey: Buffer.alloc(32, 0x61), provider: provider.provider, platform: { vault,
  terminal: { defaultRoot: home, vault, executable: process.execPath, args: ["-e", "process.stdin.resume()"] }, sandbox: { setup: { automatic: false } } } };
let runtime, sdk, editor;
try {
  runtime = await createRuntime(options); sdk = await connectMoguri({ stateDir, autoStart: false });
  const added = await sdk.projects.add(project), created = await sdk.sessions.create(added.id);
  const id = created.id, current = () => sdk.sessions.get(id);
  await sdk.sessions.selectModel(id, provider.modelId);
  editor = new DraftEditor(sdk, id, current().draft);
  editor.edit("Generated installed topic about the bounded planner."); await editor.send("auto");
  await waitFor(() => current()?.titleSource === "model" && current()?.status === "completed" && !current().turnId);
  const record = sdk.sessions.titles(id)[0];
  assert.equal(record.status, "completed"); assert.equal(current().title, "Generated installed topic summary");
  assert.equal(provider.requests.length, 2);
  assert.equal(sdk.getState().snapshot.budgetEntries.find((entry) => entry.id === record.stepId)?.role, "title");
  assert.ok(runtime.store.blob(record.inputDigest).includes("bounded planner"));
  editor.edit("Generated installed second ordinary request."); await editor.send("auto");
  await waitFor(() => provider.requests.length === 3 && current()?.status === "completed" && !current().turnId);
  assert.equal(JSON.stringify(provider.requests[2]).includes("Generated installed topic summary"), false);
  editor.dispose();
  const live = await sdk.sessions.create(added.id, "Generated explicit installed live owner"), liveId = live.id;
  await sdk.sessions.selectModel(liveId, provider.modelId);
  editor = new DraftEditor(sdk, liveId, sdk.sessions.get(liveId).draft);
  editor.edit("GENERATED_INSTALLED_LIVE_OWNER"); await editor.send("auto");
  await waitFor(() => provider.requests.length === 4);
  const turn = sdk.sessions.get(liveId).turnId;
  editor.edit("Generated actual installed interjection."); const intake = await editor.send("auto");
  const item = sdk.sessions.get(liveId).queue.find((item) => item.id === intake.id);
  assert.equal(item.delivery, "steer"); assert.equal(item.targetTurnId, turn); assert.equal(item.liveDelivery, true);
  await sdk.command({ type: "session.stop", sessionId: liveId }); await waitFor(() => !sdk.sessions.get(liveId).turnId);
  assert.equal(sdk.sessions.get(liveId).queue[0].held, true); assert.equal(provider.requests.length, 4);
  editor.dispose(); editor = undefined; sdk.disconnect();
  runtime.store.commit(generatedIssueRevisions(added.id));
  runtime.controller.refreshProfile(); sdk = await connectMoguri({ stateDir, autoStart: false });
  const timings = [];
  const command = async (input, commandId) => {
    const began = performance.now(), result = await sdk.command(input, commandId);
    timings.push({ operation: input.type, acknowledgedMs: performance.now() - began });
    console.log(JSON.stringify({ primitive: "installed-issue-history-acknowledgement", ...timings.at(-1) }));
    assert.deepEqual(await sdk.commandReceipt(input, commandId), { status: "committed", result });
    return result;
  };
  const responsive = await command({ type: "session.create", projectId: null, title: "Generated installed issue-history intake" }, "generated-installed-issue-create");
  await command({ type: "draft.save", sessionId: responsive.id, expectedRevision: 0, text: "Generated original held issue-history request.", attachments: [] }, "generated-installed-issue-draft");
  await command({ type: "message.send", sessionId: responsive.id, expectedRevision: 1, delivery: "auto", held: true }, "generated-installed-issue-send");
  await command({ type: "session.archive", sessionId: responsive.id }, "generated-installed-issue-archive");
  await command({ type: "session.delete", sessionId: responsive.id, expectedRevision: sdk.sessions.get(responsive.id).revision, confirm: true }, "generated-installed-issue-delete");
  assert.equal(provider.requests.length, 4);
  sdk.disconnect(); await runtime.close(); runtime = undefined;
  const restarted = performance.now();
  runtime = await createRuntime(options); sdk = await connectMoguri({ stateDir, autoStart: false });
  const restartMs = performance.now() - restarted;
  console.log(JSON.stringify({ primitive: "installed-issue-history-restart", issueRevisions: 25_000, currentIssues: sdk.getState().snapshot.issues.length,
    authenticatedReadyMs: restartMs, modelCalls: provider.requests.length }));
  assert.ok(timings.every(timing => timing.acknowledgedMs < 1000), "Installed issue-history operations must not repeatedly replay old descriptions.");
  assert.ok(restartMs < 3000, "Installed issue-heavy restart must settle without replaying inference or repeated ciphertext scans.");
  assert.equal(sdk.getState().snapshot.issues.length, 100);
  assert.equal(sdk.sessions.get(id).title, "Generated installed topic summary");
  assert.equal(sdk.sessions.titles(id)[0].stepId, record.stepId);
  assert.equal(sdk.sessions.get(liveId).queue[0].held, true); assert.equal(provider.requests.length, 4);
  for (const marker of ["chat_titles_schema", "live_delivery_schema"]) assert.equal(runtime.store.db.prepare("SELECT value FROM retention_metadata WHERE id=?").get(marker)?.value, "1");
  console.log(`Installed protocol${PROTOCOL_VERSION} SDK/runtime/worker: bounded metered first-topic naming, original user/live ownership, no private result in solver context and restart/no-replay passed.`);
} finally {
  editor?.dispose(); sdk?.disconnect(); await runtime?.close(); await provider.close();
  await rm(directory, { recursive: true, force: true });
}
