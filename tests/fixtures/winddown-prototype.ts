import { randomUUID } from "node:crypto";
import { normalizeContext } from "@earendil-works/pi-ai";
import { MoguriError, type EventInput, type Usage } from "../../packages/protocol/src/index.ts";
import type { ControlPlane } from "../../apps/service/src/controller.ts";
import type { PreparedModel } from "../../apps/service/src/provider.ts";
import { modelRequest } from "../../apps/service/src/model-controls.ts";
import { modelEndpointBoundary } from "../../apps/service/src/model-registry.ts";
import { routingTransport, type RoutingCall } from "./routing-prototype.ts";

type ProbeRole = "router" | "solver" | "critic" | "revision" | "checkpoint";
export interface WindDownRequest { systemPrompt: string; text: string; maxOutputTokens: number }

export function windDownBudgetProbe(control: ControlPlane, sessionId: string) {
  const turnId = randomUUID(), transport = routingTransport();
  const session = () => {
    const snapshot = control.snapshot(), current = snapshot.sessions.find((session) => session.id === sessionId);
    if (!current || current.controls.env !== "Local" || current.mode !== "agent" || !snapshot.policy.allowedEnvs.includes("Local")) throw new MoguriError("winddown_probe_scope", "The private probe requires its current explicitly Local writable session. No fallback or Git authority.");
    return current;
  };
  const append = (events: EventInput[]) => {
    const before = control.snapshot();
    control.store.commit(events, undefined, undefined, (primary) => control.platform.budgets.derived(before, primary));
    control.refreshProfile();
  };
  const specification = (prepared: PreparedModel, request: WindDownRequest) => {
    if (modelEndpointBoundary(prepared.auth.baseUrl ?? prepared.model.baseUrl) !== "loopback") throw new MoguriError("winddown_probe_endpoint", "This generated prerequisite can call only its explicit loopback endpoint.");
    const context = normalizeContext({ systemPrompt: request.systemPrompt, messages: [{ role: "user", content: request.text, timestamp: 0 }] });
    const spec = modelRequest(prepared.model, undefined, context);
    if (!Number.isSafeInteger(request.maxOutputTokens) || request.maxOutputTokens < 1 || request.maxOutputTokens > spec.maxTokens) throw new MoguriError("winddown_probe_bound", "The actual prepared request cannot support that explicit output bound.");
    return spec;
  };
  const reserve = (role: ProbeRole, modelId: string, prepared: PreparedModel, request: WindDownRequest) => {
    const current = session(), spec = specification(prepared, request);
    const reserved = control.platform.budgets.reserve(current, { stepId: randomUUID(), turnId, role, modelId,
      providerId: prepared.model.provider, apiModelId: prepared.model.id, inputEstimate: spec.estimatedTokens, maxOutputTokens: request.maxOutputTokens });
    if (reserved.maxTokens !== request.maxOutputTokens) throw new MoguriError("winddown_probe_capacity", "The complete planned wind-down bound cannot be reserved. No partial envelope or normal call was admitted.");
    if (reserved.event.event_type !== "budget.recorded") throw new Error("Generated reservation returned no canonical accounting entry.");
    append([reserved.event]); return reserved.event.payload.entry.id;
  };
  const invoke = async (stepId: string, prepared: PreparedModel, request: WindDownRequest, signal: AbortSignal) => {
    signal.throwIfAborted(); const current = session(), spec = specification(prepared, request);
    const entry = control.snapshot().budgetEntries.find((entry) => entry.id === stepId);
    if (!entry || entry.turnId === null) throw new MoguriError("winddown_probe_reservation", "Choose this exact generated role's original reservation.");
    const role = entry.role, owningTurn = entry.turnId;
    if (role !== "router" && role !== "solver" && role !== "critic" && role !== "revision" && role !== "checkpoint") throw new MoguriError("winddown_probe_role", "That role has no generated transport.");
    const output = control.platform.budgets.reservedOutput(current, { stepId, turnId: owningTurn, role, modelId: entry.modelId, providerId: prepared.model.provider, apiModelId: prepared.model.id,
      inputEstimate: spec.estimatedTokens, maxOutputTokens: request.maxOutputTokens });
    if (role === "checkpoint" && control.snapshot().budgetEntries.some((other) => other.id !== stepId && other.turnId === entry.turnId && other.status !== "settled")) throw new MoguriError("winddown_probe_unsettled", "Normal work has unconfirmed usage. Its hold was preserved; no extra finishing model was dispatched.");
    signal.throwIfAborted();
    append([{ event_type: "model.started", profile_id: control.profileId, project_id: current.projectId ?? undefined, session_id: current.id, turn_id: owningTurn, step_id: stepId,
      payload: { modelId: entry.modelId, apiModelId: prepared.model.id, providerId: prepared.model.provider, role, source: "local", contextEstimate: spec.estimatedTokens, contextWindow: prepared.model.contextWindow } }]);
    const observations: RoutingCall[] = [];
    const completed = (call: RoutingCall, text: string, notice = false) => {
      if (call.requestMs === undefined || !Number.isFinite(call.requestMs) || call.requestMs < 0) throw new MoguriError("winddown_probe_time", "Actual request timing was not recorded. Its reservation remains held, not normalized to zero.");
      const total = call.reportedTokens, output = call.reportedOutputTokens;
      const known = total !== null && output !== null && output !== undefined;
      const usage: Usage = { stepId, modelId: entry.modelId, apiModelId: prepared.model.id, providerId: prepared.model.provider, source: "local", role,
        inputTokens: known ? total - output : null, outputTokens: output ?? null,
        cacheReadTokens: null, totalTokens: total, estimatedUsd: null, providerReportedUsd: null, billedUsd: null,
        requestMs: call.requestMs, quality: known ? "provider-reported" : "unknown", outcome: call.outcome };
      append([{ event_type: "model.completed", profile_id: control.profileId, project_id: current.projectId ?? undefined, session_id: current.id, turn_id: owningTurn, step_id: stepId,
        payload: { message: { id: stepId, turnId: owningTurn, role: notice ? "notice" : "assistant", text, timestamp: new Date().toISOString(), outcome: call.outcome },
          contextDigest: control.store.putBlob(JSON.stringify(request)), usage: control.platform.budgets.estimated(usage) } }]);
    };
    let result: Awaited<ReturnType<typeof transport>>;
    try {
      result = await transport({ role, modelId: entry.modelId, prepared, output, systemPrompt: request.systemPrompt, text: request.text, signal,
        record: async (call) => { observations.push(call); } });
    } catch (error) {
      if (observations[0]) completed(observations[0], "Generated private transport did not return a confirmed result. No output or user approval was invented.", true);
      throw error;
    }
    completed(result.call, result.text); return result;
  };
  return { reserve, invoke };
}
