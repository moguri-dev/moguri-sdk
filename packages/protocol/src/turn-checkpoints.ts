import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";
import { MoguriError } from "./core.ts";
import type { SkillConsumption } from "./skill-admission.ts";
import { SkillConsumptionSchema } from "./skill-admission.ts";
export * from "./checkpoint-transports.ts";
import type { CheckpointCapture, CheckpointWorkspace } from "./checkpoint-transports.ts";
import { RemoteExecutionSchema } from "./execution.ts";
import { ProjectSettingsSchema } from "./sessions.ts";

const object = <T extends Record<string, TSchema>>(properties: T) => Type.Object(properties, { additionalProperties: false });
const id = Type.String({ minLength: 1, maxLength: 128 }), hash = Type.String({ pattern: "^[a-f0-9]{64}$" });
const nullableHash = Type.Union([hash, Type.Null()]), revision = Type.Integer({ minimum: 0 });
const path = Type.String({ minLength: 1, maxLength: 4096 });
export const CHECKPOINT_STATE_BYTES = 32 * 1024 * 1024;
export const CHECKPOINT_SESSION_BYTES = 512 * 1024 * 1024;
export const CHECKPOINT_SESSION_COUNT = 64;
export interface CheckpointState {
  version: 1; context: unknown[]; messages: unknown[]; draft: unknown; queue: unknown[]; controls: unknown;
  parentMessages?: number;
  artifacts: { id: string; revision: number; digest: string }[]; skillConsumptions: SkillConsumption[];
}
export const CheckpointStateSchema = object({
  version: Type.Literal(1), context: Type.Array(Type.Unknown()), parentMessages: Type.Optional(revision), messages: Type.Array(Type.Unknown()), draft: Type.Unknown(),
  queue: Type.Array(Type.Unknown()), controls: Type.Unknown(),
  artifacts: Type.Array(object({ id, revision, digest: hash })), skillConsumptions: Type.Array(SkillConsumptionSchema),
});
export const TurnCheckpointSchema = object({
  version: Type.Literal(1), id, revision, profileId: id, sessionId: id, projectId: Type.Union([id, Type.Null()]),
  turnId: id, admissionEventId: id, startSequence: revision, throughSequence: revision, createdAt: Type.String(),
  summary: Type.String({ maxLength: 240 }), env: Type.Union([Type.Literal("Local"), Type.Literal("Remote"), Type.Literal("Sandbox")]),
  identityDigest: hash, stateDigest: nullableHash, beforeDigest: nullableHash, storageBytes: revision,
  beforeCaptureId: Type.Optional(id),
  diagnostics: Type.Array(Type.String()), forgotten: Type.Boolean(),
  terminal: Type.Union([Type.Null(), object({ sequence: revision, eventId: id, at: Type.String(),
    outcome: Type.Union([Type.Literal("completed"), Type.Literal("stopped"), Type.Literal("failed"), Type.Literal("partial")]),
    diagnostic: Type.Union([Type.String(), Type.Null()]), afterDigest: nullableHash, afterCaptureId: Type.Optional(id), capturedAt: Type.Optional(Type.String()) })]),
});
export type TurnCheckpoint = Static<typeof TurnCheckpointSchema>;
export const RewindModeSchema = Type.Union([Type.Literal("conversation"), Type.Literal("workspace")]);
export type RewindMode = Static<typeof RewindModeSchema>;
const decision = object({ root: path, path, choice: Type.Union([Type.Literal("keep-current"), Type.Literal("restore-checkpoint")]) });
export type RewindFileDecision = Static<typeof decision>;
export interface RewindFilePreview {
  root: string; path: string; currentDigest: string | null; targetDigest: string | null;
  expectedDigest: string | null; currentMode: number | null; targetMode: number | null; conflict: string | null;
}
export interface RewindPreview {
  version: 1; sessionId: string; checkpointId: string; mode: RewindMode; digest: string;
  identityDigest: string; policyDigest: string; sessionRevision: number; draftRevision: number; queueRevision: number;
  currentContextDigest: string; currentWorkspaceDigest: string | null; throughSequence: number;
  contextMessages: number; currentContextMessages: number; files: RewindFilePreview[];
  blockers: string[]; warnings: string[]; preserved: string[]; sourceAdmissions: SkillConsumption[];
}
export const RewindRecordSchema = object({
  version: Type.Literal(1), id, revision, sessionId: id, profileId: id, checkpointId: id, commandId: id,
  mode: RewindModeSchema, identityDigest: hash, previewDigest: hash, inputDigest: hash, contextDigest: hash, parentContextDigest: Type.Optional(hash),
  status: Type.Union([Type.Literal("running"), Type.Literal("completed"), Type.Literal("partial"), Type.Literal("failed")]),
  createdAt: Type.String(), updatedAt: Type.String(), actor: Type.Literal("user"),
  diagnostic: Type.Union([Type.String(), Type.Null()]), quarantined: Type.Boolean(),
  roots: Type.Array(path, { maxItems: 100 }),
  env: Type.Optional(Type.Union([Type.Literal("Local"), Type.Literal("Remote"), Type.Literal("Sandbox")])),
  leaseRoots: Type.Optional(Type.Array(path, { maxItems: 200 })),
  planDigest: Type.Optional(hash), resultDigest: Type.Optional(nullableHash),
  policyDigest: Type.Optional(hash), currentSnapshotDigest: Type.Optional(hash), targetSnapshotDigest: Type.Optional(hash),
  transportSettings: Type.Optional(ProjectSettingsSchema),
  remoteExecution: Type.Optional(RemoteExecutionSchema),
  remoteFrame: Type.Optional(object({ sequence: revision, digest: hash, kind: id })),
  nativeWorkspaceId: Type.Optional(id), operationSettled: Type.Optional(Type.Boolean()),
  files: Type.Array(object({ root: path, path, backup: Type.Union([path, Type.Null()]),
    phase: Type.Union([Type.Literal("planned"), Type.Literal("moving"), Type.Literal("written"), Type.Literal("removed"), Type.Literal("kept")]) }), { maxItems: 2000 }),
  inspection: Type.Union([Type.Null(), object({ actor: Type.Literal("user"), digest: hash, at: Type.String() })]),
});
export type RewindRecord = Static<typeof RewindRecordSchema>;
export interface SessionRewind {
  version: 1; operationId: string; checkpointId: string; contextDigest: string; throughSequence: number;
  parentContextDigest?: string;
  discardedThroughSequence: number; actor: "user"; skillConsumptions: SkillConsumption[];
}
export const CheckpointQuerySchema = Type.Union([
  object({ type: Type.Literal("checkpoints.list"), sessionId: id, offset: revision, limit: Type.Integer({ minimum: 1, maximum: 100 }) }),
  object({ type: Type.Literal("checkpoints.read"), sessionId: id, checkpointId: id }),
  object({ type: Type.Literal("rewind.preview"), sessionId: id, checkpointId: id, mode: RewindModeSchema }),
  object({ type: Type.Literal("rewind.inspect"), sessionId: id, rewindId: id }),
]);
export type CheckpointQuery = Static<typeof CheckpointQuerySchema>;
export const CheckpointCommandSchema = Type.Union([
  object({ type: Type.Literal("rewind.settle"), sessionId: id, confirmStop: Type.Literal(true) }),
  object({ type: Type.Literal("rewind.apply"), sessionId: id, checkpointId: id, mode: RewindModeSchema, expectedDigest: hash,
    decisions: Type.Array(decision, { maxItems: 2000 }), confirm: Type.Literal(true) }),
  object({ type: Type.Literal("rewind.stop"), sessionId: id, rewindId: id }),
  object({ type: Type.Literal("rewind.acknowledge"), sessionId: id, rewindId: id, expectedRevision: revision, expectedDigest: hash, confirmInspected: Type.Literal(true) }),
  object({ type: Type.Literal("checkpoint.prune"), sessionId: id, checkpointId: id, expectedRevision: revision, confirm: Type.Literal(true) }),
  object({ type: Type.Literal("checkpoint.capture.prune"), sessionId: id, captureId: id, expectedRevision: revision, confirm: Type.Literal(true) }),
]);
export type CheckpointCommand = Static<typeof CheckpointCommandSchema>;
export type CheckpointResponse =
  | { type: "checkpoints.list"; checkpoints: TurnCheckpoint[]; captures: CheckpointCapture[]; rewinds: RewindRecord[]; nextOffset: number | null; historicalTurnsUnavailable: number }
  | { type: "checkpoints.read"; checkpoint: TurnCheckpoint; state: CheckpointState | null; before: CheckpointWorkspace | null; after: CheckpointWorkspace | null }
  | { type: "rewind.preview"; preview: RewindPreview }
  | { type: "rewind.inspect"; record: RewindRecord; digest: string; effects: { root: string; path: string; currentDigest: string | null; backupDigest: string | null }[]; operationSettled?: boolean; diagnostic?: string };
