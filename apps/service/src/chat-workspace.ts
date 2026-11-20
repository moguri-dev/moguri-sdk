import { realpathSync } from "node:fs";
import { isAbsolute } from "node:path";
import { isPasteFilePath, MoguriError, type Session, type SessionHomeRoot, type ToolCall } from "../../../packages/protocol/src/index.ts";
import { sameDurableIdentity, sourceRootSync } from "./repository-source.ts";
import { fileTools, fileWriteTools } from "./project-policy.ts";
import { isBrowserTool } from "../../../packages/protocol/src/browser.ts";

export function homeChat(session: Pick<Session, "projectId" | "repositories" | "kind" | "readOnly">): boolean {
  return session.projectId === null && !session.repositories && !session.readOnly && ["agent", "side"].includes(session.kind);
}
export function homeWorkspace(session: Pick<Session, "projectId" | "repositories" | "kind" | "readOnly" | "homeRoot" | "controls">): boolean {
  return homeChat(session) && session.controls.env === "Local" && Boolean(session.homeRoot);
}
export function captureChatHome(root: string): SessionHomeRoot {
  if (!isAbsolute(root) || /[\0\r\n]/.test(root)) throw new MoguriError("chat_home", "Home must be an explicit absolute Local directory. No project or state-directory fallback was used.");
  return sourceRootSync(realpathSync(root));
}
export function assertChatHome(root: SessionHomeRoot): string {
  let actual: SessionHomeRoot;
  try { actual = sourceRootSync(root.root); }
  catch (error) {
    if (!(error instanceof MoguriError) && !(error instanceof Error && "code" in error && ["ENOENT", "ENOTDIR", "EACCES", "ELOOP"].includes(String(error.code)))) throw error;
    throw new MoguriError("chat_home_changed", "This chat's original Home directory is unavailable or no longer canonical. Inspect it or start a new chat; no replacement, previous project or state root was used.", 409);
  }
  if (!sameDurableIdentity(root, actual)) throw new MoguriError("chat_home_changed", "This chat's original Home directory identity changed. No newer or replacement directory was used.", 409);
  return actual.root;
}
export function homeWriteTool(call: ToolCall): boolean {
  return fileWriteTools.has(call.name) || ["run_command", "command_job", "debug"].includes(call.name) ||
    call.name === "mcp_gateway" && call.arguments.action === "call" &&
    !(call.arguments.serverId === "builtin" && (call.arguments.tool === "fetch_page" || isBrowserTool(String(call.arguments.tool))));
}
export function homeDirectoryTool(call: ToolCall): boolean {
  return homeWriteTool(call) || fileTools.has(call.name) &&
    !(call.name === "read_file" && typeof call.arguments.path === "string" && isPasteFilePath(call.arguments.path));
}
