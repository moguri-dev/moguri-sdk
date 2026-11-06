import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import { CandidateBoundarySchema, CandidateRootSchema, validCandidateRoots } from "./candidates.ts";
import { MoguriError } from "./core.ts";

const id = Type.String({ minLength: 1, maxLength: 128 }), hash = Type.String({ pattern: "^[a-f0-9]{64}$" });
const diagnostic = Type.Union([Type.String({ minLength: 1, maxLength: 4000 }), Type.Null()]);
export const CANDIDATE_ENV_SCHEMA = "candidate_transports_schema";
export const CandidateWorkspaceSchema = Type.Object({
  version: Type.Literal(1), id, profileId: id, projectId: id, originSessionId: id,
  name: Type.String({ minLength: 1, maxLength: 120 }), boundary: CandidateBoundarySchema,
  plannedRoot: Type.String({ minLength: 1, maxLength: 4096 }),
  source: CandidateRootSchema, stage: Type.Union([CandidateRootSchema, Type.Null()]),
  commandId: id, commandDigest: hash, operationId: id, authorityDigest: hash,
  revision: Type.Integer({ minimum: 0 }), createdAt: Type.String(), updatedAt: Type.String(),
  status: Type.Union([Type.Literal("creating"), Type.Literal("ready"), Type.Literal("partial")]),
  stopRequested: Type.Boolean(), diagnostic,
}, { additionalProperties: false });
export type CandidateWorkspace = Static<typeof CandidateWorkspaceSchema>;
export function projectCandidateWorkspace(previous: CandidateWorkspace | undefined, value: unknown): CandidateWorkspace {
  const invalid = () => { throw new MoguriError("candidate_workspace_corrupt", "Original workspace ownership, exact Env or no-replay lifecycle changed. Retained files were not adopted or removed.", 409); };
  if (!Value.Check(CandidateWorkspaceSchema, value)) invalid();
  const next = value as CandidateWorkspace;
  if (next.source.env === "Local" || next.source.projectId !== next.projectId ||
    JSON.stringify(next.source.boundary) !== JSON.stringify(next.boundary) ||
    !next.plannedRoot.startsWith("/") || next.plannedRoot.includes("\0") || next.plannedRoot.split("/").some((part) => part === ".." || part === ".") ||
    next.stage && (!validCandidateRoots(next.source, next.stage, next.projectId) || next.stage.workspaceId !== next.id || next.stage.root !== next.plannedRoot) ||
    next.status === "ready" && (!next.stage || next.diagnostic || next.stopRequested) ||
    next.status === "creating" && (next.stage || next.diagnostic) ||
    next.status === "partial" && !next.diagnostic ||
    [next.createdAt, next.updatedAt].some((time) => !Number.isFinite(Date.parse(time)) || new Date(time).toISOString() !== time)) invalid();
  if (!previous) {
    if (next.revision !== 0 || next.status !== "creating" || next.stage || next.stopRequested || next.createdAt !== next.updatedAt) invalid();
  } else {
    for (const key of ["version", "id", "profileId", "projectId", "originSessionId", "name", "plannedRoot", "commandId", "commandDigest", "operationId", "authorityDigest", "createdAt", "source", "boundary"] as const) {
      if (JSON.stringify(previous[key]) !== JSON.stringify(next[key])) invalid();
    }
    if (previous.status !== "creating" || next.revision !== previous.revision + 1 ||
      previous.stopRequested && !next.stopRequested || previous.stage && JSON.stringify(previous.stage) !== JSON.stringify(next.stage)) invalid();
  }
  return structuredClone(next);
}
const sequence = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const terminalOutcome = Type.Union([Type.Literal("completed"), Type.Literal("stopped"), Type.Literal("failed"), Type.Literal("partial")]);
export const CandidateRecoveryEvidenceSchema = Type.Object({
  version: Type.Literal(1), fromSequence: sequence, resultDigest: hash,
  journal: Type.Object({
    runId: id, root: Type.String({ minLength: 1, maxLength: 4096 }), workerDigest: hash,
    protocol: Type.Integer({ minimum: 92 }), workerPid: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    acknowledged: sequence, sequence,
    status: Type.Union([...terminalOutcome.anyOf, Type.Literal("unconfirmed")]),
    cleanup: Type.Literal("owned-worker-stopped"), proof: hash,
  }, { additionalProperties: false }),
  frames: Type.Array(Type.Object({ sequence, digest: hash, kind: Type.Union([
    Type.Literal("candidate.boundary"), Type.Literal("candidate.complete"), Type.Literal("ack"), Type.Literal("finished"),
  ]) }, { additionalProperties: false }), { maxItems: 64 }),
  terminal: Type.Object({
    source: Type.Union([Type.Literal("frame"), Type.Literal("status")]), originalAcknowledged: Type.Boolean(), peerAcknowledged: Type.Boolean(), outcome: terminalOutcome,
    sequence: Type.Union([sequence, Type.Null()]), digest: Type.Union([hash, Type.Null()]), requestId: Type.Union([id, Type.Null()]),
  }, { additionalProperties: false }),
  guest: Type.Optional(Type.Object({
    nativeSessionId: id, planDigest: hash, signerFingerprint: Type.String({ minLength: 1, maxLength: 256 }), absent: Type.Literal(true),
  }, { additionalProperties: false })),
}, { additionalProperties: false });
export type CandidateRecoveryEvidence = Static<typeof CandidateRecoveryEvidenceSchema>;
export const CandidateTransportRecoverySchema = Type.Object({
  version: Type.Literal(1), actor: Type.Literal("user"), commandId: id, commandDigest: hash,
  inspectedAt: Type.String({ minLength: 20, maxLength: 32 }), evidence: CandidateRecoveryEvidenceSchema,
}, { additionalProperties: false });
export const CandidateTransportRecordSchema = Type.Object({
  version: Type.Literal(1), id, ownerId: id, ownerKind: Type.Union([Type.Literal("workspace"), Type.Literal("candidate"), Type.Literal("read")]),
  profileId: id, sessionId: id, projectId: id, operationDigest: hash, authorityDigest: hash,
  boundary: CandidateBoundarySchema, launchJson: Type.String({ minLength: 1, maxLength: 128 * 1024 }),
  observationJson: Type.Union([Type.String({ minLength: 1, maxLength: 128 * 1024 }), Type.Null()]),
  revision: Type.Integer({ minimum: 0 }), sequence: Type.Integer({ minimum: 0 }),
  status: Type.Union([Type.Literal("running"), Type.Literal("completed"), Type.Literal("partial")]),
  resultDigest: Type.Union([hash, Type.Null()]), stopRequested: Type.Boolean(),
  terminalAcknowledged: Type.Boolean(), cleanupConfirmed: Type.Boolean(), diagnostic,
  recovery: Type.Optional(CandidateTransportRecoverySchema),
}, { additionalProperties: false });
export type CandidateTransportRecord = Static<typeof CandidateTransportRecordSchema>;
export function projectCandidateTransport(previous: CandidateTransportRecord | undefined, value: unknown): CandidateTransportRecord {
  const invalid = () => { throw new MoguriError("candidate_transport_corrupt", "Exact original caller/receipt/build or terminal ownership changed. No effect or charge was replayed.", 409); };
  if (!Value.Check(CandidateTransportRecordSchema, value)) invalid();
  const next = value as CandidateTransportRecord;
  if (next.status === "completed" && (!next.resultDigest || !next.terminalAcknowledged || !next.cleanupConfirmed || next.stopRequested || next.diagnostic) ||
    next.status === "partial" && !next.diagnostic || next.status === "running" && next.cleanupConfirmed) invalid();
  if (next.recovery) {
    const { evidence, inspectedAt } = next.recovery, terminal = evidence.terminal;
    if (next.status !== "partial" || !next.cleanupConfirmed || next.resultDigest !== evidence.resultDigest ||
      evidence.journal.runId !== next.id || evidence.journal.root !== next.boundary.sourceRoot ||
      evidence.journal.workerDigest !== next.boundary.workerDigest || evidence.journal.sequence !== next.sequence ||
      evidence.journal.acknowledged > evidence.fromSequence || evidence.fromSequence > evidence.journal.sequence ||
      evidence.frames.length !== evidence.journal.sequence - evidence.fromSequence ||
      evidence.frames.some((frame, index) => frame.sequence !== evidence.fromSequence + index + 1) ||
      terminal.originalAcknowledged !== next.terminalAcknowledged ||
      terminal.peerAcknowledged !== (evidence.journal.status !== "unconfirmed") ||
      (next.boundary.env === "Sandbox") !== Boolean(evidence.guest) ||
      !Number.isFinite(Date.parse(inspectedAt)) || new Date(inspectedAt).toISOString() !== inspectedAt ||
      terminal.source === "frame" && (!terminal.sequence || !terminal.digest || !terminal.requestId ||
        !evidence.frames.some((frame) => frame.kind === "finished" && frame.sequence === terminal.sequence && frame.digest === terminal.digest)) ||
      terminal.source === "status" && (!terminal.originalAcknowledged || terminal.sequence !== null || terminal.digest !== null ||
        terminal.requestId !== null || evidence.journal.status === "unconfirmed" || terminal.outcome !== evidence.journal.status)) invalid();
  }
  if (!previous) {
    if (next.revision || next.status !== "running" || next.resultDigest || next.stopRequested || next.terminalAcknowledged || next.cleanupConfirmed || next.diagnostic || next.observationJson || next.recovery) invalid();
  } else {
    for (const key of ["version", "id", "ownerId", "ownerKind", "profileId", "sessionId", "projectId", "operationDigest", "authorityDigest", "boundary", "launchJson"] as const) {
      if (JSON.stringify(previous[key]) !== JSON.stringify(next[key])) invalid();
    }
    if (previous.status === "completed" || previous.status === "partial" && next.status !== "partial" ||
      next.revision !== previous.revision + 1 || next.sequence < previous.sequence ||
      previous.resultDigest && next.resultDigest !== previous.resultDigest || previous.stopRequested && !next.stopRequested ||
      previous.terminalAcknowledged && !next.terminalAcknowledged || previous.cleanupConfirmed && !next.cleanupConfirmed) invalid();
    if (previous.recovery && JSON.stringify(previous.recovery) !== JSON.stringify(next.recovery) ||
      !previous.recovery && next.recovery && (previous.status !== "partial" || next.recovery.evidence.fromSequence > previous.sequence ||
        next.terminalAcknowledged !== previous.terminalAcknowledged)) invalid();
    if (previous.observationJson) {
      if (!next.observationJson) invalid();
      const before = JSON.parse(previous.observationJson), after = JSON.parse(next.observationJson!);
      for (const key of ["nativeSessionId", "planDigest", "signerFingerprint"]) if (before[key] != null && before[key] !== after[key]) invalid();
    }
  }
  return structuredClone(next);
}
export const CandidateWorkspaceQuerySchema = Type.Union([
  Type.Object({ type: Type.Literal("candidate.transports"), sessionId: Type.Optional(id), ownerId: Type.Optional(id) }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("candidate.transport.read"), transportId: id }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("candidate.workspaces"), sessionId: id }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("candidate.workspace.read"), workspaceId: id }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("candidate.workspace.preview"), sessionId: id, name: Type.String({ minLength: 1, maxLength: 120 }) }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("candidate.source"), sessionId: id, paths: Type.Array(Type.String({ minLength: 1, maxLength: 4096 }), { minItems: 1, maxItems: 20, uniqueItems: true }) }, { additionalProperties: false }),
]);
export const CandidateWorkspaceCommandSchema = Type.Union([
  Type.Object({ type: Type.Literal("candidate.transport.reconcile"), transportId: id, expectedRevision: Type.Integer({ minimum: 0 }) }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("candidate.workspace.create"), sessionId: id, name: Type.String({ minLength: 1, maxLength: 120 }),
    expectedDigest: hash, confirm: Type.Literal(true) }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("candidate.workspace.stop"), workspaceId: id }, { additionalProperties: false }),
]);
export type CandidateWorkspaceQuery = Static<typeof CandidateWorkspaceQuerySchema>;
export type CandidateWorkspaceCommand = Static<typeof CandidateWorkspaceCommandSchema>;
export interface CandidateWorkspacePreview {
  source: Exclude<Static<typeof CandidateRootSchema>, { env: "Local" }>; name: string; stageParent: string; authorityDigest: string; digest: string; diagnostic: string;
}
export type CandidateWorkspaceResponse =
  | { type: "candidate.transports"; transports: CandidateTransportRecord[]; total: number }
  | { type: "candidate.transport.read"; transport: CandidateTransportRecord }
  | { type: "candidate.workspaces"; workspaces: CandidateWorkspace[] }
  | { type: "candidate.workspace.read"; workspace: CandidateWorkspace }
  | { type: "candidate.workspace.preview"; preview: CandidateWorkspacePreview }
  | { type: "candidate.source"; source: Static<typeof CandidateRootSchema>; files: Array<{ path: string; baseDigest: string; text: string | null }> };
export const isCandidateWorkspaceCommand = (value: unknown): value is CandidateWorkspaceCommand => Value.Check(CandidateWorkspaceCommandSchema, value);
export const isCandidateWorkspaceQuery = (value: unknown): value is CandidateWorkspaceQuery => Value.Check(CandidateWorkspaceQuerySchema, value);
