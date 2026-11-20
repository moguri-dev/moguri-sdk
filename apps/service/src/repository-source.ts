import { createHash } from "node:crypto";
import { lstat, readdir, realpath, stat } from "node:fs/promises";
import { lstatSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";
import { MoguriError } from "../../../packages/protocol/src/core.ts";
import { isProtectedProjectPath, readProjectFile, scopedPath } from "./files.ts";
import { ignoredPath, readIgnoreScope, type IgnoreScope } from "./ignore-rules.ts";
import { matchesFolder } from "./project-policy.ts";

export const SOURCE_FRAME_BYTES = 2 * 1024 * 1024;
export const SOURCE_BYTES = 64 * 1024 * 1024;
const path = Type.String({ minLength: 1, maxLength: 4096 }), hash = Type.String({ pattern: "^[a-f0-9]{64}$" });
const integer = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const object = <T extends Record<string, TSchema>>(properties: T) => Type.Object(properties, { additionalProperties: false });
const unsigned = Type.String({ pattern: "^[0-9]+$", maxLength: 40 });
export const SourceRootSchema = object({ root: path, device: unsigned, inode: unsigned });
export type SourceRoot = Static<typeof SourceRootSchema>;
const sameRoot = (left: SourceRoot, right: SourceRoot) => left.root === right.root && left.device === right.device && left.inode === right.inode;
/**
 * Identities retained across a restart compare by canonical path and inode only. Device numbers are boot-scoped:
 * macOS renumbers st_dev at boot, and Linux does for btrfs/overlay mounts. Same-operation before/after checks still compare the device.
 */
export const sameDurableIdentity = (stored: { inode: string }, actual: { inode: string }) => stored.inode === actual.inode;
export const sameDurableRoot = (stored: SourceRoot, actual: SourceRoot) => stored.root === actual.root && sameDurableIdentity(stored, actual);
/** Drops the boot-scoped device from a retained identity before a structural comparison. */
export const durableIdentity = <T extends { device: string }>(value: T): Omit<T, "device"> => { const { device: _device, ...rest } = value; return rest; };
export const SourceRecordSchema = object({
  path, digest: hash, mtime: Type.Number({ minimum: -Number.MAX_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER }),
  size: Type.Integer({ minimum: 0, maximum: 128 * 1024 }), text: Type.String({ maxLength: 128 * 1024 }),
});
export type SourceRecord = Static<typeof SourceRecordSchema>;
export const SourceRequestSchema = object({
  root: path, maxFiles: Type.Integer({ minimum: 1, maximum: 5000 }), denied: Type.Array(path, { maxItems: 100 }),
});
export const SourceValidationRequestSchema = object({
  binding: SourceRootSchema,
  files: Type.Array(Type.Pick(SourceRecordSchema, ["path", "digest", "mtime", "size"]), { maxItems: 1000 }),
  denied: Type.Array(path, { maxItems: 100 }),
});
export type SourceValidationRequest = Static<typeof SourceValidationRequestSchema>;
export const SourceValidationResultSchema = object({
  binding: SourceRootSchema, files: Type.Array(object({ path, stale: Type.Boolean() }), { maxItems: 1000 }),
});
export type SourceValidationResult = Static<typeof SourceValidationResultSchema>;
const relativeSourcePath = (path: string) => !path.startsWith("/") && !path.includes("\0") &&
  !path.split(/[\\/]/).some((part) => !part || part === "." || part === "..") && Buffer.from(path).toString("utf8") === path;
export const SourceFrameSchema = Type.Union([
  object({ kind: Type.Literal("source.begin"), binding: SourceRootSchema }),
  object({ kind: Type.Literal("source.file"), record: SourceRecordSchema }),
  object({ kind: Type.Literal("source.done"), files: integer, excluded: integer, bytes: integer, digest: hash, binding: SourceRootSchema }),
]);
export type SourceFrame = Static<typeof SourceFrameSchema>;
const sourceHash = () => createHash("sha256").update("moguri-repository-source-v1\0");
const recordHash = (hash: ReturnType<typeof sourceHash>, record: SourceRecord) =>
  hash.update(JSON.stringify([record.path, record.digest, record.mtime, record.size])).update("\n");
export function repositorySourceDigest(records: SourceRecord[]): string {
  const hash = sourceHash();
  for (const record of records) recordHash(hash, record);
  return hash.digest("hex");
}
export async function sourceRoot(root: string): Promise<SourceRoot> {
  const [canonical, metadata] = await Promise.all([realpath(root), lstat(root, { bigint: true })]);
  if (canonical !== root || !metadata.isDirectory() || metadata.isSymbolicLink()) throw new MoguriError("memory_root", "Repository memory needs its exact canonical directory, not an alias or replacement.");
  return { root, device: String(metadata.dev), inode: String(metadata.ino) };
}
export function sourceRootSync(root: string): SourceRoot {
  const canonical = realpathSync(root), metadata = lstatSync(root, { bigint: true });
  if (canonical !== root || !metadata.isDirectory() || metadata.isSymbolicLink()) throw new MoguriError("memory_root", "Repository memory needs its exact canonical directory, not an alias or replacement.");
  return { root, device: String(metadata.dev), inode: String(metadata.ino) };
}
export async function repositoryIgnored(root: string, path: string, cache: Map<string, IgnoreScope>): Promise<boolean> {
  const chain: IgnoreScope[] = [], parts = path.split(/[\\/]/);
  for (let index = 0; index < parts.length; index++) {
    const directory = join(root, ...parts.slice(0, index));
    let rule = cache.get(directory);
    if (!rule) { rule = await readIgnoreScope(root, directory); cache.set(directory, rule); }
    chain.push(rule);
    if (ignoredPath(root, join(directory, parts[index]!), index < parts.length - 1, chain)) return true;
  }
  return false;
}
export async function repositoryFiles(root: string, maxFiles: number, signal: AbortSignal, denied: string[] = []): Promise<string[]> {
  const files: string[] = [];
  let directories = 0;
  const walk = async (directory: string, inherited: IgnoreScope[] = []) => {
    signal.throwIfAborted();
    if (matchesFolder(relative(root, directory) || ".", denied)) return;
    if (++directories > 5000) throw new MoguriError("memory_limit", "The repository directory walk exceeded its bounded limit.");
    const chain = [...inherited, await readIgnoreScope(root, directory)];
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (files.length >= maxFiles) return;
      const absolute = join(directory, entry.name), path = relative(root, absolute);
      if (entry.isSymbolicLink() || matchesFolder(path, denied) || ignoredPath(root, absolute, entry.isDirectory(), chain)) continue;
      if (entry.isDirectory()) await walk(absolute, chain);
      else if (entry.isFile()) files.push(path);
    }
  };
  await walk(root); return files;
}
export async function validateRepositorySource(request: SourceValidationRequest, signal: AbortSignal) {
  signal.throwIfAborted();
  if (!Value.Check(SourceValidationRequestSchema, request)) throw new MoguriError("memory_input", "Repository validation needs exact bounded source metadata.");
  const binding = await sourceRoot(request.binding.root);
  if (!sameDurableRoot(request.binding, binding)) throw new MoguriError("memory_root_changed", "The indexed repository root has changed. No Local index or replacement root was used.", 409);
  const rules = new Map<string, IgnoreScope>(), files: { path: string; stale: boolean }[] = [];
  for (const file of request.files) {
    signal.throwIfAborted();
    if (!relativeSourcePath(file.path) || isProtectedProjectPath(file.path)) throw new MoguriError("memory_path", "Repository validation cannot read an invalid or protected source path.", 403);
    let stale = true;
    if (!matchesFolder(file.path, request.denied)) {
      try {
        const canonical = await scopedPath(binding.root, file.path), metadata = await lstat(canonical);
        stale = canonical !== join(binding.root, file.path) || !metadata.isFile() || metadata.isSymbolicLink() ||
          metadata.mtimeMs !== file.mtime || metadata.size !== file.size || await repositoryIgnored(binding.root, file.path, rules);
      } catch (error) {
        if (!(error instanceof MoguriError && error.code === "path_denied" ||
          error instanceof Error && "code" in error && ["ENOENT", "ENOTDIR"].includes(String(error.code)))) throw error;
      }
    }
    files.push({ path: file.path, stale });
  }
  signal.throwIfAborted();
  if (!sameRoot(await sourceRoot(binding.root), binding)) throw new MoguriError("memory_root_changed", "The indexed repository root changed during validation.");
  signal.throwIfAborted(); return { binding, files };
}
export async function captureRepositorySource(root: string, maxFiles: number, denied: string[], signal: AbortSignal, send: (frame: SourceFrame) => Promise<void>): Promise<void> {
  signal.throwIfAborted();
  if (!isAbsolute(root) || !Value.Check(SourceRequestSchema, { root, maxFiles, denied })) throw new MoguriError("memory_input", "Repository source capture needs a valid bounded root/file/policy request.");
  const binding = await sourceRoot(root), paths = await repositoryFiles(root, maxFiles, signal, denied), hash = sourceHash();
  await send({ kind: "source.begin", binding });
  let files = 0, excluded = 0, bytes = 0;
  for (const path of paths) {
    signal.throwIfAborted();
    let record: SourceRecord;
    try {
      const canonical = await scopedPath(root, path), before = await stat(canonical);
      const file = await readProjectFile(root, path), after = await stat(await scopedPath(root, path));
      if (file.path !== path || before.mtimeMs !== after.mtimeMs || before.size !== after.size || after.size !== file.bytes || before.dev !== after.dev || before.ino !== after.ino) {
        throw new MoguriError("memory_source_changed", "Repository source changed during capture. No mixed snapshot was published.", 409);
      }
      record = { path, digest: file.digest, mtime: after.mtimeMs, size: after.size, text: file.text };
    } catch (error) {
      if (error instanceof MoguriError && ["path_denied", "file_limit"].includes(error.code)) { excluded++; continue; }
      throw error;
    }
    bytes += record.size;
    if (bytes > SOURCE_BYTES) throw new MoguriError("memory_limit", "Repository memory is limited to 64 MiB of source text. No partial cache was published.");
    signal.throwIfAborted(); recordHash(hash, record); await send({ kind: "source.file", record }); files++;
  }
  signal.throwIfAborted();
  const after = await sourceRoot(root);
  if (!sameRoot(after, binding)) throw new MoguriError("memory_root_changed", "The repository directory changed during capture. No replacement root was indexed.", 409);
  signal.throwIfAborted(); await send({ kind: "source.done", binding, files, excluded, bytes, digest: hash.digest("hex") });
}
export class RepositorySourceCapture {
  private binding?: SourceRoot;
  private readonly records: SourceRecord[] = [];
  private readonly paths = new Set<string>();
  private readonly hash = sourceHash();
  private bytes = 0;
  private failed = false;
  private result?: { binding: SourceRoot; records: SourceRecord[]; excluded: number; sourceBytes: number; digest: string };
  constructor(private readonly root: string, private readonly maxFiles: number, private readonly denied: string[] = []) {
    if (!isAbsolute(root) || !Value.Check(SourceRequestSchema, { root, maxFiles, denied })) throw new MoguriError("memory_input", "Repository source admission needs a valid bounded request.");
  }
  accept(raw: unknown): boolean {
    if (this.failed) throw new MoguriError("memory_protocol", "A rejected repository source stream cannot be continued.");
    try { return this.frame(raw); }
    catch (error) { this.failed = true; throw error; }
  }
  private frame(raw: unknown): boolean {
    if (this.result || !Value.Check(SourceFrameSchema, raw)) throw new MoguriError("memory_protocol", "Repository source stream is malformed or already complete.");
    if (raw.kind === "source.begin") {
      if (this.binding || raw.binding.root !== this.root) throw new MoguriError("memory_protocol", "Repository source stream changed its original root.");
      this.binding = { ...raw.binding }; return false;
    }
    if (!this.binding) throw new MoguriError("memory_protocol", "Repository source data arrived before its root binding.");
    if (raw.kind === "source.file") {
      const record = { ...raw.record };
      if (!relativeSourcePath(record.path) ||
        isProtectedProjectPath(record.path) || matchesFolder(record.path, this.denied) || record.text.includes("\0") ||
        Buffer.from(record.path).toString("utf8") !== record.path || Buffer.from(record.text).toString("utf8") !== record.text || this.paths.has(record.path) ||
        record.size !== Buffer.byteLength(record.text) || createHash("sha256").update(record.text).digest("hex") !== record.digest ||
        this.records.length >= this.maxFiles || this.bytes + record.size > SOURCE_BYTES) throw new MoguriError("memory_protocol", "Repository source path, content digest or aggregate bound is invalid.");
      this.paths.add(record.path); this.records.push(record); this.bytes += record.size; recordHash(this.hash, record); return false;
    }
    if (!sameRoot(raw.binding, this.binding) || raw.files !== this.records.length || raw.excluded > this.maxFiles - this.records.length ||
      raw.bytes !== this.bytes || raw.digest !== this.hash.digest("hex")) {
      throw new MoguriError("memory_protocol", "Repository source stream did not complete its exact binding, counts and content hash.");
    }
    this.result = { binding: this.binding, records: this.records, excluded: raw.excluded, sourceBytes: this.bytes, digest: raw.digest }; return true;
  }
  complete() {
    if (this.failed || !this.result) throw new MoguriError("memory_incomplete", "Repository source stream ended without exact valid completion. No partial cache is usable.");
    return this.result;
  }
}
