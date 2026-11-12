import { lstat, realpath } from "node:fs/promises";
import { join, relative } from "node:path";
import { MoguriError } from "../../../packages/protocol/src/core.ts";
import type { CandidateNativeRootGrant } from "../../../packages/protocol/src/candidate-workspaces.ts";
import type { CandidateWorkerOperation } from "./candidate-worker-protocol.ts";
import { candidateStagePath } from "./candidate-worker.ts";
import { inspectNativeStage, type NativeStage } from "./native-staging.ts";
import type { SourceRoot } from "./repository-source.ts";

export async function nativeCandidateRootGrant(stage: NativeStage, operation: CandidateWorkerOperation, guest: SourceRoot): Promise<CandidateNativeRootGrant> {
  const fail = (): never => { throw new MoguriError("candidate_native_identity", "The exact owned host-private root or versioned namespace changed. No VM inode, live checkout or replacement directory was adopted.", 409); };
  const scope = operation.scope;
  if (scope.env !== "Sandbox" || scope.nativeRootVersion !== 3 || scope.profileId !== stage.profileId ||
    scope.sessionId !== stage.sessionId || scope.boundary.env !== "Sandbox" || scope.boundary.sourceRoot !== "/workspace" ||
    scope.stateRoot !== "/workspace/.moguri") return fail();
  await inspectNativeStage(stage);
  const expected = operation.action === "source" ? null : guest.root === "/workspace" ? operation.source :
    operation.action === "create" ? null : operation.stage;
  const allowedStage = operation.action === "source" ? null : operation.action === "create" ?
    candidateStagePath(scope, operation.workspaceId) : operation.stage.root;
  if (guest.root !== "/workspace" && guest.root !== allowedStage) return fail();
  if (expected && (expected.env !== "Sandbox" || expected.version !== 3 || expected.identityNamespace !== "controller-private-stage" ||
    expected.root !== guest.root || JSON.stringify(expected.boundary) !== JSON.stringify(scope.boundary))) return fail();
  const parts = guest.root === "/workspace" ? [] : guest.root.slice("/workspace/".length).split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || part.includes("\\") || part.includes("\0"))) return fail();
  let path = stage.workspace, metadata = await lstat(path, { bigint: true });
  for (const part of parts) {
    path = join(path, part); metadata = await lstat(path, { bigint: true });
    if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.uid !== BigInt(process.getuid?.() ?? -1) ||
      metadata.mode & 0o077n || await realpath(path) !== path) return fail();
  }
  if (relative(stage.workspace, path) !== parts.join("/")) return fail();
  const identity = { device: String(metadata.dev), inode: String(metadata.ino) };
  if (expected && (identity.device !== expected.device || identity.inode !== expected.inode)) return fail();
  await inspectNativeStage(stage);
  return { version: 1, root: guest.root, guest: { device: guest.device, inode: guest.inode }, private: identity };
}
