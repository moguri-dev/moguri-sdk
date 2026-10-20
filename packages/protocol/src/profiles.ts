import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";
import { ControlDefaultsSchema, type ControlDefaults } from "./controls.ts";
import { BudgetLimitSchema, type BudgetLimit } from "./budgets.ts";

const object = <T extends Record<string, TSchema>>(properties: T) => Type.Object(properties, { additionalProperties: false });
const id = Type.String({ minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9_-]+$" });
const revision = Type.Integer({ minimum: 0 });
const name = Type.String({ minLength: 1, maxLength: 80 });
const color = Type.Union([Type.String({ pattern: "^#[a-fA-F0-9]{6}$" }), Type.Null()]);
export const GLOBAL_PROFILE_ID = "_global";
export interface Profile {
  id: string; name: string; color: string | null; revision: number; createdAt: string;
  status: "creating" | "ready" | "partial"; diagnostic: string | null;
}
export interface GlobalPreferences { revision: number; values: ControlDefaults }
export interface GlobalBudgetPolicy { revision: number; limit: BudgetLimit | null }
export interface ProfileCatalog {
  profiles: Profile[]; globalDefaults: GlobalPreferences; globalBudget: GlobalBudgetPolicy;
  environmentPolicy: { revision: number; allowedEnvs: Array<"Local" | "Sandbox" | "Remote"> };
}
export const ProfileCommandSchema = Type.Union([
  object({ type: Type.Literal("profile.create"), name, color, confirm: Type.Literal(true) }),
  object({ type: Type.Literal("profile.update"), targetProfileId: id, expectedRevision: revision, changes: object({ name: Type.Optional(name), color: Type.Optional(color) }) }),
  object({ type: Type.Literal("profile.retry"), targetProfileId: id, expectedRevision: revision, confirm: Type.Literal(true) }),
  object({ type: Type.Literal("profile.cancel"), targetProfileId: id }),
  object({ type: Type.Literal("profile.global.defaults"), expectedRevision: revision, values: ControlDefaultsSchema }),
  object({ type: Type.Literal("profile.global.budget"), expectedRevision: revision, limit: Type.Union([BudgetLimitSchema, Type.Null()]), confirmRisk: Type.Literal(true) }),
]);
export type ProfileCommand = Static<typeof ProfileCommandSchema>;
export const isProfileCommand = (value: unknown): value is ProfileCommand => Value.Check(ProfileCommandSchema, value);
export const ProfileQuerySchema = object({ type: Type.Literal("profile.list") });
export type ProfileQuery = Static<typeof ProfileQuerySchema>;
export const isProfileQuery = (value: unknown): value is ProfileQuery => Value.Check(ProfileQuerySchema, value);
export type ProfileResponse = { type: "profile.list"; catalog: ProfileCatalog };
