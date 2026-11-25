import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { envelope } from "../apps/service/src/controller.ts";
import { AcpUpdateNormalizer, acpPromptUsage, acpUsdEstimate } from "../apps/service/src/acp-agent-stream.ts";
import { acpAgentEnvironment, acpAutonomousReads, acpModels, acpPolicyCalls } from "../apps/service/src/acp-agent.ts";
import type { AgentWorkerMessage } from "../apps/service/src/agent-harness-protocol.ts";
import {
  ACP_AGENT_SPECS, acpAgentModelId, acpAgentModelName, agentHarnessOf, agentUsageNotice, defaultAcpAgentSettings, modelLab, routingModelReady, type AcpHarness, type UserSettings,
} from "../packages/protocol/src/index.ts";
import { DatabaseSync } from "node:sqlite";
import { EventStore, hostedCloudAcpSchemaMarker } from "../apps/service/src/store.ts";
import { PROTOCOL_VERSION } from "../packages/protocol/src/index.ts";
import { removeHostedCloudAcpFixtureMarker, retainedCiphertextRows } from "./fixtures/legacy-state.ts";
import { setupFixture, waitFor } from "./fixture.ts";
import { ciTime } from "./fixtures/time-scale.ts";

const fake = fileURLToPath(new URL("./fixtures/fake-acp.mjs", import.meta.url));
async function acpFixture(harness: AcpHarness, options: { auth?: string; version?: string } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "moguri-generated-acp-"));
  const executable = join(directory, ACP_AGENT_SPECS[harness].command), log = join(directory, "fake-acp.log");
  await writeFile(executable, `#!/bin/sh\nFAKE_ACP_AUTH='${options.auth ?? "ok"}' FAKE_ACP_VERSION='${options.version ?? "1.6.0"}' FAKE_ACP_LOG='${log}' exec '${process.execPath}' '${fake}' "$@"\n`);
  await chmod(executable, 0o755);
  // Generated ambient Google credentials must never reach the agent.
  const environment = { PATH: process.env.PATH, HOME: directory, GEMINI_API_KEY: "generated-ambient-gemini-key", GOOGLE_APPLICATION_CREDENTIALS: "/generated/adc.json" };
  const fixture = await setupFixture({ platform: { acpAgents: { [harness]: { executable, environment } } } });
  const settings = fixture.service.controller.snapshot().settings;
  await fixture.service.controller.dispatch(envelope({ type: "settings.update", expectedRevision: settings.revision, acknowledgePromptRisk: false,
    settings: { ...settings.values, [ACP_AGENT_SPECS[harness].settingsKey]: { ...defaultAcpAgentSettings(), enabled: true } } }));
  const entries = async () => (await readFile(log, "utf8")).split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
  return { ...fixture, entries, close: async () => { await fixture.close(); await rm(directory, { recursive: true, force: true }); } };
}

