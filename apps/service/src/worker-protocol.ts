import { Type, type Static, type Message, type AssistantMessage, type Tool } from "@earendil-works/pi-ai";
import { Value } from "typebox/value";
import { CompoundValidationResultSchema, HookBindingSchema, isRecord, MAX_TEXT, ModelStreamObservationSchema, PlanFileResultSchema, ToolCallSchema, type HookBinding, type ToolCall, type SessionMode, type ThinkingEffort } from "../../../packages/protocol/src/index.ts";
import type { FolderPolicy } from "./project-policy.ts";
import type { PreparedModel } from "./provider.ts";
import { UserPlanInputSchema } from "./user-plan.ts";
import { RemoteMcpExecutionResultSchema, type RemoteMcpAuthorization } from "./remote-mcp-runtime.ts";
import type { CompoundValidationOperation } from "./compound-validation.ts";

const toolCall = ToolCallSchema;
export const WorkerRequestSchema = Type.Union([
  Type.Object({ kind: Type.Literal("boundary"), requestId: Type.String(), stepId: Type.String(), loadedTools: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 128 }), { maxItems: 64, uniqueItems: true })) }),
  Type.Object({ kind: Type.Literal("model.complete"), requestId: Type.String(), stepId: Type.String(), message: Type.Unknown(), usageReported: Type.Boolean(), generationMs: Type.Number({ minimum: 0 }), stream: Type.Optional(ModelStreamObservationSchema) }),
  Type.Object({ kind: Type.Literal("approval"), requestId: Type.String(), stepId: Type.String(), call: toolCall }),
  Type.Object({ kind: Type.Literal("hook"), requestId: Type.String(), stepId: Type.String(), call: toolCall }),
  Type.Object({ kind: Type.Literal("delegate"), requestId: Type.String(), stepId: Type.String(), call: toolCall, quiescent: Type.Optional(Type.Boolean()) }),
  Type.Object({ kind: Type.Literal("tool.complete"), requestId: Type.String(), stepId: Type.String(), call: toolCall, text: Type.String({ maxLength: MAX_TEXT + 4096 }), isError: Type.Boolean(), outcome: Type.String(),
    rawText: Type.Optional(Type.String({ maxLength: 2 * 1024 * 1024 })), rawComplete: Type.Optional(Type.Boolean()) }),
  Type.Object({ kind: Type.Literal("user-plan.complete"), requestId: Type.String(), stepId: Type.String(), call: toolCall, result: PlanFileResultSchema }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("mcp.complete"), requestId: Type.String(), stepId: Type.String(), call: toolCall, result: RemoteMcpExecutionResultSchema }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("validation.boundary"), requestId: Type.String(), stepId: Type.String(), validationId: Type.String() }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("validation.complete"), requestId: Type.String(), stepId: Type.String(), validationId: Type.String(), result: CompoundValidationResultSchema }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("delta"), stepId: Type.String(), text: Type.String({ maxLength: MAX_TEXT }) }),
  Type.Object({ kind: Type.Literal("output"), stepId: Type.String(), callId: Type.String(), text: Type.String({ maxLength: 16_384 }) }),
  Type.Object({ kind: Type.Literal("process"), stepId: Type.String(), callId: Type.String(), pid: Type.Integer({ minimum: 1 }) }),
  Type.Object({ kind: Type.Literal("process.ended"), requestId: Type.String(), stepId: Type.String(), callId: Type.String(), pid: Type.Integer({ minimum: 1 }),
    outcome: Type.Union([Type.Literal("completed"), Type.Literal("stopped"), Type.Literal("failed"), Type.Literal("partial")]) }),
  Type.Object({ kind: Type.Literal("ack") }),
  Type.Object({ kind: Type.Literal("finished"), requestId: Type.String(), outcome: Type.Union([Type.Literal("completed"), Type.Literal("stopped"), Type.Literal("failed"), Type.Literal("partial")]), diagnostic: Type.Union([Type.String(), Type.Null()]) }),
]);
export type WorkerRequest = Static<typeof WorkerRequestSchema>;
export const UserPlanOperationSchema = Type.Object({
  kind: Type.Literal("plan.save"), stepId: Type.String({ minLength: 1, maxLength: 128 }), callId: Type.String({ minLength: 1, maxLength: 128 }), input: UserPlanInputSchema,
}, { additionalProperties: false });
export type UserPlanOperation = Static<typeof UserPlanOperationSchema>;
export const UserMcpOperationSchema = Type.Object({
  kind: Type.Literal("mcp.call"), stepId: Type.String({ minLength: 1, maxLength: 128 }), call: toolCall,
}, { additionalProperties: false });
export type UserMcpOperation = Static<typeof UserMcpOperationSchema>;
export interface WorkerStart { kind: "start"; root: string | null; context: Message[]; readOnly: boolean; env?: "Local" | "Remote" | "Sandbox"; publicCompound?: true; operation?: UserPlanOperation | UserMcpOperation; hooks?: HookBinding[] }
export interface BoundaryReply extends PreparedModel { steers: Message[]; systemPrompt: string; tools: Tool[]; toolCatalog?: Tool[]; mode: SessionMode; folders: FolderPolicy; maxTokens: number; thinkingEffort?: ThinkingEffort; phase?: "router" | "solver" | "compaction" | "candidate" | "checkpoint" | "decision" | "steering"; context?: Message[] }
export type DelegatedResult = { text: string; isError: boolean; outcome: string; rawText?: string; rawComplete?: boolean; endTurn?: true };
export type WorkerReply = { kind: "reply"; requestId: string; value?: BoundaryReply | { allow: boolean; mode: SessionMode; folders: FolderPolicy } | { accepted: boolean; continue?: true; validation?: CompoundValidationOperation } | DelegatedResult | RemoteMcpAuthorization; error?: string; halt?: true };
export type ParentMessage = WorkerStart | WorkerReply | { kind: "stop" } | { kind: "control-lost" };
export function parentMessage(value: unknown): ParentMessage {
  if (!isRecord(value)) throw new Error("Invalid parent message.");
  if (value.kind === "stop") return { kind: "stop" };
  if (value.kind === "control-lost") return { kind: "control-lost" };
  if (value.kind === "reply" && typeof value.requestId === "string" &&
    (value.halt === undefined || value.halt === true) &&
    (value.error === undefined || typeof value.error === "string") &&
    (value.value === undefined || isRecord(value.value))) return value as ParentMessage;
  if (value.kind === "start" && (value.root === null || typeof value.root === "string") && Array.isArray(value.context)) {
    if (value.hooks !== undefined && (!Value.Check(Type.Array(HookBindingSchema, { maxItems: 16 }), value.hooks) || value.readOnly !== false ||
      value.root === null || value.operation !== undefined || value.publicCompound !== undefined)) throw new Error("Lifecycle hooks need an explicit writable root and ordinary turn owner. Tool-less roles cannot acquire hook execution.");
    if (value.publicCompound !== undefined && (value.publicCompound !== true || value.root !== null || value.readOnly !== true || value.env !== "Local" || value.operation !== undefined)) throw new Error("Public compound models need an explicit Local, root-less, read-only owner. Private roles cannot adopt validation authority.");
    if (value.env !== undefined && !["Local", "Remote", "Sandbox"].includes(String(value.env))) throw new Error("Invalid explicit worker execution environment. No fallback.");
    if (value.operation !== undefined && (!(Value.Check(UserPlanOperationSchema, value.operation) || Value.Check(UserMcpOperationSchema, value.operation)) || value.root === null || value.context.length || value.readOnly !== false)) throw new Error("Invalid owned user operation. No model or filesystem effect was started.");
    return value as ParentMessage;
  }
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
const textBlock = Type.Object({ type: Type.Literal("text"), text: Type.String() });
const imageBlock = Type.Object({ type: Type.Literal("image"), data: Type.String(), mimeType: Type.String() });
const contextSchema = Type.Array(Type.Union([
  assistantSchema,
  Type.Object({ role: Type.Literal("user"), content: Type.Union([Type.String(), Type.Array(Type.Union([textBlock, imageBlock]))]), timestamp: Type.Number() }),
  Type.Object({ role: Type.Literal("toolResult"), toolCallId: Type.String(), toolName: Type.String(), content: Type.Array(Type.Union([textBlock, imageBlock])), isError: Type.Boolean(), timestamp: Type.Number() }),
]));
export function contextMessages(value: unknown): Message[] {
  if (!Value.Check(contextSchema, value)) throw new Error("Retained context is not a valid normalized conversation. Original data was preserved; no source was silently dropped.");
  return value as Message[];
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
