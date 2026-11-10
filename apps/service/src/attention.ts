import { randomUUID } from "node:crypto";
import { type Attention, type EventInput, type Snapshot, type StoredEvent } from "../../../packages/protocol/src/index.ts";
import { scriptReviewNeedsApproval } from "../../../packages/protocol/src/script-reviews.ts";

export function scriptReviewAttention(snapshot: Pick<Snapshot, "profileId" | "scriptReviews" | "attention" | "sessions">): EventInput[] {
  const events: EventInput[] = [];
  const pending = new Set(snapshot.scriptReviews.filter(scriptReviewNeedsApproval).map((review) => review.id));
  const cleared = snapshot.attention.filter((entry) => entry.reason === "script-review" && entry.active && !pending.has(entry.messageId ?? "")).map((entry) => entry.id);
  if (cleared.length) events.push({ event_type: "attention.cleared", profile_id: snapshot.profileId, payload: { attentionIds: cleared } });
  for (const review of snapshot.scriptReviews) {
    if (!pending.has(review.id) || snapshot.attention.some((entry) => entry.reason === "script-review" && entry.messageId === review.id)) continue;
    const session = snapshot.sessions.find((session) => session.id === review.sessionId);
    if (!session || session.kind === "subagent") continue;
    const attention: Attention = { id: randomUUID(), sessionId: session.id, projectId: review.projectId, kind: "bell",
      reason: "script-review", source: "state", messageId: review.id, acknowledged: false, active: true, createdAt: review.inspectedAt };
    events.push({ event_type: "attention.raised", profile_id: snapshot.profileId, project_id: review.projectId, session_id: session.id, payload: { attention } });
  }
  return events;
}

export function likelyQuestion(text: string): boolean {
  const visible = text.replace(/```[\s\S]*?```/g, "").replace(/`[^`]*`/g, "");
  const last = visible.split(/\n+/).map((line) => line.trim()).filter(Boolean).at(-1) ?? "";
  return last.length >= 8 && last.length <= 1500 && /[?？]\s*$/.test(last) && !/^(?:>|https?:\/\/|[-*]\s*`)/.test(last);
}
export function attentionEvents(snapshot: Snapshot, events: StoredEvent[]): EventInput[] {
  const derived: EventInput[] = [];
  for (const event of events) {
    if (event.event_type === "my_work.refresh_recorded" && event.payload.refresh.status !== "running") {
      const refresh = event.payload.refresh;
      if (refresh.inspection) continue;
      const active = snapshot.attention.filter((entry) => entry.reason === "my-work" && entry.active);
      const clear = active.filter((entry) => {
        const old = snapshot.myWorkRefreshes.find((value) => value.id === entry.myWork?.refreshId)?.attention.find((value) => value.itemId === entry.messageId);
        const current = refresh.attention.find((value) => value.itemId === entry.messageId);
        return current ? current.fingerprint !== entry.myWork?.fingerprint :
          old?.sourceIds.every((id) => refresh.sources.some((source) => source.source.id === id && source.status === "complete"));
      }).map((entry) => entry.id);
      if (clear.length) derived.push({ event_type: "attention.cleared", profile_id: snapshot.profileId, payload: { attentionIds: clear } });
      for (const summary of refresh.attention) {
        if (!summary.sourceIds.some((id) => {
          const original = refresh.sources.find((source) => source.source.id === id)?.source;
          const current = snapshot.myWorkSources.find((source) => source.id === id);
          return original && current?.enabled && JSON.stringify(current) === JSON.stringify(original) &&
            original.binding.policyRevision === snapshot.policy.revision && original.binding.permissionRevision === snapshot.settings.permissionRevision;
        })) continue;
        if (snapshot.attention.some((entry) => entry.reason === "my-work" && (entry.active || entry.deleted) &&
          entry.messageId === summary.itemId && entry.myWork?.fingerprint === summary.fingerprint)) continue;
        const attention: Attention = { id: randomUUID(), sessionId: null, projectId: null, kind: "bell", reason: "my-work",
          source: "state", messageId: summary.itemId, acknowledged: false, active: true, createdAt: event.timestamp,
          myWork: { refreshId: refresh.id, revision: refresh.revision, fingerprint: summary.fingerprint } };
        derived.push({ event_type: "attention.raised", profile_id: snapshot.profileId, payload: { attention } });
      }
      continue;
    }
    const session = snapshot.sessions.find((session) => session.id === event.session_id);
    if (!session || session.kind === "subagent") continue;
    const clear = () => {
      const ids = snapshot.attention.filter((entry) => entry.sessionId === session.id && entry.active && !["ci", "my-work", "script-review"].includes(entry.reason)).map((entry) => entry.id);
      if (ids.length) derived.push({ event_type: "attention.cleared", profile_id: snapshot.profileId, project_id: session.projectId, session_id: session.id, payload: { attentionIds: ids } });
    };
    if (event.event_type === "github.operation_recorded") {
      const operation = event.payload.operation;
      if (!operation.ci || operation.status === "running" || operation.originSessionId !== session.id ||
        snapshot.attention.some((entry) => entry.reason === "ci" && entry.messageId === operation.id)) continue;
      const attention: Attention = { id: randomUUID(), sessionId: session.id, projectId: operation.projectId,
        kind: "bell", reason: "ci", source: "state", messageId: operation.id, operationRevision: operation.revision,
        acknowledged: false, active: true, createdAt: event.timestamp };
      derived.push({ event_type: "attention.raised", profile_id: snapshot.profileId, project_id: operation.projectId,
        session_id: session.id, payload: { attention } });
      continue;
    }
    if (event.event_type === "turn.started" || event.event_type === "tool.decided" || event.event_type === "question.answered" || event.event_type === "question.cancelled") { clear(); continue; }
    let kind: Attention["kind"] | undefined;
    let reason: Attention["reason"] = "completed";
    let source: Attention["source"] = "state";
    let messageId: string | null = null;
    if (event.event_type === "tool.requested" && session.pendingApproval) { kind = "bell"; reason = "approval"; messageId = event.payload.approval.id; }
    if (event.event_type === "question.asked") { kind = "question"; reason = "question"; messageId = event.payload.question.id; }
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
    derived.push({ event_type: "attention.raised", profile_id: snapshot.profileId, project_id: session.projectId, session_id: session.id, payload: { attention } });
  }
  return events.some((event) => event.event_type === "script.review_recorded" || event.event_type === "script.review_approved") ?
    [...derived, ...scriptReviewAttention(snapshot)] : derived;
}
