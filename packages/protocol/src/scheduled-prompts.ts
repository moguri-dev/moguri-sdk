import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import { ControlsSchema } from "./controls.ts";
import { AttachmentSchema } from "./inputs.ts";
import { MAX_TEXT, MoguriError } from "./core.ts";

const id = Type.String({ minLength: 1, maxLength: 128 });
const hash = Type.String({ pattern: "^[a-f0-9]{64}$" });
const revision = Type.Integer({ minimum: 0 });
const timeZone = Type.String({ minLength: 1, maxLength: 128 });
const localTime = Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}$" });
export const ScheduledTimingSchema = Type.Union([
  Type.Object({ kind: Type.Literal("delay"), minutes: Type.Integer({ minimum: 1, maximum: 525600 }), timeZone }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("at"), at: Type.String({ minLength: 20, maxLength: 32 }), timeZone, localTime,
    offsetMinutes: Type.Integer({ minimum: -840, maximum: 840 }) }, { additionalProperties: false }),
]);
export type ScheduledTiming = Static<typeof ScheduledTimingSchema>;
export const ScheduledPromptSchema = Type.Object({
  id, revision, profileId: id, sessionId: id, projectId: Type.Union([id, Type.Null()]),
  commandId: id, commandDigest: hash, draftRevision: revision, bindingDigest: hash,
  text: Type.String({ maxLength: MAX_TEXT }), attachments: Type.Array(AttachmentSchema, { maxItems: 16 }),
  controls: ControlsSchema, createdAt: Type.String(), updatedAt: Type.String(), dueAt: Type.String(),
  timeZone, localTime, offsetMinutes: Type.Integer({ minimum: -840, maximum: 840 }),
  status: Type.Union([Type.Literal("scheduled"), Type.Literal("blocked"), Type.Literal("queued"), Type.Literal("admitted"), Type.Literal("cancelled")]),
  admittedTurnId: Type.Union([id, Type.Null()]), diagnostic: Type.Union([Type.String({ maxLength: 4096 }), Type.Null()]),
}, { additionalProperties: false });
export type ScheduledPrompt = Static<typeof ScheduledPromptSchema>;
export const ScheduledPromptCommandSchema = Type.Union([
  Type.Object({ type: Type.Literal("prompt.schedule"), sessionId: id, expectedRevision: revision, timing: ScheduledTimingSchema }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("prompt.send_now"), sessionId: id, scheduledPromptId: id, expectedRevision: revision }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("prompt.cancel"), sessionId: id, scheduledPromptId: id, expectedRevision: revision }, { additionalProperties: false }),
]);
export type ScheduledPromptCommand = Static<typeof ScheduledPromptCommandSchema>;

export function scheduleLocalTime(at: number, zone: string): { localTime: string; offsetMinutes: number } {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(at));
  } catch {
    throw new MoguriError("schedule_time", "Choose a valid local timezone and date. No replacement timezone or time was inferred.");
  }
  const field = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)!.value;
  const value = `${field("year")}-${field("month")}-${field("day")}T${field("hour")}:${field("minute")}`;
  const offsetMinutes = (Date.parse(`${value}:00Z`) - Math.floor(at / 60_000) * 60_000) / 60_000;
  return { localTime: value, offsetMinutes };
}
export function scheduledInstant(timing: ScheduledTiming, now: number) {
  const at = timing.kind === "delay" ? now + timing.minutes * 60_000 : Date.parse(timing.at);
  if (!Number.isFinite(at) || at <= now || at - now > 366 * 86400_000) {
    throw new MoguriError("schedule_time", "Choose a future time within the next year. The unsent prompt was preserved.");
  }
  const local = scheduleLocalTime(at, timing.timeZone);
  if (timing.kind === "at" && (local.localTime !== timing.localTime || local.offsetMinutes !== timing.offsetMinutes)) {
    throw new MoguriError("schedule_dst", "The local time or UTC offset does not match that instant. Review the actual timezone/DST occurrence; no clock adjustment was made.");
  }
  return { dueAt: new Date(at).toISOString(), timeZone: timing.timeZone, ...local };
}
export function scheduleLocalChoices(value: string, zone: string): Array<Extract<ScheduledTiming, { kind: "at" }>> {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new MoguriError("schedule_time", "Choose a complete local date and time.");
  const nominal = Date.parse(`${value}:00Z`);
  if (!Number.isFinite(nominal)) throw new MoguriError("schedule_time", "Choose a valid local date and time.");
  const offsets = new Set([-48, -24, -12, 0, 12, 24, 48].map((hours) => scheduleLocalTime(nominal + hours * 3600_000, zone).offsetMinutes));
  const choices = [...offsets].flatMap((offset) => {
    const at = nominal - offset * 60_000, actual = scheduleLocalTime(at, zone);
    return actual.localTime === value && actual.offsetMinutes === offset ?
      [{ kind: "at" as const, at: new Date(at).toISOString(), timeZone: zone, ...actual }] : [];
  }).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  if (!choices.length) throw new MoguriError("schedule_dst", "This local time does not exist in the selected timezone, including a possible DST gap. Choose another time.");
  return choices;
}
export function projectScheduledPrompt(previous: ScheduledPrompt | undefined, next: ScheduledPrompt): ScheduledPrompt {
  if (!Value.Check(ScheduledPromptSchema, next) || next.revision !== (previous?.revision ?? -1) + 1 ||
    !Number.isFinite(Date.parse(next.createdAt)) || !Number.isFinite(Date.parse(next.updatedAt)) ||
    !Number.isFinite(Date.parse(next.dueAt)) || Date.parse(next.dueAt) <= Date.parse(next.createdAt) ||
    Boolean(next.admittedTurnId) !== (next.status === "admitted")) {
    throw new MoguriError("schedule_corrupt", "Scheduled input lost its exact original shape, time, admission or revision. State was preserved.", 409);
  }
  if (Date.parse(`${next.localTime}:00Z`) !== Math.floor(Date.parse(next.dueAt) / 60_000) * 60_000 + next.offsetMinutes * 60_000) {
    throw new MoguriError("schedule_corrupt", "Scheduled local time no longer matches its retained instant and original UTC offset. State was preserved.", 409);
  }
  const transitions: Record<ScheduledPrompt["status"], ScheduledPrompt["status"][]> = {
    scheduled: ["queued", "blocked", "cancelled"], blocked: ["queued", "cancelled"], queued: ["admitted", "blocked", "cancelled"], admitted: [], cancelled: [],
  };
  if (!previous ? next.status !== "scheduled" : !transitions[previous.status].includes(next.status) ||
    (Object.keys(next) as Array<keyof ScheduledPrompt>).some((key) =>
      !["revision", "updatedAt", "status", "admittedTurnId", "diagnostic"].includes(key) && JSON.stringify(previous[key]) !== JSON.stringify(next[key]))) {
    throw new MoguriError("schedule_corrupt", "Scheduled input ownership changed or terminal work was replayed. State was preserved.", 409);
  }
  return structuredClone(next);
}
