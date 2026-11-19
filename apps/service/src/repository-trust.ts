import { randomUUID } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import { basename, isAbsolute, join, relative } from "node:path";
import { Value } from "typebox/value";
import {
  MoguriError, REPOSITORY_TRUST_WARNING, RepositoryTrustBaselineSchema,
  type EventInput, type Project, type ProjectSettings, type RepositoryTrustBaseline, type RepositoryTrustCommand,
  type RepositoryTrustPreview, type RepositoryTrustRecord, type ScriptExecution, type Session, type Snapshot,
  type StoredEvent, type ToolCall, type TrustedScriptAttempt, type TrustedScriptTool,
} from "../../../packages/protocol/src/index.ts";
import { SCRIPT_REVIEW_MAX_BYTES } from "../../../packages/protocol/src/script-reviews.ts";
import { bytesDigest, isPrivateContextPath, readRegularFileSync, scopedPathSync } from "./files.ts";
import { assertFolderAccess, assertFolderName, folderPolicy, matchesFolder, type FolderPolicy } from "./project-policy.ts";
import { sameDurableRoot, sourceRoot } from "./repository-source.ts";
import { runProgram } from "./program.ts";
import { digest, type EventStore } from "./store.ts";
import type { ScriptReviewScope } from "./script-reviews.ts";
import type { WorkspaceFinish } from "./session-workspace.ts";

interface Host {
  snapshot(): Snapshot;
  events(): StoredEvent[];
  project(id: string): Project;
  settings(id: string): ProjectSettings;
  scope(session: Session, path: string, repository?: string): ScriptReviewScope;
  commit(events: EventInput[]): void;
}
const dependencyNames = ["package.json", "package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "pnpm-workspace.yaml",
  "yarn.lock", "bun.lock", "bun.lockb", "pyproject.toml", "requirements.txt", "Pipfile", "Pipfile.lock", "poetry.lock",
  "uv.lock", "Gemfile", "Gemfile.lock", "composer.json", "composer.lock", "Cargo.toml", "Cargo.lock", "go.mod", "go.sum"];
