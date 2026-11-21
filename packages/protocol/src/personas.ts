import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";
import { MoguriError } from "./core.ts";
import { ControlsSchema } from "./controls.ts";
import { SessionBudgetSchema } from "./budgets.ts";

/** Protocol 119 store marker for continuous, taggable agent personas (#10, D67). */
export const PERSONAS_SCHEMA = "personas_schema";
export const PERSONA_LIMIT = 50;
/** At most this many personas start from one message; further mentions are reported, never started. */
export const PERSONA_MENTION_LIMIT = 8;
export const PERSONA_INSTRUCTIONS_MAX = 4000;
/** The delegated task (brief plus the tagged message) shares the existing 8 KB coordination task bound. */
export const PERSONA_TASK_MAX_BYTES = 8000;
export const PERSONA_SNAPSHOT_RUNS = 100;
/** Handles that read like broadcast or product names never become personas. */
export const RESERVED_PERSONA_HANDLES: ReadonlySet<string> = new Set(["all", "here", "everyone", "channel", "moguri", "kupo", "user", "me", "you", "team", "orchestrator"]);

const object = <T extends Record<string, TSchema>>(properties: T) => Type.Object(properties, { additionalProperties: false });
const id = Type.String({ minLength: 1, maxLength: 128 });
const hash = Type.String({ pattern: "^[a-f0-9]{64}$" });
const revision = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const timestamp = Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$" });
const diagnostic = Type.Union([Type.String({ minLength: 1, maxLength: 4000 }), Type.Null()]);
export const PersonaHandleSchema = Type.String({ pattern: "^[a-z][a-z0-9-]{0,30}[a-z0-9]$" });
export const PersonaPresetSchema = Type.Union([Type.Literal("product-manager"), Type.Literal("maintenance"), Type.Literal("docs")]);
export type PersonaPreset = Static<typeof PersonaPresetSchema>;
export const PersonaDefinitionSchema = object({
  handle: PersonaHandleSchema,
  name: Type.String({ minLength: 1, maxLength: 80 }),
  description: Type.String({ maxLength: 500 }),
  /** The persona's own prompt, sent with every delegated task. */
  instructions: Type.String({ minLength: 1, maxLength: PERSONA_INSTRUCTIONS_MAX }),
  /** Scope: one project, or null for every project and project-free chat of this profile. */
  projectId: Type.Union([id, Type.Null()]),
  /** A fixed model, or null for the tagging chat's model. Never substituted when unavailable. */
  modelId: Type.Union([Type.String({ minLength: 1, maxLength: 256 }), Type.Null()]),
  /** Tools: a read-only (question-only) child or a writable agent child; both start under Manual autonomy. */
  access: Type.Union([Type.Literal("read-only"), Type.Literal("agent")]),
  /** Skills the persona is told to load when relevant. Guidance only; skill policy and approvals are unchanged. */
  skills: Type.Array(Type.String({ minLength: 1, maxLength: 128, pattern: "^[^\\u0000-\\u001f]+$" }), { maxItems: 20, uniqueItems: true }),
  /** A per-run cap combined with the tagging chat's budget; the stricter limit wins. Null keeps the chat's budget. */
  budget: Type.Union([SessionBudgetSchema, Type.Null()]),
  /** Stop condition: the run's chat is stopped when it is still working after this many minutes. */
  timeoutMinutes: Type.Integer({ minimum: 1, maximum: 1440 }),
  /** `report` asks for a structured report; both return the persona's reply to the orchestrating chat. */
  output: Type.Union([Type.Literal("reply"), Type.Literal("report")]),
  /** Trigger: start when an enabled persona is tagged with its @handle. Schedules use an automation that tags it. */
  mention: Type.Boolean(),
});
export type PersonaDefinition = Static<typeof PersonaDefinitionSchema>;
export const PersonaStatusSchema = Type.Union([Type.Literal("disabled"), Type.Literal("enabled"), Type.Literal("paused"), Type.Literal("deleted")]);
export type PersonaStatus = Static<typeof PersonaStatusSchema>;
export const PersonaSchema = object({
  version: Type.Literal(1), id, revision, profileId: id, preset: Type.Union([PersonaPresetSchema, Type.Null()]),
  ...PersonaDefinitionSchema.properties,
  status: PersonaStatusSchema,
  /** The actual-user command behind this revision. Mentions, models and timers never author one. */
  commandId: id, commandDigest: hash,
  createdAt: timestamp, updatedAt: timestamp,
});
export type Persona = Static<typeof PersonaSchema>;
export const PersonaRunStatusSchema = Type.Union([
  Type.Literal("starting"), Type.Literal("running"), Type.Literal("completed"), Type.Literal("failed"),
  Type.Literal("stopped"), Type.Literal("partial"), Type.Literal("blocked"),
]);
export type PersonaRunStatus = Static<typeof PersonaRunStatusSchema>;
export const PersonaRunSchema = object({
  version: Type.Literal(1), id, revision, profileId: id, personaId: id, personaRevision: revision,
  handle: PersonaHandleSchema, name: PersonaDefinitionSchema.properties.name,
  trigger: Type.Union([Type.Literal("mention"), Type.Literal("automation")]),
  /** The exact tagged input: who wrote it, in which chat and turn. */
  source: object({
    sessionId: id, turnId: id, itemId: id, actor: Type.Union([Type.Literal("user"), Type.Literal("automation")]),
    automationRunId: Type.Union([id, Type.Null()]),
  }),
  projectId: Type.Union([id, Type.Null()]),
  /** The linked subsession doing the persona's work; null until it was created. */
  childSessionId: Type.Union([id, Type.Null()]),
  /** The exact delegated task item queued in the child; the run follows only this item and the turn it starts. */
  childItemId: Type.Union([id, Type.Null()]),
  /** The child's turn running the delegated task; null while the task is still queued or held. */
  childTurnId: Type.Union([id, Type.Null()]),
  /** A requested stop and why. The run's outcome still comes from the turn's actual settlement. */
  stopRequested: Type.Union([Type.Literal("user"), Type.Literal("timeout"), Type.Literal("deleted"), Type.Null()]),
  controls: Type.Union([ControlsSchema, Type.Null()]),
  deadlineAt: Type.Union([timestamp, Type.Null()]),
  status: PersonaRunStatusSchema,
  createdAt: timestamp, updatedAt: timestamp, diagnostic,
});
export type PersonaRun = Static<typeof PersonaRunSchema>;
export interface PersonaEventPayloads {
  "persona.recorded": { persona: Persona };
  "persona.run_recorded": { run: PersonaRun };
}
export const personaEventTypes = ["persona.recorded", "persona.run_recorded"] as const;
export const PersonaCommandSchema = Type.Union([
  object({ type: Type.Literal("persona.create"), definition: PersonaDefinitionSchema, preset: Type.Optional(PersonaPresetSchema) }),
  object({ type: Type.Literal("persona.update"), personaId: id, expectedRevision: revision, definition: PersonaDefinitionSchema }),
  object({ type: Type.Literal("persona.enable"), personaId: id, expectedRevision: revision }),
  object({ type: Type.Literal("persona.pause"), personaId: id, expectedRevision: revision }),
  object({ type: Type.Literal("persona.delete"), personaId: id, expectedRevision: revision, stopRunning: Type.Optional(Type.Literal(true)) }),
  object({ type: Type.Literal("persona.run.stop"), runId: id }),
]);
export type PersonaCommand = Static<typeof PersonaCommandSchema>;
export const isPersonaCommand = (command: { type: string }): command is PersonaCommand => command.type.startsWith("persona.");
export const activePersonaRun = (run: Pick<PersonaRun, "status">) => run.status === "starting" || run.status === "running";

