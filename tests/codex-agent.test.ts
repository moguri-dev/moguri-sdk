import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { envelope } from "../apps/service/src/controller.ts";
import { CodexItemNormalizer, codexTokenTotals } from "../apps/service/src/codex-agent-stream.ts";
import { codexAgentEnvironment, codexAuthMethod, codexAutonomousReads, codexModels, codexPolicyCalls } from "../apps/service/src/codex-agent.ts";
import { parseCodexVersion } from "../apps/service/src/codex-app-server.ts";
import type { AgentWorkerMessage } from "../apps/service/src/agent-harness-protocol.ts";
import { agentHarnessOf, codexAgentModelId, codexAgentModelName, defaultCodexAgentSettings, routingModelReady, type UserSettings } from "../packages/protocol/src/index.ts";
import { setupFixture, waitFor } from "./fixture.ts";

const fake = fileURLToPath(new URL("./fixtures/fake-codex.mjs", import.meta.url));
async function codexFixture(auth = "chatgpt") {
  const directory = await mkdtemp(join(tmpdir(), "moguri-generated-codex-"));
  const executable = join(directory, "codex"), log = join(directory, "fake-codex.log");
  await writeFile(executable, `#!/bin/sh\nFAKE_CODEX_AUTH='${auth}' FAKE_CODEX_LOG='${log}' exec '${process.execPath}' '${fake}' "$@"\n`);
  await chmod(executable, 0o755);
  const fixture = await setupFixture({ platform: { codexAgent: { executable, environment: { PATH: process.env.PATH, HOME: directory } } } });
  const settings = fixture.service.controller.snapshot().settings;
  await fixture.service.controller.dispatch(envelope({ type: "settings.update", expectedRevision: settings.revision, acknowledgePromptRisk: false,
    settings: { ...settings.values, codexAgent: { ...defaultCodexAgentSettings(), enabled: true } } }));
  const entries = async () => (await readFile(log, "utf8")).split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
  return { ...fixture, log, entries, close: async () => { await fixture.close(); await rm(directory, { recursive: true, force: true }); } };
}
const modelId = codexAgentModelId("gpt-generated");

test("Codex items group into Moguri steps, calls and results with approval-first commands and autonomous reads flagged", () => {
  const frames: AgentWorkerMessage[] = [];
  const normalizer = new CodexItemNormalizer("gpt-generated", (frame) => frames.push(frame));
  normalizer.handle("item/started", { item: { type: "agentMessage", id: "m1", text: "" } });
  normalizer.handle("item/agentMessage/delta", { itemId: "m1", delta: "Hi" });
  normalizer.handle("item/completed", { item: { type: "agentMessage", id: "m1", text: "Hi" } });
  normalizer.handle("item/started", { item: { type: "fileChange", id: "f1", status: "inProgress", changes: [{ path: "/r/a.ts", kind: { type: "update", move_path: "/r/b.ts" }, diff: "-a\n+b" }] } });
  const reviewed = normalizer.approvalCall("f1", null, { id: "f1", name: "file_change", arguments: { changes: [] } });
  assert.deepEqual(reviewed.arguments.changes, [{ path: "/r/a.ts", kind: "update", movePath: "/r/b.ts", diff: "-a\n+b" }]);
  normalizer.handle("item/completed", { item: { type: "fileChange", id: "f1", status: "completed", changes: [{ path: "/r/a.ts", kind: { type: "update" }, diff: "" }] } });
  const command = normalizer.approvalCall("c1", null, { id: "c1", name: "command", arguments: { command: "npm test", cwd: "/r", actions: [] } });
  normalizer.handle("item/started", { item: { type: "commandExecution", id: "c1", command: "npm test", cwd: "/r", commandActions: [], status: "inProgress" } });
  normalizer.handle("item/completed", { item: { type: "commandExecution", id: "c1", command: "npm test", cwd: "/r", commandActions: [], status: "failed", aggregatedOutput: "boom", exitCode: 1 } });
  normalizer.handle("item/completed", { item: { type: "commandExecution", id: "c2", command: "ls", cwd: "/r", commandActions: [{ type: "listFiles", command: "ls" }], status: "completed", aggregatedOutput: "a", exitCode: 0 } });
  const steps = frames.filter((frame) => frame.kind === "agent.step"), responses = frames.filter((frame) => frame.kind === "agent.response");
  assert.equal(steps.length, 3);
  assert.deepEqual(responses.map((frame) => [frame.text, frame.toolCalls.map((call) => call.id)]), [["Hi", ["f1"]], ["", ["c1"]], ["", ["c2"]]]);
  assert.equal(command.name, "command");
  const results = frames.filter((frame) => frame.kind === "agent.tool_result");
  assert.deepEqual(results.map((frame) => [frame.callId, frame.isError, frame.autonomous ?? false]), [["f1", false, false], ["c1", true, false], ["c2", false, true]]);
  assert.match(results[1]!.text, /boom\n\(exit 1\)/);
  assert.equal(normalizer.toolsRan, true);
  assert.deepEqual(codexTokenTotals({ tokenUsage: { total: { inputTokens: 9, cachedInputTokens: 2, outputTokens: 3 } } }), { inputTokens: 9, outputTokens: 3, cacheReadTokens: 2, cacheWriteTokens: null });
  const sub = new CodexItemNormalizer("m", () => {});
  const child = sub.approvalCall("c9", "a1", { id: "c9", name: "command", arguments: { command: "git push", cwd: "/r", actions: [] } });
  assert.equal(child.id, "c9:a1");
});

