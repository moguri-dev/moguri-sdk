import { MAX_TEXT, MoguriError, type EventInput, type Session } from "../../../packages/protocol/src/index.ts";
import type { EventStore } from "./store.ts";

export function selectedSkillEvents(store: EventStore, session: Session, skill: { id: string; name: string; body: string },
  expectedDraftRevision: number, startedAt: string, start: number, replacementText?: string): EventInput[] {
  if (session.draft.revision !== expectedDraftRevision) throw new MoguriError("revision_conflict", "The draft changed. Your current draft and selected skill were preserved.", 409);
  const original = replacementText ?? session.draft.text;
  if (!original.isWellFormed()) throw new MoguriError("skill_text", "The selected skill task needs lossless Unicode. No draft was changed.");
  const text = `${original}${original ? "\n\n" : ""}<user-selected-skill name=${JSON.stringify(skill.name)}>\n${skill.body}\n</user-selected-skill>`;
  if (Buffer.byteLength(text) > MAX_TEXT) throw new MoguriError("draft_limit", "The complete selected skill does not fit this draft. No content was truncated or sent.", 409);
  return [
    { event_type: "draft.saved", profile_id: store.profileId, project_id: session.projectId, session_id: session.id, payload: { text, attachments: session.draft.attachments } },
    { event_type: "skill.used", profile_id: store.profileId, project_id: session.projectId, session_id: session.id, payload: {
      capabilityId: skill.id, name: skill.name, contentDigest: store.putBlob(skill.body), bytes: Buffer.byteLength(skill.body),
      startedAt, loadMs: Math.max(0, Math.round(performance.now() - start)), actor: "user",
    } },
  ];
}
