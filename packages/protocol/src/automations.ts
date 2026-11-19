import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";
import { ControlDefaultsSchema, ControlsSchema } from "./controls.ts";
import { MoguriError } from "./core.ts";
import { ScriptInterpreterSchema } from "./script-reviews.ts";
import { scheduleLocalChoices, scheduleLocalTime, scheduledInstant } from "./scheduled-prompts.ts";

/** Protocol 113 store marker for recurring schedules and declarative workflows (#6, D49). */
export const AUTOMATIONS_SCHEMA = "automations_schema";
export const AUTOMATION_MAX_STEPS = 10;
export const AUTOMATION_PROMPT_MAX = 16_384;
export const AUTOMATION_MIN_INTERVAL_MINUTES = 15;
export const AUTOMATION_MAX_INTERVAL_MINUTES = 43_200;
/** Recent runs per automation exposed in the snapshot; every run stays in the durable history. */
export const AUTOMATION_SNAPSHOT_RUNS = 50;
/** Missed occurrences are counted up to this bound when coalescing into one run. */
export const AUTOMATION_MISSED_COUNT_LIMIT = 1000;
export const AUTOMATION_LIMIT = 200;

const object = <T extends Record<string, TSchema>>(properties: T) => Type.Object(properties, { additionalProperties: false });
const id = Type.String({ minLength: 1, maxLength: 128 });
const hash = Type.String({ pattern: "^[a-f0-9]{64}$" });
const revision = Type.Integer({ minimum: 0 });
const instant = Type.String({ minLength: 20, maxLength: 32 });
const timeZone = Type.String({ minLength: 1, maxLength: 128 });
const localTime = Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}$" });
const offsetMinutes = Type.Integer({ minimum: -840, maximum: 840 });
const wallTime = Type.String({ pattern: "^(?:[01]\\d|2[0-3]):[0-5]\\d$" });
const scriptText = Type.String({ minLength: 1, maxLength: 4096, pattern: "^[^\\u0000]*$" });

export const AutomationScheduleSchema = Type.Union([
  object({ kind: Type.Literal("once"), at: instant, timeZone, localTime, offsetMinutes }),
  object({ kind: Type.Literal("interval"), minutes: Type.Integer({ minimum: AUTOMATION_MIN_INTERVAL_MINUTES, maximum: AUTOMATION_MAX_INTERVAL_MINUTES }), timeZone }),
  object({ kind: Type.Literal("daily"), time: wallTime, timeZone }),
  object({ kind: Type.Literal("weekly"), days: Type.Array(Type.Integer({ minimum: 0, maximum: 6 }), { minItems: 1, maxItems: 7, uniqueItems: true }), time: wallTime, timeZone }),
]);
export type AutomationSchedule = Static<typeof AutomationScheduleSchema>;
export const AutomationStepSchema = Type.Union([
  object({ kind: Type.Literal("prompt"), text: Type.String({ minLength: 1, maxLength: AUTOMATION_PROMPT_MAX }) }),
  object({ kind: Type.Literal("script"), path: scriptText, interpreter: ScriptInterpreterSchema,
    args: Type.Optional(Type.Array(Type.String({ maxLength: 4096, pattern: "^[^\\u0000]*$" }), { maxItems: 30 })) }),
]);
export type AutomationStep = Static<typeof AutomationStepSchema>;
export const AutomationDefinitionSchema = object({
  name: Type.String({ minLength: 1, maxLength: 120 }),
  schedule: AutomationScheduleSchema,
  steps: Type.Array(AutomationStepSchema, { minItems: 1, maxItems: AUTOMATION_MAX_STEPS }),
});
export type AutomationDefinition = Static<typeof AutomationDefinitionSchema>;
export const AutomationStatusSchema = Type.Union([Type.Literal("active"), Type.Literal("paused"), Type.Literal("deleted")]);
export const AutomationSchema = object({
  id, revision, profileId: id, projectId: id,
  name: AutomationDefinitionSchema.properties.name, schedule: AutomationScheduleSchema, steps: AutomationDefinitionSchema.properties.steps,
  controls: ControlsSchema, status: AutomationStatusSchema,
  /** Interval schedules count from this instant, set by each explicit activation or edit. */
  anchorAt: Type.Union([instant, Type.Null()]),
  nextAt: Type.Union([instant, Type.Null()]),
  createdAt: instant, updatedAt: instant,
  /** The actual-user command behind this revision; timers never author one. */
  commandId: id, commandDigest: hash,
  diagnostic: Type.Union([Type.String({ maxLength: 4096 }), Type.Null()]),
});
export type Automation = Static<typeof AutomationSchema>;
export const AutomationStepStatusSchema = Type.Union([
  Type.Literal("pending"), Type.Literal("queued"), Type.Literal("running"), Type.Literal("completed"), Type.Literal("failed"),
  Type.Literal("stopped"), Type.Literal("partial"), Type.Literal("skipped"), Type.Literal("blocked"),
]);
export type AutomationStepStatus = Static<typeof AutomationStepStatusSchema>;
export const AutomationStepStateSchema = object({ status: AutomationStepStatusSchema, itemId: Type.Union([id, Type.Null()]), turnId: Type.Union([id, Type.Null()]) });
export type AutomationStepState = Static<typeof AutomationStepStateSchema>;
export const AutomationRunStatusSchema = Type.Union([
  Type.Literal("starting"), Type.Literal("running"), Type.Literal("completed"), Type.Literal("failed"), Type.Literal("stopped"),
  Type.Literal("partial"), Type.Literal("skipped"), Type.Literal("blocked"),
]);
export type AutomationRunStatus = Static<typeof AutomationRunStatusSchema>;
export const AutomationRunSchema = object({
  id, revision, profileId: id, projectId: id, automationId: id, automationRevision: revision,
  name: AutomationDefinitionSchema.properties.name,
  trigger: Type.Union([Type.Literal("schedule"), Type.Literal("manual")]),
  occurrenceAt: instant, timeZone, localTime, offsetMinutes,
  /** Earlier occurrences coalesced into this run after sleep or restart. */
  missed: Type.Integer({ minimum: 0, maximum: AUTOMATION_MISSED_COUNT_LIMIT }),
  controls: ControlsSchema, steps: AutomationDefinitionSchema.properties.steps,
  progress: Type.Array(AutomationStepStateSchema, { minItems: 1, maxItems: AUTOMATION_MAX_STEPS }),
  step: Type.Integer({ minimum: 0, maximum: AUTOMATION_MAX_STEPS }),
  status: AutomationRunStatusSchema, sessionId: Type.Union([id, Type.Null()]),
  commandId: id, createdAt: instant, updatedAt: instant,
  diagnostic: Type.Union([Type.String({ maxLength: 4096 }), Type.Null()]),
});
export type AutomationRun = Static<typeof AutomationRunSchema>;
export const AutomationItemSchema = object({ automationId: id, runId: id, step: Type.Integer({ minimum: 0, maximum: AUTOMATION_MAX_STEPS - 1 }) });
export type AutomationItem = Static<typeof AutomationItemSchema>;

