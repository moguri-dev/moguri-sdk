import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { GLOBAL_PROFILE_ID, MoguriError, type StateLocation, type StorageMove, type StorageMoveRequest, type StorageMoveReview, type StorageStatus } from "../../../packages/protocol/src/index.ts";
import { readStateLocation, setDefaultStateLocation, writeStateLocation } from "../../../packages/client/src/state-location.ts";
import { digest, EventStore } from "./store.ts";
import { localRootsOverlap } from "./project-clone.ts";

export interface StorageOptions { locatorDirectory: string; explicitOverride: boolean }
export interface MaintenanceFacts { profiles: string[]; activeOwners: string[]; roots: string[] }
const missing = (error: unknown) => error instanceof Error && "code" in error && error.code === "ENOENT";
export async function stateDatabaseDigest(path: string): Promise<string> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW), hash = createHash("sha512");
  try {
    const original = await file.stat(), buffer = Buffer.alloc(64 * 1024);
    if (!original.isFile() || original.uid !== process.getuid?.() || original.mode & 0o077 || original.nlink !== 1) throw new Error("The encrypted database is not a private regular owned file.");
    let offset = 0;
    while (true) { const read = await file.read(buffer, 0, buffer.length, offset); if (!read.bytesRead) break; offset += read.bytesRead; hash.update(buffer.subarray(0, read.bytesRead)); }
    const final = await file.stat();
    if (final.size !== offset || final.size !== original.size || final.mtimeMs !== original.mtimeMs || final.ctimeMs !== original.ctimeMs) throw new Error("The closed encrypted source changed during verification. Nothing was published.");
    return hash.digest("hex");
  } finally { await file.close(); }
}
export function storedStorageOptions(path: string): { locatorDirectory: string | null; resourceBase: string | null } {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    if (Number(db.prepare("PRAGMA user_version").get()?.user_version) < 4) return { locatorDirectory: null, resourceBase: null };
    const locator = db.prepare("SELECT value FROM retention_metadata WHERE id='storage_locator_directory'").get()?.value;
    const resources = db.prepare("SELECT value FROM retention_metadata WHERE id='storage_resource_base'").get()?.value;
    if (locator !== undefined && (typeof locator !== "string" || !isAbsolute(locator)) || resources !== undefined && (typeof resources !== "string" || !isAbsolute(resources))) throw new Error("Stored filesystem provenance is invalid. Preserve the database; no resource root was invented.");
    return { locatorDirectory: typeof locator === "string" ? locator : null, resourceBase: typeof resources === "string" ? resources : null };
  } finally { db.close(); }
}
export async function acknowledgeMovedDatabase(path: string, options: StorageOptions, keyId: string): Promise<void> {
  const location = readStateLocation(options.locatorDirectory, keyId);
  if (!location || location.move.status !== "published") return;
  if (await realpath(dirname(path)) !== location.dataDir || !location.move.databaseDigest) throw new Error("The published relocation lost its exact target or copied digest.");
  let db = new DatabaseSync(path, { readOnly: true });
  let acknowledgement: unknown;
  try { acknowledgement = db.prepare("SELECT value FROM retention_metadata WHERE id='storage_move_ack'").get()?.value; } finally { db.close(); }
  const expected = JSON.stringify({ id: location.move.id, digest: location.move.databaseDigest, dataDir: location.dataDir });
  if (acknowledgement !== expected) {
    if (await stateDatabaseDigest(path) !== location.move.databaseDigest) throw new Error("The relocated database changed before its first acknowledgement. No SQLite writer, provider or profile was initialized.");
    db = new DatabaseSync(path);
    try {
      if (db.prepare("SELECT value FROM retention_metadata WHERE id='key_id'").get()?.value !== keyId) throw new Error("The relocated database key identity changed.");
      db.prepare("INSERT INTO retention_metadata(id,value) VALUES ('storage_move_ack',?) ON CONFLICT(id) DO UPDATE SET value=excluded.value").run(expected);
    } finally { db.close(); }
  }
  await writeStateLocation(options.locatorDirectory, { ...location, move: { ...location.move, status: "completed" } });
}

