import { Type, type Static } from "typebox";

/** The release repository before and after its planned move to the moguri-dev organization (#93). Both stay accepted so installed apps follow the transfer. */
export const MOGURI_RELEASE_REPOSITORIES = ["mbianchidev/moguri", "moguri-dev/moguri-desktop"] as const;
export type MoguriReleaseRepository = typeof MOGURI_RELEASE_REPOSITORIES[number];
export const UPDATE_TOKEN_CREATION_URL = "https://github.com/settings/personal-access-tokens/new?name=Moguri+updates&description=Read+Moguri+release+assets&expires_in=30&contents=read";
export const UPDATE_TOKEN_GUIDANCE = [
  "You only need a token while the Moguri release repository is private, or to raise GitHub's anonymous rate limit. Public releases update without one.",
  "Resource owner: the owner of the Moguri release repository, mbianchidev for mbianchidev/moguri or moguri-dev once it moves to moguri-dev/moguri-desktop. Your account must already have access to it.",
  "Repository access: Only select repositories, then select that repository. The link cannot preselect the owner or repository for you.",
  "Repository permissions: Contents, Read-only. Metadata read access is included by GitHub. No write, Actions, Workflows or administration permissions are needed.",
  "Keep a short expiration, such as 30 days. If an organization requires approval or SSO, finish that requirement on GitHub before checking updates.",
  "Generate the token yourself and paste it only into Release access token. Moguri stores it in the secure updater credential backend, never chat or project settings.",
] as const;
export const HOMEBREW_UPGRADE_COMMAND = "brew upgrade --cask moguri";

const hash = Type.String({ pattern: "^[a-f0-9]{128}$" });
export const UpdateManifestSchema = Type.Object({
  schemaVersion: Type.Literal(1), repository: Type.Union([Type.Literal(MOGURI_RELEASE_REPOSITORIES[0]), Type.Literal(MOGURI_RELEASE_REPOSITORIES[1])]), version: Type.String({ minLength: 1, maxLength: 100 }),
  arch: Type.Union([Type.Literal("arm64"), Type.Literal("x64")]), bundleId: Type.Literal("dev.moguri.app"), bundleSha512: hash,
  archive: Type.Object({ name: Type.String({ minLength: 1, maxLength: 200 }), bytes: Type.Integer({ minimum: 1, maximum: 1024 * 1024 * 1024 }), sha512: hash }, { additionalProperties: false }),
}, { additionalProperties: false });
export type UpdateManifest = Static<typeof UpdateManifestSchema>;
export interface UpdateRelease { repositoryId: number; releaseId: number; manifestAssetId: number; archiveAssetId: number; manifest: UpdateManifest }
export interface UpdateInstallReview {
  id: string; version: string; destination: string; stagedBundle: string; candidateSibling: string; backup: string; oldBundleSha512: string; bundleSha512: string; digest: string;
}
export interface UpdateInstallation { review: UpdateInstallReview; helperDirectory: string; journal: string; requestedProfileId: string; helperPid?: number; intentDigest?: string }
export interface ApplicationUpdate {
  id: string; commandId: string; status: "checking" | "downloading" | "cancelling" | "ready" | "failed" | "cancelled" | "partial" | "installing" | "installed" | "completed";
  currentVersion: string; release: UpdateRelease | null; stagedBundle: string | null; installation: UpdateInstallation | null; diagnostic: string | null;
}
export interface UpdateStatus {
  enabled: boolean; currentVersion: string; credential: "unobserved" | "configured" | "missing" | "failed"; installable: boolean;
  /** A package manager that owns this installation; the app then never replaces itself and points to that manager instead. */
  manager: "homebrew" | null;
  operation: ApplicationUpdate | null; diagnostic: string | null;
}
export const UpdateCommandSchema = Type.Union([
  Type.Object({ type: Type.Literal("application.update.check"), automatic: Type.Boolean() }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("application.update.cancel"), id: Type.String({ pattern: "^[a-f0-9-]{36}$" }) }, { additionalProperties: false }),
]);
export type UpdateCommand = Static<typeof UpdateCommandSchema>;
export const UpdateQuerySchema = Type.Union([
  Type.Object({ type: Type.Literal("application.update.status") }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("application.update.credential") }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("application.update.history") }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("application.update.read"), id: Type.String({ pattern: "^[a-f0-9-]{36}$" }) }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("application.update.install_preview"), id: Type.String({ pattern: "^[a-f0-9-]{36}$" }) }, { additionalProperties: false }),
]);
export type UpdateQuery = Static<typeof UpdateQuerySchema>;
export const isUpdateQuery = (value: { type: string }): value is UpdateQuery => value.type.startsWith("application.update.");
export type UpdateResponse = { type: "application.update.status"; update: UpdateStatus } | { type: "application.update.credential"; update: UpdateStatus } |
  { type: "application.update.history"; updates: ApplicationUpdate[] } | { type: "application.update.read"; update: ApplicationUpdate } |
  { type: "application.update.install_preview"; review: UpdateInstallReview };
export const UpdateTokenRequestSchema = Type.Object({ action: Type.Literal("update-token"), token: Type.Union([Type.String({ minLength: 20, maxLength: 512 }), Type.Null()]) }, { additionalProperties: false });
export const UpdateInstallRequestSchema = Type.Object({
  action: Type.Literal("update-install"), id: Type.String({ pattern: "^[a-f0-9-]{36}$" }), expectedDigest: Type.String({ pattern: "^[a-f0-9]{64}$" }),
  desktopPid: Type.Integer({ minimum: 2 }), confirm: Type.Literal(true),
}, { additionalProperties: false });
export type UpdateInstallRequest = Static<typeof UpdateInstallRequestSchema>;
export const UpdateInstallerIntentSchema = Type.Object({
  schemaVersion: Type.Literal(1), id: Type.String({ pattern: "^[a-f0-9-]{36}$" }), keyId: Type.String({ minLength: 1, maxLength: 128 }),
  version: Type.String({ minLength: 1, maxLength: 100 }), arch: Type.Union([Type.Literal("arm64"), Type.Literal("x64")]),
  destination: Type.String(), candidate: Type.String(), backup: Type.String(), journal: Type.String(),
  oldBundleSha512: hash, bundleSha512: hash, servicePid: Type.Integer({ minimum: 2 }), desktopPid: Type.Integer({ minimum: 2 }),
  runtime: Type.Object({ path: Type.String(), sha512: hash }, { additionalProperties: false }),
  helper: Type.Object({ path: Type.String(), sha512: hash }, { additionalProperties: false }),
}, { additionalProperties: false });
export type UpdateInstallerIntent = Static<typeof UpdateInstallerIntentSchema>;
export const UpdateInstallJournalSchema = Type.Object({
  schemaVersion: Type.Literal(1), id: Type.String({ pattern: "^[a-f0-9-]{36}$" }), intentDigest: Type.String({ pattern: "^[a-f0-9]{64}$" }),
  state: Type.Union([Type.Literal("prepared"), Type.Literal("armed"), Type.Literal("replacing"), Type.Literal("installed"), Type.Literal("partial"), Type.Literal("cancelled")]),
  diagnostic: Type.Union([Type.String({ maxLength: 4096 }), Type.Null()]),
}, { additionalProperties: false });
export type UpdateInstallJournal = Static<typeof UpdateInstallJournalSchema>;
