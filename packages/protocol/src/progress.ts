import { Type, type Static } from "typebox";
import type { ModelAdviceSource } from "./questions.ts";

export const TASK_PROGRESS_INTERVAL_MS = 15_000;
export const LONG_TASK_MS = 60_000;
export const ProgressQuerySchema = Type.Object({
  type: Type.Literal("session.progress"), sessionId: Type.String({ minLength: 1, maxLength: 128 }),
}, { additionalProperties: false });
export type ProgressQuery = Static<typeof ProgressQuerySchema>;
export const TaskProgressToolSchema = Type.Union([
  Type.Object({ action: Type.Literal("read") }, { additionalProperties: false }),
  Type.Object({
    action: Type.Literal("report"), percent: Type.Integer({ minimum: 0, maximum: 100 }),
    summary: Type.String({ minLength: 1, maxLength: 300 }),
    planDigest: Type.Union([Type.String({ pattern: "^[a-f0-9]{64}$" }), Type.Null()]),
  }, { additionalProperties: false }),
]);
export type TaskProgressInput = Static<typeof TaskProgressToolSchema>;
export interface TaskProgressReport {
  percent: number; summary: string; planDigest: string | null; source: ModelAdviceSource;
}
export interface TaskProgress {
  sessionId: string; turnId: string | null; env: "Local" | "Remote" | "Sandbox";
  observedAt: string; longRunning: boolean;
  checklist: { path: string | null; digest: string | null; completed: number; total: number; percent: number | null; diagnostic: string | null };
  model: (TaskProgressReport & { reportedAt: string; stale: boolean }) | null;
  disagreement: boolean;
}
export type ProgressResponse = { type: "session.progress"; progress: TaskProgress };

export function planChecklist(text: string): { completed: number; total: number; percent: number | null } {
  let completed = 0, total = 0, fence: { character: string; length: number } | null = null;
  for (const line of text.split(/\r\n|\r|\n/)) {
    const delimiter = line.match(/^\s*(`{3,}|~{3,})(.*)$/);
    if (delimiter) {
      const marker = delimiter[1]!;
      if (!fence) fence = { character: marker[0]!, length: marker.length };
      else if (marker[0] === fence.character && marker.length >= fence.length && !delimiter[2]!.trim()) fence = null;
      continue;
    }
    if (fence || /^(?: {4}|\t)/.test(line) && !/^\s+[-+*]\s+\[[ xX]\]/.test(line)) continue;
    const item = line.match(/^\s*(?:[-+*]|\d+[.)])\s+\[([ xX])\](?:\s|$)/);
    if (item) { total++; if (item[1]!.toLowerCase() === "x") completed++; }
  }
  return { completed, total, percent: total ? Math.round(completed * 100 / total) : null };
}

export function progressBar(percent: number | null, width = 16): string {
  if (percent === null) return `[${"?".repeat(width)}] unknown`;
  const filled = Math.round(Math.max(0, Math.min(100, percent)) * width / 100);
  return `[${"#".repeat(filled)}${"-".repeat(width - filled)}] ${percent}%`;
}
