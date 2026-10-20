import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import type { AssistantMessage, Message } from "@earendil-works/pi-ai";
import { parse } from "../packages/protocol/src/index.ts";
import { digest } from "../apps/service/src/store.ts";
import { localWorker } from "../apps/service/src/worker-connection.ts";
import { WorkerRequestSchema, type WorkerRequest } from "../apps/service/src/worker-protocol.ts";
import { estimateModelContext } from "../apps/service/src/model-controls.ts";
import { COMPACTION_PROMPT, compactionInput, compactionProposal, estimateConversationTokens, selectCompactionPrefix, type ContextEntry } from "../apps/service/src/compaction-context.ts";
import { fixtureProvider, waitFor } from "./fixture.ts";

const assistant = (text: string): AssistantMessage => ({
  role: "assistant", api: "openai-completions", provider: "github-copilot", model: "generated-model",
  timestamp: 1000, stopReason: "stop", content: [{ type: "text", text }],
  usage: { input: 30, output: 12, cacheRead: 0, cacheWrite: 0, totalTokens: 42, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
});
function history(): ContextEntry[] {
  const messages: Array<{ turnId: string; message: Message }> = [];
  for (let index = 0; index < 4; index++) {
    const turnId = `generated-turn-${index}`;
    messages.push({ turnId, message: { role: "user", content: `Generated turn ${index}. ` + "Generated retained detail. ".repeat(100), timestamp: 1000 } });
    if (index === 0) {
      messages.push({ turnId, message: { ...assistant(""), stopReason: "toolUse", content: [{ type: "toolCall", id: "generated-read", name: "read_file", arguments: { path: "fixture.txt" } }] } });
      messages.push({ turnId, message: { role: "toolResult", toolCallId: "generated-read", toolName: "read_file", content: [{ type: "text", text: "Generated original file." }], isError: false, timestamp: 1000 } });
    }
    messages.push({ turnId, message: assistant(`Generated completed turn ${index}.`) });
  }
  return messages.map((entry, index) => ({ ...entry, seq: index + 1 }));
}

test("compaction keeps complete recent turns and tool pairs without mutating original history", () => {
  const entries = history(), original = structuredClone(entries);
  const selection = selectCompactionPrefix(entries, 2);
  assert.equal(selection.prefix.at(-1)?.turnId, "generated-turn-1");
  assert.equal(selection.tail[0]?.turnId, "generated-turn-2");
  assert.equal(selection.throughSeq, 6);
  assert.equal(selection.prefix.filter((entry) => entry.message.role === "toolResult").length, 1);
  assert.deepEqual(entries, original);
  assert.throws(() => selectCompactionPrefix(entries, 4), { code: "compaction_history" });
  assert.throws(() => selectCompactionPrefix(entries, 0), { code: "compaction_keep" });
});

test("unfinished, orphaned or interleaved tool history and image context fail closed", () => {
  const entries = history();
  assert.throws(() => selectCompactionPrefix(entries.filter((entry) => entry.message.role !== "toolResult"), 2), { code: "compaction_pairs" });
  assert.throws(() => selectCompactionPrefix(entries.filter((entry) => entry.message.role !== "assistant" || entry.message.content.every((block) => block.type !== "toolCall")), 2), { code: "compaction_pairs" });
  assert.throws(() => selectCompactionPrefix([...entries, { ...entries[0]!, seq: 20 }], 2), { code: "compaction_history" });
  assert.throws(() => selectCompactionPrefix([...entries, { seq: 20, turnId: "generated-image-turn", message: { role: "user", content: [{ type: "image", mimeType: "image/png", data: "AA==" }], timestamp: 1000 } }], 2), { code: "compaction_images" });
});

test("a proposal stays model-authored, strictly smaller and bound to its source; rejected text cannot truncate history", () => {
  const entries = history(), selected = selectCompactionPrefix(entries, 2), original = structuredClone(entries);
  const sourceDigest = digest(JSON.stringify(entries));
  const proposal = compactionProposal(selected, assistant("Generated summary: preserve the completed file read and the unresolved fixture task."), sourceDigest);
  assert.ok(proposal.afterTokens < proposal.beforeTokens);
  assert.equal(proposal.replacement.role, "assistant");
  assert.match(JSON.stringify(proposal.replacement), /model-produced|not a user answer/);
  assert.match(JSON.stringify(proposal.replacement), new RegExp(sourceDigest));
  assert.deepEqual(entries, original);
  assert.throws(() => compactionProposal(selected, assistant("Generated expansion. ".repeat(1000)), sourceDigest), { code: "compaction_not_smaller" });
  assert.throws(() => compactionProposal(selected, { ...assistant("Generated incomplete summary."), stopReason: "length" }, sourceDigest), { code: "compaction_result" });
  assert.throws(() => compactionProposal(selected, { ...assistant(""), content: [{ type: "toolCall", id: "generated-forbidden", name: "run_command", arguments: {} }] }, sourceDigest), { code: "compaction_result" });
});

test("old usage and the compactor's own input report cannot anchor the replacement conversation estimate", () => {
  const selected = selectCompactionPrefix(history(), 2), actual = assistant("Generated small summary.");
  const proposal = compactionProposal(selected, actual, "a".repeat(64));
  const messages = [proposal.replacement, ...selected.tail.map((entry) => entry.message)];
  assert.equal(estimateModelContext({ messages }), estimateConversationTokens(messages));
  assert.ok(proposal.replacement.timestamp > Math.max(...selected.tail.map((entry) => entry.message.timestamp)));
  assert.equal(actual.usage.totalTokens, 42);
  assert.equal(proposal.replacement.usage.totalTokens, 0);
});

async function ownedProbe(fixture: Awaited<ReturnType<typeof fixtureProvider>>, entries: ContextEntry[], cancel = false) {
  const selected = selectCompactionPrefix(entries, 2), sourceDigest = digest(JSON.stringify(entries));
  const worker = localWorker(fileURLToPath(new URL("../apps/service/src/worker.ts", import.meta.url)), "generated-compaction-probe");
  const messages: WorkerRequest[] = [];
  let failure: unknown, chain = Promise.resolve();
  const exited = new Promise<void>((resolve) => worker.events.once("exit", () => resolve()));
  worker.events.on("error", (error) => { failure = error; });
  worker.events.on("message", (raw) => {
    chain = chain.then(async () => {
      const request = parse(WorkerRequestSchema, raw); messages.push(request);
      if (request.kind === "boundary") {
        const prepared = await fixture.provider.prepare(fixture.modelId, AbortSignal.timeout(5000));
        worker.send({ kind: "reply", requestId: request.requestId, value: { ...prepared, maxTokens: 512, systemPrompt: COMPACTION_PROMPT, tools: [], steers: [], mode: "read-only", folders: { denied: [], readOnly: [] } } });
      } else if (request.kind === "model.complete" || request.kind === "finished") worker.send({ kind: "reply", requestId: request.requestId, value: { accepted: true } });
      else if (request.kind === "approval" || request.kind === "delegate") throw new Error("The compaction probe attempted a tool.");
    }).catch((error: unknown) => { failure = error; });
  });
  try {
    worker.send({ kind: "start", root: null, context: compactionInput(selected.prefix, sourceDigest, 1000), readOnly: true });
    if (cancel) { await waitFor(() => fixture.requests.length === 1); worker.send({ kind: "stop" }); }
    const terminal = await waitFor(() => {
      if (failure) throw failure;
      return messages.find((message) => message.kind === "finished");
    });
    await exited; await chain;
    if (failure) throw failure;
    return { messages, terminal };
  } finally {
    if (worker.connected) { worker.kill("SIGTERM"); await exited; }
  }
}

test("the actual owned worker makes one bounded tool-less compaction call with real normalized metering", { timeout: 10_000 }, async () => {
  const fixture = await fixtureProvider({ responseMode: "text", replyText: "Generated compacted facts: the fixture was read; preserve current intent and unresolved work." });
  const started = performance.now();
  try {
    const result = await ownedProbe(fixture, history());
    const completion = result.messages.find((message) => message.kind === "model.complete");
    assert.equal(result.terminal.kind, "finished");
    assert.equal(result.terminal.kind === "finished" && result.terminal.outcome, "completed");
    assert.equal(result.messages.filter((message) => message.kind === "boundary").length, 1);
    assert.equal(completion?.kind === "model.complete" && completion.usageReported, true);
    assert.equal(fixture.requests.length, 1);
    assert.equal(fixture.requests[0]?.tools, undefined);
    assert.equal(fixture.requests[0]?.max_tokens ?? fixture.requests[0]?.max_completion_tokens, 512);
    assert.match(JSON.stringify(fixture.requests[0]), /sourceDigest/);
    console.log(JSON.stringify({ primitive: "owned-context-compaction", ms: performance.now() - started, calls: 1, maxOutputTokens: 512, originalMessages: history().length, productionQuality: false }));
  } finally { await fixture.close(); }
});

test("owned cancellation is acknowledged and cannot turn a partial compactor response into a successful proposal", { timeout: 10_000 }, async () => {
  const fixture = await fixtureProvider();
  const entries = history();
  entries[0] = { ...entries[0]!, message: { role: "user", content: "generated slow compaction fixture", timestamp: 1000 } };
  try {
    const result = await ownedProbe(fixture, entries, true);
    assert.ok(result.messages.some((message) => message.kind === "ack"));
    assert.equal(result.terminal.kind === "finished" && result.terminal.outcome, "stopped");
    assert.equal(fixture.requests.length, 1);
    assert.equal(result.messages.some((message) => message.kind === "approval" || message.kind === "delegate"), false);
  } finally { await fixture.close(); }
});