export const isCheckpointCommand = (input: unknown): input is CheckpointCommand => Value.Check(CheckpointCommandSchema, input);
export const isCheckpointQuery = (input: unknown): input is CheckpointQuery => Value.Check(CheckpointQuerySchema, input);
export function projectTurnCheckpoint(previous: TurnCheckpoint | undefined, next: TurnCheckpoint): TurnCheckpoint {
  const terminalIdentity = (value: NonNullable<TurnCheckpoint["terminal"]>) => {
    const { afterDigest: _, capturedAt: _captured, ...identity } = value; return JSON.stringify(identity);
  };
  const lateCapture = previous?.terminal && next.terminal && previous.terminal.afterDigest === null && previous.terminal.afterCaptureId &&
    next.terminal.afterDigest && next.terminal.capturedAt && terminalIdentity(previous.terminal) === terminalIdentity(next.terminal);
  if (!Value.Check(TurnCheckpointSchema, next) || next.forgotten || !previous && (next.revision !== 0 || next.terminal !== null) ||
    previous && (previous.terminal !== null && !lateCapture || next.revision !== previous.revision + 1 || !next.terminal ||
      JSON.stringify({ ...previous, revision: next.revision, terminal: next.terminal, storageBytes: next.storageBytes, diagnostics: next.diagnostics }) !== JSON.stringify(next))) {
    throw new MoguriError("checkpoint_corrupt", "Checkpoint state lost its exact original pre-admission capture or once-only terminal boundary.", 409);
  }
  return structuredClone(next);
}
export function projectRewind(previous: RewindRecord | undefined, next: RewindRecord): RewindRecord {
  const identity = ({ revision: _, status: _s, updatedAt: _u, diagnostic: _d, quarantined: _q, files: _f, inspection: _i,
    resultDigest: _result, remoteExecution: _execution, remoteFrame: _frame, nativeWorkspaceId: _workspace, operationSettled: _settled, ...value }: RewindRecord) => value;
  const executionIdentity = (value: NonNullable<RewindRecord["remoteExecution"]>) => {
    const { status: _, cancellation: _c, cleanup: _cleanup, diagnostic: _d, lastSequence: _s, workerPid: _p, ...identity } = value; return JSON.stringify(identity);
  };
  if (!Value.Check(RewindRecordSchema, next) || !previous && (next.revision !== 0 || next.status !== "running" || next.inspection !== null) ||
    previous && (next.revision !== previous.revision + 1 || JSON.stringify(identity(previous)) !== JSON.stringify(identity(next)) ||
      previous.status !== "running" && (previous.status !== "partial" || next.status !== "partial" || !previous.quarantined || next.quarantined || !next.inspection) ||
      previous.status === "running" && next.inspection !== null ||
      previous.resultDigest && next.resultDigest !== previous.resultDigest ||
      previous.nativeWorkspaceId && next.nativeWorkspaceId !== previous.nativeWorkspaceId ||
      previous.operationSettled && !next.operationSettled ||
      previous.remoteExecution && (!next.remoteExecution || executionIdentity(previous.remoteExecution) !== executionIdentity(next.remoteExecution) ||
        next.remoteExecution.lastSequence < previous.remoteExecution.lastSequence) ||
      previous.remoteFrame && (!next.remoteFrame || next.remoteFrame.sequence < previous.remoteFrame.sequence) ||
      next.files.length !== previous.files.length || next.files.some((file, index) => {
        const old = previous.files[index]!;
        return file.root !== old.root || file.path !== old.path || file.backup !== old.backup ||
          file.phase !== old.phase && !(old.phase === "planned" && file.phase === "moving" || old.phase === "moving" && ["written", "removed"].includes(file.phase));
      }))) throw new MoguriError("rewind_corrupt", "The actual-user rewind intent/result changed ownership, reviewed paths or terminal work.", 409);
  if (next.remoteExecution && (next.env !== "Remote" || next.remoteExecution.sessionId !== next.sessionId ||
    next.remoteExecution.turnId !== next.id || next.operationSettled && next.remoteExecution.cleanup !== "owned-worker-stopped")) {
    throw new MoguriError("rewind_corrupt", "The independent restoration worker lost its actual Remote owner or cleanup fence.", 409);
  }
  return structuredClone(next);
}
