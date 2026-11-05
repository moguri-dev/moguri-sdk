import { join } from "node:path";
import { MoguriError } from "../../../packages/protocol/src/core.ts";
import type { ParentMessage } from "./worker-protocol.ts";
import type { BridgeInfo, BridgeInit } from "./remote-protocol.ts";

export function assertCandidateBridgeStart(message: ParentMessage, init: BridgeInit, info: BridgeInfo): void {
  const operation = message.kind === "start" ? message.operation : message.kind === "candidate.start" ? message.operation : undefined;
  if (operation?.kind !== "candidate.operation") return;
  const { scope } = operation;
  if (scope.env !== (info.native ? "Sandbox" : "Remote") || scope.boundary.env !== scope.env ||
    scope.boundary.workerDigest !== info.workerDigest || scope.boundary.sourceRoot !== info.root ||
    scope.stateRoot !== (info.native ? join(info.root!, ".moguri") : init.stateDir) ||
    message.kind === "start" && operation.operationId !== init.runId) {
    throw new MoguriError("candidate_transport", "Candidate work lost its authenticated original worker/root/state boundary. No arbitrary worktree was adopted or effect dispatched.", 409);
  }
}
