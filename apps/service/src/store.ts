import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { eventTypes, isRecord, MoguriError, type CommandResult, type EventInput, type StoredEvent } from "../../../packages/protocol/src/index.ts";

export const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export class EventStore {
  readonly db: DatabaseSync;
  constructor(readonly path: string) {
    this.db = new DatabaseSync(path, { allowExtension: true });
    try {
      const version = Number(this.db.prepare("PRAGMA user_version").get()?.user_version);
      if (version > 3) throw new Error("This state uses a newer schema. Upgrade Moguri; do not delete your data.");
      this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON");
      if (version === 0) this.db.exec(`
        BEGIN IMMEDIATE;
        CREATE TABLE events (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, data TEXT NOT NULL, payload TEXT NOT NULL);
        CREATE TABLE receipts (id TEXT PRIMARY KEY, digest TEXT NOT NULL, result TEXT NOT NULL);
        CREATE TABLE blobs (digest TEXT PRIMARY KEY, content TEXT NOT NULL);
        CREATE TRIGGER events_no_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT, 'events are append-only'); END;
        CREATE TRIGGER events_no_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT, 'events are append-only'); END;
        PRAGMA user_version=1;
        COMMIT;
      `);
      if (version < 2) this.db.exec(`
        BEGIN IMMEDIATE;
        CREATE TABLE memory_files (project_id TEXT NOT NULL,path TEXT NOT NULL,digest TEXT NOT NULL,mtime REAL NOT NULL,size INTEGER NOT NULL,PRIMARY KEY(project_id,path));
        CREATE TABLE memory_chunks (id INTEGER PRIMARY KEY AUTOINCREMENT,project_id TEXT NOT NULL,path TEXT NOT NULL,digest TEXT NOT NULL,text TEXT NOT NULL);
        CREATE INDEX memory_chunks_scope ON memory_chunks(project_id,path);
        CREATE TABLE memory_graph_nodes (project_id TEXT NOT NULL,id TEXT NOT NULL,path TEXT NOT NULL,label TEXT NOT NULL,kind TEXT NOT NULL,PRIMARY KEY(project_id,id));
        CREATE TABLE memory_graph_edges (project_id TEXT NOT NULL,source TEXT NOT NULL,target TEXT NOT NULL,kind TEXT NOT NULL,PRIMARY KEY(project_id,source,target,kind));
        PRAGMA user_version=2;
        COMMIT;
      `);
      if (version < 3) this.db.exec(`
        BEGIN IMMEDIATE;
        CREATE TABLE dependency_cache_objects (cache_key TEXT PRIMARY KEY,integrity TEXT NOT NULL,bytes INTEGER NOT NULL,verified_at TEXT NOT NULL);
        PRAGMA user_version=3;
        COMMIT;
      `);
    } catch (error) { this.db.close(); throw error; }
  }
  receipt(id: string, expectedDigest: string): CommandResult | undefined {
    const row = this.db.prepare("SELECT digest,result FROM receipts WHERE id=?").get(id);
    if (!row) return undefined;
    if (row.digest !== expectedDigest) throw new MoguriError("idempotency_conflict", "A command ID was reused with different arguments.", 409);
    return JSON.parse(String(row.result)) as CommandResult;
  }
  commit(inputs: EventInput[], receipt?: { id: string; digest: string; result: CommandResult }): StoredEvent[] {
    const events: StoredEvent[] = [];
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const input of inputs) {
        const data = {
          project_id: null, session_id: null, turn_id: null, step_id: null, correlation_id: null,
          ...input, id: randomUUID(), schema_version: 1, timestamp: new Date().toISOString(), work_item_id: null, parent_event_id: null,
        };
        const row = this.db.prepare("INSERT INTO events (id,data,payload) VALUES (?,?,?)").run(data.id, JSON.stringify(data), JSON.stringify(input.payload));
        events.push({ ...data, seq: Number(row.lastInsertRowid) } as StoredEvent);
      }
      if (receipt) this.db.prepare("INSERT INTO receipts VALUES (?,?,?)").run(receipt.id, receipt.digest, JSON.stringify(receipt.result));
      this.db.exec("COMMIT");
      return events;
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  events(after = 0): StoredEvent[] {
    return this.db.prepare("SELECT seq,data FROM events WHERE seq>? ORDER BY seq").all(after).map((row) => {
      const event: unknown = JSON.parse(String(row.data));
      if (!isRecord(event) || event.schema_version !== 1 || typeof event.event_type !== "string" ||
        !eventTypes.includes(event.event_type as EventInput["event_type"]) || !isRecord(event.payload) ||
        typeof event.id !== "string" || typeof event.timestamp !== "string" || typeof event.profile_id !== "string") {
        throw new Error(`Unsupported or corrupt durable event at sequence ${row.seq}. State was preserved.`);
      }
      return { ...event, seq: Number(row.seq) } as StoredEvent;
    });
  }
  putBlob(content: string): string {
    const hash = digest(content);
    this.db.prepare("INSERT OR IGNORE INTO blobs VALUES (?,?)").run(hash, content);
    return hash;
  }
  blob(hash: string): string {
    const row = this.db.prepare("SELECT content FROM blobs WHERE digest=?").get(hash);
    if (!row || digest(String(row.content)) !== hash) throw new Error(`Missing or corrupt content snapshot ${hash}.`);
    return String(row.content);
  }
  close(): void { this.db.close(); }
}
