import { stat } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import * as vec from "sqlite-vec";
import { Value } from "typebox/value";
import { MoguriError, MemoryBindingSchema, MemoryIndexSchema, MemoryTargetSchema, type MemoryBinding, type MemoryIndex, type MemoryTarget, type GraphNode, type GraphEdge, type MemoryHit } from "../../../packages/protocol/src/index.ts";
import { readProjectFile, scopedPath } from "./files.ts";
import { EventStore, profileIndexId } from "./store.ts";
import { matchesFolder } from "./project-policy.ts";
import type { IgnoreScope } from "./ignore-rules.ts";
import { repositoryFiles, repositoryIgnored, repositorySourceDigest, RepositorySourceCapture, type SourceRecord } from "./repository-source.ts";
import { frameDigest } from "./worker-wire.ts";

const dimensions = 384;
export interface MemoryScope { id: string; path: string }
export interface MemoryCandidate extends Pick<SourceRecord, "path" | "digest" | "mtime" | "size"> { text: string; distance: number }
const targetIdentity = (target: MemoryTarget) => [target.profileId, target.projectId, target.workspaceId, target.env, target.root,
  target.env === "Remote" ? [target.remote.peerDigest, target.remote.host, target.remote.port, target.remote.user, target.remote.hostFingerprint, target.remote.workerDigest] : null];
export const memoryLocator = (target: MemoryTarget) => frameDigest(["moguri-memory-locator-v1", ...targetIdentity(target)]);
export const memoryIndexId = (binding: MemoryBinding) => binding.env === "Local" ? profileIndexId(binding.profileId, binding.workspaceId ?? binding.projectId) :
  `${profileIndexId(binding.profileId, binding.projectId)}:remote:${frameDigest(["moguri-memory-index-v1", ...targetIdentity(binding), binding.device, binding.inode])}`;
