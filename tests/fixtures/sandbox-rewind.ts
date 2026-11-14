import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import {
  defaultProjectSettings, factoryControls, projectEvents,
  type CheckpointCapture, type CheckpointWorkspace, type EventInput, type Project, type RewindFileDecision, type RewindRecord,
  type SandboxConfiguration, type SandboxExecution, type SandboxNetworkScope, type Session, type Snapshot, type TurnCheckpoint,
} from "../../packages/protocol/src/index.ts";
import { SandboxWorkspaces } from "../../apps/service/src/sandbox-workspaces.ts";
import { EventStore } from "../../apps/service/src/store.ts";
import { frameDigest } from "../../apps/service/src/worker-wire.ts";
import { sourceRootSync } from "../../apps/service/src/repository-source.ts";
import { captureNativePrivateTree, type NativePrivateSource, type NativeStage } from "../../apps/service/src/native-staging.ts";
import { readNativeCompletion } from "../../apps/service/src/native-evidence.ts";
import type { QualifiedSandboxConfiguration } from "../../apps/service/src/sandbox-policy.ts";
import { checkpointReviewDigest } from "../../apps/service/src/checkpoint-files.ts";

const hash = (content: string | Uint8Array) => createHash("sha256").update(content).digest("hex");
const generatedConfiguration = (): QualifiedSandboxConfiguration => ({ executable: "/generated/sendbox", configPath: null,
  image: `docker.io/library/generated-worker@sha256:${"a".repeat(64)}`, bundlePath: "/generated/bundle", trustRootPath: "/generated/trust",
  qualification: { release: "0.2.4", hostSha256: "1".repeat(64), keySha256: "2".repeat(64), manifestSha256: "3".repeat(64),
    workerDigest: "4".repeat(64), bridgeDigest: "5".repeat(64), trustRootId: "generated", minimumReleaseSequence: 8,
    allowedDomains: ["generated.invalid"], allowCopilot: false, resources: { cpus: 2, memoryMb: 4096, diskMb: 8192 } } });
export const sandboxFixtureGit = (root: string, args: string[]): string => {
  const run = (values: string[]) => execFileSync("git", ["--no-pager", "-c", "core.hooksPath=/dev/null",
  "-c", "core.fsmonitor=false", "-c", "maintenance.auto=false", "-c", "gc.auto=0", ...values], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  env: { PATH: process.env.PATH, HOME: root, TMPDIR: root, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_AUTHOR_NAME: "Generated Sandbox", GIT_AUTHOR_EMAIL: "generated@example.invalid", GIT_COMMITTER_NAME: "Generated Sandbox",
    GIT_COMMITTER_EMAIL: "generated@example.invalid", GIT_TERMINAL_PROMPT: "0" } }).trimEnd();
  const result = run(args);
  if (args[0] === "init") { run(["config", "--local", "maintenance.auto", "false"]); run(["config", "--local", "gc.auto", "0"]); }
  return result;
};

