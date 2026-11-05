import test from "node:test";
import assert from "node:assert/strict";
import { candidateEnvPathLease, candidateEnvWriteRoots, candidateTransportUnsettled } from "../apps/service/src/candidate-envs.ts";
import { remoteRootLease } from "../apps/service/src/remote.ts";
import { frameDigest } from "../apps/service/src/worker-wire.ts";
import type { CandidateTransportRecord, CandidateWorkspace } from "../packages/protocol/src/candidate-workspaces.ts";
import type { EventInput, StoredEvent } from "../packages/protocol/src/index.ts";

const hash = "a".repeat(64), hostKey = "generated-key-for-pure-ownership-fixture", now = new Date().toISOString();
function fixture() {
  const boundary = { env: "Remote" as const, peerDigest: frameDigest({ hostKey }), configurationDigest: hash, workerDigest: hash, sourceRoot: "/generated/peer-source" };
  const source = { version: 2 as const, env: "Remote" as const, projectId: "project", workspaceId: null, root: boundary.sourceRoot,
    device: "1", inode: "2", gitCommonDir: "/generated/peer-source/.git", branch: "main", head: "b".repeat(40), boundary };
  const transport: CandidateTransportRecord = { version: 1, id: "original-read", ownerId: "read", ownerKind: "read", profileId: "default",
    sessionId: "session", projectId: "project", operationDigest: hash, authorityDigest: hash, boundary,
    launchJson: JSON.stringify({ kind: "Remote", execution: { id: "original-read", sessionId: "session", projectId: "project",
      workspace: source.root, workerDigest: hash, configDigest: hash, target: { hostKey, id: "first-alias" } } }),
    observationJson: null, revision: 0, sequence: 0, status: "running", resultDigest: null, stopRequested: false, terminalAcknowledged: false, cleanupConfirmed: false, diagnostic: null };
  const workspace: CandidateWorkspace = { version: 1, id: "stage", profileId: "default", projectId: "project", originSessionId: "session",
    name: "Generated stage", boundary, plannedRoot: "/generated/owned/candidate-workspaces/default/stage/workspace", source, stage: null,
    commandId: "command", commandDigest: hash, operationId: "create", authorityDigest: hash, revision: 0,
    createdAt: now, updatedAt: now, status: "creating", stopRequested: false, diagnostic: null };
  const event = (input: EventInput, seq: number): StoredEvent => ({ ...input, seq, id: `event-${seq}`, schema_version: 1,
    timestamp: now, work_item_id: null, parent_event_id: null,
    artifact_id: input.event_type === "candidate.transport_recorded" && input.payload.transport.ownerKind === "candidate" ? input.payload.transport.ownerId : null });
  const recorded = (value: CandidateTransportRecord, seq: number) => event({ event_type: "candidate.transport_recorded", profile_id: "default", project_id: "project",
    ...(value.ownerKind === "read" ? { session_id: value.sessionId } : {}), payload: { transport: value } }, seq);
  return { source, transport, workspace, event, recorded };
}
test("unloaded-profile ownership leases both original peer paths before resource creation and ignores controller mappings/target aliases", () => {
  const f = fixture();
  const events = [f.recorded(f.transport, 1), f.event({ event_type: "candidate.workspace_recorded", profile_id: "default", project_id: "project", payload: { workspace: f.workspace } }, 2)];
  const state = { candidates: [], jobs: [], blockedProjects: [], blockedWorkspaces: [] };
  assert.deepEqual(candidateEnvWriteRoots(events, state), [remoteRootLease({ hostKey }, f.source.root), remoteRootLease({ hostKey }, f.workspace.plannedRoot)]);
  assert.equal(candidateEnvPathLease(f.source.boundary, f.source.root, [{ ...f.transport,
    launchJson: f.transport.launchJson.replace("first-alias", "different-reviewed-alias") }]), remoteRootLease({ hostKey }, f.source.root));
  assert.throws(() => candidateEnvPathLease(f.source.boundary, f.source.root, [{ ...f.transport,
    launchJson: f.transport.launchJson.replace(hostKey, "generated-other-peer") }]), { code: "candidate_ownership" });
});
test("unknown candidate transport ownership blocks grant deletion through restart/late partial receipts without promoting completion", () => {
  const f = fixture(), transport: CandidateTransportRecord = { ...f.transport, id: "effect", ownerKind: "candidate", ownerId: "candidate" };
  const partial: CandidateTransportRecord = { ...transport, revision: 1, status: "partial", diagnostic: "Generated lost original terminal receipt." };
  const events = [f.recorded(transport, 1), f.recorded(partial, 2)];
  assert.equal(candidateTransportUnsettled(events, ["candidate"]), true);
  assert.equal(candidateTransportUnsettled(events, ["unrelated-candidate"]), false);
  const observed: CandidateTransportRecord = { ...partial, revision: 2, sequence: 1, terminalAcknowledged: true, cleanupConfirmed: true };
  assert.equal(candidateTransportUnsettled([...events, f.recorded(observed, 3)], ["candidate"]), false);
  assert.throws(() => candidateTransportUnsettled([...events, f.recorded({ ...observed, status: "completed", resultDigest: hash, diagnostic: null }, 3)], ["candidate"]), { code: "candidate_transport_corrupt" });
});
