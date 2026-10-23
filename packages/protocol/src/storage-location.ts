import { Type, type Static } from "typebox";

const path = Type.String({ minLength: 1, maxLength: 4096 });
export interface StorageMoveReview {
  source: string; destination: string; resourceBase: string; keyId: string; digest: string;
  profiles: string[]; activeOwners: string[]; copySet: ["state.sqlite"]; destinationIdentity: string;
}
export interface StorageMove {
  id: string; review: StorageMoveReview; status: "preparing" | "published" | "completed" | "partial";
  databaseDigest: string | null; diagnostic: string | null;
}
export interface StorageStatus {
  enabled: boolean; directory: string; resourceBase: string; locatorDirectory: string | null; explicitOverride: boolean; operation: StorageMove | null; diagnostic: string | null;
}
export const StateLocationSchema = Type.Object({
  schemaVersion: Type.Literal(1), keyId: Type.String({ pattern: "^[A-Za-z0-9_-]{1,128}$" }), dataDir: path, resourceBase: path,
  move: Type.Object({
    id: Type.String({ pattern: "^[a-f0-9-]{36}$" }), source: path, destination: path, ownerPid: Type.Integer({ minimum: 1 }),
    status: Type.Union([Type.Literal("moving"), Type.Literal("published"), Type.Literal("completed"), Type.Literal("partial")]),
    databaseDigest: Type.Union([Type.String({ pattern: "^[a-f0-9]{128}$" }), Type.Null()]),
    diagnostic: Type.Union([Type.String({ maxLength: 4096 }), Type.Null()]),
  }, { additionalProperties: false }),
}, { additionalProperties: false });
export type StateLocation = Static<typeof StateLocationSchema>;
export const StorageQuerySchema = Type.Union([
  Type.Object({ type: Type.Literal("application.storage.status") }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("application.storage.preview"), path }, { additionalProperties: false }),
]);
export const StorageMoveRequestSchema = Type.Object({
  action: Type.Literal("storage-relocate"), id: Type.String({ pattern: "^[a-f0-9-]{36}$" }), path,
  expectedDigest: Type.String({ pattern: "^[a-f0-9]{64}$" }), confirm: Type.Literal(true),
}, { additionalProperties: false });
export type StorageQuery = Static<typeof StorageQuerySchema>;
export type StorageMoveRequest = Static<typeof StorageMoveRequestSchema>;
export type StorageResponse = { type: "application.storage.status"; storage: StorageStatus } | { type: "application.storage.preview"; review: StorageMoveReview };
