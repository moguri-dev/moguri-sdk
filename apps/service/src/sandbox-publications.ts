import { randomUUID } from "node:crypto";
import {
  MAX_CANDIDATE_PATCH_BYTES, MoguriError, parse, SandboxPublicationDocumentSchema, SandboxPublicationResultSchema, type SandboxCommand, type SandboxQuery,
  type SandboxPublication, type SandboxPublicationDocument, type SandboxPublicationPreview, type SandboxResponse,
  type EventInput, type Snapshot, type Project, type ProjectSettings, type RetainedArtifact, type CapabilityJob, type CommandResult, type SandboxExecution,
} from "../../../packages/protocol/src/index.ts";
import { candidateBases, candidatePatch } from "./candidate-files.ts";
import type { CandidateJobLifecycle } from "./candidates.ts";
import { readProjectFile, writeProjectFile } from "./files.ts";
import { inspectProjectDirectory, prepareProjectDirectory } from "./project-directory.ts";
import { optionalGitBinding } from "./project-git.ts";
import { assertFolderName, folderPolicy } from "./project-policy.ts";
import { sourceRoot, sourceRootSync } from "./repository-source.ts";
import { authorizeTool } from "./permissions.ts";
import { sandboxResult } from "./sandbox-results.ts";
import { nativeWorkspaceDocument } from "./sandbox-workspaces.ts";
import { digest, type EventStore } from "./store.ts";
import type { WorkspaceFinish } from "./session-workspace.ts";

