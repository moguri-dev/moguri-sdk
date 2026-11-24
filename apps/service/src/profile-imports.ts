import {
  hostedProvider, MoguriError, type HostedProviderId, type LocalEndpoint, type ModelPreferences, type Project, type ProfileImportCommand,
  type ProfileImportPreview, type ProfileImportResponse, type SkillSource, type UserSettings,
} from "../../../packages/protocol/src/index.ts";
import { digest } from "./store.ts";

/** D76. Another ready profile's import material. Secrets are read inside the service only and never enter a preview, event or result. */
export interface ProfileImportSource {
  profileId: string; name: string; settings: UserSettings; projects: readonly Project[];
  hostedCredential(id: HostedProviderId, signal: AbortSignal): Promise<{ type: "api_key"; key: string } | { type: "oauth" } | null>;
  endpointToken(endpoint: LocalEndpoint, signal: AbortSignal): Promise<string | null>;
}
export interface ProfileImportTarget { profileId: string; settings: UserSettings; projects: readonly Project[] }
export interface ProfileImportPlan { hosted: HostedProviderId[]; endpoints: LocalEndpoint[]; preferences: ModelPreferences | null; skillSources: SkillSource[] }

const skillLocation = (source: SkillSource) => source.kind === "local" ? source.path : source.url;

/** The redacted listing a user reviews; its digest binds `profile.import.apply` to exactly what was shown. */
export async function previewProfileImport(target: ProfileImportTarget, source: ProfileImportSource, signal: AbortSignal): Promise<ProfileImportResponse> {
  if (source.profileId === target.profileId) throw new MoguriError("profile_import_source", "Choose another profile to import from. Nothing was copied.", 409);
  const configuredHosted = new Set(target.settings.hostedProviders ?? []), targetEndpoints = new Set(target.settings.localModels.map((endpoint) => endpoint.id));
  const targetSkills = target.settings.skillSources ?? [];
  const hostedProviders: ProfileImportPreview["hostedProviders"] = [];
  for (const providerId of source.settings.hostedProviders ?? []) {
    let credential: "api_key" | "oauth" | null = null;
    try { credential = (await source.hostedCredential(providerId, signal))?.type ?? null; }
    catch (error) {
      signal.throwIfAborted();
      if (!(error instanceof MoguriError && error.code === "hosted_secret_invalid")) throw readFailure();
    }
    hostedProviders.push({ providerId, credential, configured: configuredHosted.has(providerId) });
  }
  const localEndpoints: ProfileImportPreview["localEndpoints"] = [];
  for (const endpoint of source.settings.localModels) {
    let keyStored = false;
    if (endpoint.auth !== "none") {
      try { keyStored = await source.endpointToken(endpoint, signal) !== null; } catch { signal.throwIfAborted(); throw readFailure(); }
    }
    localEndpoints.push({ id: endpoint.id, name: endpoint.name, baseUrl: endpoint.baseUrl, auth: endpoint.auth, keyStored, models: endpoint.models.length,
      configured: targetEndpoints.has(endpoint.id) });
  }
  const preferences = source.settings.modelPreferences;
  const preview: ProfileImportPreview = {
    format: "moguri-profile-import", version: 1, targetProfileId: target.profileId, sourceProfileId: source.profileId, sourceName: source.name,
    hostedProviders, localEndpoints,
    modelPreferences: preferences && (preferences.disabledProviders.length || preferences.disabledModels.length || preferences.sources.length) ?
      { disabledProviders: preferences.disabledProviders.length, disabledModels: preferences.disabledModels.length, sources: preferences.sources.length } : null,
    skillSources: (source.settings.skillSources ?? []).map((skill) => ({ id: skill.id, kind: skill.kind, name: skill.name, location: skillLocation(skill),
      personal: skill.kind === "remote" && skill.personal === true,
      configured: targetSkills.some((existing) => existing.id === skill.id || existing.kind === skill.kind && skillLocation(existing) === skillLocation(skill)) })),
    // Folder projects belong to their workspace folder sync; they aren't repositories to register.
    repositories: source.projects.filter((project) => !project.workspaceFolderId).map((project) => ({ projectId: project.id, name: project.name, path: project.path,
      registered: target.projects.some((existing) => existing.path === project.path) })),
  };
  return { type: "profile.import.preview", preview, digest: digest(JSON.stringify(preview)) };
}
function readFailure(): MoguriError {
  return new MoguriError("profile_import_secret", "The source profile's secret backend could not be read. Unlock it and retry; nothing was copied.", 503);
}

/** Resolves the chosen items against the reviewed preview. Every item must be listed, importable and not already in this profile. */
export function planProfileImport(preview: ProfileImportPreview, command: ProfileImportCommand, source: UserSettings, target: UserSettings): ProfileImportPlan {
  const hosted = command.hostedProviders.map((id) => {
    const listed = preview.hostedProviders.find((entry) => entry.providerId === id), name = hostedProvider(id)?.name ?? id;
    if (!listed) throw new MoguriError("profile_import_item", `${name} isn't set up in ${preview.sourceName}. Nothing was copied.`, 409);
    if (listed.configured) throw new MoguriError("profile_import_item", `${name} is already set up in this profile. Remove it first to import it; nothing was copied.`, 409);
    if (listed.credential !== "api_key") throw new MoguriError("profile_import_sign_in", `${name} is connected with a sign-in, not an API key. Sign-ins are never copied between profiles; sign in again here.`, 409);
    return id;
  });
  const endpoints = command.localEndpoints.map((id) => {
    const listed = preview.localEndpoints.find((entry) => entry.id === id), endpoint = source.localModels.find((entry) => entry.id === id);
    if (!listed || !endpoint) throw new MoguriError("profile_import_item", `Endpoint ${id} isn't configured in ${preview.sourceName}. Nothing was copied.`, 409);
    if (listed.configured) throw new MoguriError("profile_import_item", `This profile already has an endpoint named ${id}. Nothing was copied.`, 409);
    return structuredClone(endpoint);
  });
  if (target.localModels.length + endpoints.length > 8) throw new MoguriError("profile_import_item", "A profile holds at most 8 model endpoints. Choose fewer; nothing was copied.", 409);
  if (command.modelPreferences && (!preview.modelPreferences || !source.modelPreferences)) throw new MoguriError("profile_import_item", `${preview.sourceName} has no model preferences to copy. Nothing was copied.`, 409);
  const skillSources = command.skillSources.map((id) => {
    const listed = preview.skillSources.find((entry) => entry.id === id), skill = source.skillSources?.find((entry) => entry.id === id);
    if (!listed || !skill) throw new MoguriError("profile_import_item", `Skill source ${id} isn't configured in ${preview.sourceName}. Nothing was copied.`, 409);
    if (listed.configured) throw new MoguriError("profile_import_item", `${skill.name} is already a skill source in this profile. Nothing was copied.`, 409);
    return structuredClone(skill);
  });
  if ((target.skillSources?.length ?? 0) + skillSources.length > 16) throw new MoguriError("profile_import_item", "A profile holds at most 16 skill sources. Choose fewer; nothing was copied.", 409);
  const plan = { hosted, endpoints, preferences: command.modelPreferences ? structuredClone(source.modelPreferences!) : null, skillSources };
  if (!plan.hosted.length && !plan.endpoints.length && !plan.preferences && !plan.skillSources.length) throw new MoguriError("profile_import_empty", "Choose at least one item to import.", 409);
  return plan;
}
