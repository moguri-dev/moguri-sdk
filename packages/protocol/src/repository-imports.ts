import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";
import { MoguriError } from "./core.ts";
import { ProjectCloneIntentSchema, SessionHomeRootSchema } from "./sessions.ts";

const object = <T extends Record<string, TSchema>>(properties: T) => Type.Object(properties, { additionalProperties: false });
const id = Type.String({ minLength: 1, maxLength: 128 }), hash = Type.String({ pattern: "^[a-f0-9]{64}$" });
const path = Type.String({ minLength: 1, maxLength: 4096 }), url = Type.String({ minLength: 1, maxLength: 2048 });
const nullable = <T extends TSchema>(schema: T) => Type.Union([schema, Type.Null()]);
const count = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const timestamp = Type.String({ format: "date-time" });
const disposition = Type.Union([
  Type.Literal("clone"), Type.Literal("register"), Type.Literal("registered"), Type.Literal("duplicate"),
  Type.Literal("invalid"), Type.Literal("blocked"),
]);
export const RepositoryImportInputSchema = object({ text: Type.String({ minLength: 1, maxLength: 65536 }), parent: path });
export type RepositoryImportInput = Static<typeof RepositoryImportInputSchema>;
export const RepositoryImportEntrySchema = object({
  line: Type.Integer({ minimum: 1, maximum: 10000 }), source: Type.String({ maxLength: 2048 }),
  repository: nullable(url), identity: nullable(url), path: nullable(path), projectId: nullable(id), disposition,
  diagnostic: nullable(Type.String({ minLength: 1, maxLength: 2000 })),
  root: Type.Optional(SessionHomeRootSchema), commonDir: Type.Optional(path), remote: Type.Optional(url),
});
export type RepositoryImportEntry = Static<typeof RepositoryImportEntrySchema>;
export const RepositoryImportReviewSchema = object({
  format: Type.Literal("moguri-repository-import"), version: Type.Literal(1), profileId: id,
  input: RepositoryImportInputSchema, parent: SessionHomeRootSchema,
  policyRevision: count, permissionRevision: count, registrationsDigest: hash,
  warnings: Type.Array(Type.String({ minLength: 1, maxLength: 2000 }), { maxItems: 1000 }),
  entries: Type.Array(RepositoryImportEntrySchema, { minItems: 1, maxItems: 100 }),
});
export type RepositoryImportReview = Static<typeof RepositoryImportReviewSchema>;
export interface RepositoryImportPreview { document: RepositoryImportReview; digest: string }
const itemStatus = Type.Union([
  Type.Literal("pending"), Type.Literal("running"), Type.Literal("imported"), Type.Literal("registered"),
  Type.Literal("duplicate"), Type.Literal("failed"), Type.Literal("cancelled"), Type.Literal("partial"),
]);
export const RepositoryImportItemSchema = object({
  line: Type.Integer({ minimum: 1, maximum: 10000 }), repository: url, identity: url, path, projectId: nullable(id),
  disposition: Type.Union([Type.Literal("clone"), Type.Literal("register"), Type.Literal("registered"), Type.Literal("duplicate")]),
  status: itemStatus, diagnostic: nullable(Type.String({ minLength: 1, maxLength: 2000 })),
  clone: Type.Optional(ProjectCloneIntentSchema), root: Type.Optional(SessionHomeRootSchema), commonDir: Type.Optional(path), remote: Type.Optional(url),
  inspection: Type.Optional(object({ actor: Type.Literal("user"), commandId: id, commandDigest: hash, at: timestamp, observedRevision: count })),
});
export type RepositoryImportItem = Static<typeof RepositoryImportItemSchema>;
export const RepositoryImportBatchSchema = object({
  version: Type.Literal(1), id, profileId: id, commandId: id, commandDigest: hash, inputDigest: hash, reviewDigest: hash, jobId: id,
  revision: count, policyRevision: count, permissionRevision: count,
  status: Type.Union([Type.Literal("running"), Type.Literal("completed"), Type.Literal("failed"), Type.Literal("cancelled"), Type.Literal("partial")]),
  cancelRequested: Type.Boolean(), leaseRoots: Type.Array(path, { maxItems: 1000, uniqueItems: true }),
  items: Type.Array(RepositoryImportItemSchema, { minItems: 1, maxItems: 100 }), createdAt: timestamp, updatedAt: timestamp,
  diagnostic: nullable(Type.String({ minLength: 1, maxLength: 2000 })),
});
export type RepositoryImportBatch = Static<typeof RepositoryImportBatchSchema>;
export const RepositoryImportCommandSchema = Type.Union([
  object({ type: Type.Literal("projects.import.start"), input: RepositoryImportInputSchema, expectedDigest: hash, confirm: Type.Literal(true) }),
  object({ type: Type.Literal("projects.import.acknowledge"), batchId: id, line: Type.Integer({ minimum: 1, maximum: 10000 }), expectedRevision: count, confirmInspection: Type.Literal(true) }),
]);
export const RepositoryImportQuerySchema = Type.Union([
  object({ type: Type.Literal("projects.import.preview"), input: RepositoryImportInputSchema }),
  object({ type: Type.Literal("projects.import.read"), batchId: id }),
]);
export type RepositoryImportCommand = Static<typeof RepositoryImportCommandSchema>;
export type RepositoryImportQuery = Static<typeof RepositoryImportQuerySchema>;
export type RepositoryImportResponse =
  | { type: "projects.import.preview"; preview: RepositoryImportPreview }
  | { type: "projects.import.read"; batch: RepositoryImportBatch; review: RepositoryImportReview };
