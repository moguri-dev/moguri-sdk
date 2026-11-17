import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";

/** Timeline lanes, shaped like OpenTelemetry span kinds for agent turns. */
export const ANALYTICS_LANES = ["prompt", "answer", "thinking", "command", "file", "web", "tool", "context"] as const;
export type AnalyticsLane = typeof ANALYTICS_LANES[number];
/**
 * Live analytics never persists or exports anything. The service keeps one rolling window in memory,
 * prunes it on a short timer and forgets everything on restart, session deletion or archive.
 */
export const LIVE_ANALYTICS_LIMITS = {
  windowMs: 60 * 60_000, pruneEveryMs: 30_000, sessions: 40, eventsPerSession: 2_000, previewChars: 240,
} as const;

const object = <T extends Record<string, TSchema>>(properties: T) => Type.Object(properties, { additionalProperties: false });
export const AnalyticsQuerySchema = Type.Union([
  object({ type: Type.Literal("analytics.overview") }),
  object({ type: Type.Literal("analytics.session"), sessionId: Type.String({ minLength: 1, maxLength: 128 }) }),
]);
export type AnalyticsQuery = Static<typeof AnalyticsQuerySchema>;
export const isAnalyticsQuery = (value: unknown): value is AnalyticsQuery => Value.Check(AnalyticsQuerySchema, value);

export type AnalyticsStatus = "running" | "ok" | "failed" | "stopped";
export interface AnalyticsEvent {
  id: string; lane: AnalyticsLane; turnId: string | null;
  /** Epoch milliseconds. `end` is null while the span is still running. */
  start: number; end: number | null;
  label: string; detail: string; status: AnalyticsStatus;
  tool?: string; mcp?: true; edit?: true;
  modelId?: string; inputTokens?: number | null; outputTokens?: number | null;
}
export interface AnalyticsTotals {
  prompts: number; answers: number; commands: number; mcpCalls: number; edits: number; failed: number;
  /** Sums of reported tokens only. Calls without a report are counted separately; they are not zero usage. */
  inputTokens: number; outputTokens: number; unreportedCalls: number; models: string[];
}
export interface AnalyticsSessionSummary {
  sessionId: string; title: string; projectId: string | null; projectName: string | null;
  state: "working" | "waiting" | "idle"; startedAt: number; lastEventAt: number; firstPrompt: string; totals: AnalyticsTotals;
}
export interface AnalyticsOverview {
  generatedAt: number; windowMs: number; pruneEveryMs: number;
  live: number; working: number; projects: number;
  /** Moguri service process only. Null until two samples exist. */
  serviceCpuPercent: number | null; serviceMemoryBytes: number; mcpServers: number;
  sessions: AnalyticsSessionSummary[];
}
export interface AnalyticsSessionDetail { summary: AnalyticsSessionSummary; events: AnalyticsEvent[]; truncated: boolean }
export type AnalyticsResponse =
  | { type: "analytics.overview"; analytics: AnalyticsOverview }
  | { type: "analytics.session"; session: AnalyticsSessionDetail | null };
