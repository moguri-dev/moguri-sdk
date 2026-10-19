import { ClientError } from "../../client/src/index.ts";
import type { MoguriSdk } from "./index.ts";

export type SessionPanel = "Terminal" | "Browser" | "Insights" | "PR" | "Changes" | "Files" | "Plan" | "Side chat" | "Suggestions" | "Attention";
export type SlashResult =
  | { kind: "ok"; message: string }
  | { kind: "session"; sessionId: string; side: boolean }
  | { kind: "panel"; panel: SessionPanel | "Settings" | "Models" | "Queue"; url?: string; path?: string; text?: string; allProjects?: boolean }
  | { kind: "text"; text: string }
  | { kind: "copy"; text: string };
export const slashCommands = [
  { name: "attach-file", description: "Capture an explicitly selected local UTF-8 file", argument: "ABSOLUTE_PATH" },
  { name: "attach-image", description: "Capture a local PNG/JPEG/WebP; terminal clipboard images need this fallback", argument: "ABSOLUTE_PATH" },
  { name: "attach-folder", description: "Preview an exact folder snapshot, then confirm its digest", argument: "[SHA256] ABSOLUTE_PATH" },
  { name: "attach-github", description: "Preview a typed GitHub issue/PR reference", argument: "[gh-cli] [SHA256] URL" },
  { name: "attach-session", description: "Preview authorized session text without controlling the source", argument: "[SHA256] SESSION_ID" },
  { name: "attached", description: "Inspect an attachment snapshot", argument: "ATTACHMENT_ID" },
  { name: "suggestions", description: "Preview scoped previous prompts and generate reviewed usage improvements", argument: "[all|run DIGEST|run-all DIGEST]" },
  { name: "meta", aliases: ["metachat"], description: "Open a settings-focused chat with reviewed proposals", argument: "[REQUEST]" },
  { name: "attention", description: "Show questions, approvals and finished work; mark read without answering", argument: "[read ID]" },
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
  { name: "remote", description: "Inspect/probe the pinned SSH target or reconcile an existing run", argument: "[probe|reconcile ID|acknowledge ID]" },
  { name: "workspace", description: "Manage an explicit isolated Local checkout", argument: "[list|discover|create BRANCH [BASE]|new ID|bind ID|inspect ID|remove ID|reconcile ID]" },
  { name: "files", description: "Read the session's actual bound directory", argument: "[PATH]" },
  { name: "file", description: "Read one allowed file from the session's actual root", argument: "PATH" },
  { name: "help", description: "List slash commands" },
] as const;
export const attachmentTriggers = { "^": "Local text file", ":": "Folder", "#": "GitHub issue or PR", "!": "Session", "@": "Project file" } as const;
export function parseAttachmentTrigger(text: string): { prefix: keyof typeof attachmentTriggers; query: string; start: number } | null {
  const match = text.match(/(?:^|\s)([@^:#!])([^\s]*)$/);
  if (!match || !(match[1]! in attachmentTriggers)) return null;
  const prefix = match[1] as keyof typeof attachmentTriggers;
  return { prefix, query: match[2]!, start: text.length - match[2]!.length - 1 };
}
export function parseSlash(text: string): { name: string; argument: string } | null {
  if (!text.startsWith("/")) return null;
  const [first, ...rest] = text.trim().split(/\s+/);
  const name = first!.slice(1);
  return { name: name === "termnial" ? "terminal" : name === "metachat" ? "meta" : name, argument: rest.join(" ") };
}
export const isSharedSlash = (name: string): boolean => slashCommands.some((command) => command.name === name || "aliases" in command && command.aliases.some((alias) => alias === name));
export async function executeSlash(sdk: MoguriSdk, sessionId: string, text: string, client: "desktop" | "tui" | "cli"): Promise<SlashResult> {
  const command = parseSlash(text);
  if (!command) throw new ClientError("slash", "Use a slash command beginning with /.");
  const session = sdk.getState().snapshot?.sessions.find((session) => session.id === sessionId);
  if (!session) throw new ClientError("session_missing", "Choose an existing session.");
  switch (command.name) {
    case "workspace": {
      if (!session.projectId) throw new ClientError("project_required", "Select a project before managing its worktrees.");
      const [action, id, baseRef, extra] = command.argument.split(/\s+/), values = sdk.getState().snapshot!.managedWorkspaces.filter((value) => value.projectId === session.projectId);
      if (!action || action === "list") return { kind: "text", text: JSON.stringify({ current: session.workspaceId, workspaces: values }, null, 2) };
      if (action === "discover" && !id) return { kind: "text", text: JSON.stringify(await sdk.workspaces.discover(session.projectId), null, 2) };
      if (action === "create" && id && !extra) { const created = await sdk.workspaces.create(session.projectId, id, { ...(baseRef ? { baseRef } : {}) }); return { kind: "text", text: JSON.stringify(await sdk.workspaces.wait(created.id!), null, 2) }; }
      const workspace = values.find((value) => value.id === id);
      if (action === "bind" && id === "base" && !baseRef) { await sdk.workspaces.bind(session.id, null); return { kind: "ok", message: "Fresh session explicitly bound to the base folder." }; }
      if (!workspace || baseRef) throw new ClientError("workspace_scope", "Choose one exact workspace ID from /workspace list.");
      if (action === "new") { const created = await sdk.sessions.create(session.projectId, workspace.branch, { env: "Local" }, workspace.id); return { kind: "session", sessionId: created.id!, side: false }; }
      if (action === "bind") { await sdk.workspaces.bind(session.id, workspace.id); return { kind: "ok", message: "Fresh session bound to the owned Local worktree." }; }
      if (action === "inspect") return { kind: "text", text: JSON.stringify((await sdk.workspaces.inspect(workspace.id)).inspection, null, 2) };
      if (action === "reconcile") { await sdk.workspaces.reconcile(workspace.id, workspace.revision); return { kind: "ok", message: "Existing workspace inspected/reconciled; no Git effect was replayed." }; }
      if (action === "remove") { await sdk.workspaces.remove(workspace.id, workspace.revision, true); return { kind: "text", text: JSON.stringify(await sdk.workspaces.wait(workspace.id), null, 2) }; }
      throw new ClientError("workspace_action", "Use /workspace list/create/new/bind/inspect/remove/reconcile. Removal preserves branches and refuses bound/dirty roots.");
    }
    case "files": return client === "desktop" && !command.argument ? { kind: "panel", panel: "Files" } : { kind: "text", text: JSON.stringify(await sdk.workspaces.files(session.id, command.argument || "."), null, 2) };
    case "file": {
      if (!command.argument) throw new ClientError("file_path", "Use /file PROJECT_RELATIVE_PATH.");
      return { kind: "text", text: (await sdk.workspaces.file(session.id, command.argument)).text };
    }
    case "remote": {
      const [action, id, extra] = command.argument.split(/\s+/);
      if (!action) return { kind: "text", text: JSON.stringify((await sdk.remote.status()).remote, null, 2) };
      if (action === "probe" && !id) { await sdk.remote.probe(); return { kind: "text", text: JSON.stringify((await sdk.remote.status()).remote, null, 2) }; }
      if (action === "reconcile" && id && !extra) { await sdk.remote.reconcile(id); return { kind: "ok", message: "Existing remote receipts/status reconciled. No effect was replayed; partial turns were not rewritten as successful." }; }
      if (action === "acknowledge" && id && !extra) { await sdk.remote.acknowledge(id, true); return { kind: "ok", message: "Your remote process-inspection acknowledgement was recorded. This does not prove containment or cleanup." }; }
      throw new ClientError("remote_action", "Use /remote, /remote probe, /remote reconcile ID, or only after process inspection /remote acknowledge ID.");
    }
    case "attach-file":
    case "attach-image": {
      if (!command.argument) throw new ClientError("attachment_path", "Choose an explicit absolute file path.");
      const result = await sdk.attachments.file(session.id, command.argument, command.name === "attach-image" ? "image" : "text");
      return { kind: "ok", message: `Captured attachment ${result.id}. No prompt was sent.` };
    }
    case "attach-folder":
    case "attach-github":
    case "attach-session": {
      const useCli = command.name === "attach-github" && command.argument.startsWith("gh-cli ");
      const argument = useCli ? command.argument.slice(7) : command.argument;
      const match = argument.match(/^([a-f0-9]{64})\s+([\s\S]+)$/);
      const target = match?.[2] ?? argument;
      if (!target) throw new ClientError("attachment_source", "Select a folder, canonical reference URL or source session ID.");
      const access = useCli ? "gh-cli" : "public";
      if (match) {
        const result = command.name === "attach-folder" ? await sdk.attachments.folder(session.id, target, match[1]!, true) : command.name === "attach-github" ? await sdk.attachments.github(session.id, target, access, match[1]!, true) : await sdk.attachments.session(session.id, target, match[1]!, true);
        return { kind: "ok", message: `Attached exact reviewed snapshot ${result.id}. No prompt was sent.` };
      }
      const { preview } = command.name === "attach-folder" ? await sdk.attachments.folderPreview(session.id, target) : command.name === "attach-github" ? await sdk.attachments.githubPreview(session.id, target, access) : await sdk.attachments.sessionPreview(session.id, target);
      return { kind: "text", text: JSON.stringify(preview, null, 2) + `\n\nOnly after source/destination review: /${command.name} ${useCli ? "gh-cli " : ""}${preview.digest} ${target}` };
    }
    case "attached": {
      if (!command.argument) throw new ClientError("attachment_source", "Use /attached ATTACHMENT_ID.");
      const result = await sdk.attachments.read(session.id, command.argument);
      return { kind: "text", text: result.content.kind === "text" ? result.content.text : JSON.stringify({ attachment: result.attachment, diagnostic: "Image retained privately. Desktop previews pixels; terminal/CLI may inspect its typed metadata without pretending clipboard support." }, null, 2) };
    }
    case "meta": {
      const created = await sdk.metachat.create(session.projectId, session.id, command.argument || undefined);
      return { kind: "session", sessionId: created.id!, side: false };
    }
    case "suggestions": {
      const [action, hash] = command.argument.split(/\s+/);
      if (action === "run" || action === "run-all") {
        if (!hash) throw new ClientError("suggestion_scope", "Preview first, then use /suggestions run DIGEST or run-all DIGEST.");
        const created = await sdk.suggestions.generate(session.id, hash, action === "run-all", true);
        return { kind: "session", sessionId: created.id!, side: false };
      }
      if (command.argument && command.argument !== "all") throw new ClientError("suggestion_scope", "Use /suggestions, /suggestions all, or run/run-all with the reviewed digest.");
      const allProjects = command.argument === "all";
      const { preview } = await sdk.suggestions.preview(session.id, allProjects);
      return client === "desktop" ? { kind: "panel", panel: "Suggestions", allProjects } : { kind: "text", text: JSON.stringify(preview, null, 2) + `\n\nOnly after scope review: /suggestions ${allProjects ? "run-all" : "run"} ${preview.digest}` };
    }
    case "attention": {
      if (command.argument) {
        const [action, id, extra] = command.argument.split(/\s+/);
        if (action !== "read" || !id || extra) throw new ClientError("attention_read", "Use /attention or /attention read ID. Reading never answers or approves.");
        await sdk.attention.acknowledge([id]);
        return { kind: "ok", message: "Marked read, not resolved. No question was answered or tool approved." };
      }
      return client === "desktop" ? { kind: "panel", panel: "Attention" } : { kind: "text", text: JSON.stringify(sdk.getState().snapshot!.attention.filter((entry) => entry.active), null, 2) };
    }
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
      if (!url && session.projectId && session.controls.env === "Local") {
        const { configuration } = await sdk.projects.configuration(session.projectId);
        if (configuration.values.port) url = `http://127.0.0.1:${configuration.values.port}/`;
      }
      if (url) await sdk.sessions.browser(sessionId, url);
      if (!url && client !== "desktop") throw new ClientError("browser_url", "Use /browser URL. A remote localhost port is not mapped to this client without an explicitly approved tunnel.");
      return { kind: "panel", panel: "Browser", ...(url ? { url } : {}) };
    }
    case "diff": {
      if (session.controls.env !== "Local") throw new ClientError("diff_env", "Diff transport is not qualified for this env yet. No local checkout was read as a fallback.");
      if (!session.projectId) throw new ClientError("project_required", "Select a project to inspect its local changes.");
      if (client === "desktop") return { kind: "panel", panel: "Changes" };
      const result = await sdk.workspaces.git(session.id);
      return { kind: "text", text: `${result.branch}\n${result.status}\n\n${result.diff || "No tracked diff. Untracked files are listed above."}` };
    }
    case "plan": {
      if (!session.projectId) throw new ClientError("project_required", "Select a project to open its plan.");
      if (client === "desktop") return { kind: "panel", panel: "Plan" };
      const result = await sdk.plans.read(session.id);
      const project = sdk.getState().snapshot!.projects.find((project) => project.id === session.projectId)!;
      const workspace = session.workspaceId ? sdk.getState().snapshot!.managedWorkspaces.find((value) => value.id === session.workspaceId) : undefined;
      if (session.workspaceId && !workspace) throw new ClientError("workspace_missing", "The bound worktree is unavailable. No base plan path was substituted.");
      if (!result.exists) throw new ClientError("plan_missing", `No plan file at ${result.path}. Save one explicitly first.`);
      return { kind: "panel", panel: "Plan", path: `${(workspace?.path ?? project.path).replace(/\/$/, "")}/${result.path}`, text: result.text };
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
