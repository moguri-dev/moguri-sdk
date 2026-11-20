import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, chmod, copyFile, cp, lstat, mkdir, open, realpath } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import semver from "semver";
import { Type } from "typebox";
import {
  GLOBAL_PROFILE_ID, MoguriError, parse, UpdateManifestSchema, type ApplicationUpdate, type CommandResult, type UpdateCommand, type UpdateRelease, type UpdateStatus,
  type UpdateInstallRequest, type UpdateInstallReview, type UpdateInstallerIntent,
} from "../../../packages/protocol/src/index.ts";
import { McpKeychain, type SecretVault } from "./gateway.ts";
import { boundedBody } from "./network.ts";
import { EventStore } from "./store.ts";
import { stageUpdateArchive } from "./update-archive.ts";
import type { WorkspaceFinish } from "./session-workspace.ts";
import { bundleTreeSha512, fileSha512, verifyBundleIdentity, verifyStandaloneInstallerRuntime } from "./bundle-tree.ts";
import { readInstallJournal, writeInstallJournal } from "./update-installation.ts";
import { redactSecrets } from "./secret-redactor.ts";

declare const __MOGURI_BUILD_VERSION__: string | undefined;
export const runtimeBuildVersion = () => typeof __MOGURI_BUILD_VERSION__ === "string" ? __MOGURI_BUILD_VERSION__ : "development";
const repository = "https://api.github.com/repos/mbianchidev/moguri";
const integer = Type.Integer({ minimum: 1 }), text = Type.String({ minLength: 1, maxLength: 200 });
const Asset = Type.Object({ id: integer, name: text, size: Type.Integer({ minimum: 1, maximum: 1024 * 1024 * 1024 }) });
const Release = Type.Object({ id: integer, tag_name: text, draft: Type.Boolean(), prerelease: Type.Boolean(), published_at: Type.Union([Type.String(), Type.Null()]), assets: Type.Array(Asset, { maxItems: 1000 }) });
const apiHeaders = (token: string | null, accept = "application/vnd.github+json") => ({
  Accept: accept, "User-Agent": "Moguri-updater", "X-GitHub-Api-Version": "2022-11-28", ...(token ? { Authorization: `Bearer ${token}` } : {}),
});
// Without a saved token the updater reads the public upstream releases anonymously; a saved token is always used and never silently dropped.
async function releaseFailure(response: Response, token: string | null): Promise<MoguriError> {
  const limited = [403, 429].includes(response.status) && response.headers.get("x-ratelimit-remaining") === "0";
  await response.body?.cancel();
  if (limited) return new MoguriError("update_rate_limited", token
    ? "GitHub's rate limit for the saved update token was reached. Try again later. Nothing was downloaded."
    : "GitHub's anonymous rate limit was reached. Try again later, or save a read-only update token to raise the limit. Nothing was downloaded.", 429);
  if (!token && [401, 403, 404].includes(response.status)) return new MoguriError("update_public_unavailable",
    "Public Moguri releases aren't reachable without a token. While mbianchidev/moguri is private, save a read-only update token in General. Nothing was downloaded.", 404);
  return new MoguriError("update_http", `GitHub returned HTTP ${response.status} for Moguri releases. ${token ? "Check the saved token's read-only Contents access to mbianchidev/moguri." : "Try again later."} No other account was used.`, 502);
}
async function releaseJson(fetcher: typeof fetch, url: string, token: string | null, signal: AbortSignal): Promise<unknown> {
  const response = await fetcher(url, { headers: apiHeaders(token), signal, redirect: "error" });
  if (!response.ok) throw await releaseFailure(response, token);
  try { return JSON.parse((await boundedBody(response, 2 * 1024 * 1024, signal)).toString("utf8")); }
  catch (error) { if (error instanceof SyntaxError) throw new MoguriError("update_format", "GitHub returned invalid release JSON. Nothing was downloaded.", 502); throw error; }
}
export interface UpdateOptions {
  version: string; arch?: "arm64" | "x64"; fetch?: typeof fetch; vault?: SecretVault;
  installationRoot?: string; quarantine?: (path: string, id: string) => Promise<void>;
  installerSource?: string; installerRuntime?: string;
}
export class ApplicationUpdates {
  private readonly records = new Map<string, ApplicationUpdate>();
  private active?: { id: string; abort: AbortController; done: Promise<void> };
  private credential: UpdateStatus["credential"] = "unobserved";
  private readonly vault: SecretVault;
  private readonly root: string;
  private closed = false;
  private readonly keyId: string;
  private installer?: { child: ChildProcess; id: string; digest: string; journal: string; armed: boolean };
  private preparing?: { abort: AbortController; done: Promise<{ id: string; journal: string; intentDigest: string }> };
  constructor(private readonly store: EventStore, resourceBase: string, readonly options: UpdateOptions | undefined,
    private readonly automatic: () => boolean, private readonly changed: () => void) {
    const keyId = store.db.prepare("SELECT value FROM retention_metadata WHERE id='key_id'").get()?.value;
    this.keyId = String(keyId);
    this.vault = options?.vault ?? new McpKeychain(`dev.moguri.application.updates.${String(keyId)}`);
    this.root = join(resourceBase, "updates");
    for (const event of store.events()) if (event.event_type === "application.update_recorded") this.records.set(event.payload.update.id, event.payload.update);
    for (const value of this.records.values()) if (["checking", "downloading", "cancelling"].includes(value.status)) this.record({ ...value, status: "partial",
      diagnostic: "The original update was interrupted. Exact staged/backup bytes are retained; no download, install or restart was replayed." });
  }
  status(): UpdateStatus {
    const enabled = Boolean(this.options && semver.valid(this.options.version) && process.platform === "darwin");
    return { enabled, currentVersion: this.options?.version ?? runtimeBuildVersion(), credential: this.credential, installable: Boolean(enabled && this.options?.installationRoot),
      operation: structuredClone([...this.records.values()].at(-1) ?? null),
      diagnostic: enabled ? null : "Updates are available only in the packaged macOS app. This development build can't check for or install them." };
  }
  read(id: string): ApplicationUpdate {
    const value = this.records.get(id); if (!value) throw new MoguriError("update_missing", "This exact retained update does not exist. No newer operation was substituted.", 404);
    return structuredClone(value);
  }
  history(): ApplicationUpdate[] { return structuredClone([...this.records.values()].slice(-100).reverse()); }
  hasPendingInstallation(): boolean { return [...this.records.values()].some((record) => record.installation && !["completed", "failed", "cancelled"].includes(record.status)); }
  async initialize(): Promise<void> {
    for (const value of this.records.values()) {
      if (!value.installation || value.status === "completed") continue;
      try {
        const journal = await readInstallJournal(value.installation.journal);
        if (journal.id !== value.id || !value.installation.intentDigest || journal.intentDigest !== value.installation.intentDigest) throw new Error("The retained installer journal belongs to different or unconfirmed original work.");
        if (journal.state === "installed" && value.release && this.options?.installationRoot === value.installation.review.destination && this.options.version === value.release.manifest.version &&
          await bundleTreeSha512(this.options.installationRoot) === value.release.manifest.bundleSha512) {
          this.record({ ...value, status: "completed", diagnostic: "The new running bundle matches the exact retained installed bytes/version. No installer or model was replayed." });
        } else this.record({ ...value, status: journal.state === "installed" ? "installed" : "partial", diagnostic: journal.diagnostic ?? "Original installation is unconfirmed. Inspect its exact private journal/backup; no action was replayed." });
      } catch {
        this.record({ ...value, status: "partial", diagnostic: "The original installation receipt is missing or unverifiable. Preserved intent/backup cannot authorize another install or automatic retry." });
      }
    }
  }
  private record(update: ApplicationUpdate): void {
    this.store.commit([{ event_type: "application.update_recorded", profile_id: GLOBAL_PROFILE_ID, payload: { update } }]);
    this.records.set(update.id, update); this.changed();
  }
  async credentialStatus(): Promise<UpdateStatus> {
    try { this.credential = await this.vault.read("private-github-release", AbortSignal.timeout(15_000)) ? "configured" : "missing"; }
    catch { this.credential = "failed"; throw new MoguriError("update_secret_backend", "The updater secure secret backend could not confirm its separate PAT. No Copilot or GitHub CLI credential was read.", 409); }
    return this.status();
  }
  async setToken(token: string | null): Promise<{ configured: boolean }> {
    if (this.closed || this.active || this.preparing || this.hasPendingInstallation()) throw new MoguriError("update_busy", "Finish or cancel the original update before changing its separate credential.", 409);
    if (token !== null && !/^(?:github_pat_[A-Za-z0-9_]{20,250}|ghp_[A-Za-z0-9]{20,250})$/.test(token)) throw new MoguriError("update_pat", "Use a fine-grained (github_pat_) or classic (ghp_) GitHub token with read-only release access, without surrounding whitespace. OAuth/Copilot/CLI credentials are not substituted.");
    try {
      if (token === null) await this.vault.remove("private-github-release", AbortSignal.timeout(15_000));
      else await this.vault.write("private-github-release", token, AbortSignal.timeout(15_000));
    } catch { this.credential = "failed"; throw new MoguriError("update_secret_backend", "The separate updater PAT was not confirmed by its secure secret backend. No token was retained in events or command receipts.", 409); }
    this.credential = token === null ? "missing" : "configured"; return { configured: token !== null };
  }
  execute(command: UpdateCommand, finish: WorkspaceFinish): CommandResult {
    if (this.closed) throw new MoguriError("shutting_down", "Update ownership is closing. No new network or installation was started.", 503);
    if (command.type === "application.update.cancel") {
      const owned = this.active;
      if (!owned || owned.id !== command.id) throw new MoguriError("update_not_owned", "That exact update has no live owned operation. Inspect its retained outcome; no stop or retry was fabricated.", 409);
      const current = this.read(owned.id);
      const result = finish([{ event_type: "application.update_recorded", profile_id: GLOBAL_PROFILE_ID, payload: { update: { ...current, status: "cancelling" } } }], { id: owned.id });
      this.records.set(owned.id, { ...current, status: "cancelling" }); owned.abort.abort(); return result;
    }
    if (!this.status().enabled) throw new MoguriError("update_unqualified", this.status().diagnostic!, 409);
    if (!finish.intent) throw new MoguriError("update_intent", "An original root-owned user update command is required.", 409);
    if ([...this.records.values()].some((record) => record.commandId === finish.intent!.id)) throw new MoguriError("update_no_replay", "This original update command already has retained work. Inspect it; no network or executable was replayed.", 409);
    if (this.active) throw new MoguriError("update_busy", "One original update check/download is already owned. No duplicate was started.", 409);
    if (this.hasPendingInstallation()) throw new MoguriError("update_install_pending", "An original installation remains unconfirmed. Inspect its actual journal/backup; no new download or installation was admitted.", 409);
    const pending = [...this.records.values()].some((record) => ["partial", "installing", "installed"].includes(record.status) ||
      record.status === "ready" && record.release && semver.gt(record.release.manifest.version, this.options!.version));
    if (command.automatic && (!this.automatic() || pending)) throw new MoguriError("update_automatic_blocked", "Automatic checks are disabled or an exact staged/partial update needs review. Nothing was retried.", 409);
    const value: ApplicationUpdate = { id: randomUUID(), commandId: finish.intent.id, status: "checking", currentVersion: this.options!.version,
      release: null, stagedBundle: null, installation: null, diagnostic: null };
    const result = finish([{ event_type: "application.update_recorded", profile_id: GLOBAL_PROFILE_ID, payload: { update: value } }], { id: value.id });
    this.records.set(value.id, value);
    const secrets: string[] = [], abort = new AbortController(), done = Promise.resolve().then(() => this.check(value, abort.signal, secrets)).catch((error: unknown) => {
      const current = this.read(value.id), cancelled = abort.signal.aborted;
      const diagnostic = redactSecrets(error instanceof Error ? error.message : "Update verification failed. No executable was installed.", secrets);
      console.error("Moguri update:", cancelled ? "cancelled; original partial bytes retained" : diagnostic);
      this.record({ ...current, status: cancelled ? "cancelled" : "failed", diagnostic: cancelled ? "The original update was cancelled. Partial files remain for inspection; no installation or retry occurred." : diagnostic });
    }).finally(() => { secrets.length = 0; if (this.active?.id === value.id) this.active = undefined; });
    this.active = { id: value.id, abort, done }; return result;
  }
  private async asset(id: number, token: string | null, signal: AbortSignal): Promise<Response> {
    let url = `${repository}/releases/assets/${id}`;
    for (let redirects = 0; redirects < 4; redirects++) {
      const origin = new URL(url), api = origin.origin === "https://api.github.com";
      const response = await (this.options?.fetch ?? fetch)(url, { redirect: "manual", signal,
        headers: api ? apiHeaders(token, "application/octet-stream") : { Accept: "application/octet-stream", "User-Agent": "Moguri-updater" } });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("Location"); await response.body?.cancel();
        if (!location) throw new MoguriError("update_redirect", "The release asset redirect is missing its bounded destination.");
        const next = new URL(location, url);
        if (next.protocol !== "https:" || next.username || next.password || next.port || !["release-assets.githubusercontent.com", "objects.githubusercontent.com"].includes(next.hostname)) throw new MoguriError("update_redirect", "The asset redirect is not a qualified HTTPS GitHub release host. No credential was forwarded.");
        url = next.href; continue;
      }
      if (!response.ok && api) throw await releaseFailure(response, token);
      if (!response.ok) { await response.body?.cancel(); throw new MoguriError("update_http", `GitHub's release download host returned HTTP ${response.status}. Nothing was staged.`, 502); }
      return response;
    }
    throw new MoguriError("update_redirect", "The release asset exceeded its redirect bound. No credential was forwarded outside the GitHub API.");
  }
  private async check(value: ApplicationUpdate, requested: AbortSignal, secrets: string[]): Promise<void> {
    const signal = AbortSignal.any([requested, AbortSignal.timeout(30 * 60_000)]), fetcher = this.options?.fetch ?? fetch;
    let token: string | null;
    try { token = await this.vault.read("private-github-release", AbortSignal.timeout(15_000)); }
    catch { this.credential = "failed"; throw new MoguriError("update_secret_backend", "The separate updater secret backend failed. No credential or raw backend response was retained."); }
    if (token) secrets.push(token);
    this.credential = token ? "configured" : "missing"; signal.throwIfAborted();
    const repo = parse(Type.Object({ id: integer, full_name: text, private: Type.Boolean() }), await releaseJson(fetcher, repository, token, signal));
    if (repo.full_name.toLowerCase() !== "mbianchidev/moguri") throw new MoguriError("update_repository", "The response does not identify the fixed Moguri release repository.");
    const releases = parse(Type.Array(Release, { maxItems: 10 }), await releaseJson(fetcher, `${repository}/releases?per_page=10`, token, signal));
    const eligible = releases.filter((release) => !release.draft && /^[v]?[0-9A-Za-z.+-]{1,100}$/.test(release.tag_name) && semver.valid(release.tag_name) &&
      semver.gt(release.tag_name, value.currentVersion) && (Boolean(semver.prerelease(value.currentVersion)) || !release.prerelease))
      .sort((a, b) => semver.rcompare(a.tag_name, b.tag_name));
    const highest = [...this.records.values()].filter((record) => record.release && ["ready", "installing", "installed", "completed"].includes(record.status))
      .map((record) => record.release!.manifest.version).sort(semver.rcompare)[0];
    const release = eligible[0];
    if (highest && semver.gt(highest, value.currentVersion) && (!release || semver.lt(release.tag_name, highest))) throw new MoguriError("update_rollback", "The feed omitted a newer already observed release. No older bundle or account fallback was accepted.");
    const access = token ? "Checked with the saved update token." : "Checked public releases without a token.";
    if (!release) { this.record({ ...value, status: "completed", diagnostic: `No newer eligible release was observed. No application was downloaded or replaced. ${access}` }); return; }
    if (!release.published_at || !Number.isFinite(Date.parse(release.published_at)) || Date.parse(release.published_at) > Date.now() + 5 * 60_000) throw new MoguriError("update_release", "The actual release publication time is missing or invalid.");
    const version = semver.valid(release.tag_name)!, arch = this.options!.arch ?? process.arch;
    if (arch !== "arm64" && arch !== "x64") throw new MoguriError("update_architecture", "This actual process architecture has no qualified update.");
    const manifests = release.assets.filter((asset) => asset.name === `Moguri-${version}-macos-${arch}.manifest.json`);
    if (manifests.length !== 1 || manifests[0]!.size > 1024 * 1024) throw new MoguriError("update_manifest", "This release has no single bounded architecture-specific integrity manifest.");
    const manifestAsset = manifests[0]!, manifestBytes = await boundedBody(await this.asset(manifestAsset.id, token, signal), manifestAsset.size, signal);
    if (manifestBytes.length !== manifestAsset.size) throw new MoguriError("update_manifest", "Actual manifest bytes do not match their exact asset size.");
    const manifest = parse(UpdateManifestSchema, JSON.parse(manifestBytes.toString("utf8")));
    const archives = release.assets.filter((asset) => asset.name === manifest.archive.name);
    if (manifest.version !== version || manifest.arch !== arch || manifest.archive.name !== `Moguri-${version}-macos-${arch}.zip` || archives.length !== 1 || archives[0]!.size !== manifest.archive.bytes) throw new MoguriError("update_asset_identity", "The manifest/release/architecture/archive identities do not agree. Nothing was staged.");
    const selected: UpdateRelease = { repositoryId: repo.id, releaseId: release.id, manifestAssetId: manifestAsset.id, archiveAssetId: archives[0]!.id, manifest };
    this.record({ ...value, status: "downloading", release: selected });
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const root = await lstat(this.root);
    if (!root.isDirectory() || root.isSymbolicLink() || root.uid !== process.getuid?.() || root.mode & 0o077) throw new MoguriError("update_directory", "The private update resource root changed. No downloaded code was written.");
    const directory = join(await realpath(this.root), value.id); await mkdir(directory, { mode: 0o700 });
    const archive = join(directory, manifest.archive.name), response = await this.asset(selected.archiveAssetId, token, signal);
    try {
      const file = await open(archive, "wx", 0o600);
      try {
      if (!response.body) throw new MoguriError("update_body", "The actual update asset has no body.");
      const reader = response.body.getReader(); let bytes = 0;
      try {
        while (true) { signal.throwIfAborted(); const next = await reader.read(); if (next.done) break; bytes += next.value.byteLength;
          if (bytes > manifest.archive.bytes) throw new MoguriError("update_asset_limit", "The archive exceeded its exact manifest size. No excess bytes were accepted.");
          await file.writeFile(next.value); }
        if (bytes !== manifest.archive.bytes) throw new MoguriError("update_asset_size", "The archive ended before its exact reviewed byte count.");
        await file.sync();
      } finally { await reader.cancel(); reader.releaseLock(); }
      } finally { await file.close(); }
    } finally { await response.body?.cancel(); }
    const bundle = await stageUpdateArchive(archive, join(directory, "unpacked"), manifest, signal);
    await (this.options!.quarantine ?? quarantineUpdate)(bundle, value.id);
    signal.throwIfAborted(); this.record({ ...value, status: "ready", release: selected, stagedBundle: bundle, diagnostic: `Exact release and bundle bytes verified. Unsigned/ad-hoc integrity is not Apple signing or notarization. Installation and restart require separate actual-user review. ${access}` });
  }
  async installPreview(id: string): Promise<UpdateInstallReview> {
    const value = this.read(id), destination = this.options?.installationRoot;
    if (!destination || process.platform !== "darwin") throw new MoguriError("update_install_unqualified", "An unpackaged/source runtime cannot replace the checkout. Installation needs the actual owned packaged application.", 409);
    if (value.status !== "ready" || !value.release || !value.stagedBundle || this.installer) throw new MoguriError("update_install_state", "Review one actual verified ready bundle; original partial/consumed installations cannot replay.", 409);
    const metadata = await lstat(destination);
    if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.uid !== process.getuid?.() || await realpath(destination) !== destination || basename(destination) !== "Moguri.app") throw new MoguriError("update_install_root", "The actual packaged destination changed ownership or canonical identity. No other application was selected.", 409);
    await access(dirname(destination), constants.W_OK);
    await verifyBundleIdentity(destination, this.options!.version, value.release.manifest.arch);
    await verifyStandaloneInstallerRuntime(this.options?.installerRuntime ?? process.execPath);
    await verifyBundleIdentity(value.stagedBundle, value.release.manifest.version, value.release.manifest.arch);
    const actual = await bundleTreeSha512(value.stagedBundle);
    if (actual !== value.release.manifest.bundleSha512) throw new MoguriError("update_bundle_changed", "Actual staged application bytes changed. Review cannot authorize them.", 409);
    const directory = join(dirname(destination), `.Moguri-update-${id}`);
    const body = { id, version: value.release.manifest.version, destination, stagedBundle: value.stagedBundle,
      candidateSibling: join(directory, "Moguri.app"), backup: join(directory, "previous.app"), oldBundleSha512: await bundleTreeSha512(destination), bundleSha512: actual };
    return { ...body, digest: createHash("sha256").update(JSON.stringify(body)).digest("hex") };
  }
  prepareInstallation(request: UpdateInstallRequest, requestedProfileId: string): Promise<{ id: string; journal: string; intentDigest: string }> {
    if (this.preparing) return Promise.reject(new MoguriError("update_install_pending", "The original installer preparation is already owned. No duplicate was started.", 409));
    const abort = new AbortController(), done = this.performPreparation(request, requestedProfileId, abort.signal).finally(() => { this.preparing = undefined; });
    this.preparing = { abort, done }; return done;
  }
  private async performPreparation(request: UpdateInstallRequest, requestedProfileId: string, signal: AbortSignal): Promise<{ id: string; journal: string; intentDigest: string }> {
    if (this.closed || this.active || this.hasPendingInstallation()) throw new MoguriError("update_install_pending", "Finish original owned work or inspect its unconfirmed installation before a new install.", 409);
    const review = await this.installPreview(request.id);
    signal.throwIfAborted();
    if (review.digest !== request.expectedDigest) throw new MoguriError("update_install_review_changed", "The actual old/staged bundle bytes or destination changed. Review again before installation.", 409);
    if (this.installer || this.hasPendingInstallation()) throw new MoguriError("update_install_pending", "Another original installation was admitted during review. No duplicate helper was started.", 409);
    const value = this.read(request.id), helperDirectory = join(await realpath(this.root), `installer-${value.id}`), journal = join(helperDirectory, "journal.json");
    this.record({ ...value, status: "installing", installation: { review, helperDirectory, journal, requestedProfileId }, diagnostic: "Actual user confirmed the exact old/new bundle bytes and restart. Preparing the original trusted installer; effects are not yet complete." });
    try {
      await mkdir(helperDirectory, { mode: 0o700 });
      await mkdir(dirname(review.candidateSibling), { mode: 0o700 });
      await cp(review.stagedBundle, review.candidateSibling, { recursive: true, dereference: false, verbatimSymlinks: true, errorOnExist: true, force: false });
      signal.throwIfAborted();
      if (await bundleTreeSha512(review.candidateSibling) !== review.bundleSha512) throw new Error("The actual same-filesystem candidate copy changed. No application was replaced.");
      await (this.options?.quarantine ?? quarantineUpdate)(review.candidateSibling, value.id);
      const runtime = join(helperDirectory, "node"), helper = join(helperDirectory, "installer.mjs");
      const sourceRuntime = this.options?.installerRuntime ?? process.execPath, sourceHelper = this.options?.installerSource ?? fileURLToPath(new URL("./update-installer.mjs", import.meta.url));
      const runtimeDigest = await fileSha512(sourceRuntime), helperDigest = await fileSha512(sourceHelper);
      await copyFile(sourceRuntime, runtime, constants.COPYFILE_EXCL); await chmod(runtime, 0o700);
      await copyFile(sourceHelper, helper, constants.COPYFILE_EXCL); await chmod(helper, 0o600);
      if (await fileSha512(runtime) !== runtimeDigest || await fileSha512(helper) !== helperDigest) throw new Error("The copied current trusted installer/runtime did not verify.");
      const intent: UpdateInstallerIntent = { schemaVersion: 1, id: value.id, keyId: this.keyId, version: review.version, arch: value.release!.manifest.arch,
        destination: review.destination, candidate: review.candidateSibling, backup: review.backup, journal, oldBundleSha512: review.oldBundleSha512, bundleSha512: review.bundleSha512,
        servicePid: process.pid, desktopPid: request.desktopPid, runtime: { path: runtime, sha512: runtimeDigest }, helper: { path: helper, sha512: helperDigest } };
      const text = JSON.stringify(intent), intentDigest = createHash("sha256").update(text).digest("hex"), intentPath = join(helperDirectory, "intent.json"), file = await open(intentPath, "wx", 0o600);
      try { await file.writeFile(text); await file.sync(); } finally { await file.close(); }
      await writeInstallJournal(journal, { schemaVersion: 1, id: value.id, intentDigest, state: "prepared", diagnostic: null });
      signal.throwIfAborted();
      if (await bundleTreeSha512(review.destination) !== review.oldBundleSha512) throw new Error("The actual current app changed during trusted helper preparation. No copied runtime or replacement was executed.");
      const child = spawn(runtime, [helper, intentPath, intentDigest], { stdio: ["ignore", "ignore", "pipe", "ipc"], env: {
        PATH: "/usr/bin:/bin:/usr/sbin:/sbin", HOME: process.env.HOME,
        ...(process.env.MOGURI_TEST_WINDOW === "hidden" ? { MOGURI_TEST_WINDOW: "hidden" } : {}),
      } });
      let stderr = "";
      child.stderr!.on("data", (value: Buffer) => { stderr = (stderr + value.toString("utf8").replace(/[\u0000-\u0008\u000b-\u001f]/g, "")).slice(-4096); });
      this.installer = { child, id: value.id, digest: intentDigest, journal, armed: false };
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("The exact trusted installer did not acknowledge its prepared intent.")), 10_000);
        child.once("error", (error) => { clearTimeout(timer); reject(error); });
        child.once("exit", (code, signal) => { clearTimeout(timer); reject(new Error(`The original installer exited before preparation acknowledgement (${signal ?? code}). ${stderr.trim()} No replacement was admitted.`)); });
        child.on("message", (message: unknown) => {
          if (message && typeof message === "object" && "type" in message && message.type === "ready" && "id" in message && message.id === value.id && "intentDigest" in message && message.intentDigest === intentDigest) { clearTimeout(timer); resolve(); }
        });
      });
      signal.throwIfAborted();
      this.record({ ...this.read(value.id), installation: { ...this.read(value.id).installation!, helperPid: child.pid, intentDigest } });
      return { id: value.id, journal, intentDigest };
    } catch (error) {
      if (this.installer?.child.connected) this.installer.child.disconnect(); this.installer?.child.unref();
      const diagnostic = error instanceof Error ? error.message : "Original installer preparation is unconfirmed. Stage/sibling/backup intent was retained; no replay is permitted.";
      this.record({ ...this.read(value.id), status: "partial", diagnostic });
      throw new MoguriError("update_install_partial", `Original installer preparation is partial: ${diagnostic} No replacement or retry was recorded.`, 409);
    }
  }
  async armInstallation(): Promise<void> {
    const owned = this.installer;
    if (!owned || !owned.child.connected || owned.child.exitCode !== null || owned.armed) throw new Error("The exact original prepared installer is not connected. No substitute was armed.");
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("The original installer did not durably acknowledge its arm request.")), 10_000);
      owned.child.once("error", (error) => { clearTimeout(timer); reject(error); });
      owned.child.on("message", (message: unknown) => {
        if (message && typeof message === "object" && "type" in message && message.type === "armed" && "id" in message && message.id === owned.id && "intentDigest" in message && message.intentDigest === owned.digest) { clearTimeout(timer); resolve(); }
      });
      owned.child.send({ action: "arm", id: owned.id, intentDigest: owned.digest }, (error) => { if (error) { clearTimeout(timer); reject(error); } });
    });
    owned.armed = true; owned.child.stderr?.destroy(); owned.child.disconnect(); owned.child.unref();
  }
  async close(preserveInstaller = false): Promise<void> {
    this.closed = true; this.active?.abort.abort(); this.preparing?.abort.abort();
    const preparing = this.preparing?.done;
    await this.active?.done;
    if (preparing) await preparing.catch((error: unknown) => console.error("Original installer preparation ended during shutdown:", error instanceof Error ? error.message : "partial retained preparation"));
    if (this.installer && !preserveInstaller) {
      const child = this.installer.child;
      if (child.connected) child.disconnect();
      if (child.exitCode === null && child.signalCode === null) await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("The known original unarmed installer did not confirm exit. Its lease/intent remains retained; no unknown PID was signalled.")), 10_000);
        child.once("exit", () => { clearTimeout(timer); resolve(); });
        child.once("error", (error) => { clearTimeout(timer); reject(error); });
      });
      child.stderr?.destroy(); child.unref();
    }
  }
}
export async function quarantineUpdate(path: string, id: string): Promise<void> {
  if (process.platform !== "darwin") throw new Error("Native update quarantine is qualified only on macOS.");
  await promisify(execFile)("/usr/bin/xattr", ["-w", "com.apple.quarantine", `0081;${Math.floor(Date.now() / 1000).toString(16)};Moguri;${id}`, path], { timeout: 5000, maxBuffer: 4096 });
}
