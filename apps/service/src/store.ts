import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import * as vec from "sqlite-vec";
import { eventTypes, isRecord, MoguriError, PROFILE_ID, PROTOCOL_VERSION, type CommandResult, type EventInput, type StoredEvent } from "../../../packages/protocol/src/index.ts";

export const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export const profileIndexId = (profileId: string, id: string) => profileId === PROFILE_ID ? id : `profile/${profileId}/${id}`;
interface Sealed { retention: 1; scope: string; iv: string; tag: string; data: string }
interface Scope { scope: string; projectId: string | null; sessionId: string | null }
export interface ForgetRequest { sessions?: string[]; projects?: string[]; artifacts?: string[] }
function seal(text: string, key: Buffer, scope: string, aad: string): Sealed {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv); cipher.setAAD(Buffer.from(aad));
  const data = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return { retention: 1, scope, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") };
}
function unseal(value: unknown, key: Buffer, aad: string): string {
  if (!isRecord(value) || value.retention !== 1 || typeof value.iv !== "string" || typeof value.tag !== "string" || typeof value.data !== "string") throw new Error("Invalid retention payload. State was preserved.");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(value.iv, "base64"));
    decipher.setAAD(Buffer.from(aad)); decipher.setAuthTag(Buffer.from(value.tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(value.data, "base64")), decipher.final()]).toString("utf8");
  } catch { throw new Error("Retention payload or OS-keychain key is missing/corrupt. Restore the original key and state; do not delete your data."); }
}
function initialKey(path: string): Buffer {
  if (path !== ":memory:") throw new Error("Persistent EventStore requires an explicit retention key. Use the Moguri service/Node SDK to resolve its OS-keychain backend.");
  return randomBytes(32);
}
const artifactIdentity = (input: EventInput): string | null => input.event_type === "candidate.saved" ? input.payload.candidate.id :
  input.event_type === "artifact.saved" || input.event_type === "artifact.revised" ? input.payload.artifact.id :
  input.event_type === "job.started" ? input.payload.job.candidate?.candidateId ?? null :
  input.event_type === "job.progress" || input.event_type === "job.finished" ? input.payload.candidateId ?? null : null;