test("Codex Agent maps tools and reads onto Moguri policy, keeps login details private and stays out of Kupo", () => {
  const root = "/generated/root";
  assert.deepEqual(codexPolicyCalls({ id: "a", name: "command", arguments: { command: "npm test" } }, root), [{ id: "a", name: "run_command", arguments: { command: "npm test" } }]);
  assert.deepEqual(codexPolicyCalls({ id: "b", name: "file_change", arguments: { changes: [{ path: "/generated/root/src/a.ts" }, { path: "/elsewhere/b.ts" }] } }, root).map((call) => call.arguments.path),
    ["src/a.ts", "../../elsewhere/b.ts"]);
  assert.deepEqual(codexPolicyCalls({ id: "c", name: "file_change", arguments: { changes: [] } }, root), []);
  assert.equal(codexPolicyCalls({ id: "d", name: "mcp:generated/mutate", arguments: {} }, root)[0]!.name, "codex:mcp:generated/mutate");
  assert.deepEqual(codexAutonomousReads({ id: "e", name: "command", arguments: { command: "cat a", cwd: "/generated/root/src", actions: [{ type: "read", path: "a.ts" }, { type: "search" }] } }, root)?.map((call) => [call.name, call.arguments.path]),
    [["read_file", "src/a.ts"], ["find_files", "src"]]);
  assert.equal(codexAutonomousReads({ id: "f", name: "command", arguments: { command: "x", actions: [{ type: "unknown" }] } }, root), null);
  assert.equal(codexAutonomousReads({ id: "g", name: "command", arguments: { command: "x", actions: [] } }, root), null);
  assert.deepEqual([codexAuthMethod({ account: { type: "chatgpt", email: "generated@example.invalid" } }), codexAuthMethod({ account: { type: "apiKey" } }),
    codexAuthMethod({ account: null, requiresOpenaiAuth: true }), codexAuthMethod({ account: null, requiresOpenaiAuth: false })], ["chatgpt", "api_key", "none", "third_party"]);
  const models = codexModels([{ data: [{ model: "a", displayName: "A", hidden: false }, { model: "h", hidden: true }, { model: "a" }] }, { data: [{ model: "weird/name", displayName: "W" }] }]);
  assert.deepEqual(models.map((model) => model.model), ["a", "weird/name"]);
  assert.match(codexAgentModelId("weird/name"), /^codex-agent\.[0-9a-f]{16}$/);
  assert.equal(codexAgentModelName({ apiModelId: "codex-agent:weird/name" }), "weird/name");
  assert.equal(agentHarnessOf(codexAgentModelId("a")), "codex-agent");
  assert.equal(parseCodexVersion("codex_cli_rs/0.163.0 (Mac OS; arm64)"), "0.163.0");
  const environment = codexAgentEnvironment({ PATH: "/usr/bin", HOME: "/generated/home", OPENAI_API_KEY: "generated", CODEX_HOME: "/generated/codex", MOGURI_TOKEN: "secret", GITHUB_TOKEN: "secret", ANTHROPIC_API_KEY: "other" }, "/generated/bin/codex");
  assert.equal(environment.CODEX_HOME, "/generated/codex"); assert.equal(environment.OPENAI_API_KEY, "generated");
  assert.equal(environment.MOGURI_TOKEN, undefined); assert.equal(environment.GITHUB_TOKEN, undefined); assert.equal(environment.ANTHROPIC_API_KEY, undefined);
  assert.equal(routingModelReady({ id: modelId, name: "x", contextWindow: 200_000, maxTokens: 32_000, imageInput: false, toolInput: true, thinkingLevels: [], kupoThinkingLevels: [], source: "codex-agent" }, { allowHosted: true }, "Local"), false);
});

