import { Type, type Static } from "typebox";
import type { StorageQuery } from "./storage-location.ts";
import { UpdateCommandSchema, type UpdateQuery } from "./application-updates.ts";
import { VirtualDiskCommandSchema, type VirtualDiskQuery } from "./virtual-disk.ts";
import { parse } from "./core.ts";
import type { StoredEvent } from "./index.ts";
export * from "./storage-location.ts";
export * from "./application-updates.ts";
export * from "./virtual-disk.ts";

export const ApplicationPreferencesSchema = Type.Object({
  menuBar: Type.Boolean(), automaticUpdates: Type.Boolean(), keepServiceOnWindowClose: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });
export type ApplicationPreferences = Static<typeof ApplicationPreferencesSchema>;
export interface ApplicationConfiguration { revision: number; values: ApplicationPreferences }
export const defaultApplicationPreferences = (): ApplicationPreferences => ({ menuBar: true, automaticUpdates: true, keepServiceOnWindowClose: true });
export function normalizeApplicationPreferences(value: unknown): ApplicationPreferences {
  return { ...defaultApplicationPreferences(), ...parse(ApplicationPreferencesSchema, value) };
}
export const hasBackgroundServiceHistory = (events: readonly StoredEvent[]) => events.some((event) =>
  event.event_type === "application.configured" && Object.hasOwn(event.payload.values, "keepServiceOnWindowClose"));
export const ApplicationCommandSchema = Type.Union([Type.Object({
  type: Type.Literal("application.configure"), expectedRevision: Type.Integer({ minimum: 0 }),
  changes: Type.Object({ menuBar: Type.Optional(Type.Boolean()), automaticUpdates: Type.Optional(Type.Boolean()),
    keepServiceOnWindowClose: Type.Optional(Type.Boolean()) }, { minProperties: 1, additionalProperties: false }),
}, { additionalProperties: false }), UpdateCommandSchema, VirtualDiskCommandSchema]);
export const ApplicationQuerySchema = Type.Object({ type: Type.Literal("application.status") }, { additionalProperties: false });
export type ApplicationCommand = Static<typeof ApplicationCommandSchema>;
export type ApplicationQuery = Static<typeof ApplicationQuerySchema>;
export type ApplicationResponse = { type: "application.status"; configuration: ApplicationConfiguration };
export const isApplicationCommand = (value: { type: string }): value is ApplicationCommand => value.type.startsWith("application.");
export const isApplicationQuery = (value: { type: string }): value is ApplicationQuery | StorageQuery | UpdateQuery | VirtualDiskQuery => value.type.startsWith("application.");
