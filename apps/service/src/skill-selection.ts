import { randomUUID } from "node:crypto";
import { MAX_TEXT, MoguriError, type Attachment, type EventInput, type Session } from "../../../packages/protocol/src/index.ts";
import type { EventStore } from "./store.ts";

/** Attaches a loaded skill to the draft: the model receives its body with the sent message, the chat shows only a skill chip. */
export function selectedSkillEvents(store: EventStore, session: Session, skill: { id: string; name: string; body: string },
  expectedDraftRevision: number, loaded: Extract<EventInput, { event_type: "skill.loaded" }>, replacementText?: string): EventInput[] {
  if (session.draft.revision !== expectedDraftRevision) throw new MoguriError("revision_conflict", "The draft changed. Your current draft and selected skill were preserved.", 409);
  const text = replacementText ?? session.draft.text;
  if (!text.isWellFormed()) throw new MoguriError("skill_text", "The selected skill task needs lossless Unicode. No draft was changed.");
  if (Buffer.byteLength(text) > MAX_TEXT) throw new MoguriError("draft_limit", "The prompt does not fit this draft. No content was truncated or sent.", 409);
  const attachment: Attachment = { id: randomUUID(), kind: "skill", path: skill.name, digest: loaded.payload.contentDigest, bytes: Buffer.byteLength(skill.body),
    source: { kind: "skill", location: skill.id, revision: loaded.payload.contentDigest } };
  const attachments = [...session.draft.attachments.filter((value) => !(value.kind === "skill" && value.source.location === skill.id)), attachment];
  if (attachments.length > 16) throw new MoguriError("attachment_limit", "Use at most 16 attachments. The draft was preserved; no skill was attached.", 409);
  return [
    { event_type: "draft.saved", profile_id: store.profileId, project_id: session.projectId, session_id: session.id, payload: { text, attachments } },
    loaded,
  ];
}
export function loadedSkillEvent(store: EventStore, session: Session, skill: { id: string; name: string; body: string },
  actor: "user" | "model", startedAt: string, start: number, callId: string | null): Extract<EventInput, { event_type: "skill.loaded" }> {
  return { event_type: "skill.loaded", profile_id: store.profileId, project_id: session.projectId, session_id: session.id,
    ...(actor === "model" && session.turnId ? { turn_id: session.turnId } : {}), payload: {
      version: 1, actor, callId,
      capabilityId: skill.id, name: skill.name, contentDigest: store.putBlob(skill.body), bytes: Buffer.byteLength(skill.body),
      startedAt, loadMs: Math.max(0, Math.round(performance.now() - start)),
    } };
}