test("Codex Agent runs the installed app-server with Moguri approvals, resumes its thread and records honest usage", { timeout: 90_000 }, async () => {
  const fixture = await codexFixture();
  try {
    const connection = await waitFor(() => fixture.service.controller.snapshot().provider.models.some((model) => model.id === modelId) &&
      fixture.service.controller.snapshot().provider.connections?.find((entry) => entry.id === "codex-agent"), 20_000);
    assert.equal(connection.status, "connected");
    const listed = fixture.service.controller.snapshot().provider.models.filter((model) => model.source === "codex-agent").map((model) => model.id).sort();
    assert.deepEqual(listed, [codexAgentModelId("gpt-generated"), codexAgentModelId("gpt-generated-mini")]);
    await assert.rejects(fixture.service.controller.dispatch(envelope({ type: "session.configure", sessionId: fixture.sessionId, expectedRevision: fixture.session().revision,
      controls: { ...fixture.session().controls, modelId, budget: { kind: "limited", tokens: 1000, basis: "estimate" } } })), /token\/USD caps/);
    await fixture.service.controller.dispatch(envelope({ type: "session.configure", sessionId: fixture.sessionId, expectedRevision: fixture.session().revision, controls: { ...fixture.session().controls, modelId } }));

    await fixture.send("generated codex write");
    const approval = await waitFor(() => fixture.session().pendingApproval, 20_000);
    assert.equal(approval.call.name, "file_change"); assert.equal(approval.call.harness, "codex-agent");
    assert.match(String((approval.call.arguments.changes as { path: string }[])[0]!.path), /codex-output\.txt$/);
    await assert.rejects(fixture.service.controller.dispatch(envelope({ type: "approval.respond", sessionId: fixture.sessionId, approvalId: approval.id, allow: true,
      remember: { scope: "session", match: "exact" } })), /one exact call/);
    await fixture.service.controller.dispatch(envelope({ type: "approval.respond", sessionId: fixture.sessionId, approvalId: approval.id, allow: true }));
    const first = await fixture.terminal();
    assert.equal(first.status, "completed", first.lastError ?? "");
    assert.equal(await readFile(join(fixture.project, "codex-output.txt"), "utf8"), "generated by fake codex\n");
    const binding = first.agentSession!;
    assert.deepEqual([binding.harness, binding.transport, binding.authMethod, binding.resumed, binding.executable.version], ["codex-agent", "app-server", "chatgpt", false, "0.163.0"]);
    assert.match(binding.nativeSessionId, /^thr_/); assert.equal(binding.root, await realpath(fixture.project));
    assert.ok(first.messages.some((message) => message.role === "assistant" && message.text === "Generated Codex write complete."));
    assert.equal(first.messages.find((message) => message.role === "tool" && message.toolCalls?.[0]?.name === "file_change")?.outcome, "completed");
    assert.match(first.messages.findLast((message) => message.role === "notice")?.text ?? "", /Codex Agent session totals reported by Codex: 120 input, 30 output, 20 cache-read tokens; no cost estimate/);
    assert.deepEqual(fixture.service.controller.snapshot().budgetEntries, []);

    await fixture.send("generated codex read");
    const second = await waitFor(() => { const current = fixture.session(); return current.messages.some((message) => message.text === "Generated Codex read complete.") && !current.turnId ? current : false; }, 20_000);
    assert.equal(second.status, "completed", second.lastError ?? "");
    const read = second.messages.findLast((message) => message.role === "tool")!;
    assert.equal(read.outcome, "completed"); assert.match(read.text, /trusted read-only command/);
    assert.equal(second.agentSession?.nativeSessionId, binding.nativeSessionId); assert.equal(second.agentSession?.resumed, true);

    const entries = await fixture.entries();
    const threads = entries.filter((entry) => entry.method === "thread/start" || entry.method === "thread/resume") as { method: string; params: Record<string, unknown> }[];
    assert.deepEqual(threads.map((entry) => entry.method), ["thread/start", "thread/resume"]);
    assert.equal(threads[1]!.params.threadId, binding.nativeSessionId);
    for (const { params } of threads) assert.deepEqual([params.approvalPolicy, params.approvalsReviewer, params.sandbox, params.config], ["untrusted", "user", "workspace-write", { web_search: "disabled" }]);
    const turns = entries.filter((entry) => entry.method === "turn/start");
    assert.deepEqual(turns.map((entry) => [entry.approvalPolicy, entry.sandboxPolicy]), [["untrusted", { type: "workspaceWrite", networkAccess: false }], ["untrusted", { type: "workspaceWrite", networkAccess: false }]]);
    assert.deepEqual(entries.flatMap((entry) => (entry.env as string[] | undefined) ?? []), []);
  } finally { await fixture.close(); }
});

