import { canonicalModelResponse, MoguriError, type Session, type StoredEvent } from "../../../packages/protocol/src/index.ts";
import type { HistoryRead, HistoryReadInput } from "../../../packages/protocol/src/tooling.ts";
import { textFilePage } from "./files.ts";
import { digest } from "./store.ts";

export function retainedHistory(events: StoredEvent[], session: Session, input: HistoryReadInput, profileId: string): HistoryRead {
  const maximum = events.at(-1)?.seq ?? 0, throughSequence = input.throughSequence ?? maximum;
  if (throughSequence > maximum) throw new MoguriError("history_source", "The requested original history sequence has not been retained. No newer or other source was substituted.", 409);
  const owned = events.filter((event) => event.profile_id === profileId && event.session_id === session.id);
  const privateTurns = new Set(owned.filter((event) => event.event_type === "turn.control_started").map((event) => event.turn_id));
  const messages: Array<Record<string, unknown>> = [];
  for (const event of owned) {
    if (event.seq > throughSequence || privateTurns.has(event.turn_id)) continue;
    const source = { eventId: event.id, sequence: event.seq, turnId: event.turn_id, timestamp: event.timestamp };
    if (event.event_type === "turn.started" || event.event_type === "steer.applied") {
      const { item } = event.payload;
      messages.push({ ...source, id: item.id, role: "prompt", actor: item.origin?.origin.actor ?? "user", text: item.text,
        ...(item.origin ? { origin: item.origin } : {}), attachments: item.attachments.map(({ id, kind, path, digest }) => ({ id, kind, path, digest })) });
    } else if (event.event_type === "model.completed" && !event.payload.kupo &&
      !["router", "compaction", "draft", "checkpoint", "decision", "steering"].includes(event.payload.usage.role) ||
      event.event_type === "routing.response_selected") {
      const selected = canonicalModelResponse(events, event);
      if (selected) messages.push({ ...source, id: selected.message.id, role: "assistant", actor: "model",
        modelId: selected.usage.modelId, text: selected.message.text, outcome: selected.message.outcome });
    } else if (event.event_type === "tool.completed" && !event.payload.call.hook) {
      messages.push({ ...source, id: event.payload.call.id, role: "tool", actor: "tool", stepId: event.step_id,
        name: event.payload.call.name, text: event.payload.text, outcome: event.payload.outcome });
    } else if (event.event_type === "question.answered") {
      messages.push({ ...source, id: event.payload.questionId, role: "answer", actor: event.payload.answer.actor, text: event.payload.answer.text });
    } else if (event.event_type === "turn.finished" && event.payload.diagnostic) {
      messages.push({ ...source, role: "notice", actor: "service", text: event.payload.diagnostic, outcome: event.payload.outcome });
    }
  }
  const messageOffset = input.messageOffset ?? 0, limitMessages = input.limitMessages ?? 20;
  if (messageOffset > messages.length) throw new MoguriError("history_cursor", "The history message cursor is outside this exact retained source.", 409);
  const window = messages.slice(messageOffset, messageOffset + limitMessages);
  const body = JSON.stringify({ profileId, sessionId: session.id, throughSequence, messageOffset, messages: window });
  if (Buffer.byteLength(body) > 8 * 1024 * 1024) throw new MoguriError("history_limit", "This source window exceeds 8 MiB. Request fewer messages explicitly; no original text was truncated.", 409);
  const sourceDigest = digest(body);
  if (input.offset && !input.expectedDigest || input.expectedDigest && input.expectedDigest !== sourceDigest) {
    throw new MoguriError("history_stale", "History continuation requires the original exact window/digest. No changed, late or newer source page was mixed in.", 409);
  }
  const page = textFilePage(body, { offset: input.offset ?? 0, limit: 12000 });
  const nextMessageOffset = page.eof && messageOffset + limitMessages < messages.length ? messageOffset + limitMessages : null;
  return { type: "tooling.history", ...page, profileId, digest: sourceDigest, sourceSessionId: session.id, throughSequence, messageOffset, limitMessages,
    totalMessages: messages.length, nextMessageOffset, complete: page.eof && nextMessageOffset === null,
    boundary: "scoped-controller-public-history", authority: "Original public input/results only. No private roles, hidden reasoning, consoles, queued prompts, drafts or tool replay." };
}
