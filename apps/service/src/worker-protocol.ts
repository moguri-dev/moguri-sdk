import { Type, type Static, type Message, type AssistantMessage, type Tool } from "@earendil-works/pi-ai";
import { Value } from "typebox/value";
import { CompoundValidationResultSchema, HookBindingSchema, isRecord, MAX_TEXT, ModelStreamObservationSchema, PlanFileResultSchema, ToolCallSchema, type HookBinding, type ToolCall, type SessionMode, type SessionHomeRoot, type ThinkingEffort } from "../../../packages/protocol/src/index.ts";
import type { FolderPolicy } from "./project-policy.ts";
import type { PreparedModel } from "./provider.ts";
import { UserPlanInputSchema } from "./user-plan.ts";
import { RemoteMcpExecutionResultSchema, type RemoteMcpAuthorization } from "./remote-mcp-runtime.ts";
import type { CompoundValidationOperation } from "./compound-validation.ts";
import type { WebAccess } from "../../../packages/protocol/src/web-policy.ts";
import type { DirectMcpTool } from "./direct-mcp-tools.ts";
import type { ScriptExecution } from "../../../packages/protocol/src/script-reviews.ts";
import { WinddownCommitDocumentSchema, WinddownCommitResultSchema } from "../../../packages/protocol/src/winddown.ts";
import { ToolDeliveriesSchema, type ToolDelivery } from "../../../packages/protocol/src/chat-outputs.ts";

const toolCall = ToolCallSchema;
export const OwnedModelRequestSchema = Type.Union([
  Type.Object({ kind: Type.Literal("owned-model.boundary"), ownerId: Type.String(), requestId: Type.String(), stepId: Type.String() }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("owned-model.complete"), ownerId: Type.String(), requestId: Type.String(), stepId: Type.String(),
    message: Type.Unknown(), usageReported: Type.Boolean(), generationMs: Type.Number({ minimum: 0 }), stream: ModelStreamObservationSchema }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("owned-model.finished"), ownerId: Type.String(), requestId: Type.String(),
    outcome: Type.Union([Type.Literal("completed"), Type.Literal("stopped"), Type.Literal("failed"), Type.Literal("partial")]),
    diagnostic: Type.Union([Type.String(), Type.Null()]) }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("owned-model.ack"), ownerId: Type.String() }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("owned-model.released"), ownerId: Type.String(),
    outcome: Type.Union([Type.Literal("completed"), Type.Literal("stopped"), Type.Literal("failed"), Type.Literal("partial")]) }, { additionalProperties: false }),
]);
export type OwnedModelRequest = Static<typeof OwnedModelRequestSchema>;
export const isOwnedModelRequest = (value: unknown): value is OwnedModelRequest => Value.Check(OwnedModelRequestSchema, value);
export const WorkerRequestSchema = Type.Union([
  ...OwnedModelRequestSchema.anyOf,
  Type.Object({ kind: Type.Literal("checkpoint.phase"), phase: Type.Union([Type.Literal("intent"), Type.Literal("prepared"), Type.Literal("published"), Type.Literal("result"), Type.Literal("settled")]),
    document: Type.Optional(WinddownCommitDocumentSchema), commit: Type.Optional(Type.String({ pattern: "^(?:[a-f0-9]{40}|[a-f0-9]{64})$" })),
    result: Type.Optional(WinddownCommitResultSchema) }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("boundary"), requestId: Type.String(), stepId: Type.String(), loadedTools: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 128 }), { maxItems: 64, uniqueItems: true })) }),
  Type.Object({ kind: Type.Literal("title.boundary"), requestId: Type.String(), stepId: Type.String() }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("model.dispatch"), requestId: Type.String(), stepId: Type.String(), context: Type.Unknown(),
    loadedTools: Type.Array(Type.String(), { maxItems: 64, uniqueItems: true }), instructionSources: Type.Array(Type.String(), { maxItems: 4096, uniqueItems: true }) }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("model.complete"), requestId: Type.String(), stepId: Type.String(), message: Type.Unknown(), usageReported: Type.Boolean(), generationMs: Type.Number({ minimum: 0 }), stream: Type.Optional(ModelStreamObservationSchema) }),
  Type.Object({ kind: Type.Literal("approval"), requestId: Type.String(), stepId: Type.String(), call: toolCall }),
  Type.Object({ kind: Type.Literal("hook"), requestId: Type.String(), stepId: Type.String(), call: toolCall }),
  Type.Object({ kind: Type.Literal("delegate"), requestId: Type.String(), stepId: Type.String(), call: toolCall, quiescent: Type.Optional(Type.Boolean()) }),
  Type.Object({ kind: Type.Literal("tool.complete"), requestId: Type.String(), stepId: Type.String(), call: toolCall, text: Type.String({ maxLength: MAX_TEXT + 4096 }), isError: Type.Boolean(), outcome: Type.String(),
    rawText: Type.Optional(Type.String({ maxLength: 2 * 1024 * 1024 })), rawComplete: Type.Optional(Type.Boolean()), deliveries: Type.Optional(ToolDeliveriesSchema) }),
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
export interface WorkerStart { kind: "start"; root: string | null; context: Message[]; readOnly: boolean; env?: "Local" | "Remote" | "Sandbox"; publicCompound?: true; automaticKupo?: true; operation?: UserPlanOperation | UserMcpOperation; hooks?: HookBinding[];
  retainModelRequests?: true; automaticCompaction?: true; ownedModelCalls?: true; retry?: { loadedTools: string[]; instructionSources: string[]; remainingSteps: number; kupoDraft?: { stepId: string; message: AssistantMessage } } }
