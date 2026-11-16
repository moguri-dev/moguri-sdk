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
export const CodexWorkerStartSchema = Type.Object({
  kind: Type.Literal("codex.start"),
  executable: Type.String({ minLength: 1, maxLength: 4096, pattern: "^/" }),
  environment: Type.Record(Type.String(), Type.String()),
  root: Type.String({ minLength: 1, maxLength: 4096, pattern: "^/" }),
  prompt: Type.String({ minLength: 1, maxLength: 1024 * 1024 }),
  model: Type.String({ minLength: 1, maxLength: 256 }),
  /** A Codex thread to resume; null starts a new thread whose ID Codex assigns. */
  threadId: Type.Union([Type.String({ minLength: 1, maxLength: 128 }), Type.Null()]),
  readOnly: Type.Boolean(),
  developerInstructions: Type.String({ maxLength: 16 * 1024 }),
  clientVersion: Type.String({ minLength: 1, maxLength: 64 }),
}, { additionalProperties: false });
export type CodexWorkerStart = Static<typeof CodexWorkerStartSchema>;
export const AgentApprovalReplySchema = Type.Union([
  Type.Object({ allow: Type.Literal(true) }, { additionalProperties: false }),
  Type.Object({ allow: Type.Literal(false), message: Type.String({ minLength: 1, maxLength: 4096 }) }, { additionalProperties: false }),
]);
export type AgentApprovalReply = Static<typeof AgentApprovalReplySchema>;
export const AgentParentMessageSchema = Type.Union([
  ClaudeWorkerStartSchema,
  CodexWorkerStartSchema,
  Type.Object({ kind: Type.Literal("reply"), requestId: id, value: Type.Optional(Type.Unknown()), error: Type.Optional(Type.String({ maxLength: 4096 })) }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("stop") }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("control-lost") }, { additionalProperties: false }),
]);
export type AgentParentMessage = Static<typeof AgentParentMessageSchema>;
export const AgentWorkerMessageSchema = Type.Union([
  Type.Object({ kind: Type.Literal("agent.process"), pid: Type.Integer({ minimum: 1 }) }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("agent.initialized"), nativeSessionId: Type.String({ pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$" }),
    model: Type.Union([Type.String({ maxLength: 256 }), Type.Null()]) }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("agent.step"), stepId: id }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("agent.delta"), stepId: id, text: Type.String({ minLength: 1, maxLength: 64 * 1024 }) }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("agent.response"), stepId: id, text, reasoning: text, toolCalls: Type.Array(call, { maxItems: 128 }), model: Type.Union([Type.String({ maxLength: 256 }), Type.Null()]) }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("agent.approval"), requestId: id, stepId: Type.Union([id, Type.Null()]), call }, { additionalProperties: false }),
  /** `autonomous` marks a tool the harness ran under its own policy without asking Moguri (Codex trusted read-only commands). */
  Type.Object({ kind: Type.Literal("agent.tool_result"), callId: id, text, isError: Type.Boolean(), autonomous: Type.Optional(Type.Literal(true)) }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("agent.result"), nativeSessionId: id, outcome, diagnostic: Type.Union([Type.String({ maxLength: 4096 }), Type.Null()]),
    inputTokens: tokens, outputTokens: tokens, cacheReadTokens: tokens, cacheWriteTokens: tokens,
    harnessEstimatedUsd: Type.Union([Type.Number({ minimum: 0 }), Type.Null()]), numTurns: tokens, durationMs: tokens }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("ack") }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("finished"), requestId: id, outcome, diagnostic: Type.Union([Type.String({ maxLength: 4096 }), Type.Null()]) }, { additionalProperties: false }),
]);
export type AgentWorkerMessage = Static<typeof AgentWorkerMessageSchema>;
export const agentWorkerMessage = (value: unknown): AgentWorkerMessage | null => Value.Check(AgentWorkerMessageSchema, value) ? value : null;
export const agentParentMessage = (value: unknown): AgentParentMessage | null => Value.Check(AgentParentMessageSchema, value) ? value : null;
