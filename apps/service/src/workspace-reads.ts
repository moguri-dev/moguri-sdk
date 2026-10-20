import { listProjectFiles, readProjectFile } from "./files.ts";
import { readWorkspaceGit } from "./project-git.ts";
import { assertFolderAccess, matchesFolder, readOptionalProjectFile, validateProjectPath } from "./project-policy.ts";
import type { WorkspaceReadRequest, WorkspaceReadResult } from "./remote-protocol.ts";

export async function readWorkspace(root: string, requested: WorkspaceReadRequest, signal: AbortSignal): Promise<WorkspaceReadResult> {
  signal.throwIfAborted();
  const { query, policy } = structuredClone(requested), folders = { denied: policy.deniedFolders, readOnly: [] };
  let result: WorkspaceReadResult;
  if (query.type === "session.git") result = { ...await readWorkspaceGit(root, policy, query.diff, signal), type: query.type };
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