export const isRepositoryImportCommand = (value: unknown): value is RepositoryImportCommand => Value.Check(RepositoryImportCommandSchema, value);
export const isRepositoryImportQuery = (value: unknown): value is RepositoryImportQuery => Value.Check(RepositoryImportQuerySchema, value);
export const successfulImportItem = (item: RepositoryImportItem): boolean => ["imported", "registered", "duplicate"].includes(item.status);
export const repositoryImportRoots = (batch: RepositoryImportBatch): string[] => batch.status === "running" ? batch.leaseRoots :
  batch.items.filter((item) => item.status === "partial" && !item.inspection).map((item) => item.path);

export function projectRepositoryImport(previous: RepositoryImportBatch | undefined, value: unknown): RepositoryImportBatch {
  const corrupt = (): never => { throw new MoguriError("repository_import_corrupt", "Repository import lost its original profile, reviewed destinations or monotonic outcomes. State was preserved; no item was replayed.", 409); };
  if (!Value.Check(RepositoryImportBatchSchema, value)) return corrupt();
  const next = value;
  if (new Set(next.items.map((item) => item.line)).size !== next.items.length ||
    next.leaseRoots.some((root) => !root.startsWith("/") || root.includes("\0") || !next.items.some((item) =>
      ["clone", "register"].includes(item.disposition) && (item.path === root || item.path.startsWith(`${root}/`)))) ||
    next.items.some((item) => item.clone && (item.disposition !== "clone" || item.clone.path !== item.path || item.clone.projectId !== item.projectId ||
      item.clone.repository !== item.repository || item.clone.policyRevision !== next.policyRevision || item.clone.commandDigest !== next.commandDigest ||
      item.clone.commandId !== next.commandId || !item.clone.leaseRoots.includes(item.path) || item.clone.leaseRoots.some((root) => !next.leaseRoots.includes(root))) ||
      ["clone", "register"].includes(item.disposition) && !next.leaseRoots.includes(item.path) ||
      item.root && item.root.root !== item.path ||
      item.disposition === "clone" && !item.clone || !item.path.startsWith("/") || item.path.includes("\0") ||
      ["failed", "partial", "cancelled"].includes(item.status) && !item.diagnostic ||
      item.status === "imported" && (item.disposition !== "clone" || !item.projectId) ||
      item.status === "registered" && !["register", "registered"].includes(item.disposition) ||
      item.status === "duplicate" && item.disposition !== "duplicate" ||
      item.inspection && (item.status !== "partial" || item.inspection.commandId === next.commandId ||
        !Number.isFinite(Date.parse(item.inspection.at)) || new Date(item.inspection.at).toISOString() !== item.inspection.at)) ||
    next.status === "completed" && (next.cancelRequested || !next.items.every(successfulImportItem) || next.diagnostic !== null) ||
    next.status !== "running" && next.status !== "completed" && !next.diagnostic ||
    next.status !== "running" && next.items.some((item) => ["pending", "running"].includes(item.status)) ||
    [next.createdAt, next.updatedAt].some((at) => !Number.isFinite(Date.parse(at)) || new Date(at).toISOString() !== at)) return corrupt();
  if (!previous) {
    if (next.revision !== 0 || next.status !== "running" || next.cancelRequested || next.diagnostic !== null ||
      next.createdAt !== next.updatedAt || next.items.some((item) => item.inspection || item.status !== (item.disposition === "registered" ? "registered" : item.disposition === "duplicate" ? "duplicate" : "pending"))) return corrupt();
  } else {
    if (previous.status !== "running") {
      const mutable = new Set(["revision", "items", "updatedAt"]);
      if (next.revision !== previous.revision + 1 || previous.items.length !== next.items.length ||
        Object.entries(previous).some(([key, entry]) => !mutable.has(key) && JSON.stringify(entry) !== JSON.stringify(next[key as keyof RepositoryImportBatch]))) return corrupt();
      let acknowledgements = 0;
      for (let index = 0; index < previous.items.length; index++) {
        const before = previous.items[index]!, after = next.items[index]!;
        if (JSON.stringify(before) === JSON.stringify(after)) continue;
        if (before.status !== "partial" || before.inspection || !after.inspection ||
          after.inspection.observedRevision !== previous.revision || after.inspection.at !== next.updatedAt ||
          Object.entries(before).some(([key, entry]) => JSON.stringify(entry) !== JSON.stringify(after[key as keyof RepositoryImportItem])) ||
          Object.keys(after).some((key) => key !== "inspection" && !Object.hasOwn(before, key))) return corrupt();
        acknowledgements++;
      }
      if (acknowledgements !== 1) return corrupt();
      return structuredClone(next);
    }
    const mutable = new Set(["revision", "status", "items", "cancelRequested", "updatedAt", "diagnostic"]);
    if (next.revision !== previous.revision + 1 ||
      previous.cancelRequested && !next.cancelRequested || next.items.length !== previous.items.length ||
      Object.entries(previous).some(([key, entry]) => !mutable.has(key) && JSON.stringify(entry) !== JSON.stringify(next[key as keyof RepositoryImportBatch]))) return corrupt();
    for (let index = 0; index < previous.items.length; index++) {
      const before = previous.items[index]!, after = next.items[index]!;
      if (Object.entries(before).some(([key, entry]) => !["status", "diagnostic"].includes(key) && JSON.stringify(entry) !== JSON.stringify(after[key as keyof RepositoryImportItem])) ||
        Object.keys(after).some((key) => !["status", "diagnostic"].includes(key) && !Object.hasOwn(before, key)) ||
        before.status !== after.status && !(before.status === "pending" && ["running", "cancelled"].includes(after.status) ||
          before.status === "running" && ["imported", "registered", "failed", "cancelled", "partial"].includes(after.status)) ||
        !["pending", "running"].includes(before.status) && JSON.stringify(before) !== JSON.stringify(after)) return corrupt();
    }
  }
  return structuredClone(next);
}
