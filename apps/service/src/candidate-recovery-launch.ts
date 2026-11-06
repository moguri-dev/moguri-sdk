import { Type } from "typebox";
import { isRecord, MoguriError, parse } from "../../../packages/protocol/src/core.ts";
import { RemoteIdentitySchema } from "../../../packages/protocol/src/execution.ts";
import { SandboxConfigurationSchema } from "../../../packages/protocol/src/sandbox.ts";
import type { CandidateTransportRecord } from "../../../packages/protocol/src/candidate-workspaces.ts";
import { frameDigest } from "./worker-wire.ts";
import type { CandidateLaunch } from "./candidate-transports.ts";

const id = Type.String({ minLength: 1, maxLength: 128 }), path = Type.String({ minLength: 1, maxLength: 4096 });
const hash = Type.String({ pattern: "^[a-f0-9]{64}$" }), maybeId = Type.Union([id, Type.Null()]), maybePath = Type.Union([path, Type.Null()]);
const initial = {
  id, sessionId: id, projectId: maybeId, turnId: id, workerDigest: hash, configDigest: hash, createdAt: Type.String(),
  status: Type.Literal("launching"), cancellation: Type.Literal("none"), cleanup: Type.Literal("pending"),
  diagnostic: Type.Null(), lastSequence: Type.Literal(0), workerPid: Type.Null(),
};
const remote = Type.Object({ kind: Type.Literal("Remote"), execution: Type.Object({ ...initial, target: RemoteIdentitySchema, workspace: path }, { additionalProperties: false }) }, { additionalProperties: false });
const directory = Type.Object({ device: Type.String({ pattern: "^[0-9]+$" }), inode: Type.String({ pattern: "^[0-9]+$" }) }, { additionalProperties: false });
const native = Type.Object({ kind: Type.Literal("Sandbox"), execution: Type.Object({
  ...initial, profileId: id, workspaceId: id, sourceWorkspaceId: maybeId, sourceRoot: maybePath, inputDigest: hash,
  stage: Type.Object({ profileId: id, sessionId: id, turnId: id, parent: path, directory: path, workspace: path, sourceDigest: hash,
    identity: directory, workspaceIdentity: directory }, { additionalProperties: false }),
  config: SandboxConfigurationSchema, image: path, root: path, launchName: id, command: Type.Array(path, { minItems: 1, maxItems: 8 }),
  createdAfter: Type.Number(), createdBefore: Type.Number(), nativeSessionId: Type.Null(), planDigest: Type.Null(), signerFingerprint: Type.Null(),
  cliExitCode: Type.Null(), resultDigest: Type.Null(), revision: Type.Literal(0),
}, { additionalProperties: false }) }, { additionalProperties: false });
export type CandidateStandaloneLaunch = Exclude<CandidateLaunch, { kind: "attached" }>;
export function candidateRecoveryLaunch(record: CandidateTransportRecord): CandidateStandaloneLaunch {
  const invalid = (): never => { throw new MoguriError("candidate_reconcile_binding", "Original standalone candidate launch/root/peer/build no longer matches retained ownership. No current target, Local mapping, key or replacement worker was adopted.", 409); };
  let raw: unknown;
  try { raw = JSON.parse(record.launchJson); } catch { return invalid(); }
  if (!isRecord(raw) || !isRecord(raw.execution)) return invalid();
  if (raw.kind === "attached") throw new MoguriError("candidate_reconcile_parent", "This operation belongs to its exact public compound parent, not a standalone worker. Inspect/recover that original parent; no new candidate or paid role was started.", 409);
  if (raw.kind === "Remote" && record.boundary.env === "Remote") {
    if (!isRecord(raw.execution.target)) return invalid();
    const originalTarget = raw.execution.target;
    const target = Object.fromEntries(Object.keys(RemoteIdentitySchema.properties).map((key) => [key, originalTarget[key]]));
    const launch = parse(remote, { ...raw, execution: { ...raw.execution, target } });
    if (launch.execution.id !== record.id || launch.execution.turnId !== record.id || launch.execution.sessionId !== record.sessionId ||
      launch.execution.projectId !== record.projectId || launch.execution.workspace !== record.boundary.sourceRoot ||
      launch.execution.workerDigest !== record.boundary.workerDigest || launch.execution.configDigest !== record.boundary.configurationDigest ||
      frameDigest({ hostKey: launch.execution.target.hostKey }) !== record.boundary.peerDigest) return invalid();
    return launch;
  }
  if (raw.kind === "Sandbox" && record.boundary.env === "Sandbox") {
    const launch = parse(native, raw), execution = launch.execution;
    if (execution.id !== record.id || execution.turnId !== record.id || execution.sessionId !== record.sessionId || execution.profileId !== record.profileId ||
      execution.projectId !== record.projectId || execution.root !== record.boundary.sourceRoot || execution.workerDigest !== record.boundary.workerDigest ||
      execution.configDigest !== record.boundary.configurationDigest || execution.workspaceId !== record.boundary.workspaceId ||
      execution.inputDigest !== record.boundary.inputDigest || execution.stage.profileId !== record.profileId || execution.stage.sessionId !== record.sessionId ||
      !execution.config.qualification || execution.config.qualification.workerDigest !== record.boundary.workerDigest) return invalid();
    return launch;
  }
  return invalid();
}
