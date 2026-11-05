import { MoguriError, parse } from "../../../packages/protocol/src/index.ts";
import {
  ModelReadinessTransportRequestSchema, type ModelReadinessTransportRequest, type ModelReadinessTransportResult,
} from "../../../packages/protocol/src/model-readiness-transport.ts";
import { collectModelReadiness, createExecutingNodeReadinessProbeSuite, ModelReadinessError } from "./model-readiness.ts";
import { assertModelReadinessBindingCurrent, captureModelReadinessBinding, modelReadinessRootDigest } from "./model-readiness-binding.ts";

export async function executeModelReadinessQuery(value: ModelReadinessTransportRequest, owner: {
  env: "Remote" | "Sandbox"; root: string | null; stateDir: string; peerDigest: string | null; executingModule: string;
}, signal: AbortSignal): Promise<ModelReadinessTransportResult> {
  const request = parse(ModelReadinessTransportRequestSchema, value);
  const storagePath = request.type === "model.readiness.binding" ? request.storagePath ?? owner.root ?? owner.stateDir : request.input.storagePath;
  const binding = await captureModelReadinessBinding(owner.root, storagePath, signal, owner.executingModule);
  if (request.type === "model.readiness.binding") return { type: request.type, binding };
  const target = request.input.target, rootDigest = modelReadinessRootDigest(binding);
  const current = () => {
    signal.throwIfAborted();
    if (JSON.stringify(binding) !== JSON.stringify(request.binding) || target.env !== owner.env ||
      target.rootDigest !== rootDigest || target.peerDigest !== owner.peerDigest || target.buildDigest !== binding.buildDigest) {
      throw new MoguriError("model_readiness_provenance", "Readiness does not belong to this exact executing peer, root and build. No controller report or fallback was used.", 409);
    }
    assertModelReadinessBindingCurrent(binding, signal);
  };
  current();
  const common = { rootDigest, buildDigest: binding.buildDigest, assertCurrent: current };
  const executingBoundary = () => {
    if (owner.env === "Remote") {
      if (owner.peerDigest === null) throw new MoguriError("model_readiness_provenance", "The pinned SSH readiness peer is missing. No machine was inferred.", 409);
      return { ...common, kind: "pinned-ssh-bridge" as const, env: "Remote" as const, peerDigest: owner.peerDigest };
    }
    return { ...common, kind: "active-sealed-native" as const, env: "Sandbox" as const, peerDigest: owner.peerDigest };
  };
  const probes = createExecutingNodeReadinessProbeSuite(target, executingBoundary());
  try {
    const readiness = await collectModelReadiness(request.input, { signal, probes,
      ...(request.executableReview ? { executableReview: request.executableReview } : {}), currentTarget: () => { current(); return target; } });
    current();
    const after = await captureModelReadinessBinding(owner.root, storagePath, signal, owner.executingModule);
    if (JSON.stringify(after) !== JSON.stringify(binding)) throw new MoguriError("model_readiness_stale", "The actual executing readiness root/build changed before delivery. No fresh report was published.", 409);
    return { type: request.type, readiness };
  } catch (error) {
    if (error instanceof ModelReadinessError) throw new MoguriError(error.code, error.message, 409);
    throw error;
  }
}
