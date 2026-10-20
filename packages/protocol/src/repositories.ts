import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";

const object = <T extends Record<string, TSchema>>(properties: T) => Type.Object(properties, { additionalProperties: false });
const id = Type.String({ minLength: 1, maxLength: 128 }), hash = Type.String({ pattern: "^[a-f0-9]{64}$" });
const nullable = <T extends TSchema>(schema: T) => Type.Union([schema, Type.Null()]);
const integer = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const access = Type.Union([Type.Literal("public"), Type.Literal("gh-cli")]);
const boundary = Type.Union([Type.Literal("control-plane-public"), Type.Literal("control-plane-gh-cli")]);
export const RepositoryMetadataSchema = object({
  id: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }), url: Type.String({ maxLength: 512 }), fullName: Type.String({ maxLength: 256 }),
  owner: id, ownerKind: Type.Union([Type.Literal("organization"), Type.Literal("user")]),
  visibility: Type.Union([Type.Literal("public"), Type.Literal("private"), Type.Literal("internal")]),
  licenseId: nullable(Type.String({ maxLength: 100 })), osiApproved: nullable(Type.Boolean()), publicOsiLicensed: nullable(Type.Boolean()),
  licenseData: Type.String({ maxLength: 128 }), observedAt: Type.String({ maxLength: 40 }),
});
export type RepositoryMetadata = Static<typeof RepositoryMetadataSchema>;
export const RepositoryAttributionSchema = object({ ...RepositoryMetadataSchema.properties, observationId: id, scopeDigest: hash });
export type RepositoryAttribution = Static<typeof RepositoryAttributionSchema>;
export const RepositoryDiagnosticSchema = Type.Union([
  Type.Literal("not-configured"), Type.Literal("scope-changed"), Type.Literal("repository-changed"), Type.Literal("read-unavailable"),
]);
export type RepositoryDiagnostic = Static<typeof RepositoryDiagnosticSchema>;
export const RepositoryObservationSchema = object({
  id, scopeKey: hash, scopeDigest: hash, revision: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
  profileId: id, projectId: id, workspaceId: nullable(id), env: Type.Union([Type.Literal("Local"), Type.Literal("Remote")]),
  status: Type.Union([Type.Literal("active"), Type.Literal("cleared")]), actor: Type.Literal("user"), jobId: nullable(id),
  access, lookupBoundary: boundary, repository: nullable(RepositoryMetadataSchema), createdAt: Type.String({ maxLength: 40 }), updatedAt: Type.String({ maxLength: 40 }),
});
export type RepositoryObservation = Static<typeof RepositoryObservationSchema>;
export interface RepositoryScope {
  scopeKey: string; scopeDigest: string; profileId: string; projectId: string; workspaceId: string | null; env: "Local" | "Remote";
  root: string; access: "public" | "gh-cli";
}
export interface RepositoryPreview extends RepositoryScope {
  bindingDigest: string; repository: string; revision: number; lookupBoundary: "control-plane-public" | "control-plane-gh-cli";
}
export interface RepositoryCapture { repository: RepositoryAttribution | null; repositoryDiagnostic: RepositoryDiagnostic | null }
export interface RepositoryCoverage { attributedCalls: number; unattributedCalls: number; unverifiedLicenseCalls: number }
export const RepositoryFiltersSchema = object({
  repositoryId: Type.Optional(Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER })), organization: Type.Optional(id),
  visibility: Type.Optional(Type.Union([Type.Literal("public"), Type.Literal("private"), Type.Literal("internal"), Type.Literal("open-source")])),
});
export type RepositoryFilters = Static<typeof RepositoryFiltersSchema>;
export const RepositoryCommandSchema = Type.Union([
  object({ type: Type.Literal("repository.refresh"), sessionId: id, expectedBinding: hash, expectedRevision: integer, confirm: Type.Literal(true) }),
  object({ type: Type.Literal("repository.clear"), sessionId: id, expectedRevision: integer, confirm: Type.Literal(true) }),
]);
export const RepositoryQuerySchema = Type.Union([
  object({ type: Type.Literal("repository.preview"), sessionId: id }),
  object({ type: Type.Literal("repository.state"), sessionId: id }),
]);
export type RepositoryCommand = Static<typeof RepositoryCommandSchema>;
export type RepositoryQuery = Static<typeof RepositoryQuerySchema>;
export const isRepositoryCommand = (value: unknown): value is RepositoryCommand => Value.Check(RepositoryCommandSchema, value);
export const isRepositoryQuery = (value: unknown): value is RepositoryQuery => Value.Check(RepositoryQuerySchema, value);
export type RepositoryResponse =
  | { type: "repository.preview"; preview: RepositoryPreview }
  | { type: "repository.state"; observation: RepositoryObservation | null };