export const AutomationCommandSchema = Type.Union([
  object({ type: Type.Literal("automation.create"), projectId: id, definition: AutomationDefinitionSchema,
    controls: Type.Optional(ControlDefaultsSchema), enabled: Type.Boolean() }),
  object({ type: Type.Literal("automation.update"), automationId: id, expectedRevision: revision, definition: AutomationDefinitionSchema,
    controls: Type.Optional(ControlDefaultsSchema) }),
  object({ type: Type.Literal("automation.enable"), automationId: id, expectedRevision: revision }),
  object({ type: Type.Literal("automation.pause"), automationId: id, expectedRevision: revision }),
  object({ type: Type.Literal("automation.delete"), automationId: id, expectedRevision: revision, stopRunning: Type.Optional(Type.Literal(true)) }),
  object({ type: Type.Literal("automation.run_now"), automationId: id, expectedRevision: revision }),
  object({ type: Type.Literal("automation.stop_run"), runId: id }),
]);
export type AutomationCommand = Static<typeof AutomationCommandSchema>;
export const isAutomationCommand = (command: { type: string }): command is AutomationCommand => command.type.startsWith("automation.");
export interface AutomationEventPayloads {
  "automation.recorded": { automation: Automation };
  "automation.run_recorded": { run: AutomationRun };
}
export const automationEventTypes = ["automation.recorded", "automation.run_recorded"] as const;

/** The latest runs per automation for the snapshot, always including every active run. */
export function recentAutomationRuns(runs: AutomationRun[]): AutomationRun[] {
  const groups = new Map<string, AutomationRun[]>();
  for (const run of runs) groups.set(run.automationId, [...groups.get(run.automationId) ?? [], run]);
  return [...groups.values()].flatMap((group) => group.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id.localeCompare(a.id))
    .filter((run, index) => index < AUTOMATION_SNAPSHOT_RUNS || activeAutomationRun(run)));
}
export const activeAutomationRun = (run: Pick<AutomationRun, "status">) => run.status === "starting" || run.status === "running";
export const terminalAutomationRun = (run: Pick<AutomationRun, "status">) => !activeAutomationRun(run);

