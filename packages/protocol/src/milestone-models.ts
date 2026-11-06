import { isRecord } from "./core.ts";
import type { StoredEvent } from "./index.ts";

const pooledOptions = (value: unknown): boolean => isRecord(value) && value.modelId === "kupo" &&
  isRecord(value.modelOptions) && Object.keys(value.modelOptions).length > 0;
const runtimeEndpoints = (value: unknown): boolean => Array.isArray(value) && value.some((endpoint: unknown) =>
  isRecord(endpoint) && (Object.hasOwn(endpoint, "runtime") || Array.isArray(endpoint.models) &&
    endpoint.models.some((model: unknown) => isRecord(model) && Object.hasOwn(model, "requirements"))));

export function hasMilestoneModelHistory(events: readonly StoredEvent[]): boolean {
  return events.some((event) => {
    if (event.event_type === "model.runtime_executable_reviewed" || event.event_type === "model.runtime_review_consumed") return true;
    if (event.event_type === "session.created" || event.event_type === "session.configured" ||
      event.event_type === "turn.started" || event.event_type === "turn.control_started") return pooledOptions(event.payload.controls);
    if (event.event_type === "model.selection_remembered") {
      return event.payload.selection?.modelId === "kupo" && event.payload.selection.thinkingEffort !== undefined;
    }
    if (event.event_type === "global.controls_changed") return pooledOptions(event.payload.values);
    if (event.event_type === "project.configured") return pooledOptions(event.payload.configuration.values?.defaults);
    if (event.event_type === "settings.updated") {
      const settings = event.payload.settings;
      return runtimeEndpoints(settings.localModels) || runtimeEndpoints(settings.remote?.models) ||
        pooledOptions(settings.startup?.global) || pooledOptions(settings.startup?.profile);
    }
    return false;
  });
}

export function hasMilestoneCandidateHistory(events: readonly StoredEvent[]): boolean {
  return events.some((event) => {
    if (event.event_type === "candidate.saved") return event.payload.candidate.source.env !== "Local" || event.payload.candidate.stage.env !== "Local";
    if (event.event_type === "compound.recorded") return event.payload.workflow.env !== "Local";
    return event.event_type === "candidate.workspace_recorded" || event.event_type === "candidate.transport_recorded";
  });
}
