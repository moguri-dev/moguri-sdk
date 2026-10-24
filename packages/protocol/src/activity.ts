import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import type { BudgetTotals, ModelRole } from "./budgets.ts";
import type { PublicMessage } from "./index.ts";

const id = Type.String({ minLength: 1, maxLength: 128 });
const integer = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const cursor = Type.Object({ sequence: integer, id }, { additionalProperties: false });
export type ActivityCursor = Static<typeof cursor>;
export const ActivityQuerySchema = Type.Union([
  Type.Object({ type: Type.Literal("activity.list"), sessionId: id, before: Type.Optional(cursor), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })) }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("activity.read"), sessionId: id, activityId: id, part: Type.Union([Type.Literal("arguments"), Type.Literal("output")]),
    offset: Type.Optional(integer), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 16384 })) }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("activity.turn"), sessionId: id, turnId: id }, { additionalProperties: false }),
]);
export type ActivityQuery = Static<typeof ActivityQuerySchema>;
export const isActivityQuery = (value: unknown): value is ActivityQuery => Value.Check(ActivityQuerySchema, value);
export type ActivityKind = "read-file" | "create-file" | "edit-file" | "search-files" | "search-skills" | "search-web" | "load-skill" |
  "create-issue" | "command" | "mcp" | "ask-user" | "thought" | "model" | "tool";
export type ActivityStatus = "pending" | "running" | "waiting_input" | "completed" | "failed" | "denied" | "stopped" | "cancelled" | "partial" | "unconfirmed" | "unknown";
export interface ActivityEntry {
  id: string; sessionId: string; turnId: string | null; stepId: string | null; messageId: string | null; sequence: number; updatedSequence: number;
  source: "tool" | "model" | "skill" | "github" | "linear"; actor: "model" | "external" | "user" | "unknown";
  kind: ActivityKind; label: string; subject: string | null; status: ActivityStatus;
  startedAt: string | null; finishedAt: string | null; durationMs: number | null; durationBasis: "observed-lifecycle" | "model-request" | "source-load";
  outputBytes: number | null; outputBasis: "retained-utf8" | "retained-tail" | "loaded-source"; hasArguments: boolean; hasOutput: boolean;
}
export interface SessionActivity {
  sessionId: string; sequence: number; entries: ActivityEntry[]; nextBefore: ActivityCursor | null;
  current: ActivityEntry[]; currentCount: number;
  messageOrder: Array<{ id: string; sequence: number }>;
}
export interface ActivityContent { text: string; bytes: number; offset: number; nextOffset: number | null }
export interface TurnInfo {
  sessionId: string; turnId: string; startedAt: string | null; finishedAt: string | null; durationMs: number | null; outcome: string;
  models: Array<{ modelId: string; providerId: string | null; role: ModelRole }>; usage: BudgetTotals;
  context: { estimatedTokens: number | null; window: number | null } | null;
  responseBytes: number;
}
export const responseText = (messages: readonly PublicMessage[], turnId: string): string =>
  messages.filter((message) => message.turnId === turnId && message.role === "assistant" && message.text.length > 0).map((message) => message.text).join("\n\n");
export type ActivityResponse =
  | { type: "activity.list"; activity: SessionActivity }
  | { type: "activity.read"; entry: ActivityEntry; part: "arguments" | "output"; content: ActivityContent | null }
  | { type: "activity.turn"; info: TurnInfo };
