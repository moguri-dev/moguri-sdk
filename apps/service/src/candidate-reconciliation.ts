import { isRecord, MoguriError, parse } from "../../../packages/protocol/src/core.ts";
import { CandidateRecoveryEvidenceSchema, type CandidateRecoveryEvidence, type CandidateTransportRecord } from "../../../packages/protocol/src/candidate-workspaces.ts";
import { validCandidateRoots } from "../../../packages/protocol/src/candidates.ts";
import { CandidateWorkerResultSchema, type CandidateWorkerResult } from "./candidate-worker-protocol.ts";
import { WorkerRequestSchema } from "./worker-protocol.ts";
import { frameDigest } from "./worker-wire.ts";
import type { BridgeFrame, BridgeInfo, BridgeStatus } from "./remote-protocol.ts";

export interface CandidateJournalInspection {
  info: Omit<BridgeInfo, "protocol"> & { protocol: number }; status: BridgeStatus; proof: string; frames: BridgeFrame[]; nextSequence: number;
  guest?: CandidateRecoveryEvidence["guest"];
}
export const CANDIDATE_INSPECTION_BYTES = 512 * 1024;
const unavailable = (message: string): never => { throw new MoguriError("candidate_reconcile_unconfirmed", `${message} Original ownership remains quarantined; no operation, acknowledgement or success was replayed/invented.`, 409); };
export function candidateRecoveryEvidence(record: CandidateTransportRecord, page: CandidateJournalInspection, retained: CandidateWorkerResult | null,
  known: Array<{ sequence: number; digest: string }> = []): CandidateRecoveryEvidence {
  if (page.info.root !== record.boundary.sourceRoot || page.info.workerDigest !== record.boundary.workerDigest || page.info.protocol < 92 ||
    page.status.runId !== record.id || page.info.native && record.boundary.env !== "Sandbox" || !page.info.native && record.boundary.env !== "Remote") {
    return unavailable("Journal identity, original root or worker build changed.");
  }
  const { status, frames } = page;
  if (status.cleanup !== "owned-worker-stopped" || !["completed", "stopped", "failed", "partial", "unconfirmed"].includes(status.status)) return unavailable("Original worker cleanup/call stack is not settled.");
  if (Buffer.byteLength(JSON.stringify(page)) > CANDIDATE_INSPECTION_BYTES || frames.length > 64 ||
    page.nextSequence !== status.sequence || status.acknowledged > record.sequence || status.sequence < record.sequence) return unavailable("Journal cursor or bounded complete inspection is missing.");
  const fromSequence = frames[0] ? frames[0].sequence - 1 : record.sequence;
  if (fromSequence > record.sequence || fromSequence < status.acknowledged || frames.length !== status.sequence - fromSequence) return unavailable("Original journal has a gap or missing terminal frames.");
  let result = retained, terminal: Extract<BridgeFrame["request"], { kind: "finished" }> | undefined, terminalFrame: BridgeFrame | undefined;
  let completed = false;
  const boundaries = new Set<string>();
  for (const [index, frame] of frames.entries()) {
    const request = parse(WorkerRequestSchema, frame.request);
    if (frame.sequence !== fromSequence + index + 1 || frame.digest !== frameDigest(request) ||
      frame.sequence <= record.sequence && !known.some((value) => value.sequence === frame.sequence && value.digest === frame.digest)) return unavailable("Original frame changed its authenticated cursor or retained digest.");
    if (terminal && request.kind !== "ack") return unavailable("The original worker emitted another capability after its terminal receipt.");
    if (request.kind === "candidate.root" || request.kind === "candidate.boundary" || request.kind === "candidate.complete") {
      if (request.operationId !== record.id || request.operationDigest !== record.operationDigest || completed) return unavailable("Candidate frame changed its original operation or repeated an effect boundary.");
      if (request.kind === "candidate.boundary" && (request.phase === "operation" ? request.path !== null :
        record.ownerKind === "read" || (record.ownerKind === "workspace" ? request.path !== null : request.path === null))) return unavailable("Original file/workspace boundary changed its caller-owned effect shape.");
      if (request.kind === "candidate.boundary") {
        const key = `${request.phase}:${request.path}`;
        if (boundaries.has(key)) return unavailable("An original effect/authorization boundary was repeated.");
        boundaries.add(key);
      }
      if (request.kind === "candidate.root") {
        const grant = record.nativeRoots?.find((grant) => grant.root === request.guest.root);
        if (record.version !== 2 || !grant || grant.guest.device !== request.guest.device || grant.guest.inode !== request.guest.inode ||
          boundaries.has(`root:${grant.root}`) || retained && frame.sequence > record.sequence) return unavailable("The original VM root observation has no matching durably acknowledged private grant.");
        boundaries.add(`root:${grant.root}`);
      }
      if (request.kind === "candidate.boundary" && retained && frame.sequence > record.sequence) return unavailable("Another effect boundary followed the original retained result.");
      if (request.kind === "candidate.complete") {
        const value = parse(CandidateWorkerResultSchema, request.result);
        if (result && frameDigest(result) !== frameDigest(value)) return unavailable("The original retained result changed.");
        result = value; completed = true;
      }
    } else if (request.kind === "finished") { terminal = request; terminalFrame = frame; }
    else if (request.kind !== "ack") return unavailable("A model-free candidate journal contains an unrelated capability.");
  }
  if (!result) return unavailable("No complete original owned-operation result fence is retained.");
  validateCandidateRecoveryResult(record, result);
  const resultDigest = frameDigest(result);
  if (record.resultDigest && record.resultDigest !== resultDigest) return unavailable("The recovered original result differs from its retained digest.");
  if (!terminal && (!record.terminalAcknowledged || status.status === "unconfirmed")) return unavailable("The original terminal receipt or its actual acknowledgement is missing.");
  if (record.boundary.env === "Sandbox") {
    if (!page.guest?.absent || !record.observationJson) return unavailable("Original signed guest ownership/absence is unconfirmed.");
    const observation: unknown = JSON.parse(record.observationJson);
    if (!isRecord(observation) || observation.nativeSessionId !== page.guest.nativeSessionId ||
      observation.planDigest !== page.guest.planDigest || observation.signerFingerprint !== page.guest.signerFingerprint) return unavailable("Original guest, plan or signer changed.");
  } else if (page.guest) return unavailable("A peer result cannot adopt native cleanup.");
  if (record.observationJson) {
    const observation: unknown = JSON.parse(record.observationJson);
    if (!isRecord(observation) || observation.workerPid != null && observation.workerPid !== status.workerPid) return unavailable("The original owned-worker receipt changed identity.");
  }
  return parse(CandidateRecoveryEvidenceSchema, { version: 1, fromSequence, resultDigest,
    journal: { runId: status.runId, root: page.info.root, workerDigest: page.info.workerDigest, protocol: page.info.protocol,
      workerPid: status.workerPid, acknowledged: status.acknowledged, sequence: status.sequence, status: status.status, cleanup: status.cleanup, proof: page.proof },
    frames: frames.map((frame) => ({ sequence: frame.sequence, digest: frame.digest, kind: frame.request.kind })),
    terminal: { source: terminal ? "frame" : "status", originalAcknowledged: record.terminalAcknowledged, peerAcknowledged: status.status !== "unconfirmed",
      outcome: terminal?.outcome ?? status.status, sequence: terminalFrame?.sequence ?? null, digest: terminalFrame?.digest ?? null, requestId: terminal?.requestId ?? null },
    ...(page.guest ? { guest: page.guest } : {}) });
}
export function validateCandidateRecoveryResult(record: CandidateTransportRecord, result: CandidateWorkerResult): void {
  if (Buffer.byteLength(JSON.stringify(result)) > 160 * 1024) return unavailable("The complete original result exceeds its receipt bound.");
  if (result.type === "state") {
    if (record.ownerKind !== "read" || record.version === 2 && record.nativeRoots?.length !== 2) return unavailable("State read changed its owner or lacks its exact private-root grants.");
    return;
  }
  const source = result.type === "written" ? result.result.source : result.source;
  if (source.env === "Local" || source.env !== record.boundary.env || source.root !== record.boundary.sourceRoot ||
    source.projectId !== record.projectId || JSON.stringify(source.boundary) !== JSON.stringify(record.boundary)) return unavailable("Original result source, Env or peer/private boundary changed.");
  if (result.type === "created" || result.type === "inspected" || result.type === "written") {
    const stage = result.type === "written" ? result.result.stage : result.stage;
    if (!validCandidateRoots(source, stage, record.projectId)) return unavailable("The original source/stage resource pair changed.");
  }
  const roots = [source, ...(result.type === "created" || result.type === "inspected" ? [result.stage] : result.type === "written" ? [result.result.stage] : [])];
  for (const root of roots) if (root.env === "Sandbox") {
    if ((root.version === 3) !== (record.version === 2)) return unavailable("Historical VM roots and new private-root grants cannot relabel each other.");
    if (root.version === 3) {
      const grant = record.nativeRoots?.find((grant) => grant.root === root.root);
      if (!grant || root.identityNamespace !== "controller-private-stage" || root.device !== grant.private.device || root.inode !== grant.private.inode) {
        return unavailable("The exact result root has no original retained private identity grant.");
      }
    }
  }
  if (record.ownerKind === "workspace" && result.type !== "created" || record.ownerKind === "candidate" && (result.type !== "written" || result.result.candidateId !== record.ownerId) ||
    record.ownerKind === "read" && !["source", "inspected"].includes(result.type)) return unavailable("Recovered result changed its original caller-owned operation kind.");
}
