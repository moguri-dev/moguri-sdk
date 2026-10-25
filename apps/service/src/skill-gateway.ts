import { isUtf8 } from "node:buffer";
import { lstat, readdir, realpath } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { crc32 } from "node:zlib";
import { fromBufferPromise } from "yauzl";
import { MoguriError, parse, SkillGatewayQuerySchema, skillArchiveUrl, type CapabilityEntry, type GatewaySkill, type SkillGatewayQuery, type SkillGatewayResponse, type SkillSource, type Snapshot } from "../../../packages/protocol/src/index.ts";
import { digest, type EventStore } from "./store.ts";
import { isProtectedProjectPath, readProjectFile } from "./files.ts";
import { sourceRootSync } from "./repository-source.ts";

const FILE_BYTES = 64 * 1024, DOWNLOAD_BYTES = 8 * 1024 * 1024, EXPANDED_BYTES = 32 * 1024 * 1024;
interface Loaded { skill: GatewaySkill; body: string }
export interface SkillGatewayOptions { fetch?: typeof fetch }
export class SkillGateway {
  private readonly abort = new AbortController();
  constructor(private readonly store: EventStore, private readonly host: {
    snapshot(): Snapshot; skill(content: string): { name: string; description: string }; compatible(entry: CapabilityEntry): void;
  }, private readonly options: SkillGatewayOptions = {}) {}
  close() { this.abort.abort(new Error("Skill gateway is closing. No result was published.")); }
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
    if ((await lstat(source.path)).isSymbolicLink()) throw new MoguriError("skill_source_link", "Choose the real skill folder rather than a symlink.");
    const binding = sourceRootSync(await realpath(source.path)), result: Loaded[] = [];
    let entries = 0;
    const walk = async (directory: string, depth: number) => {
      signal.throwIfAborted();
      if (depth > 16) throw new MoguriError("skill_limit", "The skill folder exceeds 16 nested levels. Select a narrower source.");
      const actual = await realpath(directory), rel = relative(binding.root, actual);
      if (isAbsolute(rel) || rel === ".." || rel.startsWith("../")) throw new MoguriError("skill_source_link", "A skill directory escaped the configured source. Nothing was returned.");
      for (const entry of (await readdir(actual, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        signal.throwIfAborted();
        if (++entries > 10000) throw new MoguriError("skill_limit", "The skill folder exceeds 10,000 entries. Select a narrower source.");
        const path = join(actual, entry.name), selected = relative(binding.root, path);
        if (isProtectedProjectPath(selected)) continue;
        if (entry.isSymbolicLink()) throw new MoguriError("skill_source_link", `The skill source contains a symlink at ${selected}. Select real files instead.`);
        if (entry.isDirectory()) await walk(path, depth + 1);
        else if (entry.name === "SKILL.md") {
          const file = await readProjectFile(binding.root, selected, FILE_BYTES);
          result.push(this.loaded(source, selected, file.text));
          if (result.length > 512) throw new MoguriError("skill_limit", "The source exceeds 512 skills. Select a narrower folder.");
        }
      }
    };
    await walk(binding.root, 0);
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
    const zip = await fromBufferPromise(Buffer.concat(chunks), { lazyEntries: true, strictFileNames: true, validateEntrySizes: true });
    const result: Loaded[] = [], names = new Set<string>();
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
            if (selected) buffers.push(buffer);
          }
        } finally { signal.removeEventListener("abort", aborted); stream.destroy(); }
        if (size !== entry.uncompressedSize || checksum !== entry.crc32) throw new MoguriError("skill_archive", "A skill archive entry failed its exact size/CRC check.");
        if (selected) {
          const body = Buffer.concat(buffers);
          if (!isUtf8(body)) throw new MoguriError("skill_encoding", "Archived skill text is not valid UTF-8.");
          result.push(this.loaded(source, path, body.toString("utf8")));
          if (result.length > 512) throw new MoguriError("skill_limit", "The archive exceeds 512 skills. Select a narrower source.");
        }
      }
    } finally { zip.close(); }
    return result;
  }
  async query(query: SkillGatewayQuery, requested?: AbortSignal): Promise<SkillGatewayResponse> {
    query = parse(SkillGatewayQuerySchema, query);
    const signal = AbortSignal.any([this.abort.signal, AbortSignal.timeout(15000), ...(requested ? [requested] : [])]);
    signal.throwIfAborted();
    const scope = this.scope(query.sessionId), snapshot = this.host.snapshot(), session = snapshot.sessions.find((value) => value.id === query.sessionId);
    const sources = (snapshot.settings.values.skillSources ?? []).filter((source) => source.enabled);
    if (query.type === "skills.find" && query.sourceId && !sources.some((source) => source.id === query.sourceId)) throw new MoguriError("skill_source_missing", "This source is disabled, removed or outside the actual profile.", 404);
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
    if (query.expectedCatalogDigest && query.expectedCatalogDigest !== catalogDigest) throw new MoguriError("skill_source_changed", "The skill catalog changed between pages. Start a fresh search.", 409);
    const words = query.query.toLowerCase().trim().split(/\s+/).filter(Boolean);
    const found = loaded.filter(({ skill }) => words.every((word) => `${skill.name} ${skill.description} ${skill.path ?? ""}`.toLowerCase().includes(word)));
    if (query.offset > found.length) throw new MoguriError("skill_cursor", "The skill search changed. Start at offset zero.");
    return { type: query.type, skills: found.slice(query.offset, query.offset + 8).map((value) => value.skill), total: found.length,
      nextOffset: query.offset + 8 < found.length ? query.offset + 8 : null, catalogDigest };
  }
}
