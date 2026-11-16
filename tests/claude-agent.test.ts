import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { envelope } from "../apps/service/src/controller.ts";
import { ClaudeStreamNormalizer, claudeStreamArgs, summarizeResult } from "../apps/service/src/claude-agent-stream.ts";
import { claudeAgentEnvironment, claudePolicyCall, parseAuthStatus, resolveClaudeExecutable } from "../apps/service/src/claude-agent.ts";
import type { ClaudeWorkerMessage } from "../apps/service/src/claude-agent-protocol.ts";
import { claudeAgentModelId, defaultClaudeAgentSettings, routingModelReady, claudeAgentModelInfo, type ClaudeAgentTransport } from "../packages/protocol/src/index.ts";
import { setupFixture, waitFor } from "./fixture.ts";

const fake = fileURLToPath(new URL("./fixtures/fake-claude.mjs", import.meta.url));
async function fakeClaude(directory: string, auth = "api_key"): Promise<{ executable: string; log: string }> {
  const executable = join(directory, "claude"), log = join(directory, "fake-claude.log");
  await writeFile(executable, `#!/bin/sh\nFAKE_CLAUDE_AUTH='${auth}' FAKE_CLAUDE_LOG='${log}' exec '${process.execPath}' '${fake}' "$@"\n`);
  await chmod(executable, 0o755);
  return { executable, log };
}
async function claudeFixture(transport: ClaudeAgentTransport, auth = "api_key") {
  const directory = await mkdtemp(join(tmpdir(), "moguri-generated-claude-"));
  const { executable, log } = await fakeClaude(directory, auth);
  const fixture = await setupFixture({ platform: { claudeAgent: { executable, environment: { PATH: process.env.PATH, HOME: directory } } } });
  const settings = fixture.service.controller.snapshot().settings;
  await fixture.service.controller.dispatch(envelope({ type: "settings.update", expectedRevision: settings.revision, acknowledgePromptRisk: false,
    settings: { ...settings.values, claudeAgent: { ...defaultClaudeAgentSettings(), enabled: true, transport } } }));
  return { ...fixture, executable, log, close: async () => { await fixture.close(); await rm(directory, { recursive: true, force: true }); } };
}
const modelId = claudeAgentModelId("sonnet");
const argument = (args: string[], name: string) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : args.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1); };

test("Claude stream normalization keeps per-block and cumulative assistant messages, tool results and cumulative usage", () => {
  const frames: ClaudeWorkerMessage[] = [];
  const normalizer = new ClaudeStreamNormalizer("11111111-1111-4111-8111-111111111111", (frame) => frames.push(frame));
  assert.throws(() => normalizer.handle({ type: "system", subtype: "init", session_id: "22222222-2222-4222-8222-222222222222" }), /different native session/);
  normalizer.handle({ type: "system", subtype: "init", session_id: "11111111-1111-4111-8111-111111111111", model: "sonnet" });
  normalizer.handle({ type: "assistant", parent_tool_use_id: null, message: { id: "m1", content: [{ type: "text", text: "Hello" }] } });
  normalizer.handle({ type: "assistant", parent_tool_use_id: null, message: { id: "m1", content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } }] } });
  normalizer.handle({ type: "assistant", parent_tool_use_id: null, message: { id: "m2", content: [{ type: "text", text: "A" }] } });
  normalizer.handle({ type: "assistant", parent_tool_use_id: null, message: { id: "m2", content: [{ type: "text", text: "A" }, { type: "thinking", thinking: "why" }] } });
  normalizer.handle({ type: "assistant", parent_tool_use_id: "toolu_parent", message: { id: "m3", content: [{ type: "text", text: "subagent" }] } });
  normalizer.handle({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", is_error: true, content: [{ type: "text", text: "denied" }] }] } });
  const messages = frames.filter((frame) => frame.kind === "claude.message");
  assert.equal(frames.filter((frame) => frame.kind === "claude.step").length, 2);
  assert.deepEqual(messages.at(1) && { text: messages[1]!.text, calls: messages[1]!.toolCalls.map((call) => call.id) }, { text: "Hello", calls: ["t1"] });
  assert.deepEqual(messages.at(-1) && { text: messages.at(-1)!.text, reasoning: messages.at(-1)!.reasoning }, { text: "A", reasoning: "why" });
  assert.equal(normalizer.stepFor("t1"), messages[1]!.stepId);
  assert.deepEqual(frames.at(-1), { kind: "claude.tool_result", callId: "t1", text: "denied", isError: true });
  const usage = summarizeResult({ subtype: "success", total_cost_usd: 0.5, num_turns: 2, duration_ms: 9,
    modelUsage: { a: { inputTokens: 3, outputTokens: 2, cacheReadInputTokens: 1, cacheCreationInputTokens: 4 }, b: { inputTokens: 1, outputTokens: 1, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } } }, "s");
  assert.deepEqual([usage.outcome, usage.inputTokens, usage.outputTokens, usage.cacheReadTokens, usage.cacheWriteTokens, usage.harnessEstimatedUsd], ["completed", 4, 3, 1, 4, 0.5]);
  assert.equal(summarizeResult({ subtype: "error_during_execution", errors: ["boom"] }, "s").diagnostic, "boom");
  assert.equal(summarizeResult({ subtype: "success" }, "s").inputTokens, null);
});