test("Codex Agent declines, flags unapproved tools, stops with group cleanup and blocks without sign-in or under default deny", { timeout: 90_000 }, async () => {
  const fixture = await codexFixture();
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
    await waitFor(() => fixture.service.controller.snapshot().provider.models.some((model) => model.id === modelId), 20_000);
    await fixture.service.controller.dispatch(envelope({ type: "session.configure", sessionId: fixture.sessionId, expectedRevision: fixture.session().revision, controls: { ...fixture.session().controls, modelId } }));
    await fixture.send("generated codex command");
    const asked = await waitFor(() => fixture.session().pendingApproval, 20_000);
    assert.deepEqual([asked.call.name, asked.call.arguments.command], ["command", "npm test"]);
    await fixture.approve(false);
    const declined = await fixture.terminal();
    assert.equal(declined.status, "completed", declined.lastError ?? "");
    assert.equal(declined.messages.findLast((message) => message.role === "tool")?.outcome, "denied");
    assert.ok(declined.messages.some((message) => message.text === "Generated Codex command was declined."));

    const rogue = await turn("generated codex rogue");
    assert.equal(rogue.status, "partial"); assert.match(rogue.lastError ?? "", /never approved/);
    assert.equal(rogue.messages.findLast((message) => message.role === "tool")?.outcome, "unconfirmed");
    await fixture.service.controller.dispatch(envelope({ type: "session.resume", sessionId: fixture.sessionId }));

    const failed = await turn("generated codex fail");
    assert.equal(failed.status, "failed"); assert.match(failed.lastError ?? "", /generated upstream failure/);
    await fixture.service.controller.dispatch(envelope({ type: "session.resume", sessionId: fixture.sessionId }));

    await fixture.send("generated codex hang");
    await waitFor(() => fixture.session().messages.some((message) => message.text === "Generated Codex is working."), 20_000);
    await assert.rejects(fixture.send("generated steer", "steer"), /Queue and Interrupt/);
    await fixture.service.controller.dispatch(envelope({ type: "session.stop", sessionId: fixture.sessionId }));
    const stopped = await fixture.terminal();
    assert.equal(stopped.status, "stopped", stopped.lastError ?? "");
    const orphan = (await fixture.entries()).findLast((entry) => entry.orphan)!.orphan as number;
    assert.throws(() => process.kill(orphan, 0));
    assert.throws(() => process.kill(stopped.processes.at(-1)!.pid, 0));

    await settings((values) => ({ ...values, permissions: { ...values.permissions, defaultDecision: "deny" } }));
    await assert.rejects(fixture.send("generated codex read"), /default tool policy is deny/);
    assert.equal(existsSync(join(fixture.project, "codex-output.txt")), false);
  } finally { await fixture.close(); }

  const unsigned = await codexFixture("none");
  try {
    const connection = await waitFor(() => { const value = unsigned.service.controller.snapshot().provider.connections?.find((entry) => entry.id === "codex-agent"); return value?.status === "disconnected" && value.diagnostic?.includes("codex login") ? value : false; }, 20_000);
    assert.match(connection.diagnostic!, /never collects Codex credentials/);
    assert.equal(unsigned.service.controller.snapshot().provider.models.some((model) => model.source === "codex-agent"), false);
  } finally { await unsigned.close(); }
});
