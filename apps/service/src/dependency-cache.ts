import { createServer } from "node:http";
import { lstat, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, delimiter, join } from "node:path";
import { parseDocument } from "yaml";
import * as cacache from "cacache";
import { valid, validRange, satisfies } from "semver";
import { isRecord, MoguriError, type CacheReceipt, type DependencyPackage, type DependencyPlan, type PackageManager, type Project } from "../../../packages/protocol/src/index.ts";
import { readProjectFile } from "./files.ts";
import { boundedBody, fetchJson } from "./network.ts";
import { runProgram } from "./program.ts";
import { digest, EventStore } from "./store.ts";

export interface DependencyCacheOptions { fetch?: typeof fetch }
const require = createRequire(import.meta.url);
const packageName = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const versionPattern = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]+)?$/;
const integrityPattern = /^sha512-[A-Za-z0-9+/]{86}==$/;
const packageLocation = /^(?:node_modules\/(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*)(?:\/node_modules\/(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*)*$/;
function registryRange(value: unknown): value is string {
  return typeof value === "string" && value.length <= 300 && validRange(value) !== null;
}
function lockedVersion(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2000 || !versionPattern.test(value.split("(")[0]!)) return false;
  const suffix = value.slice(value.split("(")[0]!.length);
  if (/[^A-Za-z0-9@._+()/-]/.test(suffix) || suffix.includes("..")) return false;
  let depth = 0;
  for (const character of suffix) {
    if (character === "(") depth++;
    else if (character === ")") { if (--depth < 0) return false; }
    else if (!depth) return false;
  }
  return depth === 0;
}
function validateOverrides(value: unknown): void {
  if (value === undefined) return;
  if (typeof value === "string" && (registryRange(value) || /^\$[A-Za-z0-9@/._-]+$/.test(value))) return;
  if (isRecord(value)) { for (const entry of Object.values(value)) validateOverrides(entry); return; }
  throw new MoguriError("cache_resolution", "Overrides must remain registry version ranges. Local, Git, URL and executable resolutions are not admitted.");
}
export class DependencyCache {
  readonly npmCache: string;
  readonly pnpmStore: string;
  private readonly content: string;
  private readonly pending = new Map<string, Promise<{ data: Buffer; downloaded: number }>>();
  constructor(private readonly store: EventStore, private readonly stateDir: string, private readonly options: DependencyCacheOptions = {}) {
    this.npmCache = join(stateDir, "dependency-cache", "npm");
    this.pnpmStore = join(stateDir, "dependency-cache", "pnpm");
    this.content = join(this.npmCache, "_cacache");
  }
  private entry(name: unknown, version: unknown, integrity: unknown, resolved?: unknown, hasInstallScript = false): DependencyPackage {
    if (typeof name !== "string" || !packageName.test(name) || typeof version !== "string" || !versionPattern.test(version) || !valid(version) || typeof integrity !== "string" || !integrityPattern.test(integrity)) {
      throw new MoguriError("cache_lock", "Every cached package needs a registry name, exact version and SHA-512 integrity. Git, local, exotic and unpinned dependencies are not supported.");
    }
    const canonical = `https://registry.npmjs.org/${name}/-/${name.split("/").at(-1)}-${version}.tgz`;
    if (resolved !== undefined && resolved !== canonical) throw new MoguriError("cache_registry", "Only canonical public npm registry tarballs are supported. No custom-registry credential or URL fallback is used.");
    return { name, version, integrity, url: canonical, hasInstallScript };
  }
  async inspect(project: Project, manager: PackageManager): Promise<DependencyPlan> {
    const manifest = await readProjectFile(project.path, "package.json", 2 * 1024 * 1024);
    const lock = await readProjectFile(project.path, manager === "npm" ? "package-lock.json" : "pnpm-lock.yaml", 2 * 1024 * 1024);
    let declared: unknown;
    try { declared = JSON.parse(manifest.text); } catch { throw new MoguriError("cache_manifest", "package.json is not valid JSON."); }
    if (!isRecord(declared) || declared.workspaces !== undefined) throw new MoguriError("cache_manifest", "This adapter requires a single-project manifest without workspaces.");
    for (const section of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
      const dependencies = declared[section];
      if (dependencies === undefined) continue;
      if (!isRecord(dependencies) || Object.entries(dependencies).some(([name, range]) => !packageName.test(name) || !registryRange(range))) {
        throw new MoguriError("cache_resolution", "Declared dependencies must be registry names with semver ranges. Tags, aliases, local, Git and executable resolutions require a separately qualified adapter.");
      }
    }
    validateOverrides(declared.overrides);
    const packages: DependencyPackage[] = [];
    if (manager === "npm") {
      let data: unknown;
      try { data = JSON.parse(lock.text); } catch { throw new MoguriError("cache_lock", "package-lock.json is not valid JSON."); }
      if (!isRecord(data) || ![2, 3].includes(Number(data.lockfileVersion)) || !isRecord(data.packages)) throw new MoguriError("cache_lock", "Use an npm version-2 or version-3 lockfile.");
      for (const [path, item] of Object.entries(data.packages)) {
        if (!path) continue;
        if (!isRecord(item) || !packageLocation.test(path) || item.link) throw new MoguriError("cache_lock", "Linked/workspace or escaping package locations are not supported; they were not skipped.");
        packages.push(this.entry(item.name ?? path.slice(path.lastIndexOf("node_modules/") + 13), item.version, item.integrity, item.resolved, item.hasInstallScript === true));
      }
      for (const section of ["dependencies", "devDependencies", "optionalDependencies"]) {
        for (const [name, range] of Object.entries(isRecord(declared[section]) ? declared[section] : {})) {
          const item = data.packages[`node_modules/${name}`];
          if (!isRecord(item) || typeof item.version !== "string" || !satisfies(item.version, String(range))) throw new MoguriError("cache_lock", "The declared dependency ranges do not match this lock. Generate and review a consistent lock before cache admission.");
        }
      }
    } else {
      const yaml = parseDocument(lock.text, { uniqueKeys: true, schema: "core" });
      if (yaml.errors.length) throw new MoguriError("cache_lock", "pnpm-lock.yaml contains invalid or duplicate fields.");
      const data: unknown = yaml.toJS({ maxAliasCount: 10 });
      if (!isRecord(data) || Number(data.lockfileVersion) !== 9 || !isRecord(data.packages) || !isRecord(data.importers) || Object.keys(data.importers).some((key) => key !== ".")) throw new MoguriError("cache_lock", "This adapter supports single-project pnpm lockfile 9. Workspace/importer formats require qualification.");
      if (data.patchedDependencies !== undefined) throw new MoguriError("cache_resolution", "Patched dependencies require a separately reviewed adapter; external patch paths are not read.");
      validateOverrides(data.overrides);
      for (const [key, value] of Object.entries(data.packages)) {
        const plain = key.split("(")[0]!;
        const at = plain.lastIndexOf("@");
        if (!isRecord(value) || !isRecord(value.resolution) || Object.keys(value.resolution).some((key) => key !== "integrity")) throw new MoguriError("cache_lock", "pnpm resolution must contain only SHA-512 integrity, never directory, Git or custom-tarball fields.");
        packages.push(this.entry(plain.slice(0, at), plain.slice(at + 1), value.resolution.integrity));
      }
      if (!isRecord(data.snapshots) || !isRecord(data.importers["."])) throw new MoguriError("cache_lock", "The pnpm lock needs complete importer and snapshot data.");
      const snapshots = data.snapshots;
      const validateReferences = (entry: unknown, importer: boolean) => {
        if (!isRecord(entry)) throw new MoguriError("cache_lock", "Invalid pnpm dependency snapshot.");
        for (const section of ["dependencies", "devDependencies", "optionalDependencies"]) {
          const references = entry[section];
          if (references === undefined) continue;
          if (!isRecord(references)) throw new MoguriError("cache_resolution", "Invalid pnpm dependency references.");
          for (const [name, raw] of Object.entries(references)) {
            const version = importer && isRecord(raw) ? raw.version : raw;
            if (!packageName.test(name) || !lockedVersion(version) || !(`${name}@${version}` in snapshots) ||
              importer && (!isRecord(raw) || !registryRange(raw.specifier))) throw new MoguriError("cache_resolution", "Every pnpm reference must resolve to an integrity-checked registry snapshot. Local, URL, Git and missing references are blocked.");
          }
        }
      };
      for (const [key, value] of Object.entries(snapshots)) {
        const base = key.split("(")[0]!;
        if (!(base in data.packages) || !lockedVersion(key.slice(key.lastIndexOf("@", base.length - 1) + 1))) throw new MoguriError("cache_resolution", "The pnpm snapshot has an unqualified package or peer resolution.");
        validateReferences(value, false);
      }
      validateReferences(data.importers["."], true);
    }
    const unique = new Map<string, DependencyPackage>();
    for (const entry of packages) {
      const prior = unique.get(entry.url);
      if (prior && prior.integrity !== entry.integrity) throw new MoguriError("cache_lock", "One package/version resolves to conflicting integrity values. Review the lockfile.");
      unique.set(entry.url, entry);
    }
    if (unique.size > 1000) throw new MoguriError("cache_limit", "A managed cache plan is limited to 1,000 unique packages.");
    let cachedPackages = 0;
    for (const entry of unique.values()) if (await cacache.get.hasContent(this.content, entry.integrity)) cachedPackages++;
    return {
      projectId: project.id, manager, manifestDigest: manifest.digest, lockDigest: lock.digest,
      digest: digest(JSON.stringify([project.id, manager, manifest.digest, lock.digest, "public-npm-cache-v1"])),
      packages: [...unique.values()], cachedPackages, npmCache: this.npmCache, pnpmStore: this.pnpmStore, scripts: "blocked",
      diagnostic: "Archives are shared by integrity across projects and branches; mutable install trees are not shared. Advisory checks must pass before downloads/reuse. Lifecycle scripts and pnpm hooks never run on the host.",
    };
  }
  private async checked(project: Project, manager: PackageManager, expected: string) {
    const plan = await this.inspect(project, manager);
    if (plan.digest !== expected) throw new MoguriError("cache_stale", "The project manifest or lock changed, possibly after a branch switch. Inspect and approve a new plan.", 409);
    return plan;
  }
  private async audit(packages: DependencyPackage[], signal: AbortSignal): Promise<void> {
    for (let offset = 0; offset < packages.length; offset += 100) {
      const batch = packages.slice(offset, offset + 100);
      const result = await fetchJson(this.options.fetch ?? fetch, "https://api.osv.dev/v1/querybatch", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ queries: batch.map(({ name, version }) => ({ package: { name, ecosystem: "npm" }, version })) }),
      }, AbortSignal.any([signal, AbortSignal.timeout(20_000)]));
      if (!isRecord(result) || !Array.isArray(result.results) || result.results.length !== batch.length) throw new MoguriError("cache_audit_unknown", "The advisory response is incomplete. Unknown security status blocks downloads and install.");
      for (const [index, entry] of result.results.entries()) {
        if (!isRecord(entry) || entry.error || entry.next_page_token || entry.vulns !== undefined && !Array.isArray(entry.vulns)) throw new MoguriError("cache_audit_unknown", "The advisory response is incomplete or paginated. No package was admitted.");
        if (Array.isArray(entry.vulns) && entry.vulns.length) {
          const pkg = batch[index]!;
          throw new MoguriError("cache_advisory", `Known vulnerabilities block ${pkg.name}@${pkg.version}. Review the dependency before downloading or reusing it.`, 409);
        }
      }
    }
  }
  private key(entry: DependencyPackage): string { return `make-fetch-happen:request-cache:${entry.url}`; }
  private async put(entry: DependencyPackage, data: Buffer): Promise<void> {
    try { await cacache.put(this.content, this.key(entry), data, { integrity: entry.integrity, metadata: {
      time: Date.now(), url: entry.url, reqHeaders: {}, resHeaders: { "cache-control": "public, max-age=31536000, immutable", "content-type": "application/octet-stream" }, options: { compress: true },
    } }); }
    catch (error) { if (error instanceof Error && "code" in error && error.code === "EINTEGRITY") throw new MoguriError("cache_integrity", `Bytes did not match ${entry.name}@${entry.version}'s pinned integrity. Nothing was admitted.`); throw error; }
  }
  private async read(entry: DependencyPackage): Promise<Buffer | null> {
    try {
      const metadata = await cacache.get.hasContent(this.content, entry.integrity);
      if (!metadata) return null;
      if (metadata.size > 64 * 1024 * 1024) throw new MoguriError("cache_limit", "Cached artifact exceeded its 64 MiB bound; it was not read or served.");
      return await cacache.get.byDigest(this.content, entry.integrity, { integrity: entry.integrity, memoize: false });
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
      throw new MoguriError("cache_integrity", "Cached bytes failed integrity verification. Inspect/remove the affected cache object; it was not served.", 409);
    }
  }
  private async artifact(entry: DependencyPackage, signal: AbortSignal, remaining: number): Promise<{ data: Buffer; downloaded: number }> {
    const pending = this.pending.get(entry.integrity);
    if (pending) {
      let cancel: (() => void) | undefined;
      const cancellation = new Promise<never>((_, reject) => {
        cancel = () => reject(signal.reason);
        signal.addEventListener("abort", cancel, { once: true });
        if (signal.aborted) cancel();
      });
      let result: Awaited<typeof pending>;
      try { result = await Promise.race([pending, cancellation]); }
      finally { if (cancel) signal.removeEventListener("abort", cancel); }
      signal.throwIfAborted();
      await this.put(entry, result.data);
      return { data: result.data, downloaded: 0 };
    }
    const task = (async () => {
      const cached = await this.read(entry);
      if (cached) { await this.put(entry, cached); return { data: cached, downloaded: 0 }; }
      if (remaining <= 0) throw new MoguriError("cache_limit", "This preparation exceeded the 512 MiB download limit.");
      const response = await (this.options.fetch ?? fetch)(entry.url, { signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]), redirect: "error" });
      if (!response.ok) { await response.body?.cancel(); throw new MoguriError("cache_download", `Registry returned HTTP ${response.status}; no package was admitted.`); }
      const data = await boundedBody(response, Math.min(remaining, 64 * 1024 * 1024), signal);
      signal.throwIfAborted(); await this.put(entry, data);
      return { data, downloaded: data.length };
    })();
    this.pending.set(entry.integrity, task);
    try { return await task; } finally { if (this.pending.get(entry.integrity) === task) this.pending.delete(entry.integrity); }
  }
  async prepare(project: Project, manager: PackageManager, expected: string, signal: AbortSignal, progress: (message: string) => void): Promise<CacheReceipt> {
    signal = AbortSignal.any([signal, AbortSignal.timeout(10 * 60_000)]);
    const plan = await this.checked(project, manager, expected);
    await mkdir(this.npmCache, { recursive: true, mode: 0o700 });
    progress("Checking exact public dependency versions against OSV before fetching artifacts.");
    await this.audit(plan.packages, signal);
    let reused = 0;
    let downloadedBytes = 0;
    for (const [index, entry] of plan.packages.entries()) {
      signal.throwIfAborted();
      const result = await this.artifact(entry, signal, 512 * 1024 * 1024 - downloadedBytes);
      signal.throwIfAborted();
      if (!result.downloaded) reused++;
      downloadedBytes += result.downloaded;
      this.store.db.prepare("INSERT OR REPLACE INTO dependency_cache_objects VALUES (?,?,?,?)").run(this.key(entry), entry.integrity, result.data.length, new Date().toISOString());
      progress(`Verified ${index + 1}/${plan.packages.length} packages; ${reused} reused. All lifecycle scripts remain blocked.`);
    }
    signal.throwIfAborted();
    await this.checked(project, manager, expected);
    return { projectId: project.id, manager, digest: expected, lockDigest: plan.lockDigest, checkedAt: new Date().toISOString(), packages: plan.packages.length, reused, downloadedBytes, scripts: "blocked" };
  }
  async install(project: Project, manager: PackageManager, expected: string, signal: AbortSignal, progress: (message: string) => void): Promise<CacheReceipt> {
    const receipt = await this.prepare(project, manager, expected, signal, progress);
    const plan = await this.checked(project, manager, expected);
    const runtime = join(this.stateDir, "dependency-cache", "runtime");
    await mkdir(runtime, { recursive: true, mode: 0o700 });
    const emptyConfig = join(runtime, "empty.npmrc"); await writeFile(emptyConfig, "", { mode: 0o600 });
    const globalConfig = join(runtime, "global.npmrc"); await writeFile(globalConfig, "", { mode: 0o600 });
    const staging = await mkdtemp(join(runtime, "install-"));
    const env = {
      PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? "/usr/bin:/bin"}`,
      npm_config_userconfig: emptyConfig, npm_config_globalconfig: globalConfig, npm_config_ignore_scripts: "true",
      XDG_CACHE_HOME: join(runtime, "cache"), XDG_DATA_HOME: join(runtime, "data"), CI: "true",
    };
    progress("Installing only verified artifacts; lifecycle scripts/hooks are disabled. Existing node_modules may be replaced.");
    try {
      const manifest = await readProjectFile(project.path, "package.json", 2 * 1024 * 1024);
      const raw: unknown = JSON.parse(manifest.text);
      if (!isRecord(raw) || raw.workspaces) throw new MoguriError("cache_workspace", "Managed installs require a single-project manifest; workspace adapters are not qualified.");
      const safeManifest = Object.fromEntries(["name", "version", "dependencies", "devDependencies", "optionalDependencies", "peerDependencies", "peerDependenciesMeta", "engines", "os", "cpu", "overrides"].filter((key) => key in raw).map((key) => [key, raw[key]]));
      await writeFile(join(staging, "package.json"), JSON.stringify(safeManifest));
      const lockName = manager === "npm" ? "package-lock.json" : "pnpm-lock.yaml";
      await writeFile(join(staging, lockName), (await readProjectFile(project.path, lockName, 2 * 1024 * 1024)).text);
      await this.checked(project, manager, expected);
      if (manager === "npm") {
        await runProgram("npm", ["ci", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", "--no-progress", "--cache", this.npmCache, "--registry", "https://registry.npmjs.org", "--userconfig", emptyConfig, "--globalconfig", globalConfig], { cwd: staging, env, signal, label: "Managed npm install", timeoutMs: 300_000 });
      } else {
        const allowed = new Map(plan.packages.map((entry) => [new URL(entry.url).pathname, entry]));
        const mirror = createServer((request, response) => {
          const entry = request.method === "GET" ? allowed.get(request.url ?? "") : undefined;
          if (!entry) { response.writeHead(403).end("Not in the approved lock plan."); return; }
          void this.read(entry).then((bytes) => {
            if (!bytes) { response.writeHead(410).end("Verified artifact is missing."); return; }
            response.setHeader("Content-Type", "application/octet-stream"); response.end(bytes);
          }).catch(() => { response.writeHead(409).end("Integrity verification failed."); });
        });
        await new Promise<void>((resolve, reject) => { mirror.once("error", reject); mirror.listen(0, "127.0.0.1", resolve); });
        try {
          const address = mirror.address();
          if (!address || typeof address === "string") throw new MoguriError("cache_mirror", "The verified local cache mirror did not bind.");
          const pnpm = join(dirname(require.resolve("pnpm/package.json")), "bin", "pnpm.mjs");
          await runProgram(process.execPath, [pnpm, "install", "--frozen-lockfile", "--ignore-scripts", "--ignore-pnpmfile", "--ignore-workspace", "--trust-lockfile",
            "--registry", `http://127.0.0.1:${address.port}`, "--store-dir", this.pnpmStore, "--package-import-method", "clone-or-copy", "--config.manage-package-manager-versions=false", "--config.package-manager-strict=false", `--config.cache-dir=${join(runtime, "pnpm-cache")}`], { cwd: staging, env, signal, label: "Managed pnpm install", timeoutMs: 300_000 });
        } finally { mirror.closeAllConnections(); await new Promise<void>((resolve) => mirror.close(() => resolve())); }
      }
      await this.checked(project, manager, expected);
      signal.throwIfAborted();
      await mkdir(join(staging, "node_modules"), { recursive: true });
      const target = join(project.path, "node_modules");
      const backup = join(project.path, `.moguri-dependencies-${randomUUID()}`);
      let replaced = false;
      let installed = false;
      try {
        const existing = await lstat(target).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return null; throw error; });
        if (existing && (!existing.isDirectory() || existing.isSymbolicLink())) throw new MoguriError("cache_target", "Refusing to replace a symlink or non-directory node_modules target.");
        if (existing) { await rename(target, backup); replaced = true; }
        try { await rename(join(staging, "node_modules"), target); installed = true; }
        catch (error) {
          if (replaced) {
            try { await rename(backup, target); replaced = false; }
            catch (restoreError) { throw new MoguriError("install_partial", `Previous dependency tree is preserved at ${backup}; restoration failed: ${restoreError instanceof Error ? restoreError.message : "inspect filesystem permissions"}`, 409); }
          }
          throw error;
        }
      } finally { if (replaced && installed) await rm(backup, { recursive: true }); }
      return receipt;
    } catch (error) {
      console.error("Managed dependency install failed:", error instanceof Error ? error.message : "Unknown install error");
      throw new MoguriError("install_partial", `The managed install did not complete. Dependency files may be partial; inspect before retrying. ${error instanceof Error ? error.message : ""}`, 409);
    } finally { await rm(staging, { recursive: true, force: true }); }
  }
}