export async function sandboxRewindFixture(kind: "project" | "empty" | "group" = "project") {
  const parent = join(process.cwd(), ".sandbox-rewind-fixtures"); await mkdir(parent, { recursive: true, mode: 0o700 });
  const root = join(parent, randomUUID()); await mkdir(root, { mode: 0o700 });
  const canonical = await realpath(root), path = join(canonical, "state.db"), key = Buffer.alloc(32, 0x4f);
  let store = new EventStore(path, key), state = projectEvents([], "default") as Snapshot;
  state.profileId = "default"; state.sandboxWorkspaces ??= []; state.sandboxExecutions ??= [];
  state.checkpointCaptures ??= []; state.checkpoints ??= []; state.rewinds ??= [];
  state.settings.values.sandboxManagement!.enabled = true; state.settings.values.sandboxManagement!.automaticWorkspaces = true;
  const projects: Project[] = [];
  for (let index = 0; index < (kind === "empty" ? 0 : kind === "group" ? 2 : 1); index++) {
    const project = { id: randomUUID(), name: `generated-${index}`, path: join(canonical, `source-${index}`) };
    await mkdir(project.path, { mode: 0o700 }); await writeFile(join(project.path, "file.txt"), `Generated original ${index}.\n`);
    await writeFile(join(project.path, "keep.txt"), `Generated keep original ${index}.\n`);
    projects.push(project);
  }
  state.projects = projects;
  const now = new Date().toISOString(), id = randomUUID(), session: Session = { id, projectId: kind === "project" ? projects[0]!.id : null,
    workspaceId: null, sandboxWorkspaceId: null, title: "Generated private rewind", controls: { ...factoryControls(), env: "Sandbox" },
    revision: 0, status: "queued", draft: { revision: 0, text: "Generated untouched draft.", attachments: [] },
    queue: [{ id: randomUUID(), text: "Generated exact ordinary input.", attachments: [], delivery: "queue" }], queueRevision: 0,
    messages: [], usage: [], processes: [], turnId: null, pendingApproval: null, pendingQuestionId: null, lastError: null,
    localFinishing: false, createdAt: now, updatedAt: now, mode: "agent", pendingMode: null, kind: "agent", pinned: false, unread: false,
    groupId: null, archivedAt: null, prUrl: null, workItemId: null, browserUrl: null,
    ...(kind === "group" ? { repositories: projects.map((project) => ({ projectId: project.id, name: project.name, root: sourceRootSync(project.path) })) } : {}) };
  state.sessions = [session];
  const projectSettings = new Map(projects.map((project) => [project.id, defaultProjectSettings()]));
  const emptySettings = defaultProjectSettings();
  let configuration = generatedConfiguration(), closing = false, commitHook: ((events: EventInput[]) => void) | undefined;
  const apply = (events: EventInput[]) => {
    for (const event of events) {
      if (event.event_type === "sandbox.workspace_recorded") {
        state.sandboxWorkspaces = state.sandboxWorkspaces!.filter((workspace) => workspace.id !== event.payload.workspace.id).concat(structuredClone(event.payload.workspace));
      } else if (event.event_type === "session.sandbox_bound") { session.sandboxWorkspaceId = event.payload.workspaceId; session.revision++; }
      else if (event.event_type === "sandbox.execution_recorded") state.sandboxExecutions = state.sandboxExecutions!.filter((execution) => execution.id !== event.payload.execution.id).concat(structuredClone(event.payload.execution));
      else if (event.event_type === "checkpoint.capture_recorded") state.checkpointCaptures = state.checkpointCaptures.filter((capture) => capture.id !== event.payload.capture.id).concat(structuredClone(event.payload.capture));
      else if (event.event_type === "checkpoint.recorded") state.checkpoints = state.checkpoints.filter((checkpoint) => checkpoint.id !== event.payload.checkpoint.id).concat(structuredClone(event.payload.checkpoint));
      else if (event.event_type === "rewind.recorded") state.rewinds = state.rewinds.filter((record) => record.id !== event.payload.record.id).concat(structuredClone(event.payload.record));
      else if (event.event_type === "model.failure_recorded") state.modelFailures = state.modelFailures.filter((failure) => failure.id !== event.payload.failure.id).concat(structuredClone(event.payload.failure));
    }
  };
  const commit = (events: EventInput[]) => { store.commit(events); apply(events); commitHook?.(events); };
  const host = { snapshot: () => state, project: (_session: Session, repository?: string) => {
    const project = projects.find((project) => project.id === (repository ?? session.projectId));
    if (!project) throw new Error("Generated project scope changed."); return project;
  }, settings: (id: string | null) => ({ revision: 0, values: id ? projectSettings.get(id)! : emptySettings }),
  commit, closing: () => closing, capture: (id: string) => state.checkpointCaptures.find((capture) => capture.id === id),
  rewind: (id: string) => state.rewinds.find((record) => record.id === id), checkpoint: (id: string) => state.checkpoints.find((checkpoint) => checkpoint.id === id),
  nativeStateRoot: join(canonical, "generated-native-state") };
  const runtime = { assertReady: () => structuredClone(configuration) };
  let workspaces = new SandboxWorkspaces(store, canonical, runtime, host);
  const identity = () => frameDigest([store.path, store.profileId, session.id, workspaces.checkpointIdentity(session)]);
  const policy = () => frameDigest([state.policy, state.settings.permissionRevision, [...projectSettings], emptySettings]);
  const capture = (phase: CheckpointCapture["phase"], checkpointId: string = randomUUID(), turnId: string | null = phase === "current" ? null : randomUUID(),
    source?: CheckpointCapture["source"]) => {
    const now = new Date().toISOString(), value: CheckpointCapture = { version: 1, id: randomUUID(), checkpointId, profileId: "default",
      sessionId: id, turnId, phase, source: source ?? (phase === "before" ? { kind: "queue", id: session.queue[0]!.id, digest: frameDigest(session.queue[0]) } :
        { kind: phase === "after" ? "terminal" : "review", id: randomUUID(), digest: hash("Generated canonical source.") }),
      identityDigest: identity(), policyDigest: policy(), contextDigest: hash("[]"), leaseRoots: session.sandboxWorkspaceId ?
        [state.sandboxWorkspaces!.find((workspace) => workspace.id === session.sandboxWorkspaceId)!.stage!.workspace] : projects.map((project) => project.path),
      revision: 0, status: "capturing", workspaceDigest: null, consumedByEventId: null, createdAt: now, updatedAt: now, diagnostic: null };
    commit([{ event_type: "checkpoint.capture_recorded", profile_id: "default", session_id: id, payload: { capture: value } }]); return value;
  };
  const captureGuard = (value: CheckpointCapture) => () => {
    if (value.phase !== "after" && (identity() !== value.identityDigest || policy() !== value.policyDigest)) throw new Error("Generated parent detects changed source/build/policy.");
  };
  const read = async (value: CheckpointCapture, signal = AbortSignal.timeout(30_000)) => {
    const result = await workspaces.captureCheckpoint(id, value, signal, captureGuard(value));
    const next = { ...value, revision: value.revision + 1, status: "captured" as const, workspaceDigest: store.putBlob(JSON.stringify(result)) };
    commit([{ event_type: "checkpoint.capture_recorded", profile_id: "default", session_id: id, payload: { capture: next } }]); return result;
  };
  const before = async () => {
    const value = capture("before"), workspace = await read(value), timestamp = new Date().toISOString();
    const checkpoint: TurnCheckpoint = { version: 1, id: value.checkpointId, revision: 0, profileId: "default", sessionId: id, projectId: session.projectId,
      turnId: value.turnId!, admissionEventId: randomUUID(), startSequence: 1, throughSequence: 0, createdAt: timestamp, summary: "Generated target",
      env: "Sandbox", identityDigest: value.identityDigest, stateDigest: null, beforeDigest: store.putBlob(JSON.stringify(workspace)), storageBytes: 0,
      diagnostics: [], forgotten: false, terminal: null };
    commit([{ event_type: "checkpoint.recorded", profile_id: "default", session_id: id, payload: { checkpoint } }]); return { capture: value, checkpoint, workspace };
  };
  const current = () => read(capture("current"));
  const operation = (checkpoint: TurnCheckpoint, target: CheckpointWorkspace, current: CheckpointWorkspace, decisions: RewindFileDecision[], paths = ["file.txt"],
    rootMode: "target" | "current" | "key" = "target") => {
    const files = paths.map((path) => {
      const desiredRoot = target.roots.find((root) => root.files.some((file) => file.path === path)) ?? target.roots[0]!;
      const actualRoot = current.roots.find((root) => root.key === desiredRoot.key)!;
      const live = actualRoot.files.find((file) => file.path === path), wanted = desiredRoot.files.find((file) => file.path === path);
      return { root: rootMode === "current" ? actualRoot.binding.root : rootMode === "key" ? desiredRoot.key! : desiredRoot.binding.root,
        path, currentDigest: live?.digest ?? null, targetDigest: wanted?.digest ?? null,
        currentMode: live?.mode ?? null, targetMode: wanted?.mode ?? null, conflict: "Generated explicit external conflict." };
    });
    const preview = { version: 1, sessionId: id, checkpointId: checkpoint.id, identityDigest: current.boundary!.identityDigest, policyDigest: policy(),
      currentWorkspaceDigest: checkpointReviewDigest(current), files, digest: hash(JSON.stringify(files)) }, now = new Date().toISOString(), operationId = randomUUID();
    const record: RewindRecord = { version: 1, id: operationId, revision: 0, sessionId: id, profileId: "default", checkpointId: checkpoint.id,
      commandId: randomUUID(), mode: "workspace", env: "Sandbox", identityDigest: current.boundary!.identityDigest, previewDigest: preview.digest,
      inputDigest: store.putBlob(JSON.stringify({ version: 1, preview, decisions,
        current: { ...current, roots: current.roots.map((root) => ({ ...root, files: root.files.map(({ content: _, ...file }) => file) })) } })), contextDigest: store.putBlob("[]"),
      currentSnapshotDigest: current.digest, targetSnapshotDigest: target.digest,
      status: "running", createdAt: now, updatedAt: now, actor: "user", diagnostic: null, quarantined: true,
      roots: [...new Set([...target.roots, ...current.roots].map((root) => root.binding.root))],
      files: files.map((file) => ({ root: file.root, path: file.path, backup: null,
        phase: decisions.some((decision) => decision.root === file.root && decision.path === file.path && decision.choice === "keep-current") ? "kept" : "planned" })),
      inspection: null };
    commit([{ event_type: "rewind.recorded", profile_id: "default", session_id: id, payload: { record } }]); return record;
  };
  return { root: canonical, projects, session, state, host, get store() { return store; }, get workspaces() { return workspaces; },
    commit, capture, read, before, current, operation, identity, policy, projectSettings,
    configure: (value: SandboxConfiguration) => { configuration = value as QualifiedSandboxConfiguration; }, configuration: () => structuredClone(configuration),
    onCommit: (hook?: (events: EventInput[]) => void) => { commitHook = hook; }, closing: (value: boolean) => { closing = value; },
    restart: async () => {
      await workspaces.close(); store.close(); store = new EventStore(path, key);
      const events = store.events(); state.sandboxWorkspaces = []; state.sandboxExecutions = []; state.checkpointCaptures = []; state.checkpoints = []; state.rewinds = [];
      session.sandboxWorkspaceId = null; apply(events); workspaces = new SandboxWorkspaces(store, canonical, runtime, host);
    }, close: async () => { await workspaces.close(); store.close(); await rm(canonical, { recursive: true, force: true }); } };
}
export async function sandboxSignedFixture(f: Awaited<ReturnType<typeof sandboxRewindFixture>>, turnId: string,
  before: NativePrivateSource, after: NativePrivateSource, rollback: boolean,
  network?: { configuration: QualifiedSandboxConfiguration; scope: SandboxNetworkScope }) {
  const stage = before.stage, sid = randomUUID().replaceAll("-", ""), root = join(f.host.nativeStateRoot, "sessions", sid), snapshots = join(root, "snapshots");
  await mkdir(join(snapshots, "manifests"), { recursive: true, mode: 0o700 }); await mkdir(join(snapshots, "objects"), { mode: 0o700 });
  const snapshot = async (source: NativePrivateSource) => {
    const entries = [];
    for (const entry of [...source.entries].sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)))) {
      const kind = entry.type === "directory" ? { type: "directory" } : entry.type === "symlink" ? { type: "symlink", target: entry.target! } :
        { type: "regular", content_hash: entry.digest!, size: entry.bytes! };
      if (entry.type === "regular") {
        const directory = join(snapshots, "objects", entry.digest!.slice(0, 2)); await mkdir(directory, { recursive: true, mode: 0o700 });
        await writeFile(join(directory, entry.digest!.slice(2)), await source.read(entry.path), { mode: 0o600 });
      }
      entries.push({ path: entry.path, mode: entry.mode, kind });
    }
    const body = { format: "sendbox-snapshot", version: 1, entries, total_size: source.entries.reduce((sum, entry) => sum + (entry.bytes ?? 0), 0) };
    const id = hash(JSON.stringify(body)); await writeFile(join(snapshots, "manifests", `${id}.json`), JSON.stringify({ format: body.format, version: 1,
      id, entries, total_size: body.total_size }), { mode: 0o600 }); return id;
  };
  const beforeId = await snapshot(before), afterId = await snapshot(after), pair = generateKeyPairSync("ed25519");
  const publicBytes = pair.publicKey.export({ type: "spki", format: "der" }).subarray(-32);
  const identity = { version: 1, fingerprint: hash(publicBytes), name: "Generated Sandbox evidence", email: null,
    public_key_base64: publicBytes.toString("base64"), valid_from_unix: 90, expires_at_unix: null, revoked_at_unix: null };
  const detached = (content: string, kind: string, name: string, metadata: Record<string, string>) => {
    const value = { format: "sendbox-provenance", version: 1, signature_id: "41".repeat(16), subject: { kind, sha256: hash(content), name },
      signer_fingerprint: identity.fingerprint, signed_at_unix: 101, expires_at_unix: null,
      metadata: Object.fromEntries(Object.entries(metadata).sort(([a], [b]) => Buffer.compare(Buffer.from(a), Buffer.from(b)))) };
    return { ...value, signature_base64: sign(null, Buffer.concat([Buffer.from("sendbox-provenance-signature-v1\0"), Buffer.from(JSON.stringify(value))]), pair.privateKey).toString("base64") };
  };
  const command = ["/generated/node", "--generated-workspace"], config = network?.configuration ?? f.configuration();
  const plan = { format: "sendbox-boundary-plan", version: 3, session_id: [...Buffer.from(sid, "hex")], created_at_unix: 100,
    workspace: { source: stage.workspace }, workload: { reference: config.image }, provider: { runtime: "apple" },
    command: { program: command[0], arguments: command.slice(1) } }, planDigest = hash(JSON.stringify(plan));
  await writeFile(join(root, "boundary-plan.json"), JSON.stringify({ format: "sendbox-signed-boundary-plan", version: 3, plan, signer: identity,
    signature: detached(JSON.stringify(plan), "configuration", `boundary-plan:${sid}`, { format: "sendbox-boundary-plan", runtime: "apple", session_id: sid }) }), { mode: 0o600 });
  const events = [
    { action: "before_snapshot_captured", subject: beforeId, result: "success", metadata: {} },
    { action: "runtime_execution_finished", subject: "generated", result: rollback ? "error" : "success", metadata: { exit_code: rollback ? "130" : "0" } },
    { action: "session_finalized", subject: rollback ? "failed" : "completed", result: rollback ? "error" : "success", metadata: {} },
    ...(rollback ? [{ action: "snapshot_rollback", subject: beforeId, result: "success", metadata: {} }] : []),
  ];
  const audit = JSON.stringify({ format: "sendbox-host-audit-publication", version: 1, session_id: sid, boundary_plan_digest: planDigest,
    event_count: events.length, records: events.map((event) => ({ event: { version: 1, session_id: sid, ...event } })) });
  await writeFile(join(root, "audit-log.json"), audit, { mode: 0o600 });
  await writeFile(join(root, "audit-log.signature.json"), JSON.stringify(detached(audit, "artifact", "audit-log.json", { session_id: sid, boundary_plan_digest: planDigest })), { mode: 0o600 });
  const workspace = f.state.sandboxWorkspaces!.find((workspace) => workspace.id === f.session.sandboxWorkspaceId)!;
  const execution: SandboxExecution = { id: randomUUID(), profileId: "default", sessionId: f.session.id, projectId: f.session.projectId,
    turnId, workspaceId: workspace.id, sourceWorkspaceId: f.session.workspaceId, stage, sourceRoot: workspace.sourceRoot, inputDigest: workspace.inputDigest,
    config, configDigest: frameDigest(config), image: config.image!, workerDigest: config.qualification!.workerDigest, launchName: "generated-native",
    command, createdAt: new Date().toISOString(), root: f.session.repositories ? null : "/workspace", createdAfter: 99, createdBefore: 102,
    nativeSessionId: sid, planDigest, signerFingerprint: identity.fingerprint, status: rollback ? "stopped" : "completed",
    cancellation: rollback ? "acknowledged" : "none", cleanup: "owned-guest-stopped", diagnostic: null, lastSequence: 0, workerPid: null, cliExitCode: rollback ? 2 : 0,
    resultDigest: null, revision: 1, ...(workspace.repositories ? { repositories: workspace.repositories } : {}),
    ...(network ? { networkScope: network.scope } : {}) };
  const evidence = await readNativeCompletion({ stateRoot: f.host.nativeStateRoot, sessionId: sid, workspace: stage.workspace, image: config.image!,
    command: { program: command[0]!, arguments: command.slice(1) }, createdAfter: 99, createdBefore: 102, planDigest, signerFingerprint: identity.fingerprint });
  execution.resultDigest = f.store.putBlob(JSON.stringify({ format: "moguri-native-result", version: execution.repositories ? 2 : 1,
    ...(execution.repositories ? { repositories: execution.repositories } : {}), executionId: execution.id, workspaceId: workspace.id, inputDigest: workspace.inputDigest,
    nativeSessionId: sid, planDigest, signerFingerprint: identity.fingerprint, auditDigest: evidence.auditDigest, beforeId, afterId,
    afterBinding: evidence.afterBinding, rollback: evidence.rollback, exitCode: evidence.exitCode, files: [], excluded: [], excludedCount: 0,
    deletedPaths: [], journal: { status: "verified", diagnostic: null } }));
  f.commit([{ event_type: "sandbox.execution_recorded", profile_id: "default", session_id: f.session.id, payload: { execution } }]);
  return { execution, evidence, beforeId, afterId, root };
}
export async function privateSource(stage: NativeStage): Promise<NativePrivateSource> {
  const source = await captureNativePrivateTree(stage, AbortSignal.timeout(30_000)), contents = new Map<string, Buffer>();
  for (const entry of source.entries) if (entry.type === "regular") contents.set(entry.path, await source.read(entry.path));
  return { ...source, read: async (path) => {
    const bytes = contents.get(path); if (!bytes) throw new Error("Missing generated immutable native object."); return bytes;
  }, verify: async () => {} };
}
