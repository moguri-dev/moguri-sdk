import type { Attachment, CommandResult, Session } from "../../protocol/src/index.ts";
import { ClientError, type MoguriClient } from "./index.ts";

export interface DraftState {
  text: string;
  attachments: Attachment[];
  dirty: boolean;
  saving: boolean;
  conflict: boolean;
  error: string | null;
}
export class DraftEditor {
  private state: DraftState;
  private revision: number;
  private listeners = new Set<() => void>();
  private timer?: ReturnType<typeof setTimeout>;
  private task?: Promise<void>;
  private latest: Session["draft"];
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
    if (this.task || draft.revision <= this.revision) return;
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
  flush(): Promise<void> {
    clearTimeout(this.timer);
    if (this.task) return this.task;
    if (this.state.conflict) return Promise.reject(new Error(this.state.error ?? "Draft conflict."));
    this.task = (async () => {
      while (this.state.dirty) {
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
  reload(): void {
    if (this.task) return;
    this.revision = this.latest.revision;
    this.update({ text: this.latest.text, attachments: this.latest.attachments, dirty: false, saving: false, conflict: false, error: null });
  }
  keepMine(): Promise<void> {
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
  dispose(): void { clearTimeout(this.timer); this.listeners.clear(); }
}
