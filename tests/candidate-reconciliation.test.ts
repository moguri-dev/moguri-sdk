import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { frameDigest } from "../apps/service/src/worker-wire.ts";
import { CandidateWorkspaceCommandSchema, projectCandidateTransport, type CandidateTransportRecord } from "../packages/protocol/src/candidate-workspaces.ts";
import type { BridgeInfo, BridgeStatus } from "../apps/service/src/remote-protocol.ts";
import { Value } from "typebox/value";

test("reconciliation retains exact original late receipts but never invents their original acknowledgement or operation success", async () => {
  const { candidateRecoveryEvidence } = await import("../apps/service/src/candidate-reconciliation.ts");
  const id = randomUUID(), hash = "a".repeat(64), root = "/generated/original-peer";
  const boundary = { env: "Remote" as const, sourceRoot: root, workerDigest: hash, configurationDigest: hash, peerDigest: frameDigest({ hostKey: "generated-peer" }) };
  const transport: CandidateTransportRecord = { version: 1, id, ownerId: "read", ownerKind: "read", profileId: "default",
    sessionId: "session", projectId: "project", operationDigest: hash, authorityDigest: hash, boundary,
    launchJson: "{}", observationJson: null, revision: 1, sequence: 1, status: "partial", resultDigest: null,
    stopRequested: false, terminalAcknowledged: false, cleanupConfirmed: false, diagnostic: "Generated original controller crash." };
  const result = { type: "source" as const, source: { version: 2 as const, env: "Remote" as const, projectId: "project", workspaceId: null,
    root, device: "1", inode: "2", gitCommonDir: `${root}/.git`, head: "b".repeat(40), branch: "main", boundary }, files: [] };
  const complete = { kind: "candidate.complete" as const, requestId: "result", operationId: id, operationDigest: hash, result };
  const terminal = { kind: "finished" as const, requestId: "terminal", outcome: "completed" as const, diagnostic: null };
  const info: BridgeInfo = { protocol: 92, workerDigest: hash, nodeVersion: "26.12.0", platform: "darwin", root };
  const status: BridgeStatus = { runId: id, workerPid: 12345, port: 0, acknowledged: 1, sequence: 3,
    status: "unconfirmed", cancellation: "requested", cleanup: "owned-worker-stopped", diagnostic: "Generated lost original terminal ACK." };
  const frames = [complete, terminal].map((request, index) => ({ kind: "frame" as const, sequence: index + 2, digest: frameDigest(request), request }));
  const evidence = candidateRecoveryEvidence(transport, { info, status, proof: hash, frames, nextSequence: 3 }, null);
  assert.equal(evidence.terminal.originalAcknowledged, false);
  assert.equal(evidence.terminal.peerAcknowledged, false);
  assert.equal(evidence.terminal.outcome, "completed");
  assert.equal(evidence.journal.runId, id);
  assert.equal(evidence.resultDigest, frameDigest(result));
  assert.equal(transport.status, "partial"); assert.equal(transport.terminalAcknowledged, false);
  const recovered = { ...transport, revision: 2, sequence: 3, cleanupConfirmed: true, resultDigest: evidence.resultDigest,
    recovery: { version: 1 as const, actor: "user" as const, commandId: "reconciliation", commandDigest: hash, inspectedAt: new Date().toISOString(), evidence } };
  assert.equal(projectCandidateTransport(transport, recovered).status, "partial");
  assert.throws(() => projectCandidateTransport(transport, { ...recovered, status: "completed", diagnostic: null }), { code: "candidate_transport_corrupt" });
  assert.throws(() => projectCandidateTransport(transport, { ...recovered, terminalAcknowledged: true,
    recovery: { ...recovered.recovery, evidence: { ...evidence, terminal: { ...evidence.terminal, originalAcknowledged: true } } } }), { code: "candidate_transport_corrupt" });
  assert.equal(Value.Check(CandidateWorkspaceCommandSchema, { type: "candidate.transport.reconcile", transportId: id, expectedRevision: 1, force: true, confirmInspection: true }), false);
  assert.throws(() => candidateRecoveryEvidence(transport, { info: { ...info, root: "/generated/different-peer-root" }, status, proof: hash, frames, nextSequence: 3 }, null), /root|identity|original/i);
  assert.throws(() => candidateRecoveryEvidence(transport, { info, status: { ...status, cleanup: "unconfirmed" }, proof: hash, frames, nextSequence: 3 }, null), /cleanup|settled|unconfirmed/i);
  assert.throws(() => candidateRecoveryEvidence(transport, { info, status, proof: hash, frames: frames.slice(1), nextSequence: 3 }, null), /gap|missing|cursor/i);
  assert.throws(() => candidateRecoveryEvidence({ ...transport, sequence: 2 }, { info, status: { ...status, acknowledged: 2 }, proof: hash, frames: [frames[1]!], nextSequence: 3 }, null), /complete|result|fence/i);
  assert.throws(() => candidateRecoveryEvidence(transport, { info: { ...info, workerDigest: "c".repeat(64) }, status, proof: hash, frames, nextSequence: 3 }, null), /build|identity/i);
  assert.throws(() => candidateRecoveryEvidence(transport, { info, status, proof: hash, frames: [{ ...frames[0]!, digest: "d".repeat(64) }, frames[1]!], nextSequence: 3 }, null), /frame|digest|cursor/i);
  const acknowledged = { ...transport, terminalAcknowledged: true, sequence: 3, resultDigest: frameDigest(result) };
  const previous = candidateRecoveryEvidence(acknowledged, { info, status: { ...status, sequence: 3, acknowledged: 3, status: "completed" }, proof: hash, frames: [], nextSequence: 3 }, result);
  assert.equal(previous.terminal.source, "status"); assert.equal(previous.terminal.originalAcknowledged, true); assert.equal(previous.terminal.peerAcknowledged, true);
});
