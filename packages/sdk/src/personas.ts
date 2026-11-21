import { ClientError } from "../../client/src/index.ts";
import {
  activePersonaRun, personaPresets, type Persona, type PersonaDefinition, type PersonaPreset, type PersonaRun, type SlashResult,
} from "../../protocol/src/index.ts";
import type { MoguriSdk } from "./index.ts";

/** Taggable personas (protocol 119, #10). Definitions start disabled; tagging an enabled one starts a linked subsession. */
export function createPersonasApi(sdk: MoguriSdk) {
  const list = () => sdk.getState().snapshot?.personas ?? [];
  const record = (id: string) => {
    const persona = list().find((value) => value.id === id || value.handle === id.replace(/^@/, ""));
    if (!persona) throw new ClientError("persona_missing", "Choose a persona of this profile by ID or @handle.");
    return persona;
  };
  return {
    list,
    runs: (personaId?: string) => (sdk.getState().snapshot?.personaRuns ?? []).filter((run) => personaId === undefined || run.personaId === personaId),
    presets: () => structuredClone(personaPresets),
    get: record,
    /** Always created disabled. */
    create: (definition: PersonaDefinition, preset?: PersonaPreset) => sdk.command({ type: "persona.create", definition, ...(preset ? { preset } : {}) }),
    createPreset: (preset: PersonaPreset, changes: Partial<PersonaDefinition> = {}) =>
      sdk.command({ type: "persona.create", definition: { ...structuredClone(personaPresets[preset]), ...changes }, preset }),
    update: (id: string, definition: PersonaDefinition, expectedRevision = record(id).revision) =>
      sdk.command({ type: "persona.update", personaId: record(id).id, expectedRevision, definition }),
    enable: (id: string, expectedRevision = record(id).revision) => sdk.command({ type: "persona.enable", personaId: record(id).id, expectedRevision }),
    pause: (id: string, expectedRevision = record(id).revision) => sdk.command({ type: "persona.pause", personaId: record(id).id, expectedRevision }),
    delete: (id: string, options: { stopRunning?: boolean; expectedRevision?: number } = {}) => sdk.command({ type: "persona.delete", personaId: record(id).id,
      expectedRevision: options.expectedRevision ?? record(id).revision, ...(options.stopRunning ? { stopRunning: true as const } : {}) }),
    stopRun: (runId: string) => sdk.command({ type: "persona.run.stop", runId }),
  };
}
export type PersonasApi = ReturnType<typeof createPersonasApi>;

const status = (persona: Persona) => persona.status === "enabled" ? "On" : persona.status === "paused" ? "Paused" : "Off";
export const personaRunLine = (run: PersonaRun) => `  ${run.id.slice(0, 8)} @${run.handle} ${run.status}${run.status === "running" && !run.childTurnId ? " (queued)" : ""}` +
  ` ${run.trigger === "automation" ? "from an automation" : "tagged"} in chat ${run.source.sessionId.slice(0, 8)}${run.childSessionId ? ` -> chat ${run.childSessionId.slice(0, 8)}` : ""}` +
  `${run.diagnostic ? ` - ${run.diagnostic}` : ""}`;
/** A readable list of personas and their recent runs, shared by the TUI and CLI. */
export function personasSummary(personas: Persona[], runs: PersonaRun[]): string {
  if (!personas.length) return "No personas. Add a preset with /personas add product-manager|maintenance|docs, then enable it. Personas start off.";
  return [...personas.map((persona) => [`@${persona.handle} ${persona.name} [${status(persona)}] ${persona.access}, ${persona.modelId ?? "chat's model"}, ` +
    `${persona.timeoutMinutes} min limit${persona.projectId ? `, project ${persona.projectId.slice(0, 8)}` : ", every project"}${persona.mention ? "" : ", mentions off"}`,
  ...runs.filter((run) => run.personaId === persona.id).slice(0, 3).map(personaRunLine)].join("\n")),
  "Tag an enabled persona with @handle in a message. Tagging grants no permission; its chat starts under Manual autonomy."].join("\n\n");
}
/** Shared `/personas` handling across desktop, TUI and CLI. */
export async function personasSlash(sdk: MoguriSdk, argument: string): Promise<SlashResult> {
  const [action = "list", target, flag, ...extra] = argument.trim().split(/\s+/).filter(Boolean);
  const usage = "Use /personas [list|runs|presets|add PRESET|enable @HANDLE|pause @HANDLE|delete @HANDLE [stop-running]|stop RUN_ID].";
  if (extra.length) throw new ClientError("persona_input", usage);
  if (action === "list" && !target) return { kind: "text", text: personasSummary(sdk.personas.list(), sdk.personas.runs()) };
  if (action === "runs" && !target) {
    const runs = sdk.personas.runs();
    return { kind: "text", text: runs.length ? runs.map(personaRunLine).join("\n") : "No persona runs yet." };
  }
  if (action === "presets" && !target) return { kind: "text", text: Object.entries(personaPresets).map(([name, preset]) =>
    `${name}: @${preset.handle} ${preset.name} (${preset.access}) - ${preset.description}`).join("\n") };
  if (action === "add" && target && !flag) {
    if (!(target in personaPresets)) throw new ClientError("persona_preset", "Choose product-manager, maintenance or docs.");
    await sdk.personas.createPreset(target as PersonaPreset);
    return { kind: "ok", message: `Added @${personaPresets[target as PersonaPreset].handle}. It is off; enable it with /personas enable @${personaPresets[target as PersonaPreset].handle}.` };
  }
  if (action === "stop" && target && !flag) {
    const run = sdk.personas.runs().filter(activePersonaRun).find((value) => value.id === target || value.id.startsWith(target));
    if (!run) throw new ClientError("persona_run_missing", "Give an active persona run ID or unique prefix from /personas runs.");
    await sdk.personas.stopRun(run.id);
    return { kind: "ok", message: `Stop requested for @${run.handle}'s run. Its outcome follows the task's actual settlement.` };
  }
  if (!target) throw new ClientError("persona_input", usage);
  const persona = sdk.personas.get(target);
  if (action === "enable" && !flag) { await sdk.personas.enable(persona.id); return { kind: "ok", message: `@${persona.handle} is on. Tag it with @${persona.handle} in a message.` }; }
  if (action === "pause" && !flag) { await sdk.personas.pause(persona.id); return { kind: "ok", message: `@${persona.handle} is paused. Active runs continue until they finish or you stop them.` }; }
  if (action === "delete" && (!flag || flag === "stop-running")) {
    await sdk.personas.delete(persona.id, { stopRunning: flag === "stop-running" });
    return { kind: "ok", message: `@${persona.handle} was deleted. Its run chats are kept.` };
  }
  throw new ClientError("persona_input", usage);
}
