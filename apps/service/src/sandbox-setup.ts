import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, mkdir, open, realpath, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import semver from "semver";
import {
  defaultSandboxManagement, isRecord, MINIMUM_SANDBOX_RELEASE, MoguriError, parse, PROTOCOL_VERSION, SandboxSetupOperationSchema, SandboxReleaseSchema, supportedSandboxRelease,
  type CommandResult, type EventInput, type SandboxConfiguration, type SandboxDistribution, type SandboxManagement, type SandboxRelease,
  type SandboxSetupCommand, type SandboxSetupOperation, type SandboxSetupQuery, type SandboxSetupResponse, type SandboxSetupReview, type SandboxSetupStatus, type Snapshot,
} from "../../../packages/protocol/src/index.ts";
import {
  readSandboxDistribution, distributionConfiguration, installedSandboxRelease, sandboxInstallationRoot, sandboxFileHash,
  extractSandboxRelease, inspectSandboxRelease, buildSandboxInstaller,
} from "./sandbox-distribution.ts";
import { installSandboxRuntime, type SandboxInstallRequest } from "./sandbox-installer.ts";
import { boundedBody, fetchJson } from "./network.ts";
import { frameDigest } from "./worker-wire.ts";
import { sandboxHostEnvironment, type SandboxRuntime } from "./sandbox-runtime.ts";
import { runProgram } from "./program.ts";
import type { EventStore } from "./store.ts";
import type { WorkspaceFinish } from "./session-workspace.ts";

const api = "https://api.github.com", repository = `${api}/repos/sendbox-dev/sendbox`;
/** SendBox moved to sendbox-dev/sendbox; the pinned vendor identity stays `mbianchidev/sendbox` (D80, D81). */
export const SENDBOX_REPOSITORY_NAMES = ["mbianchidev/sendbox", "sendbox-dev/sendbox"] as const;
const feedHeaders = { Accept: "application/vnd.github+json", "User-Agent": "Moguri-SendBox-updater", "X-GitHub-Api-Version": "2022-11-28" };
/**
 * Resolves the public SendBox repository to its immutable `/repositories/<id>` API alias. If it moves again GitHub answers this
 * path with one 301 to that alias, so only that single same-origin hop is followed and only known names are accepted.
 */