interface IndexedRecord { path: string; digest: string; mtime: number; size: number; chunks: string[] }
function appendGraph(root: string, path: string, canonical: string, text: string, paths: string[], nodes: GraphNode[], edges: GraphEdge[]): void {
  nodes.push({ id: path, path, label: path, kind: "file" });
  for (const match of text.matchAll(/\b(?:class|function|interface|type|def)\s+([A-Za-z_$][\w$]*)/g)) {
    const symbol = `${path}#${match[1]}`;
    nodes.push({ id: symbol, path, label: match[1]!, kind: "symbol" }); edges.push({ source: path, target: symbol, kind: "declares" });
  }
  for (const match of text.matchAll(/(?:from\s*|import\s*\(?\s*|require\s*\(\s*)["'](\.[^"']+)["']/g)) {
    const imported = relative(root, resolve(dirname(canonical), match[1]!));
    const target = [imported, ...[".ts", ".tsx", ".js", ".jsx", ".mjs", "/index.ts", "/index.js"].map((suffix) => imported + suffix)].find((path) => paths.includes(path));
    if (target) edges.push({ source: path, target, kind: "imports" });
  }
  if (nodes.length > 100_000 || edges.length > 250_000) throw new MoguriError("memory_limit", "Repository memory graph exceeded its bounded node/edge limit. No partial cache was published.");
}
export function lexicalVector(text: string): Buffer {
  const values = new Float32Array(dimensions);
  const words = text.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [];
  for (const word of words) {
    let hash = 2166136261;
    for (const character of word) hash = Math.imul(hash ^ character.codePointAt(0)!, 16777619);
    values[(hash >>> 0) % dimensions]! += 1;
  }
  const length = Math.hypot(...values);
  if (!length) values[0] = 1;
  else for (let i = 0; i < dimensions; i++) values[i]! /= length;
  return Buffer.from(values.buffer);
}
export class RepositoryMemory {
  private loaded = false;
  constructor(private readonly store: EventStore) {}
  private ready(): void {
    if (this.loaded) return;
    vec.load(this.store.db);
    this.store.db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS memory_vectors USING vec0(project_id TEXT PARTITION KEY, embedding FLOAT[384] DISTANCE_METRIC=cosine)");
    this.loaded = true;
  }
  private write(project: MemoryScope, records: IndexedRecord[], nodes: GraphNode[], edges: GraphEdge[], metadata?: { index: MemoryIndex; assertCurrent(): void }) {
    const db = this.store.db;
    if (metadata && (!Value.Check(MemoryIndexSchema, metadata.index) || !Number.isFinite(Date.parse(metadata.index.indexedAt)) || metadata.index.binding.profileId !== this.store.profileId ||
      project.id !== memoryIndexId(metadata.index.binding) || project.path !== metadata.index.binding.root)) throw new MoguriError("memory_scope", "Repository cache publication does not own its exact profile/root binding.", 409);
    const remove = (id: string) => {
      db.prepare("DELETE FROM memory_vectors WHERE project_id=?").run(id);
      for (const table of ["memory_files", "memory_chunks", "memory_graph_nodes", "memory_graph_edges"]) db.prepare(`DELETE FROM ${table} WHERE project_id=?`).run(id);
    };
    metadata?.assertCurrent();
    db.exec("BEGIN IMMEDIATE");
    try {
      if (metadata) {
        const index = metadata.index, locator = memoryLocator(index.binding);
        const previous = db.prepare("SELECT locator,scope_id,profile_id,project_id,workspace_id,metadata FROM memory_scopes WHERE locator=? OR scope_id=?").all(locator, project.id);
        for (const row of previous) {
          const prior = this.indexRow(row);
          if (prior.index.binding.projectId !== index.binding.projectId || prior.index.binding.workspaceId !== index.binding.workspaceId) throw new MoguriError("memory_scope", "Previous derived cache belongs to another owner. No rows were adopted or removed.", 409);
          if (prior.scope.id !== project.id) remove(prior.scope.id);
        }
        db.prepare("INSERT OR REPLACE INTO memory_scopes VALUES (?,?,?,?,?,?)").run(locator, project.id, index.binding.profileId, index.binding.projectId, index.binding.workspaceId, JSON.stringify(index));
      }
      remove(project.id);
      for (const record of records) {
        db.prepare("INSERT INTO memory_files VALUES (?,?,?,?,?)").run(project.id, record.path, record.digest, record.mtime, record.size);
        for (const chunk of record.chunks) {
          const row = db.prepare("INSERT INTO memory_chunks(project_id,path,digest,text) VALUES (?,?,?,?)").run(project.id, record.path, record.digest, chunk);
          db.prepare("INSERT INTO memory_vectors(rowid,project_id,embedding) VALUES (?,?,?)").run(BigInt(row.lastInsertRowid), project.id, lexicalVector(chunk));
        }
      }
      for (const node of nodes) db.prepare("INSERT OR IGNORE INTO memory_graph_nodes VALUES (?,?,?,?,?)").run(project.id, node.id, node.path, node.label, node.kind);
      for (const edge of edges) db.prepare("INSERT OR IGNORE INTO memory_graph_edges VALUES (?,?,?,?)").run(project.id, edge.source, edge.target, edge.kind);
      metadata?.assertCurrent(); db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  }
  private indexRow(row: Record<string, unknown>): { scope: MemoryScope; index: MemoryIndex } {
    let index: unknown;
    try { index = typeof row.metadata === "string" ? JSON.parse(row.metadata) : null; }
    catch (error) { if (error instanceof SyntaxError) throw new MoguriError("memory_corrupt", "Derived memory metadata is invalid. Rebuild this exact repository index explicitly."); throw error; }
    if (!Value.Check(MemoryIndexSchema, index) || !Number.isFinite(Date.parse(index.indexedAt)) ||
      index.binding.profileId !== this.store.profileId || row.locator !== memoryLocator(index.binding) ||
      row.scope_id !== memoryIndexId(index.binding) || row.profile_id !== index.binding.profileId || row.project_id !== index.binding.projectId || row.workspace_id !== index.binding.workspaceId) {
      throw new MoguriError("memory_corrupt", "Derived memory metadata changed its exact owner/root identity. No alternate index was read.", 409);
    }
    return { scope: { id: String(row.scope_id), path: index.binding.root }, index };
  }
  cached(target: MemoryTarget): { scope: MemoryScope; index: MemoryIndex } | null {
    if (!(Value.Check(MemoryTargetSchema, target) || Value.Check(MemoryBindingSchema, target)) || target.profileId !== this.store.profileId) throw new MoguriError("memory_scope", "Choose the exact current profile's repository memory target.", 403);
    const row = this.store.db.prepare("SELECT locator,scope_id,profile_id,project_id,workspace_id,metadata FROM memory_scopes WHERE locator=?").get(memoryLocator(target));
    return row ? this.indexRow(row) : null;
  }
  published(jobId: string): boolean {
    return Boolean(this.store.db.prepare("SELECT locator FROM memory_scopes WHERE profile_id=? AND CASE WHEN json_valid(metadata) THEN json_extract(metadata,'$.jobId')=? ELSE 0 END LIMIT 1").get(this.store.profileId, jobId));
  }
  publish(index: MemoryIndex, source: SourceRecord[], assertCurrent: () => void, denied: string[] = []): void {
    if (!Value.Check(MemoryIndexSchema, index) || index.binding.profileId !== this.store.profileId) throw new MoguriError("memory_input", "A captured repository index needs valid metadata in its exact owning profile.");
    this.ready();
    const validation = new RepositorySourceCapture(index.binding.root, 5000, denied);
    const binding = { root: index.binding.root, device: index.binding.device, inode: index.binding.inode };
    validation.accept({ kind: "source.begin", binding });
    for (const record of source) validation.accept({ kind: "source.file", record });
    validation.accept({ kind: "source.done", binding, files: index.indexedFiles, excluded: index.excludedFiles, bytes: index.sourceBytes, digest: index.sourceDigest });
    const captured = validation.complete(), nodes: GraphNode[] = [], edges: GraphEdge[] = [], paths = captured.records.map((record) => record.path);
    const records = captured.records.map((record) => {
      appendGraph(index.binding.root, record.path, resolve(index.binding.root, record.path), record.text, paths, nodes, edges);
      return { path: record.path, digest: record.digest, mtime: record.mtime, size: record.size,
        chunks: Array.from({ length: Math.max(1, Math.ceil(record.text.length / 4000)) }, (_, offset) => record.text.slice(offset * 4000, (offset + 1) * 4000)) };
    });
    this.write({ id: memoryIndexId(index.binding), path: index.binding.root }, records, nodes, edges, { index, assertCurrent });
  }
  async index(project: MemoryScope, maxFiles: number, signal: AbortSignal, progress: (text: string) => void, denied: string[] = [],
    metadata?: { binding: Extract<MemoryBinding, { env: "Local" }>; jobId?: string; assertCurrent(): void }) {
    this.ready();
    const paths = await repositoryFiles(project.path, maxFiles, signal, denied);
    if (metadata && (!Value.Check(MemoryBindingSchema, metadata.binding) || metadata.binding.env !== "Local")) throw new MoguriError("memory_scope", "Local indexing cannot label a filesystem read as Remote.");
    const records: IndexedRecord[] = [];
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    let reused = 0;
    let excluded = 0;
    let bytes = 0;
    for (const path of paths) {
      signal.throwIfAborted();
      try {
        const canonical = await scopedPath(project.path, path);
        const info = await stat(canonical);
        const previous = this.store.db.prepare("SELECT digest,mtime,size FROM memory_files WHERE project_id=? AND path=?").get(project.id, path);
        let text: string;
        let digest: string;
        if (previous && previous.mtime === info.mtimeMs && previous.size === info.size) {
          text = this.store.db.prepare("SELECT text FROM memory_chunks WHERE project_id=? AND path=? ORDER BY id").all(project.id, path).map((row) => String(row.text)).join("");
          digest = String(previous.digest); reused++;
        } else {
          const snapshot = await readProjectFile(project.path, path);
          text = snapshot.text; digest = snapshot.digest;
        }
        bytes += Buffer.byteLength(text);
        if (bytes > 64 * 1024 * 1024) throw new MoguriError("memory_limit", "Repository memory is limited to 64 MiB of source text per indexing operation.");
        const chunks = Array.from({ length: Math.max(1, Math.ceil(text.length / 4000)) }, (_, index) => text.slice(index * 4000, (index + 1) * 4000));
        records.push({ path, digest, mtime: info.mtimeMs, size: info.size, chunks });
        appendGraph(project.path, path, canonical, text, paths, nodes, edges);
      } catch (error) {
        if (error instanceof MoguriError && ["path_denied", "file_limit"].includes(error.code)) { excluded++; continue; }
        throw error;
      }
      if (records.length % 25 === 0) progress(`Indexed ${records.length} files; reused ${reused} unchanged snapshots.`);
      await new Promise((resolve) => setImmediate(resolve));
    }
    signal.throwIfAborted();
    const index: MemoryIndex | undefined = metadata ? { version: 1, binding: metadata.binding, ...(metadata.jobId ? { jobId: metadata.jobId } : {}),
      sourceDigest: repositorySourceDigest(records.map(({ chunks, ...record }) => ({ ...record, text: chunks.join("") }))), indexedFiles: records.length, excludedFiles: excluded, sourceBytes: bytes, indexedAt: new Date().toISOString() } : undefined;
    this.write(project, records, nodes, edges, metadata && index ? { index, assertCurrent: metadata.assertCurrent } : undefined);
    return { indexedFiles: records.length, reusedFiles: reused, excludedFiles: excluded, sourceBytes: bytes, boundedAt: maxFiles, vectorKind: "local lexical vectors", graph: "import/symbol graph" };
  }
  candidates(project: MemoryScope, text: string, limit: number, denied: string[] = []): MemoryCandidate[] {
    this.ready();
    if (!text || !Number.isSafeInteger(limit) || limit < 1 || limit > 20) throw new MoguriError("memory_input", "Choose a non-empty memory query and a result count from 1 to 20.");
    const hits = this.store.db.prepare(`SELECT c.path,c.text,c.digest,f.mtime,f.size,v.distance FROM memory_vectors v JOIN memory_chunks c ON c.id=v.rowid JOIN memory_files f ON f.project_id=c.project_id AND f.path=c.path WHERE v.embedding MATCH ? AND k=? AND v.project_id=? ORDER BY v.distance`).all(lexicalVector(text), BigInt(limit), project.id);
    return hits.filter((hit) => !matchesFolder(String(hit.path), denied)).map((hit) => ({
      path: String(hit.path), text: String(hit.text), digest: String(hit.digest), mtime: Number(hit.mtime), size: Number(hit.size), distance: Number(hit.distance),
    }));
  }
  versions(project: MemoryScope, paths: string[]) {
    if (paths.length > 1000) throw new MoguriError("memory_limit", "Source validation is bounded to 1,000 distinct indexed paths.");
    return [...new Set(paths)].map((path) => {
      const file = this.store.db.prepare("SELECT digest,mtime,size FROM memory_files WHERE project_id=? AND path=?").get(project.id, path);
      if (!file) throw new MoguriError("memory_corrupt", "An indexed graph path has no source metadata. Rebuild this exact cache explicitly.");
      return { path, digest: String(file.digest), mtime: Number(file.mtime), size: Number(file.size) };
    });
  }
  async search(project: MemoryScope, text: string, limit: number, denied: string[] = []): Promise<MemoryHit[]> {
    const hits = this.candidates(project, text, limit, denied);
    const result: MemoryHit[] = [];
    const rules = new Map<string, IgnoreScope>();
    for (const hit of hits) {
      let stale = true;
      try {
        const file = await stat(await scopedPath(project.path, String(hit.path)));
        stale = file.mtimeMs !== hit.mtime || file.size !== hit.size || await repositoryIgnored(project.path, String(hit.path), rules);
      }
      catch (error) { if (!(error instanceof MoguriError || error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
      result.push({ path: String(hit.path), text: stale ? "" : String(hit.text), digest: String(hit.digest), distance: Number(hit.distance), stale, source: "lexical-vector" });
    }
    return result;
  }
  graph(project: MemoryScope, path: string): { nodes: GraphNode[]; edges: GraphEdge[] } {
    const nodes = this.store.db.prepare("SELECT id,path,label,kind FROM memory_graph_nodes WHERE project_id=? AND (?='' OR path=?) LIMIT 1000").all(project.id, path, path);
    const edges = this.store.db.prepare("SELECT source,target,kind FROM memory_graph_edges WHERE project_id=? AND (?='' OR source=? OR target=?) LIMIT 2000").all(project.id, path, path, path);
    return {
      nodes: nodes.map((node) => ({ id: String(node.id), path: String(node.path), label: String(node.label), kind: node.kind === "symbol" ? "symbol" : "file" })),
      edges: edges.map((edge) => ({ source: String(edge.source), target: String(edge.target), kind: edge.kind === "imports" ? "imports" : "declares" })),
    };
  }
}
