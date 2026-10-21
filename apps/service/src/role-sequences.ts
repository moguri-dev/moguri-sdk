import {
  interruptedRoleSequence, MoguriError, type EventInput, type RoleSequenceQuery, type RoleSequenceRecord,
  type RoleSequenceResponse, type Snapshot, type StoredEvent,
} from "../../../packages/protocol/src/index.ts";
import { EventStore } from "./store.ts";

export class RoleSequences {
  constructor(private readonly store: EventStore, private readonly snapshot: () => Snapshot, private readonly events: () => StoredEvent[]) {}
  event(sequence: RoleSequenceRecord): EventInput { return { event_type: "role.sequence_recorded", profile_id: sequence.profileId, payload: { sequence } }; }
  original(commandId: string, commandDigest: string): { id: string; revision: number } | null {
    const deleted = this.events().find((event) => event.event_type === "artifact.deleted" && event.payload.roleSequenceIntent?.commandId === commandId);
    if (deleted) throw new MoguriError("role_sequence_deleted", "That original role sequence was explicitly deleted. No model, input or effect may be resurrected.", 410);
    const record = this.snapshot().roleSequences.find((sequence) => sequence.commandId === commandId);
    if (!record) return null;
    if (record.commandDigest !== commandDigest) throw new MoguriError("command_reused", "The original role command already owns different exact input.", 409);
    return { id: record.id, revision: record.revision };
  }
  query(query: RoleSequenceQuery): RoleSequenceResponse {
    const snapshot = this.snapshot(), sequence = snapshot.roleSequences.find((sequence) => sequence.id === query.sequenceId), artifact = snapshot.artifacts.find((artifact) => artifact.id === query.sequenceId);
    if (!sequence || !artifact) throw new MoguriError("role_sequence_missing", "Role sequence is missing, deleted or outside this immutable profile.", 404);
    if (artifact.kind !== "report" || artifact.contentDigest !== sequence.inputDigest) throw new MoguriError("role_sequence_corrupt", "The exact retained role input was replaced. No substitute was read.", 409);
    const step = query.index === undefined ? null : sequence.steps[query.index];
    if (query.index !== undefined && !step) throw new MoguriError("role_sequence_step", "Choose an actual retained role index from this sequence.", 404);
    return { type: "role.sequence.read", sequence, text: this.store.blob(sequence.inputDigest),
      step: step && query.index !== undefined ? { index: query.index, input: step.inputDigest ? this.store.blob(step.inputDigest) : null, result: step.resultDigest ? this.store.blob(step.resultDigest) : null } : null };
  }
  recover(): EventInput[] {
    return this.snapshot().roleSequences.filter((sequence) => sequence.status === "running")
      .map((sequence) => this.event(interruptedRoleSequence(sequence, "Service restarted with an unsettled role sequence. No model, root lookup, approval or effect was replayed.")));
  }
  derived(snapshot: Snapshot, primary: StoredEvent[]): EventInput[] {
    return snapshot.roleSequences.filter((sequence) => sequence.status === "running" && primary.some((event) =>
      event.event_type === "turn.finished" && event.session_id === sequence.sessionId && event.turn_id === sequence.id ||
      event.event_type === "session.deleted" && [sequence.sessionId, sequence.ownerSessionId].includes(event.payload.deletedSessionId) ||
      event.event_type === "project.removed" && event.payload.deletedProjectId === sequence.projectId))
      .map((sequence) => this.event(interruptedRoleSequence(sequence, "The exact owning turn/session/project ended before this role sequence settled. Actual reports/unknown holds remain retained; no continuation or success was inferred.")));
  }
}
