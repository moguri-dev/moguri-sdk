import type { Message, Tool } from "@earendil-works/pi-ai";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import { ControlsSchema, HookBindingSchema, isRecord, MoguriError, type KupoResponsePhase, type ThinkingEffort } from "../../../packages/protocol/src/index.ts";
import { contextMessages, type BoundaryReply } from "./worker-protocol.ts";
import type { DirectMcpTool } from "./direct-mcp-tools.ts";

const tool = Type.Unsafe<Tool>(Type.Object({
  name: Type.String(), description: Type.String(), parameters: Type.Record(Type.String(), Type.Unknown()),
}));
const baseSchema = Type.Object({
  version: Type.Literal(1), profileId: Type.String(), sessionId: Type.String(), turnId: Type.String(), sourceStepId: Type.String(),
  modelId: Type.String(), modelBindingDigest: Type.String(), boundaryDigest: Type.String(), controls: ControlsSchema,
  authorizationRevision: Type.Integer({ minimum: 0 }),
  endpoint: Type.String({ minLength: 1, maxLength: 4096 }), api: Type.String({ minLength: 1, maxLength: 128 }),
  systemPrompt: Type.String(), tools: Type.Array(tool), toolCatalog: Type.Array(tool),
  maxTokens: Type.Integer({ minimum: 1 }), contextWindow: Type.Integer({ minimum: 1 }),
  loadedTools: Type.Array(Type.String(), { maxItems: 64, uniqueItems: true }),
  instructionSources: Type.Array(Type.String(), { maxItems: 4096, uniqueItems: true }),
  mode: Type.Union([Type.Literal("agent"), Type.Literal("read-only")]),
  folders: Type.Object({ denied: Type.Array(Type.String()), readOnly: Type.Array(Type.String()) }),
  hooks: Type.Optional(Type.Object({ bindings: Type.Array(HookBindingSchema, { maxItems: 16 }), done: Type.Array(Type.String(), { maxItems: 16, uniqueItems: true }) })),
}, { additionalProperties: true });
export interface RetainedModelRequest extends Static<typeof baseSchema> {
  context: Message[];
  phase?: BoundaryReply["phase"];
  thinkingEffort?: ThinkingEffort;
  directMcpTools?: DirectMcpTool[];
  kupo?: { phase: KupoResponsePhase; contextDigest: string; draft?: { stepId: string; contextDigest: string }; review?: { stepId: string; contextDigest: string }; escalations?: number; revisions?: number };
}
export function retainedModelRequest(value: unknown): RetainedModelRequest {
  if (!isRecord(value)) throw new MoguriError("model_recovery_input", "The original model envelope is not a retained object.", 409);
  const raw = value;
  if (!Value.Check(baseSchema, value) || !Array.isArray(raw.context) ||
    raw.phase !== undefined && !["solver", "router", "kupo-draft", "kupo-gate", "kupo-critic", "kupo-revision", "kupo-escalation"].includes(String(raw.phase)) ||
    raw.thinkingEffort !== undefined && !["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(String(raw.thinkingEffort)) ||
    raw.directMcpTools !== undefined && !Array.isArray(raw.directMcpTools) ||
    raw.kupo !== undefined && (!isRecord(raw.kupo) || typeof raw.kupo.contextDigest !== "string" ||
      !["draft", "gate", "critic", "revision", "escalation"].includes(String(raw.kupo.phase)) ||
      ["escalations", "revisions"].some((key) => raw.kupo && isRecord(raw.kupo) && raw.kupo[key] !== undefined &&
        (!Number.isSafeInteger(raw.kupo[key]) || Number(raw.kupo[key]) < 0 || Number(raw.kupo[key]) > 3)))) {
    throw new MoguriError("model_recovery_input", "The retained original model envelope is missing or invalid. No history, model or effect was reconstructed.", 409);
  }
  contextMessages(raw.context);
  return value as RetainedModelRequest;
}
export function transientModelFailure(diagnostic: string): boolean {
  if (/(?:^|[\s:])(?:400|401|403|404|413|422)(?:\s|:|$)|authentication|unauthorized|forbidden|invalid[_ -]?api[_ -]?key|context (?:window|limit)|token limit/i.test(diagnostic)) return false;
  return /(?:^|[\s:])(?:408|425|429|500|502|503|504)(?:\s|:|$)|timed? ?out|timeout|ECONNRESET|ETIMEDOUT|ECONNREFUSED|fetch failed|service unavailable|overloaded|rate.?limit/i.test(diagnostic);
}
