import { Type, type Static, type Message, type AssistantMessage } from "@earendil-works/pi-ai";
import { Value } from "typebox/value";
import { isRecord, MAX_TEXT, type ToolCall } from "../../../packages/protocol/src/index.ts";
import type { PreparedModel } from "./provider.ts";

const toolCall = Type.Object({ id: Type.String(), name: Type.String(), arguments: Type.Record(Type.String(), Type.Unknown()) });
export const WorkerRequestSchema = Type.Union([
  Type.Object({ kind: Type.Literal("boundary"), requestId: Type.String(), stepId: Type.String() }),
  Type.Object({ kind: Type.Literal("model.complete"), requestId: Type.String(), stepId: Type.String(), message: Type.Unknown(), usageReported: Type.Boolean(), generationMs: Type.Number() }),
  Type.Object({ kind: Type.Literal("approval"), requestId: Type.String(), stepId: Type.String(), call: toolCall }),
  Type.Object({ kind: Type.Literal("tool.complete"), requestId: Type.String(), stepId: Type.String(), call: toolCall, text: Type.String({ maxLength: MAX_TEXT + 4096 }), isError: Type.Boolean(), outcome: Type.String() }),
  Type.Object({ kind: Type.Literal("delta"), stepId: Type.String(), text: Type.String({ maxLength: MAX_TEXT }) }),
  Type.Object({ kind: Type.Literal("output"), stepId: Type.String(), callId: Type.String(), text: Type.String({ maxLength: 16_384 }) }),
  Type.Object({ kind: Type.Literal("process"), stepId: Type.String(), callId: Type.String(), pid: Type.Integer({ minimum: 1 }) }),
  Type.Object({ kind: Type.Literal("ack") }),
  Type.Object({ kind: Type.Literal("finished"), requestId: Type.String(), outcome: Type.Union([Type.Literal("completed"), Type.Literal("stopped"), Type.Literal("failed"), Type.Literal("partial")]), diagnostic: Type.Union([Type.String(), Type.Null()]) }),
]);
export type WorkerRequest = Static<typeof WorkerRequestSchema>;
export interface WorkerStart { kind: "start"; root: string; context: Message[] }
export interface BoundaryReply extends PreparedModel { steers: Message[] }
export type WorkerReply = { kind: "reply"; requestId: string; value?: BoundaryReply | { allow: boolean } | { accepted: boolean }; error?: string };
export type ParentMessage = WorkerStart | WorkerReply | { kind: "stop" };
export function parentMessage(value: unknown): ParentMessage {
  if (!isRecord(value)) throw new Error("Invalid parent message.");
  if (value.kind === "stop") return { kind: "stop" };
  if (value.kind === "reply" && typeof value.requestId === "string" &&
    (value.error === undefined || typeof value.error === "string") &&
    (value.value === undefined || isRecord(value.value))) return value as ParentMessage;
  if (value.kind === "start" && typeof value.root === "string" && Array.isArray(value.context)) return value as ParentMessage;
  throw new Error("Invalid parent message.");
}
const assistantSchema = Type.Object({
  role: Type.Literal("assistant"), api: Type.String(), provider: Type.String(), model: Type.String(),
  timestamp: Type.Number(), stopReason: Type.String(),
  content: Type.Array(Type.Union([
    Type.Object({ type: Type.Literal("text"), text: Type.String() }),
    Type.Object({ type: Type.Literal("thinking"), thinking: Type.String() }),
    Type.Object({ type: Type.Literal("toolCall"), id: Type.String(), name: Type.String(), arguments: Type.Record(Type.String(), Type.Unknown()) }),
  ])),
  usage: Type.Object({
    input: Type.Number({ minimum: 0 }), output: Type.Number({ minimum: 0 }), cacheRead: Type.Number({ minimum: 0 }),
    cacheWrite: Type.Number({ minimum: 0 }), totalTokens: Type.Number({ minimum: 0 }),
    cost: Type.Object({ input: Type.Number(), output: Type.Number(), cacheRead: Type.Number(), cacheWrite: Type.Number(), total: Type.Number() }),
  }),
});
export function assistantMessage(value: unknown): AssistantMessage {
  if (!Value.Check(assistantSchema, value)) throw new Error("Worker returned an invalid normalized model message.");
  return value as AssistantMessage;
}
export function toolCalls(message: AssistantMessage): ToolCall[] {
  return message.content.filter((block) => block.type === "toolCall").map((block) => ({ id: block.id, name: block.name, arguments: block.arguments }));
}
export function usagePresent(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const numeric = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0;
  if (value.type === "message_delta" && isRecord(value.usage)) return numeric(value.usage.output_tokens);
  const usage = isRecord(value.response) ? value.response.usage : value.usage;
  if (!isRecord(usage) || value.type === "message_start") return false;
  return (numeric(usage.prompt_tokens) && numeric(usage.completion_tokens)) ||
    (numeric(usage.input_tokens) && numeric(usage.output_tokens));
}
