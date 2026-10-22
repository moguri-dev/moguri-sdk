import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";
import type { CapabilityEntry } from "./platform.ts";

const object = <T extends Record<string, TSchema>>(properties: T) => Type.Object(properties, { additionalProperties: false });
const id = Type.String({ minLength: 1, maxLength: 128 });
const hash = Type.String({ pattern: "^[a-f0-9]{64}$" });
const revision = Type.Integer({ minimum: 0 });
const name = Type.String({ pattern: "^[a-z0-9][a-z0-9-]{0,63}$" });
const description = Type.String({ minLength: 1, maxLength: 1000 });
const content = Type.String({ minLength: 1, maxLength: 64 * 1024 });
export const HookDefinitionSchema = object({
  schemaVersion: Type.Literal(1), name, description,
  trigger: Type.Union([Type.Literal("turn.start"), Type.Literal("turn.end")]),
  command: Type.String({ minLength: 1, maxLength: 16384 }),
  timeoutMs: Type.Integer({ minimum: 1000, maximum: 60_000 }),
});
export type HookDefinition = Static<typeof HookDefinitionSchema>;
export interface HookBinding {
  id: string; revision: number; contentDigest: string; definition: HookDefinition;
}
export const HookBindingSchema = object({ id, revision, contentDigest: hash, definition: HookDefinitionSchema });
export const ExtensionManifestSchema = object({
  schemaVersion: Type.Literal(1), name,
  version: Type.String({ minLength: 1, maxLength: 80 }), description,
  license: Type.String({ minLength: 1, maxLength: 200 }),
  minimumProtocol: Type.Integer({ minimum: 1 }), maximumProtocol: Type.Integer({ minimum: 1 }),
  skills: Type.Array(content, { maxItems: 16 }),
  scripts: Type.Array(object({ name, description, content }), { maxItems: 16 }),
  hooks: Type.Array(HookDefinitionSchema, { maxItems: 16 }),
});
export type ExtensionManifest = Static<typeof ExtensionManifestSchema>;
export const MarketplaceCatalogSchema = object({
  schemaVersion: Type.Literal(1), packages: Type.Array(ExtensionManifestSchema, { minItems: 1, maxItems: 100 }),
});
export const MarketplaceSourceSchema = object({
  projectId: id, sourceProjectId: id,
  commit: Type.String({ pattern: "^(?:[a-f0-9]{40}|[a-f0-9]{64})$" }),
  path: Type.String({ minLength: 1, maxLength: 4096 }),
});
export type MarketplaceSource = Static<typeof MarketplaceSourceSchema>;
export const MarketplaceInputSchema = object({
  ...MarketplaceSourceSchema.properties, packageName: name,
  version: Type.String({ minLength: 1, maxLength: 80 }),
});
export type MarketplaceInput = Static<typeof MarketplaceInputSchema>;
export interface MarketplaceOrigin {
  sourceProjectId: string; commit: string; path: string; catalogDigest: string; packageName: string; version: string;
}
export interface MarketplacePreview {
  input: MarketplaceInput; manifest: ExtensionManifest; digest: string; catalogDigest: string;
  source: { root: string; device: string; inode: string };
  installed: { id: string; revision: number; contentDigest: string; enabled: boolean }[];
  warning: string;
}
export interface MarketplaceCatalogListing {
  packages: Pick<ExtensionManifest, "name" | "version" | "description" | "license" | "minimumProtocol" | "maximumProtocol">[];
  source: { root: string; device: string; inode: string }; commit: string; path: string; digest: string;
}
export const ExtensionCommandSchema = Type.Union([
  object({ type: Type.Literal("hook.import"), projectId: id, definition: HookDefinitionSchema }),
  object({ type: Type.Literal("marketplace.install"), input: MarketplaceInputSchema, expectedDigest: hash, confirm: Type.Literal(true) }),
  object({ type: Type.Literal("capability.rollback"), capabilityId: id, expectedRevision: revision, contentDigest: hash, confirm: Type.Literal(true) }),
  object({ type: Type.Literal("skill.use"), sessionId: id, capabilityId: id, expectedDigest: hash, expectedDraftRevision: revision }),
]);
export type ExtensionCommand = Static<typeof ExtensionCommandSchema>;
export const isExtensionCommand = (value: unknown): value is ExtensionCommand => Value.Check(ExtensionCommandSchema, value);
export const ExtensionQuerySchema = Type.Union([
  object({ type: Type.Literal("marketplace.catalog"), input: MarketplaceSourceSchema }),
  object({ type: Type.Literal("marketplace.preview"), input: MarketplaceInputSchema }),
  object({ type: Type.Literal("capability.history"), capabilityId: id, offset: Type.Integer({ minimum: 0 }) }),
  object({ type: Type.Literal("capability.version"), capabilityId: id, contentDigest: hash }),
]);
export type ExtensionQuery = Static<typeof ExtensionQuerySchema>;
export const isExtensionQuery = (value: unknown): value is ExtensionQuery => Value.Check(ExtensionQuerySchema, value);
export type ExtensionResponse =
  | { type: "marketplace.catalog"; catalog: MarketplaceCatalogListing }
  | { type: "marketplace.preview"; preview: MarketplacePreview }
  | { type: "capability.history"; entries: CapabilityEntry[]; nextOffset: number | null }
  | { type: "capability.version"; entry: CapabilityEntry; content: string };
