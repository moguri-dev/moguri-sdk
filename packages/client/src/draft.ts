import type { Attachment, CommandResult, Session } from "../../protocol/src/index.ts";
import { ClientError, type MoguriClient } from "./index.ts";
import { isContinueWork, type ContinueWorkChoice, type ContinueWorkReview } from "../../protocol/src/kanban.ts";
import { MAX_TEXT } from "../../protocol/src/core.ts";

export interface DraftState {
  text: string;
  attachments: Attachment[];
  dirty: boolean;
  saving: boolean;
  conflict: boolean;
  error: string | null;
}
export interface DraftDictation { update(text: string): void; close(): void }
export class DraftEditor {
  private state: DraftState;
  private revision: number;
  private listeners = new Set<() => void>();
  private timer?: ReturnType<typeof setTimeout>;
  private task?: Promise<void>;
  private captureTask?: Promise<void>;
  private latest: Session["draft"];
  private externalRevision = 0;
  private disposed = false;
  constructor(private readonly client: MoguriClient, readonly sessionId: string, draft: Session["draft"]) {
    this.revision = draft.revision;
    this.latest = draft;
    this.state = { text: draft.text, attachments: draft.attachments, dirty: false, saving: false, conflict: false, error: null };
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  getState = () => this.state;
  private update(change: Partial<DraftState>): void { this.state = { ...this.state, ...change }; for (const listener of this.listeners) listener(); }
  receive(draft: Session["draft"]): void {
    this.latest = draft;
    if (this.task || this.captureTask || draft.revision <= this.revision) return;
    this.externalRevision++;
    if (this.state.dirty) {
      this.update({ conflict: true, error: "Another client changed this draft. Your text is preserved. Reload theirs or explicitly keep yours." });
    } else {
      this.revision = draft.revision;
      this.update({ text: draft.text, attachments: draft.attachments, conflict: false, error: null });
    }
  }
  edit(text: string, attachments = this.state.attachments): void {
    this.update({ text, attachments, dirty: true, error: this.state.conflict ? this.state.error : null });
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.flush().catch(() => console.error("Moguri draft autosave failed; the unsent edit and error remain visible.")); }, 200);
  }
  startDictation(start = this.state.text.length, end = start): DraftDictation {
    let source = this.state.text, from = start, to = end, closed = false;
    const external = this.externalRevision;
    const splitsPair = (offset: number) => offset > 0 && offset < source.length && /[\ud800-\udbff]/.test(source[offset - 1]!) && /[\udc00-\udfff]/.test(source[offset]!);
    if (this.disposed || this.captureTask || this.state.conflict || !Number.isSafeInteger(from) || !Number.isSafeInteger(to) ||
      from < 0 || from > to || to > source.length || splitsPair(from) || splitsPair(to)) throw new ClientError("dictation_selection", "Resolve the current draft and choose a valid original text selection before dictating.");
    return {
      update: (text) => {
        if (closed || this.disposed || this.externalRevision !== external || this.state.conflict) throw new ClientError("dictation_stale", "The original dictation draft changed or closed. Existing text was preserved.");
        if (typeof text !== "string" || !text.isWellFormed()) throw new ClientError("dictation_text", "The local recognizer did not return valid text. Existing text was preserved.");
        if (!text.trim()) return;
        const current = this.state.text;
        if (current !== source) {
          let prefix = 0, suffix = 0;
          while (prefix < Math.min(source.length, current.length) && source[prefix] === current[prefix]) prefix++;
          if (splitsPair(prefix)) prefix--;
          while (suffix < Math.min(source.length, current.length) - prefix && source[source.length - suffix - 1] === current[current.length - suffix - 1]) suffix++;
          const previousEnd = source.length - suffix;
          if (previousEnd <= from) { const delta = current.length - source.length; from += delta; to += delta; }
          else if (prefix < to) { closed = true; throw new ClientError("dictation_edited", "You edited the active dictated text. Recognition stopped; your correction was preserved."); }
        }
        const before = current.slice(0, from), after = current.slice(to), spoken = text.trim();
        const leading = /[\p{L}\p{N}\p{P}]$/u.test(before) && !/[([{]$/.test(before) && /^[\p{L}\p{N}]/u.test(spoken) ? " " : "";
        const trailing = after && !/^[\s,.;:!?)}\]]/.test(after) ? " " : "";
        const replacement = `${leading}${spoken}${trailing}`, next = before + replacement + after;
        if (next.length > MAX_TEXT) throw new ClientError("dictation_limit", "Dictation would exceed the inline composer limit. Existing text was preserved.");
        if (next !== current) this.edit(next);
        source = next; to = from + replacement.length;
      },
      close: () => { closed = true; },
    };
  }
  flush(): Promise<void> {
    clearTimeout(this.timer);
    if (this.captureTask) return this.captureTask;
    if (this.task) return this.task;
    if (this.state.conflict) return Promise.reject(new Error(this.state.error ?? "Draft conflict."));
    this.task = (async () => {
      while (this.state.dirty && !this.captureTask) {
        const text = this.state.text;
        const attachments = this.state.attachments;
        this.update({ saving: true, error: null });
        try {
          const result = await this.client.command({
            type: "draft.save", sessionId: this.sessionId, expectedRevision: this.revision, text, attachments,
          });
          if (result.revision === undefined) throw new Error("The service did not acknowledge the draft revision.");
          this.revision = result.revision;
          this.update({ dirty: text !== this.state.text || attachments !== this.state.attachments });
        } catch (error) {
          const conflict = error instanceof ClientError && error.code === "revision_conflict";
          this.update({
            conflict, error: conflict ? "Another client changed this draft. Your text is preserved. Reload theirs or explicitly keep yours." :
              error instanceof Error ? error.message : "Draft could not be saved. Keep this window open and retry.",
          });
          throw error;
        } finally { this.update({ saving: false }); }
      }
    })().finally(() => { this.task = undefined; this.receive(this.latest); });
    return this.task;
  }
  paste(pastedText: string, start = this.state.text.length, end = start): Promise<void> {
    const before = this.state;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || end > before.text.length) return Promise.reject(new ClientError("paste_selection", "Choose a valid selection in the current unsent draft."));
    const inserted = before.text.slice(0, start) + pastedText + before.text.slice(end);
    clearTimeout(this.timer);
    this.update({ text: inserted, dirty: true, error: before.conflict ? before.error : null });
    if (this.captureTask) {
      const error = "Another paste is still saving. Both unsent texts are preserved; review the saved draft before continuing.";
      this.update({ conflict: true, error });
      return Promise.reject(new ClientError("revision_conflict", error));
    }
    const pending = this.task;
    const task = (async () => {
      await pending;
      if (this.state.conflict) throw new ClientError("revision_conflict", this.state.error ?? "Resolve the current draft conflict before capturing a paste.");
      this.update({ saving: true, error: null });
      const result = await this.client.command({ type: "draft.paste", sessionId: this.sessionId, expectedRevision: this.revision,
        text: before.text, attachments: before.attachments, pastedText, start, end });
      if (result.revision === undefined) throw new Error("The service did not acknowledge the pasted file. Your unsent text is preserved.");
      const saved = this.client.getState().snapshot?.sessions.find((session) => session.id === this.sessionId)?.draft;
      if (!saved || saved.revision < result.revision) throw new Error("The captured draft acknowledgement is unavailable. Your unsent text is preserved; reconnect before retrying.");
      this.revision = result.revision; this.latest = saved;
      if (saved.revision !== result.revision || this.state.text !== inserted || this.state.attachments !== before.attachments) {
        throw new ClientError("revision_conflict", "The draft changed while the pasted file was saving. Your complete unsent edits are preserved. Review the saved file before reloading or keeping yours.");
      }
      this.update({ text: saved.text, attachments: saved.attachments, dirty: false, conflict: false, error: null });
    })().catch((error: unknown) => {
      this.update({ dirty: true, conflict: this.state.conflict || error instanceof ClientError && error.code === "revision_conflict",
        error: error instanceof Error ? error.message : "Paste capture failed. The complete unsent text is preserved." });
      throw error;
    }).finally(() => { this.captureTask = undefined; this.update({ saving: false }); this.receive(this.latest); });
    this.captureTask = task;
    return task;
  }
  reload(): void {
    if (this.task || this.captureTask) return;
    this.revision = this.latest.revision;
    this.update({ text: this.latest.text, attachments: this.latest.attachments, dirty: false, saving: false, conflict: false, error: null });
  }
  keepMine(): Promise<void> {
    if (this.captureTask) return Promise.reject(new ClientError("paste_pending", "Wait for the pasted-file request to settle before resolving this draft."));
    this.revision = this.latest.revision;
    this.update({ dirty: true, conflict: false, error: null });
    return this.flush();
  }
  async attach(path: string): Promise<void> {
    await this.flush();
    await this.client.command({ type: "attachment.add", sessionId: this.sessionId, expectedRevision: this.revision, path });
    const saved = this.client.getState().snapshot?.sessions.find((session) => session.id === this.sessionId)?.draft;
    if (saved) this.receive(saved);
  }
  async send(delivery: "queue" | "steer" | "interrupt", held = false): Promise<CommandResult> {
    await this.flush();
    if (this.state.dirty || this.state.conflict) throw new Error("Save or resolve the draft before sending.");
    const result = await this.client.command({ type: "message.send", sessionId: this.sessionId, expectedRevision: this.revision, delivery, ...(held ? { held: true } : {}) });
    const saved = this.client.getState().snapshot?.sessions.find((session) => session.id === this.sessionId)?.draft;
    if (saved) this.receive(saved);
    return result;
  }
  async reviewContinueWork(): Promise<ContinueWorkReview> {
    await this.flush();
    if (this.state.dirty || this.state.conflict || !isContinueWork(this.state.text)) throw new ClientError("continue_work_draft", "Review the exact saved continue-work draft before choosing its route.");
    return { profileId: this.client.profileId, sessionId: this.sessionId, expectedRevision: this.revision, text: this.state.text };
  }
  async chooseContinueWork(review: ContinueWorkReview, choice: ContinueWorkChoice): Promise<CommandResult> {
    await this.flush();
    if (review.profileId !== this.client.profileId || review.sessionId !== this.sessionId || review.expectedRevision !== this.revision ||
      review.text !== this.state.text || this.state.dirty || this.state.conflict) {
      throw new ClientError("continue_work_stale", "The draft or owning profile changed while choosing. Your text was preserved; review this request again.");
    }
    const result = await this.client.command({ type: "message.send", sessionId: this.sessionId, expectedRevision: review.expectedRevision,
      delivery: "queue", continueWorkChoice: choice });
    const saved = this.client.getState().snapshot?.sessions.find((session) => session.id === this.sessionId)?.draft;
    if (saved) this.receive(saved);
    return result;
  }
  dispose(): void { this.disposed = true; clearTimeout(this.timer); this.listeners.clear(); }
}
