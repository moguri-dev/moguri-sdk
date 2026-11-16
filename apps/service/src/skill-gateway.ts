import { isUtf8 } from "node:buffer";
import { realpath } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";
import { createHash } from "node:crypto";
import { crc32 } from "node:zlib";
import { fromBufferPromise } from "yauzl";
import { MoguriError, parse, SkillGatewayQuerySchema, skillArchiveUrl, type CapabilityEntry, type GatewaySkill, type SkillGatewayQuery, type SkillGatewayResponse, type SkillSource, type Snapshot } from "../../../packages/protocol/src/index.ts";
import { digest, type EventStore } from "./store.ts";
import { isPrivateContextPath, isProtectedProjectPath } from "./files.ts";
import { readSkillText, skillTreeProblem, walkSkillTree } from "./skill-tree.ts";
import { sourceRootSync } from "./repository-source.ts";
import { SKILL_INSPECTION_BYTES, type SkillOrigin } from "../../../packages/protocol/src/skill-admission.ts";

const SKIPPABLE_SKILL_ERRORS = new Set(["skill_limit", "skill_format", "skill_metadata", "skill_compatibility", "skill_dependencies", "file_limit"]);
const FILE_BYTES = 64 * 1024, DOWNLOAD_BYTES = 8 * 1024 * 1024, EXPANDED_BYTES = 32 * 1024 * 1024;
interface InspectionFile { path: string; digest: string; bytes: number; text: string }
interface Loaded { skill: GatewaySkill; body: string; files?: InspectionFile[]; archiveDigest?: string }
export interface SkillGatewayOptions { fetch?: typeof fetch }
const SNAPSHOT_MS = 5 * 60_000, SNAPSHOTS = 8;
export class SkillGateway {
  private readonly abort = new AbortController();
  /** Metadata-only catalogs that continuation pages are served from, so paging is consistent and needn't re-read every source. */
  private readonly snapshots = new Map<string, { skills: GatewaySkill[]; catalogDigest: string; expires: number }>();
  constructor(private readonly store: EventStore, private readonly host: {
    snapshot(): Snapshot; skill(content: string): { name: string; description: string }; compatible(entry: CapabilityEntry): void;
  }, private readonly options: SkillGatewayOptions = {}) {}
  close() { this.abort.abort(new MoguriError("skill_gateway_closing", "Skill gateway is closing. No result was published.", 409)); }
  private scope(sessionId?: string): string {
    const snapshot = this.host.snapshot(), session = sessionId === undefined ? undefined : snapshot.sessions.find((value) => value.id === sessionId);
    if (sessionId !== undefined && !session) throw new MoguriError("skill_scope", "The bound skill session is outside this profile.", 404);
    if (session && (session.controls.env !== "Local" || !snapshot.policy.allowedEnvs.includes("Local"))) {
      throw new MoguriError("skill_transport", "Configured skill folders and archives are control-plane Local sources. Remote/Sandbox skill-source transport is not qualified; no Local fallback was used.", 409);
    }
    return digest(JSON.stringify([snapshot.profileId, snapshot.settings.values.skillSources ?? [], snapshot.policy,
      session ? [session.id, session.projectId, session.workspaceId, session.controls.env] : null,
      snapshot.registry.map((entry) => [entry.id, entry.revision, entry.enabled, entry.retired])]));
  }
  private loaded(source: SkillSource, path: string, body: string): Loaded {
    if (body.includes("\0") || !body.isWellFormed() || Buffer.byteLength(body) > FILE_BYTES) throw new MoguriError("skill_limit", "A skill must be lossless UTF-8 text up to 64 KiB. Nothing was truncated.");
    let metadata: { name: string; description: string };
    try { metadata = this.host.skill(body); }
    catch (error) { throw new MoguriError("skill_format", `${source.name} / ${path}: ${error instanceof Error ? error.message : "Invalid SKILL.md."}`); }
    return { skill: { id: digest(JSON.stringify([source, path])), ...metadata, digest: digest(body), bytes: Buffer.byteLength(body),
      sourceId: source.id, sourceName: source.name, path }, body };
  }
  private async local(source: Extract<SkillSource, { kind: "local" }>, signal: AbortSignal): Promise<Loaded[]> {
    if (!isAbsolute(source.path)) throw new MoguriError("skill_source_path", "Choose an absolute skill folder. No previous project or state root was inherited.");
    const binding = sourceRootSync(await realpath(source.path)), result: Loaded[] = [];
    walkSkillTree(binding.root, "", (entry) => {
      if (isProtectedProjectPath(entry.path)) return false;
      if (entry.kind === "broken" || entry.kind === "cycle" || entry.kind === "protected") {
        console.warn(`Skill source ${source.name}: skipped ${skillTreeProblem(entry)}.`);
        return false;
      }
      if (entry.kind === "directory") return true;
      if (entry.kind === "file" && entry.path.split(/[\\/]/).at(-1) === "SKILL.md") {
        try { result.push(this.loaded(source, entry.path, readSkillText(entry.real, FILE_BYTES).text)); }
        catch (error) {
          // One unreadable or invalid skill must not hide the rest of a shared folder; it simply isn't offered.
          if (!(error instanceof MoguriError && SKIPPABLE_SKILL_ERRORS.has(error.code))) throw error;
          console.warn(`Skill source ${source.name}: skipped ${entry.path}: ${error.message}`);
          return;
        }
        if (result.length > 512) throw new MoguriError("skill_limit", "The source exceeds 512 skills. Select a narrower folder.");
      }
    }, { signal, limit: (reason) => new MoguriError("skill_limit", reason === "depth" ? "The skill folder exceeds 16 nested levels. Select a narrower source." : "The skill folder exceeds 10,000 entries. Select a narrower source.") });
    if (JSON.stringify(sourceRootSync(await realpath(source.path))) !== JSON.stringify(binding)) throw new MoguriError("skill_source_changed", "The skill folder identity changed while reading. Refresh before loading.", 409);
    return result;
  }
  private async remote(source: Extract<SkillSource, { kind: "remote" }>, signal: AbortSignal): Promise<Loaded[]> {
    const response = await (this.options.fetch ?? fetch)(skillArchiveUrl(source.url), { signal, redirect: "error", cache: "no-store" });
    if (!response.ok || response.redirected || !response.body) {
      await response.body?.cancel();
      throw new MoguriError("skill_download", `Skill archive download failed (${response.status}). No cached skills were substituted.`);
    }
    if (Number(response.headers.get("content-length")) > DOWNLOAD_BYTES) {
      await response.body.cancel();
      throw new MoguriError("skill_limit", "The skill archive exceeds 8 MiB compressed.");
    }
    const reader = response.body.getReader(), chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      while (true) {
        signal.throwIfAborted();
        const value = await reader.read();
        if (value.done) break;
        bytes += value.value.byteLength;
        if (bytes > DOWNLOAD_BYTES) throw new MoguriError("skill_limit", "The skill archive exceeded its 8 MiB download bound.");
        chunks.push(value.value);
      }
    } finally { await reader.cancel(); reader.releaseLock(); }
    signal.throwIfAborted();
    const archive = Buffer.concat(chunks), archiveDigest = createHash("sha256").update(archive).digest("hex");
    const zip = await fromBufferPromise(archive, { lazyEntries: true, strictFileNames: true, validateEntrySizes: true });
    const result: Loaded[] = [], names = new Set<string>(), files: InspectionFile[] = [];
    let expanded = 0;
    try {
      if (zip.entryCount > 10000) throw new MoguriError("skill_limit", "The archive exceeds 10,000 entries.");
      for await (const entry of zip.eachEntry()) {
        signal.throwIfAborted();
        const path = entry.fileName, mode = entry.externalFileAttributes >>> 16 & 0o170000;
        if (path.length > 4096 || /[\\\u0000-\u001f]/.test(path) || path.startsWith("/") || path.split("/").some((part) => part === ".." || part === ".") ||
          names.has(path.toLowerCase()) || mode !== 0 && mode !== 0o100000 && mode !== 0o040000) {
          throw new MoguriError("skill_archive", "Skill archives need unique regular paths, never links, devices or traversal entries.");
        }
        names.add(path.toLowerCase());
        if (entry.isEncrypted() || !entry.canDecodeFileData() || ![0, 8].includes(entry.compressionMethod)) throw new MoguriError("skill_archive", "Encrypted or unsupported skill archive entries are not accepted.");
        if (entry.uncompressedSize > DOWNLOAD_BYTES || (expanded += entry.uncompressedSize) > EXPANDED_BYTES ||
          entry.uncompressedSize > 65536 && entry.uncompressedSize > Math.max(1, entry.compressedSize) * 200) throw new MoguriError("skill_limit", "Skill archive expansion exceeds the 32 MiB or 200:1 bound.");
        const selected = /(?:^|\/)SKILL\.md$/.test(path) && !isProtectedProjectPath(path);
        if (selected && entry.uncompressedSize > FILE_BYTES) throw new MoguriError("skill_limit", "An archived SKILL.md exceeds 64 KiB.");
        const keep = !path.endsWith("/") && !isProtectedProjectPath(path) && entry.uncompressedSize <= SKILL_INSPECTION_BYTES;
        const stream = await zip.openReadStreamPromise(entry), buffers: Buffer[] = [];
        const aborted = () => stream.destroy(new Error("Skill archive reading was cancelled."));
        signal.addEventListener("abort", aborted, { once: true });
        let size = 0, checksum = 0;
        try {
          for await (const chunk of stream) {
            signal.throwIfAborted();
            const buffer = Buffer.from(chunk); size += buffer.length;
            if (size > entry.uncompressedSize) throw new MoguriError("skill_archive", "An archive entry exceeded its declared size.");
            checksum = crc32(buffer, checksum);
            if (selected || keep) buffers.push(buffer);
          }
        } finally { signal.removeEventListener("abort", aborted); stream.destroy(); }
        if (size !== entry.uncompressedSize || checksum !== entry.crc32) throw new MoguriError("skill_archive", "A skill archive entry failed its exact size/CRC check.");
        if (keep) {
          const bytes = Buffer.concat(buffers);
          if (isUtf8(bytes) && !bytes.includes(0)) files.push({ path, digest: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length, text: bytes.toString("utf8") });
          else files.push({ path, digest: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length, text: "" });
        } else if (!path.endsWith("/") && !isProtectedProjectPath(path)) files.push({ path, digest: "0".repeat(64), bytes: entry.uncompressedSize, text: "" });
        if (selected) {
          const body = Buffer.concat(buffers);
          if (!isUtf8(body)) throw new MoguriError("skill_encoding", "Archived skill text is not valid UTF-8.");
          result.push(this.loaded(source, path, body.toString("utf8")));
          if (result.length > 512) throw new MoguriError("skill_limit", "The archive exceeds 512 skills. Select a narrower source.");
        }
      }
    } finally { zip.close(); }
    for (const value of result) { value.files = files; value.archiveDigest = archiveDigest; }
    return result;
  }
  async inspect(sessionId: string, skillId: string, expectedDigest: string, requested?: AbortSignal) {
    const signal = AbortSignal.any([this.abort.signal, AbortSignal.timeout(15000), ...(requested ? [requested] : [])]);
    const scope = this.scope(sessionId), response = await this.query({ type: "skills.read", sessionId, skillId, expectedDigest }, signal);
    if (response.type !== "skills.read") throw new MoguriError("skill_response", "The exact inspected skill changed response type.", 409);
    const { skill, body } = response, files: InspectionFile[] = [], excluded: string[] = [];
    let origin: SkillOrigin;
    if (skill.sourceId === null) {
      const entry = this.host.snapshot().registry.find((entry) => entry.id === skill.id);
      if (!entry) throw new MoguriError("skill_source_changed", "The exact registry source is no longer retained.", 409);
      const plugin = entry.ownerPluginId ? this.host.snapshot().registry.find((plugin) => plugin.id === entry.ownerPluginId) : null;
      files.push({ path: "SKILL.md", digest: skill.digest, bytes: skill.bytes, text: body });
      origin = { kind: "registry", sourceId: null, identityDigest: digest(JSON.stringify([entry, plugin])), artifactDigest: "", entryPath: "SKILL.md", version: "", root: null, files: [] };
    } else {
      const source = this.host.snapshot().settings.values.skillSources?.find((source) => source.id === skill.sourceId && source.enabled);
      if (!source || !skill.path) throw new MoguriError("skill_source_changed", "The exact enabled source was removed during inspection.", 409);
      if (source.kind === "local") {
        const binding = sourceRootSync(await realpath(source.path)), links: [string, string][] = [];
        let bytes = 0;
        walkSkillTree(binding.root, dirname(skill.path), (entry) => {
          if (isPrivateContextPath(entry.path)) { excluded.push(entry.path); return false; }
          if (entry.real === null) throw new MoguriError("skill_inspection_incomplete", `Unsupported dependency: ${skillTreeProblem(entry)}. Complete inspection is unavailable.`, 409);
          if (entry.kind === "directory") return true;
          const file = readSkillText(entry.real, SKILL_INSPECTION_BYTES);
          bytes += file.bytes;
          if (files.length >= 128 || bytes > SKILL_INSPECTION_BYTES) throw new MoguriError("skill_inspection_limit", "Complete skill sources exceed 128 files or 512 KiB. No dependency or source prefix was omitted.", 413);
          files.push({ path: entry.path, ...file });
        }, { signal, links, limit: (reason) => new MoguriError("skill_inspection_limit", reason === "depth" ? "Complete inspection exceeded 16 directory levels. No prefix was admitted." : "Complete inspection exceeded 10,000 entries. No partial source was admitted.", 413) });
        if (JSON.stringify(binding) !== JSON.stringify(sourceRootSync(await realpath(source.path)))) throw new MoguriError("skill_source_changed", "The source directory identity changed during inspection.", 409);
        origin = { kind: "local", sourceId: source.id, configurationDigest: digest(JSON.stringify(source)), identityDigest: digest(JSON.stringify(links.length ? [source, binding, skill.path, links] : [source, binding, skill.path])), artifactDigest: "", entryPath: skill.path, version: "", root: binding, files: [] };
      } else {
        const refreshed = (await this.remote(source, signal)).find((value) => value.skill.id === skill.id && value.skill.digest === expectedDigest);
        if (!refreshed?.files || !refreshed.archiveDigest) throw new MoguriError("skill_source_changed", "The archive changed during complete-source inspection.", 409);
        const prefix = dirname(skill.path) === "." ? "" : `${dirname(skill.path)}/`;
        files.push(...refreshed.files.filter((file) => file.path.startsWith(prefix)));
        origin = { kind: "archive", sourceId: source.id, configurationDigest: digest(JSON.stringify(source)), identityDigest: digest(JSON.stringify([source, refreshed.archiveDigest, skill.path])), artifactDigest: "", entryPath: skill.path, version: "", root: null, files: [] };
      }
    }
    if (files.length > 128 || files.reduce((bytes, file) => bytes + file.bytes, 0) > SKILL_INSPECTION_BYTES ||
      files.some((file) => digest(file.text) !== file.digest || Buffer.byteLength(file.text) !== file.bytes)) {
      throw new MoguriError("skill_inspection_incomplete", "Complete source inspection needs at most 128 lossless UTF-8 files and 512 KiB. Binary, oversized or unavailable dependencies were not admitted.", 413);
    }
    const main = files.find((file) => file.digest === expectedDigest && (file.path === skill.path || skill.path === null && file.path === "SKILL.md"));
    if (!main || main.text !== body) throw new MoguriError("skill_source_changed", "The original complete SKILL.md changed while its dependencies were captured.", 409);
    files.sort((a, b) => a.path.localeCompare(b.path));
    origin.files = files.map(({ text: _, ...file }) => file);
    origin.artifactDigest = digest(JSON.stringify(origin.files));
    signal.throwIfAborted();
    if (this.scope(sessionId) !== scope) throw new MoguriError("skill_source_changed", "Source, registry or policy authority changed during complete inspection.", 409);
    return { skill, body, origin, files, excluded, mainPath: main.path };
  }
  async query(query: SkillGatewayQuery, requested?: AbortSignal): Promise<SkillGatewayResponse> {
    query = parse(SkillGatewayQuerySchema, query);
    const signal = AbortSignal.any([this.abort.signal, AbortSignal.timeout(15000), ...(requested ? [requested] : [])]);
    signal.throwIfAborted();
    const scope = this.scope(query.sessionId), snapshot = this.host.snapshot(), session = snapshot.sessions.find((value) => value.id === query.sessionId);
    const sources = (snapshot.settings.values.skillSources ?? []).filter((source) => source.enabled);
    if (query.type === "skills.find" && query.sourceId && !sources.some((source) => source.id === query.sourceId)) throw new MoguriError("skill_source_missing", "This source is disabled, removed or outside the actual profile.", 404);
    const key = (catalogDigest: string) => digest(JSON.stringify([scope, query.type === "skills.find" ? query.sourceId ?? null : null, catalogDigest]));
    if (query.type === "skills.find" && query.expectedCatalogDigest) {
      const cached = this.snapshots.get(key(query.expectedCatalogDigest));
      if (cached && cached.expires > Date.now()) return this.page(query, cached.skills, cached.catalogDigest, false);
    }
    const loaded: Loaded[] = [];
    for (const entry of snapshot.registry.filter((entry) => entry.kind === "skill" && entry.enabled && !entry.retired &&
      (query.sessionId === undefined || entry.projectId === null || entry.projectId === session?.projectId) &&
      (!entry.ownerPluginId || snapshot.registry.some((plugin) => plugin.id === entry.ownerPluginId && plugin.enabled && !plugin.retired)))) {
      if (query.type === "skills.find" && query.sourceId) continue;
      this.host.compatible(entry);
      const body = this.store.blob(entry.contentDigest);
      loaded.push({ skill: { id: entry.id, name: entry.name, description: entry.description, digest: entry.contentDigest, bytes: Buffer.byteLength(body),
        sourceId: null, sourceName: "Enabled skills", path: null }, body });
    }
    for (const source of sources) {
      if (query.type === "skills.find" && query.sourceId && source.id !== query.sourceId) continue;
      try { loaded.push(...await (source.kind === "local" ? this.local(source, signal) : this.remote(source, signal))); }
      catch (error) {
        signal.throwIfAborted();
        throw new MoguriError(error instanceof MoguriError ? error.code : "skill_source_failed",
          `${source.name}: ${error instanceof Error ? error.message : "Source refresh failed."} No stale or partial catalog was returned.`, 409);
      }
    }
    signal.throwIfAborted();
    if (this.scope(query.sessionId) !== scope) throw new MoguriError("skill_source_changed", "Skill sources or session authority changed during refresh. No stale result was published.", 409);
    if (loaded.length > 512 || loaded.reduce((bytes, value) => bytes + value.skill.bytes, 0) > 16 * 1024 * 1024) throw new MoguriError("skill_limit", "The combined catalog exceeds 512 skills or 16 MiB. Select one source or disable unused sources.");
    loaded.sort((a, b) => a.skill.name.localeCompare(b.skill.name) || a.skill.id.localeCompare(b.skill.id));
    const catalogDigest = digest(JSON.stringify(loaded.map((value) => value.skill)));
    if (query.type === "skills.read") {
      const selected = loaded.find((value) => value.skill.id === query.skillId);
      if (!selected || selected.skill.digest !== query.expectedDigest) throw new MoguriError("skill_source_changed", "The selected skill was removed, disabled or changed since discovery. Find and review its fresh digest before loading.", 409);
      return { type: query.type, ...selected, catalogDigest, authority: "Untrusted skill instructions, never permission, installation or user approval." };
    }
    const skills = loaded.map((value) => value.skill);
    for (const [id, entry] of this.snapshots) if (entry.expires <= Date.now()) this.snapshots.delete(id);
    this.snapshots.delete(key(catalogDigest));
    this.snapshots.set(key(catalogDigest), { skills, catalogDigest, expires: Date.now() + SNAPSHOT_MS });
    while (this.snapshots.size > SNAPSHOTS) this.snapshots.delete(this.snapshots.keys().next().value!);
    // A continuation whose snapshot expired or never existed in this scope restarts at the fresh first page instead of failing.
    return this.page(query, skills, catalogDigest, Boolean(query.expectedCatalogDigest && query.expectedCatalogDigest !== catalogDigest));
  }
  private page(query: Extract<SkillGatewayQuery, { type: "skills.find" }>, skills: GatewaySkill[], catalogDigest: string, restarted: boolean): SkillGatewayResponse {
    const words = query.query.toLowerCase().trim().split(/\s+/).filter(Boolean);
    const found = skills.filter((skill) => words.every((word) => `${skill.name} ${skill.description} ${skill.path ?? ""}`.toLowerCase().includes(word)));
    const offset = restarted ? 0 : query.offset;
    if (offset > found.length) throw new MoguriError("skill_cursor", "The skill search changed. Start at offset zero.");
    return { type: query.type, skills: found.slice(offset, offset + 8), total: found.length,
      nextOffset: offset + 8 < found.length ? offset + 8 : null, catalogDigest, ...(restarted ? { restarted: true as const } : {}) };
  }
}