export interface BoundaryReply extends PreparedModel { steers: Message[]; systemPrompt: string; tools: Tool[]; toolCatalog?: Tool[]; directMcpTools?: DirectMcpTool[]; mode: SessionMode; folders: FolderPolicy; maxTokens: number; thinkingEffort?: ThinkingEffort; phase?: "router" | "solver" | "compaction" | "candidate" | "checkpoint" | "decision" | "steering" | "title" | `kupo-${import("../../../packages/protocol/src/index.ts").KupoResponsePhase}`; context?: Message[] }
export type DelegatedResult = { text: string; isError: boolean; outcome: string; rawText?: string; rawComplete?: boolean; endTurn?: true; deliveries?: ToolDelivery[] };
export type WorkerReply = { kind: "reply"; requestId: string; value?: BoundaryReply | { allow: boolean; mode: SessionMode; folders: FolderPolicy; root?: string | null; homeRoot?: SessionHomeRoot; webAccess?: WebAccess; scriptExecution?: ScriptExecution } | { accepted: boolean; titleStatus?: import("../../../packages/protocol/src/chat-titles.ts").ChatTitleRecord["status"]; source?: import("../../../packages/protocol/src/tooling.ts").RetainedToolSource; continue?: true; contextReplacement?: Message[]; validation?: CompoundValidationOperation; selectedResponse?: { stepId: string; message: AssistantMessage } } | DelegatedResult | RemoteMcpAuthorization; error?: string; halt?: true };
export type ParentMessage = WorkerStart | WorkerReply | { kind: "stop" } | { kind: "control-lost" } |
  { kind: "owned-model.start"; ownerId: string; parentRequestId: string } | { kind: "owned-model.stop"; ownerId: string };
export function parentMessage(value: unknown): ParentMessage {
  if (!isRecord(value)) throw new Error("Invalid parent message.");
  if (value.kind === "stop") return { kind: "stop" };
  if (value.kind === "control-lost") return { kind: "control-lost" };
  if ((value.kind === "owned-model.start" || value.kind === "owned-model.stop") && typeof value.ownerId === "string" && value.ownerId.length > 0 &&
    value.ownerId.length <= 128 && (value.kind === "owned-model.stop" || typeof value.parentRequestId === "string" && value.parentRequestId.length > 0)) {
    return value.kind === "owned-model.stop" ? { kind: value.kind, ownerId: value.ownerId } :
      { kind: value.kind, ownerId: value.ownerId, parentRequestId: String(value.parentRequestId) };
  }
  if (value.kind === "reply" && typeof value.requestId === "string" &&
    (value.halt === undefined || value.halt === true) &&
    (value.error === undefined || typeof value.error === "string") &&
    (value.value === undefined || isRecord(value.value))) return value as ParentMessage;
  if (value.kind === "start" && (value.root === null || typeof value.root === "string") && Array.isArray(value.context)) {
    if (value.ownedModelCalls !== undefined && (value.ownedModelCalls !== true || value.operation !== undefined ||
      value.publicCompound !== undefined || value.readOnly !== false || value.env !== "Remote" && value.env !== "Sandbox")) {
      throw new Error("Tool-less subcalls need an explicit existing Remote/native parent owner. No Local process, private compound or user operation was adopted.");
    }
    if (value.automaticCompaction !== undefined && (value.automaticCompaction !== true || value.automaticKupo !== true ||
      value.operation !== undefined || value.publicCompound !== undefined)) throw new Error("Automatic compaction needs an ordinary Kupo owner with actual-user policy. No private role can apply context.");
    if (value.retainModelRequests !== undefined && value.retainModelRequests !== true ||
      value.retry !== undefined && (!isRecord(value.retry) || !Array.isArray(value.retry.loadedTools) || !value.retry.loadedTools.every((tool) => typeof tool === "string") ||
        !Array.isArray(value.retry.instructionSources) || !value.retry.instructionSources.every((source) => typeof source === "string") ||
        !Number.isSafeInteger(value.retry.remainingSteps) || Number(value.retry.remainingSteps) < 1 || Number(value.retry.remainingSteps) > 32 ||
        value.retry.kupoDraft !== undefined && (!isRecord(value.retry.kupoDraft) || typeof value.retry.kupoDraft.stepId !== "string" || !isAssistantMessage(value.retry.kupoDraft.message)) ||
        value.operation !== undefined || value.publicCompound !== undefined)) throw new Error("Model retry needs its exact bounded ordinary worker owner. No lifecycle effect was replayed.");
    if (value.hooks !== undefined && (!Value.Check(Type.Array(HookBindingSchema, { maxItems: 16 }), value.hooks) || value.readOnly !== false ||
      value.root === null || value.operation !== undefined || value.publicCompound !== undefined)) throw new Error("Lifecycle hooks need an explicit writable root and ordinary turn owner. Tool-less roles cannot acquire hook execution.");
    if (value.publicCompound !== undefined && (value.publicCompound !== true || value.root !== null || value.readOnly !== true || value.env !== "Local" || value.operation !== undefined)) throw new Error("Public compound models need an explicit Local, root-less, read-only owner. Private roles cannot adopt validation authority.");
    if (value.automaticKupo !== undefined && (value.automaticKupo !== true || value.publicCompound !== undefined ||
      value.operation !== undefined || value.env !== "Local" && value.env !== "Remote" && value.env !== "Sandbox")) throw new Error("Automatic Kupo needs an explicit ordinary qualified execution owner, not private candidate, compound-validation or user-operation authority.");
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
export const isAssistantMessage = (value: unknown): value is AssistantMessage => Value.Check(assistantSchema, value);
export function assistantMessage(value: unknown): AssistantMessage {
  if (!isAssistantMessage(value)) throw new Error("Worker returned an invalid normalized model message.");
  return value;
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