test("Claude Agent maps tools onto Moguri policy subjects, curates its environment and stays out of Kupo pools", async () => {
  const root = "/generated/root";
  assert.deepEqual(claudePolicyCall({ id: "a", name: "Bash", arguments: { command: "npm test" } }, root)?.arguments, { command: "npm test" });
  assert.deepEqual(claudePolicyCall({ id: "b", name: "Edit", arguments: { file_path: "/generated/root/src/a.ts" } }, root), { id: "b", name: "write_file", arguments: { path: "src/a.ts" } });
  assert.equal(claudePolicyCall({ id: "c", name: "Write", arguments: { file_path: "/elsewhere/a.ts" } }, root)?.arguments.path, "../../elsewhere/a.ts");
  assert.equal(claudePolicyCall({ id: "d", name: "Task", arguments: {} }, root), null);
  const environment = claudeAgentEnvironment({ PATH: "/usr/bin", HOME: "/generated/home", ANTHROPIC_API_KEY: "generated", MOGURI_TOKEN: "secret", GITHUB_TOKEN: "secret", AWS_PROFILE: "generated" }, "/generated/bin/claude");
  assert.equal(environment.ANTHROPIC_API_KEY, "generated"); assert.equal(environment.AWS_PROFILE, "generated");
  assert.equal(environment.MOGURI_TOKEN, undefined); assert.equal(environment.GITHUB_TOKEN, undefined);
  assert.ok(environment.PATH!.split(":").includes("/generated/bin"));
  assert.equal(parseAuthStatus(1, JSON.stringify({ authMethod: "claude.ai" })), "none");
  assert.equal(parseAuthStatus(0, JSON.stringify({ authMethod: "claude.ai", email: "generated@example.invalid" })), "claude.ai");
  assert.equal(parseAuthStatus(0, "not json"), "unknown");
  await assert.rejects(resolveClaudeExecutable({ ...defaultClaudeAgentSettings(), executablePath: null }, { executable: "relative/claude" }), /absolute/);
  assert.equal(await resolveClaudeExecutable(defaultClaudeAgentSettings(), { installLocations: [] }, { PATH: "/nonexistent-generated" }), null);
  assert.equal(routingModelReady(claudeAgentModelInfo("sonnet"), { allowHosted: true }, "Local"), false);
  const args = claudeStreamArgs({ kind: "claude.start", transport: "stream-json", executable: "/x", environment: {}, root: "/r", prompt: "p", model: "opus",
    nativeSessionId: "11111111-1111-4111-8111-111111111111", resume: true, readOnly: true, appendSystemPrompt: "m" });
  assert.deepEqual([args.at(-2), args.at(-1), args[args.indexOf("--permission-mode") + 1], args[args.indexOf("--model") + 1]], ["--resume", "11111111-1111-4111-8111-111111111111", "plan", "opus"]);
});

