import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";
import { ControlDefaultsSchema, type ControlDefaults } from "./controls.ts";
import { BudgetLimitSchema, type BudgetLimit } from "./budgets.ts";
import { HOSTED_KEY_PROVIDERS, HostedKeyProviderIdSchema, type HostedKeyProviderId, type HostedProviderId } from "./hosted-providers.ts";
import { MoguriError } from "./core.ts";

const object = <T extends Record<string, TSchema>>(properties: T) => Type.Object(properties, { additionalProperties: false });
const id = Type.String({ minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9_-]+$" });
const revision = Type.Integer({ minimum: 0 });
const name = Type.String({ minLength: 1, maxLength: 80 });
const color = Type.Union([Type.String({ pattern: "^#[a-fA-F0-9]{6}$" }), Type.Null()]);
export const ProfileDraftSchema = object({ name, color });
export const ProfileChangesSchema = object({ name: Type.Optional(name), color: Type.Optional(color) });
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
  object({ type: Type.Literal("profile.update"), targetProfileId: id, expectedRevision: revision, changes: ProfileChangesSchema }),
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

const hash = Type.String({ pattern: "^[a-f0-9]{64}$" });
/**
 * Protocol 122 (D76). A reviewed copy from another ready profile into the requesting profile. The preview lists the source's providers,
 * repositories and skill sources without secrets; `profile.import.apply` copies only the chosen items. API keys are copied inside the
 * service into this profile's own secret namespace; sign-ins (OAuth) are never copied, and the source profile is never modified.
 */
export const ProfileImportQuerySchema = object({ type: Type.Literal("profile.import.preview"), sourceProfileId: id });
export type ProfileImportQuery = Static<typeof ProfileImportQuerySchema>;
export const isProfileImportQuery = (value: unknown): value is ProfileImportQuery => Value.Check(ProfileImportQuerySchema, value);
export const ProfileImportCommandSchema = object({
  type: Type.Literal("profile.import.apply"), sourceProfileId: id, expectedDigest: hash,
  hostedProviders: Type.Array(HostedKeyProviderIdSchema, { maxItems: HOSTED_KEY_PROVIDERS.length, uniqueItems: true }),
  localEndpoints: Type.Array(Type.String({ pattern: "^[a-z][a-z0-9-]{0,47}$" }), { maxItems: 8, uniqueItems: true }),
  modelPreferences: Type.Boolean(),
  skillSources: Type.Array(Type.String({ pattern: "^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$" }), { maxItems: 16, uniqueItems: true }),
  confirm: Type.Literal(true),
});
export type ProfileImportCommand = Static<typeof ProfileImportCommandSchema>;
export const isProfileImportCommand = (value: unknown): value is ProfileImportCommand => Value.Check(ProfileImportCommandSchema, value);
export interface ProfileImportPreview {
  format: "moguri-profile-import"; version: 1; targetProfileId: string; sourceProfileId: string; sourceName: string;
  /** `configured` items already exist in this profile and can't be imported over. Only `api_key` credentials can be copied. */
  hostedProviders: Array<{ providerId: HostedProviderId; credential: "api_key" | "oauth" | null; configured: boolean }>;
  localEndpoints: Array<{ id: string; name: string; baseUrl: string; auth: "none" | "bearer" | "header"; keyStored: boolean; models: number; configured: boolean }>;
  /** Counts of the source's model switches and source choices; null when it has none. Importing replaces this profile's. */
  modelPreferences: { disabledProviders: number; disabledModels: number; sources: number } | null;
  skillSources: Array<{ id: string; kind: "local" | "remote"; name: string; location: string; personal: boolean; configured: boolean }>;
  /** The source's Local repositories. Register them with `project.add`: both profiles then use the same folder. */
  repositories: Array<{ projectId: string; name: string; path: string; registered: boolean }>;
}
export type ProfileImportResponse = { type: "profile.import.preview"; preview: ProfileImportPreview; digest: string };
export interface ProfileImportChoices {
  hostedProviders: ProfileImportCommand["hostedProviders"]; localEndpoints: string[]; modelPreferences: boolean; skillSources: string[];
  /** Source project IDs to register with `sdk.profiles.imports.repositories`. */
  repositories: string[];
}
/** Parses text-client import items (`key:PROVIDER`, `endpoint:ID`, `preferences`, `skills:ID`, `repo:PROJECT_ID`) shared by `/profile import` and the CLI. */
export function profileImportChoices(items: readonly string[]): ProfileImportChoices {
  const chosen: ProfileImportChoices = { hostedProviders: [], localEndpoints: [], modelPreferences: false, skillSources: [], repositories: [] };
  for (const item of items) {
    const separator = item.indexOf(":"), kind = separator < 0 ? item : item.slice(0, separator), value = separator < 0 ? "" : item.slice(separator + 1);
    if (kind === "key" && (HOSTED_KEY_PROVIDERS as string[]).includes(value)) chosen.hostedProviders.push(value as HostedKeyProviderId);
    else if (kind === "endpoint" && value) chosen.localEndpoints.push(value);
    else if (kind === "skills" && value) chosen.skillSources.push(value);
    else if (kind === "repo" && value) chosen.repositories.push(value);
    else if (item === "preferences") chosen.modelPreferences = true;
    else throw new MoguriError("profile_import_item", `Unknown import item ${item}. Use key:PROVIDER, endpoint:ID, preferences, skills:ID or repo:PROJECT_ID.`);
  }
  return chosen;
}