export async function resolveSendboxRepository(fetcher: typeof fetch, signal: AbortSignal): Promise<string> {
  let response = await fetcher(repository, { headers: feedHeaders, signal, redirect: "manual" }), url = repository;
  if ([301, 302, 307, 308].includes(response.status)) {
    const location = response.headers.get("Location"); await response.body?.cancel();
    const next = location ? new URL(location, repository) : null;
    if (!next || next.origin !== api || next.username || next.password || next.search || next.hash || !/^\/repositories\/[1-9][0-9]{0,15}$/.test(next.pathname)) {
      throw new MoguriError("sandbox_release_redirect", "GitHub redirected the SendBox repository somewhere other than its own repository ID. Nothing was downloaded.", 502);
    }
    url = next.href;
    response = await fetcher(url, { headers: feedHeaders, signal, redirect: "error" });
  }
  if (!response.ok) { await response.body?.cancel(); throw new MoguriError("sandbox_release_http", `The public SendBox repository returned HTTP ${response.status}. No token or alternate repository was used.`, 502); }
  let value: unknown;
  try { value = JSON.parse((await boundedBody(response, 256 * 1024, signal)).toString("utf8")); }
  catch (error) { if (error instanceof SyntaxError) throw new MoguriError("sandbox_release_feed", "The SendBox repository returned invalid JSON. Nothing was downloaded.", 502); throw error; }
  const id = isRecord(value) && Number.isSafeInteger(value.id) && Number(value.id) > 0 ? Number(value.id) : null;
  const name = isRecord(value) && typeof value.full_name === "string" ? value.full_name.toLowerCase() : "";
  const base = `${api}/repositories/${id}`;
  if (!id || !(SENDBOX_REPOSITORY_NAMES as readonly string[]).includes(name) || url !== repository && url !== base) {
    throw new MoguriError("sandbox_release_feed", `The response does not identify the public SendBox repository (${SENDBOX_REPOSITORY_NAMES.join(" or ")}). Nothing was downloaded.`, 502);
  }
  return base;
}
export interface SandboxSetupOptions {
  fetch?: typeof fetch;
  install?: (request: SandboxInstallRequest, signal: AbortSignal) => Promise<void>;
  package?: (root: string, version: string, output: string, signal: AbortSignal) => Promise<void>;
  installed?: typeof installedSandboxRelease;
  importImage?: (archive: string, signal: AbortSignal) => Promise<void>;
  automatic?: boolean;
}
interface Host {
  snapshot(): Snapshot; commit(events: EventInput[]): void; busy(): boolean;
  configure(configuration: SandboxConfiguration, management: SandboxManagement, expectedRevision: number): void;
}
type Definition = Awaited<ReturnType<typeof readSandboxDistribution>>;
export class SandboxSetup {
  private readonly records = new Map<string, SandboxSetupOperation>();
  private bundled?: Definition;
  private diagnostic = "This build doesn't include SendBox. Use the packaged macOS app, or pass a SendBox distribution to the Node SDK.";
  private active?: { id: string; abort: AbortController; done: Promise<void> };
  private timer?: ReturnType<typeof setInterval>;
  private initialCheckPending = false;
  private closed = false;
  constructor(private readonly store: EventStore, private readonly stateDir: string, private readonly distribution: string | undefined,
    private readonly native: SandboxRuntime, private readonly host: Host, private readonly options: SandboxSetupOptions = {}) {
    for (const event of store.eventsOfTypes(["sandbox.setup_recorded"])) if (event.event_type === "sandbox.setup_recorded") {
      const record = parse(SandboxSetupOperationSchema, event.payload.operation);
      if (record.profileId !== store.profileId) throw new MoguriError("sandbox_setup_scope", "A managed setup operation crossed its retained profile.", 409);
      this.records.set(record.id, record);
    }
    for (const value of [...this.records.values()]) if (["checking", "preparing", "installing", "importing", "verifying"].includes(value.status)) {
      this.update(value.id, { status: "partial", diagnostic: "The original native setup was interrupted. Original package, installation and image intent remain retained; no installer, import, qualification or model was replayed." });
    }
  }
  async initialize(): Promise<void> {
    const retained = [...this.records.values()].findLast((operation) => operation.kind === "apply" && operation.status === "completed" && operation.acceptance && operation.sourceDirectory);
    const directory = this.distribution ?? retained?.sourceDirectory;
    if (!directory || process.platform !== "darwin" || process.arch !== "arm64") return;
    try {
      this.bundled = await readSandboxDistribution(directory, AbortSignal.timeout(30_000));
      if (!this.distribution && this.bundled.digest !== retained?.distributionDigest) throw new MoguriError("sandbox_distribution", "The originally approved retained distribution changed. No app, image or path was rediscovered.", 409);
      this.diagnostic = "Compatible worker image, Linux Node/native dependencies and pinned SendBox installer are bundled. Review once to enable managed Sandbox.";
    } catch (error) {
      this.diagnostic = error instanceof MoguriError ? error.message : "The bundled native distribution could not be verified. No image or installation fallback was selected.";
      console.error("Bundled Sandbox unavailable:", error instanceof MoguriError ? error.code : "sandbox_distribution");
      return;
    }
    let selected: Definition | undefined = this.bundled;
    if (this.management().enabled && this.management().version !== selected.distribution.vendor.version) {
      try { selected = await this.definition(this.management().version, AbortSignal.timeout(30_000)); }
      catch (error) {
        selected = undefined;
        this.diagnostic = error instanceof MoguriError ? error.message : "The exact configured distribution is unavailable. No bundled-version or path fallback was selected.";
      }
    }
    const lastAdmission = [...this.records.values()].findLast((operation) => ["apply", "qualify"].includes(operation.kind));
    const accepted = [...this.records.values()].some((operation) => operation.kind === "apply" && operation.status === "completed" &&
      operation.acceptance && operation.distributionDigest === selected?.digest && operation.selectedVersion === this.management().version);
    if (this.management().enabled && selected && (!accepted || lastAdmission?.status === "partial")) {
      this.diagnostic = "The original managed setup/qualification has not completed or remains unconfirmed. Inspect its retained operation and explicitly review setup again; no new guest or installer was started automatically.";
    } else if (this.management().enabled && selected && !this.host.busy()) {
      const configured = this.host.snapshot().settings.values.sandbox;
      if (configured.image === selected.distribution.worker.image && configured.qualification?.workerDigest === selected.distribution.worker.workerDigest) {
        const id = `system-${randomUUID()}`, operation = this.start("qualify", this.management().version, id,
          frameDigest(["moguri-native-startup-qualification-v1", this.store.profileId, id]), true);
        this.own(operation, async (signal) => {
          await this.native.probe(this.store.profileId, operation.id, signal);
          this.update(operation.id, { status: "completed", diagnostic: "Previously approved managed Sandbox was freshly requalified. No installer, new version or model call was replayed." });
        });
      } else this.diagnostic = "This Moguri build supplies a different compatible worker. Review its bundled setup; your configured SendBox version and old work were not replaced.";
    }
    if (this.options.automatic === false) return;
    const check = () => { void this.automaticCheck().catch((error: unknown) => console.error("Automatic SendBox check failed:", error instanceof MoguriError ? error.code : "sandbox_update_check")); };
    this.timer = setInterval(check, 4 * 60 * 60_000); this.timer.unref();
    if (this.active) this.initialCheckPending = true; else check();
  }
  private management(): SandboxManagement {
    const settings = this.host.snapshot().settings.values;
    const management = { ...defaultSandboxManagement(), ...settings.sandboxManagement };
    return !management.enabled && settings.sandbox.qualification ? { ...management, version: settings.sandbox.qualification.release } : management;
  }
  // A saved release below the supported minimum defaults to the bundled review; it is only replaced when that review is enabled.
  private reviewDefault(): string {
    const selected = this.management().version;
    return supportedSandboxRelease(selected) || !this.bundled ? selected : this.bundled.distribution.vendor.version;
  }
  private unsupportedSelection(): string | null {
    const selected = this.management().version;
    return supportedSandboxRelease(selected) ? null : `Saved SendBox ${selected} is no longer supported. Review the bundled ${this.bundled?.distribution.vendor.version ?? MINIMUM_SANDBOX_RELEASE} setup to replace it; nothing changes until you enable that review. `;
  }
  status(): SandboxSetupStatus {
    const records = [...this.records.values()];
    return { supported: Boolean(this.bundled && !this.closed), bundledVersion: this.bundled?.distribution.vendor.version ?? null,
      selectedVersion: this.management().version, automaticUpdates: this.management().automaticUpdates,
      operation: structuredClone(records.at(-1) ?? null),
      availableRelease: structuredClone(records.filter((record) => record.release && record.kind === "check" && record.status === "available" &&
        semver.gt(record.release.version, this.management().version)).at(-1)?.release ?? null),
      diagnostic: (this.unsupportedSelection() ?? "") + this.diagnostic };
  }
  async query(query: SandboxSetupQuery): Promise<SandboxSetupResponse> {
    if (query.type === "sandbox.setup.operation") {
      const operation = this.records.get(query.operationId);
      if (!operation) throw new MoguriError("sandbox_setup_missing", "That exact original setup operation does not exist in this profile.", 404);
      return { type: query.type, operation: structuredClone(operation) };
    }
    return query.type === "sandbox.setup.status" ? { type: query.type, setup: this.status() } :
      { type: query.type, review: await this.review(query.version ?? this.reviewDefault()) };
  }
  private async definition(version: string, signal: AbortSignal): Promise<Definition> {
    if (!this.bundled) throw new MoguriError("sandbox_distribution", this.diagnostic, 409);
    if (version === this.bundled.distribution.vendor.version) return readSandboxDistribution(this.bundled.root, signal);
    const prepared = [...this.records.values()].findLast((record) => record.kind === "prepare" && record.selectedVersion === version && record.status === "review" && record.sourceDirectory);
    if (!prepared?.sourceDirectory) throw new MoguriError("sandbox_release_prepare", "Prepare this exact public version for review first. The selected version was not replaced by the bundled or latest release.", 409);
    const definition = await readSandboxDistribution(prepared.sourceDirectory, signal);
    if (definition.distribution.worker.payloadDigest !== this.bundled.distribution.worker.payloadDigest) {
      throw new MoguriError("sandbox_distribution", "This prepared version belongs to an earlier Moguri worker/dependency build. Prepare it again with the current bundled worker for a new exact review; no previous image was substituted.", 409);
    }
    return definition;
  }
  async review(version: string, signal = AbortSignal.timeout(30_000)): Promise<SandboxSetupReview> {
    if (!supportedSandboxRelease(version)) throw new MoguriError("sandbox_release_unsupported", `SendBox ${version} is no longer supported. Review the exact bundled ${this.bundled?.distribution.vendor.version ?? MINIMUM_SANDBOX_RELEASE} setup explicitly; the saved selection was not upgraded.`, 409);
    const definition = await this.definition(version, signal), state = this.host.snapshot(), existing = state.settings.values.sandbox;
    let configuration = distributionConfiguration(definition.distribution), installed = false;
    if (existing.qualification?.release === version && await (this.options.installed ?? installedSandboxRelease)(existing, definition.distribution.vendor)) {
      configuration = { ...configuration, executable: existing.executable, bundlePath: existing.bundlePath, trustRootPath: existing.trustRootPath };
      configuration.qualification = { ...configuration.qualification!, resources: { ...existing.qualification.resources },
        allowCopilot: existing.qualification.allowCopilot, allowedDomains: [...new Set(["github.com", "api.github.com", ...existing.qualification.allowedDomains])] };
      installed = true;
    } else installed = await (this.options.installed ?? installedSandboxRelease)(configuration, definition.distribution.vendor);
    const management = { ...this.management(), enabled: true, version };
    const networkDisclosure = configuration.qualification!.allowedDomains.includes("github.com") ? "GitHub Meta network delegation: github.com also allows GitHub Meta domains and IPv4/IPv6 ranges, including shared-cloud addresses. The SendBox host fetches them into one machine-wide cache, revalidated at most hourly, and seeds each guest before readiness; guests never contact GitHub Meta. This is broader than exact-host-only egress. " : "";
    const value = { distributionDigest: definition.digest, settingsRevision: state.settings.revision, version, protocol: PROTOCOL_VERSION,
      configuration, management, installed, administratorRequired: !installed,
      destination: installed ? dirname(configuration.executable) : sandboxInstallationRoot(version),
      installerPath: join(definition.root, definition.distribution.vendor.installer.path),
      installerSha512: definition.distribution.vendor.installer.sha512, installerBytes: definition.distribution.vendor.installer.bytes,
      imageArchivePath: join(definition.root, definition.distribution.worker.archive.path),
      imageArchiveSha512: definition.distribution.worker.archive.sha512, imageArchiveBytes: definition.distribution.worker.archive.bytes,
      diagnostic: (version !== this.management().version ? this.unsupportedSelection() ?? "" : "") + networkDisclosure + (installed ? "Reuse these verified configured root-owned release bytes, import the matching bundled worker and qualify. No developer tooling or source preview is required." :
        "Install this exact no-script versioned package with administrator approval, import the compatible bundled worker and qualify. No existing SendBox installation is overwritten.") };
    return { ...value, digest: frameDigest(["moguri-managed-sandbox-review-v1", this.store.profileId, value]) };
  }
  private event(operation: SandboxSetupOperation): EventInput {
    return { event_type: "sandbox.setup_recorded", profile_id: this.store.profileId, payload: { operation } };
  }
  private update(id: string, changes: Partial<SandboxSetupOperation>): SandboxSetupOperation {
    const before = this.records.get(id);
    if (!before) throw new MoguriError("sandbox_setup_missing", "The original owned setup operation is missing; no later job was substituted.", 409);
    const next = parse(SandboxSetupOperationSchema, { ...before, ...changes, revision: before.revision + 1, updatedAt: new Date().toISOString() });
    if (next.commandId !== before.commandId || next.commandDigest !== before.commandDigest || next.profileId !== before.profileId ||
      next.kind !== before.kind || next.createdAt !== before.createdAt) throw new MoguriError("sandbox_setup_scope", "Original setup ownership or command intent changed.", 409);
    this.host.commit([this.event(next)]); this.records.set(id, next); return next;
  }
  private start(kind: SandboxSetupOperation["kind"], selectedVersion: string, commandId: string, commandDigest: string, automatic: boolean, finish?: WorkspaceFinish) {
    if (this.closed) throw new MoguriError("sandbox_closed", "Native setup is closing. No new download, installation or import.", 503);
    if (!this.bundled) throw new MoguriError("sandbox_distribution", this.diagnostic, 409);
    const prior = [...this.records.values()].find((record) => record.commandId === commandId);
    if (prior) throw new MoguriError("sandbox_setup_no_replay", "This original setup/check command already has retained work. Inspect its exact outcome; no effect was replayed.", 409);
    if (this.active) throw new MoguriError("sandbox_setup_busy", "An original native setup/check operation is still active. Wait or cancel it before another operation.", 409);
    const time = new Date().toISOString();
    const operation: SandboxSetupOperation = { version: 1, id: randomUUID(), profileId: this.store.profileId, revision: 0, kind,
      status: kind === "check" ? "checking" : kind === "prepare" ? "preparing" : "verifying",
      commandId, commandDigest, automatic, createdAt: time, updatedAt: time, selectedVersion, release: null,
      distributionDigest: null, reviewDigest: null, sourceDirectory: null, destination: null, installerSha512: null, diagnostic: null, acceptance: null };
    if (finish) finish([this.event(operation)], { id: operation.id });
    else this.host.commit([this.event(operation)]);
    this.records.set(operation.id, operation); return operation;
  }
  private own(operation: SandboxSetupOperation, work: (signal: AbortSignal) => Promise<void>): void {
    const abort = new AbortController(), done = Promise.resolve().then(() => work(abort.signal)).catch((error: unknown) => {
      const current = this.records.get(operation.id)!;
      const partial = ["installing", "importing", "verifying"].includes(current.status) && ["apply", "qualify"].includes(operation.kind);
      const diagnostic = abort.signal.aborted ? "Original native setup was cancelled. Partial package/installation/image work was retained; no effect or model was retried." :
        error instanceof MoguriError ? error.message : "Native setup failed. Its original operation and partial artifacts were retained; no fallback or replay.";
      console.error("Managed Sandbox setup:", error instanceof MoguriError ? error.code : abort.signal.aborted ? "sandbox_setup_cancelled" : "sandbox_setup");
      this.update(operation.id, { status: partial ? "partial" : abort.signal.aborted ? "cancelled" : "failed", diagnostic });
    }).finally(() => {
      if (this.active?.id === operation.id) this.active = undefined;
      if (this.initialCheckPending && !this.closed) {
        this.initialCheckPending = false;
        void this.automaticCheck().catch((error: unknown) => console.error("Automatic SendBox check failed:", error instanceof MoguriError ? error.code : "sandbox_update_check"));
      }
    });
    this.active = { id: operation.id, abort, done };
  }
  async execute(command: SandboxSetupCommand, finish: WorkspaceFinish): Promise<CommandResult> {
    if (command.type === "sandbox.setup.cancel") {
      if (this.active?.id !== command.operationId) throw new MoguriError("sandbox_setup_not_owned", "That original setup operation has no active owner. Nothing was stopped or retried.", 409);
      this.active.abort.abort(); return finish([], { id: command.operationId });
    }
    if (!finish.intent) throw new MoguriError("sandbox_setup_intent", "Managed setup needs the actual original user command before side effects.", 409);
    if (command.type === "sandbox.setup.check") {
      if (command.automatic && !this.management().automaticUpdates) throw new MoguriError("sandbox_updates_disabled", "Automatic public SendBox checks are disabled.", 409);
      const operation = this.start("check", this.management().version, finish.intent.id, finish.intent.digest, Boolean(command.automatic), finish);
      this.own(operation, (signal) => this.check(operation.id, signal)); return { id: operation.id };
    }
    if (command.type === "sandbox.setup.prepare") {
      const operation = this.start("prepare", command.version, finish.intent.id, finish.intent.digest, false, finish);
      this.own(operation, (signal) => this.prepare(operation.id, signal)); return { id: operation.id };
    }
    if (this.host.busy()) throw new MoguriError("sandbox_setup_busy", "Stop or wait for active native work before applying a runtime, image or network policy. Existing workers were not changed.", 409);
    const review = await this.review(command.version);
    if (review.digest !== command.expectedDigest || review.settingsRevision !== command.expectedRevision) throw new MoguriError("sandbox_setup_stale", "The actual package, image, version, settings or review changed. Review the current exact proposal; nothing was installed.", 409);
    const operation = this.start("apply", review.version, finish.intent.id, finish.intent.digest, false, finish);
    this.update(operation.id, { distributionDigest: review.distributionDigest, reviewDigest: review.digest, destination: review.destination, sourceDirectory: dirname(review.installerPath),
      installerSha512: review.installerSha512, acceptance: { actor: "user", commandId: finish.intent.id, commandDigest: finish.intent.digest, reviewDigest: review.digest } });
    this.own(operation, async (signal) => {
      if (review.administratorRequired) {
        this.update(operation.id, { status: "installing" });
        await (this.options.install ?? installSandboxRuntime)({ id: operation.id, packagePath: review.installerPath,
          sha512: review.installerSha512, version: review.version, destination: review.destination }, signal);
      }
      signal.throwIfAborted();
      const definition = await this.definition(review.version, signal);
      if (definition.digest !== review.distributionDigest || !await (this.options.installed ?? installedSandboxRelease)(review.configuration, definition.distribution.vendor)) {
        throw new MoguriError("sandbox_install_unconfirmed", "The actual installed root-owned release does not match the reviewed bytes. No readiness or alternate installation was claimed.", 409);
      }
      this.update(operation.id, { status: "importing" });
      if (this.options.importImage) await this.options.importImage(review.imageArchivePath, signal);
      else await runProgram("container", ["image", "load", "--input", review.imageArchivePath], { cwd: dirname(review.imageArchivePath), signal,
          env: sandboxHostEnvironment(), label: "Exact bundled native worker image import", timeoutMs: 120_000, maxBytes: 256 * 1024 });
      signal.throwIfAborted();
      if (this.host.busy()) throw new MoguriError("sandbox_setup_busy", "Native work began while setup was pending. The installed version/image is retained but no running policy was replaced.", 409);
      this.host.configure(review.configuration, review.management, review.settingsRevision);
      this.update(operation.id, { status: "verifying" }); this.native.synchronize();
      await this.native.probe(this.store.profileId, operation.id, signal);
      signal.throwIfAborted();
      this.update(operation.id, { status: "completed", diagnostic: "Managed Sandbox is enabled with verified bundled worker/runtime and owned VM cleanup. Private workspaces and selected-provider aliases are automatic under the approved policy." });
    });
    return { id: operation.id };
  }
  private async automaticCheck(): Promise<void> {
    if (this.closed || this.active || !this.management().automaticUpdates || !this.bundled) return;
    const id = `system-${randomUUID()}`, operation = this.start("check", this.management().version, id,
      frameDigest(["moguri-native-update-check-v1", this.store.profileId, id]), true);
    this.own(operation, (signal) => this.check(operation.id, signal));
  }
  private async releases(signal: AbortSignal): Promise<SandboxRelease[]> {
    const base = await resolveSendboxRepository(this.options.fetch ?? fetch, signal);
    const values = await fetchJson(this.options.fetch ?? fetch, `${base}/releases?per_page=10`, { headers: feedHeaders }, signal);
    if (!Array.isArray(values) || values.length > 10) throw new MoguriError("sandbox_release_feed", "The fixed public SendBox feed has an invalid bounded release list.", 502);
    const result: SandboxRelease[] = [];
    for (const value of values) {
      if (!isRecord(value) || value.draft || value.prerelease || typeof value.tag_name !== "string" || !semver.valid(value.tag_name) ||
        !Array.isArray(value.assets) || value.assets.length > 1000 || typeof value.published_at !== "string" ||
        !Number.isFinite(Date.parse(value.published_at)) || Date.parse(value.published_at) > Date.now() + 300_000) continue;
      const version = semver.valid(value.tag_name)!;
      const assets = value.assets.filter((asset) => isRecord(asset) && asset.name === `sendbox-${version}-macos-arm64.tar.gz`);
      if (assets.length !== 1 || !isRecord(assets[0])) throw new MoguriError("sandbox_release_feed", "An eligible public version has no single architecture-specific archive. Missing evidence is not an up-to-date success.", 502);
      const asset = assets[0];
      if (typeof asset.digest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(asset.digest)) throw new MoguriError("sandbox_release_feed", "The public release archive has no exact GitHub SHA-256 identity. Nothing was downloaded or declared up to date.", 502);
      result.push(parse(SandboxReleaseSchema, { version, repository: "mbianchidev/sendbox", releaseId: value.id, assetId: asset.id,
        archiveName: asset.name, bytes: asset.size, sha256: asset.digest.slice(7), publishedAt: value.published_at }));
    }
    return result.sort((a, b) => semver.rcompare(a.version, b.version));
  }
  private async check(id: string, signal: AbortSignal): Promise<void> {
    const release = (await this.releases(AbortSignal.any([signal, AbortSignal.timeout(15_000)])))[0] ?? null;
    const highest = [...this.records.values()].flatMap((record) => record.release ? [record.release.version] : []).sort(semver.rcompare)[0];
    if (highest && (!release || semver.lt(release.version, highest))) throw new MoguriError("sandbox_release_rollback", "The public feed omitted a newer already observed SendBox release. No older runtime was substituted.", 409);
    const newer = release && semver.gt(release.version, this.management().version);
    this.update(id, { status: newer ? "available" : "completed", release,
      diagnostic: newer ? "A public SendBox update is available. Download/review and administrator approval remain separate; the configured version was not changed." :
        "No newer eligible public SendBox release was observed. The selected version and running workers were not changed." });
  }
  private async asset(release: SandboxRelease, signal: AbortSignal): Promise<Response> {
    let url = `${await resolveSendboxRepository(this.options.fetch ?? fetch, signal)}/releases/assets/${release.assetId}`;
    for (let count = 0; count < 4; count++) {
      const response = await (this.options.fetch ?? fetch)(url, { redirect: "manual", signal,
        headers: { Accept: "application/octet-stream", "User-Agent": "Moguri-SendBox-updater", "X-GitHub-Api-Version": "2022-11-28" } });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const next = response.headers.get("Location"); await response.body?.cancel();
        if (!next) throw new MoguriError("sandbox_release_redirect", "The release asset redirect has no exact destination.", 502);
        const target = new URL(next, url);
        if (target.protocol !== "https:" || target.port || target.username || target.password ||
          !["release-assets.githubusercontent.com", "objects.githubusercontent.com"].includes(target.hostname)) {
          throw new MoguriError("sandbox_release_redirect", "The public archive left the qualified GitHub HTTPS release hosts. No account or mirror fallback.", 502);
        }
        url = target.href; continue;
      }
      if (!response.ok) { await response.body?.cancel(); throw new MoguriError("sandbox_release_http", `Public SendBox asset returned HTTP ${response.status}. No token or alternate repository was used.`, 502); }
      return response;
    }
    throw new MoguriError("sandbox_release_redirect", "The public release exceeded its redirect bound.", 502);
  }
  private async prepare(id: string, signal: AbortSignal): Promise<void> {
    const operation = this.records.get(id)!, release = (await this.releases(signal)).find((release) => release.version === operation.selectedVersion);
    if (!release || !supportedSandboxRelease(release.version)) throw new MoguriError("sandbox_release_missing", "That exact supported version has no eligible public architecture-specific asset. The configured version was not substituted.", 409);
    this.update(id, { release });
    const parent = join(this.stateDir, "sandbox-distributions"); await mkdir(parent, { recursive: true, mode: 0o700 });
    const root = join(await realpath(parent), id); await mkdir(root, { mode: 0o700 });
    this.update(id, { sourceDirectory: root });
    const archive = join(root, release.archiveName), response = await this.asset(release, signal);
    const bytes = await boundedBody(response, release.bytes, signal);
    if (bytes.length !== release.bytes) throw new MoguriError("sandbox_release_size", "The actual public archive does not match its exact release byte count.", 409);
    const file = await open(archive, "wx", 0o600);
    try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
    const unpacked = await extractSandboxRelease(archive, join(root, "unpacked"), release.version, release.sha256, signal);
    const vendor = await inspectSandboxRelease(unpacked, release.version, this.bundled!.distribution.vendor.keySha256, release.sha256, signal);
    if (vendor.minimumReleaseSequence < this.bundled!.distribution.vendor.minimumReleaseSequence) throw new MoguriError("sandbox_release_rollback", "The signed update falls below the approved release-sequence floor.", 409);
    const pkg = join(root, `sendbox-${release.version}.pkg`);
    await (this.options.package ?? buildSandboxInstaller)(unpacked, release.version, pkg, signal);
    const { stat } = await import("node:fs/promises");
    const installer = { path: `sendbox-${release.version}.pkg`, bytes: (await stat(pkg)).size, sha512: await sandboxFileHash(pkg, "sha512", signal) };
    const worker = this.bundled!.distribution.worker;
    await copyFile(join(this.bundled!.root, worker.archive.path), join(root, "worker.oci.tar"), constants.COPYFILE_FICLONE);
    const distribution: SandboxDistribution = { ...this.bundled!.distribution, vendor: { ...vendor, installer },
      worker: { ...worker, archive: { ...worker.archive, path: "worker.oci.tar" } } };
    await writeFile(join(root, "manifest.json"), JSON.stringify(distribution, null, 2), { flag: "wx", mode: 0o600 });
    const verified = await readSandboxDistribution(root, signal);
    this.update(id, { status: "review", distributionDigest: verified.digest,
      diagnostic: "Exact public release, signed guest root/sequence, script-free versioned package and current compatible worker are staged. Review and approve separately; no new version or executable was activated." });
  }
  async close(): Promise<void> {
    this.closed = true; clearInterval(this.timer);
    const active = this.active; active?.abort.abort(); await active?.done;
  }
}
