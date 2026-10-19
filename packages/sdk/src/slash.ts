import { ClientError } from "../../client/src/index.ts";
import type { MoguriSdk } from "./index.ts";

export type SessionPanel = "Terminal" | "Browser" | "Insights" | "PR" | "Changes" | "Plan" | "Side chat";
export type SlashResult =
  | { kind: "ok"; message: string }
  | { kind: "session"; sessionId: string; side: boolean }
  | { kind: "panel"; panel: SessionPanel | "Settings" | "Models" | "Queue"; url?: string; path?: string; text?: string }
  | { kind: "text"; text: string }
  | { kind: "copy"; text: string };
export const slashCommands = [
  { name: "read-only", description: "Answer questions with edit and execution tools disabled" },
  { name: "agent", description: "Return to agent mode at the next safe steer boundary" },
  { name: "rename", description: "Rename this session", argument: "NAME" },
  { name: "side", description: "Open parallel, question-only context" },
  { name: "subsession", description: "Create an attached agent session", argument: "[NAME]" },
  { name: "terminal", aliases: ["termnial"], description: "Open an embedded Ghostty terminal", desktopOnly: true },
  { name: "browser", description: "Open a preview browser", argument: "[URL]" },
  { name: "diff", description: "Read local file changes" },
  { name: "plan", description: "Open the project plan" },
  { name: "insights", description: "Inspect session metadata and usage" },
  { name: "pr", description: "Open the connected pull request" },
  { name: "copy", description: "Copy a queued or sent prompt", argument: "[ID]" },
  { name: "queue", description: "Show queued prompts" },
  { name: "run", description: "Release a held prompt", argument: "ID" },
  { name: "settings", description: "Open shared settings" },
  { name: "models", description: "Choose a Copilot model" },
  { name: "help", description: "List slash commands" },
] as const;
export function parseSlash(text: string): { name: string; argument: string } | null {
  if (!text.startsWith("/")) return null;
  const [first, ...rest] = text.trim().split(/\s+/);
  const name = first!.slice(1);
  return { name: name === "termnial" ? "terminal" : name, argument: rest.join(" ") };
}
export const isSharedSlash = (name: string): boolean => slashCommands.some((command) => command.name === name || "aliases" in command && command.aliases.some((alias) => alias === name));
export async function executeSlash(sdk: MoguriSdk, sessionId: string, text: string, client: "desktop" | "tui" | "cli"): Promise<SlashResult> {
  const command = parseSlash(text);
  if (!command) throw new ClientError("slash", "Use a slash command beginning with /.");
  const session = sdk.getState().snapshot?.sessions.find((session) => session.id === sessionId);
  if (!session) throw new ClientError("session_missing", "Choose an existing session.");
  switch (command.name) {
    case "read-only":
    case "agent": {
      if (command.argument) throw new ClientError("slash_arguments", "Use /read-only or /agent without extra arguments.");
      await sdk.sessions.mode(session.id, command.name === "agent" ? "agent" : "read-only");
      return { kind: "ok", message: session.turnId ? "Mode requested for the next safe steer boundary. New edit approvals are restricted immediately." : `Session mode: ${command.name === "agent" ? "agent" : "read-only"}.` };
    }
    case "rename":
      if (!command.argument) throw new ClientError("slash_arguments", "Use /rename NAME.");
      await sdk.sessions.rename(sessionId, command.argument); return { kind: "ok", message: "Renamed." };
    case "side":
    case "subsession": {
      const side = command.name === "side";
      const result = await sdk.sessions.spawn(sessionId, side ? "side" : "agent", command.argument || undefined);
      return { kind: "session", sessionId: result.id!, side };
    }
    case "terminal":
      if (client !== "desktop") throw new ClientError("terminal_context", "This client is already a terminal. /terminal and /termnial open Ghostty only in desktop.");
      return { kind: "panel", panel: "Terminal" };
    case "browser": {
      let url = command.argument || session.browserUrl;
      if (!url) {
        const { configuration } = await sdk.projects.configuration(session.projectId);
        if (configuration.values.port) url = `http://127.0.0.1:${configuration.values.port}/`;
      }
      if (url) await sdk.sessions.browser(sessionId, url);
      if (!url && client !== "desktop") throw new ClientError("browser_url", "Use /browser URL or configure this project's preview port.");
      return { kind: "panel", panel: "Browser", ...(url ? { url } : {}) };
    }
    case "diff": {
      if (client === "desktop") return { kind: "panel", panel: "Changes" };
      const result = await sdk.projects.git(session.projectId);
      return { kind: "text", text: `${result.branch}\n${result.status}\n\n${result.diff || "No tracked diff. Untracked files are listed above."}` };
    }
    case "plan": {
      if (client === "desktop") return { kind: "panel", panel: "Plan" };
      const result = await sdk.plans.read(session.id);
      const project = sdk.getState().snapshot!.projects.find((project) => project.id === session.projectId)!;
      if (!result.exists) throw new ClientError("plan_missing", `No plan file at ${result.path}. Save one explicitly first.`);
      return { kind: "panel", panel: "Plan", path: `${project.path.replace(/\/$/, "")}/${result.path}`, text: result.text };
    }
    case "insights": return { kind: "panel", panel: "Insights" };
    case "pr": {
      const url = session.prUrl ?? sdk.getState().snapshot?.issues.find((issue) => issue.id === session.workItemId)?.pullRequest?.url;
      if (!url) throw new ClientError("pr_missing", "This session has no connected PR.");
      return { kind: "panel", panel: "PR", url };
    }
    case "copy": return { kind: "copy", text: sdk.prompts.text(sessionId, command.argument || undefined) };
    case "queue": return { kind: "panel", panel: "Queue", text: JSON.stringify(session.queue, null, 2) };
    case "run": {
      if (!command.argument) throw new ClientError("slash_arguments", "Use /run QUEUED_PROMPT_ID.");
      await sdk.prompts.release(sessionId, command.argument, session.queueRevision); return { kind: "ok", message: "Released for admission." };
    }
    case "settings": return { kind: "panel", panel: "Settings" };
    case "models": return { kind: "panel", panel: "Models" };
    case "help": return { kind: "text", text: slashCommands.map((entry) => `/${entry.name}${"argument" in entry ? ` ${entry.argument}` : ""}  ${entry.description}`).join("\n") };
    default: throw new ClientError("unknown_slash", "Unknown shared slash command. Use /help.");
  }
}
