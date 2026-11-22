import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const installed = process.argv[2];
if (!installed) throw new Error("Provide the actual independently installed package root.");
const { createRuntime } = await import(pathToFileURL(join(installed, "dist/sdk/node.mjs")).href);
const { MoguriSdk, PROTOCOL_VERSION, voiceShortcutMode } = await import(pathToFileURL(join(installed, "dist/sdk/index.mjs")).href);
assert.ok(PROTOCOL_VERSION >= 87);
for (const path of ["dist/playwright-worker.mjs", "dist/data-worker.mjs"]) await access(join(installed, path));
const directory = await mkdtemp(join(tmpdir(), "moguri-installed-session-controls-"));
const project = join(directory, "project"), home = join(directory, "home");
await mkdir(project); await mkdir(home);
await writeFile(join(project, "a.ts"), "export function increase(value: number) { return value + 1; }\n");
await writeFile(join(project, "b.ts"), 'import { increase as bump } from "./a";\nbump(1);\n');
let calls = 0, runtime, sdk;
const provider = {
  state: { status: "disconnected", models: [], login: null, diagnostic: null },
  onChange: () => {}, refresh: async () => {}, logout: async () => {}, cancel: async () => {},
  login: () => { throw new Error("Personal login is forbidden in installed session-control qualification."); },
  prepare: async () => { calls++; throw new Error("Inference is forbidden in installed session-control qualification."); },
};
const options = { stateDir: join(directory, "state"), retentionKey: Buffer.alloc(32, 0x73), provider,
  platform: { terminal: { defaultRoot: home }, sandbox: { setup: { automatic: false } } } };
const waitFor = async (read) => {
  const deadline = Date.now() + 10000;
  while (!read()) {
    if (Date.now() >= deadline) throw new Error("The original installed command/dependency did not settle.");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};
try {
  runtime = await createRuntime(options); sdk = await new MoguriSdk(runtime.connection).ready();
  if (PROTOCOL_VERSION >= 88) {
    const settings = sdk.settings.get();
    assert.equal(voiceShortcutMode(settings.values.voice), "hold");
    assert.equal(settings.values.voice.pushToTalk, false);
    await sdk.settings.update({ ...settings.values, voice: { ...settings.values.voice, shortcutMode: "toggle" } }, settings.revision);
    assert.equal(voiceShortcutMode(sdk.settings.get().values.voice), "toggle");
    assert.equal(sdk.settings.get().values.voice.pushToTalk, false);
  }
  const projectId = (await sdk.projects.add(project)).id;
  const a = (await sdk.sessions.create(projectId, "Generated installed source")).id;
  const b = (await sdk.sessions.create(projectId, "Generated installed prerequisite")).id;
  const keep = (await sdk.sessions.create(projectId, "Generated installed untouched")).id;
  assert.equal(sdk.sessions.get(a).id, a);
  const peer = await sdk.coordination.preview(a, b);
  assert.equal(peer.kind, "peer");
  await sdk.coordination.grant(a, b, peer.digest, true, true);
  await sdk.coordination.message(a, b, "Generated installed advisory, never a paid reply.");
  assert.equal(sdk.getState().snapshot.coordinationMessages[0].origin.actor, "user");
  const enqueue = async (id, held) => {
    await sdk.command({ type: "draft.save", sessionId: id, expectedRevision: sdk.sessions.get(id).draft.revision, text: "/session-id", attachments: [] });
    await sdk.commands.submit(id, { client: "cli", expectedDraftRevision: sdk.sessions.get(id).draft.revision, delivery: "queue", held });
  };
  await enqueue(b, true);
  await sdk.sessions.waitFor((await sdk.sessions.waitPreview(a, b)).preview, true);
  await enqueue(a, false);
  assert.equal(sdk.sessions.get(a).wait.status, "waiting");
  const prerequisite = sdk.sessions.get(b);
  await sdk.prompts.release(b, prerequisite.queue[0].id, prerequisite.queueRevision);
  await waitFor(() => {
    const commands = sdk.getState().snapshot.commandExecutions.filter((entry) => [a, b].includes(entry.sessionId));
    return sdk.sessions.get(a).wait.status === "released" && commands.length === 2 && commands.every((entry) => entry.status === "completed");
  });
  await sdk.sessions.autonomy(a, "Autopilot");
  const execute = async (name, args) => {
    const tool = (await sdk.tools.catalog(a, name)).tools.find((tool) => tool.name === name);
    assert.ok(tool, `The actual installed ${name} schema is missing.`);
    const job = await sdk.jobs.wait((await sdk.tools.execute(a, name, args, tool.schemaDigest)).id);
    assert.equal(job.status, "completed", job.error ?? `Installed ${name} did not complete.`);
    return JSON.parse((await sdk.mcp.readResult(job.id, 0, 32768)).text);
  };
  const definition = JSON.parse((await execute("goto_definition", { path: "b.ts", line: 2, column: 1 })).text);
  assert.equal(definition.symbol, "increase"); assert.equal(definition.locations[0].path, "a.ts");
  const order = JSON.parse((await execute("order_desc", { items: [1, 3, 2] })).text);
  assert.deepEqual(order.items, [3, 2, 1]);
  const html = '<button id="counter">0</button><script>counter.onclick=()=>counter.textContent=Number(counter.textContent)+1</script>';
  assert.equal((await sdk.jobs.wait((await sdk.chatOutputs.renderHtml(a, "Generated installed counter", html)).id)).status, "completed");
  const output = sdk.sessions.get(a).messages.flatMap((message) => message.attachments ?? []).find((attachment) => attachment.kind === "html");
  assert.equal(output.source.kind, "user-tool-output");
  const artifact = (await sdk.artifacts.create(a, { kind: "research-note", name: "Generated independent evidence", text: "Generated independent bytes survive session deletion." })).id;
  await sdk.sessions.bulk((await sdk.sessions.bulkPreview({ action: "archive", sessionIds: [a, b] })).preview, true);
  sdk.disconnect(); await runtime.close(); runtime = await createRuntime(options); sdk = await new MoguriSdk(runtime.connection).ready();
  if (PROTOCOL_VERSION >= 88) {
    assert.equal(voiceShortcutMode(sdk.settings.get().values.voice), "toggle");
    assert.equal(sdk.settings.get().values.voice.pushToTalk, false);
  }
  assert.equal(sdk.sessions.get(a).wait.status, "released");
  assert.equal((await sdk.attachments.read(a, output.id)).content.html, html);
  await sdk.sessions.bulk((await sdk.sessions.bulkPreview({ action: "delete", sessionIds: [a, b] })).preview, true);
  assert.equal(sdk.sessions.get(a), undefined); assert.equal(sdk.sessions.get(b), undefined);
  assert.equal(sdk.sessions.get(keep).projectId, projectId);
  assert.equal((await sdk.artifacts.read(artifact)).text, "Generated independent bytes survive session deletion.");
  assert.equal(calls, 0);
  console.log(`Installed protocol${PROTOCOL_VERSION} SDK/runtime: exact IDs, peer messages, command-fenced success dependencies, real native TS semantics, typed arrays, retained HTML, explicit shortcut defaults/preferences, restart and whole-set archive/delete with independent artifact survival passed without inference.`);
} finally { sdk?.disconnect(); await runtime?.close(); await rm(directory, { recursive: true, force: true }); }