test("ACP session updates group into Moguri steps, permission requests introduce calls and unrequested tools are flagged", () => {
  const frames: AgentWorkerMessage[] = [];
  const normalizer = new AcpUpdateNormalizer("gemini-generated-pro", (frame) => frames.push(frame));
  normalizer.handle({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "Plan." } });
  normalizer.handle({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Hi" } });
  const reviewed = normalizer.approvalCall({ toolCallId: "e1", title: "Edit a.ts", kind: "edit", locations: [{ path: "/r/a.ts", line: 3 }] })!;
  assert.deepEqual([reviewed.name, reviewed.arguments.locations], ["edit", [{ path: "/r/a.ts", line: 3 }]]);
  normalizer.handle({ sessionUpdate: "tool_call_update", toolCallId: "e1", status: "completed", content: [{ type: "diff", path: "/r/a.ts", oldText: "a", newText: "b" }] });
  normalizer.handle({ sessionUpdate: "tool_call", toolCallId: "r1", kind: "read", status: "completed", locations: [{ path: "/r/b.ts" }], content: [{ type: "content", content: { type: "text", text: "b" } }] });
  normalizer.handle({ sessionUpdate: "tool_call", toolCallId: "x1", kind: "unknown-kind", status: "failed" });
  const responses = frames.filter((frame) => frame.kind === "agent.response");
  assert.deepEqual(responses.map((frame) => [frame.text, frame.reasoning, frame.toolCalls.map((call) => [call.id, call.name])]),
    [["Hi", "Plan.", [["e1", "edit"]]], ["", "", [["r1", "read"]]], ["", "", [["x1", "other"]]]]);
  const results = frames.filter((frame) => frame.kind === "agent.tool_result");
  assert.deepEqual(results.map((frame) => [frame.callId, frame.text, frame.isError, frame.autonomous ?? false]), [["e1", "update /r/a.ts", false, false], ["r1", "b", false, true], ["x1", "failed", true, true]]);
  assert.deepEqual(acpPromptUsage({ stopReason: "end_turn", usage: { inputTokens: 9, outputTokens: 3, cachedReadTokens: 2 } }), { inputTokens: 9, outputTokens: 3, cacheReadTokens: 2, cacheWriteTokens: null });
  assert.equal(acpUsdEstimate({ cost: { amount: 0.5, currency: "USD" } }), 0.5);
  assert.equal(acpUsdEstimate({ cost: { amount: 0.5, currency: "EUR" } }), null);
});

test("ACP tools map onto Moguri policy, ambient Google credentials are dropped and harness models stay out of Kupo", () => {
  const root = "/generated/root", call = (name: string, args: Record<string, unknown>) => ({ id: "c", name, arguments: args });
  assert.deepEqual(acpPolicyCalls(call("edit", { locations: [{ path: "/generated/root/src/a.ts" }, { path: "/elsewhere/b.ts" }] }), root).map((entry) => [entry.name, entry.arguments.path]),
    [["write_file", "src/a.ts"], ["write_file", "../../elsewhere/b.ts"]]);
  assert.deepEqual(acpPolicyCalls(call("edit", { locations: [] }), root), []);
  assert.deepEqual(acpPolicyCalls(call("execute", { rawInput: { command: ["npm", "test"] } }), root), [{ id: "c", name: "run_command", arguments: { command: "npm test" } }]);
  assert.deepEqual(acpPolicyCalls(call("execute", { rawInput: {} }), root), []);
  assert.deepEqual(acpPolicyCalls(call("fetch", { rawInput: { url: "https://example.invalid" } }), root)[0]!.arguments, { url: "https://example.invalid" });
  assert.equal(acpPolicyCalls(call("other", {}), root)[0]!.name, "acp:other");
  assert.deepEqual(acpAutonomousReads(call("read", { locations: [{ path: "/generated/root/a.ts" }] }), root)?.map((entry) => entry.arguments.path), ["a.ts"]);
  assert.equal(acpAutonomousReads(call("read", { locations: [] }), root), null);
  assert.equal(acpAutonomousReads(call("execute", { rawInput: { command: "ls" } }), root), null);
  assert.deepEqual(acpAutonomousReads(call("think", {}), root), []);
  const environment = acpAgentEnvironment({ PATH: "/usr/bin", HOME: "/generated/home", GEMINI_API_KEY: "x", GOOGLE_API_KEY: "y", GOOGLE_CLOUD_PROJECT: "z", HTTPS_PROXY: "http://proxy.invalid", MOGURI_TOKEN: "t" }, "/opt/agy/bin/agy");
  assert.deepEqual(Object.keys(environment).sort(), ["HOME", "HTTPS_PROXY", "NO_BROWSER", "PATH"]);
  assert.deepEqual(acpModels({ configOptions: [{ id: "model", category: "model", currentValue: "b", options: [{ value: "a", name: "A" }, { group: "g", options: [{ value: "b", name: "B" }] }] }] }),
    { models: [{ model: "a", displayName: "A" }, { model: "b", displayName: "B" }], current: "b" });
  assert.deepEqual(acpModels({ models: { currentModelId: "m", availableModels: [{ modelId: "m", name: "M" }] } }), { models: [{ model: "m", displayName: "M" }], current: "m" });
  const flash = acpAgentModelId("gemini-agent", "generated/flash");
  assert.match(flash, /^gemini-agent\.[0-9a-f]{16}$/);
  assert.equal(acpAgentModelName("gemini-agent", { apiModelId: "gemini-agent:generated/flash" }), "generated/flash");
  assert.equal(acpAgentModelId("antigravity-agent", ""), "antigravity-agent.default");
  assert.equal(agentHarnessOf(flash), "gemini-agent");
  assert.equal(routingModelReady({ id: flash, name: "Gemini CLI Agent / Flash", contextWindow: 200_000, maxTokens: 32_000, imageInput: false, toolInput: true, thinkingLevels: [],
    kupoThinkingLevels: [], source: "gemini-agent" }, { allowHosted: true }, "Local"), false);
  assert.deepEqual([modelLab({ id: "antigravity-agent.claude", name: "Antigravity Agent / Claude Sonnet", source: "antigravity-agent" }).id,
    modelLab({ id: "antigravity-agent.x", name: "Antigravity Agent / Generated", source: "antigravity-agent" }).id], ["anthropic", "google"]);
  assert.match(agentUsageNotice({ harness: "gemini-agent", nativeSessionId: "s", inputTokens: 1, outputTokens: 2, cacheReadTokens: null, cacheWriteTokens: null, harnessEstimatedUsd: null,
    numTurns: null, durationMs: null, outcome: "completed" }), /^Gemini CLI Agent usage for this prompt reported by Gemini CLI/);
});

test("Gemini CLI Agent runs approved ACP turns, loads its native session, selects models and records reads it ran without asking", { timeout: ciTime(90_000) }, async () => {
  const fixture = await acpFixture("gemini-agent");
  const pro = acpAgentModelId("gemini-agent", "gemini-generated-pro"), flash = acpAgentModelId("gemini-agent", "generated/flash");
  try {
    const connection = await waitFor(() => fixture.service.controller.snapshot().provider.models.some((model) => model.id === pro) &&
      fixture.service.controller.snapshot().provider.connections?.find((entry) => entry.id === "gemini-agent"), 20_000);
    assert.equal(connection.status, "connected");
    assert.deepEqual(fixture.service.controller.snapshot().provider.models.filter((model) => model.source === "gemini-agent").map((model) => model.id).sort(), [pro, flash].sort());
    await assert.rejects(fixture.service.controller.dispatch(envelope({ type: "session.configure", sessionId: fixture.sessionId, expectedRevision: fixture.session().revision,
      controls: { ...fixture.session().controls, modelId: pro, budget: { kind: "limited", tokens: 1000, basis: "estimate" } } })), /token\/USD caps/);
    await fixture.service.controller.dispatch(envelope({ type: "session.configure", sessionId: fixture.sessionId, expectedRevision: fixture.session().revision, controls: { ...fixture.session().controls, modelId: pro } }));

    await fixture.send("generated acp write");
    const approval = await waitFor(() => fixture.session().pendingApproval, 20_000);
    assert.deepEqual([approval.call.name, approval.call.harness], ["edit", "gemini-agent"]);
    await assert.rejects(fixture.service.controller.dispatch(envelope({ type: "approval.respond", sessionId: fixture.sessionId, approvalId: approval.id, allow: true,
      remember: { scope: "session", match: "exact" } })), /one exact call/);
    await fixture.service.controller.dispatch(envelope({ type: "approval.respond", sessionId: fixture.sessionId, approvalId: approval.id, allow: true }));
    const first = await fixture.terminal();
    assert.equal(first.status, "completed", first.lastError ?? "");
    assert.equal(await readFile(join(fixture.project, "acp-output.txt"), "utf8"), "generated by fake acp\n");
    const binding = first.agentSession!;
    assert.deepEqual([binding.harness, binding.transport, binding.authMethod, binding.resumed, binding.executable.version], ["gemini-agent", "acp", "unknown", false, "1.6.0"]);
    assert.match(binding.nativeSessionId, /^generated-acp-/); assert.equal(binding.root, await realpath(fixture.project));
    assert.ok(first.messages.some((message) => message.role === "assistant" && message.text === "Generated ACP write complete."));
    assert.ok(first.messages.some((message) => message.reasoning === "Generated plan."));
    assert.equal(first.messages.find((message) => message.role === "tool" && message.toolCalls?.[0]?.name === "edit")?.outcome, "completed");
    assert.match(first.messages.findLast((message) => message.role === "notice")?.text ?? "",
      /Gemini CLI Agent usage for this prompt reported by Gemini CLI: 100 input, 40 output, 10 cache-read tokens; Gemini CLI estimate \$0\.0125 \(not a bill\)/);
    assert.deepEqual(fixture.service.controller.snapshot().budgetEntries, []);

    await fixture.service.controller.dispatch(envelope({ type: "session.configure", sessionId: fixture.sessionId, expectedRevision: fixture.session().revision, controls: { ...fixture.session().controls, modelId: flash } }));
    await fixture.send("generated acp read");
    const second = await fixture.terminal();
    assert.equal(second.status, "completed", second.lastError ?? "");
    const read = second.messages.findLast((message) => message.role === "tool")!;
    assert.equal(read.outcome, "completed"); assert.match(read.text, /read or searched inside this root without asking/);
    assert.equal(second.agentSession?.nativeSessionId, binding.nativeSessionId); assert.equal(second.agentSession?.resumed, true);
    assert.equal(second.messages.some((message) => message.text.includes("Replayed earlier history")), false);

    const entries = await fixture.entries();
    assert.deepEqual(entries.filter((entry) => entry.started).map((entry) => [entry.args, entry.ambient, entry.noBrowser]), Array(3).fill([["--acp"], [], "true"]));
    const initialize = entries.find((entry) => entry.method === "initialize")!;
    assert.deepEqual([initialize.jsonrpc, (initialize.params as Record<string, unknown>).clientCapabilities], ["2.0", { fs: { readTextFile: false, writeTextFile: false }, terminal: false }]);
    assert.deepEqual(entries.filter((entry) => ["session/new", "session/load", "session/set_model", "authenticate"].includes(String(entry.method))).map((entry) => entry.method),
      ["session/new", "session/new", "session/load", "session/set_model"]);
    assert.deepEqual((entries.find((entry) => entry.method === "session/set_model")!.params as Record<string, unknown>).modelId, "generated/flash");
    const prompts = entries.filter((entry) => entry.method === "session/prompt").map((entry) => ((entry.params as { prompt: { text: string }[] }).prompt[0]!.text));
    assert.match(prompts[0]!, /^<moguri-instructions>\nYou are running inside Moguri/); assert.equal(prompts[1], "generated acp read");
    assert.deepEqual(entries.flatMap((entry) => entry.permission ? [entry.permission] : []), [{ outcome: { outcome: "selected", optionId: "yes-once" } }]);
  } finally { await fixture.close(); }
});

test("ACP agents reject, flag unrequested tools, stop with group cleanup and block without sign-in, a supported version or under default deny", { timeout: ciTime(120_000) }, async () => {
  const fixture = await acpFixture("antigravity-agent");
  const model = acpAgentModelId("antigravity-agent", "gemini-generated-pro");
  const users = () => fixture.session().messages.filter((message) => message.role === "user").length;
  const turn = async (text: string) => {
    const before = users(); await fixture.send(text);
    return waitFor(() => { const current = fixture.session(); return users() > before && !current.turnId && !current.queue.length && ["completed", "failed", "partial", "stopped"].includes(current.status) ? current : false; }, 20_000);
  };
  const settings = async (change: (values: UserSettings) => UserSettings) => {
    const current = fixture.service.controller.snapshot().settings;
    await fixture.service.controller.dispatch(envelope({ type: "settings.update", expectedRevision: current.revision, acknowledgePromptRisk: false, settings: change(current.values) }));
  };
  try {
    await waitFor(() => fixture.service.controller.snapshot().provider.models.some((entry) => entry.id === model), 20_000);
    await fixture.service.controller.dispatch(envelope({ type: "session.configure", sessionId: fixture.sessionId, expectedRevision: fixture.session().revision, controls: { ...fixture.session().controls, modelId: model } }));
    await fixture.send("generated acp command");
    const asked = await waitFor(() => fixture.session().pendingApproval, 20_000);
    assert.deepEqual([asked.call.name, (asked.call.arguments.rawInput as Record<string, unknown>).command], ["execute", "npm test"]);
    await fixture.approve(false);
    const declined = await fixture.terminal();
    assert.equal(declined.status, "completed", declined.lastError ?? "");
    assert.equal(declined.messages.findLast((message) => message.role === "tool")?.outcome, "denied");
    assert.ok(declined.messages.some((message) => message.text === "Generated ACP command was declined."));
    assert.deepEqual((await fixture.entries()).flatMap((entry) => entry.permission ? [entry.permission] : []), [{ outcome: { outcome: "selected", optionId: "no" } }]);

    const rogue = await turn("generated acp rogue");
    assert.equal(rogue.status, "partial"); assert.match(rogue.lastError ?? "", /never approved/);
    assert.equal(rogue.messages.findLast((message) => message.role === "tool")?.outcome, "unconfirmed");
    await fixture.service.controller.dispatch(envelope({ type: "session.resume", sessionId: fixture.sessionId }));

    await fixture.send("generated acp hang");
    await waitFor(() => fixture.session().messages.some((message) => message.text === "Generated ACP is working."), 20_000);
    await fixture.service.controller.dispatch(envelope({ type: "session.stop", sessionId: fixture.sessionId }));
    const stopped = await fixture.terminal();
    assert.equal(stopped.status, "stopped", stopped.lastError ?? "");
    const entries = await fixture.entries();
    assert.ok(entries.some((entry) => entry.method === "session/cancel"));
    const orphan = entries.findLast((entry) => entry.orphan)!.orphan as number;
    assert.throws(() => process.kill(orphan, 0));

    await settings((values) => ({ ...values, permissions: { ...values.permissions, defaultDecision: "deny" } }));
    await assert.rejects(fixture.send("generated acp read"), /default tool policy is deny/);
    assert.equal(existsSync(join(fixture.project, "acp-output.txt")), false);
  } finally { await fixture.close(); }

  const unsigned = await acpFixture("gemini-agent", { auth: "none" });
  try {
    const connection = await waitFor(() => { const value = unsigned.service.controller.snapshot().provider.connections?.find((entry) => entry.id === "gemini-agent"); return value?.status === "disconnected" && value.diagnostic ? value : false; }, 20_000);
    assert.match(connection.diagnostic!, /not signed in\. Run `gemini` in your own terminal/);
    assert.match(connection.diagnostic!, /never collects or reads its credentials/);
    assert.equal(unsigned.service.controller.snapshot().provider.models.some((entry) => entry.source === "gemini-agent"), false);
    assert.equal((await unsigned.entries()).some((entry) => entry.method === "authenticate"), false);
  } finally { await unsigned.close(); }

  const outdated = await acpFixture("antigravity-agent", { version: "1.4.9" });
  try {
    const connection = await waitFor(() => { const value = outdated.service.controller.snapshot().provider.connections?.find((entry) => entry.id === "antigravity-agent"); return value?.status === "error" ? value : false; }, 20_000);
    assert.match(connection.diagnostic!, /Antigravity CLI 1\.4\.9 is older than 1\.5\.0/);
  } finally { await outdated.close(); }
});

test("schema 123 upgrades to the hosted cloud and ACP marker, keeps ACP settings across a restart and refuses premature markers or relabelled history", async (t) => {
  for (const change of ["upgrade", "restart", "missing", "premature", "history"] as const) await t.test(change, async () => {
    const fixture = change === "history" || change === "restart" ? await acpFixture("gemini-agent") : await setupFixture();
    try {
      await fixture.service.close();
      const path = fixture.service.store.path;
      if (change === "restart") {
        const reopened = new EventStore(path, fixture.retentionKey);
        try {
          const latest = reopened.events(0).findLast((event) => event.event_type === "settings.updated");
          assert.deepEqual(latest?.event_type === "settings.updated" ? latest.payload.settings.geminiAgent : null, { enabled: true, executablePath: null });
        } finally { reopened.close(); }
        return;
      }
      const raw = new DatabaseSync(path);
      let original;
      try {
        if (change === "history") assert.throws(() => removeHostedCloudAcpFixtureMarker(new DatabaseSync(":memory:"), fixture.service.controller.events(0)), /genuine pre-124 history/);
        else if (change === "upgrade") removeHostedCloudAcpFixtureMarker(raw, fixture.service.controller.events(0));
        raw.exec(change === "missing" ? `DELETE FROM retention_metadata WHERE id='${hostedCloudAcpSchemaMarker}'` :
          change === "history" ? `DELETE FROM retention_metadata WHERE id='${hostedCloudAcpSchemaMarker}'; PRAGMA user_version=123` : "PRAGMA user_version=123");
        original = retainedCiphertextRows(raw);
      } finally { raw.close(); }
      if (change === "upgrade") {
        const reopened = new EventStore(path, fixture.retentionKey);
        try {
          assert.equal(reopened.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
          assert.equal(reopened.db.prepare("SELECT value FROM retention_metadata WHERE id=?").get(hostedCloudAcpSchemaMarker)?.value, "1");
          assert.deepEqual(retainedCiphertextRows(reopened.db), original);
        } finally { reopened.close(); }
        return;
      }
      assert.throws(() => new EventStore(path, fixture.retentionKey),
        change === "missing" ? /Missing or invalid hosted cloud provider and ACP harness schema marker/ : change === "premature" ? /Premature hosted cloud provider and ACP harness schema marker/ : /pre-124 lineage/);
      const preserved = new DatabaseSync(path);
      try { assert.deepEqual(retainedCiphertextRows(preserved), original); } finally { preserved.close(); }
    } finally { await fixture.close(); }
  });
});
