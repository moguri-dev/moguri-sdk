import { ciTime } from "./fixtures/time-scale.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { MoguriSdk, DEFAULT_SYSTEM_PROMPT, type UserSettings } from "../packages/sdk/src/index.ts";
import { NEMOTRON_MODEL } from "../apps/service/src/voice.ts";
import { envelope } from "../apps/service/src/controller.ts";
import { admitGeneratedSkill, setupFixture, waitFor } from "./fixture.ts";

const mac = { skip: process.platform !== "darwin", timeout: ciTime(30_000) };
const configure = async (sdk: MoguriSdk, update: (settings: UserSettings) => void, risk = false) => {
  const snapshot = sdk.getState().snapshot!;
  const settings = structuredClone(snapshot.settings.values);
  update(settings);
  return sdk.settings.update(settings, snapshot.settings.revision, risk);
};
test("shared settings default dark, prompt edits need acknowledgement and restore without losing sessions", mac, async () => {
  const fixture = await setupFixture();
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  const second = await new MoguriSdk(fixture.service.connection).ready();
  try {
    assert.equal(sdk.settings.get()?.values.appearance.theme, "dark");
    await assert.rejects(() => sdk.prompt.set("Generated custom instructions.", 0, false), /break/);
    await sdk.prompt.set("Generated custom instructions. Do not invent results.", 0, true);
    await waitFor(() => second.settings.get()?.values.systemPrompt.includes("Generated custom"));
    await fixture.configure();
    await fixture.send("generated normal task");
    await fixture.terminal();
    const messages = fixture.requests[0]?.messages;
    assert.ok(Array.isArray(messages));
    assert.match(JSON.stringify(messages[0]), /Generated custom instructions/);
    assert.match(JSON.stringify(messages[0]), /moguri-execution-contract/);
    assert.match(JSON.stringify(messages[0]), /moguri-product-context/);
    assert.match(JSON.stringify(messages[0]), /https:\/\/github\.com\/mbianchidev\/moguri/);
    assert.match(JSON.stringify(messages[0]), /npm ci/);
    assert.match(JSON.stringify(messages[0]), /npm run build/);
    assert.match(JSON.stringify(messages[0]), /npm start -- --project/);
    assert.equal(sdk.settings.get()!.values.systemPrompt, "Generated custom instructions. Do not invent results.");
    const revision = sdk.settings.get()!.revision;
    await sdk.prompt.reset(revision);
    assert.equal(sdk.settings.get()?.values.systemPrompt, DEFAULT_SYSTEM_PROMPT);
    assert.equal(sdk.getState().snapshot?.sessions.length, 1);
    await assert.rejects(() => sdk.settings.reset("all", 0), /Another client/);
  } finally { sdk.disconnect(); second.disconnect(); await fixture.close(); }
});

test("native execution instructions identify the guest workspace, never the controller source, while Local keeps its actual root", async () => {
  const fixture = await setupFixture();
  try {
    const session = fixture.session(), platform = fixture.service.controller.platform;
    assert.ok(platform.prompt(session).includes(`Project: ${platform.managed.project(session).path}`));
    const native = platform.prompt({ ...session, controls: { ...session.controls, env: "Sandbox" } });
    assert.match(native, /Project: \/workspace\n/);
    assert.equal(native.includes(fixture.project), false);
    assert.equal(fixture.requests.length, 0);
    assert.equal(fixture.service.controller.snapshot().budgetEntries.length, 0);
  } finally { await fixture.close(); }
});