const corrupt = (): never => { throw new MoguriError("persona_corrupt", "A persona or persona run lost its exact owner, revision or lifecycle. State was preserved; no work was replayed.", 409); };
const validTime = (at: string) => Number.isFinite(Date.parse(at)) && new Date(at).toISOString() === at;
const immutablePersona = ["id", "profileId", "preset", "createdAt"] as const;
export function projectPersona(previous: Persona | undefined, value: unknown): Persona {
  if (!Value.Check(PersonaSchema, value)) return corrupt();
  const next = value;
  if (next.revision !== (previous?.revision ?? -1) + 1 || !validTime(next.createdAt) || !validTime(next.updatedAt) ||
    RESERVED_PERSONA_HANDLES.has(next.handle) || !previous && next.status !== "disabled" || previous?.status === "deleted" ||
    previous && (immutablePersona.some((key) => previous[key] !== next[key]) || next.updatedAt < previous.updatedAt)) return corrupt();
  return structuredClone(next);
}
const runTransitions: Record<PersonaRunStatus, PersonaRunStatus[]> = {
  starting: ["running", "blocked", "stopped"], running: ["running", "completed", "failed", "stopped", "partial"],
  completed: [], failed: [], stopped: [], partial: [], blocked: [],
};
const immutableRun = ["id", "profileId", "personaId", "personaRevision", "handle", "name", "trigger", "source", "projectId", "createdAt"] as const;
export function projectPersonaRun(previous: PersonaRun | undefined, value: unknown): PersonaRun {
  if (!Value.Check(PersonaRunSchema, value)) return corrupt();
  const next = value;
  if (next.revision !== (previous?.revision ?? -1) + 1 || !validTime(next.createdAt) || !validTime(next.updatedAt) ||
    next.deadlineAt !== null && !validTime(next.deadlineAt) || (next.trigger === "automation") !== (next.source.actor === "automation") ||
    (next.source.actor === "automation") !== (next.source.automationRunId !== null) ||
    next.status === "running" && (!next.childSessionId || !next.childItemId || !next.controls || !next.deadlineAt) ||
    next.status === "starting" && (next.childSessionId !== null || next.childItemId !== null || next.childTurnId !== null) ||
    (next.childTurnId !== null || next.childItemId !== null) && !next.childSessionId ||
    !activePersonaRun(next) && next.status !== "completed" && !next.diagnostic ||
    (!previous ? next.status !== "starting" :
      !runTransitions[previous.status].includes(next.status) || immutableRun.some((key) => JSON.stringify(previous[key]) !== JSON.stringify(next[key])) ||
      (["childSessionId", "childItemId", "childTurnId", "stopRequested"] as const).some((key) => previous[key] !== null && previous[key] !== next[key]) ||
      next.updatedAt < previous.updatedAt)) return corrupt();
  return structuredClone(next);
}
/** The latest runs for the snapshot, always including every active run. */
export function recentPersonaRuns(runs: PersonaRun[]): PersonaRun[] {
  return [...runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
    .filter((run, index) => index < PERSONA_SNAPSHOT_RUNS || activePersonaRun(run));
}

/** Rejects definitions that cannot be recorded, without inventing a replacement. */
export function validatePersonaDefinition(definition: PersonaDefinition): PersonaDefinition {
  if (!Value.Check(PersonaDefinitionSchema, definition)) throw new MoguriError("persona_definition", "Give the persona a handle, a name, instructions up to 4,000 characters, a timeout and an output.");
  if (RESERVED_PERSONA_HANDLES.has(definition.handle)) throw new MoguriError("persona_handle", `@${definition.handle} is reserved. Choose another handle.`);
  if (!definition.name.trim() || !definition.instructions.trim()) throw new MoguriError("persona_definition", "The persona needs a name and instructions.");
  if (definition.budget?.kind === "limited" && definition.budget.tokens === undefined && definition.budget.usd === undefined) {
    throw new MoguriError("persona_budget", "A limited persona budget needs a token or USD cap. Use null to keep the chat's budget.");
  }
  if (definition.budget?.kind === "limited" && definition.budget.basis !== "estimate") {
    throw new MoguriError("persona_budget", "A limited persona budget counts estimated usage, like any session cap. Accept estimate-based accounting (basis: estimate); no exact billing cap is claimed.");
  }
  return { ...structuredClone(definition), name: definition.name.trim() };
}
/** The stricter of two session budgets: an unlimited side never loosens the other. */
export function stricterBudget(a: Static<typeof SessionBudgetSchema>, b: Static<typeof SessionBudgetSchema> | null): Static<typeof SessionBudgetSchema> {
  if (!b || b.kind === "unlimited") return structuredClone(a);
  if (a.kind === "unlimited") return structuredClone(b);
  const min = (x: number | undefined, y: number | undefined) => x === undefined ? y : y === undefined ? x : Math.min(x, y);
  const tokens = min(a.tokens, b.tokens), usd = min(a.usd, b.usd);
  return { kind: "limited", ...(tokens !== undefined ? { tokens } : {}), ...(usd !== undefined ? { usd } : {}), ...(a.basis || b.basis ? { basis: "estimate" as const } : {}) };
}

const stripCode = (text: string) => text.replace(/```[\s\S]*?(?:```|$)/g, " ").replace(/`[^`\n]*`/g, " ");
/**
 * The distinct `@handle` tokens in a message, in order, outside code. A mention is only a request to start an
 * enabled persona; it grants no permission. Emails and paths (`a@b`, `x/@y`) are not mentions.
 */
export function personaMentions(text: string): string[] {
  const handles: string[] = [];
  for (const match of stripCode(text).matchAll(/(^|[^A-Za-z0-9_.@/\\-])@([A-Za-z][A-Za-z0-9-]{0,30}[A-Za-z0-9])(?![A-Za-z0-9_@/\\-]|\.[A-Za-z0-9])/g)) {
    const handle = match[2]!.toLowerCase();
    if (!handles.includes(handle)) handles.push(handle);
  }
  return handles;
}
/** The delegated task a persona's subsession receives: its own brief followed by the exact tagged text. */
export function personaTask(persona: Pick<Persona, "handle" | "name" | "instructions" | "skills" | "output" | "access">, source: { title: string; text: string; actor: "user" | "automation" }): string {
  const lines = [
    `You are @${persona.handle} (${persona.name}), a persona the ${source.actor === "user" ? "user" : "user's automation"} tagged in the chat "${source.title}". You work in this linked subsession; the tagging chat orchestrates and receives your final reply.`,
    persona.instructions.trim(),
    persona.skills.length ? `Load these skills when they are relevant: ${persona.skills.join(", ")}.` : "",
    persona.access === "read-only" ? "You are read-only here: investigate and recommend; do not edit files or run commands that change anything." : "",
    persona.output === "report" ? "Finish with a short report: Summary, Findings, Recommended next steps." : "Finish with a concise reply for the orchestrating chat.",
    "Being tagged grants no permission: tool approvals, hard policy and budgets apply as usual. Ask before installing analytics, sending project data to external services, pushing or merging.",
    "Tagged message:",
    source.text,
  ];
  return lines.filter(Boolean).join("\n\n");
}

export const personaPresets: Record<PersonaPreset, PersonaDefinition> = {
  "product-manager": {
    handle: "product-manager", name: "Product Manager", description: "Product research, requirements and measurement plans.",
    instructions: "Clarify the user problem, the target users and the success measures. Research the existing product and repository read-only, list assumptions and open questions, and propose scoped requirements with acceptance criteria. Propose measurement plans instead of installing analytics or sending data anywhere; any such step needs the user's explicit approval.",
    projectId: null, modelId: null, access: "read-only", skills: [], budget: null, timeoutMinutes: 30, output: "report", mention: true,
  },
  maintenance: {
    handle: "maintenance", name: "Maintenance", description: "Dependency and repository maintenance.",
    instructions: "Keep the repository healthy: review dependency update PRs and advisories, outdated or vulnerable packages, failing checks and small maintenance chores. Prefer the smallest safe change, explain risk (breaking changes, security fixes), and run the project's own build and tests. Never merge, rebase shared branches or push without the user's explicit approval.",
    projectId: null, modelId: null, access: "agent", skills: [], budget: null, timeoutMinutes: 60, output: "report", mention: true,
  },
  docs: {
    handle: "docs", name: "Docs", description: "Documentation that matches the code.",
    instructions: "Keep documentation accurate and concise: find docs affected by the request, update READMEs, guides and reference pages to match the actual code, and flag claims you cannot verify. Do not invent features or roadmap items.",
    projectId: null, modelId: null, access: "agent", skills: [], budget: null, timeoutMinutes: 60, output: "reply", mention: true,
  },
};
