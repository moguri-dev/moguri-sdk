import { ClientError } from "../../client/src/index.ts";
import type { MoguriSdk } from "./index.ts";

/**
 * `!command` in a chat composer is a shell line for the chat's own user console, never a prompt, steer, queue item or
 * model call. Returns the command text, or null when the draft is not a shell line.
 */
export function parseShellCommand(text: string): string | null {
  return text.startsWith("!") ? text.slice(1).trim() : null;
}

/**
 * Types one line plus Enter into this chat's private user console, as if the user typed it there. It reuses the chat's
 * running console at its project folder (or Home for a project-free chat) and opens one only when none is running.
 * The service still enforces the console's exact root, Env policy and owner; the line is never replayed or recorded.
 */
export async function runInTerminal(sdk: MoguriSdk, sessionId: string, command: string, signal?: AbortSignal): Promise<{ terminalId: string; root: string | null; opened: boolean }> {
  const line = command.trim();
  if (!line) throw new ClientError("terminal_command", "Type a command after ! to run it in this chat's terminal. Nothing was run.");
  if (/[\r\n]/.test(line)) throw new ClientError("terminal_command", "Run one line at a time after !. Nothing was run.");
  const snapshot = sdk.getState().snapshot, session = snapshot?.sessions.find((value) => value.id === sessionId);
  if (!snapshot || !session) throw new ClientError("session_missing", "Choose an existing chat. Nothing was run.");
  if (session.status === "archived") throw new ClientError("terminal_session", "Restore this chat before using its terminal. Nothing was run.");
  const env = session.controls.env;
  if (env === "Sandbox") throw new ClientError("terminal_env", "Sandbox chats have no interactive terminal. Switch Env to Local or Remote to use !. Nothing was run.");
  // Like the Terminal panel: a project chat's console must sit at its project or worktree; a project-free console at its captured Home.
  const projectRoot = env !== "Local" || session.repositories || !session.projectId ? null : session.workspaceId ?
    snapshot.managedWorkspaces.find((workspace) => workspace.id === session.workspaceId)?.path ?? null : snapshot.projects.find((project) => project.id === session.projectId)?.path ?? null;
  const running = snapshot.terminals.findLast((terminal) => terminal.sessionId === session.id && terminal.status === "running" && terminal.env === env &&
    (projectRoot === null || terminal.binding?.root === projectRoot));
  let terminalId = running?.id, opened = false;
  if (!terminalId) {
    if (session.repositories) throw new ClientError("terminal_root", "This chat spans several repositories. Open its Terminal, choose one, then run the command again. Nothing was run.");
    const home = session.projectId ? undefined : (await sdk.terminal.defaultRoot()).root;
    signal?.throwIfAborted();
    const result = await sdk.terminal.open(session.id, 80, 24, undefined, home);
    if (!result.id) throw new ClientError("terminal_open", "The terminal did not report its identity. Nothing was typed.");
    terminalId = result.id; opened = true;
    for (let waited = 0; sdk.getState().snapshot?.terminals.find((terminal) => terminal.id === terminalId)?.status !== "running"; waited += 50) {
      if (waited >= 10_000) throw new ClientError("terminal_open", "The terminal did not start in time. Nothing was typed; open the Terminal panel to inspect it.");
      signal?.throwIfAborted();
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  await sdk.terminal.input(terminalId, `${line}\r`, signal);
  const terminal = sdk.getState().snapshot?.terminals.find((value) => value.id === terminalId);
  return { terminalId, root: terminal?.binding?.root ?? projectRoot, opened };
}