for (const transport of ["stream-json", "sdk"] as const) {
  test(`Claude Agent (${transport}) runs the user's own executable, routes every tool through Moguri approval and resumes the native session`, { timeout: 60_000 }, async () => {
    const fixture = await claudeFixture(transport);
    try {
      const provider = await waitFor(() => fixture.service.controller.snapshot().provider.models.some((model) => model.id === modelId) &&
        fixture.service.controller.snapshot().provider.connections?.find((connection) => connection.id === "claude-agent"), 15_000);
      assert.equal(provider.status, "connected");
      await assert.rejects(fixture.service.controller.dispatch(envelope({ type: "session.configure", sessionId: fixture.sessionId, expectedRevision: fixture.session().revision,
        controls: { ...fixture.session().controls, modelId, budget: { kind: "limited", tokens: 1000, basis: "estimate" } } })), /token\/USD caps/);
      await fixture.service.controller.dispatch(envelope({ type: "session.configure", sessionId: fixture.sessionId, expectedRevision: fixture.session().revision,
        controls: { ...fixture.session().controls, modelId } }));

      await fixture.send("generated claude write");
      const approval = await waitFor(() => fixture.session().pendingApproval, 20_000);
      assert.equal(approval.call.name, "Write"); assert.equal(approval.call.harness, "claude-agent");
      await assert.rejects(fixture.service.controller.dispatch(envelope({ type: "approval.respond", sessionId: fixture.sessionId, approvalId: approval.id, allow: true,
        remember: { scope: "session", match: "exact" } })), /one exact call/);
      await fixture.service.controller.dispatch(envelope({ type: "approval.respond", sessionId: fixture.sessionId, approvalId: approval.id, allow: true }));
      const first = await fixture.terminal();
      assert.equal(first.status, "completed", first.lastError ?? undefined);
      assert.equal(await readFile(join(fixture.project, "claude-output.txt"), "utf8"), "generated by fake claude\n");
      const binding = first.agentSession!;
      assert.equal(binding.resumed, false); assert.equal(binding.transport, transport); assert.equal(binding.authMethod, "api_key"); assert.equal(binding.root, await realpath(fixture.project));
      assert.ok(first.messages.some((message) => message.role === "assistant" && message.text === "Generated Claude write complete."));
      assert.equal(first.messages.find((message) => message.role === "tool" && message.toolCalls?.[0]?.name === "Write")?.outcome, "completed");
      assert.match(first.messages.findLast((message) => message.role === "notice")?.text ?? "", /Claude Code estimate \$0\.0125 \(not a bill\)/);
      assert.equal(first.processes.at(-1)?.outcome, "completed");
      assert.deepEqual(fixture.service.controller.snapshot().budgetEntries, []);

      await fixture.send("generated follow-up");
      const second = await waitFor(() => { const current = fixture.session(); return current.messages.some((message) => message.text.startsWith("Generated Claude reply: generated follow-up")) && !current.turnId ? current : false; }, 20_000);
      assert.equal(second.status, "completed");
      assert.equal(second.agentSession?.nativeSessionId, binding.nativeSessionId); assert.equal(second.agentSession?.resumed, true);
      const launches = (await readFile(fixture.log, "utf8")).split("\n").filter(Boolean).map((line) => JSON.parse(line) as { args?: string[]; env?: string[] }).filter((entry) => entry.args && entry.args[0] !== "--version" && entry.args[0] !== "auth");
      assert.equal(launches.length, 2);
      assert.equal(argument(launches[0]!.args!, "--session-id"), binding.nativeSessionId);
      assert.equal(argument(launches[1]!.args!, "--resume"), binding.nativeSessionId);
      assert.deepEqual(launches.flatMap((entry) => entry.env ?? []), []);
    } finally { await fixture.close(); }
  });
}

test("Claude Agent denial, stop and missing sign-in keep truthful outcomes without fallback", { timeout: 60_000 }, async () => {
  const fixture = await claudeFixture("stream-json");
  try {
    await waitFor(() => fixture.service.controller.snapshot().provider.models.some((model) => model.id === modelId), 15_000);
    await fixture.service.controller.dispatch(envelope({ type: "session.configure", sessionId: fixture.sessionId, expectedRevision: fixture.session().revision,
      controls: { ...fixture.session().controls, modelId } }));
    await fixture.send("generated claude write");
    await fixture.approve(false);
    const denied = await fixture.terminal();
    assert.equal(denied.status, "completed");
    assert.equal(existsSync(join(fixture.project, "claude-output.txt")), false);
    assert.equal(denied.messages.find((message) => message.role === "tool")?.outcome, "denied");
    assert.ok(denied.messages.some((message) => message.text === "Generated Claude write was denied."));

    await fixture.send("generated claude hang");
    await waitFor(() => fixture.session().messages.some((message) => message.text === "Generated Claude is working."), 20_000);
    await assert.rejects(fixture.send("generated steer", "steer"), /Queue and Interrupt/);
    await fixture.service.controller.dispatch(envelope({ type: "session.stop", sessionId: fixture.sessionId }));
    const stopped = await fixture.terminal();
    assert.equal(stopped.status, "stopped");
    const process = stopped.processes.at(-1)!;
    assert.throws(() => globalThis.process.kill(process.pid, 0));
  } finally { await fixture.close(); }

  const unsigned = await claudeFixture("stream-json", "none");
  try {
    const connection = await waitFor(() => { const value = unsigned.service.controller.snapshot().provider.connections?.find((entry) => entry.id === "claude-agent"); return value?.status === "disconnected" && value.diagnostic?.includes("claude auth login") ? value : false; }, 15_000);
    assert.match(connection.diagnostic!, /never collects Claude credentials/);
    await assert.rejects(unsigned.service.controller.dispatch(envelope({ type: "session.configure", sessionId: unsigned.sessionId, expectedRevision: unsigned.session().revision,
      controls: { ...unsigned.session().controls, modelId } })), /not signed in/);
  } finally { await unsigned.close(); }
});