const artifactScope = (profileId: string, id: string): Scope => ({ scope: `profile/${profileId}/artifact/${encodeURIComponent(id)}`, projectId: null, sessionId: null });
function scopeFor(input: EventInput, artifactId: string | null = null): Scope {
  if (artifactId) return artifactScope(input.profile_id, artifactId);
  const projectId = input.project_id ?? null;
  const sessionId = input.session_id ?? null;
  return { scope: `profile/${input.profile_id}${projectId ? `/project/${projectId}` : ""}${sessionId ? `/session/${sessionId}` : ""}`, projectId, sessionId };
}
function references(input: EventInput): string[] {
  switch (input.event_type) {
    case "queue.enqueued": return input.payload.item.attachments.map((entry) => entry.digest);
    case "session.created": return input.payload.contextDigest ? [input.payload.contextDigest] : [];
    case "turn.started": return [...(input.payload.promptDigest ? [input.payload.promptDigest] : []), ...input.payload.item.attachments.map((entry) => entry.digest)];
    case "turn.prompt_bound": return [input.payload.promptDigest];
    case "turn.control_started": return [input.payload.purpose === "compaction" ? input.payload.promptDigest : input.payload.intentDigest];
    case "plan.save_recorded": return [input.payload.save.inputDigest, input.payload.save.resultDigest].filter((hash): hash is string => hash !== null);
    case "mcp.remote_recorded": return [input.payload.call.intentDigest, input.payload.call.resultDigest].filter((hash): hash is string => hash !== null);
    case "compaction.saved": return [input.payload.compaction.inputDigest, input.payload.compaction.resultDigest, input.payload.compaction.replacementDigest].filter((hash): hash is string => hash !== null);
    case "draft.saved": return input.payload.attachments.map((entry) => entry.digest);
    case "steer.applied": return input.payload.item.attachments.map((entry) => entry.digest);
    case "model.completed": return [input.payload.contextDigest];
    case "capability.saved": return [input.payload.entry.contentDigest];
    case "capability.proposed": return [input.payload.proposal.contentDigest];
    case "artifact.saved": return [input.payload.artifact.contentDigest];
    case "artifact.revised": return [input.payload.artifact.contentDigest];
    case "candidate.saved": return [input.payload.candidate.documentDigest, input.payload.candidate.stageResultDigest, input.payload.candidate.applyResultDigest].filter((hash): hash is string => hash !== null);
    case "configuration.proposed": return [input.payload.proposal.contentDigest, input.payload.proposal.baseDigest];
    case "job.started": return input.payload.job.resultDigest ? [input.payload.job.resultDigest] : [];
    case "job.finished": return input.payload.resultDigest ? [input.payload.resultDigest] : [];
    default: return [];
  }
}
export class EventStore {
  readonly db: DatabaseSync;
  private keys = new Map<string, Buffer>();
  private pending = new Map<string, string>();
  constructor(readonly path: string, private readonly masterKey = initialKey(path), keyId: string = randomUUID(), readonly profileId: string = PROFILE_ID) {
    if (masterKey.byteLength !== 32) throw new Error("A retention master key must contain exactly 32 bytes.");
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(profileId)) throw new Error("A store view needs an explicit safe profile identity. No Default fallback was used.");
    this.db = new DatabaseSync(path, { allowExtension: true });
    try {
      const version = Number(this.db.prepare("PRAGMA user_version").get()?.user_version);
      if (version > PROTOCOL_VERSION) throw new Error("This state uses a newer schema. Upgrade Moguri; do not delete your data.");
      this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA secure_delete=ON");
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
      if (version < 4) this.migrateRetention(keyId);
      if (version < 5) this.db.exec(`BEGIN IMMEDIATE;
        INSERT INTO retention_metadata(id,value) VALUES ('model_controls_schema','1');
        PRAGMA user_version=5; COMMIT;`);
      if (version < 6) this.db.exec(`BEGIN IMMEDIATE;
        INSERT INTO retention_metadata(id,value) VALUES ('engagement_schema','1');
        PRAGMA user_version=6; COMMIT;`);
      if (version < 7) this.db.exec(`BEGIN IMMEDIATE;
        INSERT INTO retention_metadata(id,value) VALUES ('runtime_foundation_schema','1');
        PRAGMA user_version=7; COMMIT;`);
      if (version < 8) this.db.exec(`BEGIN IMMEDIATE;
        INSERT INTO retention_metadata(id,value) VALUES ('execution_transport_schema','1');
        PRAGMA user_version=8; COMMIT;`);
      if (version < 9) this.db.exec(`BEGIN IMMEDIATE;
        INSERT INTO retention_metadata(id,value) VALUES ('managed_workspace_schema','1');
        PRAGMA user_version=9; COMMIT;`);
      const existing = this.db.prepare("SELECT scope,payload FROM retention_keys LIMIT 1").get();
      if (existing) this.key({ scope: String(existing.scope), projectId: null, sessionId: null }, false);
      if (version < 10) this.migrateArtifacts();
      if (version < 11) this.db.exec(`BEGIN IMMEDIATE; INSERT INTO retention_metadata(id,value) VALUES ('structured_question_schema','1'); PRAGMA user_version=11; COMMIT;`);
      if (version < 12) this.db.exec(`BEGIN IMMEDIATE; INSERT INTO retention_metadata(id,value) VALUES ('artifact_repository_schema','1'); PRAGMA user_version=12; COMMIT;`);
      if (version < 13) this.db.exec(`BEGIN IMMEDIATE; INSERT INTO retention_metadata(id,value) VALUES ('budget_ledger_schema','1'); PRAGMA user_version=13; COMMIT;`);
      if (version < 14) this.db.exec(`BEGIN IMMEDIATE;
        CREATE TABLE receipts_v14(profile_id TEXT NOT NULL,id TEXT NOT NULL,digest TEXT NOT NULL,result TEXT NOT NULL,PRIMARY KEY(profile_id,id));
        INSERT INTO receipts_v14 SELECT 'default',id,digest,result FROM receipts;
        DROP TABLE receipts; ALTER TABLE receipts_v14 RENAME TO receipts;
        INSERT INTO retention_metadata(id,value) VALUES ('profile_scope_schema','1');
        PRAGMA user_version=14; COMMIT;`);
      if (version < 15) this.db.exec(`BEGIN IMMEDIATE;
        INSERT INTO retention_metadata(id,value) VALUES ('guided_advice_schema','1');
        PRAGMA user_version=15; COMMIT;`);
      if (version < 16) this.db.exec(`BEGIN IMMEDIATE;
        INSERT INTO retention_metadata(id,value) VALUES ('single_routing_schema','1');
        PRAGMA user_version=16; COMMIT;`);
      if (version < 17) this.db.exec(`BEGIN IMMEDIATE;
        INSERT INTO retention_metadata(id,value) VALUES ('remote_workspace_read_schema','1');
        PRAGMA user_version=17; COMMIT;`);
      if (version < 18) this.db.exec(`BEGIN IMMEDIATE;
        INSERT INTO retention_metadata(id,value) VALUES ('stream_telemetry_schema','1');
        PRAGMA user_version=18; COMMIT;`);
      if (version < 19) this.db.exec(`BEGIN IMMEDIATE;
        INSERT INTO retention_metadata(id,value) VALUES ('context_compaction_schema','1');
        PRAGMA user_version=19; COMMIT;`);
      if (version < 20) this.db.exec(`BEGIN IMMEDIATE;
        INSERT INTO retention_metadata(id,value) VALUES ('remote_plan_save_schema','1');
        PRAGMA user_version=20; COMMIT;`);
      if (version < 21) this.db.exec(`BEGIN IMMEDIATE;
        INSERT INTO retention_metadata(id,value) VALUES ('operation_metrics_schema','1');
        PRAGMA user_version=21; COMMIT;`);
      if (version < 22) this.db.exec(`BEGIN IMMEDIATE;
        INSERT INTO retention_metadata(id,value) VALUES ('repository_attribution_schema','1');
        PRAGMA user_version=22; COMMIT;`);
      if (version < 23) this.db.exec(`BEGIN IMMEDIATE;
        INSERT INTO retention_metadata(id,value) VALUES ('terminal_ownership_schema','1');
        PRAGMA user_version=23; COMMIT;`);
      if (version < 24) this.db.exec(`BEGIN IMMEDIATE;
        INSERT INTO retention_metadata(id,value) VALUES ('remote_mcp_schema','1');
        PRAGMA user_version=24; COMMIT;`);
      if (version < 25) this.db.exec(`BEGIN IMMEDIATE;
        INSERT INTO retention_metadata(id,value) VALUES ('remote_terminal_schema','1');
        PRAGMA user_version=25; COMMIT;`);
      if (version < 26) this.db.exec(`BEGIN IMMEDIATE;
        INSERT INTO retention_metadata(id,value) VALUES ('remote_repository_schema','1');
        PRAGMA user_version=26; COMMIT;`);
      if (version < 27) this.db.exec(`BEGIN IMMEDIATE;
        CREATE TABLE memory_scopes(locator TEXT PRIMARY KEY,scope_id TEXT NOT NULL UNIQUE,profile_id TEXT NOT NULL,project_id TEXT NOT NULL,workspace_id TEXT,metadata TEXT NOT NULL);
        CREATE INDEX memory_scopes_owner ON memory_scopes(profile_id,project_id,workspace_id);
        INSERT INTO retention_metadata(id,value) VALUES ('remote_memory_schema','1');
        PRAGMA user_version=27; COMMIT;`);
      if (version < 28) this.db.exec(`BEGIN IMMEDIATE;
        INSERT INTO retention_metadata(id,value) VALUES ('candidate_workflow_schema','1');
        PRAGMA user_version=28; COMMIT;`);
    } catch (error) { this.db.close(); throw error; }
  }
  private key(scope: Scope, create: boolean): Buffer | null {
    const cached = this.keys.get(scope.scope);
    if (cached) return cached;
    const row = this.db.prepare("SELECT payload FROM retention_keys WHERE scope=?").get(scope.scope);
    if (row) {
      const key = Buffer.from(unseal(JSON.parse(String(row.payload)), this.masterKey, `key:${scope.scope}`), "base64");
      if (key.byteLength !== 32) throw new Error("Invalid retained scope key. State was preserved.");
      this.keys.set(scope.scope, key); return key;
    }
    if (this.db.prepare("SELECT scope FROM retention_forgotten WHERE scope=?").get(scope.scope)) {
      if (create) throw new MoguriError("deleted_scope", "This session/project was deleted. No late work was resurrected.", 409);
      return null;
    }
    if (!create) throw new Error("A retained payload key is missing without a deletion record. State was preserved.");
    const key = randomBytes(32);
    this.db.prepare("INSERT INTO retention_keys VALUES (?,?,?,?)").run(scope.scope, scope.projectId, scope.sessionId, JSON.stringify(seal(key.toString("base64"), this.masterKey, scope.scope, `key:${scope.scope}`)));
    this.keys.set(scope.scope, key); return key;
  }
  private bind(hash: string, scope: Scope, legacy?: Map<string, string>): void {
    if (this.db.prepare("SELECT digest FROM blob_payloads WHERE digest=? AND scope=?").get(hash, scope.scope)) return;
    const content = legacy?.get(hash) ?? this.pending.get(hash) ?? this.blob(hash);
    if (digest(content) !== hash) throw new Error(`Corrupt content snapshot ${hash}.`);
    this.db.prepare("INSERT INTO blob_payloads VALUES (?,?,?)").run(hash, scope.scope, JSON.stringify(seal(content, this.key(scope, true)!, scope.scope, `blob:${hash}:${scope.scope}`)));
  }
  private migrateRetention(keyId: string): void {
    const rows = this.db.prepare("SELECT seq,id,data FROM events ORDER BY seq").all();
    const blobs = new Map(this.db.prepare("SELECT digest,content FROM blobs").all().map((row) => [String(row.digest), String(row.content)]));
    this.db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE retention_metadata(id TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE retention_keys(scope TEXT PRIMARY KEY,project_id TEXT,session_id TEXT,payload TEXT NOT NULL);
      CREATE TABLE retention_forgotten(scope TEXT PRIMARY KEY,forgotten_at TEXT NOT NULL);
      CREATE TABLE blob_payloads(digest TEXT NOT NULL,scope TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(digest,scope));
      CREATE TABLE events_v4(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,data TEXT NOT NULL,payload TEXT NOT NULL);`);
    try {
      this.db.prepare("INSERT INTO retention_metadata VALUES ('key_id',?)").run(keyId);
      for (const row of rows) {
        const raw: unknown = JSON.parse(String(row.data));
        const event = this.validEvent(raw, Number(row.seq));
        const scope = scopeFor(event);
        for (const hash of references(event)) this.bind(hash, scope, blobs);
        const payload = seal(JSON.stringify(event.payload), this.key(scope, true)!, scope.scope, `event:${event.id}`);
        this.db.prepare("INSERT INTO events_v4(seq,id,data,payload) VALUES (?,?,?,?)").run(event.seq, event.id, JSON.stringify({ ...raw as Record<string, unknown>, payload }), JSON.stringify(payload));
      }
      this.db.exec(`DROP TABLE events; ALTER TABLE events_v4 RENAME TO events;
        CREATE TRIGGER events_no_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT,'events are append-only'); END;
        CREATE TRIGGER events_no_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT,'events are append-only'); END;
        DROP TABLE blobs; PRAGMA user_version=4; COMMIT;`);
      this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    } catch (error) { if (this.db.isTransaction) this.db.exec("ROLLBACK"); this.keys.clear(); throw error; }
  }
  private migrateArtifacts(): void {
    const rows = this.db.prepare("SELECT seq,id,data,payload FROM events ORDER BY seq").all();
    const live: Array<{ event: StoredEvent; scope: Scope }> = [];
    for (const row of rows) {
      const event = this.validEvent(JSON.parse(String(row.data)), Number(row.seq));
      const encrypted: unknown = event.payload, normal = scopeFor(event, event.artifact_id ?? null), legacy = scopeFor(event);
      if (!isRecord(encrypted) || encrypted.scope !== normal.scope && encrypted.scope !== legacy.scope) throw new Error("Retained event scope is corrupt. State was preserved.");
      const scope = encrypted.scope === normal.scope ? normal : legacy, key = this.key(scope, false);
      if (key) live.push({ event: this.validEvent({ ...event, payload: JSON.parse(unseal(encrypted, key, `event:${event.id}`)) }, event.seq), scope });
    }
    const needed = new Set(live.flatMap(({ event }) => references(event).map((hash) => JSON.stringify([scopeFor(event, artifactIdentity(event)).scope, hash]))));
    const byId = new Map(live.map((entry) => [entry.event.id, entry]));
    this.db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE events_v10(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,data TEXT NOT NULL,payload TEXT NOT NULL);`);
    try {
      for (const row of rows) {
        const entry = byId.get(String(row.id)), id = entry ? artifactIdentity(entry.event) : null;
        if (!entry || !id) {
          this.db.prepare("INSERT INTO events_v10 VALUES (?,?,?,?)").run(Number(row.seq), String(row.id), String(row.data), String(row.payload));
          continue;
        }
        const scope = scopeFor(entry.event, id);
        for (const hash of references(entry.event)) {
          this.bind(hash, scope);
          if (entry.scope.scope !== scope.scope && !needed.has(JSON.stringify([entry.scope.scope, hash]))) this.db.prepare("DELETE FROM blob_payloads WHERE digest=? AND scope=?").run(hash, entry.scope.scope);
        }
        const payload = seal(JSON.stringify(entry.event.payload), this.key(scope, true)!, scope.scope, `event:${entry.event.id}`);
        const { seq: _seq, ...data } = entry.event;
        this.db.prepare("INSERT INTO events_v10 VALUES (?,?,?,?)").run(entry.event.seq, entry.event.id, JSON.stringify({ ...data, artifact_id: id, payload }), JSON.stringify(payload));
      }
      this.db.exec(`DROP TABLE events; ALTER TABLE events_v10 RENAME TO events;
        CREATE TRIGGER events_no_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT,'events are append-only'); END;
        CREATE TRIGGER events_no_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT,'events are append-only'); END;
        INSERT INTO retention_metadata(id,value) VALUES ('retained_artifact_schema','1');
        PRAGMA user_version=10; COMMIT;`);
      this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    } catch (error) { if (this.db.isTransaction) this.db.exec("ROLLBACK"); this.keys.clear(); throw error; }
  }
  receipt(id: string, expectedDigest: string): CommandResult | undefined {
    const row = this.db.prepare("SELECT digest,result FROM receipts WHERE profile_id=? AND id=?").get(this.profileId, id);
    if (!row) return undefined;
    if (row.digest !== expectedDigest) throw new MoguriError("idempotency_conflict", "A command ID was reused with different arguments.", 409);
    return JSON.parse(String(row.result)) as CommandResult;
  }
  view(profileId: string): EventStore {
    const id = this.db.prepare("SELECT value FROM retention_metadata WHERE id='key_id'").get()?.value;
    if (typeof id !== "string") throw new Error("The root retention identity is missing. Preserve state; no replacement profile key was invented.");
    return new EventStore(this.path, this.masterKey, id, profileId);
  }
  commit(inputs: EventInput[], receipt?: { id: string; digest: string; result: CommandResult }, forget?: ForgetRequest, derive?: (events: StoredEvent[]) => EventInput[]): StoredEvent[] {
    const events: StoredEvent[] = [];
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const append = (input: EventInput) => {
        const data = {
          project_id: null, session_id: null, turn_id: null, step_id: null, correlation_id: null,
          ...input, id: randomUUID(), schema_version: 1, timestamp: new Date().toISOString(), work_item_id: null, parent_event_id: null, artifact_id: artifactIdentity(input),
        };
        const scope = scopeFor(input, data.artifact_id);
        for (const hash of references(input)) this.bind(hash, scope);
        const payload = seal(JSON.stringify(input.payload), this.key(scope, true)!, scope.scope, `event:${data.id}`);
        const row = this.db.prepare("INSERT INTO events (id,data,payload) VALUES (?,?,?)").run(data.id, JSON.stringify({ ...data, payload }), JSON.stringify(payload));
        events.push({ ...data, seq: Number(row.lastInsertRowid) } as StoredEvent);
      };
      for (const input of inputs) append(input);
      const derived = derive?.(events) ?? [];
      for (const input of derived) append(input);
      if (receipt) this.db.prepare("INSERT INTO receipts VALUES (?,?,?,?)").run(this.profileId, receipt.id, receipt.digest, JSON.stringify(receipt.result));
      for (const input of inputs) if (input.event_type === "project.relocated" && input.project_id) this.clearProjectIndex(input.project_id);
      for (const input of inputs) if (input.event_type === "workspace.saved" && input.payload.workspace.status === "removed") this.clearProjectIndex(input.payload.workspace.id);
      if (forget) this.forget(forget);
      this.db.exec("COMMIT");
      for (const input of [...inputs, ...derived]) for (const hash of references(input)) this.pending.delete(hash);
      if (forget) { this.keys.clear(); this.pending.clear(); this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); }
      return events;
    } catch (error) { if (this.db.isTransaction) this.db.exec("ROLLBACK"); this.keys.clear(); throw error; }
  }
  private validEvent(event: unknown, seq: number): StoredEvent {
    if (!isRecord(event) || event.schema_version !== 1 || typeof event.event_type !== "string" ||
      !eventTypes.includes(event.event_type as EventInput["event_type"]) || !isRecord(event.payload) ||
      typeof event.id !== "string" || typeof event.timestamp !== "string" || typeof event.profile_id !== "string") {
      throw new Error(`Unsupported or corrupt durable event at sequence ${seq}. State was preserved.`);
    }
    return { ...event, seq } as StoredEvent;
  }
  events(after = 0): StoredEvent[] {
    return this.db.prepare("SELECT seq,data FROM events WHERE seq>? ORDER BY seq").all(after).flatMap((row) => {
      const event: unknown = JSON.parse(String(row.data));
      const data = this.validEvent(event, Number(row.seq));
      if (data.profile_id !== this.profileId) return [];
      const scope = scopeFor(data, data.artifact_id ?? null);
      const key = this.key(scope, false);
      if (!key) return [];
      const decoded = this.validEvent({ ...data, payload: JSON.parse(unseal(data.payload, key, `event:${data.id}`)) }, Number(row.seq));
      if (artifactIdentity(decoded) !== (data.artifact_id ?? null)) throw new Error("Artifact retention identity is corrupt. State was preserved.");
      return [decoded];
    });
  }
  putBlob(content: string): string {
    const hash = digest(content);
    this.pending.set(hash, content);
    if ([...this.pending.values()].reduce((bytes, text) => bytes + Buffer.byteLength(text), 0) > 64 * 1024 * 1024) { this.pending.delete(hash); throw new MoguriError("blob_limit", "Uncommitted content exceeded its 64 MiB bound."); }
    return hash;
  }
  blob(hash: string): string {
    const pending = this.pending.get(hash);
    if (pending !== undefined) return pending;
    for (const row of this.db.prepare("SELECT scope,payload FROM blob_payloads WHERE digest=? AND (scope=? OR scope GLOB ?)").all(hash, `profile/${this.profileId}`, `profile/${this.profileId}/*`)) {
      const key = this.key({ scope: String(row.scope), projectId: null, sessionId: null }, false);
      if (!key) continue;
      const text = unseal(JSON.parse(String(row.payload)), key, `blob:${hash}:${row.scope}`);
      if (digest(text) !== hash) throw new Error(`Corrupt content snapshot ${hash}.`);
      return text;
    }
    throw new Error(`Missing or deleted content snapshot ${hash}.`);
  }
  private forget(request: ForgetRequest): void {
    const scopes = new Set<string>();
    for (const id of request.sessions ?? []) for (const row of this.db.prepare("SELECT scope FROM retention_keys WHERE session_id=? AND scope GLOB ?").all(id, `profile/${this.profileId}/*`)) scopes.add(String(row.scope));
    for (const id of request.projects ?? []) {
      for (const row of this.db.prepare("SELECT scope FROM retention_keys WHERE project_id=? AND scope GLOB ?").all(id, `profile/${this.profileId}/*`)) scopes.add(String(row.scope));
      this.clearProjectIndex(id);
    }
    for (const id of request.artifacts ?? []) scopes.add(artifactScope(this.profileId, id).scope);
    for (const scope of scopes) {
      this.db.prepare("INSERT OR REPLACE INTO retention_forgotten VALUES (?,?)").run(scope, new Date().toISOString());
      this.db.prepare("DELETE FROM blob_payloads WHERE scope=?").run(scope);
      this.db.prepare("DELETE FROM retention_keys WHERE scope=?").run(scope);
    }
  }
  private clearProjectIndex(id: string): void {
    const scoped = this.db.prepare("SELECT locator,scope_id FROM memory_scopes WHERE profile_id=? AND (project_id=? OR workspace_id=?)").all(this.profileId, id, id);
    const ids = new Set([profileIndexId(this.profileId, id), ...scoped.map((row) => String(row.scope_id))]);
    const vectors = this.db.prepare("SELECT name FROM sqlite_master WHERE name='memory_vectors'").get();
    if (vectors) vec.load(this.db);
    for (const scope of ids) {
      if (vectors) this.db.prepare("DELETE FROM memory_vectors WHERE project_id=?").run(scope);
      for (const table of ["memory_files", "memory_chunks", "memory_graph_nodes", "memory_graph_edges"]) this.db.prepare(`DELETE FROM ${table} WHERE project_id=?`).run(scope);
    }
    this.db.prepare("DELETE FROM memory_scopes WHERE profile_id=? AND (project_id=? OR workspace_id=?)").run(this.profileId, id, id);
  }
  close(): void { this.keys.clear(); this.pending.clear(); this.db.close(); }
}
