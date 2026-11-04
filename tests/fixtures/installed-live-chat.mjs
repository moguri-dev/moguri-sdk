import assert from "node:assert/strict";
import { mkdtemp, mkdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { fixtureProvider, waitFor } from "../fixture.ts";

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
const directory = await realpath(await mkdtemp(join(tmpdir(), "moguri-installed-live-chat-"))), project = join(directory, "project"), stateDir = join(directory, "state");
await mkdir(project);
const secrets = new Map(), vault = { read: async (id) => secrets.get(id) ?? null,
  write: async (id, value) => { secrets.set(id, value); }, remove: async (id) => { secrets.delete(id); } };
const options = { stateDir, retentionKey: Buffer.alloc(32, 0x61), provider: provider.provider, platform: { vault, sandbox: { setup: { automatic: false } } } };
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
  editor.dispose(); editor = undefined; sdk.disconnect(); await runtime.close(); runtime = undefined;
  runtime = await createRuntime(options); sdk = await connectMoguri({ stateDir, autoStart: false });
  assert.equal(sdk.sessions.get(id).title, "Generated installed topic summary");
  assert.equal(sdk.sessions.titles(id)[0].stepId, record.stepId);
  assert.equal(sdk.sessions.get(liveId).queue[0].held, true); assert.equal(provider.requests.length, 4);
  for (const marker of ["chat_titles_schema", "live_delivery_schema"]) assert.equal(runtime.store.db.prepare("SELECT value FROM retention_metadata WHERE id=?").get(marker)?.value, "1");
  console.log(`Installed protocol${PROTOCOL_VERSION} SDK/runtime/worker: bounded metered first-topic naming, original user/live ownership, no private result in solver context and restart/no-replay passed.`);
} finally {
  editor?.dispose(); sdk?.disconnect(); await runtime?.close(); await provider.close();
  await rm(directory, { recursive: true, force: true });
}