interface Host {
  snapshot(): Snapshot; commit(events: EventInput[]): void; wake(): void;
  root(projectId: string, workspaceId: string | null): Project; assertRoot(projectId: string, workspaceId: string | null): Promise<void>;
  settings(projectId: string): { revision: number; values: ProjectSettings };
  rootBusy(root: string, exceptJobId?: string): boolean; closing(projectId: string): boolean;
  artifact(publication: SandboxPublication): RetainedArtifact;
  job(projectId: string, workspaceId: string | null, execute: (signal: AbortSignal, progress: (text: string) => void, jobId: string) => Promise<unknown>,
    start: (job: CapabilityJob) => void, settled: () => void, lifecycle: CandidateJobLifecycle): string;
}
export class SandboxPublications {
  constructor(private readonly store: EventStore, private readonly host: Host) {}
  private record(id: string): SandboxPublication {
    const value = (this.host.snapshot().sandboxPublications ?? []).find((value) => value.id === id);
    if (!value || !this.host.snapshot().artifacts.some((artifact) => artifact.id === id)) throw new MoguriError("sandbox_publication", "Native publication is outside this retained profile.", 404);
    return value;
  }
  private document(record: SandboxPublication): SandboxPublicationDocument {
    const value = parse(SandboxPublicationDocumentSchema, JSON.parse(this.store.blob(record.documentDigest)));
    candidatePatch(value.patch);
    if (value.executionId !== record.executionId || value.inputDigest !== record.inputDigest || value.resultDigest !== record.resultDigest || value.root !== record.root ||
      value.projectId !== record.projectId || value.workspaceId !== record.workspaceId || JSON.stringify(value.patch.edits.map((edit) => edit.path)) !== JSON.stringify(record.paths)) throw new MoguriError("sandbox_publication", "Native publication lost its original exact document/root. No file effect was replayed.", 409);
    return value;
  }
  private event(publication: SandboxPublication): EventInput {
    return { event_type: "sandbox.publication_recorded", profile_id: publication.profileId, project_id: publication.projectId, payload: { publication } };
  }
  private update(id: string, changes: Partial<SandboxPublication>): void {
    const before = this.record(id);
    this.host.commit([this.event({ ...before, ...changes, revision: before.revision + 1, updatedAt: new Date().toISOString() })]);
  }
  isBusy(projectId: string, workspaceId: string | null): boolean {
    return (this.host.snapshot().sandboxPublications ?? []).some((record) => record.projectId === projectId && record.workspaceId === workspaceId && record.status === "publishing");
  }
  stopEvents(id: string, jobId: string): EventInput[] {
    const record = this.record(id);
    return record.jobId !== jobId || record.status !== "publishing" || record.stopRequested ? [] :
      [this.event({ ...record, revision: record.revision + 1, updatedAt: new Date().toISOString(), stopRequested: true })];
  }
  private async preview(executionId: string, requested: string[], signal: AbortSignal, exceptJobId?: string, retained?: SandboxExecution) {
    const snapshot = this.host.snapshot(), execution = retained ?? (snapshot.sandboxExecutions ?? []).find((value) => value.id === executionId);
    if (!execution || execution.profileId !== snapshot.profileId || !execution.projectId || execution.sourceWorkspaceId === undefined ||
      !execution.sourceRoot || !execution.resultDigest || execution.cleanup !== "owned-guest-stopped" ||
      execution.inspectionIntent?.status === "running") throw new MoguriError("sandbox_publication", "Select an independently retained, project-bound native result with verified original VM absence. No source or previous root was inferred.", 409);
    if (this.host.closing(execution.projectId)) throw new MoguriError("project_removing", "This source project is being removed. No publication was admitted.", 409);
    const input = nativeWorkspaceDocument(this.store.blob(execution.inputDigest)), result = sandboxResult(this.store.blob(execution.resultDigest));
    if (!input.source || input.source.root !== execution.sourceRoot || input.source.digest !== execution.stage.sourceDigest ||
      result.executionId !== execution.id || result.inputDigest !== execution.inputDigest || result.planDigest !== execution.planDigest ||
      result.nativeSessionId !== execution.nativeSessionId || result.signerFingerprint !== execution.signerFingerprint) throw new MoguriError("sandbox_publication", "Native original source and retained after-state disagree. No output was substituted.", 409);
    const projectId = execution.projectId, workspaceId = execution.sourceWorkspaceId, project = this.host.root(projectId, workspaceId);
    const identity = await sourceRoot(project.path), configuration = this.host.settings(projectId), policy = folderPolicy(configuration.values);
    if (project.path !== input.source.root || identity.device !== input.source.identity.device || identity.inode !== input.source.identity.inode) throw new MoguriError("sandbox_publication", "The exact original Local source directory was moved or replaced. No base checkout fallback.", 409);
    const patch = candidatePatch({ kind: "patch", summary: `Reviewed native output ${execution.id}`, edits: [...requested].sort().map((path) => {
      const output = result.files.find((file) => file.path === path);
      if (!output) throw new MoguriError("sandbox_publication_file", "Select exact retained UTF-8 output files. Deleted, protected, excluded or oversized paths are not silently published.", 409);
      return { path, text: output.text, baseDigest: input.source!.files.find((file) => file.path === path)?.digest ?? "absent" };
    }) });
    const git = await optionalGitBinding(project.path, signal);
    if ((git?.head ?? null) !== input.sourceHead) throw new MoguriError("sandbox_publication_base", "The original source HEAD changed. Preserve these outputs and review a new base explicitly; no rebase or reset was performed.", 409);
    const authorityDigest = digest(JSON.stringify({ profileId: snapshot.profileId, projectId, workspaceId, policyRevision: snapshot.policy.revision,
      permissionRevision: snapshot.settings.permissionRevision, projectRevision: configuration.revision, resultDigest: execution.resultDigest, identity, git }));
    const document = parse(SandboxPublicationDocumentSchema, { format: "moguri-native-publication", version: 1, executionId, inputDigest: execution.inputDigest,
      resultDigest: execution.resultDigest, projectId, workspaceId, ...identity, git, authorityDigest, patch });
    const current = () => {
      signal.throwIfAborted();
      const state = this.host.snapshot(), root = this.host.root(projectId, workspaceId), actual = sourceRootSync(root.path);
      if (this.host.closing(projectId) || state.policy.revision !== snapshot.policy.revision || state.settings.permissionRevision !== snapshot.settings.permissionRevision ||
        this.host.settings(projectId).revision !== configuration.revision || root.path !== document.root || actual.device !== document.device || actual.inode !== document.inode ||
        (!retained && (state.sandboxExecutions ?? []).find((value) => value.id === executionId)?.resultDigest !== document.resultDigest) ||
        this.host.rootBusy(document.root, exceptJobId) ||
        (workspaceId ? state.blockedWorkspaces.includes(workspaceId) : state.blockedProjects.includes(projectId)) ||
        state.terminals.some((terminal) => terminal.env === "Local" &&
          (terminal.binding?.root === document.root || terminal.projectId === projectId && terminal.workspaceId === workspaceId) &&
          !["closed", "failed", "acknowledged"].includes(terminal.status))) {
        throw new MoguriError("sandbox_publication_stale", "Native result, exact source root, policy or writer ownership changed. No stale publication was authorized.", 409);
      }
      for (const edit of patch.edits) {
        assertFolderName(edit.path, true, policy);
        if (authorizeTool(state.settings.values, { id: "native-publication", name: "write_file", arguments: { path: edit.path, text: edit.text, expectedDigest: edit.baseDigest } }, document.root).decision === "deny") {
          throw new MoguriError("tool_denied", "Current hard write policy denies a selected native output. User publication does not override that denial.", 403);
        }
      }
    };
    const assert = async () => {
      current(); await this.host.assertRoot(projectId, workspaceId);
      if (JSON.stringify(await optionalGitBinding(document.root, signal)) !== JSON.stringify(document.git)) throw new MoguriError("sandbox_publication_base", "Source branch, HEAD or repository identity changed. No Git intent was altered.", 409);
      for (const edit of patch.edits) { await inspectProjectDirectory(document.root, edit.path); assertFolderName(edit.path, true, policy); }
      current();
    };
    await assert(); await candidateBases(document.root, patch); await assert();
    const text = JSON.stringify(document);
    if (Buffer.byteLength(text) > 64 * 1024) throw new MoguriError("sandbox_publication_limit", "Review at most 20 selected outputs, a 32-KiB patch and 64-KiB complete document per native publication. Nothing was truncated.", 409);
    const preview: SandboxPublicationPreview = { document, digest: digest(`moguri-native-publication-v1\0${text}`),
      limits: { files: 20, patchBytes: MAX_CANDIDATE_PATCH_BYTES, documentBytes: 64 * 1024 },
      diagnostic: "Actual-user publication copies only these exact retained bytes to their original Local bases. It never executes code, stages files, changes HEAD/index or treats model provenance as acceptance." };
    return { preview, text, current, assert, execution };
  }
  async query(query: Extract<SandboxQuery, { type: "sandbox.publication" | "sandbox.publication.preview" }>): Promise<SandboxResponse> {
    if (query.type === "sandbox.publication.preview") return { type: query.type, preview: (await this.preview(query.executionId, query.paths, AbortSignal.timeout(15_000))).preview };
    const publication = this.record(query.publicationId);
    return { type: query.type, publication, document: this.document(publication), job: this.host.snapshot().jobs.find((job) => job.id === publication.jobId) ?? null,
      operation: publication.operationDigest ? parse(SandboxPublicationResultSchema, JSON.parse(this.store.blob(publication.operationDigest))) : null };
  }
  async execute(command: Extract<SandboxCommand, { type: "sandbox.publish" }>, finish: WorkspaceFinish): Promise<CommandResult> {
    if (!finish.intent) throw new MoguriError("sandbox_intent", "Native source publication needs its actual user command identity before effects.", 409);
    const prior = (this.host.snapshot().sandboxPublications ?? []).find((value) => value.commandId === finish.intent!.id);
    if (prior) {
      if (prior.commandDigest !== finish.intent.digest) throw new MoguriError("idempotency_conflict", "The original native publication command changed.", 409);
      return finish([], { id: prior.id, revision: prior.revision });
    }
    const prepared = await this.preview(command.executionId, command.paths, AbortSignal.timeout(15_000));
    if (prepared.preview.digest !== command.expectedDigest || prepared.execution.revision !== command.expectedRevision) throw new MoguriError("sandbox_publication_stale", "Review the exact current native result and original source bases. No filesystem job was started.", 409);
    const id = randomUUID(), document = prepared.preview.document, now = new Date().toISOString();
    let response: CommandResult | undefined;
    this.host.job(document.projectId, document.workspaceId, async (signal, progress, jobId) => {
      const context = await this.preview(command.executionId, command.paths, signal, jobId, prepared.execution);
      if (context.preview.digest !== command.expectedDigest) throw new MoguriError("sandbox_publication_stale", "Publication scope changed after admission; no stale bytes were copied.", 409);
      for (const edit of document.patch.edits) {
        await context.assert(); await candidateBases(document.root, { ...document.patch, edits: [edit] }); context.current();
        this.update(id, { attemptedPaths: [...this.record(id).attemptedPaths, edit.path] });
        await prepareProjectDirectory(document.root, edit.path, { signal, beforeCreate: context.current,
          created: (path) => this.update(id, { createdDirectories: [...this.record(id).createdDirectories, path] }) });
        await writeProjectFile(document.root, edit.path, edit.text, edit.baseDigest, { signal, beforeCommit: context.current });
        const file = await readProjectFile(document.root, edit.path);
        if (file.digest !== digest(edit.text) || file.bytes !== Buffer.byteLength(edit.text)) throw new MoguriError("sandbox_publication_partial", "Native published file readback changed. Inspect its retained attempt; no rollback or complete success was inferred.", 409);
        this.update(id, { publishedPaths: [...this.record(id).publishedPaths, edit.path] });
        progress(`Verified published output ${edit.path}`);
      }
      await context.assert(); signal.throwIfAborted();
      return { format: "moguri-native-publication-result", version: 1, publicationId: id, root: document.root,
        files: document.patch.edits.map((edit) => ({ path: edit.path, digest: digest(edit.text), bytes: Buffer.byteLength(edit.text) })) };
    }, (job) => {
      const publication: SandboxPublication = { version: 1, id, profileId: this.host.snapshot().profileId, projectId: document.projectId, workspaceId: document.workspaceId,
        executionId: document.executionId, sourceSessionId: prepared.execution.sessionId, root: document.root, inputDigest: document.inputDigest,
        resultDigest: document.resultDigest, documentDigest: this.store.putBlob(prepared.text), paths: document.patch.edits.map((edit) => edit.path),
        revision: 0, createdAt: now, updatedAt: now, jobId: job.id, commandId: finish.intent!.id, commandDigest: finish.intent!.digest,
        status: "publishing", attemptedPaths: [], publishedPaths: [], createdDirectories: [], operationDigest: null, diagnostic: null,
        acceptance: { actor: "user", commandId: finish.intent!.id, commandDigest: finish.intent!.digest, reviewDigest: command.expectedDigest, authorityDigest: document.authorityDigest } };
      response = finish([{ event_type: "artifact.revised", profile_id: publication.profileId, project_id: publication.projectId, payload: { artifact: this.host.artifact(publication) } },
        this.event(publication), { event_type: "job.started", profile_id: publication.profileId, project_id: publication.projectId, payload: { job: { ...job, sandboxPublicationId: id } } }], { id, revision: 0 });
    }, () => this.host.wake(), {
      completed: (value, operationDigest) => {
        const result = parse(SandboxPublicationResultSchema, value), record = this.record(id);
        if (record.stopRequested || record.status !== "publishing" || record.publishedPaths.length !== record.paths.length || result.publicationId !== id || result.root !== document.root ||
          JSON.stringify(result.files) !== JSON.stringify(document.patch.edits.map((edit) => ({ path: edit.path, digest: digest(edit.text), bytes: Buffer.byteLength(edit.text) })))) throw new MoguriError("sandbox_publication_partial", "Native publication bytes or original ownership were not completely acknowledged.", 409);
        return [this.event({ ...record, revision: record.revision + 1, updatedAt: new Date().toISOString(), status: "completed", operationDigest })];
      },
      failed: (error, cancelled) => {
        const record = this.record(id), possible = record.attemptedPaths.length > 0 || record.createdDirectories.length > 0;
        const diagnostic = (error instanceof MoguriError ? error.message : cancelled ? "Actual user stopped native publication." : "Native publication filesystem work failed. Inspect its original attempts and copied files before a new review.").slice(0, 3900);
        const status = possible ? "partial" : cancelled ? "stopped" : "failed";
        return { events: [this.event({ ...record, revision: record.revision + 1, updatedAt: new Date().toISOString(), status, diagnostic })],
          status: status === "stopped" ? "cancelled" : status, error: diagnostic };
      },
    });
    if (!response) throw new MoguriError("sandbox_publication_intent", "Native publication intent was not durably acknowledged. No successful copy was inferred.", 409);
    return response;
  }
  recover(): EventInput[] {
    return (this.host.snapshot().sandboxPublications ?? []).filter((record) => record.status === "publishing").map((record) =>
      this.event({ ...record, revision: record.revision + 1, updatedAt: new Date().toISOString(), status: "partial",
        diagnostic: "Controller restarted during original native source publication. Exact attempts and copied paths remain retained; no file, job or acceptance was replayed." }));
  }
}
