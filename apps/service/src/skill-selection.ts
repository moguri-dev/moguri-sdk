import { MAX_TEXT, MoguriError, type EventInput, type Session } from "../../../packages/protocol/src/index.ts";
import type { EventStore } from "./store.ts";

export function selectedSkillEvents(store: EventStore, session: Session, skill: { id: string; name: string; body: string },
  expectedDraftRevision: number, loaded: Extract<EventInput, { event_type: "skill.loaded" }>, replacementText?: string): EventInput[] {
  if (session.draft.revision !== expectedDraftRevision) throw new MoguriError("revision_conflict", "The draft changed. Your current draft and selected skill were preserved.", 409);
  const original = replacementText ?? session.draft.text;
  if (!original.isWellFormed()) throw new MoguriError("skill_text", "The selected skill task needs lossless Unicode. No draft was changed.");
  const text = `${original}${original ? "\n\n" : ""}<user-selected-skill name=${JSON.stringify(skill.name)}>\n${skill.body}\n</user-selected-skill>`;
  if (Buffer.byteLength(text) > MAX_TEXT) throw new MoguriError("draft_limit", "The complete selected skill does not fit this draft. No content was truncated or sent.", 409);
  return [
    { event_type: "draft.saved", profile_id: store.profileId, project_id: session.projectId, session_id: session.id, payload: { text, attachments: session.draft.attachments } },
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
