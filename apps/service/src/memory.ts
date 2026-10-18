import { readdir, stat } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import ignore from "ignore";
import * as vec from "sqlite-vec";
import { MoguriError, type GraphNode, type GraphEdge, type MemoryHit, type Project } from "../../../packages/protocol/src/index.ts";
import { readProjectFile, scopedPath } from "./files.ts";
import { EventStore } from "./store.ts";

const dimensions = 384;
type IgnoreScope = { base: string; rules: ReturnType<typeof ignore> };
const protectedPaths = ignore().add([".git/", "node_modules/", ".moguri/", ".native/", "dist/", "release/", ".ssh/", ".aws/", ".env", ".env.*"]);
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
  private async localRules(root: string, directory: string): Promise<IgnoreScope> {
    const rules = ignore();
    try { rules.add((await readProjectFile(root, relative(root, join(directory, ".gitignore")))).text); }
    catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
    return { base: directory, rules };
  }
  private excluded(root: string, absolute: string, directory: boolean, chain: IgnoreScope[]): boolean {
    const suffix = directory ? "/" : "";
    if (protectedPaths.ignores(relative(root, absolute) + suffix)) return true;
    let excluded = false;
    for (const rule of chain) {
      const match = rule.rules.test(relative(rule.base, absolute) + suffix);
      if (match.ignored) excluded = true;
      if (match.unignored) excluded = false;
    }
    return excluded;
  }
  private async currentlyIgnored(root: string, path: string, cache: Map<string, IgnoreScope>): Promise<boolean> {
    const chain: IgnoreScope[] = [];
    const parts = path.split(/[\\/]/);
    for (let index = 0; index < parts.length; index++) {
      const directory = join(root, ...parts.slice(0, index));
      let rule = cache.get(directory);
      if (!rule) { rule = await this.localRules(root, directory); cache.set(directory, rule); }
      chain.push(rule);
      if (this.excluded(root, join(directory, parts[index]!), index < parts.length - 1, chain)) return true;
    }
    return false;
  }
  private async files(root: string, maxFiles: number, signal: AbortSignal): Promise<string[]> {
    const files: string[] = [];
    let directories = 0;
    const walk = async (directory: string, inherited: IgnoreScope[] = []) => {
      signal.throwIfAborted();
      if (++directories > 5000) throw new MoguriError("memory_limit", "The repository directory walk exceeded its bounded limit.");
      const chain = [...inherited, await this.localRules(root, directory)];
      const entries = (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (files.length >= maxFiles) return;
        const absolute = join(directory, entry.name);
        const path = relative(root, absolute);
        if (entry.isSymbolicLink() || this.excluded(root, absolute, entry.isDirectory(), chain)) continue;
        if (entry.isDirectory()) await walk(absolute, chain);
        else if (entry.isFile()) files.push(path);
      }
    };
    await walk(root);
    return files;
  }
  async index(project: Project, maxFiles: number, signal: AbortSignal, progress: (text: string) => void) {
    this.ready();
    const paths = await this.files(project.path, maxFiles, signal);
    const records: { path: string; digest: string; mtime: number; size: number; chunks: string[] }[] = [];
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
        nodes.push({ id: path, path, label: path, kind: "file" });
        for (const match of text.matchAll(/\b(?:class|function|interface|type|def)\s+([A-Za-z_$][\w$]*)/g)) {
          const symbol = `${path}#${match[1]}`;
          nodes.push({ id: symbol, path, label: match[1]!, kind: "symbol" });
          edges.push({ source: path, target: symbol, kind: "declares" });
        }
        for (const match of text.matchAll(/(?:from\s*|import\s*\(?\s*|require\s*\(\s*)["'](\.[^"']+)["']/g)) {
          const imported = relative(project.path, resolve(dirname(canonical), match[1]!));
          const target = [imported, ...[".ts", ".tsx", ".js", ".jsx", ".mjs", "/index.ts", "/index.js"].map((suffix) => imported + suffix)].find((path) => paths.includes(path));
          if (target) edges.push({ source: path, target, kind: "imports" });
        }
      } catch (error) {
        if (error instanceof MoguriError && ["path_denied", "file_limit"].includes(error.code)) { excluded++; continue; }
        throw error;
      }
      if (records.length % 25 === 0) progress(`Indexed ${records.length} files; reused ${reused} unchanged snapshots.`);
      await new Promise((resolve) => setImmediate(resolve));
    }
    signal.throwIfAborted();
    const db = this.store.db;
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("DELETE FROM memory_vectors WHERE project_id=?").run(project.id);
      for (const table of ["memory_files", "memory_chunks", "memory_graph_nodes", "memory_graph_edges"]) db.prepare(`DELETE FROM ${table} WHERE project_id=?`).run(project.id);
      for (const record of records) {
        db.prepare("INSERT INTO memory_files VALUES (?,?,?,?,?)").run(project.id, record.path, record.digest, record.mtime, record.size);
        for (const chunk of record.chunks) {
          const row = db.prepare("INSERT INTO memory_chunks(project_id,path,digest,text) VALUES (?,?,?,?)").run(project.id, record.path, record.digest, chunk);
          db.prepare("INSERT INTO memory_vectors(rowid,project_id,embedding) VALUES (?,?,?)").run(BigInt(row.lastInsertRowid), project.id, lexicalVector(chunk));
        }
      }
      for (const node of nodes) db.prepare("INSERT OR IGNORE INTO memory_graph_nodes VALUES (?,?,?,?,?)").run(project.id, node.id, node.path, node.label, node.kind);
      for (const edge of edges) db.prepare("INSERT OR IGNORE INTO memory_graph_edges VALUES (?,?,?,?)").run(project.id, edge.source, edge.target, edge.kind);
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
    return { indexedFiles: records.length, reusedFiles: reused, excludedFiles: excluded, sourceBytes: bytes, boundedAt: maxFiles, vectorKind: "local lexical vectors", graph: "import/symbol graph" };
  }
  async search(project: Project, text: string, limit: number): Promise<MemoryHit[]> {
    this.ready();
    const hits = this.store.db.prepare(`SELECT c.path,c.text,c.digest,f.mtime,f.size,v.distance FROM memory_vectors v JOIN memory_chunks c ON c.id=v.rowid JOIN memory_files f ON f.project_id=c.project_id AND f.path=c.path WHERE v.embedding MATCH ? AND k=? AND v.project_id=? ORDER BY v.distance`).all(lexicalVector(text), BigInt(limit), project.id);
    const result: MemoryHit[] = [];
    const rules = new Map<string, IgnoreScope>();
    for (const hit of hits) {
      let stale = true;
      try {
        const file = await stat(await scopedPath(project.path, String(hit.path)));
        stale = file.mtimeMs !== hit.mtime || file.size !== hit.size || await this.currentlyIgnored(project.path, String(hit.path), rules);
      }
      catch (error) { if (!(error instanceof MoguriError || error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
      result.push({ path: String(hit.path), text: stale ? "" : String(hit.text), digest: String(hit.digest), distance: Number(hit.distance), stale, source: "lexical-vector" });
    }
    return result;
  }
  graph(project: Project, path: string): { nodes: GraphNode[]; edges: GraphEdge[] } {
    const nodes = this.store.db.prepare("SELECT id,path,label,kind FROM memory_graph_nodes WHERE project_id=? AND (?='' OR path=?) LIMIT 1000").all(project.id, path, path);
    const edges = this.store.db.prepare("SELECT source,target,kind FROM memory_graph_edges WHERE project_id=? AND (?='' OR source=? OR target=?) LIMIT 2000").all(project.id, path, path, path);
    return {
      nodes: nodes.map((node) => ({ id: String(node.id), path: String(node.path), label: String(node.label), kind: node.kind === "symbol" ? "symbol" : "file" })),
      edges: edges.map((edge) => ({ source: String(edge.source), target: String(edge.target), kind: edge.kind === "imports" ? "imports" : "declares" })),
    };
  }
}
