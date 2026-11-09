import { randomUUID } from "node:crypto";
import { join, relative, resolve } from "node:path";
import {
  CHECKPOINT_SESSION_BYTES, CHECKPOINT_SESSION_COUNT, CHECKPOINT_STATE_BYTES, CHECKPOINT_FILE_BYTES,
  CheckpointStateSchema, CheckpointWorkspaceSchema, MoguriError, parse,
  type CheckpointCommand, type CheckpointQuery, type CheckpointResponse, type CheckpointState, type CheckpointWorkspace,
  type CommandResult, type EventInput, type RewindFilePreview, type RewindMode, type RewindPreview, type RewindRecord,
  type Session, type SessionRewind, type Snapshot, type StoredEvent, type TurnCheckpoint,
} from "../../../packages/protocol/src/index.ts";
import { digest, type EventStore } from "./store.ts";
import type { WorkspaceFinish } from "./session-workspace.ts";
import { checkpointFileVersion, checkpointWorkspace, type CheckpointRootInput } from "./checkpoint-files.ts";
import { bytesDigest, readRegularFileSync, scopedPathSync } from "./files.ts";
import { publishRewindFile } from "./rewind-files.ts";
import type { SkillAdmissions } from "./skill-admission.ts";

interface Host {
  snapshot(): Snapshot; events(): StoredEvent[]; context(sessionId: string): unknown[];
  roots(session: Session): CheckpointRootInput[]; identity(session: Session): unknown; policy(session: Session): unknown;
  blockers(session: Session, mode: RewindMode): string[]; rootBusy(root: string, exceptOperationId?: string): boolean;
  settle(sessionId: string, ownerId?: string): Promise<void>; commit(events: EventInput[]): void;
  assertWrite(session: Session, root: string, path: string): void;
}
const message = (error: unknown) => error instanceof Error ? error.message : "The exact checkpoint source could not be captured.";
const key = (root: string, path: string) => JSON.stringify([root, path]);
export class TurnCheckpoints {
  private readonly active = new Map<string, { sessionId: string; abort: AbortController; roots: string[]; done: Promise<void> }>();
  private recovering = true;
  constructor(private readonly store: EventStore, private readonly host: Host, private readonly skills: SkillAdmissions) {}
  ready() { this.recovering = false; }
  async close() {
    const owners = [...this.active.values()];
    for (const owner of owners) owner.abort.abort(new MoguriError("rewind_closing", "Service is closing; original rewind effects must be inspected, never replayed.", 409));
    await Promise.all(owners.map((owner) => owner.done));
  }
  busy(sessionId: string) { return [...this.active.values()].some((owner) => owner.sessionId === sessionId); }
  writeRoots(exceptOperationId?: string): string[] {
    return [...new Set([...this.active.entries()].filter(([id]) => id !== exceptOperationId).flatMap(([, owner]) => owner.roots)
      .concat(this.host.snapshot().rewinds.filter((record) => record.id !== exceptOperationId && (record.quarantined || record.status === "running")).flatMap((record) => record.roots)))];
  }
  assertDeletable(sessionId: string) {
    if (this.busy(sessionId) || this.host.snapshot().rewinds.some((record) => record.sessionId === sessionId && (record.status === "running" || record.quarantined))) {
      throw new MoguriError("rewind_inspection", "Inspect and acknowledge the original partial/running rewind before deleting its owner. Exact roots, displaced files and history were preserved.", 409);
    }
  }
  private session(id: string) {
    const session = this.host.snapshot().sessions.find((session) => session.id === id);
    if (!session) throw new MoguriError("checkpoint_scope", "This checkpoint owner is outside the actual profile.", 404);
    return session;
  }
  private checkpoint(sessionId: string, id: string) {
    this.session(sessionId);
    const checkpoint = this.host.snapshot().checkpoints.find((checkpoint) => checkpoint.id === id && checkpoint.sessionId === sessionId);
    if (!checkpoint) throw new MoguriError("checkpoint_missing", "This exact retained checkpoint is unavailable. Historical files were not fabricated.", 404);
    return checkpoint;
  }
  private operation(sessionId: string, id: string) {
    this.session(sessionId);
    const record = this.host.snapshot().rewinds.find((record) => record.id === id && record.sessionId === sessionId);
    if (!record) throw new MoguriError("rewind_missing", "The original rewind is outside this exact session/profile.", 404);
    return record;
  }
  private identity(session: Session) { return digest(JSON.stringify([this.store.path, this.store.profileId, session.id, this.host.identity(session)])); }
  private policy(session: Session) { return digest(JSON.stringify(this.host.policy(session))); }
  private event(checkpoint: TurnCheckpoint): EventInput {
    return { event_type: "checkpoint.recorded", profile_id: checkpoint.profileId, project_id: checkpoint.projectId,
      session_id: checkpoint.sessionId, turn_id: checkpoint.turnId, payload: { checkpoint } };
  }
  private rewindEvent(record: RewindRecord): EventInput {
    const session = this.session(record.sessionId);
    return { event_type: "rewind.recorded", profile_id: this.store.profileId, project_id: session.projectId, session_id: session.id, payload: { record } };
  }
  private state(checkpoint: TurnCheckpoint): CheckpointState | null {
    return checkpoint.stateDigest ? parse(CheckpointStateSchema, JSON.parse(this.store.blob(checkpoint.stateDigest))) : null;
  }
  private workspace(hash: string | null): CheckpointWorkspace | null {
    if (!hash) return null;
    const workspace = parse(CheckpointWorkspaceSchema, JSON.parse(this.store.blob(hash))), { digest: expected, ...source } = workspace;
    if (digest(JSON.stringify(source)) !== expected || workspace.roots.some((root) => new Set(root.files.map((file) => file.path)).size !== root.files.length ||
      root.files.some((file) => bytesDigest(Buffer.from(file.content, "base64")) !== file.digest || Buffer.from(file.content, "base64").length !== file.bytes))) {
      throw new MoguriError("checkpoint_source", "The complete retained workspace failed its exact manifest/byte verification. No replacement was used.", 409);
    }
    return workspace;
  }
  derived(before: Snapshot, primary: StoredEvent[]): EventInput[] {
    const events: EventInput[] = [];
    for (const admission of primary) if (["turn.started", "turn.control_started", "turn.retry_started"].includes(admission.event_type) && admission.session_id && admission.turn_id) {
      const session = before.sessions.find((session) => session.id === admission.session_id);
      if (!session) throw new MoguriError("checkpoint_owner", "An admitted turn lost its exact before-turn session.", 409);
      const diagnostics: string[] = [], retained = before.checkpoints.filter((checkpoint) => checkpoint.sessionId === session.id && !checkpoint.forgotten);
      const quota = retained.length >= CHECKPOINT_SESSION_COUNT || retained.reduce((bytes, checkpoint) => bytes + checkpoint.storageBytes, 0) >= CHECKPOINT_SESSION_BYTES;
      let stateDigest: string | null = null, beforeDigest: string | null = null, storageBytes = 0, identityDigest: string;
      try { identityDigest = this.identity(session); }
      catch (error) { identityDigest = digest(JSON.stringify([session.id, session.projectId, session.workspaceId, session.controls.env])); diagnostics.push(`Workspace identity unavailable: ${message(error)}`); }
      if (quota) diagnostics.push("Checkpoint storage reached 64 retained captures or 512 MiB for this session. Prune an exact unneeded checkpoint; no historical snapshot was invented.");
      else {
        try {
          const state: CheckpointState = { version: 1, context: this.host.context(session.id), messages: session.messages, draft: session.draft,
            queue: session.queue, controls: session.controls, skillConsumptions: this.skills.consumptions(session.id),
            artifacts: before.artifacts.filter((artifact) => artifact.originSessionId === session.id).map((artifact) => ({ id: artifact.id, revision: artifact.revision, digest: artifact.contentDigest })) };
          const text = JSON.stringify(state);
          if (Buffer.byteLength(text) > CHECKPOINT_STATE_BYTES) throw new MoguriError("checkpoint_limit", "Complete conversation/state exceeds the 32 MiB checkpoint bound. Nothing was truncated.", 413);
          stateDigest = this.store.putBlob(text); storageBytes += Buffer.byteLength(text);
        } catch (error) { diagnostics.push(`Conversation capture unavailable: ${message(error)}`); console.error("Checkpoint conversation capture unavailable:", message(error)); }
        try {
          if (session.controls.env !== "Local") throw new MoguriError("checkpoint_transport", `${session.controls.env} workspace capture/restoration is not qualified. Conversation checkpoints never substitute a Local root.`, 409);
          const workspace = checkpointWorkspace(this.host.roots(session)), text = JSON.stringify(workspace);
          if (storageBytes + Buffer.byteLength(text) + retained.reduce((bytes, checkpoint) => bytes + checkpoint.storageBytes, 0) > CHECKPOINT_SESSION_BYTES) throw new MoguriError("checkpoint_limit", "The complete workspace would exceed the 512 MiB session checkpoint quota.", 413);
          beforeDigest = this.store.putBlob(text); storageBytes += Buffer.byteLength(text);
        } catch (error) { diagnostics.push(`Workspace capture unavailable: ${message(error)}`); }
      }
      const checkpoint: TurnCheckpoint = { version: 1, id: randomUUID(), revision: 0, profileId: this.store.profileId, sessionId: session.id,
        projectId: session.projectId, turnId: admission.turn_id, admissionEventId: admission.id, startSequence: admission.seq, throughSequence: admission.seq - 1,
        createdAt: admission.timestamp, summary: admission.event_type === "turn.started" ? admission.payload.item.text.slice(0, 240) : admission.event_type,
        env: session.controls.env, identityDigest, stateDigest, beforeDigest, storageBytes, diagnostics, forgotten: false, terminal: null };
      events.push(this.event(checkpoint));
    }
    for (const terminal of primary) if (terminal.event_type === "turn.finished" && terminal.session_id && terminal.turn_id) {
      const checkpoint = [...before.checkpoints, ...events.flatMap((event) => event.event_type === "checkpoint.recorded" ? [event.payload.checkpoint] : [])]
        .findLast((checkpoint) => checkpoint.sessionId === terminal.session_id && checkpoint.turnId === terminal.turn_id && !checkpoint.terminal && !checkpoint.forgotten);
      if (!checkpoint) continue;
      const diagnostics = [...checkpoint.diagnostics], session = before.sessions.find((session) => session.id === terminal.session_id);
      let afterDigest: string | null = null, storageBytes = checkpoint.storageBytes;
      try {
        if (this.recovering || !session || !checkpoint.beforeDigest || this.identity(session) !== checkpoint.identityDigest) throw new MoguriError("checkpoint_terminal_unavailable", "The original terminal workspace boundary is incomplete, changed or recovered after restart; today's files were not relabeled as its historical result.", 409);
        const text = JSON.stringify(checkpointWorkspace(this.host.roots(session)));
        if (before.checkpoints.filter((value) => value.sessionId === session.id).reduce((bytes, value) => bytes + value.storageBytes, 0) + Buffer.byteLength(text) > CHECKPOINT_SESSION_BYTES) throw new MoguriError("checkpoint_limit", "The complete terminal snapshot would exceed the session storage quota.", 413);
        afterDigest = this.store.putBlob(text); storageBytes += Buffer.byteLength(text);
      } catch (error) { diagnostics.push(`Terminal workspace capture unavailable: ${message(error)}`); }
      events.push(this.event({ ...checkpoint, revision: checkpoint.revision + 1, diagnostics, storageBytes,
        terminal: { sequence: terminal.seq, eventId: terminal.id, at: terminal.timestamp, outcome: terminal.payload.outcome, diagnostic: terminal.payload.diagnostic, afterDigest } }));
    }
    return events;
  }
  recover(): EventInput[] {
    return this.host.snapshot().rewinds.filter((record) => record.status === "running").map((record) => this.rewindEvent({ ...record,
      revision: record.revision + 1, status: "partial", quarantined: record.mode === "workspace", updatedAt: new Date().toISOString(),
      diagnostic: "Service restarted during the original rewind. Actual filesystem effects and private displaced inodes need explicit inspection. Nothing was replayed; conversation/accounting history was preserved." }));
  }
  private nativeWrite(session: Session, root: string, path: string, hash: string | null, through: number): boolean {
    return hash !== null && this.host.events().some((event) => event.session_id === session.id && event.seq > through &&
      event.event_type === "tool.completed" && event.payload.outcome === "completed" && !event.payload.isError &&
      event.payload.call.name === "write_file" && typeof event.payload.call.arguments.path === "string" && typeof event.payload.call.arguments.text === "string" &&
      relative(root, resolve(root, event.payload.call.arguments.path)) === path && digest(event.payload.call.arguments.text) === hash);
  }
  private prepare(sessionId: string, checkpointId: string, mode: RewindMode, exceptOperationId?: string) {
    const session = this.session(sessionId), checkpoint = this.checkpoint(sessionId, checkpointId), state = this.state(checkpoint), target = this.workspace(checkpoint.beforeDigest);
    const blockers = this.host.blockers(session, mode), snapshot = this.host.snapshot();
    let identityDigest: string;
    try { identityDigest = this.identity(session); }
    catch (error) { identityDigest = digest(JSON.stringify([session.id, session.projectId, session.workspaceId, session.controls.env])); blockers.push(message(error)); }
    if (checkpoint.forgotten || !state) blockers.push("The exact before-turn conversation/state snapshot is unavailable or was pruned.");
    if (identityDigest !== checkpoint.identityDigest) blockers.push("The actual profile/store/Env/root/peer/workspace identity differs from this checkpoint. No alternate root can be restored.");
    if (state) try { this.skills.assertContext(session, state.skillConsumptions); } catch (error) { blockers.push(`Target source authority is no longer valid: ${message(error)}`); }
    const context = this.host.context(sessionId), files: RewindFilePreview[] = [];
    let current: CheckpointWorkspace | null = null;
    if (mode === "workspace") {
      if (session.controls.env !== "Local" || !target) blockers.push("This checkpoint has no qualified complete Local workspace snapshot. Remote/Sandbox restore and Local fallback are unavailable.");
      if (session.mode !== "agent" || session.pendingMode === "read-only") blockers.push("Read-only/side mode cannot restore workspace files.");
      if (snapshot.rewinds.some((record) => record.id !== exceptOperationId && record.sessionId === sessionId && (record.status === "running" || record.quarantined))) blockers.push("An original rewind still owns unsettled effects. Inspect it before another restoration.");
      if (target) {
        for (const root of target.roots) if (this.host.rootBusy(root.binding.root, exceptOperationId)) blockers.push(`An actual competing writer/console owns ${root.binding.root}.`);
        try { current = checkpointWorkspace(this.host.roots(session)); } catch (error) { blockers.push(`Current workspace capture unavailable: ${message(error)}`); }
        const changed = new Set<string>(), expected = new Map<string, string | null>();
        for (const later of snapshot.checkpoints.filter((value) => value.sessionId === sessionId && value.startSequence >= checkpoint.startSequence && !value.forgotten)) {
          const before = this.workspace(later.beforeDigest), after = this.workspace(later.terminal?.afterDigest ?? null);
          if (!before || !after || !later.terminal) { blockers.push(`Turn ${later.turnId} has no complete proven before/terminal workspace capture.`); continue; }
          for (const root of before.roots) {
            const end = after.roots.find((value) => value.binding.root === root.binding.root);
            if (!end || JSON.stringify(end.binding) !== JSON.stringify(root.binding)) { blockers.push("A later turn changed its original root identity."); continue; }
            const paths = new Set([...root.files, ...end.files].map((file) => file.path));
            for (const path of paths) {
              const prior = root.files.find((file) => file.path === path), next = end.files.find((file) => file.path === path), id = key(root.binding.root, path);
              if (checkpointFileVersion(prior) !== checkpointFileVersion(next)) changed.add(id);
              expected.set(id, next?.digest ?? null);
            }
          }
        }
        if (current) for (const root of target.roots) {
          const actual = current.roots.find((value) => value.binding.root === root.binding.root);
          if (!actual || JSON.stringify(actual.binding) !== JSON.stringify(root.binding)) { blockers.push("The current workspace no longer contains the exact captured root."); continue; }
          for (const path of new Set([...root.files, ...actual.files].map((file) => file.path))) {
            const id = key(root.binding.root, path), wanted = root.files.find((file) => file.path === path), live = actual.files.find((file) => file.path === path);
            if (!changed.has(id) || checkpointFileVersion(wanted) === checkpointFileVersion(live)) continue;
            const expectedDigest = expected.get(id) ?? null;
            const conflict = (live?.digest ?? null) !== expectedDigest ? "External bytes differ from the last captured terminal state." :
              target.roots.length !== 1 || !this.nativeWrite(session, root.binding.root, path, expectedDigest, checkpoint.throughSequence) ?
                "Observed changes are not proven to be an exact owned native-file write; external/command authorship needs an explicit decision." : null;
            try { this.host.assertWrite(session, root.binding.root, path); } catch (error) { blockers.push(message(error)); }
            files.push({ root: root.binding.root, path, currentDigest: live?.digest ?? null, targetDigest: wanted?.digest ?? null,
              expectedDigest, currentMode: live?.mode ?? null, targetMode: wanted?.mode ?? null, conflict });
          }
        }
      }
    }
    const value = { version: 1 as const, sessionId, checkpointId, mode, identityDigest, policyDigest: this.policy(session),
      sessionRevision: session.revision, draftRevision: session.draft.revision, queueRevision: session.queueRevision,
      currentContextDigest: digest(JSON.stringify(context)), currentWorkspaceDigest: current?.digest ?? null, throughSequence: checkpoint.throughSequence,
      contextMessages: state?.context.length ?? 0, currentContextMessages: context.length, files, blockers: [...new Set(blockers)],
      warnings: ["Pushes, merges, deployments and external MCP effects are not undone. Tools and paid calls are never replayed.",
        "Current Git HEAD/index, drafts, controls, hard policy, artifacts, source revocations and spent/unknown budgets are preserved. Queued work is held, not replayed.",
        "Workspace scope is unprotected, non-ignored regular files. Empty directories, ignored/generated files and credential/control/Git paths are not restored.",
        "Every displaced original file is retained as a private .moguri/rewinds backup, including writes through an already-open inode. No automatic backup deletion occurs."],
      preserved: ["later append-only conversation/history", "current draft and held queue", "current model/Env/autonomy/budget/policy", "Git HEAD and staged index", "unrelated/untracked external files", "independent artifacts and accounting"],
      sourceAdmissions: state?.skillConsumptions ?? [] };
    const { draftRevision: _draft, queueRevision: _queue, ...bound } = value;
    const preview: RewindPreview = { ...value, digest: digest(JSON.stringify(bound)) };
    return { preview, checkpoint, state, target, current };
  }
  query(query: CheckpointQuery): CheckpointResponse {
    const session = this.session(query.sessionId);
    if (query.type === "rewind.preview") return { type: query.type, preview: this.prepare(session.id, query.checkpointId, query.mode).preview };
    if (query.type === "rewind.inspect") return this.inspect(session.id, query.rewindId);
    if (query.type === "checkpoints.read") {
      const checkpoint = this.checkpoint(session.id, query.checkpointId);
      return { type: query.type, checkpoint, state: this.state(checkpoint), before: this.workspace(checkpoint.beforeDigest), after: this.workspace(checkpoint.terminal?.afterDigest ?? null) };
    }
    const checkpoints = this.host.snapshot().checkpoints.filter((checkpoint) => checkpoint.sessionId === session.id).sort((a, b) => b.startSequence - a.startSequence);
    const starts = this.host.events().filter((event) => event.session_id === session.id && ["turn.started", "turn.control_started", "turn.retry_started"].includes(event.event_type));
    return { type: query.type, checkpoints: checkpoints.slice(query.offset, query.offset + query.limit),
      rewinds: this.host.snapshot().rewinds.filter((record) => record.sessionId === session.id),
      nextOffset: query.offset + query.limit < checkpoints.length ? query.offset + query.limit : null,
      historicalTurnsUnavailable: starts.filter((event) => !checkpoints.some((checkpoint) => checkpoint.admissionEventId === event.id)).length };
  }
  private inspect(sessionId: string, rewindId: string): Extract<CheckpointResponse, { type: "rewind.inspect" }> {
    const record = this.operation(sessionId, rewindId), session = this.session(sessionId);
    if (this.identity(session) !== record.identityDigest) throw new MoguriError("rewind_scope", "Inspect only the original exact profile/store/root/peer owner.", 409);
    const read = (path: string) => {
      try { return bytesDigest(readRegularFileSync(path, CHECKPOINT_FILE_BYTES)); }
      catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") return null; throw error; }
    };
    const effects = record.files.map((file, index) => {
      if (!record.roots.includes(file.root) || file.backup !== null && file.backup !== join(file.root, ".moguri", "rewinds", record.id, `${index}.displaced`)) throw new MoguriError("rewind_scope", "The retained effect/backup path lost its original reviewed owner.", 409);
      return { root: file.root, path: file.path, currentDigest: read(scopedPathSync(file.root, file.path, true)), backupDigest: file.backup ? read(file.backup) : null };
    });
    return { type: "rewind.inspect", record, effects, digest: digest(JSON.stringify([record, effects, this.policy(session)])) };
  }
  async execute(command: CheckpointCommand, finish: WorkspaceFinish): Promise<CommandResult> {
    const session = this.session(command.sessionId);
    if (command.type === "rewind.settle") {
      if (this.busy(session.id)) throw new MoguriError("rewind_busy", "The original rewind already owns this session. Stop or inspect that operation.", 409);
      const id = `settle/${finish.intent?.id ?? randomUUID()}`, done = Promise.withResolvers<void>();
      this.active.set(id, { sessionId: session.id, roots: [], abort: new AbortController(), done: done.promise });
      try { await this.host.settle(session.id, finish.ownerId); return finish([], { revision: this.session(session.id).revision }); }
      finally { this.active.delete(id); done.resolve(); }
    }
    if (command.type === "rewind.stop") {
      this.operation(session.id, command.rewindId);
      const owner = this.active.get(command.rewindId);
      if (!owner) throw new MoguriError("rewind_recorded", "The original rewind is terminal or lost its live owner. Inspect it; effects were not replayed.", 409);
      owner.abort.abort(new MoguriError("rewind_stopped", "Actual-user Stop interrupted the original rewind. Inspect any displaced files; no rollback success was inferred.", 409));
      return finish([], { id: command.rewindId });
    }
    if (command.type === "rewind.acknowledge") {
      const inspected = this.inspect(session.id, command.rewindId), record = inspected.record;
      if (this.active.has(record.id) || record.status !== "partial" || !record.quarantined || record.revision !== command.expectedRevision || inspected.digest !== command.expectedDigest) throw new MoguriError("rewind_inspection_stale", "Review the exact terminal partial effects again before acknowledging them. No failed rewind became successful.", 409);
      const next = { ...record, revision: record.revision + 1, quarantined: false, updatedAt: new Date().toISOString(),
        inspection: { actor: "user" as const, digest: inspected.digest, at: new Date().toISOString() } };
      return finish([this.rewindEvent(next)], { id: record.id, revision: next.revision });
    }
    if (command.type === "checkpoint.prune") {
      const checkpoint = this.checkpoint(session.id, command.checkpointId);
      if (checkpoint.revision !== command.expectedRevision || checkpoint.forgotten || !checkpoint.terminal ||
        this.host.snapshot().rewinds.some((record) => record.checkpointId === checkpoint.id && (record.status === "running" || record.quarantined))) throw new MoguriError("checkpoint_retention", "The exact checkpoint changed or still owns active/unconfirmed work. Its grants were preserved.", 409);
      const forgotten: TurnCheckpoint = { ...checkpoint, revision: checkpoint.revision + 1, forgotten: true, stateDigest: null, beforeDigest: null, storageBytes: 0,
        terminal: { ...checkpoint.terminal, afterDigest: null }, diagnostics: [...checkpoint.diagnostics, "Actual user pruned this checkpoint's encrypted snapshot compartment. History/accounting and independent artifacts remain."] };
      return finish([{ event_type: "checkpoint.forgotten", profile_id: this.store.profileId, project_id: session.projectId, session_id: session.id, payload: { checkpoint: forgotten, actor: "user" } }],
        { id: checkpoint.id, revision: forgotten.revision }, { checkpoints: [{ sessionId: session.id, id: checkpoint.id }] });
    }
    if (!finish.intent) throw new MoguriError("rewind_owner", "Rewind requires the original actual-user command identity.", 409);
    const previous = this.host.snapshot().rewinds.find((record) => record.commandId === finish.intent!.id);
    if (previous) throw new MoguriError("rewind_recorded", `Original rewind ${previous.id} is already retained. Missing receipts never authorize replay.`, 409);
    const prepared = this.prepare(session.id, command.checkpointId, command.mode), { preview, checkpoint, state, target, current } = prepared;
    if (preview.digest !== command.expectedDigest || preview.blockers.length || !state) throw new MoguriError("rewind_preview_stale", preview.blockers.join(" ") || "The target-bound context/files/root/policy preview changed. Nothing was restored.", 409);
    const decisions = new Map(command.decisions.map((decision) => [key(decision.root, decision.path), decision.choice]));
    if (decisions.size !== command.decisions.length || command.decisions.some((decision) => !preview.files.some((file) => file.root === decision.root && file.path === decision.path)) ||
      preview.files.some((file) => file.conflict && !decisions.has(key(file.root, file.path)))) throw new MoguriError("rewind_conflict_decision", "Every real conflict needs one explicit keep-current or restore-checkpoint decision bound to this exact preview. No external edit was discarded.", 409);
    const id = randomUUID(), roots = command.mode === "workspace" ? target!.roots.map((root) => root.binding.root) : [];
    const contextDigest = this.store.putBlob(JSON.stringify(state.context)), now = new Date().toISOString();
    let record: RewindRecord = { version: 1, id, revision: 0, profileId: this.store.profileId, sessionId: session.id, checkpointId: checkpoint.id,
      commandId: finish.intent.id, mode: command.mode, identityDigest: preview.identityDigest, previewDigest: preview.digest,
      inputDigest: this.store.putBlob(JSON.stringify({ version: 1, preview, decisions: command.decisions, current })), contextDigest,
      status: "running", createdAt: now, updatedAt: now, actor: "user", diagnostic: null, quarantined: command.mode === "workspace", roots,
      files: preview.files.map((file, index) => ({ root: file.root, path: file.path,
        backup: file.currentDigest ? join(file.root, ".moguri", "rewinds", id, `${index}.displaced`) : null,
        phase: decisions.get(key(file.root, file.path)) === "keep-current" ? "kept" : "planned" })), inspection: null };
    const abort = new AbortController(), done = Promise.withResolvers<void>();
    this.active.set(id, { sessionId: session.id, abort, roots, done: done.promise });
    let retained = false, effects = false;
    const check = () => {
      abort.signal.throwIfAborted();
      const actual = this.session(session.id);
      if (this.identity(actual) !== preview.identityDigest || this.policy(actual) !== preview.policyDigest || actual.revision !== preview.sessionRevision ||
        actual.draft.revision !== preview.draftRevision || actual.queueRevision !== preview.queueRevision ||
        digest(JSON.stringify(this.host.context(session.id))) !== preview.currentContextDigest || this.host.blockers(actual, command.mode).length ||
        roots.some((root) => this.host.rootBusy(root, id))) throw new MoguriError("rewind_race", "The exact owner, current state, policy or writer boundary changed during restoration. Partial effects and displaced files were preserved.", 409);
      this.skills.assertContext(actual, state.skillConsumptions);
    };
    const update = (changes: Partial<RewindRecord>) => {
      const next = { ...record, ...changes, revision: record.revision + 1, updatedAt: new Date().toISOString() };
      this.host.commit([this.rewindEvent(next)]); record = next;
    };
    try {
      check(); this.host.commit([this.rewindEvent(record)]); retained = true;
      if (command.mode === "workspace") {
        if (!target || !current || checkpointWorkspace(this.host.roots(this.session(session.id))).digest !== current.digest) throw new MoguriError("rewind_race", "Workspace bytes/index changed after the exact preview. No file was restored.", 409);
        for (let index = 0; index < record.files.length; index++) {
          const file = record.files[index]!;
          if (file.phase === "kept") continue;
          this.host.assertWrite(this.session(session.id), file.root, file.path);
          check(); update({ files: record.files.map((value, offset) => offset === index ? { ...value, phase: "moving" } : value) }); effects = true;
          const live = current.roots.find((root) => root.binding.root === file.root)?.files.find((value) => value.path === file.path);
          const wanted = target.roots.find((root) => root.binding.root === file.root)?.files.find((value) => value.path === file.path);
          await publishRewindFile(file.root, id, index, file.path, live, wanted, check);
          update({ files: record.files.map((value, offset) => offset === index ? { ...value, phase: wanted ? "written" : "removed" } : value) });
        }
        const after = checkpointWorkspace(this.host.roots(this.session(session.id)));
        for (const root of current.roots) {
          const observed = after.roots.find((value) => value.binding.root === root.binding.root);
          if (!observed || JSON.stringify(observed.git) !== JSON.stringify(root.git)) throw new MoguriError("rewind_git_race", "Git HEAD/index changed during restoration. It was never reset; complete rewind was not claimed.", 409);
          for (const file of record.files.filter((file) => file.root === root.binding.root && file.phase !== "kept")) {
            const wanted = target.roots.find((value) => value.binding.root === file.root)?.files.find((value) => value.path === file.path);
            const live = observed.files.find((value) => value.path === file.path);
            if (checkpointFileVersion(wanted) !== checkpointFileVersion(live)) throw new MoguriError("rewind_conflict", "A restored path changed before final verification. Displaced files and actual partial outcome remain inspectable.", 409);
          }
        }
      }
      check();
      const completed: RewindRecord = { ...record, revision: record.revision + 1, status: "completed", quarantined: false, updatedAt: new Date().toISOString() };
      const rewind: SessionRewind = { version: 1, operationId: id, checkpointId: checkpoint.id, contextDigest, throughSequence: checkpoint.throughSequence,
        discardedThroughSequence: this.host.events().at(-1)?.seq ?? 0, actor: "user", skillConsumptions: state.skillConsumptions };
      const ownerInput = finish.ownerId ? this.host.snapshot().commandExecutions.find((execution) => execution.id === finish.ownerId)?.queueItemId : undefined;
      const held = session.queue.filter((item) => item.id !== ownerInput).map((item) => item.id);
      return finish([this.rewindEvent(completed),
        { event_type: "session.rewound", profile_id: this.store.profileId, project_id: session.projectId, session_id: session.id, payload: rewind },
        ...(held.length ? [{ event_type: "queue.held" as const, profile_id: this.store.profileId, project_id: session.projectId, session_id: session.id, payload: { messageIds: held } }] : [])], { id, revision: completed.revision });
    } catch (error) {
      if (retained) try { update({ status: effects ? "partial" : "failed", quarantined: effects, diagnostic: `${message(error)} Original intent/data retained; no paid/tool replay, budget refund or external-effect undo.` }); }
      catch (persistence) { console.error("Rewind outcome persistence failed; original intent remains unconfirmed:", message(persistence)); }
      throw new MoguriError(effects ? "rewind_partial" : "rewind_failed", `${message(error)} Original rewind ${id}; inspect retained effects/backups before any new review.`, 409);
    } finally { this.active.delete(id); done.resolve(); }
  }
}
