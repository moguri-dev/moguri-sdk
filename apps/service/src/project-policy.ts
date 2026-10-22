import { isAbsolute, normalize, relative, resolve } from "node:path";
import { isPasteFilePath, MoguriError, type ProjectSettings, type Session, type ToolCall } from "../../../packages/protocol/src/index.ts";
import { readProjectFile, scopedPath } from "./files.ts";

export interface FolderPolicy { denied: string[]; readOnly: string[] }
const key = (path: string) => {
  const value = normalize(path).replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/$/, "");
  return process.platform === "darwin" ? value.toLowerCase() : value;
};
export function folderPolicy(settings: ProjectSettings): FolderPolicy { return { denied: settings.deniedFolders, readOnly: settings.readOnlyFolders }; }
export function matchesFolder(path: string, folders: string[]): boolean {
  return folders.some((folder) => {
    const prefix = key(folder);
    return prefix === "." || prefix === "" || key(path) === prefix || key(path).startsWith(`${prefix}/`);
  });
}
export function assertFolderName(path: string, write: boolean, policy: FolderPolicy): void {
  if (matchesFolder(path, policy.denied) || write && matchesFolder(path, policy.readOnly)) throw new MoguriError("folder_denied", write ? "This target is denied or read-only under project policy." : "This folder is denied under project policy.", 403);
}
export function validateProjectPath(path: string): void {
  if (isAbsolute(path) || normalize(path).split(/[\\/]/).includes("..")) throw new MoguriError("project_path", "Project paths must remain relative to the attached folder.");
}
export async function assertFolderAccess(root: string, input: string, write: boolean, policy: FolderPolicy): Promise<void> {
  const path = input === "." ? root : await scopedPath(root, input, write);
  const name = relative(root, path) || ".";
  assertFolderName(name, write, policy);
}
export const readTools = new Set(["list_files", "read_file", "memory_search", "ask_user", "task_progress"]);
export async function assertSessionTool(session: Session, root: string | null, settings: ProjectSettings, call: ToolCall, inspectFilesystem = true): Promise<void> {
  if ((session.mode === "read-only" || session.pendingMode === "read-only" || session.kind === "side") && !readTools.has(call.name)) throw new MoguriError("read_only", "This session is question/read-only. Edit, shell, MCP execution, Git and evolution tools are disabled.", 403);
  if (typeof call.arguments.path === "string" && isPasteFilePath(call.arguments.path)) {
    if (call.name !== "read_file") throw new MoguriError("attachment_read_only", "Scoped pasted files are immutable and are not project paths.", 403);
    return;
  }
  const policy = folderPolicy(settings);
  if (!root && ["list_files", "read_file", "write_file", "run_command", "memory_search", "propose_skill", "propose_script", "propose_memory"].includes(call.name)) throw new MoguriError("project_required", "Select a project for workspace files, commands or repository knowledge. No previous root was reused.", 403);
  if (root && ["list_files", "read_file", "write_file"].includes(call.name)) {
    if (inspectFilesystem) await assertFolderAccess(root, String(call.arguments.path), call.name === "write_file", policy);
    else { validateProjectPath(String(call.arguments.path)); assertFolderName(String(call.arguments.path), call.name === "write_file", policy); }
  }
  if ((call.name === "run_command" || call.name === "mcp_gateway") && (policy.denied.length || policy.readOnly.length)) throw new MoguriError("folder_containment", "Host shell/MCP execution cannot enforce these folder restrictions. A qualified containment broker is required; no Local bypass.", 403);
}
export async function readOptionalProjectFile(root: string, path: string, policy?: FolderPolicy): Promise<string | null> {
  try {
    if (policy) { assertFolderName(path, false, policy); await assertFolderAccess(root, path, false, policy); }
    return (await readProjectFile(root, path)).text;
  } catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") return null; throw error; }
}
export async function repositoryContext(root: string, values: ProjectSettings): Promise<string> {
  const content = values.instructions || (await readOptionalProjectFile(root, values.instructionsPath, folderPolicy(values)) ??
    (values.instructionsPath === "AGENTS.md" ? await readOptionalProjectFile(root, "Agents.md", folderPolicy(values)) : null) ?? "");
  return content ? `\n<untrusted-repository-instructions>\n${content}\n</untrusted-repository-instructions>` : "";
}
export function relativeProjectPath(root: string, input: string): string {
  return relative(root, resolve(root, input)) || ".";
}