/** A definition whose steps include a script must run Local: repository trust never extends to Sandbox or Remote. */
export function validateAutomation(definition: AutomationDefinition, env: "Local" | "Sandbox" | "Remote"): void {
  if (!Value.Check(AutomationDefinitionSchema, definition)) throw new MoguriError("automation_definition", "Give the automation a name, a schedule and 1 to 10 steps.");
  if (!definition.name.trim()) throw new MoguriError("automation_definition", "Give the automation a name.");
  for (const step of definition.steps) {
    if (step.kind === "prompt" && !step.text.trim()) throw new MoguriError("automation_definition", "Every prompt step needs text.");
    if (step.kind === "script" && env !== "Local") throw new MoguriError("automation_script_env", "Script steps run trusted repository scripts on this Mac, so the automation must use Local. Sandbox and Remote never inherit repository trust and nothing falls back to Local.", 409);
  }
  validateTimeZone(definition.schedule.timeZone);
  if (definition.schedule.kind === "once") scheduledInstant({ kind: "at", at: definition.schedule.at, timeZone: definition.schedule.timeZone,
    localTime: definition.schedule.localTime, offsetMinutes: definition.schedule.offsetMinutes }, Date.parse(definition.schedule.at) - 1);
}
function validateTimeZone(zone: string): void {
  try { new Intl.DateTimeFormat("en-US", { timeZone: zone }).format(0); }
  catch { throw new MoguriError("schedule_time", "Choose a valid IANA timezone. No replacement timezone was inferred."); }
}
const dayMs = 86_400_000;
const localDate = (at: number, zone: string) => scheduleLocalTime(at, zone).localTime.slice(0, 10);
const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * dayMs).toISOString().slice(0, 10);
const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();
/**
 * Resolves a wall-clock time in a zone. An ambiguous time (DST fall-back) resolves to its first occurrence;
 * a nonexistent time (DST spring-forward gap) runs once at the same wall time shifted forward by the gap.
 */
export function resolveWallTime(local: string, zone: string): number {
  try {
    const [first] = scheduleLocalChoices(local, zone);
    return Date.parse(first!.at);
  } catch (error) {
    if (!(error instanceof MoguriError) || error.code !== "schedule_dst") throw error;
    const nominal = Date.parse(`${local}:00Z`);
    return nominal - scheduleLocalTime(nominal - dayMs, zone).offsetMinutes * 60_000;
  }
}
/** The first occurrence strictly after `after`, or null when the schedule has none. */
export function nextAutomationOccurrence(schedule: AutomationSchedule, anchorAt: number, after: number): number | null {
  if (schedule.kind === "once") { const at = Date.parse(schedule.at); return at > after ? at : null; }
  if (schedule.kind === "interval") {
    const step = schedule.minutes * 60_000;
    return anchorAt + Math.max(1, Math.floor((after - anchorAt) / step) + 1) * step;
  }
  const start = localDate(after, schedule.timeZone);
  for (let day = -1; day <= 9; day++) {
    const date = addDays(start, day);
    if (schedule.kind === "weekly" && !schedule.days.includes(weekday(date))) continue;
    const at = resolveWallTime(`${date}T${schedule.time}`, schedule.timeZone);
    if (at > after) return at;
  }
  throw new MoguriError("schedule_time", "No occurrence was found within the next week. The schedule was preserved; review its days and time.");
}
/**
 * Coalesces every occurrence due at `now` into one run (D49): the latest due occurrence runs,
 * earlier ones count as missed, and the next occurrence is strictly after `now`.
 */
