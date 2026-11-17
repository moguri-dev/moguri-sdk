import type { SessionIndicatorKind } from "./session-status.ts";

/** Shared state vocabulary for desktop and TUI. Tones select a color role; labels always carry the meaning. */
export type StatusTone = "running" | "attention" | "completed" | "failed" | "partial" | "stopped" | "queued" | "neutral" | "unknown";
export interface StatusLabel { label: string; tone: StatusTone }

const SESSION_STATUS: Record<string, StatusLabel> = {
  idle: { label: "Idle", tone: "neutral" },
  queued: { label: "Queued", tone: "queued" },
  running: { label: "Running", tone: "running" },
  stopping: { label: "Stopping", tone: "running" },
  waiting_input: { label: "Needs attention", tone: "attention" },
  completed: { label: "Completed", tone: "completed" },
  stopped: { label: "Stopped", tone: "stopped" },
  failed: { label: "Failed", tone: "failed" },
  partial: { label: "Partial result", tone: "partial" },
  archived: { label: "Archived", tone: "neutral" },
};
const OUTCOME: Record<string, StatusLabel> = {
  completed: { label: "Completed", tone: "completed" },
  failed: { label: "Failed", tone: "failed" },
  error: { label: "Failed", tone: "failed" },
  partial: { label: "Partial result", tone: "partial" },
  stopped: { label: "Stopped", tone: "stopped" },
  cancelled: { label: "Cancelled", tone: "stopped" },
  denied: { label: "Denied", tone: "stopped" },
  running: { label: "Running", tone: "running" },
  background: { label: "Running in background", tone: "running" },
  waiting_input: { label: "Needs attention", tone: "attention" },
  pending: { label: "Pending", tone: "attention" },
  blocked: { label: "Blocked", tone: "attention" },
  unconfirmed: { label: "Unconfirmed", tone: "unknown" },
  deleted: { label: "Deleted", tone: "neutral" },
};
const INDICATOR_TONE: Record<SessionIndicatorKind, StatusTone> = {
  running: "running", question: "attention", approval: "attention", completed: "completed", merged: "completed",
  failed: "failed", partial: "partial", stopped: "stopped", queued: "queued", idle: "neutral", archived: "neutral",
};

const humanize = (value: string) => {
  const words = value.replace(/[_-]+/g, " ").trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : "Unknown";
};

/** Short label for a raw session status. An unrecognized status stays visible as unknown, never as success. */
export function sessionStatusLabel(status: string): StatusLabel {
  return SESSION_STATUS[status] ?? { label: `Unknown (${humanize(status)})`, tone: "unknown" };
}

/** Short label for a message, tool or job outcome. Missing outcomes are unknown, not completed. */
export function outcomeLabel(outcome: string | null | undefined): StatusLabel {
  if (!outcome) return { label: "Unknown", tone: "unknown" };
  return OUTCOME[outcome] ?? { label: humanize(outcome), tone: "unknown" };
}

export function indicatorTone(kind: SessionIndicatorKind): StatusTone {
  return INDICATOR_TONE[kind];
}

/** The composer mode names used by both clients. */
export function sessionModeLabel(mode: string): string {
  return mode === "agent" ? "Agent" : mode === "read-only" ? "Read-only" : humanize(mode);
}