const scriptPath = (path: string) => /\.(?:sh|bash|zsh|[cm]?[jt]s|py|rb|pl|php|ps1)$/i.test(path);
const normalizedPath = (path: string) => !isAbsolute(path) && !path.includes("\0") && !path.split(/[\\/]/).some((part) => !part || part === "." || part === "..");
export class RepositoryTrust {
  constructor(private readonly store: EventStore, private readonly host: Host) {}
  private current(projectId: string): RepositoryTrustRecord | undefined {
    return this.host.snapshot().repositoryTrusts.find((trust) => trust.projectId === projectId);
  }
  private unsafe(projectId: string, path: string, sourceDigest: string) {
    const latest = this.host.snapshot().scriptReviews.findLast((review) =>
      (review.repositoryProjectId ?? review.projectId) === projectId && review.source.path === path && review.source.digest === sourceDigest && review.advice);
    return latest?.advice?.verdict === "unsafe" ? latest : undefined;
  }
  private policy(projectId: string): string {
    const snapshot = this.host.snapshot();
    return digest(JSON.stringify([snapshot.profileId, this.host.project(projectId).path, snapshot.policy,
      snapshot.settings.permissionRevision, folderPolicy(this.host.settings(projectId))]));
  }
  private allowed() {
    if (!this.host.snapshot().policy.allowedEnvs.includes("Local")) throw new MoguriError("repository_trust_env", "Repository trust inspects only the explicit Local project. Local is excluded by policy; no Remote or native root was substituted.", 403);
  }
  private git(root: string, args: string[], signal: AbortSignal) {
    return runProgram("git", ["--no-pager", "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null",
      "-c", "submodule.recurse=false", "--literal-pathspecs", ...args], { cwd: root, signal, timeoutMs: 15_000, maxBytes: 2 * 1024 * 1024,
      label: "Repository trust metadata", env: { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" } });
  }
  private async identity(root: string, signal: AbortSignal) {
    const binding = await sourceRoot(root);
    let metadata;
    try { metadata = await lstat(join(root, ".git")); }
    catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") throw new MoguriError("repository_trust_not_found", "Git repository not found at this exact Local root. Import an actual Git root before trusting existing scripts; no parent repository was adopted.", 404);
      throw error;
    }
    if (metadata.isSymbolicLink() || !metadata.isFile() && !metadata.isDirectory()) throw new MoguriError("repository_trust_root", "Trust requires the actual imported Git root, not a parent repository or symlink.", 409);
    if (await realpath((await this.git(root, ["rev-parse", "--show-toplevel"], signal)).trim()) !== root) throw new MoguriError("repository_trust_root", "Trust cannot adopt a parent repository or widen the imported root.", 409);
    const repository = await sourceRoot(await realpath((await this.git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"], signal)).trim()));
    return { binding, repository };
  }
  private async dependencies(root: string, signal: AbortSignal, folders: FolderPolicy): Promise<RepositoryTrustBaseline["dependencies"]> {
    const listed = (await this.git(root, ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], signal)).split("\0").filter(Boolean);
    if (listed.length > 20_000) throw new MoguriError("repository_trust_limit", "This repository exceeds the 20,000-path trust boundary. No partial baseline was accepted.", 413);
    const paths = [...new Set([...dependencyNames, ...listed.filter((path) => dependencyNames.includes(basename(path)))])].sort();
    const inputs: RepositoryTrustBaseline["dependencies"] = [];
    for (const path of paths) {
      signal.throwIfAborted();
      if (!normalizedPath(path) || isPrivateContextPath(path)) throw new MoguriError("repository_trust_dependency", "A dependency input uses a private, package-owned or aliased path. No dependency trust was inferred.", 403);
      assertFolderName(path, false, folders);
      try { inputs.push({ path, digest: bytesDigest(readRegularFileSync(scopedPathSync(root, path), 8 * 1024 * 1024)) }); }
      catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") inputs.push({ path, digest: null });
        else throw error;
      }
    }
    return inputs;
  }
  private async capture(projectId: string, signal: AbortSignal): Promise<RepositoryTrustBaseline> {
    this.allowed();
    const project = this.host.project(projectId), policy = this.policy(projectId), { binding, repository } = await this.identity(project.path, signal);
    const head = (await this.git(project.path, ["rev-parse", "--verify", "HEAD^{commit}"], signal)).trim();
    const tree = (await this.git(project.path, ["ls-tree", "-r", "-z", "--full-tree", "HEAD"], signal)).split("\0").filter(Boolean);
    if (tree.length > 20_000) throw new MoguriError("repository_trust_limit", "Review at most 20,000 tracked paths in one exact baseline. Nothing was truncated or trusted.", 413);
    const files: RepositoryTrustBaseline["files"] = [], excluded: RepositoryTrustBaseline["excluded"] = [];
    const folders = folderPolicy(this.host.settings(projectId));
    let bytes = 0;
    for (const entry of tree) {
      signal.throwIfAborted();
      const tab = entry.indexOf("\t"), path = entry.slice(tab + 1), mode = entry.slice(0, 6);
      if (tab < 0 || !normalizedPath(path)) throw new MoguriError("repository_trust_path", "Git returned an unsupported source path. No partial baseline was accepted.", 409);
      if (!["100644", "100755"].includes(mode) || isPrivateContextPath(path) || matchesFolder(path, folders.denied) ||
        !scriptPath(path) && mode !== "100755") {
        excluded.push({ path, reason: "Not an eligible regular repository script, or excluded by folder/private-path policy." }); continue;
      }
      try {
        const content = readRegularFileSync(scopedPathSync(project.path, path), SCRIPT_REVIEW_MAX_BYTES);
        const text = content.toString("utf8");
        if (content.includes(0) || !Buffer.from(text).equals(content)) throw new MoguriError("file_limit", "Only complete UTF-8 scripts can be trusted.");
        if ((bytes += content.length) > 64 * 1024 * 1024) throw new MoguriError("repository_trust_limit", "Repository script sources exceed 64 MiB. No partial baseline was accepted.", 413);
        const sourceDigest = bytesDigest(content);
        if (this.unsafe(projectId, path, sourceDigest)) {
          excluded.push({ path, reason: "The latest exact assessment is unsafe. Repository trust cannot replace its separate actual-user force." }); continue;
        }
        files.push({ path, digest: sourceDigest, bytes: content.length });
      } catch (error) {
        if (error instanceof MoguriError && ["path_denied", "file_limit"].includes(error.code) ||
          error instanceof Error && "code" in error && error.code === "ENOENT") {
          excluded.push({ path, reason: "Missing, aliased, binary or larger than the complete 512 KiB script limit." }); continue;
        }
        throw error;
      }
    }
    const dependencies = await this.dependencies(project.path, signal, folders);
    const after = await this.identity(project.path, signal);
    signal.throwIfAborted();
    if (this.policy(projectId) !== policy || JSON.stringify(after) !== JSON.stringify({ binding, repository }) ||
      (await this.git(project.path, ["rev-parse", "--verify", "HEAD^{commit}"], signal)).trim() !== head) {
      throw new MoguriError("repository_trust_stale", "The actual repository, HEAD or policy changed during capture. Review the current source again.", 409);
    }
    const baseline = { profileId: this.host.snapshot().profileId, projectId, root: binding, repository, head,
      files: files.sort((a, b) => a.path.localeCompare(b.path)), dependencies, excluded: excluded.sort((a, b) => a.path.localeCompare(b.path)) };
    if (!Value.Check(RepositoryTrustBaselineSchema, baseline) || Buffer.byteLength(JSON.stringify(baseline)) > 2 * 1024 * 1024 - 2048) {
      throw new MoguriError("repository_trust_limit", "The full baseline exceeds its exact schema or 2 MiB metadata envelope. Nothing was truncated or trusted.", 413);
    }
    return baseline;
  }
  async preview(projectId: string, signal: AbortSignal): Promise<RepositoryTrustPreview> {
    const expectedRevision = this.current(projectId)?.revision ?? -1, baseline = await this.capture(projectId, signal);
    if ((this.current(projectId)?.revision ?? -1) !== expectedRevision) throw new MoguriError("repository_trust_revision", "Repository trust changed during preview. Review the current baseline again.", 409);
    return { ...baseline, baselineDigest: digest(JSON.stringify(baseline)), expectedRevision, warning: REPOSITORY_TRUST_WARNING };
  }
  async execute(command: RepositoryTrustCommand, commandId: string, signal: AbortSignal, finish: WorkspaceFinish) {
    this.host.project(command.projectId);
    const previous = this.current(command.projectId);
    if ((previous?.revision ?? -1) !== command.expectedRevision) throw new MoguriError("repository_trust_revision", "Repository trust changed in another client. Review the current revision before deciding.", 409);
    let trust: RepositoryTrustRecord;
    if (command.type === "repository.trust.approve") {
      const baseline = await this.capture(command.projectId, signal), baselineDigest = digest(JSON.stringify(baseline));
      if (baselineDigest !== command.baselineDigest) throw new MoguriError("repository_trust_stale", "The repository source, dependency inputs or exact root changed after preview. Review the full current baseline; nothing was trusted.", 409);
      this.store.putBlob(JSON.stringify(baseline));
      trust = { id: previous?.id ?? randomUUID(), profileId: baseline.profileId, projectId: baseline.projectId,
        revision: (previous?.revision ?? -1) + 1, baselineDigest, root: baseline.root, repository: baseline.repository, head: baseline.head,
        files: baseline.files.length, status: "trusted", actor: "user", commandId, at: new Date().toISOString() };
    } else {
      if (!previous || previous.status !== "trusted") throw new MoguriError("repository_trust_revision", "Only the exact current trusted baseline can be revoked.", 409);
      trust = { ...previous, revision: previous.revision + 1, status: "revoked", commandId, at: new Date().toISOString() };
    }
    signal.throwIfAborted();
    if ((this.current(command.projectId)?.revision ?? -1) !== command.expectedRevision) throw new MoguriError("repository_trust_revision", "Another client changed trust during this decision. Its choice was preserved.", 409);
    return finish([{ event_type: "repository.trust_recorded", profile_id: trust.profileId, project_id: trust.projectId, payload: { trust } }],
      { id: trust.id, revision: trust.revision });
  }
  async reserve(session: Session, call: ToolCall, input: TrustedScriptTool, stepId: string, signal: AbortSignal, repository?: string): Promise<ScriptExecution> {
    this.allowed(); signal.throwIfAborted();
    if (session.controls.env !== "Local" || !session.turnId || session.mode !== "agent" || session.pendingMode || session.toolRecovery?.turnId === session.turnId) {
      throw new MoguriError("repository_trust_owner", "Trusted scripts need their actual active Local model turn. Trust cannot grant a new owner or bypass read-only mode.", 403);
    }
    const scope = this.host.scope(session, input.path, repository), projectId = scope.repositoryProjectId ?? session.projectId;
    if (!scope.root || !projectId) throw new MoguriError("repository_trust_root", "Trust requires the exact project/worktree, never a project-free Home or another root.", 403);
    const trust = this.current(projectId);
    if (!trust || trust.status !== "trusted") throw new MoguriError("repository_trust_required", "This script has no current actual-user repository trust. Inspect the full source with review_script first.", 403);
    const original = this.store.blob(trust.baselineDigest), parsed: unknown = JSON.parse(original);
    if (digest(original) !== trust.baselineDigest || !Value.Check(RepositoryTrustBaselineSchema, parsed)) throw new MoguriError("repository_trust_corrupt", "The original exact trust baseline is unavailable. No replacement source was adopted.", 409);
    const baseline = parsed, policy = this.policy(projectId);
    const actual = await this.identity(scope.root, signal);
    if (baseline.projectId !== projectId || baseline.profileId !== this.host.snapshot().profileId ||
      !sameDurableRoot(baseline.root, await sourceRoot(this.host.project(projectId).path)) ||
      !sameDurableRoot(baseline.repository, actual.repository)) {
      throw new MoguriError("repository_trust_root", "Repository trust lost its exact original project or Git identity. No alternate checkout was trusted.", 409);
    }
    await assertFolderAccess(scope.root, input.path, false, scope.folders);
    const path = relative(scope.root, scopedPathSync(scope.root, input.path)), entry = baseline.files.find((file) => file.path === path);
    if (!entry || !normalizedPath(path)) throw new MoguriError("repository_trust_required", "This new, generated, package-owned or unsupported script is outside the actual-user baseline. Inspect its complete source with review_script first.", 403);
    const content = readRegularFileSync(scopedPathSync(scope.root, path), SCRIPT_REVIEW_MAX_BYTES), sourceDigest = bytesDigest(content);
    if (sourceDigest !== entry.digest || content.length !== entry.bytes) throw new MoguriError("repository_trust_changed", "The script changed after repository trust. Review the entire new source with review_script; the baseline was not enlarged.", 403);
    const unsafe = this.unsafe(projectId, path, sourceDigest);
    if (unsafe) throw new MoguriError("repository_trust_unsafe", `The exact script has retained unsafe assessment ${unsafe.id}. Report its findings; repository trust does not replace the original separate actual-user force or grant another execution.`, 403);
    if (JSON.stringify(await this.dependencies(scope.root, signal, scope.folders)) !== JSON.stringify(baseline.dependencies)) throw new MoguriError("repository_trust_dependencies", "Dependency inputs changed after repository trust. Review the new dependency/script source or explicitly review a fresh baseline; no new package code was trusted.", 403);
    const step = this.host.events().findLast((event) => event.event_type === "model.started" && event.session_id === session.id && event.turn_id === session.turnId && event.step_id === stepId);
    if (!step?.step_id) throw new MoguriError("repository_trust_owner", "Trusted execution has no actual retained owning model step.", 409);
    const rootDigest = digest(JSON.stringify(actual.binding)), inputDigest = digest(JSON.stringify([call.name, call.arguments, policy]));
    const id = digest(JSON.stringify(["repository-trust-attempt", session.id, session.turnId, step.step_id, call.id]));
    const previous = this.host.snapshot().trustedScriptAttempts.find((attempt) => attempt.id === id);
    if (previous && (previous.trustRevision !== trust.revision || previous.baselineDigest !== trust.baselineDigest ||
      previous.sourceDigest !== sourceDigest || previous.rootDigest !== rootDigest || previous.inputDigest !== inputDigest)) {
      throw new MoguriError("repository_trust_attempt", "The original trusted attempt changed. It cannot authorize a different source, policy or replay.", 409);
    }
    const after = await this.identity(scope.root, signal);
    signal.throwIfAborted();
    const currentSession = this.host.snapshot().sessions.find((value) => value.id === session.id);
    if (JSON.stringify(actual) !== JSON.stringify(after) || this.policy(projectId) !== policy ||
      this.current(projectId)?.revision !== trust.revision || this.current(projectId)?.status !== "trusted" ||
      this.unsafe(projectId, path, sourceDigest) ||
      !currentSession || currentSession.turnId !== session.turnId || currentSession.mode !== "agent" || currentSession.pendingMode ||
      currentSession.controls.env !== "Local" || currentSession.workspaceId !== session.workspaceId || currentSession.toolRecovery?.turnId === session.turnId ||
      JSON.stringify(this.host.scope(currentSession, input.path, repository)) !== JSON.stringify(scope)) {
      throw new MoguriError("repository_trust_stale", "Trust, policy or the original root/turn changed before admission. No script was started.", 409);
    }
    if (!previous) {
      this.store.putBlob(content.toString("utf8"));
      const attempt: TrustedScriptAttempt = { id, trustId: trust.id, trustRevision: trust.revision, baselineDigest: trust.baselineDigest,
        profileId: baseline.profileId, projectId, sessionId: session.id, workspaceId: session.workspaceId, turnId: session.turnId,
        stepId: step.step_id, callId: call.id, path, sourceDigest, rootDigest, inputDigest, at: new Date().toISOString() };
      this.host.commit([{ event_type: "repository.script_reserved", profile_id: baseline.profileId, project_id: projectId,
        session_id: session.id, turn_id: session.turnId, step_id: step.step_id, payload: { attempt } }]);
    }
    return { trust: { id: trust.id, revision: trust.revision, baselineDigest: trust.baselineDigest, actor: trust.actor, commandId: trust.commandId },
      path, digest: sourceDigest, rootDigest, interpreter: input.interpreter, args: input.args ?? [], text: content.toString("utf8") };
  }
}
