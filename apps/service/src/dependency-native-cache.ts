import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, delimiter, join, parse } from "node:path";
import * as cacache from "cacache";
import { isRecord, MoguriError, type CacheReceipt, type DependencyPackage, type DependencyPlan, type Project } from "../../../packages/protocol/src/index.ts";
import { readProjectFile } from "./files.ts";
import { boundedBody, fetchJson } from "./network.ts";
import { runProgram } from "./program.ts";
import { digest } from "./store.ts";
import { cacheUrl } from "./dependency-registries.ts";
import { dependencyRoot, safeManifestPath } from "./dependency-manifests.ts";

type Manager = "python" | "cargo" | "go";
export interface NativeDependencyCacheOptions {
  nativeTools?: { python?: string; cargo?: string; go?: string };
  nativeSources?: { pypi?: string; pythonFiles?: string; cargoIndex?: string; cargoArchives?: string; goProxy?: string };
}
interface Inputs { plan: DependencyPlan; files: { path: string; text: string; digest: string }[]; metadata?: Record<string, unknown> }
interface Artifact { name: string; version: string; url: string; filename: string; pin: string; bytes?: Buffer; kind: "archive" | "metadata"; route: string }
const H1 = /^h1:[A-Za-z0-9+/]{43}=$/;
const hex = /^[a-f0-9]{64}$/;
const publications = new Map<string, Promise<void>>();
async function publishNativeCache<T>(path: string, signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
  const previous = publications.get(path) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; }), tail = previous.then(() => gate);
  publications.set(path, tail);
  void tail.then(() => { if (publications.get(path) === tail) publications.delete(path); });
  let cancel: (() => void) | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      cancel = () => reject(signal.reason); signal.addEventListener("abort", cancel, { once: true });
      previous.then(resolve, reject); if (signal.aborted) cancel();
    });
    signal.throwIfAborted(); return await operation();
  } finally { if (cancel) signal.removeEventListener("abort", cancel); release(); }
}
function json(value: string): unknown { try { return JSON.parse(value); } catch { throw new MoguriError("cache_metadata", "The native dependency manager returned invalid metadata; no cache was published."); } }
function normalizedPython(value: string): string { return value.toLowerCase().replace(/[-_.]+/g, "-"); }
function moduleEscape(value: string): string { return value.replace(/[A-Z]/g, (character) => `!${character.toLowerCase()}`); }
function modulePath(value: string): boolean { return value.length <= 500 && /^[A-Za-z0-9][A-Za-z0-9._~/-]*$/.test(value) && !value.split("/").some((part) => !part || part === "." || part === ".."); }
function crateIndex(name: string): string { return name.length === 1 ? `1/${name}` : name.length === 2 ? `2/${name}` : name.length === 3 ? `3/${name[0]}/${name}` : `${name.slice(0, 2)}/${name.slice(2, 4)}/${name}`; }
export class NativeDependencyCache {
  private readonly content: string;
  constructor(private readonly directory: string, private readonly stateDirectory: string, private readonly options: NativeDependencyCacheOptions & { allowLoopback?: boolean },
    private readonly host: { fetch: typeof fetch; audit: (entries: DependencyPackage[], signal: AbortSignal) => Promise<void> }) {
    this.content = join(directory, "native-archives", "_cacache");
  }
  private sources() {
    return {
      pypi: cacheUrl(this.options.nativeSources?.pypi ?? "https://pypi.org/", this.options.allowLoopback, true),
      pythonFiles: cacheUrl(this.options.nativeSources?.pythonFiles ?? "https://files.pythonhosted.org/", this.options.allowLoopback, true),
      cargoIndex: cacheUrl(this.options.nativeSources?.cargoIndex ?? "https://index.crates.io/", this.options.allowLoopback, true),
      cargoArchives: cacheUrl(this.options.nativeSources?.cargoArchives ?? "https://static.crates.io/crates/", this.options.allowLoopback, true),
      goProxy: cacheUrl(this.options.nativeSources?.goProxy ?? "https://proxy.golang.org/", this.options.allowLoopback, true),
    };
  }
  private tool(manager: Manager): string { return this.options.nativeTools?.[manager] ?? (manager === "python" ? "python3" : manager); }
  private async cargoWorkingDirectory(root: string): Promise<string> {
    const directory = parse(root).root;
    for (const name of ["config", "config.toml"]) if (await lstat(join(directory, ".cargo", name)).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return null; throw error; })) throw new MoguriError("cache_runtime", "A filesystem-root Cargo configuration prevents an isolated native cache command. Remove that ambiguity or use a qualified execution boundary; project and personal Cargo configuration is never evaluated.", 409);
    return directory;
  }
  private async scratch() {
    const runtime = join(this.stateDirectory, "dependency-cache", "native-runtime");
    await mkdir(runtime, { recursive: true, mode: 0o700 });
    const path = await mkdtemp(join(runtime, "owned-")); await mkdir(join(path, "home"), { mode: 0o700 }); await mkdir(join(path, "scratch"), { mode: 0o700 });
    return path;
  }
  private environment(root: string): NodeJS.ProcessEnv {
    return { PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? "/usr/bin:/bin"}`, HOME: join(root, "home"), TMPDIR: join(root, "scratch"),
      XDG_CONFIG_HOME: join(root, "config"), XDG_CACHE_HOME: join(root, "cache"), XDG_DATA_HOME: join(root, "data"), NO_COLOR: "1",
      PIP_CONFIG_FILE: "/dev/null", PIP_DISABLE_PIP_VERSION_CHECK: "1", PIP_NO_INPUT: "1",
      GOENV: "off", GOWORK: "off", GOTOOLCHAIN: "local", GOTELEMETRY: "off", GOFLAGS: "", GOPATH: join(root, "gopath"), GOCACHE: join(root, "go-build-cache"),
      GOSUMDB: "off", GOPRIVATE: "", GONOPROXY: "", GONOSUMDB: "", GOVCS: "*:off",
      CARGO_HOME: join(root, "cargo-home"), CARGO_NET_GIT_FETCH_WITH_CLI: "false", CARGO_NET_OFFLINE: "true" };
  }
  private async cleanup(root: string): Promise<void> {
    const moduleCache = join(root, "native-cache", "modules");
    if (await lstat(moduleCache).catch(() => null)) {
      try { await runProgram(this.tool("go"), ["clean", "-modcache"], { cwd: root, env: { ...this.environment(root), GOMODCACHE: moduleCache }, signal: AbortSignal.timeout(10_000), label: "Owned Go cache cleanup" }); }
      catch { throw new MoguriError("cache_cleanup_partial", "The owned native cache could not be cleaned. It remains in private staging; no automatic execution or cleanup fallback was attempted.", 409); }
    }
    await rm(root, { recursive: true, force: true });
  }
  private async file(project: Project, path: string): Promise<{ path: string; text: string; digest: string }> {
    await safeManifestPath(project.path, path); return { ...await readProjectFile(project.path, path, 4 * 1024 * 1024), path };
  }
  private async optional(project: Project, path: string) {
    const stat = await lstat(join(project.path, path)).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return null; throw error; });
    return stat ? this.file(project, path) : null;
  }
  private async inputs(project: Project, manager: Manager, requested?: AbortSignal): Promise<Inputs> {
    requested?.throwIfAborted();
    const boundRoot = await dependencyRoot(project), root = await this.scratch(), signal = requested ? AbortSignal.any([requested, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000), environment = this.environment(root), sources = this.sources();
    let files: Inputs["files"] = [], packages: DependencyPackage[] = [], metadata: Record<string, unknown> | undefined;
    let ready = true, diagnostic = "", runtime = "";
    try {
      const versionArgs = manager === "python" ? ["-I", "-m", "pip", "--version"] : manager === "go" ? ["version"] : ["--version"];
      try { runtime = (await runProgram(this.tool(manager), versionArgs, { cwd: manager === "cargo" ? await this.cargoWorkingDirectory(root) : root, env: environment, signal, label: `Native ${manager} readiness`, timeoutMs: 5000, maxBytes: 8192 })).trim(); }
      catch (error) { signal.throwIfAborted(); ready = false; diagnostic = error instanceof MoguriError && error.code === "cache_runtime" ? error.message : `Install/configure the maintained native ${manager === "python" ? "Python 3.11+ / pip" : manager} tool explicitly. No format substitution, toolchain download or unchecked cache was used.`; }
      if (manager === "python") {
        const requirements = await this.optional(project, "requirements.lock") ?? await this.file(project, "requirements.txt");
        const manifest = requirements.path === "requirements.lock" ? await this.optional(project, "requirements.txt") : null;
        const pyproject = await this.optional(project, "pyproject.toml");
        files = [...(manifest ? [manifest] : []), ...(pyproject ? [pyproject] : []), requirements];
        const lines = requirements.text.replace(/\\\r?\n\s*/g, " ").split(/\r?\n/);
        const names = new Set<string>();
        for (const raw of lines) {
          const line = raw.replace(/\s+#.*$/, "").trim();
          if (!line || line.startsWith("#")) continue;
          const match = /^([A-Za-z0-9][A-Za-z0-9._-]*)==([0-9][A-Za-z0-9.!+_-]{0,199})((?:\s+--hash=sha256:[a-fA-F0-9]{64})+)$/.exec(line);
          if (!match) throw new MoguriError("cache_lock", "Python cache admission requires exact name==version requirements with explicit SHA-256 hashes. Recursive files, URLs, editable/source packages, markers and installer options are not read or executed.");
          const name = normalizedPython(match[1]!), version = match[2]!, hashes = [...match[3]!.matchAll(/sha256:([a-fA-F0-9]{64})/g)].map((item) => item[1]!.toLowerCase()).sort();
          if (names.has(name)) throw new MoguriError("cache_lock", "A Python requirement name is duplicated. Review one exact hash-pinned version.");
          names.add(name); packages.push({ name, version, integrity: `sha256:${hashes[0]}`, sourceIntegrity: JSON.stringify(hashes), url: `${sources.pypi}pypi/${name}/${encodeURIComponent(version)}/json`, hasInstallScript: false, ecosystem: "PyPI" });
        }
      } else if (manager === "cargo") {
        files = [await this.file(project, "Cargo.toml"), await this.file(project, "Cargo.lock")];
        for (const file of files) await writeFile(join(root, file.path), file.text, { mode: 0o600 });
        if (ready) {
          try { runtime += `; TOML Python ${(await runProgram(this.tool("python"), ["-I", "-c", "import sys,tomllib\nprint(sys.version.split()[0])"], { cwd: root, env: environment, signal, label: "Native Cargo TOML parser readiness", timeoutMs: 5000, maxBytes: 8192 })).trim()}`; }
          catch { signal.throwIfAborted(); ready = false; diagnostic = "Cargo cache inspection also needs Python 3.11+ tomllib for non-executable native TOML parsing. Install/configure it explicitly."; }
        }
        if (ready) {
          let decoded: unknown;
          try {
            decoded = json(await runProgram(this.tool("python"), ["-I", "-c", "import json,tomllib\nprint(json.dumps([tomllib.load(open(name,'rb')) for name in ['Cargo.toml','Cargo.lock']]))"], { cwd: root, env: environment, signal, label: "Native Cargo TOML parsing", maxBytes: 4 * 1024 * 1024 }));
          } catch (error) { if (error instanceof MoguriError && error.code === "program_unavailable") { ready = false; diagnostic = "Cargo cache inspection also needs Python 3.11+ tomllib for non-executable native TOML parsing. Install/configure it explicitly."; } else throw error; }
          if (ready) {
            if (!Array.isArray(decoded) || !isRecord(decoded[0]) || !isRecord(decoded[1])) throw new MoguriError("cache_lock", "Cargo manifest/lock parsing did not produce complete native metadata.");
            const manifest = decoded[0], lock = decoded[1];
            if (!isRecord(manifest.package) || manifest.workspace !== undefined || manifest.patch !== undefined || manifest.replace !== undefined || ![3, 4].includes(Number(lock.version)) || !Array.isArray(lock.package)) throw new MoguriError("cache_lock", "Cargo cache preparation currently admits a single package with Cargo.lock 3/4 and crates.io dependencies. Workspace, patch, replace and alternate registries are not silently substituted.");
            const inspectDependencies = (value: unknown) => {
              if (value === undefined) return;
              if (!isRecord(value)) throw new MoguriError("cache_resolution", "Invalid Cargo dependency table.");
              for (const dependency of Object.values(value)) if (typeof dependency !== "string" && (!isRecord(dependency) || dependency.path !== undefined || dependency.git !== undefined || dependency.registry !== undefined || dependency.workspace !== undefined || typeof dependency.version !== "string")) throw new MoguriError("cache_resolution", "Cargo dependencies must resolve only to locked public registry versions; path/Git/alternate registry/workspace overrides are blocked.");
            };
            for (const section of ["dependencies", "dev-dependencies", "build-dependencies"]) inspectDependencies(manifest[section]);
            if (manifest.target !== undefined) {
              if (!isRecord(manifest.target)) throw new MoguriError("cache_resolution", "Invalid Cargo target dependency tables.");
              for (const target of Object.values(manifest.target)) {
                if (!isRecord(target)) throw new MoguriError("cache_resolution", "Invalid Cargo target.");
                for (const section of ["dependencies", "dev-dependencies", "build-dependencies"]) inspectDependencies(target[section]);
              }
            }
            for (const item of lock.package) {
              if (!isRecord(item) || typeof item.name !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(item.name) || typeof item.version !== "string" || !/^[0-9][A-Za-z0-9.+-]{0,199}$/.test(item.version)) throw new MoguriError("cache_lock", "Every Cargo locked package needs an exact safe registry name/version.");
              if (item.source === undefined) {
                if (item.name !== manifest.package.name || item.version !== manifest.package.version) throw new MoguriError("cache_resolution", "An undeclared local/path package appears in Cargo.lock; it was not skipped.");
                continue;
              }
              if (item.source !== "registry+https://github.com/rust-lang/crates.io-index" || typeof item.checksum !== "string" || !hex.test(item.checksum)) throw new MoguriError("cache_lock", "Cargo registry archives require the original crates.io source and exact Cargo.lock SHA-256. Git and alternate sources are blocked.");
              packages.push({ name: item.name, version: item.version, integrity: `sha256:${item.checksum}`, sourceIntegrity: `sha256:${item.checksum}`, url: `${sources.cargoArchives}${item.name}/${item.name}-${item.version}.crate`, hasInstallScript: true, ecosystem: "crates.io", filename: `${item.name}-${item.version}.crate` });
            }
            metadata = { manifest };
          }
        }
      } else {
        files = [await this.file(project, "go.mod"), await this.file(project, "go.sum")];
        const sums = new Map<string, { name: string; version: string; module?: string; mod?: string }>();
        for (const line of files[1]!.text.split(/\r?\n/)) {
          if (!line.trim()) continue;
          const parts = line.trim().split(/\s+/);
          const [name, rawVersion, checksum] = parts;
          if (parts.length !== 3 || !name || !rawVersion || !checksum || !modulePath(name) || !H1.test(checksum)) throw new MoguriError("cache_lock", "go.sum must contain exact module/version h1 checksums. Arbitrary URLs or missing hashes are not admitted.");
          const mod = rawVersion.endsWith("/go.mod"), version = mod ? rawVersion.slice(0, -7) : rawVersion;
          if (!/^v[0-9][A-Za-z0-9.+-]{0,199}$/.test(version)) throw new MoguriError("cache_lock", "A Go module version is not exact.");
          const key = `${name}@${version}`, entry = sums.get(key) ?? { name, version };
          if (entry[mod ? "mod" : "module"] && entry[mod ? "mod" : "module"] !== checksum) throw new MoguriError("cache_lock", "One Go module/source/version has conflicting h1 values.");
          entry[mod ? "mod" : "module"] = checksum; sums.set(key, entry);
        }
        for (const item of sums.values()) {
          if (!item.mod) throw new MoguriError("cache_lock", "Every cached Go module also needs its original go.mod h1 pin. Generate and review a complete go.sum.");
          packages.push({ name: item.name, version: item.version, integrity: item.module ?? item.mod, sourceIntegrity: JSON.stringify(item), url: `${sources.goProxy}${moduleEscape(item.name)}/@v/${moduleEscape(item.version)}`, hasInstallScript: false, ecosystem: "Go", artifactKind: "module" });
        }
        if (ready) {
          await writeFile(join(root, "go.mod"), files[0]!.text, { mode: 0o600 });
          const result = json(await runProgram(this.tool("go"), ["mod", "edit", "-json"], { cwd: root, env: { ...environment, GOPROXY: "off" }, signal, label: "Native Go manifest parsing", maxBytes: 2 * 1024 * 1024 }));
          if (!isRecord(result) || Array.isArray(result.Replace) && result.Replace.length || Array.isArray(result.Exclude) && result.Exclude.length) throw new MoguriError("cache_resolution", "Go replace/exclude directives require a separately reviewed adapter. No workspace escape, VCS lookup or source substitution was used.");
          for (const requirement of Array.isArray(result.Require) ? result.Require : []) {
            if (!isRecord(requirement) || typeof requirement.Path !== "string" || typeof requirement.Version !== "string" || !sums.get(`${requirement.Path}@${requirement.Version}`)?.module) throw new MoguriError("cache_lock", "Every required Go module needs both module and go.mod h1 pins before preparation.");
          }
          metadata = { manifest: result };
        }
      }
      if (packages.length > 1000) throw new MoguriError("cache_limit", "A native cache plan is limited to 1,000 exact dependencies.");
      const identities = packages.map((entry) => [entry.name, entry.version, entry.url, entry.sourceIntegrity]);
      if (new Set(identities.map((identity) => JSON.stringify(identity.slice(0, 3)))).size !== identities.length) throw new MoguriError("cache_lock", "A native source/version appears more than once. Conflicting source bytes were not merged.");
      const lock = files.at(-1)!, manifestDigest = files.length === 1 ? lock.digest : digest(JSON.stringify(files.slice(0, -1).map(({ path, digest }) => [path, digest])));
      const planDigest = digest(JSON.stringify([project.id, boundRoot, manager, files.map(({ path, digest }) => [path, digest]), identities, sources, this.tool(manager), runtime, "native-locked-cache-v1"]));
      const cachePath = join(this.directory, manager, "plans", planDigest);
      let cachedPackages = 0;
      for (const entry of packages) if (await cacache.get.info(this.content, this.resolutionKey(entry))) cachedPackages++;
      const command = manager === "python" ? [this.tool("python"), "-I", "-m", "pip", "--isolated", "download", "--no-index", "--find-links", join(cachePath, "wheels"), "--only-binary=:all:", "--require-hashes", "-r", lock.path]
        : manager === "cargo" ? ["CARGO_HOME=" + join(cachePath, "cargo-home"), this.tool("cargo"), "fetch", "--offline", "--locked"]
          : ["GOTOOLCHAIN=local", "GOSUMDB=off", "GOWORK=off", "GOENV=off", "GOPROXY=off", "GOMODCACHE=" + join(cachePath, "modules"), this.tool("go"), "mod", "download", "-json", "all"];
      return { files, metadata, plan: { projectId: project.id, root: boundRoot, manager, manifestDigest, lockDigest: lock.digest, digest: planDigest, packages, cachedPackages,
        npmCache: "", pnpmStore: "", scripts: "blocked", manifests: files.map(({ path, digest }) => ({ path, digest, name: null })), registryScopes: [],
        cachePath, mode: "cache-only", readiness: { ready, diagnostic: diagnostic || "The native manager is present. Preparation must still pass fresh advisories, primary lock verification and SHA-512 CAS reads; this is cache readiness, not build containment.", command },
        diagnostic: manager === "python" ? "Exact hash-pinned requirements; host-compatible binary wheels only. No source distribution, build backend, environment install or dependency import is executed."
          : manager === "cargo" ? "Cargo.lock SHA-256 and native locked/offline crate fetch. Cargo build.rs, proc macros and project hooks never execute; no target directory is shared."
            : "go.mod/go.sum with native h1 verification; GOTOOLCHAIN=local, GOWORK=off and VCS/toolchain fallback disabled. No Go build or shared build cache." } };
    } finally { await this.cleanup(root); }
  }
  async inspect(project: Project, manager: Manager): Promise<DependencyPlan> { return (await this.inputs(project, manager)).plan; }
  private resolutionKey(entry: DependencyPackage): string { return `native-resolution:${entry.ecosystem}:${digest(JSON.stringify([entry.url, entry.sourceIntegrity]))}`; }
  private artifactKey(artifact: Artifact): string { return `native-artifact:${digest(JSON.stringify([artifact.url, artifact.pin]))}`; }
  private async readArtifact(artifact: Artifact): Promise<Buffer | null> {
    try {
      const info = await cacache.get.info(this.content, this.artifactKey(artifact));
      if (!info) return null;
      if (typeof info.size !== "number" || info.size > 64 * 1024 * 1024 || !integritySha512(String(info.integrity))) throw new MoguriError("cache_integrity", "A native cached artifact has invalid SHA-512 metadata.");
      const result = await cacache.get(this.content, this.artifactKey(artifact), { integrity: String(info.integrity), memoize: false });
      this.primary(artifact, result.data); return result.data;
    } catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") return null; throw new MoguriError("cache_integrity", "A native artifact failed SHA-512 or original lock-integrity verification. It was not reused or silently redownloaded.", 409); }
  }
  private primary(artifact: Artifact, bytes: Buffer) {
    if (artifact.pin.startsWith("sha256:") && createHash("sha256").update(bytes).digest("hex") !== artifact.pin.slice(7)) throw new MoguriError("cache_integrity", "Native archive bytes differ from the original lock's SHA-256.", 409);
  }
  private async fetchBytes(url: string, signal: AbortSignal, limit = 64 * 1024 * 1024): Promise<Buffer> {
    let response: Response;
    try { response = await this.host.fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]), redirect: "error" }); }
    catch { signal.throwIfAborted(); throw new MoguriError("cache_download", "The pinned public registry request failed; no redirect, VCS, alternate source or ambient credential fallback was used.", 409); }
    if (!response.ok) { await response.body?.cancel(); throw new MoguriError("cache_download", `The pinned public registry returned HTTP ${response.status}. No source fallback was used.`, 409); }
    return boundedBody(response, limit, signal);
  }
  private async resolve(entry: DependencyPackage, signal: AbortSignal): Promise<Artifact[]> {
    if (entry.ecosystem === "crates.io") return [{ name: entry.name, version: entry.version, url: entry.url, filename: entry.filename!, pin: entry.integrity, kind: "archive", route: `/crates/${entry.name}/${entry.version}/download` }];
    if (entry.ecosystem === "Go") {
      const pins = json(entry.sourceIntegrity!);
      if (!isRecord(pins) || typeof pins.mod !== "string") throw new MoguriError("cache_lock", "The exact Go source hashes are incomplete.");
      const base = `/go/${moduleEscape(entry.name)}/@v/${moduleEscape(entry.version)}`;
      return [{ name: entry.name, version: entry.version, url: `${entry.url}.mod`, filename: `${moduleEscape(entry.version)}.mod`, pin: pins.mod, kind: "archive", route: `${base}.mod` },
        { name: entry.name, version: entry.version, url: `${entry.url}.info`, filename: `${moduleEscape(entry.version)}.info`, pin: `version:${entry.version}`, kind: "metadata", route: `${base}.info` },
        ...(typeof pins.module === "string" ? [{ name: entry.name, version: entry.version, url: `${entry.url}.zip`, filename: `${moduleEscape(entry.version)}.zip`, pin: pins.module, kind: "archive" as const, route: `${base}.zip` }] : [])];
    }
    const hashes = json(entry.sourceIntegrity!);
    if (!Array.isArray(hashes) || hashes.some((hash) => typeof hash !== "string" || !hex.test(hash))) throw new MoguriError("cache_lock", "Python requirement hashes are invalid.");
    const key = this.resolutionKey(entry);
    const cached = await cacache.get.info(this.content, key);
    if (cached) {
      try {
        if (typeof cached.size !== "number" || cached.size > 2 * 1024 * 1024 || !integritySha512(String(cached.integrity))) throw new Error("Invalid resolution metadata");
        const value = json((await cacache.get(this.content, key, { integrity: String(cached.integrity), memoize: false })).data.toString("utf8"));
        if (!Array.isArray(value) || !value.length || value.length > 100 || value.some((item) => !this.pythonArtifact(item, entry, hashes))) throw new Error("Invalid cached wheel resolution");
        return value as unknown as Artifact[];
      } catch { throw new MoguriError("cache_integrity", "Cached wheel resolution failed its exact source/hash verification; it was not reused.", 409); }
    }
    const response = await fetchJson(this.host.fetch, entry.url, {}, AbortSignal.any([signal, AbortSignal.timeout(20_000)]));
    if (!isRecord(response) || !isRecord(response.info) || normalizedPython(String(response.info.name)) !== entry.name || response.info.version !== entry.version || !Array.isArray(response.urls)) throw new MoguriError("cache_metadata", "PyPI metadata did not match the exact reviewed requirement.");
    const artifacts: Artifact[] = [];
    for (const file of response.urls) {
      if (!isRecord(file) || typeof file.filename !== "string" || typeof file.url !== "string" || !isRecord(file.digests) || typeof file.digests.sha256 !== "string" || !hashes.includes(file.digests.sha256) || file.packagetype !== "bdist_wheel" || file.yanked === true) continue;
      const artifact: Artifact = { name: entry.name, version: entry.version, url: file.url, filename: file.filename, pin: `sha256:${file.digests.sha256}`, kind: "archive", route: `/wheels/${file.filename}` };
      if (!this.pythonArtifact(artifact, entry, hashes)) throw new MoguriError("cache_registry", "A wheel URL is outside the fixed public artifact registry or its exact reviewed resource.");
      artifacts.push(artifact);
    }
    if (!artifacts.length || artifacts.length > 100) throw new MoguriError("cache_binary_only", "No bounded binary-wheel set matches this exact hashed requirement. Source distributions/build backends require a qualified Sandbox; no host build or unchecked substitute was attempted.", 409);
    if (new Set(artifacts.map((artifact) => artifact.filename)).size !== artifacts.length) throw new MoguriError("cache_metadata", "The public registry returned conflicting wheel resources under one filename. Distinct source bytes were not conflated.");
    return artifacts;
  }
  private pythonArtifact(value: unknown, entry: DependencyPackage, hashes: unknown[]): boolean {
    if (!isRecord(value) || value.name !== entry.name || value.version !== entry.version || typeof value.url !== "string" || typeof value.filename !== "string" || !/^[A-Za-z0-9_.+-]+\.whl$/.test(value.filename) || typeof value.pin !== "string" || !hashes.includes(value.pin.slice(7)) || value.pin !== `sha256:${value.pin.slice(7)}` || value.kind !== "archive" || value.route !== `/wheels/${value.filename}`) return false;
    const url = new URL(cacheUrl(value.url, this.options.allowLoopback)), base = new URL(this.sources().pythonFiles);
    return url.origin === base.origin && url.pathname.startsWith(base.pathname);
  }
  async prepare(project: Project, manager: Manager, expected: string, signal: AbortSignal, progress: (message: string) => void, guard?: () => Promise<void>): Promise<CacheReceipt> {
    signal = AbortSignal.any([signal, AbortSignal.timeout(10 * 60_000)]);
    const input = await this.inputs(project, manager, signal), plan = input.plan;
    if (plan.digest !== expected) throw new MoguriError("cache_stale", "The exact native manifest, lock or source policy changed. Inspect a new plan.", 409);
    if (!plan.readiness?.ready) throw new MoguriError("cache_runtime", plan.readiness?.diagnostic ?? "Configure the native manager explicitly before preparing this cache.", 409);
    await guard?.(); signal.throwIfAborted();
    progress("Checking every exact native dependency with fresh advisories before downloads or reuse.");
    await this.host.audit(plan.packages, signal);
    const root = await this.scratch(), environment = this.environment(root), nativeCache = join(root, "native-cache");
    let reused = 0, downloadedBytes = 0;
    const artifacts = new Map<string, Artifact>(), resolutions = new Map<string, Artifact[]>();
    try {
      for (const entry of plan.packages) {
        const resolved = await this.resolve(entry, signal); resolutions.set(this.resolutionKey(entry), resolved);
        let reusedEntry = true;
        for (const artifact of resolved) {
          const key = this.artifactKey(artifact);
          if (artifacts.has(key)) continue;
          let bytes = await this.readArtifact(artifact);
          if (!bytes) { bytes = await this.fetchBytes(artifact.url, signal); downloadedBytes += bytes.length; reusedEntry = false; }
          if (downloadedBytes > 512 * 1024 * 1024) throw new MoguriError("cache_limit", "Native preparation exceeded its 512 MiB download bound.");
          this.primary(artifact, bytes);
          if (artifact.kind === "metadata" && artifact.pin.startsWith("version:")) {
            const info = json(bytes.toString("utf8"));
            if (!isRecord(info) || info.Version !== entry.version || info.Origin !== undefined && !isRecord(info.Origin)) throw new MoguriError("cache_metadata", "The Go proxy returned different module-version metadata.");
          }
          artifact.bytes = bytes; artifacts.set(key, artifact);
        }
        if (reusedEntry) reused++;
        progress(`Prepared ${resolutions.size}/${plan.packages.length} exact ${manager} dependency sources; executable builds remain blocked.`);
      }
      for (const file of input.files) if (manager !== "python" || file === input.files.at(-1)) await writeFile(join(root, file.path), file.text, { mode: 0o600 });
      await mkdir(nativeCache, { mode: 0o700 });
      if (manager === "python") {
        const wheels = join(root, "verified-wheels"); await mkdir(wheels);
        await mkdir(join(nativeCache, "wheels"));
        for (const artifact of artifacts.values()) await writeFile(join(wheels, artifact.filename), artifact.bytes!, { mode: 0o600 });
        await runProgram(this.tool("python"), ["-I", "-m", "pip", "--isolated", "--disable-pip-version-check", "download", "--no-index", "--find-links", wheels, "--require-hashes", "--only-binary=:all:", "--no-input", "--no-cache-dir", "--dest", join(nativeCache, "wheels"), "-r", input.files.at(-1)!.path], { cwd: root, env: environment, signal, label: "Hash-locked binary-wheel cache preparation", timeoutMs: 300_000 });
        const written = await readdir(join(nativeCache, "wheels"));
        if (written.some((name) => ![...artifacts.values()].some((artifact) => artifact.filename === name))) throw new MoguriError("cache_integrity", "pip produced an artifact outside the exact verified wheel set.");
      } else {
        const routes = new Map([...artifacts.values()].map((artifact) => [artifact.route, artifact.bytes!]));
        if (manager === "cargo") {
          await mkdir(join(root, "src")); await writeFile(join(root, "src/lib.rs"), "");
          const original = input.metadata?.manifest;
          if (!isRecord(original) || !isRecord(original.package)) throw new MoguriError("cache_manifest", "The native Cargo manifest is missing.");
          const safe = { ...original, package: { ...original.package, build: false, autobins: false, autoexamples: false, autotests: false, autobenches: false }, lib: { path: "src/lib.rs" } };
          for (const key of ["bin", "example", "test", "bench"]) delete (safe as Record<string, unknown>)[key];
          await writeFile(join(root, "Cargo.toml"), cargoManifest(safe));
          const sources = this.sources();
          const fetchedIndex = new Map<string, Buffer>(); let metadataBytes = 0;
          for (const entry of plan.packages) {
            let response = fetchedIndex.get(entry.name);
            if (!response) {
              response = await this.fetchBytes(`${sources.cargoIndex}${crateIndex(entry.name)}`, signal, 4 * 1024 * 1024);
              metadataBytes += response.length;
              if (metadataBytes > 32 * 1024 * 1024) throw new MoguriError("cache_limit", "The bounded Cargo metadata set exceeded 32 MiB. No artifact/source fallback was used.");
              fetchedIndex.set(entry.name, response);
            }
            let index: Record<string, unknown> | undefined;
            for (const line of response.toString("utf8").split("\n")) {
              if (!line.trim()) continue;
              const item = json(line);
              if (isRecord(item) && item.name === entry.name && item.vers === entry.version) { if (index) throw new MoguriError("cache_metadata", "The registry supplied conflicting exact crate records."); index = item; }
            }
            if (!index || index.cksum !== entry.integrity.slice(7) || index.yanked === true || !Array.isArray(index.deps) || index.deps.some((dependency) => !isRecord(dependency) || dependency.registry !== undefined && dependency.registry !== null && dependency.registry !== "https://github.com/rust-lang/crates.io-index")) throw new MoguriError("cache_metadata", "The crates.io index does not match the exact Cargo.lock checksum/source, or requests an unreviewed registry.");
            const path = `/cargo/${crateIndex(entry.name)}`;
            const prior = routes.get(path);
            routes.set(path, Buffer.concat([...(prior ? [prior] : []), Buffer.from(JSON.stringify(index) + "\n")]));
          }
        }
        const mirror = createServer((request, response) => {
          if (request.method !== "GET") { response.writeHead(403).end(); return; }
          if (manager === "cargo" && request.url === "/cargo/config.json") { response.end(JSON.stringify({ dl: `${url}/crates/{crate}/{version}/download` })); return; }
          const bytes = routes.get(request.url ?? "");
          if (!bytes) { response.writeHead(403).end("Outside the exact verified native cache plan."); return; }
          response.end(bytes);
        });
        await new Promise<void>((resolve, reject) => { mirror.once("error", reject); mirror.listen(0, "127.0.0.1", resolve); });
        const address = mirror.address();
        if (!address || typeof address === "string") throw new MoguriError("cache_mirror", "The verified native mirror could not bind.");
        const url = `http://127.0.0.1:${address.port}`;
        try {
          if (manager === "cargo") {
            const home = join(nativeCache, "cargo-home"); await mkdir(home);
            await writeFile(join(home, "config.toml"), `[source.crates-io]\nreplace-with="moguri-verified"\n[source.moguri-verified]\nregistry="sparse+${url}/cargo/"\n[net]\noffline=true\n`, { mode: 0o600 });
            const cwd = await this.cargoWorkingDirectory(root);
            await runProgram(this.tool("cargo"), ["fetch", "--locked", "--manifest-path", join(root, "Cargo.toml")], { cwd, env: { ...environment, CARGO_HOME: home, CARGO_NET_OFFLINE: "false", CARGO_HTTP_PROXY: "" }, signal, label: "Native Cargo locked cache verification", timeoutMs: 300_000 });
            await runProgram(this.tool("cargo"), ["fetch", "--offline", "--locked", "--manifest-path", join(root, "Cargo.toml")], { cwd, env: { ...environment, CARGO_HOME: home }, signal, label: "Native Cargo offline cache reuse", timeoutMs: 300_000 });
          } else {
            const nativeEnv = { ...environment, GOMODCACHE: join(nativeCache, "modules"), GOPROXY: `${url}/go`, GOFLAGS: "-modcacherw", GOPATH: join(root, "gopath") };
            await mkdir(nativeEnv.GOMODCACHE);
            for (let offset = 0; offset < plan.packages.length; offset += 100) {
              const batch = plan.packages.slice(offset, offset + 100);
              const checked = await runProgram(this.tool("go"), ["list", "-m", "-f", "{{.Path}} {{.Version}} {{.GoModSum}}", ...batch.map((entry) => `${entry.name}@${entry.version}`)], { cwd: root, env: nativeEnv, signal, label: "Native Go go.mod h1 verification", timeoutMs: 300_000, maxBytes: 256 * 1024 });
              const values = checked.trim() ? checked.trim().split(/\r?\n/).map((line) => line.trim().split(/\s+/)) : [];
              const expected = new Map(batch.map((entry) => { const pins = json(entry.sourceIntegrity!); return [`${entry.name}@${entry.version}`, isRecord(pins) ? pins.mod : undefined]; }));
              if (values.length !== expected.size || new Set(values.map(([name, version]) => `${name}@${version}`)).size !== expected.size ||
                values.some(([name, version, sum, extra]) => extra !== undefined || !sum || expected.get(`${name}@${version}`) !== sum)) throw new MoguriError("cache_integrity", "Native Go did not verify every exact original go.mod h1, including pinned non-selected metadata. No native cache was published.", 409);
              const archives = batch.filter((entry) => { const pins = json(entry.sourceIntegrity!); return isRecord(pins) && typeof pins.module === "string"; });
              if (archives.length) await runProgram(this.tool("go"), ["mod", "download", "-json", ...archives.map((entry) => `${entry.name}@${entry.version}`)], { cwd: root, env: nativeEnv, signal, label: "Native Go exact module h1 verification", timeoutMs: 300_000, maxBytes: 4 * 1024 * 1024 });
            }
            await runProgram(this.tool("go"), ["mod", "download", "-json", "all"], { cwd: root, env: nativeEnv, signal, label: "Native Go locked h1 cache verification", timeoutMs: 300_000, maxBytes: 4 * 1024 * 1024 });
            if (await readFile(join(root, "go.sum"), "utf8") !== input.files.at(-1)!.text || await readFile(join(root, "go.mod"), "utf8") !== input.files[0]!.text) throw new MoguriError("cache_lock", "Go attempted to extend or rewrite the approved go.mod/go.sum. Review complete lock bytes before preparing a cache.", 409);
            await runProgram(this.tool("go"), ["mod", "download", "-json", "all"], { cwd: root, env: { ...nativeEnv, GOPROXY: "off" }, signal, label: "Native Go offline cache reuse", timeoutMs: 300_000, maxBytes: 4 * 1024 * 1024 });
          }
        } finally { mirror.closeAllConnections(); await new Promise<void>((resolve) => mirror.close(() => resolve())); }
      }
      signal.throwIfAborted();
      if ((await this.inputs(project, manager, signal)).plan.digest !== expected) throw new MoguriError("cache_stale", "Native root/lock inputs changed before cache publication. No cache success was recorded.", 409);
      await guard?.(); signal.throwIfAborted();
      for (const artifact of artifacts.values()) { signal.throwIfAborted(); await cacache.put(this.content, this.artifactKey(artifact), artifact.bytes!, { integrity: `sha512-${createHash("sha512").update(artifact.bytes!).digest("base64")}`, metadata: { source: artifact.url, originalIntegrity: artifact.pin } }); }
      for (const [key, resolution] of resolutions) { signal.throwIfAborted(); await cacache.put(this.content, key, JSON.stringify(resolution.map(({ bytes: _bytes, ...artifact }) => artifact)), { algorithms: ["sha512"] }); }
      const destination = plan.cachePath!, parent = dirname(destination); await mkdir(parent, { recursive: true, mode: 0o700 });
      await writeFile(join(nativeCache, "reviewed-plan.json"), JSON.stringify({ digest: expected, manager, lockDigest: plan.lockDigest, scripts: "blocked" }), { mode: 0o600 });
      await publishNativeCache(destination, signal, async () => {
        const existing = await lstat(destination).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return null; throw error; });
        if (existing && (!existing.isDirectory() || existing.isSymbolicLink())) throw new MoguriError("cache_target", "The native cache publication target is not a regular owned directory.");
        const backup = `${destination}.previous-${digest(root).slice(0, 12)}`;
        signal.throwIfAborted(); await guard?.();
        if (existing) await rename(destination, backup);
        try { await rename(nativeCache, destination); }
        catch (error) { if (existing) await rename(backup, destination).catch(() => { throw new MoguriError("cache_partial", "The previous native cache remains protected at its .previous path; restoration is unconfirmed.", 409); }); throw error; }
        if (existing) await rm(backup, { recursive: true, force: true });
      });
      return { projectId: project.id, manager, digest: expected, lockDigest: plan.lockDigest, checkedAt: new Date().toISOString(), packages: plan.packages.length, reused, downloadedBytes, scripts: "blocked" };
    } finally { await this.cleanup(root); }
  }
}
function integritySha512(value: string): boolean { return /^sha512-[A-Za-z0-9+/]{86}==$/.test(value); }
function cargoManifest(value: Record<string, unknown>): string {
  const quoted = (key: string) => JSON.stringify(key);
  const scalar = (item: unknown): string => {
    if (typeof item === "string" || typeof item === "boolean" || typeof item === "number") return JSON.stringify(item);
    if (Array.isArray(item)) return `[${item.map(scalar).join(",")}]`;
    if (isRecord(item)) return `{${Object.entries(item).map(([key, value]) => `${quoted(key)}=${scalar(value)}`).join(",")}}`;
    throw new MoguriError("cache_manifest", "An unsupported Cargo manifest value cannot be copied into safe native staging.");
  };
  return Object.entries(value).filter(([key]) => !["workspace", "patch", "replace"].includes(key)).map(([key, item]) => `${quoted(key)}=${scalar(item)}`).join("\n") + "\n";
}
