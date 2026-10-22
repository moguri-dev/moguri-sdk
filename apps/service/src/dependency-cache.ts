import { createServer } from "node:http";
import { chmod, lstat, mkdir, mkdtemp, open, readdir, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, delimiter, join, relative, sep } from "node:path";
import * as cacache from "cacache";
import { valid } from "semver";
import { parseDocument } from "yaml";
import { isRecord, MoguriError, type CacheReceipt, type DependencyPackage, type DependencyPlan, type PackageManager, type Project } from "../../../packages/protocol/src/index.ts";
import type { DependencyRegistry } from "../../../packages/protocol/src/workspace.ts";
import { boundedBody, fetchJson } from "./network.ts";
import { runProgram } from "./program.ts";
import { digest, EventStore } from "./store.ts";
import { McpKeychain, type SecretVault } from "./gateway.ts";
import { cacheUrl, DependencyRegistries, inRegistry, npmPackageName } from "./dependency-registries.ts";
import { dependencyRoot, inspectNodeDependencyTree, safeManifestPath, sanitizedManifest, type NodeDependencyTree } from "./dependency-manifests.ts";
import { NativeDependencyCache, type NativeDependencyCacheOptions } from "./dependency-native-cache.ts";

export interface DependencyCacheOptions extends NativeDependencyCacheOptions {
  fetch?: typeof fetch; cacheDirectory?: string; vault?: SecretVault;
  registries?: () => DependencyRegistry[]; allowLoopback?: boolean;
}
const require = createRequire(import.meta.url);
const integrityPattern = /^sha512-[A-Za-z0-9+/]{86}==$/;
export class DependencyCache {
  readonly npmCache: string;
  readonly pnpmStore: string;
  readonly registries: DependencyRegistries;
  private readonly content: string;
  private readonly directory: string;
  private readonly native: NativeDependencyCache;
  private readonly pending = new Map<string, Promise<{ data: Buffer; downloaded: number }>>();
  constructor(private readonly store: EventStore, private readonly stateDir: string, private readonly options: DependencyCacheOptions = {}) {
    this.directory = options.cacheDirectory ?? join(stateDir, "dependency-cache");
    this.npmCache = join(this.directory, "npm"); this.pnpmStore = join(this.directory, "pnpm"); this.content = join(this.npmCache, "_cacache");
    this.registries = new DependencyRegistries(store.profileId, options.vault ?? new McpKeychain(`dev.moguri.profile.${store.profileId}.dependency-cache`), options.registries ?? (() => []), options.allowLoopback);
    this.native = new NativeDependencyCache(this.directory, stateDir, options, {
      audit: (entries, signal) => this.audit(entries, signal),
      fetch: options.fetch ?? fetch,
    });
  }
  close(): void { this.registries.close(); }
  private cacheContent(entry: DependencyPackage): string {
    return entry.registryId ? join(this.directory, "private", digest(this.store.profileId), entry.scope!, "_cacache") : this.content;
  }
  private entry(name: unknown, version: unknown, integrity: unknown, resolved?: unknown, hasInstallScript = false): DependencyPackage {
    if (typeof name !== "string" || !npmPackageName.test(name) || typeof version !== "string" || version.length > 200 || !valid(version) || typeof integrity !== "string" || !integrityPattern.test(integrity)) {
      throw new MoguriError("cache_lock", "Every cached package needs a registry name, exact version and SHA-512 integrity. Git, local, exotic and unpinned dependencies are not supported.");
    }
    const registry = this.registries.resolve(name);
    const base = registry?.url ?? "https://registry.npmjs.org/";
    const canonical = `${base}${name}/-/${name.split("/").at(-1)}-${version}.tgz`;
    let url = canonical;
    if (resolved !== undefined) {
      if (typeof resolved !== "string") throw new MoguriError("cache_registry", "A locked tarball needs an exact reviewed registry resource URL.");
      url = cacheUrl(resolved, this.options.allowLoopback);
      if (!registry && url !== canonical || registry && !inRegistry(url, registry.url)) throw new MoguriError("cache_registry", "The locked artifact is outside its explicit registry/resource authorization. Ambient .npmrc credentials and cross-origin fallback are never used.");
    }
    return { name, version, integrity, url, hasInstallScript, ecosystem: "npm",
      ...(registry ? { registryId: registry.id, scope: this.registries.scope(registry) } : {}) };
  }
  private nodeTree(project: Project, manager: "npm" | "pnpm"): Promise<NodeDependencyTree> {
    return inspectNodeDependencyTree(project, manager, (name, version, integrity, resolved, scripts) => this.entry(name, version, integrity, resolved, scripts));
  }
  async inspect(project: Project, manager: PackageManager): Promise<DependencyPlan> {
    if (manager !== "npm" && manager !== "pnpm") return this.native.inspect(project, manager);
    const root = await dependencyRoot(project), tree = await this.nodeTree(project, manager);
    const unique = new Map<string, DependencyPackage>();
    for (const entry of tree.packages) {
      const key = `${entry.scope ?? "public"}:${entry.url}`, previous = unique.get(key);
      if (previous && (previous.integrity !== entry.integrity || previous.name !== entry.name || previous.version !== entry.version)) throw new MoguriError("cache_lock", "One registry resource resolves to conflicting package/version/integrity identities. Review the lockfile; aliases and source bytes were not conflated.");
      unique.set(key, { ...entry, hasInstallScript: entry.hasInstallScript || previous?.hasInstallScript === true });
    }
    if (unique.size > 1000) throw new MoguriError("cache_limit", "A managed cache plan is limited to 1,000 unique packages.");
    let cachedPackages = 0;
    for (const entry of unique.values()) {
      if (entry.registryId) await this.protect(this.cacheContent(entry));
      if (await cacache.get.hasContent(this.cacheContent(entry), entry.integrity)) cachedPackages++;
    }
    const registryScopes = [...new Set([...unique.values()].flatMap((entry) => entry.registryId ? [entry.registryId] : []))].sort().map((id) => {
      const registry = this.registries.get(id);
      return { registryId: id, revision: registry.revision, resource: registry.url, scope: this.registries.scope(registry), advisoryUrl: registry.advisoryUrl, metadataSharing: registry.sharePrivateMetadata };
    });
    const scope = registryScopes.length ? digest(JSON.stringify([this.store.profileId, registryScopes])) : null;
    const nativeRoot = scope ? join(this.directory, "private", digest(this.store.profileId), scope) : this.directory;
    const manifests = tree.manifests.map(({ path, digest, name }) => ({ path, digest, name }));
    const manifestDigest = manifests.length === 1 && !tree.workspaceFile ? manifests[0]!.digest : digest(JSON.stringify([manifests, tree.workspaceFile?.digest ?? null]));
    return {
      projectId: project.id, root, manager, manifestDigest, lockDigest: tree.lock.digest,
      digest: digest(JSON.stringify([project.id, root, manager, manifests, tree.workspaceFile?.digest ?? null, tree.lock.digest, registryScopes, "reviewed-node-cache-v2"])),
      packages: [...unique.values()], cachedPackages, npmCache: join(nativeRoot, "npm"), pnpmStore: join(nativeRoot, "pnpm"), manifests, registryScopes,
      mode: "script-free-install", scripts: "blocked",
      diagnostic: "Exact root/member manifests and lock bytes are reviewed together. Public archives may share; private bytes bind the actual profile, registry/resource and credential generation. Only approved workspace links are admitted. Lifecycle scripts, .npmrc and pnpm hooks never execute.",
    };
  }
  private async checked(project: Project, manager: PackageManager, expected: string): Promise<DependencyPlan> {
    const plan = await this.inspect(project, manager);
    if (plan.digest !== expected) throw new MoguriError("cache_stale", "The root/member manifest, lock, policy or registry authorization changed, possibly after a branch switch. Inspect and approve a new plan.", 409);
    return plan;
  }
  private async audit(packages: DependencyPackage[], signal: AbortSignal): Promise<void> {
    const groups = new Map<string, Map<string, DependencyPackage>>();
    for (const entry of packages) {
      let destination = "https://api.osv.dev/v1/querybatch";
      if (entry.registryId) {
        const registry = this.registries.get(entry.registryId);
        if (entry.scope !== this.registries.scope(registry)) throw new MoguriError("cache_registry_changed", "Registry authorization changed before advisory checking.", 409);
        if (!registry.sharePrivateMetadata) throw new MoguriError("cache_private_advisory", "Private dependency names cannot be disclosed until you explicitly review and enable this registry's exact advisory destination. No advisory or artifact request was sent.", 409);
        destination = registry.advisoryUrl;
      }
      const group = groups.get(destination) ?? new Map<string, DependencyPackage>();
      group.set(`${entry.ecosystem ?? "npm"}:${entry.name}@${entry.version}`, entry); groups.set(destination, group);
    }
    for (const [destination, group] of groups) {
      const entries = [...group.values()];
      for (let offset = 0; offset < entries.length; offset += 100) {
        const batch = entries.slice(offset, offset + 100);
        let result: unknown;
        try {
          result = await fetchJson(this.options.fetch ?? fetch, destination, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ queries: batch.map(({ name, version, ecosystem }) => ({ package: { name, ecosystem: ecosystem ?? "npm" }, version })) }),
          }, AbortSignal.any([signal, AbortSignal.timeout(20_000)]));
        } catch { signal.throwIfAborted(); throw new MoguriError("cache_audit_unknown", "The exact reviewed advisory service is unavailable or denied the request. Unknown security status blocks downloads and reuse; no destination fallback was used.", 409); }
        if (!isRecord(result) || !Array.isArray(result.results) || result.results.length !== batch.length) throw new MoguriError("cache_audit_unknown", "The advisory response is incomplete. Unknown security status blocks downloads and install.");
        for (const [index, entry] of result.results.entries()) {
          if (!isRecord(entry) || entry.error || entry.next_page_token || entry.vulns !== undefined && !Array.isArray(entry.vulns)) throw new MoguriError("cache_audit_unknown", "The advisory response is incomplete or paginated. No package was admitted.");
          if (Array.isArray(entry.vulns) && entry.vulns.length) throw new MoguriError("cache_advisory", `Known vulnerabilities block ${batch[index]!.name}@${batch[index]!.version}. Review the dependency before downloading or reusing it.`, 409);
        }
      }
    }
  }
  private key(entry: DependencyPackage): string { return `make-fetch-happen:request-cache:${entry.url}`; }
  private async protect(content: string): Promise<void> {
    const parts = relative(this.directory, dirname(content)).split(sep);
    if (parts[0] !== "private") return;
    let path = this.directory;
    await mkdir(path, { recursive: true, mode: 0o700 });
    const root = await lstat(path);
    if (!root.isDirectory() || root.isSymbolicLink() || process.getuid && root.uid !== process.getuid()) throw new MoguriError("cache_registry_scope", "The private cache root is not the exact owned nonsymlink directory.");
    for (const part of parts) {
      if (!part || part === "." || part === "..") throw new MoguriError("cache_registry_scope", "A private cache namespace escaped its exact owned root.");
      path = join(path, part); await mkdir(path, { recursive: true, mode: 0o700 });
      const metadata = await lstat(path);
      if (!metadata.isDirectory() || metadata.isSymbolicLink() || process.getuid && metadata.uid !== process.getuid()) throw new MoguriError("cache_registry_scope", "A private cache namespace is not a nonsymlink directory owned by the service user. No private bytes were stored.");
      await chmod(path, 0o700);
    }
  }
  private async put(entry: DependencyPackage, data: Buffer, content = this.cacheContent(entry)): Promise<void> {
    await this.protect(content);
    try { await cacache.put(content, this.key(entry), data, { integrity: entry.integrity, metadata: {
      time: Date.now(), url: entry.url, reqHeaders: {}, resHeaders: { "cache-control": `${entry.registryId ? "private" : "public"}, max-age=31536000, immutable`, "content-type": "application/octet-stream" }, options: { compress: true },
    } }); } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "EINTEGRITY") throw new MoguriError("cache_integrity", `Bytes did not match ${entry.name}@${entry.version}'s pinned integrity. Nothing was admitted.`);
      throw error;
    }
  }
  private async read(entry: DependencyPackage): Promise<Buffer | null> {
    try {
      await this.protect(this.cacheContent(entry));
      const metadata = await cacache.get.hasContent(this.cacheContent(entry), entry.integrity);
      if (!metadata) return null;
      if (metadata.size > 64 * 1024 * 1024) throw new MoguriError("cache_limit", "Cached artifact exceeded its 64 MiB bound; it was not read or served.");
      return await cacache.get.byDigest(this.cacheContent(entry), entry.integrity, { integrity: entry.integrity, memoize: false });
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
      throw new MoguriError("cache_integrity", "Cached bytes failed integrity verification. Inspect/remove the affected cache object; it was not served.", 409);
    }
  }
  private async artifact(entry: DependencyPackage, signal: AbortSignal, remaining: number): Promise<{ data: Buffer; downloaded: number }> {
    const key = JSON.stringify([entry.scope ?? "public", entry.url, entry.integrity]);
    const pending = this.pending.get(key);
    if (pending) {
      const result = await new Promise<Awaited<typeof pending>>((resolve, reject) => {
        const cancel = () => reject(signal.reason);
        signal.addEventListener("abort", cancel, { once: true });
        pending.then(resolve, reject).finally(() => signal.removeEventListener("abort", cancel));
        if (signal.aborted) cancel();
      });
      signal.throwIfAborted(); return { data: result.data, downloaded: 0 };
    }
    const task = this.registries.authorized(entry, signal, async (headers, authorizedSignal) => {
      const cached = await this.read(entry);
      if (cached) { await this.put(entry, cached); return { data: cached, downloaded: 0 }; }
      if (remaining <= 0) throw new MoguriError("cache_limit", "This preparation exceeded the 512 MiB download limit.");
      let response: Response;
      try { response = await (this.options.fetch ?? fetch)(entry.url, { headers, signal: AbortSignal.any([authorizedSignal, AbortSignal.timeout(30_000)]), redirect: "error" }); }
      catch { authorizedSignal.throwIfAborted(); throw new MoguriError("cache_download", "The exact authorized registry request failed. Credentials and cross-origin redirects were not retried or logged.", 409); }
      if (!response.ok) { await response.body?.cancel(); throw new MoguriError("cache_download", `Registry returned HTTP ${response.status}; no package was admitted.`); }
      const data = await boundedBody(response, Math.min(remaining, 64 * 1024 * 1024), authorizedSignal);
      authorizedSignal.throwIfAborted(); await this.put(entry, data); return { data, downloaded: data.length };
    });
    this.pending.set(key, task);
    try { return await task; } finally { if (this.pending.get(key) === task) this.pending.delete(key); }
  }
  async prepare(project: Project, manager: PackageManager, expected: string, signal: AbortSignal, progress: (message: string) => void, guard?: () => Promise<void>): Promise<CacheReceipt> {
    if (manager !== "npm" && manager !== "pnpm") return this.native.prepare(project, manager, expected, signal, progress, guard);
    signal = AbortSignal.any([signal, AbortSignal.timeout(10 * 60_000)]);
    const plan = await this.checked(project, manager, expected);
    await guard?.();
    progress("Checking every exact dependency at its reviewed advisory destination before fetching or reusing artifacts.");
    await this.audit(plan.packages, signal);
    let reused = 0, downloadedBytes = 0;
    for (const [index, entry] of plan.packages.entries()) {
      signal.throwIfAborted();
      const result = await this.artifact(entry, signal, 512 * 1024 * 1024 - downloadedBytes);
      signal.throwIfAborted();
      if (!result.downloaded) reused++;
      downloadedBytes += result.downloaded;
      this.store.db.prepare("INSERT OR REPLACE INTO dependency_cache_objects VALUES (?,?,?,?)").run(`${entry.scope ?? "public"}:${this.key(entry)}`, entry.integrity, result.data.length, new Date().toISOString());
      progress(`Verified ${index + 1}/${plan.packages.length} packages; ${reused} reused. All lifecycle scripts remain blocked.`);
    }
    signal.throwIfAborted(); await this.checked(project, manager, expected); await guard?.();
    return { projectId: project.id, manager, digest: expected, lockDigest: plan.lockDigest, checkedAt: new Date().toISOString(), packages: plan.packages.length, reused, downloadedBytes, scripts: "blocked" };
  }
  async install(project: Project, manager: PackageManager, expected: string, signal: AbortSignal, progress: (message: string) => void, guard?: () => Promise<void>): Promise<CacheReceipt> {
    if (manager !== "npm" && manager !== "pnpm") throw new MoguriError("cache_only", "This adapter prepares a verified native-manager cache only. Python environments, Cargo builds/proc macros and Go builds require an explicitly qualified execution boundary; no host build or substitute install was started.", 409);
    if ((await readdir(project.path)).some((name) => name.startsWith(".moguri-dependencies-"))) throw new MoguriError("install_partial", "An earlier protected dependency staging/publication remains in this root. Review its journal and backups before explicit cleanup; managed installs never replay or delete interrupted work.", 409);
    const receipt = await this.prepare(project, manager, expected, signal, progress, guard);
    const plan = await this.checked(project, manager, expected), tree = await this.nodeTree(project, manager);
    const runtime = join(this.stateDir, "dependency-cache", "runtime");
    await mkdir(runtime, { recursive: true, mode: 0o700 });
    const configuration = await mkdtemp(join(runtime, "configuration-"));
    const emptyConfig = join(configuration, "empty.npmrc"), globalConfig = join(configuration, "global.npmrc"), home = join(configuration, "home");
    await mkdir(home, { mode: 0o700 }); await writeFile(emptyConfig, "", { mode: 0o600 }); await writeFile(globalConfig, "", { mode: 0o600 });
    const owned = join(project.path, `.moguri-dependencies-${randomUUID()}`), staging = join(owned, "staging");
    await mkdir(staging, { recursive: true, mode: 0o700 });
    const env = {
      PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? "/usr/bin:/bin"}`, HOME: home, TMPDIR: configuration,
      npm_config_userconfig: emptyConfig, npm_config_globalconfig: globalConfig, npm_config_ignore_scripts: "true",
      npm_config_logs_dir: join(configuration, "logs"), XDG_CONFIG_HOME: join(configuration, "config"),
      XDG_CACHE_HOME: join(configuration, "cache"), XDG_DATA_HOME: join(configuration, "data"), CI: "true", COREPACK_ENABLE_AUTO_PIN: "0",
    };
    let retain = false;
    progress("Installing only verified artifacts from the exact reviewed member tree; scripts/configuration hooks are disabled.");
    try {
      for (const manifest of tree.manifests) {
        await mkdir(join(staging, manifest.directory), { recursive: true });
        const safe = sanitizedManifest(manifest.raw, manifest.directory === "" && tree.manifests.length > 1);
        if (!manifest.directory && tree.manifests.length > 1) safe.workspaces = tree.manifests.slice(1).map((member) => member.directory);
        await writeFile(join(staging, manifest.path), JSON.stringify(safe));
      }
      await writeFile(join(staging, tree.lock.path), tree.lock.text);
      if (manager === "pnpm" && tree.manifests.length > 1) await writeFile(join(staging, "pnpm-workspace.yaml"), `packages:\n${tree.manifests.slice(1).map((member) => `  - ${JSON.stringify(member.directory)}`).join("\n")}\n`);
      await this.checked(project, manager, expected);
      if (manager === "npm") {
        for (const entry of plan.packages) {
          const bytes = await this.read(entry);
          if (!bytes) throw new MoguriError("cache_integrity", "A verified archive disappeared before the offline install.", 409);
          await this.put(entry, bytes, join(plan.npmCache, "_cacache"));
        }
        await runProgram("npm", ["ci", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", "--no-progress", "--cache", plan.npmCache, "--registry", "https://registry.npmjs.org", "--userconfig", emptyConfig, "--globalconfig", globalConfig], { cwd: staging, env, signal, label: "Managed npm install", timeoutMs: 300_000 });
      } else {
        const mirrorPath = (entry: DependencyPackage) => `/artifacts/${digest(JSON.stringify([entry.scope ?? "public", entry.url, entry.integrity]))}.tgz`;
        const allowed = new Map(plan.packages.map((entry) => [mirrorPath(entry), entry]));
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
          const args = [pnpm, "install", "--frozen-lockfile", "--ignore-scripts", "--ignore-pnpmfile", "--trust-lockfile",
            "--registry", `http://127.0.0.1:${address.port}`, "--store-dir", plan.pnpmStore, "--package-import-method", "clone-or-copy", "--verify-store-integrity",
            "--config.manage-package-manager-versions=false", "--config.package-manager-strict=false", "--config.update-notifier=false", `--config.cache-dir=${join(configuration, "pnpm-cache")}`];
          if (tree.manifests.length === 1) args.push("--ignore-workspace");
          const locked = parseDocument(tree.lock.text, { uniqueKeys: true, schema: "core" });
          const raw: unknown = locked.toJS({ maxAliasCount: 10 });
          if (!isRecord(raw) || raw.packages !== undefined && !isRecord(raw.packages)) throw new MoguriError("cache_lock", "The exact reviewed pnpm package table is missing.");
          for (const [key, value] of Object.entries(isRecord(raw.packages) ? raw.packages : {})) {
            const plain = key.split("(")[0]!, at = plain.lastIndexOf("@");
            const entry = plan.packages.find((entry) => entry.name === plain.slice(0, at) && entry.version === plain.slice(at + 1) && isRecord(value) && isRecord(value.resolution) && entry.integrity === value.resolution.integrity);
            if (!entry) throw new MoguriError("cache_lock", "A pnpm staged resolution is outside the exact reviewed source/integrity set.");
            locked.setIn(["packages", key, "resolution", "tarball"], `http://127.0.0.1:${address.port}${mirrorPath(entry)}`);
          }
          await writeFile(join(staging, tree.lock.path), locked.toString());
          await runProgram(process.execPath, args, { cwd: staging, env, signal, label: "Managed pnpm install", timeoutMs: 300_000 });
        } finally { mirror.closeAllConnections(); await new Promise<void>((resolve) => mirror.close(() => resolve())); }
      }
      await this.checked(project, manager, expected); await guard?.(); signal.throwIfAborted();
      const publications = tree.manifests.map((manifest, index) => ({ directory: manifest.directory, backup: join(owned, `backup-${index}`), replaced: false, installed: false }));
      const journal = async (status: string) => {
        const file = await open(join(owned, "publication.json"), "w", 0o600);
        try { await file.writeFile(JSON.stringify({ version: 1, digest: expected, status, roots: publications })); await file.sync(); } finally { await file.close(); }
      };
      await journal("prepared");
      try {
        for (const publication of publications) {
          signal.throwIfAborted();
          await guard?.();
          await safeManifestPath(project.path, publication.directory ? `${publication.directory}/package.json` : "package.json");
          const target = join(project.path, publication.directory, "node_modules"), source = join(staging, publication.directory, "node_modules");
          await mkdir(source, { recursive: true });
          const existing = await lstat(target).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return null; throw error; });
          if (existing && (!existing.isDirectory() || existing.isSymbolicLink())) throw new MoguriError("cache_target", "Refusing to replace a symlink or non-directory workspace node_modules target.");
          await journal("publishing");
          if (existing) { await rename(target, publication.backup); publication.replaced = true; await journal("publishing"); }
          await rename(source, target); publication.installed = true; await journal("publishing");
        }
        signal.throwIfAborted(); await this.checked(project, manager, expected); await journal("completed");
      } catch (error) {
        for (const publication of [...publications].reverse()) {
          const target = join(project.path, publication.directory, "node_modules"), source = join(staging, publication.directory, "node_modules");
          try {
            if (publication.installed) { await rename(target, source); publication.installed = false; }
            if (publication.replaced) { await rename(publication.backup, target); publication.replaced = false; }
          } catch { retain = true; }
        }
        if (retain) { await journal("partial"); throw new MoguriError("install_partial", `Dependency publication/rollback is unconfirmed. Protected prior trees and the exact publication journal remain at ${owned}; no automatic replay is allowed.`, 409); }
        throw error;
      }
      return receipt;
    } catch (error) {
      if (!retain) signal.throwIfAborted();
      throw new MoguriError("install_partial", `The managed install did not complete. Existing trees were preserved or protected backups retained; inspect before retrying. ${error instanceof MoguriError ? error.message : "Native manager or filesystem failure."}`, 409);
    } finally {
      const cleanup = await Promise.allSettled([...(retain ? [] : [rm(owned, { recursive: true, force: true })]), rm(configuration, { recursive: true, force: true })]);
      if (cleanup.some((result) => result.status === "rejected")) throw new MoguriError("install_partial", `Private dependency staging cleanup is unconfirmed. Protected staging/backups may remain at ${owned}; inspect before retrying. No cleanup or publication was replayed.`, 409);
    }
  }
}
