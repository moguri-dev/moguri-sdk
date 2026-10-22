import { Type, type Static } from "typebox";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmTaskListItem } from "micromark-extension-gfm-task-list-item";
import { gfmTaskListItemFromMarkdown } from "mdast-util-gfm-task-list-item";
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
  let completed = 0, total = 0;
  interface Node { type: string; checked?: boolean | null; children?: Node[] }
  const pending: Node[] = [fromMarkdown(text, { extensions: [gfmTaskListItem()], mdastExtensions: [gfmTaskListItemFromMarkdown()] })];
  while (pending.length) {
    const node = pending.pop()!;
    if (node.type === "listItem" && typeof node.checked === "boolean") { total++; if (node.checked) completed++; }
    if (node.children) pending.push(...node.children);
  }
  return { completed, total, percent: total ? Math.round(completed * 100 / total) : null };
}

export function progressBar(percent: number | null, width = 16): string {
  if (percent === null) return `[${"?".repeat(width)}] unknown`;
  const filled = Math.round(Math.max(0, Math.min(100, percent)) * width / 100);
  return `[${"#".repeat(filled)}${"-".repeat(width - filled)}] ${percent}%`;
}
