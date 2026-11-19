import { randomUUID } from "node:crypto";
import type { Attention, EventInput, Snapshot, SuggestionPreview, ToolSuggestion } from "../../../packages/protocol/src/index.ts";

export const TOOL_SUGGESTION_POLL_MS = 15 * 60_000;
export interface ToolSuggestionHost {
  snapshot(): Snapshot;
  /** The profile-wide local suggestion preview. It makes no model call. */
  preview(): SuggestionPreview;
  commit(events: EventInput[]): void;
}
/**
 * Protocol 113 recurring automation. While Settings `automations.toolSuggestions` is on, it re-runs the deterministic repeated-task
 * check every `intervalHours` (polling every `pollMs`) and raises one sessionless Inbox entry per newly suggested tool name.
 * A name is never raised twice, even after the entry is read, cleared or deleted. It never creates, enables or runs a script.
 */
export class ToolSuggestionAutomation {
  private timer?: ReturnType<typeof setInterval>;
  private closed = false;
  private lastRun: number | null = null;
  constructor(private readonly host: ToolSuggestionHost, private readonly pollMs: number = TOOL_SUGGESTION_POLL_MS, private readonly now: () => number = Date.now) {}
  start(): void {
    if (this.timer || this.closed) return;
    this.timer = setInterval(() => this.tick(), Math.min(this.pollMs, TOOL_SUGGESTION_POLL_MS)); this.timer.unref();
  }
  close(): void { this.closed = true; clearInterval(this.timer); }
  private tick(): void {
    try { if (this.due()) this.check(); }
    catch (error) { console.error("Repeated-task tool check failed; it will run again at the next interval:", error instanceof Error ? error.message : error); }
  }
  due(): boolean {
    const settings = this.host.snapshot().settings.values.automations?.toolSuggestions;
    if (!settings?.enabled) { this.lastRun = null; return false; }
    return this.lastRun === null || this.now() - this.lastRun >= settings.intervalHours * 3_600_000;
  }
  /** Runs one check now. Returns the current suggestions and the names raised to the Inbox by this run. */
  check(): { suggestions: ToolSuggestion[]; raised: string[] } {
    this.lastRun = this.now();
    const suggestions = this.host.preview().tools.filter((suggestion) => !suggestion.installed), snapshot = this.host.snapshot();
    const known = new Set(snapshot.attention.filter((entry) => entry.reason === "tool-suggestion").map((entry) => entry.messageId));
    const fresh = suggestions.filter((suggestion) => !known.has(suggestion.name)), createdAt = new Date(this.now()).toISOString();
    if (fresh.length) this.host.commit(fresh.map((suggestion) => {
      const attention: Attention = { id: randomUUID(), sessionId: null, projectId: null, kind: "bell", reason: "tool-suggestion", source: "heuristic",
        messageId: suggestion.name, acknowledged: false, active: true, createdAt };
      return { event_type: "attention.raised", profile_id: snapshot.profileId, payload: { attention } };
    }));
    return { suggestions, raised: fresh.map((suggestion) => suggestion.name) };
  }
}