export class StorageRelocation {
  private operation: StorageMove | null;
  private readonly source: string;
  private readonly keyId: string;
  private reserved = false;
  constructor(private readonly store: EventStore, private readonly resourceBase: string, private readonly options: StorageOptions | undefined,
    private readonly facts: () => MaintenanceFacts, private readonly changed: () => void, private readonly quiesce: () => void) {
    this.source = resolve(dirname(store.path));
    this.keyId = String(store.db.prepare("SELECT value FROM retention_metadata WHERE id='key_id'").get()?.value ?? "");
    const last = store.events().findLast((event) => event.event_type === "application.storage_recorded");
    this.operation = last?.event_type === "application.storage_recorded" ? last.payload.operation : null;
    if (this.operation?.status === "preparing" && options) {
      const location = readStateLocation(options.locatorDirectory, this.keyId);
      this.record({ ...this.operation, status: location?.move.id === this.operation.id && location.move.status === "completed" ? "completed" : "partial",
        databaseDigest: location?.move.id === this.operation.id ? location.move.databaseDigest : null,
        diagnostic: location?.move.id === this.operation.id && location.move.status === "completed" ? null : "Relocation was interrupted. Original source and partial target were preserved; no copy was replayed." });
    }
  }
  status(): StorageStatus {
    return { enabled: Boolean(this.options), directory: this.source, resourceBase: this.resourceBase, explicitOverride: this.options?.explicitOverride ?? true,
      locatorDirectory: this.options?.locatorDirectory ?? null,
      operation: this.operation ? structuredClone(this.operation) : null,
      diagnostic: this.options ? null : "This embedded runtime has no configured store-location authority. No machine locator or alternate root was inferred." };
  }
  private record(operation: StorageMove): void {
    this.store.commit([{ event_type: "application.storage_recorded", profile_id: GLOBAL_PROFILE_ID, payload: { operation } }]);
    this.operation = operation; this.changed();
  }
  async preview(input: string): Promise<StorageMoveReview> {
    if (!this.options) throw new MoguriError("storage_authority", "Configure an explicit private locator authority before relocating this embedded runtime.", 409);
    if (this.options.explicitOverride) throw new MoguriError("storage_override", "This launch explicitly selected MOGURI_STATE_DIR. Restart without that override before changing default storage. No environment variable or selected root was changed.", 409);
    if (this.reserved) throw new MoguriError("storage_pending", "The original relocation is already owned. Inspect it; no second move was started.", 409);
    if (!isAbsolute(input) || resolve(input) !== input) throw new MoguriError("storage_destination", "Review an absolute normalized destination, not a relative path or alias.");
    const parent = await realpath(dirname(input)), destination = join(parent, basename(input)), source = await realpath(this.source);
    const parentStat = await lstat(parent);
    if (!parentStat.isDirectory() || parentStat.uid !== process.getuid?.()) throw new MoguriError("storage_destination", "Choose a real destination under a user-owned directory.");
    const facts = this.facts(), resources = await realpath(this.resourceBase), locator = await realpath(this.options.locatorDirectory);
    if ([source, resources, locator, ...facts.roots].some((root) => localRootsOverlap(root, destination))) throw new MoguriError("storage_overlap", "Choose a destination outside existing data, locator, project and worktree roots. Those resources are not moved.", 409);
    let destinationIdentity = `${parentStat.dev}:${parentStat.ino}:missing`;
    try {
      const target = await lstat(destination);
      if (!target.isDirectory() || target.isSymbolicLink() || target.uid !== process.getuid?.() || target.mode & 0o077 || (await readdir(destination)).length) throw new MoguriError("storage_destination", "The destination must be absent or an empty private user-owned directory. Nothing there was removed or adopted.", 409);
      destinationIdentity = `${parentStat.dev}:${parentStat.ino}:${target.dev}:${target.ino}:${target.mode}`;
    } catch (error) { if (!missing(error)) throw error; }
    const body = { source, destination, resourceBase: resources, keyId: this.keyId, profiles: [...facts.profiles].sort(), activeOwners: [...facts.activeOwners].sort(), copySet: ["state.sqlite"] as ["state.sqlite"], destinationIdentity };
    return { ...body, digest: digest(JSON.stringify(body)) };
  }
  async begin(request: StorageMoveRequest): Promise<{ id: string; keyId: string }> {
    const existing = this.store.events().find((event) => event.event_type === "application.storage_recorded" && event.payload.operation.id === request.id);
    if (existing) throw new MoguriError("storage_no_replay", "This original relocation already has retained intent. Inspect its actual outcome; no copy or restart was replayed.", 409);
    const review = await this.preview(request.path);
    if (this.reserved) throw new MoguriError("storage_pending", "Another original relocation was admitted while this review was being checked.", 409);
    if (review.digest !== request.expectedDigest) throw new MoguriError("storage_review_changed", "Source, destination, profiles or actual active owners changed. Review the current relocation before proceeding.", 409);
    this.reserved = true;
    this.record({ id: request.id, review, status: "preparing", databaseDigest: null, diagnostic: null });
    this.store.db.prepare("INSERT INTO retention_metadata(id,value) VALUES ('storage_resource_base',?) ON CONFLICT(id) DO NOTHING").run(review.resourceBase);
    this.store.db.prepare("INSERT INTO retention_metadata(id,value) VALUES ('storage_locator_directory',?) ON CONFLICT(id) DO NOTHING").run(this.options!.locatorDirectory);
    this.quiesce();
    const location: StateLocation = { schemaVersion: 1, keyId: this.keyId, dataDir: review.source, resourceBase: review.resourceBase,
      move: { id: request.id, source: review.source, destination: review.destination, ownerPid: process.pid, status: "moving", databaseDigest: null, diagnostic: null } };
    try { await writeStateLocation(this.options!.locatorDirectory, location); await setDefaultStateLocation(this.options!.locatorDirectory, this.keyId); }
    catch (error) {
      this.record({ ...this.operation!, status: "partial", diagnostic: error instanceof Error ? error.message : "Private discovery intent was not confirmed." });
      await this.failed(error); throw error;
    }
    return { id: request.id, keyId: this.keyId };
  }
  async copyAfterClose(): Promise<void> {
    const operation = this.operation;
    if (!operation || !this.options) throw new Error("The exact original relocation intent is missing.");
    const review = operation.review, location = readStateLocation(this.options.locatorDirectory, this.keyId);
    if (!location || location.move.id !== operation.id || location.move.status !== "moving") throw new Error("The original location intent changed before copying. No files were copied.");
    try {
      const parent = await lstat(dirname(review.destination));
      if (!review.destinationIdentity.startsWith(`${parent.dev}:${parent.ino}:`)) throw new Error("The reviewed destination parent changed.");
      try { await mkdir(review.destination, { mode: 0o700 }); } catch (error) { if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error; }
      const target = await lstat(review.destination);
      if (!target.isDirectory() || target.isSymbolicLink() || target.uid !== process.getuid?.() || target.mode & 0o077 || await realpath(review.destination) !== review.destination || (await readdir(review.destination)).length ||
        !review.destinationIdentity.endsWith(":missing") && review.destinationIdentity !== `${parent.dev}:${parent.ino}:${target.dev}:${target.ino}:${target.mode}`) throw new Error("The reviewed destination changed or is no longer empty/private. It was retained.");
      const source = join(review.source, "state.sqlite"), destination = join(review.destination, "state.sqlite");
      try { if ((await lstat(`${source}-wal`)).size) throw new Error("The encrypted database still has an uncheckpointed WAL. No incomplete snapshot was copied."); } catch (error) { if (!missing(error)) throw error; }
      const expected = await stateDatabaseDigest(source), input = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const output = await open(destination, "wx", 0o600);
        try {
          const buffer = Buffer.alloc(64 * 1024); let offset = 0;
          while (true) {
            const read = await input.read(buffer, 0, buffer.length, offset); if (!read.bytesRead) break;
            let written = 0;
            while (written < read.bytesRead) { const result = await output.write(buffer, written, read.bytesRead - written, offset + written); if (!result.bytesWritten) throw new Error("The exact database copy stopped making progress."); written += result.bytesWritten; }
            offset += read.bytesRead;
          }
          await output.sync();
        } finally { await output.close(); }
      } finally { await input.close(); }
      if (await stateDatabaseDigest(source) !== expected || await stateDatabaseDigest(destination) !== expected) throw new Error("Actual copied bytes do not match the closed source. Discovery was not changed.");
      const check = new DatabaseSync(destination, { readOnly: true });
      try { if (check.prepare("SELECT value FROM retention_metadata WHERE id='key_id'").get()?.value !== this.keyId) throw new Error("The copied whole-store identity changed."); } finally { check.close(); }
      const next: StateLocation = { ...location, dataDir: review.destination, move: { ...location.move, status: "published", databaseDigest: expected } };
      await writeStateLocation(this.options.locatorDirectory, next);
      this.operation = { ...operation, status: "published", databaseDigest: expected, diagnostic: null };
    } catch (error) {
      const diagnostic = error instanceof Error ? error.message : "Relocation copy was not confirmed. Original source and target were retained.";
      this.operation = { ...operation, status: "partial", diagnostic };
      await writeStateLocation(this.options.locatorDirectory, { ...location, move: { ...location.move, status: "partial", diagnostic } });
      throw error;
    }
  }
  async failed(error: unknown): Promise<void> {
    if (!this.operation || !this.options) return;
    const location = readStateLocation(this.options.locatorDirectory, this.keyId);
    if (!location || location.move.id !== this.operation.id || location.move.status === "published" || location.move.status === "completed") return;
    const diagnostic = error instanceof Error ? error.message : "Original relocation cleanup or copy was not confirmed. Source and target were retained.";
    this.operation = { ...this.operation, status: "partial", diagnostic };
    await writeStateLocation(this.options.locatorDirectory, { ...location, move: { ...location.move, status: "partial", diagnostic } });
  }
}
