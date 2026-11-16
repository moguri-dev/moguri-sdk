import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import { ClaudeAgentTransportSchema } from "../../../packages/protocol/src/index.ts";

const id = Type.String({ minLength: 1, maxLength: 256 });
const text = Type.String({ maxLength: 512 * 1024 });
const call = Type.Object({ id, name: Type.String({ minLength: 1, maxLength: 256 }), arguments: Type.Record(Type.String(), Type.Unknown()) }, { additionalProperties: false });
const tokens = Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]);
const outcome = Type.Union([Type.Literal("completed"), Type.Literal("stopped"), Type.Literal("failed"), Type.Literal("partial")]);
export const ClaudeWorkerStartSchema = Type.Object({
  kind: Type.Literal("claude.start"),
  transport: ClaudeAgentTransportSchema,
  executable: Type.String({ minLength: 1, maxLength: 4096, pattern: "^/" }),
  environment: Type.Record(Type.String(), Type.String()),
  root: Type.String({ minLength: 1, maxLength: 4096, pattern: "^/" }),
  prompt: Type.String({ minLength: 1, maxLength: 1024 * 1024 }),
  model: Type.String({ minLength: 1, maxLength: 64 }),
  nativeSessionId: Type.String({ pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$" }),
  resume: Type.Boolean(),
  readOnly: Type.Boolean(),
  appendSystemPrompt: Type.String({ maxLength: 16 * 1024 }),
}, { additionalProperties: false });
export type ClaudeWorkerStart = Static<typeof ClaudeWorkerStartSchema>;
export const ClaudeApprovalReplySchema = Type.Union([
  Type.Object({ allow: Type.Literal(true) }, { additionalProperties: false }),
  Type.Object({ allow: Type.Literal(false), message: Type.String({ minLength: 1, maxLength: 4096 }) }, { additionalProperties: false }),
]);
export type ClaudeApprovalReply = Static<typeof ClaudeApprovalReplySchema>;
export const ClaudeParentMessageSchema = Type.Union([
  ClaudeWorkerStartSchema,
  Type.Object({ kind: Type.Literal("reply"), requestId: id, value: Type.Optional(Type.Unknown()), error: Type.Optional(Type.String({ maxLength: 4096 })) }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("stop") }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("control-lost") }, { additionalProperties: false }),
]);
export type ClaudeParentMessage = Static<typeof ClaudeParentMessageSchema>;
export const ClaudeWorkerMessageSchema = Type.Union([
  Type.Object({ kind: Type.Literal("claude.process"), pid: Type.Integer({ minimum: 1 }) }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("claude.initialized"), nativeSessionId: id, model: Type.Union([Type.String({ maxLength: 256 }), Type.Null()]) }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("claude.step"), stepId: id }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("claude.delta"), stepId: id, text: Type.String({ minLength: 1, maxLength: 64 * 1024 }) }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("claude.message"), stepId: id, text, reasoning: text, toolCalls: Type.Array(call, { maxItems: 128 }), model: Type.Union([Type.String({ maxLength: 256 }), Type.Null()]) }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("claude.approval"), requestId: id, stepId: Type.Union([id, Type.Null()]), call }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("claude.tool_result"), callId: id, text, isError: Type.Boolean() }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("claude.result"), nativeSessionId: id, outcome, diagnostic: Type.Union([Type.String({ maxLength: 4096 }), Type.Null()]),
    inputTokens: tokens, outputTokens: tokens, cacheReadTokens: tokens, cacheWriteTokens: tokens,
    harnessEstimatedUsd: Type.Union([Type.Number({ minimum: 0 }), Type.Null()]), numTurns: tokens, durationMs: tokens }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("ack") }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("finished"), requestId: id, outcome, diagnostic: Type.Union([Type.String({ maxLength: 4096 }), Type.Null()]) }, { additionalProperties: false }),
]);
export type ClaudeWorkerMessage = Static<typeof ClaudeWorkerMessageSchema>;
export const claudeWorkerMessage = (value: unknown): ClaudeWorkerMessage | null => Value.Check(ClaudeWorkerMessageSchema, value) ? value : null;
export const claudeParentMessage = (value: unknown): ClaudeParentMessage | null => Value.Check(ClaudeParentMessageSchema, value) ? value : null;
