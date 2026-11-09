import { createHash, createPublicKey, randomUUID, verify } from "node:crypto";
import { readdirSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
  COMPLETE_SOURCE_ENVELOPE_BYTES, isRecord, MoguriError, skillSignaturePayload, type EventInput, type Session, type SkillAdmission,
  type SkillAdmissionCommand, type SkillAdmissionQuery, type SkillAdmissionResponse, type SkillConsumption, type SkillInspection,
  type Snapshot, type StoredEvent, type ToolCall,
} from "../../../packages/protocol/src/index.ts";
import { digest, type EventStore } from "./store.ts";
import { sourceRootSync, type SourceRoot } from "./repository-source.ts";
import { skillMetadata } from "./skill-metadata.ts";
import { isPrivateContextPath, isProtectedProjectPath, readRegularFileSync, scopedPathSync } from "./files.ts";
import type { SkillGateway } from "./skill-gateway.ts";
import type { WorkspaceFinish } from "./session-workspace.ts";

const warning = "Admission is scoped, expiring actual-user source review, never a permission or safety guarantee. Publisher labels/hashes are not identity. Revocation blocks future consumption/effects, not already delivered instructions or already-running external work.";
const readTools = new Set(["discover_tools", "use_skill", "read_file", "list_files", "search_files", "find_files", "read_tool_result", "read_document", "search_document", "list_documents"]);
const writeTools = new Set(["write_file", "apply_patch"]);
interface Host {
  snapshot(): Snapshot; events(): StoredEvent[]; commit(events: EventInput[]): void;
  root(session: Session): SourceRoot; policy(session: Session): unknown;
}
export class SkillAdmissions {
  constructor(private readonly store: EventStore, private readonly gateway: SkillGateway, private readonly host: Host) {}
  private session(id: string) {
    const session = this.host.snapshot().sessions.find((session) => session.id === id);
    if (!session) throw new MoguriError("skill_scope", "The source owner is outside this actual profile.", 404);
    return session;
  }
  private scope(session: Session) {
    const snapshot = this.host.snapshot();
    if (session.controls.env !== "Local" || !snapshot.policy.allowedEnvs.includes("Local")) throw new MoguriError("skill_transport", "Local skill admission cannot authorize another Env or fall back to a controller root.", 403);
    const root = this.host.root(session);
    return { root, policyDigest: digest(JSON.stringify([this.store.retentionIdentity(), snapshot.profileId, session.id, session.projectId, session.workspaceId,
      session.mode, session.pendingMode, snapshot.policy, snapshot.settings.permissionRevision, this.host.policy(session)])) };
  }
  private revocationEpoch(sessionId: string, skillId: string) {
    return digest(JSON.stringify(this.host.snapshot().skillAdmissions.filter((grant) => grant.sessionId === sessionId && grant.skillId === skillId &&
      grant.state === "revoked").map((grant) => [grant.id, grant.revision])));
  }
  async inspect(sessionId: string, skillId: string, expectedDigest: string, signal?: AbortSignal): Promise<SkillInspection> {
    const session = this.session(sessionId), scope = this.scope(session), captured = await this.gateway.inspect(sessionId, skillId, expectedDigest, signal);
    const metadata = skillMetadata(captured.body);
    for (const file of captured.files) if (file.path.endsWith("/SKILL.md") || file.path === "SKILL.md") skillMetadata(file.text);
    captured.origin.version = metadata.version;
    for (const dependency of metadata.dependencies) {
      const path = join(dirname(captured.mainPath), dependency.path);
      if (!captured.files.some((file) => file.path === path && file.digest === dependency.digest)) throw new MoguriError("skill_dependencies", `Required dependency ${dependency.path} is missing, protected, outside the package or changed. Complete-review admission is blocked.`, 409);
    }
    const externalReferences = [...new Set(captured.files.flatMap((file) => file.text.match(/https?:\/\/[^\s<>"'`)\]}]+/g) ?? []))];
    if (externalReferences.length > 128) throw new MoguriError("skill_inspection_limit", "The source has more than 128 external references. Narrow the source; no reference inventory was truncated.", 413);
    const value = { version: 1 as const, skillId, name: captured.skill.name, contentDigest: expectedDigest, profileId: this.store.profileId,
      sessionId, ...scope, origin: captured.origin, access: metadata.access, revocationEpoch: this.revocationEpoch(sessionId, skillId), files: captured.files, externalReferences,
      excluded: captured.excluded, complete: true, diagnostics: [
        "Complete supported static package, not semantic malware analysis or a claim that dynamic/transitive downloads were inspected.",
        "External references are disclosed but not fetched. Local skill context cannot run commands, scripts, installers, network or credential tools.",
        "Protected credential/control/Git paths are excluded and can never be declared dependencies.",
      ] };
    if (JSON.stringify(this.scope(this.session(sessionId))) !== JSON.stringify(scope)) throw new MoguriError("skill_source_changed", "The exact review root or policy changed during capture.", 409);
    const inspection = { ...value, digest: digest(JSON.stringify(value)) };
    if (Buffer.byteLength(JSON.stringify(inspection)) > COMPLETE_SOURCE_ENVELOPE_BYTES) throw new MoguriError("skill_inspection_limit", "The complete escaped source and provenance exceed the 2 MiB transport envelope. Nothing was truncated.", 413);
    return inspection;
  }
  async query(query: SkillAdmissionQuery, signal?: AbortSignal): Promise<SkillAdmissionResponse> {
    this.session(query.sessionId);
    if (query.type === "skill.inspect") return { type: query.type, inspection: await this.inspect(query.sessionId, query.skillId, query.expectedDigest, signal) };
    if (query.type === "skill.consume") {
      const loaded = await this.load(this.session(query.sessionId), query.skillId, query.expectedDigest, "model", signal);
      signal?.throwIfAborted(); this.assertContext(this.session(query.sessionId), [loaded.consumption]); this.host.commit([loaded.event]);
      return { type: query.type, body: loaded.body, provenance: loaded.consumption, complete: true, authority: loaded.warning };
    }
    return { type: query.type, admissions: this.host.snapshot().skillAdmissions.filter((grant) => grant.sessionId === query.sessionId), warning };
  }
  async execute(command: SkillAdmissionCommand, finish: WorkspaceFinish) {
    const session = this.session(command.sessionId);
    if (command.type === "skill.revoke") {
      const grant = this.host.snapshot().skillAdmissions.find((grant) => grant.id === command.admissionId && grant.sessionId === session.id);
      if (!grant || grant.revision !== command.expectedRevision || grant.state !== "active") throw new MoguriError("skill_admission_stale", "This exact grant changed or was already revoked. No source was reactivated.", 409);
      return finish([this.event({ ...grant, revision: grant.revision + 1, state: "revoked", revokedAt: new Date().toISOString(), reason: command.reason })], { id: grant.id, revision: grant.revision + 1 });
    }
    if (session.turnId) throw new MoguriError("skill_admission_busy", "Finish or stop the actual turn before admitting a new source. Revocation remains available during work.", 409);
    if (!finish.intent) throw new MoguriError("skill_admission_owner", "Admission requires the original actual-user command identity.", 409);
    const inspection = await this.inspect(session.id, command.skillId, command.expectedDigest);
    if (inspection.digest !== command.expectedInspectionDigest) throw new MoguriError("skill_admission_stale", "The complete source, dependencies, root or current policy changed. Review the fresh exact inspection.", 409);
    if (inspection.access === "read-only" && command.access !== "read-only" || command.paths.some((path) => isAbsolute(path) || /[*?\\\0]/.test(path) ||
      path !== "." && path.split("/").some((part) => !part || part === "." || part === "..") || isProtectedProjectPath(path))) {
      throw new MoguriError("skill_privilege", "Choose literal unprotected paths inside the exact root, with no broader access than the supported declaration. Skill metadata never grants authority.", 403);
    }
    let keyFingerprint: string | null = null;
    if (command.publisher.kind === "unverified-local") {
      if (inspection.origin.kind === "archive") throw new MoguriError("skill_publisher_required", "Archive sources require a separately user-pinned publisher key and a valid exact-artifact signature. A repository label/hash is not publisher identity.", 403);
    } else {
      let verified = false;
      try {
        const key = createPublicKey(command.publisher.publicKey);
        if (key.asymmetricKeyType === "ed25519") {
          keyFingerprint = createHash("sha256").update(key.export({ type: "spki", format: "der" })).digest("hex");
          verified = verify(null, Buffer.from(skillSignaturePayload(inspection.origin)), key, Buffer.from(command.publisher.signature, "base64"));
        }
      } catch (error) {
        if (!(error instanceof Error)) throw error;
        throw new MoguriError("skill_publisher", "The user-pinned Ed25519 key/signature is malformed. No alternate trust or unsigned fallback was accepted.", 403);
      }
      if (!verified) throw new MoguriError("skill_publisher", "The exact version/artifact/dependency signature does not match the user-pinned Ed25519 identity.", 403);
    }
    const now = new Date(), grant: SkillAdmission = { version: 1, id: randomUUID(), revision: 0, profileId: this.store.profileId, sessionId: session.id,
      skillId: inspection.skillId, name: inspection.name, contentDigest: inspection.contentDigest, snapshotDigest: this.store.putBlob(JSON.stringify(inspection)),
      inspectionDigest: inspection.digest, root: inspection.root, policyDigest: inspection.policyDigest, origin: inspection.origin,
      publisher: command.publisher, keyFingerprint, access: command.access, paths: command.paths, actor: "user", commandId: finish.intent.id,
      createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + command.validHours * 3600000).toISOString(), state: "active", revokedAt: null, reason: null };
    if (this.session(session.id).turnId) throw new MoguriError("skill_admission_busy", "A turn started during source review. No late admission was saved.", 409);
    this.assertGrant(this.session(session.id), grant);
    return finish([this.event(grant)], { id: grant.id, revision: 0 });
  }
  private event(admission: SkillAdmission): EventInput {
    const session = this.session(admission.sessionId);
    return { event_type: "skill.admission_recorded", profile_id: this.store.profileId, project_id: session.projectId, session_id: session.id, payload: { admission } };
  }
  private assertGrant(session: Session, grant: SkillAdmission) {
    const scope = this.scope(session), snapshot = this.host.snapshot();
    if (grant.state !== "active" || Date.parse(grant.expiresAt) <= Date.now() || grant.sessionId !== session.id ||
      grant.profileId !== snapshot.profileId || grant.policyDigest !== scope.policyDigest || JSON.stringify(grant.root) !== JSON.stringify(scope.root)) {
      throw new MoguriError("skill_revoked", "A consumed source is revoked, expired or has stale root/policy evidence. Future model consumption/effects are blocked; already delivered instructions cannot be retracted.", 403);
    }
    if (grant.origin.sourceId) {
      const source = snapshot.settings.values.skillSources?.find((source) => source.id === grant.origin.sourceId && source.enabled);
      if (!source || source.kind === "local" !== (grant.origin.kind === "local")) throw new MoguriError("skill_revoked", "The consumed source is disabled, removed or has changed transport.", 403);
      if (!grant.origin.configurationDigest || digest(JSON.stringify(source)) !== grant.origin.configurationDigest) throw new MoguriError("skill_source_changed", "The exact reviewed source configuration changed or lacks its original binding. Fresh review is required; no acceptance followed a replacement path or archive URL.", 409);
      if (source.kind === "local") {
        if (!grant.origin.root || JSON.stringify(sourceRootSync(realpathSync(source.path))) !== JSON.stringify(grant.origin.root)) throw new MoguriError("skill_source_changed", "The admitted Local source directory identity changed.", 409);
        const sourceRoot = grant.origin.root.root, names: string[] = [];
        let entries = 0;
        const walk = (directory: string, depth: number) => {
          if (depth > 16) throw new MoguriError("skill_source_changed", "The source inventory changed beyond its reviewed depth.", 409);
          for (const entry of readdirSync(join(sourceRoot, directory), { withFileTypes: true })) {
            if (++entries > 10000) throw new MoguriError("skill_source_changed", "The source inventory changed beyond its reviewed entry bound.", 409);
            const path = relative(sourceRoot, join(sourceRoot, directory, entry.name));
            if (isProtectedProjectPath(path)) continue;
            if (entry.isSymbolicLink() || !entry.isDirectory() && !entry.isFile()) throw new MoguriError("skill_source_changed", "The source inventory gained an unsupported link/special file.", 409);
            if (entry.isDirectory()) walk(path, depth + 1); else names.push(path);
          }
        };
        walk(dirname(grant.origin.entryPath), 0);
        if (JSON.stringify(names.sort()) !== JSON.stringify(grant.origin.files.map((file) => file.path).sort())) throw new MoguriError("skill_source_changed", "The complete transitive source inventory changed. Fresh review is required.", 409);
        for (const file of grant.origin.files) {
          const bytes = readRegularFileSync(scopedPathSync(sourceRoot, file.path), file.bytes);
          if (bytes.length !== file.bytes || createHash("sha256").update(bytes).digest("hex") !== file.digest) throw new MoguriError("skill_source_changed", "An admitted skill/dependency changed. Fresh complete review is required; no old acceptance was inherited.", 409);
        }
      }
    } else {
      const entry = snapshot.registry.find((entry) => entry.id === grant.skillId && entry.enabled && !entry.retired);
      const plugin = entry?.ownerPluginId ? snapshot.registry.find((plugin) => plugin.id === entry.ownerPluginId && plugin.enabled && !plugin.retired) : null;
      if (!entry || entry.contentDigest !== grant.contentDigest || entry.ownerPluginId && !plugin ||
        digest(JSON.stringify([entry, plugin])) !== grant.origin.identityDigest) throw new MoguriError("skill_revoked", "The admitted registry version/bundle is disabled, changed or revoked. Review its exact current source.", 403);
    }
    const source = this.store.blob(grant.snapshotDigest);
    if (digest(source) !== grant.snapshotDigest) throw new MoguriError("skill_source_missing", "The original retained source grant is unavailable. No replacement was loaded.", 409);
    const inspection: unknown = JSON.parse(source);
    if (!isRecord(inspection) || inspection.revocationEpoch !== this.revocationEpoch(session.id, grant.skillId)) throw new MoguriError("skill_revoked", "A later source revocation invalidated this old inspection. Obtain fresh exact-source review; no old acceptance was inherited.", 403);
  }
  consumptions(sessionId: string): SkillConsumption[] {
    const events = this.host.events().filter((event) => event.profile_id === this.store.profileId);
    const memo = new Map<string, SkillConsumption[]>();
    const collect = (id: string, through: number, depth: number): SkillConsumption[] => {
      if (depth > 64) throw new MoguriError("skill_lineage_limit", "Complete inherited skill provenance exceeds 64 parent boundaries. No omitted source was treated as admitted.", 409);
      const key = `${id}/${through}`, known = memo.get(key);
      if (known) return known;
      const references = new Map<string, SkillConsumption>();
      const add = (reference: SkillConsumption) => references.set(`${reference.admissionId}/${reference.snapshotDigest}`, reference);
      for (const [index, event] of events.entries()) if (event.seq <= through && event.session_id === id) {
        if (event.event_type === "session.created" && event.payload.contextDigest && event.payload.parentSessionId) {
          for (const reference of collect(event.payload.parentSessionId, event.seq - 1, depth + 1)) add(reference);
        } else if (event.event_type === "turn.started" && event.payload.sideContext) {
          const capture = event.payload.sideContext;
          for (const reference of collect(capture.parentSessionId, capture.throughSeq, depth + 1)) add(reference);
        } else if (event.event_type === "session.rewound") {
          references.clear(); for (const reference of event.payload.skillConsumptions) add(reference);
        } else if (event.event_type === "skill.consumed") add(event.payload);
        else if (event.event_type === "skill.used") {
          const following = events[index + 1];
          if (following && following.seq <= through && following.event_type === "skill.consumed" && following.session_id === id &&
            following.payload.skillId === event.payload.capabilityId) continue;
          add({ admissionId: `unadmitted-${event.id}`, snapshotDigest: event.payload.contentDigest,
            skillId: event.payload.capabilityId, contentDigest: event.payload.contentDigest, actor: "user" });
        } else if (event.event_type === "tool.completed" && event.payload.call.name === "use_skill" &&
          event.payload.outcome === "completed" && !event.payload.isError) {
          const skillId = String(event.payload.call.arguments.id), contentDigest = String(event.payload.call.arguments.expectedDigest);
          if (![...references.values()].some((reference) => reference.skillId === skillId && reference.contentDigest === contentDigest)) {
            add({ admissionId: `unadmitted-${event.id}`, snapshotDigest: event.payload.rawDigest ?? digest(event.payload.text),
              skillId, contentDigest: /^[a-f0-9]{64}$/.test(contentDigest) ? contentDigest : digest(event.payload.text), actor: "model" });
          }
        }
      }
      const result = [...references.values()]; memo.set(key, result); return result;
    };
    return collect(sessionId, Number.MAX_SAFE_INTEGER, 0);
  }
  assertContext(session: Session, references = this.consumptions(session.id)) {
    for (const reference of references) {
      const grant = this.host.snapshot().skillAdmissions.find((grant) => grant.id === reference.admissionId && grant.snapshotDigest === reference.snapshotDigest);
      if (!grant) throw new MoguriError("skill_revoked", reference.admissionId.startsWith("unadmitted-") ?
        "A historical skill use has no provable actual-user source admission. Fresh scoped review and a clean conversation branch are required; retained text is not authority." :
        "An original source grant was deleted or is unavailable. Retained history does not create fresh authority.", 403);
      this.assertGrant(grant.sessionId === session.id ? session : this.session(grant.sessionId), grant);
      if (grant.sessionId !== session.id && JSON.stringify(this.scope(session).root) !== JSON.stringify(grant.root)) {
        throw new MoguriError("skill_scope", "Inherited source provenance belongs to another actual profile/root/Env. Sharing context cannot transfer its source scope or create permissions.", 403);
      }
    }
  }
  assertTool(session: Session, call: ToolCall, root: string | null) {
    const references = this.consumptions(session.id);
    this.assertContext(session, references);
    if (!references.length) return;
    for (const reference of references) {
      const grant = this.host.snapshot().skillAdmissions.find((grant) => grant.id === reference.admissionId)!;
      if (!readTools.has(call.name) && !(grant.access === "native-files" && writeTools.has(call.name))) throw new MoguriError("skill_privilege", "Consumed Local skill context is limited to reviewed native file tools. Commands, scripts, installers, credentials, authentication, delegation and network are unavailable; no manifest can grant them.", 403);
      if (["read_file", "list_files", "search_files", "find_files", ...writeTools].includes(call.name)) {
        if (!root || realpathSync(root) !== grant.root.root || typeof call.arguments.path !== "string") throw new MoguriError("skill_privilege", "This skill tool needs an explicit path at the exact reviewed root.", 403);
        const path = relative(grant.root.root, resolve(grant.root.root, call.arguments.path));
        if (isAbsolute(path) || path === ".." || path.startsWith("../") || isPrivateContextPath(path) ||
          !grant.paths.some((prefix) => prefix === "." || path === prefix || path.startsWith(`${prefix}/`))) throw new MoguriError("skill_privilege", "The file is outside this skill's user-reviewed least-privilege paths.", 403);
      }
    }
  }
  async load(session: Session, skillId: string, expectedDigest: string, actor: "user" | "model", signal?: AbortSignal): Promise<{
    name: string; body: string; event: EventInput; consumption: SkillConsumption; warning: string;
  }> {
    const inspection = await this.inspect(session.id, skillId, expectedDigest, signal);
    const grant = this.host.snapshot().skillAdmissions.findLast((grant) => grant.sessionId === session.id && grant.skillId === skillId &&
      grant.contentDigest === expectedDigest && grant.inspectionDigest === inspection.digest && grant.state === "active");
    if (!grant) throw new MoguriError("skill_admission_required", "Complete actual-user source/provenance admission is required for this exact version, root and policy before loading it into model context.", 403);
    this.assertGrant(this.session(session.id), grant); signal?.throwIfAborted();
    const consumption: SkillConsumption = { admissionId: grant.id, snapshotDigest: grant.snapshotDigest, skillId, contentDigest: expectedDigest, actor };
    const event: EventInput = { event_type: "skill.consumed", profile_id: this.store.profileId, project_id: session.projectId, session_id: session.id,
      ...(session.turnId ? { turn_id: session.turnId } : {}), payload: consumption };
    const body = inspection.files.map((file) => `<untrusted-skill-source path=${JSON.stringify(file.path)} sha256="${file.digest}">\n${file.text}\n</untrusted-skill-source>`).join("\n\n");
    if (Buffer.byteLength(JSON.stringify({ body, inspection: inspection.digest, warning })) > COMPLETE_SOURCE_ENVELOPE_BYTES) throw new MoguriError("skill_inspection_limit", "The complete escaped skill source exceeds the transport envelope. No dependency was truncated.", 413);
    return { name: inspection.name, body, event, consumption, warning };
  }
}
