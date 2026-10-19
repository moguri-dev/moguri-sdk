import { randomUUID } from "node:crypto";
import { PROFILE_ID, type Attention, type EventInput, type Snapshot, type StoredEvent } from "../../../packages/protocol/src/index.ts";

export function likelyQuestion(text: string): boolean {
  const visible = text.replace(/```[\s\S]*?```/g, "").replace(/`[^`]*`/g, "");
  const last = visible.split(/\n+/).map((line) => line.trim()).filter(Boolean).at(-1) ?? "";
  return last.length >= 8 && last.length <= 1500 && /[?？]\s*$/.test(last) && !/^(?:>|https?:\/\/|[-*]\s*`)/.test(last);
}
export function attentionEvents(snapshot: Snapshot, events: StoredEvent[]): EventInput[] {
  const derived: EventInput[] = [];
  for (const event of events) {
    const session = snapshot.sessions.find((session) => session.id === event.session_id);
    if (!session || session.kind === "subagent") continue;
    const clear = () => {
      const ids = snapshot.attention.filter((entry) => entry.sessionId === session.id && entry.active).map((entry) => entry.id);
      if (ids.length) derived.push({ event_type: "attention.cleared", profile_id: PROFILE_ID, project_id: session.projectId, session_id: session.id, payload: { attentionIds: ids } });
    };
    if (event.event_type === "turn.started" || event.event_type === "tool.decided") { clear(); continue; }
    let kind: Attention["kind"] | undefined;
    let reason: Attention["reason"] = "completed";
    let source: Attention["source"] = "state";
    let messageId: string | null = null;
    if (event.event_type === "tool.requested" && session.pendingApproval) { kind = "bell"; reason = "approval"; messageId = event.payload.approval.id; }
    if (event.event_type === "turn.finished") {
      if (event.payload.outcome === "completed") {
        if (session.queue.some((item) => !item.held && item.delivery !== "steer")) { clear(); continue; }
        const message = session.messages.findLast((message) => message.role === "assistant");
        const question = likelyQuestion(message?.text ?? "");
        kind = question ? "question" : "done"; reason = question ? "question" : "completed"; source = question ? "heuristic" : "state"; messageId = message?.id ?? null;
      } else if (["partial", "failed"].includes(event.payload.outcome)) { kind = "bell"; reason = "failed"; }
    }
    if (!kind) continue;
    clear();
    const attention: Attention = { id: randomUUID(), sessionId: session.id, projectId: session.projectId, kind, reason, source, messageId, acknowledged: false, active: true, createdAt: event.timestamp };
    derived.push({ event_type: "attention.raised", profile_id: PROFILE_ID, project_id: session.projectId, session_id: session.id, payload: { attention } });
  }
  return derived;
}