export function dueAutomationOccurrences(schedule: AutomationSchedule, anchorAt: number, nextAt: number, now: number): { latest: number; missed: number; next: number | null } {
  if (nextAt > now) throw new MoguriError("automation_not_due", "This automation is not due yet.", 409);
  if (schedule.kind === "interval") {
    const step = schedule.minutes * 60_000, count = Math.floor((now - nextAt) / step) + 1;
    return { latest: nextAt + (count - 1) * step, missed: Math.min(count - 1, AUTOMATION_MISSED_COUNT_LIMIT), next: nextAt + count * step };
  }
  let latest = nextAt, missed = 0, next = nextAutomationOccurrence(schedule, anchorAt, nextAt);
  while (next !== null && next <= now && missed < AUTOMATION_MISSED_COUNT_LIMIT) {
    latest = next; missed++; next = nextAutomationOccurrence(schedule, anchorAt, next);
  }
  if (next !== null && next <= now) { latest = now; next = nextAutomationOccurrence(schedule, anchorAt, now); }
  return { latest, missed, next };
}
const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export function describeAutomationSchedule(schedule: AutomationSchedule): string {
  if (schedule.kind === "once") return `Once at ${schedule.localTime.replace("T", " ")} (${schedule.timeZone})`;
  if (schedule.kind === "interval") {
    const { minutes } = schedule;
    return minutes % 1440 === 0 ? `Every ${minutes / 1440} day${minutes === 1440 ? "" : "s"}` : minutes % 60 === 0 ?
      `Every ${minutes / 60} hour${minutes === 60 ? "" : "s"}` : `Every ${minutes} minutes`;
  }
  if (schedule.kind === "daily") return `Daily at ${schedule.time} (${schedule.timeZone})`;
  const days = [...schedule.days].sort((a, b) => a - b);
  return `${days.length === 7 ? "Every day" : days.join() === "1,2,3,4,5" ? "Weekdays" : `Weekly on ${days.map((day) => weekdays[day]).join(", ")}`} at ${schedule.time} (${schedule.timeZone})`;
}
export function describeAutomationStep(step: AutomationStep): string {
  if (step.kind === "prompt") return step.text.length > 80 ? `${step.text.slice(0, 79)}…` : step.text;
  return `Run trusted script ${step.path}${step.args?.length ? ` ${step.args.join(" ")}` : ""} (${step.interpreter})`;
}
export const automationStepText = (name: string, index: number, total: number, step: AutomationStep): string => step.kind === "prompt" ? step.text :
  `Automation "${name}" step ${index + 1} of ${total}: run trusted repository script ${step.path} with ${step.interpreter}${step.args?.length ? ` ${JSON.stringify(step.args)}` : ""}.`;

const runTransitions: Record<AutomationRunStatus, AutomationRunStatus[]> = {
  starting: ["running", "blocked", "partial", "stopped"], running: ["running", "completed", "failed", "stopped", "partial", "blocked"],
  completed: [], failed: [], stopped: [], partial: [], skipped: [], blocked: [],
};
const stepOrder: Record<AutomationStepStatus, number> = { pending: 0, queued: 1, running: 2, completed: 3, failed: 3, stopped: 3, partial: 3, skipped: 3, blocked: 3 };
const immutableAutomation = ["id", "profileId", "projectId", "createdAt"] as const;
export function projectAutomation(previous: Automation | undefined, next: Automation): Automation {
  if (!Value.Check(AutomationSchema, next) || next.revision !== (previous?.revision ?? -1) + 1 ||
    [next.createdAt, next.updatedAt, next.anchorAt ?? next.createdAt, next.nextAt ?? next.createdAt].some((value) => !Number.isFinite(Date.parse(value))) ||
    next.status !== "active" && next.nextAt !== null || previous?.status === "deleted" ||
    !previous && next.status === "deleted" || previous && immutableAutomation.some((key) => previous[key] !== next[key]) ||
    next.steps.some((step) => step.kind === "script") && next.controls.env !== "Local") {
    throw new MoguriError("automation_corrupt", "An automation lost its exact owner, revision, schedule or Local script boundary. State was preserved.", 409);
  }
  return structuredClone(next);
}
const immutableRun = ["id", "profileId", "projectId", "automationId", "automationRevision", "name", "trigger", "occurrenceAt", "timeZone",
  "localTime", "offsetMinutes", "missed", "controls", "steps", "commandId", "createdAt"] as const;
export function projectAutomationRun(previous: AutomationRun | undefined, next: AutomationRun): AutomationRun {
  const valid = Value.Check(AutomationRunSchema, next) && next.revision === (previous?.revision ?? -1) + 1 &&
    next.progress.length === next.steps.length && next.step <= next.steps.length &&
    [next.createdAt, next.updatedAt, next.occurrenceAt].every((value) => Number.isFinite(Date.parse(value))) &&
    (next.status !== "completed" || next.progress.every((step) => step.status === "completed")) &&
    (!["running", "completed", "failed"].includes(next.status) || Boolean(next.sessionId)) && (next.status !== "skipped" || !next.sessionId) &&
    (!previous ? ["starting", "skipped", "blocked"].includes(next.status) :
      runTransitions[previous.status].includes(next.status) && immutableRun.every((key) => JSON.stringify(previous[key]) === JSON.stringify(next[key])) &&
      (previous.sessionId === null || previous.sessionId === next.sessionId) && next.step >= previous.step &&
      next.progress.every((state, index) => {
        const before = previous.progress[index]!;
        return stepOrder[state.status] >= stepOrder[before.status] && (stepOrder[before.status] < 3 || state.status === before.status) &&
          (before.itemId === null || before.itemId === state.itemId) && (before.turnId === null || before.turnId === state.turnId);
      }));
  if (!valid) throw new MoguriError("automation_corrupt", "An automation run lost its exact original definition, chat, progress or terminal outcome. No step was replayed.", 409);
  return structuredClone(next);
}
