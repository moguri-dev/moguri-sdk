import assert from "node:assert/strict";
import test from "node:test";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { normalizeToolCallIds, toolCalls } from "../apps/service/src/worker-protocol.ts";

const message = (ids: string[]): AssistantMessage => ({
  role: "assistant", api: "openai-completions", provider: "generated", model: "generated-model", stopReason: "toolUse", timestamp: 0,
  content: [{ type: "text", text: "Generated unchanged advice." }, ...ids.map((id) => ({ type: "toolCall" as const, id, name: "generated_tool", arguments: { generated: true } }))],
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
});

test("fresh provider tool IDs become bounded unique identities without changing valid calls, advice or original source", () => {
  const original = message(["", "x".repeat(257), "generated\u0000id", "\ud800", "generated\u007fid", "valid-generated-id", "valid-generated-id"]);
  const before = structuredClone(original), normalized = normalizeToolCallIds(original, "generated-step");
  const calls = toolCalls(normalized), ids = calls.map((call) => call.id);
  assert.deepEqual(original, before);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every((id) => id.length > 0 && id.length <= 256 && id.isWellFormed() && !/[\u0000-\u001f\u007f]/.test(id)));
  assert.equal(ids[5], "valid-generated-id"); assert.notEqual(ids[6], ids[5]);
  assert.deepEqual(normalized.content[0], original.content[0]); assert.deepEqual(normalized.usage, original.usage);
  assert.ok(calls.every((call) => call.name === "generated_tool" && call.arguments.generated === true));
  assert.deepEqual(normalizeToolCallIds(original, "generated-step"), normalized);
  assert.deepEqual(normalizeToolCallIds(normalized, "generated-step"), normalized);
});

test("assigned tool IDs cannot displace a later valid provider ID and remain bounded for long internal step identifiers", () => {
  const step = "generated-step", assigned = toolCalls(normalizeToolCallIds(message([""]), step))[0]!.id;
  const normalized = toolCalls(normalizeToolCallIds(message(["", assigned, "valid-generated-id"]), step));
  assert.notEqual(normalized[0]!.id, assigned); assert.equal(normalized[1]!.id, assigned);
  assert.equal(normalized[2]!.id, "valid-generated-id");
  assert.ok(toolCalls(normalizeToolCallIds(message([""]), "generated".repeat(1000)))[0]!.id.length <= 256);
  assert.notEqual(toolCalls(normalizeToolCallIds(message([""]), "another-generated-step"))[0]!.id, assigned);
});
