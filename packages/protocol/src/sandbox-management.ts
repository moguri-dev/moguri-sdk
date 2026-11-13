import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";
import type { SandboxConfiguration } from "./sandbox.ts";

const object = <T extends Record<string, TSchema>>(properties: T) => Type.Object(properties, { additionalProperties: false });
const id = Type.String({ minLength: 1, maxLength: 128 });
const path = Type.String({ minLength: 1, maxLength: 4096 });
const hash = Type.String({ pattern: "^[a-f0-9]{64}$" });
const sha512 = Type.String({ pattern: "^[a-f0-9]{128}$" });
const revision = Type.Integer({ minimum: 0 });
export const SandboxVersionSchema = Type.String({ pattern: "^[0-9]{1,3}\\.[0-9]{1,3}\\.[0-9]{1,3}(?:-[a-zA-Z0-9.-]{1,40})?$", maxLength: 64 });
export const SandboxManagementSchema = object({
  enabled: Type.Boolean(), version: SandboxVersionSchema, automaticUpdates: Type.Boolean(),
  automaticWorkspaces: Type.Boolean(), automaticProviderNetwork: Type.Boolean(),
});
export type SandboxManagement = Static<typeof SandboxManagementSchema>;
export const defaultSandboxManagement = (): SandboxManagement => ({
  enabled: false, version: "0.2.6", automaticUpdates: true, automaticWorkspaces: true, automaticProviderNetwork: true,
});
export interface SandboxNetworkScope {
  version: 1; reviewedConfigDigest: string; providerUrls: string[]; providerHosts: string[];
  aliases: Array<{ host: string; targets: string[] }>; allowedDomains: string[]; resolvedAt: string;
}
const artifact = object({ path, bytes: Type.Integer({ minimum: 1, maximum: 2 * 1024 * 1024 * 1024 }), sha512 });
export const SandboxVendorSchema = object({
  version: SandboxVersionSchema, repository: Type.Literal("mbianchidev/sendbox"), archiveSha256: hash,
  hostSha256: hash, keySha256: hash, manifestSha256: hash, trustRootId: id,
  minimumReleaseSequence: Type.Integer({ minimum: 7, maximum: Number.MAX_SAFE_INTEGER }),
  installer: artifact,
});
export const SandboxDistributionSchema = object({
  format: Type.Literal("moguri-sandbox-distribution"), version: Type.Literal(1),
  protocol: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }), nodeVersion: Type.Literal("26.12.0"),
  vendor: SandboxVendorSchema,
  worker: object({
    image: Type.String({ pattern: "^[a-zA-Z0-9][a-zA-Z0-9._/:-]*@sha256:[a-f0-9]{64}$", maxLength: 4096 }),
    workerDigest: hash, bridgeDigest: hash, mcpWorkerDigest: hash, payloadDigest: hash, archive: artifact,
  }),
});
export type SandboxVendor = Static<typeof SandboxVendorSchema>;
export type SandboxDistribution = Static<typeof SandboxDistributionSchema>;
export const SandboxReleaseSchema = object({
  version: SandboxVersionSchema, repository: Type.Literal("mbianchidev/sendbox"),
  releaseId: Type.Integer({ minimum: 1 }), assetId: Type.Integer({ minimum: 1 }),
  archiveName: Type.String({ pattern: "^sendbox-[0-9A-Za-z.-]+-macos-arm64\\.tar\\.gz$", maxLength: 160 }),
  bytes: Type.Integer({ minimum: 1, maximum: 128 * 1024 * 1024 }), sha256: hash,
  publishedAt: Type.String({ maxLength: 40 }),
});
export type SandboxRelease = Static<typeof SandboxReleaseSchema>;
export const SandboxSetupOperationSchema = object({
  version: Type.Literal(1), id, profileId: id, revision,
  kind: Type.Union([Type.Literal("check"), Type.Literal("prepare"), Type.Literal("apply"), Type.Literal("qualify")]),
  status: Type.Union([
    Type.Literal("checking"), Type.Literal("available"), Type.Literal("preparing"), Type.Literal("review"),
    Type.Literal("installing"), Type.Literal("importing"), Type.Literal("verifying"),
    Type.Literal("completed"), Type.Literal("failed"), Type.Literal("cancelled"), Type.Literal("partial"),
  ]),
  commandId: id, commandDigest: hash, automatic: Type.Boolean(), createdAt: Type.String({ maxLength: 40 }), updatedAt: Type.String({ maxLength: 40 }),
  selectedVersion: SandboxVersionSchema, release: Type.Union([SandboxReleaseSchema, Type.Null()]),
  distributionDigest: Type.Union([hash, Type.Null()]), reviewDigest: Type.Union([hash, Type.Null()]),
  sourceDirectory: Type.Union([path, Type.Null()]), destination: Type.Union([path, Type.Null()]),
  installerSha512: Type.Union([sha512, Type.Null()]), diagnostic: Type.Union([Type.String({ minLength: 1, maxLength: 4096 }), Type.Null()]),
  acceptance: Type.Union([object({ actor: Type.Literal("user"), commandId: id, commandDigest: hash, reviewDigest: hash }), Type.Null()]),
});
export type SandboxSetupOperation = Static<typeof SandboxSetupOperationSchema>;
export interface SandboxSetupReview {
  digest: string; distributionDigest: string; settingsRevision: number; version: string; protocol: number;
  configuration: SandboxConfiguration; management: SandboxManagement;
  installed: boolean; administratorRequired: boolean; destination: string; installerPath: string;
  installerSha512: string; installerBytes: number; imageArchivePath: string; imageArchiveSha512: string; imageArchiveBytes: number;
  diagnostic: string;
}
export interface SandboxSetupStatus {
  supported: boolean; bundledVersion: string | null; selectedVersion: string; automaticUpdates: boolean;
  operation: SandboxSetupOperation | null; availableRelease: SandboxRelease | null; diagnostic: string;
}
export const SandboxSetupCommandSchema = Type.Union([
  object({ type: Type.Literal("sandbox.setup.check"), automatic: Type.Optional(Type.Boolean()) }),
  object({ type: Type.Literal("sandbox.setup.prepare"), version: SandboxVersionSchema, confirm: Type.Literal(true) }),
  object({ type: Type.Literal("sandbox.setup.apply"), version: SandboxVersionSchema, expectedDigest: hash, expectedRevision: revision, confirm: Type.Literal(true) }),
  object({ type: Type.Literal("sandbox.setup.cancel"), operationId: id }),
]);
export type SandboxSetupCommand = Static<typeof SandboxSetupCommandSchema>;
export const isSandboxSetupCommand = (value: unknown): value is SandboxSetupCommand => Value.Check(SandboxSetupCommandSchema, value);
export const SandboxSetupQuerySchema = Type.Union([
  object({ type: Type.Literal("sandbox.setup.status") }),
  object({ type: Type.Literal("sandbox.setup.review"), version: Type.Optional(SandboxVersionSchema) }),
  object({ type: Type.Literal("sandbox.setup.operation"), operationId: id }),
]);
export type SandboxSetupQuery = Static<typeof SandboxSetupQuerySchema>;
export const isSandboxSetupQuery = (value: unknown): value is SandboxSetupQuery => Value.Check(SandboxSetupQuerySchema, value);
export type SandboxSetupResponse =
  | { type: "sandbox.setup.status"; setup: SandboxSetupStatus }
  | { type: "sandbox.setup.operation"; operation: SandboxSetupOperation }
  | { type: "sandbox.setup.review"; review: SandboxSetupReview };
