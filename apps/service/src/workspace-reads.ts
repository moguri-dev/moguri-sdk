import { listProjectFiles, readProjectFile } from "./files.ts";
import { candidateGitState, readGit, readGitBinding, readWorkspaceGit } from "./project-git.ts";
import { assertFolderAccess, matchesFolder, readOptionalProjectFile, validateProjectPath } from "./project-policy.ts";
import type { WorkspaceReadRequest, WorkspaceReadResult } from "./remote-protocol.ts";
import { captureNativeSource, assertNativeSource } from "./native-staging.ts";
import { sourceRoot } from "./repository-source.ts";
import { digest } from "./store.ts";
import { defaultProjectSettings, MoguriError } from "../../../packages/protocol/src/index.ts";
import { checkpointWorkspace } from "./checkpoint-files.ts";
import { sourceRootSync } from "./repository-source.ts";
import { inspectWorkspaceRewind } from "./workspace-rewind-worker.ts";

export async function readWorkspace(root: string, requested: WorkspaceReadRequest, signal: AbortSignal): Promise<WorkspaceReadResult> {
  signal.throwIfAborted();
  const { query, policy } = structuredClone(requested), folders = { denied: policy.deniedFolders, readOnly: [] };
  let result: WorkspaceReadResult;
  if (query.type === "checkpoint.capture") {
    result = { type: query.type, workspace: checkpointWorkspace([{ binding: sourceRootSync(root), repositoryId: null, denied: policy.deniedFolders }]) };
  } else if (query.type === "checkpoint.rewind.inspect") {
    result = { type: query.type, inspection: inspectWorkspaceRewind(root, query.plan, {
      ...defaultProjectSettings(), deniedFolders: policy.deniedFolders, planPath: policy.planPath,
    }, signal) };
  } else if (query.type === "checkpoint.source") {
    const binding = await sourceRoot(root), git = await readGitBinding(root, signal), captured = await captureNativeSource(root, query.paths, folders, signal);
    if (query.branch) {
      if (["main", "master"].includes(query.branch) || query.branch.startsWith("-") || query.branch.startsWith("refs/")) throw new MoguriError("protected_branch", "Choose a new non-protected peer branch.");
      await readGit(root, ["check-ref-format", "--branch", query.branch], signal);
      if ((await readGit(root, ["for-each-ref", "--format=%(refname)", "refs/heads/"], signal)).split("\n").includes(`refs/heads/${query.branch}`)) throw new MoguriError("artifact_branch", "That peer branch already exists. No checkout or ref was changed.", 409);
    }
    const sourceStateDigest = digest(await candidateGitState(root, signal));
    await assertNativeSource(captured, signal);
    if (JSON.stringify(await sourceRoot(root)) !== JSON.stringify(binding) || JSON.stringify(await readGitBinding(root, signal)) !== JSON.stringify(git)) throw new MoguriError("checkpoint_source_changed", "The captured peer root or Git base changed during source review.", 409);
    result = { type: query.type, source: { ...binding, ...git }, sourceStateDigest,
      files: captured.files.map((file) => ({ path: file.path, text: file.text, digest: file.digest, mode: file.mode & 0o111 ? "100755" : "100644" })) };
  } else if (query.type === "session.git") result = { ...await readWorkspaceGit(root, policy, query.diff, signal), type: query.type };
  else if (query.type === "plan.read") {
    validateProjectPath(policy.planPath);
    const text = await readOptionalProjectFile(root, policy.planPath, folders);
    if (text === null) result = { type: query.type, path: policy.planPath, text: "", digest: "absent", exists: false };
    else {
      const file = await readProjectFile(root, policy.planPath);
      result = { type: query.type, path: file.path, text: file.text, digest: file.digest, exists: true };
    }
  } else {
    validateProjectPath(query.path);
    await assertFolderAccess(root, query.path, false, folders);
    result = query.type === "session.files" ?
      { type: query.type, path: query.path, entries: (await listProjectFiles(root, query.path)).filter((entry) => !matchesFolder(entry, policy.deniedFolders)) } :
      { type: query.type, ...await readProjectFile(root, query.path) };
  }
  signal.throwIfAborted();
  return result;
}
