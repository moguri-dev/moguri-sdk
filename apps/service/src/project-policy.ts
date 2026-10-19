import { isAbsolute, normalize, relative, resolve } from "node:path";
import { MoguriError, type ProjectSettings, type Session, type ToolCall } from "../../../packages/protocol/src/index.ts";
import { scopedPath } from "./files.ts";

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
export const readTools = new Set(["list_files", "read_file", "memory_search"]);
export async function assertSessionTool(session: Session, root: string | null, settings: ProjectSettings, call: ToolCall): Promise<void> {
  if ((session.mode === "read-only" || session.pendingMode === "read-only" || session.kind === "side") && !readTools.has(call.name)) throw new MoguriError("read_only", "This session is question/read-only. Edit, shell, MCP execution, Git and evolution tools are disabled.", 403);
  const policy = folderPolicy(settings);
  if (!root && ["list_files", "read_file", "write_file", "run_command", "memory_search", "propose_skill", "propose_script", "propose_memory"].includes(call.name)) throw new MoguriError("project_required", "Select a project for workspace files, commands or repository knowledge. No previous root was reused.", 403);
  if (root && ["list_files", "read_file", "write_file"].includes(call.name)) await assertFolderAccess(root, String(call.arguments.path), call.name === "write_file", policy);
  if ((call.name === "run_command" || call.name === "mcp_gateway") && (policy.denied.length || policy.readOnly.length)) throw new MoguriError("folder_containment", "Host shell/MCP execution cannot enforce these folder restrictions. A qualified containment broker is required; no Local bypass.", 403);
}
export function relativeProjectPath(root: string, input: string): string {
  return relative(root, resolve(root, input)) || ".";
}
