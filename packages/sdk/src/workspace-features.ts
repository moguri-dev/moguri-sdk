import { ClientError } from "../../client/src/index.ts";
import {
  DependencyRegistryConfigSchema, HookDefinitionSchema, KnowledgeInputSchema, KnowledgePromotionSchema, MarketplaceInputSchema, MarketplaceSourceSchema, PackageManagerSchema,
  isRecord, parse, type KnowledgeTier, type Session,
} from "../../protocol/src/index.ts";
import type { MoguriSdk } from "./index.ts";
import type { SlashResult } from "./slash.ts";

export type WorkspaceFeature = "knowledge" | "marketplace" | "hooks" | "capability" | "containment" | "cache";
const result = (value: unknown): SlashResult => ({ kind: "text", text: JSON.stringify(value, null, 2) });
function ownerInput(text: string, session: Session, kind: "knowledge" | "marketplace") {
  const value: unknown = JSON.parse(text);
  if (!isRecord(value)) throw new ClientError("feature_input", "Supply one complete JSON object; nothing was applied.");
  if (kind === "marketplace" || value.tier === "Terra") {
    if (!session.projectId || value.projectId !== undefined && value.projectId !== session.projectId) throw new ClientError("project_required", "This command needs the current session's exact project. No other root was inherited.");
    return { ...value, projectId: session.projectId };
  }
  if (value.tier === "Sky") {
    if (value.sessionId !== undefined && value.sessionId !== session.id) throw new ClientError("knowledge_scope", "Sky belongs to this exact selected session, not an override in JSON.");
    return { ...value, sessionId: session.id };
  }
  return value;
}
export async function workspaceFeatureSlash(sdk: MoguriSdk, session: Session, name: WorkspaceFeature, argument: string): Promise<SlashResult> {
  const match = argument.trim().match(/^(\S+)(?:\s+([\s\S]*))?$/), action = match?.[1] ?? "", tail = match?.[2] ?? "";
  if (name === "containment") {
    if (!action || action === "status" && !tail) return result(await sdk.containment.status());
    if (action === "require-sandbox" && tail === "confirm-policy") return result(await sdk.containment.requireSandbox(true));
    throw new ClientError("containment_command", "Use /containment status or require-sandbox confirm-policy. This changes global new-turn policy, not existing turns or selected environments.");
  }
  if (name === "cache") {
    if (action === "registries" && !tail) return result(await sdk.cache.registries.list());
    const save = tail.match(/^(\d+)\s+(\S+)\s+([\s\S]+)$/);
    if (action === "registry-save" && save) return result(await sdk.cache.registries.save(parse(DependencyRegistryConfigSchema, JSON.parse(save[3]!)), Number(save[1]), save[2] === "-" ? undefined : save[2]));
    const fields = tail.split(/\s+/).filter(Boolean), [id, revision, confirmation] = fields;
    if (action === "registry-remove" && id && revision && /^\d+$/.test(revision) && confirmation === "confirm-remove" && fields.length === 3) return result(await sdk.cache.registries.remove(id, Number(revision)));
    if (action === "clear-token" && id && fields.length === 1) return result(await sdk.cache.registries.clearToken(id));
    if (action === "token") throw new ClientError("cache_token", "Use the native TUI masked token dialog or pipe the credential into the dedicated CLI. Never put credentials in a slash command or draft.");
    if (!session.projectId || session.controls.env !== "Local") throw new ClientError("cache_env", "Session cache commands need an explicit Local workspace. Remote/Sandbox package-cache execution is not qualified and cannot fall back to the Local source root.");
    const [managerInput, hash, consent, replacement] = fields, manager = parse(PackageManagerSchema, managerInput);
    if (action === "inspect" && fields.length === 1) return result(await sdk.cache.inspect(session.projectId, manager, session.workspaceId ?? undefined));
    if (hash && consent === "accept-metadata") {
      if (action === "prepare" && fields.length === 3) return result(await sdk.cache.prepare(session.projectId, manager, hash, true, session.workspaceId ?? undefined));
      if (action === "install" && replacement === "replace-node-modules" && fields.length === 4) return result(await sdk.cache.install(session.projectId, manager, hash, true, false, session.workspaceId ?? undefined));
    }
    throw new ClientError("cache_command", "Use /cache inspect MANAGER, prepare MANAGER SHA accept-metadata, install MANAGER SHA accept-metadata replace-node-modules, registries, registry-save REV ID|- CONFIG_JSON, registry-remove ID REV confirm-remove, or clear-token ID. Managers: npm/pnpm/python/cargo/go. Executable native builds are not implied by cache preparation.");
  }
  if (name === "hooks") {
    if (action === "list" || !action) return result(sdk.getState().snapshot!.registry.filter((entry) => entry.projectId === session.projectId && entry.kind === "hook"));
    if (action === "import" && session.projectId) return result(await sdk.hooks.import(session.projectId, parse(HookDefinitionSchema, JSON.parse(tail))));
    throw new ClientError("hook_command", "Use /hooks list or import DEFINITION_JSON in a project. Imports are disabled; /capability reviews and enables them separately.");
  }
  if (name === "marketplace") {
    if (action === "catalog") return result(await sdk.marketplace.catalog(parse(MarketplaceSourceSchema, ownerInput(tail, session, "marketplace"))));
    if (action === "preview") return result(await sdk.marketplace.preview(parse(MarketplaceInputSchema, ownerInput(tail, session, "marketplace"))));
    const install = tail.match(/^([a-f0-9]{64})\s+confirm-install\s+([\s\S]+)$/);
    if (action === "install" && install) return result(await sdk.marketplace.install(parse(MarketplaceInputSchema, ownerInput(install[2]!, session, "marketplace")), install[1]!, true));
    throw new ClientError("marketplace_command", "Use /marketplace catalog SOURCE_JSON, preview INPUT_JSON, or install SHA confirm-install INPUT_JSON. Source requires sourceProjectId, full commit and path; installation also needs exact packageName/version. No clone, fetch or execution is automatic.");
  }
  if (name === "capability") {
    const parts = tail.split(/\s+/).filter(Boolean), [id, value, hash, confirmation] = parts;
    if (action === "view" && id && parts.length === 1) return result(await sdk.capabilities.content(id));
    if (action === "history" && id && parts.length === 1) return result(await sdk.capabilities.history(id));
    if (action === "version" && id && value && parts.length === 2) return result(await sdk.capabilities.version(id, value));
    if (action === "use" && id && value && parts.length === 2) return result(await sdk.capabilities.useSkill(session.id, id, value, session.draft.revision));
    if ((action === "enable" || action === "disable") && id && value && /^\d+$/.test(value) && hash === "confirm-state" && parts.length === 3) return result(await sdk.capabilities.toggle(id, action === "enable", Number(value)));
    if ((action === "enable" || action === "disable") && id && parts.length === 1) {
      const entry = sdk.getState().snapshot!.registry.find((entry) => entry.id === id && entry.projectId === session.projectId);
      if (!entry) throw new ClientError("capability_scope", "Choose an actual capability in this selected project.");
      return result(await sdk.capabilities.toggle(entry.id, action === "enable", entry.revision));
    }
    if (action === "rollback" && id && value && /^\d+$/.test(value) && hash && confirmation === "confirm-rollback" && parts.length === 4) return result(await sdk.capabilities.rollback(id, Number(value), hash, true));
    throw new ClientError("capability_command", "Use /capability history ID, version ID SHA, use ID SHA, enable/disable ID REV confirm-state, or rollback ID REV SHA confirm-rollback. Rollbacks are disabled and never grant execution.");
  }
  if (action === "save") return result(await sdk.knowledge.save(parse(KnowledgeInputSchema, ownerInput(tail, session, "knowledge"))));
  const update = tail.match(/^(\S+)\s+(\d+)\s+([\s\S]+)$/);
  if (action === "update" && update) return result(await sdk.knowledge.save(parse(KnowledgeInputSchema, ownerInput(update[3]!, session, "knowledge")), update[1]!, Number(update[2])));
  const promote = tail.match(/^(\S+)\s+(\d+)\s+([a-f0-9]{64})\s+confirm-promote\s+([\s\S]+)$/);
  if (action === "promote" && promote) return result(await sdk.knowledge.promote(promote[1]!, Number(promote[2]), promote[3]!, parse(KnowledgePromotionSchema, JSON.parse(promote[4]!)), true));
  const parts = tail.split(/\s+/).filter(Boolean), [id, value, hash, confirmation] = parts;
  if ((!action || action === "list" || action === "search") && (!id || ["Sky", "Terra", "Glacier"].includes(id))) {
    const tier = (id ?? "Sky") as KnowledgeTier, text = action === "search" ? parts.slice(1).join(" ") : "";
    if (action !== "search" && parts.length > 1) throw new ClientError("knowledge_command", "List one exact knowledge tier; use search TIER TEXT for lexical search.");
    return result(await sdk.knowledge.list({ tier, ...(tier === "Sky" ? { sessionId: session.id } : tier === "Terra" && session.projectId ? { projectId: session.projectId } : {}), text }));
  }
  if (action === "read" && id && parts.length === 1) return result(await sdk.knowledge.read(id));
  if (action === "history" && id && parts.length === 1) return result(await sdk.knowledge.history(id));
  if (action === "version" && id && value && parts.length === 2) return result(await sdk.knowledge.version(id, value));
  if (action === "forget" && id && value && /^\d+$/.test(value) && hash === "confirm-forget" && parts.length === 3) return result(await sdk.knowledge.forget(id, Number(value), true));
  if (action === "rollback" && id && value && /^\d+$/.test(value) && hash && confirmation === "confirm-rollback" && parts.length === 4) return result(await sdk.knowledge.rollback(id, Number(value), hash, true));
  throw new ClientError("knowledge_command", "Use /knowledge list [Sky|Terra|Glacier], search TIER TEXT, read/history ID, version ID SHA, save JSON, update ID REV JSON, promote ID REV SHA confirm-promote JSON, rollback ID REV SHA confirm-rollback, or forget ID REV confirm-forget.");
}