test("a project-free Moguri installation question receives first-party TUI facts without repository context or another account", mac, async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const created = await sdk.sessions.create(null, "Generated Moguri setup question");
    const session = sdk.getState().snapshot!.sessions.find((session) => session.id === created.id)!;
    await sdk.sessions.configure(session.id, { ...session.controls, modelId: fixture.modelId });
    await sdk.command({ type: "draft.save", sessionId: session.id, expectedRevision: 0, text: "How do I install the Moguri TUI?", attachments: [] });
    await sdk.command({ type: "message.send", sessionId: session.id, expectedRevision: 1, delivery: "queue" });
    await waitFor(() => sdk.getState().snapshot!.sessions.find((value) => value.id === session.id)?.status === "completed");
    const messages = fixture.requests[0]?.messages;
    assert.ok(Array.isArray(messages));
    const system = JSON.stringify(messages[0]);
    assert.match(system, /moguri-product-context/);
    assert.match(system, /docs\/setup\.md/);
    assert.match(system, /macOS.*alpha/);
    assert.match(system, /Node\.js.*26/);
    assert.match(system, /private/);
    assert.match(system, /npm start -- --project/);
    assert.match(system, /no active project/);
    assert.equal(system.includes(fixture.project), false);
    assert.equal(sdk.settings.get()!.values.memory.enabled, false);
    assert.equal(fixture.requests.length, 1);
    assert.equal(sdk.getState().snapshot!.questions.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("repository vectors and graph retain digests, reuse unchanged data and mark changed snapshots stale", async () => {
  const fixture = await setupFixture();
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await writeFile(join(fixture.project, "helper.ts"), "export const helper = 'generated helper';\n");
    await writeFile(join(fixture.project, "calc.ts"), "import { helper } from './helper';\nexport function uniqueVectorAddition() { return helper; }\n");
    await writeFile(join(fixture.project, ".gitignore"), "ignored.log\n");
    await writeFile(join(fixture.project, "ignored.log"), "generated forbidden ignored marker");
    await mkdir(join(fixture.project, "nested"));
    await writeFile(join(fixture.project, "nested", ".gitignore"), "private.log\n");
    await writeFile(join(fixture.project, "nested", "private.log"), "generated nested ignored marker");
    await assert.rejects(() => sdk.memory.search(fixture.session().projectId, "addition"), { code: "memory_disabled" });
    await configure(sdk, (settings) => { settings.memory.enabled = true; });
    const indexed = await sdk.memory.index(fixture.session().projectId);
    assert.equal((await sdk.jobs.wait(indexed.id!)).status, "completed");
    const hits = await sdk.memory.search(fixture.session().projectId, "unique vector addition");
    assert.ok(hits.items.some((hit) => hit.path === "calc.ts" && !hit.stale && hit.text.includes("uniqueVectorAddition")));
    assert.equal(hits.items.some((hit) => hit.path === "ignored.log" || hit.path === "nested/private.log"), false);
    const graph = await sdk.memory.graph(fixture.session().projectId);
    assert.ok(graph.edges.some((edge) => edge.source === "calc.ts" && edge.target === "helper.ts" && edge.kind === "imports"));
    assert.ok(graph.nodes.some((node) => node.label === "uniqueVectorAddition" && node.kind === "symbol"));
    const repeated = await sdk.memory.index(fixture.session().projectId);
    assert.equal((await sdk.jobs.wait(repeated.id!)).status, "completed");
    const result = JSON.parse((await sdk.mcp.readResult(repeated.id!)).text);
    assert.ok(result.reusedFiles >= 2);
    await writeFile(join(fixture.project, ".gitignore"), "ignored.log\ncalc.ts\n");
    const ignored = await sdk.memory.search(fixture.session().projectId, "unique vector addition");
    assert.ok(ignored.items.some((hit) => hit.path === "calc.ts" && hit.stale && hit.text === ""));
    await writeFile(join(fixture.project, ".gitignore"), "ignored.log\n");
    await writeFile(join(fixture.project, "calc.ts"), "generated external change\n");
    const stale = await sdk.memory.search(fixture.session().projectId, "unique vector addition");
    assert.ok(stale.items.some((hit) => hit.path === "calc.ts" && hit.stale && hit.text === ""));
    await assert.rejects(() => sdk.memory.search("generated-other-project", "addition"), /outside this profile/);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("hard tool denials win and explicit read delegation is attributed to delegation, never human approval", mac, async () => {
  const fixture = await setupFixture();
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.configure();
    await configure(sdk, (settings) => { settings.permissions.tools = [{ id: "generated-deny", tool: "read_file", pathPrefix: "", decision: "deny" }]; });
    await fixture.send("generated tool task");
    await fixture.terminal();
    assert.equal(fixture.service.controller.events(0).some((event) => event.event_type === "tool.started"), false);
    await configure(sdk, (settings) => { settings.permissions.tools = [{ id: "generated-read", tool: "read_file", pathPrefix: "fixture.txt", decision: "allow" }]; });
    await fixture.send("generated tool task");
    await fixture.terminal();
    assert.ok(fixture.service.controller.events(0).some((event) => event.event_type === "tool.decided" && event.payload.actor === "delegation" && event.payload.ruleId === "generated-read"));
    await assert.rejects(() => configure(sdk, (settings) => { settings.permissions.tools = [{ id: "unsafe", tool: "run_command", pathPrefix: "", decision: "allow" }]; }), /exact command/);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("native gateway executes known builtin reads through policy without inference and rejects stale schemas", mac, async () => {
  const fixture = await setupFixture();
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const found = await sdk.mcp.tools("builtin", "grep", 0, fixture.sessionId);
    const tool = found.tools.find((tool) => tool.name === "grep_logs")!;
    assert.ok(tool.digest);
    const requested = await sdk.mcp.call(fixture.sessionId, "builtin", tool.name, { path: "fixture.txt", query: "original" }, tool.digest);
    assert.equal(fixture.session().pendingApproval, null);
    assert.equal(fixture.requests.length, 0);
    const completed = await sdk.jobs.wait(requested.id!);
    assert.equal(completed.status, "completed", completed.error ?? "");
    assert.match((await sdk.mcp.readResult(requested.id!)).text, /generated original/);
    assert.equal(fixture.requests.length, 0);
    assert.equal(fixture.session().status, "completed");
    const stale = await sdk.mcp.call(fixture.sessionId, "builtin", tool.name, { path: "fixture.txt", query: "original" }, "0".repeat(64));
    const invalid = await sdk.jobs.wait(stale.id!);
    assert.equal(invalid.status, "partial");
    assert.match(invalid.error!, /changed/);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("standard skills, plugins and model evolution remain disabled until their real user approvals", mac, async () => {
  const fixture = await setupFixture();
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const skillPath = join(fixture.project, "SKILL.md");
    await writeFile(skillPath, "---\nname: generated-conventions\ndescription: Generated conventions\n---\nPrefer explicit result types.\n");
    const imported = await sdk.capabilities.importSkill(fixture.session().projectId, skillPath);
    assert.equal(sdk.getState().snapshot?.registry.find((entry) => entry.id === imported.id)?.enabled, false);
    await sdk.capabilities.toggle(imported.id!, true, 0);
    assert.doesNotMatch((await sdk.prompt.preview(fixture.sessionId)).effective, /Prefer explicit result types/);
    const entry = sdk.getState().snapshot!.registry.find((entry) => entry.id === imported.id)!;
    await fixture.configure();
    await configure(sdk, (settings) => { settings.evolution.enabled = true; });
    await fixture.send("generated propose skill");
    await fixture.approve();
    await fixture.terminal();
    await sdk.refresh();
    const proposal = sdk.getState().snapshot!.proposals.find((proposal) => proposal.actor === "model")!;
    assert.equal(proposal.status, "pending");
    assert.equal(sdk.getState().snapshot!.registry.some((entry) => entry.name === "generated-style"), false);
    await assert.rejects(() => sdk.capabilities.decide(proposal.id, true, "0".repeat(64)), /changed|already decided/);
    await sdk.capabilities.decide(proposal.id, true, proposal.contentDigest);
    const approved = sdk.getState().snapshot!.registry.find((entry) => entry.name === "generated-style")!;
    assert.equal(approved.source, "approved-proposal");
    assert.equal(approved.enabled, false);
    const pluginPath = join(fixture.project, "plugin.json");
    await writeFile(pluginPath, JSON.stringify({ schemaVersion: 1, name: "generated-bundle", version: "1.0.0", description: "Generated plugin", skills: ["---\nname: generated-bundle-skill\ndescription: Bundled convention\n---\nDo not invent test results."] }));
    const plugin = await sdk.capabilities.importPlugin(fixture.session().projectId, pluginPath);
    const child = sdk.getState().snapshot!.registry.find((entry) => entry.ownerPluginId === plugin.id)!;
    await assert.rejects(() => sdk.capabilities.toggle(child.id, true, child.revision), /owning plugin/);
    await sdk.capabilities.toggle(plugin.id!, true, 0);
    await sdk.capabilities.toggle(child.id, true, child.revision);
    assert.doesNotMatch((await sdk.prompt.preview(fixture.sessionId)).effective, /Do not invent test results/);
    await admitGeneratedSkill(sdk, fixture.sessionId, entry.id, entry.contentDigest);
    assert.match((await fixture.service.controller.platform.delegate(fixture.session(), { id: "generated-skill-load", name: "use_skill",
      arguments: { action: "load", id: entry.id, expectedDigest: entry.contentDigest } }, new AbortController().signal)).text, /Prefer explicit result types/);
    await admitGeneratedSkill(sdk, fixture.sessionId, child.id, child.contentDigest);
    assert.match((await fixture.service.controller.platform.delegate(fixture.session(), { id: "generated-plugin-skill-load", name: "use_skill",
      arguments: { action: "load", id: child.id, expectedDigest: child.contentDigest } }, new AbortController().signal)).text, /Do not invent test results/);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("subagents are opt-in, depth-one, tool-less and separately accounted", mac, async () => {
  const fixture = await setupFixture();
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.configure();
    await assert.rejects(() => sdk.subagents.run(fixture.sessionId, "generated analysis"), /off by default/);
    await configure(sdk, (settings) => { settings.subagents.enabled = true; });
    const child = await sdk.subagents.run(fixture.sessionId, "generated analysis");
    await waitFor(() => fixture.service.controller.snapshot().sessions.find((session) => session.id === child.id)?.status === "completed");
    const session = fixture.service.controller.snapshot().sessions.find((session) => session.id === child.id)!;
    assert.equal(session.parentSessionId, fixture.sessionId);
    assert.equal(session.readOnly, true);
    assert.equal(session.usage[0]?.role, "subagent");
    assert.equal(fixture.requests[0]?.tools, undefined);
    await assert.rejects(() => sdk.subagents.run(session.id, "generated nested child"), /depth-one/);
    await assert.rejects(() => sdk.mcp.call(session.id, "builtin", "grep_logs", { path: "fixture.txt", query: "original" }, "0".repeat(64)), { code: "subagent_readonly" });
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("local dictation needs explicit download, verifies integrity, preserves conflicting drafts and never calls a provider", async () => {
  const weights = Buffer.from("generated test model");
  let downloads = 0;
  const fixture = await setupFixture({ platform: { speech: {
    executable: process.execPath, prefixArgs: [resolve("tests/fixtures/fake-speech.mjs")],
    model: { ...NEMOTRON_MODEL, filename: "generated.gguf", bytes: weights.length, sha256: createHash("sha256").update(weights).digest("hex") },
    fetch: async () => { downloads++; return new Response(weights); },
  } } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const status = (await sdk.voice.status()).voice;
    assert.equal(status.modelReady, false);
    assert.equal(status.languageLocales.length, 40);
    await assert.rejects(() => sdk.voice.record(fixture.sessionId), { code: "speech_not_ready" });
    assert.equal(downloads, 0);
    const download = await sdk.voice.download(true);
    assert.equal((await sdk.jobs.wait(download.id!)).status, "completed");
    assert.equal((await sdk.voice.status()).voice.modelReady, true);
    const again = await sdk.voice.download(true);
    await sdk.jobs.wait(again.id!);
    assert.equal(downloads, 1);
    const wav = join(fixture.project, "generated.wav");
    await mkdir(fixture.project, { recursive: true });
    await writeFile(wav, Buffer.from("RIFF-generated-PCM-fixture"));
    const transcript = await sdk.voice.transcribe(fixture.sessionId, wav);
    assert.equal((await sdk.jobs.wait(transcript.id!)).status, "completed");
    await sdk.command({ type: "draft.save", sessionId: fixture.sessionId, expectedRevision: fixture.session().draft.revision, text: "generated existing draft", attachments: [] });
    await assert.rejects(() => sdk.voice.insert(fixture.sessionId, transcript.id!, 0), /draft changed/);
    await sdk.voice.insert(fixture.sessionId, transcript.id!, fixture.session().draft.revision);
    assert.match(fixture.session().draft.text, /generated existing draft\nGenerated local dictation/);
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("parent stop cancels a queued owned subagent before it can start after re-enablement", mac, async () => {
  const fixture = await setupFixture();
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.configure();
    await configure(sdk, (settings) => { settings.subagents.enabled = true; });
    const creation = fixture.service.controller.dispatch(envelope({ type: "subagent.run", sessionId: fixture.sessionId, prompt: "generated queued analysis" }));
    const settings = structuredClone(fixture.service.controller.snapshot().settings);
    settings.values.subagents.enabled = false;
    const disable = fixture.service.controller.dispatch(envelope({ type: "settings.update", settings: settings.values, expectedRevision: settings.revision, acknowledgePromptRisk: false }));
    const child = await creation; await disable;
    await waitFor(() => fixture.service.controller.snapshot().sessions.find((session) => session.id === child.id)?.status === "waiting_input");
    await sdk.command({ type: "session.stop", sessionId: fixture.sessionId });
    const stopped = fixture.service.controller.snapshot().sessions.find((session) => session.id === child.id)!;
    assert.equal(stopped.status, "stopped");
    assert.equal(stopped.queue.length, 0);
    await configure(sdk, (settings) => { settings.subagents.enabled = true; });
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});
