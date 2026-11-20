import { ClientError } from "../../client/src/index.ts";
import type { MoguriSdk } from "./index.ts";
import { AttentionFiltersSchema, DashboardQuerySchema, ArtifactKindSchema, CandidatePatchSchema, CandidateGenerationInputSchema, CompoundInputSchema, WinddownQuerySchema, WinddownCommandSchema, DecisionSettingsSchema, BudgetQuerySchema, TelemetryQuerySchema, CompactionCommandSchema, CompactionQuerySchema, KupoSettingsSchema, KUPO_MODEL_ID, ModelOptionsSchema, SandboxCommandSchema, SandboxQuerySchema, DocumentReadOptionsSchema, DocumentSearchOptionsSchema, DocumentListOptionsSchema, parse, isRecord, sessionPullRequestUrl, BUDGET_WARNING } from "../../protocol/src/index.ts";
import { workspaceFeatureSlash } from "./workspace-features.ts";
import { resolveSessionReference } from "./session-ids.ts";
import { integrationSlash } from "./integration-slash.ts";
import { toolingSlash } from "./tooling-slash.ts";
import { parseSlashApproval } from "../../protocol/src/permissions.ts";
import { UPDATE_TOKEN_CREATION_URL, UPDATE_TOKEN_GUIDANCE } from "../../protocol/src/application-updates.ts";
import { continueWorkInput, KanbanSourceSchema, kanbanPreferences } from "../../protocol/src/kanban.ts";
import { PriceProviderSchema } from "../../protocol/src/pricing.ts";
import { MIN_WORKING_CONTEXT, modelContextWindows, supportsModelContextWindow } from "../../protocol/src/model.ts";
import { themePalettes, type Appearance } from "../../protocol/src/preferences.ts";
import { ToolPreferencesSchema, effectiveToolPreferences, toolMethods } from "../../protocol/src/tool-preferences.ts";
import { parseSlashInput, type SlashResult } from "../../protocol/src/queued-commands.ts";
import { sessionSlash } from "./session-slash.ts";
import { slashCommands } from "../../protocol/src/slash-commands.ts";
import { myWorkSlash } from "./my-work-slash.ts";
import { checkpointSlash } from "./checkpoint-slash.ts";
import { SkillAdmissionCommandSchema } from "../../protocol/src/skill-admission.ts";

export type { SessionPanel, ArtifactEditorRequest, PlanEditorRequest, SlashResult } from "../../protocol/src/queued-commands.ts";
export { slashCommands };
export { builtinSlashClash, builtinClashNotice } from "../../protocol/src/slash-commands.ts";
/** Inline context triggers. A leading `!` is not one: it runs a shell line in the chat's terminal (see `parseShellCommand`). */
export const attachmentTriggers = { "^": "Local file or folder", ":": "Session", "#": "Issue or pull request", "@": "Project file or folder, or GitHub file" } as const;
export function parseAttachmentTrigger(text: string): { prefix: keyof typeof attachmentTriggers; query: string; start: number } | null {
  if (text.startsWith("!")) return null;
  const sessionId = text.match(/(?:^|\s)([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i);
  if (sessionId) return { prefix: ":", query: sessionId[1]!, start: text.length - sessionId[1]!.length };
  const qualified = text.match(/(?:^|\s)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#[1-9]\d*)$/);
  if (qualified) return { prefix: "#", query: qualified[1]!, start: text.length - qualified[1]!.length };
  const match = text.match(/(?:^|\s)([@^:#])([^\s]*)$/);
  if (!match || !(match[1]! in attachmentTriggers)) return null;
  const prefix = match[1] as keyof typeof attachmentTriggers;
  return { prefix, query: match[2]!, start: text.length - match[2]!.length - 1 };
}
export function parseSlash(text: string): { name: string; argument: string } | null {
  return parseSlashInput(text);
}
export const isSharedSlash = (name: string): boolean => slashCommands.some((command) => command.name === name || "aliases" in command && command.aliases.some((alias) => alias === name));
export async function executeSlash(sdk: MoguriSdk, sessionId: string, text: string, client: "desktop" | "tui" | "cli",
  queued?: { executionId: string; inputDigest: string; bindingDigest: string }): Promise<SlashResult> {
  const command = parseSlash(text);
  if (!command) throw new ClientError("slash", "Use a slash command beginning with /.");
  const session = sdk.getState().snapshot?.sessions.find((session) => session.id === sessionId);
  if (!session) throw new ClientError("session_missing", "Choose an existing session.");
  const portable = await sessionSlash(sdk, session, command, client);
  if (portable) return portable;
  switch (command.name) {
    case "yolo":
      if (command.argument) throw new ClientError("yolo_input", "Use /yolo without arguments. Env, model, budgets and hard policy are not overridden.");
      await sdk.sessions.yolo(session.id);
      return { kind: "ok", message: `${sdk.getState().snapshot?.sessions.find((entry) => entry.id === session.id)?.controls.autonomy ?? "Automatic"} session tool delegation enabled. Hard denials, default-deny policy, read-only scope, Env and budgets still apply; questions were not answered.` };
    case "stop":
      if (command.argument) throw new ClientError("stop_input", "Use /stop for this exact session.");
      await sdk.command({ type: "session.stop", sessionId }); return { kind: "ok", message: "Stop requested. Inspect actual owned cancellation and cleanup; no success or replay was inferred." };
    case "session": case "sessions": case "work-items": case "code-requests": case "sidebar": case "quit": {
      if (command.name === "sidebar" ? command.argument && !["open", "close"].includes(command.argument) : command.argument) throw new ClientError("navigation_input", "Navigation takes no arguments; use /sidebar [open|close].");
      if (command.name === "quit" && client !== "tui") throw new ClientError("command_client", "This quit action belongs to a compatible TUI; no desktop or service process was closed.");
      return { kind: "client-view", name: command.name, argument: command.argument };
    }
    case "new": {
      if (command.argument && command.argument !== "global") throw new ClientError("new_input", "Use /new or /new global. No previous project was inferred.");
      const created = await sdk.sessions.create(command.argument === "global" ? null : session.projectId, "New chat");
      return { kind: "session", sessionId: created.id!, side: false };
    }
    case "open": {
      if (!command.argument) throw new ClientError("project_path", "Choose an explicit absolute Local project path.");
      const project = await sdk.projects.add(command.argument), created = await sdk.sessions.create(project.id!, "New chat");
      return { kind: "session", sessionId: created.id!, side: false };
    }
    case "api-key": case "login-code": {
      const allowed = command.name === "api-key" ? ["openrouter", "anthropic", "openai"] : ["chatgpt", "openrouter"];
      if (!allowed.includes(command.argument)) throw new ClientError("provider_input", `Use /${command.name} ${allowed.join("|")}. Never put credentials in the composer.`);
      if (client !== "tui") throw new ClientError("credential_view", "Use this client's provider settings or the native TUI masked dialog. No credential was requested through a composer.");
      return { kind: "client-view", name: command.name, argument: command.argument };
    }
    case "connect": case "cancel-login": case "disconnect": {
      if (command.argument) {
        const id = command.argument;
        if (command.name === "connect") {
          if (id !== "chatgpt" && id !== "openrouter") throw new ClientError("provider_input", "Use /connect, /connect chatgpt or /connect openrouter. API-key providers use /api-key PROVIDER.");
          await sdk.models.hosted.login(id);
          return { kind: "ok", message: "Sign-in requested. Open the shown URL yourself; no browser was opened. If the browser cannot reach this machine, use /login-code with the final redirect URL." };
        }
        if (command.name === "cancel-login") {
          if (id !== "chatgpt" && id !== "openrouter") throw new ClientError("provider_input", "Use /cancel-login chatgpt or /cancel-login openrouter.");
          await sdk.models.hosted.cancel(id); return { kind: "ok", message: "Sign-in cancellation requested." };
        }
        if (!["openrouter", "anthropic", "openai", "chatgpt"].includes(id)) throw new ClientError("provider_input", "Use /disconnect openrouter|anthropic|openai|chatgpt, or /disconnect for Copilot.");
        await sdk.models.hosted.remove(id as "openrouter");
        return { kind: "ok", message: "The provider's stored credential was removed from this profile." };
      }
      await sdk.command({ type: command.name === "connect" ? "provider.login" : command.name === "cancel-login" ? "provider.cancel" : "provider.logout" });
      return { kind: "ok", message: command.name === "connect" ? "Sign-in requested. Complete the original provider flow yourself; no browser was opened." : command.name === "cancel-login" ? "Original sign-in cancellation requested." : "This profile's provider was disconnected." };
    }
    case "resume":
      if (command.argument) throw new ClientError("resume_input", "Use /resume for this actual session after inspecting original effects.");
      await sdk.command({ type: "session.resume", sessionId }); return { kind: "ok", message: "Undispatched work resumed. Terminal commands and unknown effects were not replayed." };
    case "tool-preferences": {
      const current = sdk.settings.get();
      if (!current) throw new ClientError("settings_missing", "Connect to this profile's shared settings before reviewing or changing the tool order.");
      if (!command.argument) return { kind: "text", text: `Integration method order:\n${effectiveToolPreferences(current.values.toolPreferences).order
        .map((id, index) => `${index + 1}. ${toolMethods.find((method) => method.id === id)!.name} (${id})`).join("\n")}\n\n/tool-preferences METHOD METHOD METHOD METHOD ranks all four IDs, or use reset. This is advice for available equivalent integrations, never permission, account selection or a retry of an uncertain write.` };
      if (command.argument === "reset") await sdk.settings.reset("toolPreferences", current.revision);
      else await sdk.settings.update({ ...current.values, toolPreferences: parse(ToolPreferencesSchema, { order: command.argument.trim().split(/\s+/) }) }, current.revision);
      return { kind: "ok", message: "Shared integration method order saved. Permissions, accounts and execution environments are unchanged." };
    }
    case "theme": {
      const settings = sdk.settings.get();
      if (!settings) throw new ClientError("settings_missing", "Connect to this profile's settings before selecting a theme.");
      const parts = command.argument.trim().split(/\s+/).filter(Boolean);
      if (!parts.length || parts.length === 1 && parts[0] === "list") return { kind: "text",
        text: `Theme: ${settings.values.appearance.palette ?? "moguri"} / ${settings.values.appearance.theme}\n\n${themePalettes.map((palette) => `${palette.id} / ${palette.name}: ${palette.description}`).join("\n")}\n\n/theme PALETTE [dark|light|system]. Mode and saved custom colors are preserved unless explicitly changed.` };
      const [first, second] = parts, palette = themePalettes.find((palette) => palette.id === first);
      const mode = palette ? second : first;
      if (parts.length > 2 || !palette && second || !palette && !["dark", "light", "system"].includes(first!) ||
        mode !== undefined && mode !== "dark" && mode !== "light" && mode !== "system") {
        throw new ClientError("theme_input", "Use /theme list, /theme PALETTE [dark|light|system], or /theme dark|light|system. Choose a palette from /theme list.");
      }
      const appearance: Appearance = { ...settings.values.appearance, ...(palette ? { palette: palette.id } : {}),
        ...(mode === "dark" || mode === "light" || mode === "system" ? { theme: mode } : {}) };
      await sdk.settings.update({ ...settings.values, appearance }, settings.revision);
      return { kind: "ok", message: `Theme set to ${appearance.palette ?? "moguri"} / ${appearance.theme}. Shared with this profile's clients.` };
    }
    case "folder-group": {
      const input: unknown = JSON.parse(command.argument);
      if (!isRecord(input) || typeof input.name !== "string" || !Array.isArray(input.projectIds) ||
        !input.projectIds.every((id) => typeof id === "string") || Object.keys(input).some((key) => key !== "name" && key !== "projectIds")) {
        throw new ClientError("folder_group_input", 'Use /folder-group {"name":"Folder","projectIds":["ID","ID"]} with exact current-profile project IDs.');
      }
      const snapshot = sdk.getState().snapshot!, projects = input.projectIds.map((projectId) => {
        if (!snapshot.projects.some((project) => project.id === projectId)) throw new ClientError("project_missing", "Every grouped project must belong to this profile. No foreign project or path was adopted.");
        return { projectId, revision: snapshot.projectConfigurations.find((configuration) => configuration.projectId === projectId)?.revision ?? 0 };
      });
      return { kind: "text", text: JSON.stringify(await sdk.projects.group(input.name, projects), null, 2) };
    }
    case "folder-chat": {
      const snapshot = sdk.getState().snapshot!, [id, env = "Local", extra] = command.argument.trim().split(/\s+/);
      if (!id) return { kind: "text", text: JSON.stringify(snapshot.projectFolders.map((folder) => ({ ...folder,
        projects: snapshot.projectConfigurations.filter((configuration) => configuration.folderId === folder.id)
          .sort((a, b) => a.order - b.order).map((configuration) => ({ id: configuration.projectId,
            name: snapshot.projects.find((project) => project.id === configuration.projectId)?.name })) })), null, 2) };
      const folder = snapshot.projectFolders.find((folder) => folder.id === id);
      if (!folder) throw new ClientError("project_folder", "Choose an exact folder ID from /folder-chat. No previous project or first repository was substituted.");
      if (extra || env !== "Local" && env !== "Sandbox") throw new ClientError("project_folder_env", "Use /folder-chat FOLDER_ID [Local|Sandbox]. Remote groups are not qualified and cannot fall back.");
      const result = await sdk.sessions.createFolder(folder.id, `${folder.name} chat`, { env });
      return { kind: "session", sessionId: result.id!, side: false };
    }
    case "prices": {
      if (!command.argument) return { kind: "text", text: JSON.stringify(await sdk.prices.catalog(), null, 2) };
      const [action, provider, extra] = command.argument.trim().split(/\s+/);
      if (action !== "refresh" || extra) throw new ClientError("pricing_input", "Use /prices or /prices refresh [anthropic|openai|google|xai].");
      const started = await sdk.prices.refresh(provider ? [parse(PriceProviderSchema, provider)] : undefined);
      return { kind: "text", text: JSON.stringify({ jobId: started.id, diagnostic: "Original public-price refresh started, not claimed complete. Inspect the shared capability job; old catalogs and historical costs stay intact on failure." }, null, 2) };
    }
    case "approve": {
      if (!session.pendingApproval) throw new ClientError("approval_input", "There is no actual pending action to approve.");
      const remember = parseSlashApproval(command.argument);
      await sdk.approvals.respond(session.id, session.pendingApproval.id, true, remember);
      return { kind: "ok", message: remember ? `Approved and remembered in ${remember.scope} scope. Hard policy still applies.` : "Approved this action." };
    }
    case "approvals": {
      const [action, id, extra] = command.argument.trim().split(/\s+/).filter(Boolean);
      if (!action) return { kind: "text", text: JSON.stringify(sdk.approvals.list(), null, 2) };
      if (action !== "revoke" || !id || extra) throw new ClientError("approval_input", "Use /approvals or /approvals revoke ID.");
      await sdk.approvals.revoke(id); return { kind: "ok", message: "Remembered approval revoked. Pending approvals were invalidated." };
    }
    case "work-item": {
      if (!command.argument || command.argument === "kanban") return { kind: "panel", panel: "Work item" };
      await sdk.sessions.organize(session.id, { workItemId: command.argument === "clear" ? null : command.argument,
        ...(command.argument === "clear" ? {} : { workItemUrl: null }) });
      return { kind: "ok", message: command.argument === "clear" ? "Kanban work item cleared." : "Linked this project's Kanban card without running it." };
    }
    case "continue-work": {
      if (!session.projectId || !continueWorkInput(text)) throw new ClientError("project_work_input", "Use /continue-work or one exact Kanban card ID in an actual project chat.");
      if (queued) return { kind: "continue-work", review: { profileId: sdk.profileId, sessionId: session.id, text, command: queued }, choices: ["kanban", "prompt"] };
      if (session.draft.text && session.draft.text !== text) throw new ClientError("continue_work_draft", "Another draft is saved. Keep or send it before reviewing this separate continuation request.");
      let expectedRevision = session.draft.revision;
      if (!session.draft.text) {
        const saved = await sdk.command({ type: "draft.save", sessionId: session.id, expectedRevision, text, attachments: session.draft.attachments });
        if (saved.revision === undefined) throw new ClientError("continue_work_draft", "The continuation draft was not acknowledged. No request was dispatched.");
        expectedRevision = saved.revision;
      }
      return { kind: "continue-work", review: { profileId: sdk.profileId, sessionId: session.id, expectedRevision, text }, choices: ["kanban", "prompt"] };
    }
    case "kanban": {
      if (!session.projectId) throw new ClientError("project_required", "Choose this board's actual project. No previous project was reused.");
      const [action, value, page, confirmation, extra] = command.argument.trim().split(/\s+/).filter(Boolean);
      if (!action) { const opened = await sdk.kanban.open(session.projectId); return { kind: "session", sessionId: opened.id!, side: false }; }
      if (action === "work" && value && !page) return { kind: "text", text: JSON.stringify(await sdk.kanban.work(value), null, 2) };
      if (action === "stop" && value && !page) { await sdk.kanban.cancel(value); return { kind: "ok", message: "Stop requested for the original task. Inspect its actual retained outcome." }; }
      if (action === "inspect" && value && page && /^\d+$/.test(page) && confirmation === "confirm-inspected" && !extra) {
        await sdk.kanban.inspect(value, Number(page), true); return { kind: "ok", message: "Inspection recorded. Original work was not replayed or deleted." };
      }
      if (action === "items" && !confirmation && !extra) return { kind: "text", text: JSON.stringify(await sdk.kanban.items(session.projectId,
        parse(KanbanSourceSchema, value ?? "kanban"), page && /^\d+$/.test(page) ? Number(page) : page ? Number.NaN : 1), null, 2) };
      const board = (await sdk.issues.board(session.projectId)).board, current = kanbanPreferences(board);
      if ((action === "show" || action === "hide") && !value) await sdk.issues.configure(session.projectId, { ...board, kanban: { ...current, visible: action === "show" } }, board.revision);
      else if (action === "source" && value && !page) await sdk.issues.configure(session.projectId, { ...board, kanban: { ...current, source: parse(KanbanSourceSchema, value) } }, board.revision);
      else throw new ClientError("kanban_input", "Use /kanban [show|hide|source SOURCE|items [SOURCE] [PAGE]|work RUN|stop RUN|inspect RUN REV confirm-inspected].");
      return { kind: "ok", message: "Shared project Kanban preference saved. No model, sync or scheduled work was started." };
    }
    case "firewall": case "home": case "tools": case "tool": case "tool-result": case "state": case "watch": case "coordinate":
      return toolingSlash(sdk, session.id, command.name, command.argument);
    case "review": case "security": case "performance": case "debug":
    case "impeccable": case "continue": case "orchestrate": case "spar": case "critique": case "roast-me":
    case "address-review": case "fix-conflicts": case "fix-ci": {
      if (command.name === "continue" && command.argument) throw new ClientError("continue_input", "Use /continue without a prompt to continue this actual retained task.");
      if (["orchestrate", "spar", "critique", "roast-me"].includes(command.name) && !command.argument.trim()) throw new ClientError("workflow_prompt", `Use /${command.name} PROMPT. No task or user idea was invented.`);
      const consume = !session.draft.text || session.draft.text.trim() === text.trim();
      await sdk.workflows.start(session.id, command.name, command.argument, consume ? session.draft.revision : undefined);
      return { kind: "ok", message: `Queued /${command.name} through this session's existing model, environment, budget and permission policy.` };
    }
    case "repositories": {
      const match = command.argument.trim().match(/^(\S+)(?:\s+([\s\S]*))?$/), action = match?.[1] ?? "list", tail = match?.[2] ?? "";
      if (action === "list" && !tail) return { kind: "text", text: JSON.stringify(sdk.projects.imports.list(), null, 2) };
      if (action === "read" && tail && !/\s/.test(tail)) return { kind: "text", text: JSON.stringify(await sdk.projects.imports.read(tail), null, 2) };
      if (action === "stop" && tail.endsWith(" confirm-stop")) return { kind: "text", text: JSON.stringify(await sdk.projects.imports.cancel(tail.slice(0, -" confirm-stop".length)), null, 2) };
      const inspection = tail.match(/^(\S+)\s+([1-9]\d*)\s+(\d+)\s+confirm-inspected$/);
      if (action === "acknowledge" && inspection) return { kind: "text", text: JSON.stringify(await sdk.projects.imports.acknowledge(inspection[1]!, Number(inspection[2]), Number(inspection[3]), true), null, 2) };
      if (action === "preview") return { kind: "text", text: JSON.stringify(await sdk.query({ type: "projects.import.preview", input: JSON.parse(tail) }), null, 2) };
      const reviewed = tail.match(/^([a-f0-9]{64})\s+confirm-reviewed\s+([\s\S]+)$/);
      if (action === "import" && reviewed) return { kind: "text", text: JSON.stringify(await sdk.command({ type: "projects.import.start",
        input: JSON.parse(reviewed[2]!), expectedDigest: reviewed[1]!, confirm: true }), null, 2) };
      throw new ClientError("repository_import_command", 'Use /repositories preview {"text":"URL\\nURL","parent":"/absolute/folder"}, then import SHA confirm-reviewed INPUT_JSON, list, read ID or stop ID confirm-stop. No clone is replayed.');
    }
    case "clone": {
      const match = command.argument.match(/^([\s\S]+)\s+confirm-clone$/);
      if (!match) throw new ClientError("clone_review", 'Use /clone {"repository":"URL","path":"ABSOLUTE_NEW_PATH"} confirm-clone after reviewing both values. Partial files are preserved.');
      const input: unknown = JSON.parse(match[1]!);
      if (!isRecord(input) || typeof input.repository !== "string" || typeof input.path !== "string" || Object.keys(input).some((key) => !["repository", "path"].includes(key))) throw new ClientError("clone_input", "Review exactly repository and path before cloning.");
      const result = await sdk.projects.clone(input.repository, input.path, true);
      return { kind: "text", text: JSON.stringify({ ...result, warning: "Independent Local clone job admitted, not completed. Inspect it in Settings / capability jobs or SDK jobs.wait; cancel preserves partial files. No model call or automatic retry." }, null, 2) };
    }
    case "documents": return { kind: "text", text: JSON.stringify(await sdk.attachments.listDocuments(session.id, parse(DocumentListOptionsSchema, JSON.parse(command.argument || "{}"))), null, 2) };
    case "progress": return { kind: "text", text: JSON.stringify(await sdk.sessions.progress(session.id), null, 2) };
    case "activity": {
      const [action, id, part, offset, extra] = command.argument.trim().split(/\s+/).filter(Boolean);
      if (!action) return { kind: "text", text: JSON.stringify(await sdk.activity.list(session.id), null, 2) };
      if (action === "before" && id && /^\d+$/.test(id) && Number.isSafeInteger(Number(id)) && part && !offset) return { kind: "text", text: JSON.stringify(await sdk.activity.list(session.id, { before: { sequence: Number(id), id: part } }), null, 2) };
      if (action === "turn" && id && !part) return { kind: "text", text: JSON.stringify(await sdk.activity.turn(session.id, id), null, 2) };
      if (action === "read" && id && (part === "arguments" || part === "output") && !extra && (!offset || /^\d+$/.test(offset) && Number.isSafeInteger(Number(offset)))) return {
        kind: "text", text: JSON.stringify(await sdk.activity.read(session.id, id, part, { offset: Number(offset ?? 0) }), null, 2),
      };
      throw new ClientError("activity_input", "Use /activity, /activity before SEQUENCE ID, /activity turn ID or /activity read ID arguments|output [UTF8_OFFSET]. No source is inferred.");
    }
    case "agent-terminal": {
      const [action, id, offset, extra] = command.argument.trim().split(/\s+/).filter(Boolean);
      if ((!action || action === "list") && !id) return { kind: "text", text: JSON.stringify(await sdk.agentTerminals.list(session.id), null, 2) };
      if (action === "list" && id && /^\d+$/.test(id) && Number.isSafeInteger(Number(id)) && offset && !extra) return {
        kind: "text", text: JSON.stringify(await sdk.agentTerminals.list(session.id, { before: { sequence: Number(id), id: offset } }), null, 2),
      };
      if (action === "read" && id && !extra && (!offset || offset === "tail" || /^\d+$/.test(offset) && Number.isSafeInteger(Number(offset)))) return {
        kind: "text", text: JSON.stringify(await sdk.agentTerminals.read(session.id, id, offset === "tail" ? { tail: true } : { offset: Number(offset ?? 0) }), null, 2),
      };
      throw new ClientError("agent_terminal_input", "Use /agent-terminal list [SEQUENCE ID] or /agent-terminal read COMMAND_ID [UTF8_OFFSET|tail]. No user console was accessed.");
    }
    case "git":
    case "github":
    case "linear": return integrationSlash(sdk, session, command.name, command.argument, client);
    case "my-work": return myWorkSlash(sdk, session, command.argument, client);
    case "knowledge":
    case "marketplace":
    case "hooks":
    case "capability":
    case "containment":
    case "cache": return workspaceFeatureSlash(sdk, session, command.name, command.argument);
    case "model-readiness": {
      const [modelId, mode, extra] = command.argument.split(/\s+/);
      if (!modelId || extra || mode && mode !== "required") throw new ClientError("model_readiness_input", "Use /model-readiness MODEL_ID [required]. The model must be explicitly configured on this session's execution machine.");
      return { kind: "text", text: JSON.stringify(await sdk.models.readiness(session.id, modelId, mode === "required" ? "required" : "informational"), null, 2) };
    }
    case "model-runtime-preview": {
      const [modelId, extra] = command.argument.split(/\s+/);
      if (!modelId || extra) throw new ClientError("model_readiness_input", "Use /model-runtime-preview MODEL_ID. No version program is started.");
      return { kind: "text", text: JSON.stringify(await sdk.models.runtimePreview(session.id, modelId), null, 2) };
    }
    case "model-runtime-review": {
      const [modelId, expectedDigest, extra] = command.argument.split(/\s+/);
      if (!modelId || !expectedDigest || extra) throw new ClientError("model_readiness_input", "Use /model-runtime-review MODEL_ID PREVIEW_DIGEST after reviewing the exact fixed command and binary identity.");
      return { kind: "text", text: JSON.stringify(await sdk.models.reviewRuntime(session.id, modelId, expectedDigest), null, 2) };
    }
    case "model-runtime-probe": {
      const [modelId, reviewId, mode, extra] = command.argument.split(/\s+/);
      if (!modelId || !reviewId || extra || mode && mode !== "required") throw new ClientError("model_readiness_input", "Use /model-runtime-probe MODEL_ID REVIEW_ID [required]. A consumed or changed review cannot replay.");
      return { kind: "text", text: JSON.stringify(await sdk.models.readinessWithRuntimeReview(session.id, modelId, reviewId,
        mode === "required" ? "required" : "informational"), null, 2) };
    }
    case "thinking":
    case "effort": {
      const effort = command.argument.trim().toLowerCase();
      if (!effort || /\s/.test(effort)) throw new ClientError("model_effort_input", "Use /thinking LEVEL or /effort LEVEL with one supported effort, or default to clear only the effort override.");
      const { thinkingEffort: _, ...other } = session.controls.modelOptions ?? {};
      const options = effort === "default" ? other : parse(ModelOptionsSchema, { ...other, thinkingEffort: effort });
      await sdk.sessions.modelOptions(session.id, options, session.revision, true);
      return { kind: "ok", message: `Thinking effort set to ${effort === "default" ? "the model default" : effort}. The context window and other controls were preserved.` };
    }
    case "context-window": {
      const model = sdk.getState().snapshot?.provider.models.find((entry) => entry.id === session.controls.modelId);
      if (!model) throw new ClientError("model_context_model", "Choose an available fixed model or automatic Kupo before setting its context window. No model was substituted.");
      if (model.synthetic) {
        const argument = command.argument.trim().toLowerCase(), current = (await sdk.routing.options(session.id)).report;
        const maximum = current.windows.values[0];
        const tokens = argument === "min" ? current.windows.values.at(-1) : argument === "half" ? maximum === undefined ? undefined : Math.floor(maximum / 2) :
          argument === "max" ? maximum : /^\d+$/.test(argument) ? Number(argument) : undefined;
        if (tokens === undefined || !Number.isSafeInteger(tokens) || tokens < MIN_WORKING_CONTEXT) throw new ClientError("model_context_input", current.diagnostic ??
          "Use /context-window TOKENS|min|half|max with a complete supported pool window. An unsupported half is not clamped.");
        const options = { ...session.controls.modelOptions, contextWindow: tokens };
        const reviewed = (await sdk.routing.options(session.id, options)).report;
        if (!reviewed.available) throw new ClientError("routing_options", reviewed.diagnostic ?? "No exact pool role supports this window. The draft and settings were preserved.");
        await sdk.sessions.modelOptions(session.id, options, session.revision, false);
        return { kind: "ok", message: `Context window set to ${tokens.toLocaleString("en-US")} tokens for ${reviewed.modelIds.length} eligible Kupo model${reviewed.modelIds.length === 1 ? "" : "s"}. Effort was preserved; complete roles recheck the same ceiling without truncating history.` };
      }
      const windows = modelContextWindows(model), maximum = windows.values[0], argument = command.argument.trim().toLowerCase();
      if (maximum === undefined) throw new ClientError("model_context", "The selected model offers no working window at or above 8192 tokens. No setting or history was changed.");
      const tokens = argument === "min" ? windows.source === "provider" ? windows.values.at(-1)! : MIN_WORKING_CONTEXT :
        argument === "half" ? Math.floor(maximum / 2) : argument === "max" ? maximum : /^\d+$/.test(argument) ? Number(argument) : Number.NaN;
      if (!supportsModelContextWindow(model, tokens)) throw new ClientError("model_context_input",
        `Use /context-window TOKENS|min|half|max. Allowed ${windows.source === "provider" ? `provider-declared token counts: ${windows.values.join(", ")}` : `whole-token ceilings: ${MIN_WORKING_CONTEXT} through ${maximum}`}. An unsupported half is not clamped; no settings or history were changed.`);
      await sdk.sessions.modelOptions(session.id, { ...session.controls.modelOptions, contextWindow: tokens }, session.revision, false);
      return { kind: "ok", message: `Context window set to ${tokens.toLocaleString("en-US")} tokens. Thinking effort and other controls were preserved; history was not truncated.` };
    }
    case "model-settings": {
      if (!command.argument) return { kind: "text", text: JSON.stringify({ options: session.controls.modelOptions ?? {},
        ...(session.controls.preferredThinkingEffort !== undefined ? { preferredThinkingEffort: session.controls.preferredThinkingEffort } : {}),
        context: (await sdk.sessions.context(session.id)).context }, null, 2) };
      if (command.argument === "reset") {
        const { modelOptions: _, preferredThinkingEffort: __, ...controls } = session.controls;
        await sdk.sessions.configure(session.id, controls, session.revision, session.controls.modelId !== null);
      } else {
        const options = parse(ModelOptionsSchema, JSON.parse(command.argument));
        await sdk.sessions.modelOptions(session.id, options, session.revision, Object.hasOwn(options, "thinkingEffort") || undefined);
      }
      return { kind: "ok", message: "Model tuning saved. Supported windows are rechecked before dispatch; history was not truncated." };
    }
    case "model-evidence": {
      const modelId = command.argument.trim() || session.controls.modelId;
      if (!modelId || modelId === KUPO_MODEL_ID || /\s/.test(modelId)) throw new ClientError("model_evidence_model", "Name one actual concrete model ID, or select a fixed model first. No family, account or provider was guessed.");
      return { kind: "text", text: JSON.stringify(await sdk.models.evidence(modelId), null, 2) };
    }
    case "candidates": return client === "desktop" ? { kind: "panel", panel: "Candidates" } : { kind: "text", text: JSON.stringify(sdk.getState().snapshot!.candidates.filter((candidate) => !session.projectId || candidate.projectId === session.projectId), null, 2) };
    case "candidate": {
      const [action = "", ...parts] = command.argument.split(/\s+/).filter(Boolean), result = (value: unknown): SlashResult => ({ kind: "text", text: JSON.stringify(value, null, 2) });
      if (action === "transports" && parts.length === 0) return result(await sdk.candidates.transports({ sessionId: session.id }));
      if (action === "transport-read" && parts.length === 1) return result(await sdk.candidates.transport(parts[0]!));
      if (action === "transport-reconcile" && parts.length === 2 && /^\d+$/.test(parts[1]!) && Number.isSafeInteger(Number(parts[1]))) {
        await sdk.candidates.reconcileTransport(parts[0]!, Number(parts[1]));
        return result(await sdk.candidates.transport(parts[0]!));
      }
      if (action === "eligibility" && parts.length === 0) return result(await sdk.candidates.eligibility(session.id));
      if (action === "source" && parts.length === 1) return result(await sdk.candidates.source(session.id, parts));
      if (action === "workspaces" && parts.length === 0) return result(await sdk.candidates.workspaces(session.id));
      if (action === "workspace-read" && parts.length === 1) return result(await sdk.candidates.workspace(parts[0]!));
      if (action === "workspace-stop" && parts.length === 1) return result(await sdk.candidates.stopWorkspace(parts[0]!));
      if (action === "workspace-preview" || action === "workspace-create") {
        let input = command.argument.slice(action.length).trim();
        if (action === "workspace-create") {
          if (!input.endsWith(" confirm-create")) throw new ClientError("candidate_workspace_review", "Review the exact peer/private snapshot, owned-state path and resource semantics, then append confirm-create. No workspace was created.");
          input = input.slice(0, -" confirm-create".length).trim();
        }
        const value: unknown = JSON.parse(input), allowed = action === "workspace-preview" ? ["name"] : ["name", "expectedDigest"];
        if (!isRecord(value) || Object.keys(value).some((key) => !allowed.includes(key)) || typeof value.name !== "string") throw new ClientError("candidate_workspace_scope", "Use exact {name,expectedDigest?}; Env/profile/session/peer/root come from the actual selected source.");
        if (action === "workspace-preview") return result(await sdk.candidates.workspacePreview(session.id, value.name));
        if (typeof value.expectedDigest !== "string") throw new ClientError("candidate_workspace_review", "Pass the exact original workspace review digest.");
        const created = await sdk.candidates.createWorkspace(session.id, value.name, value.expectedDigest, true);
        return result(await sdk.candidates.waitWorkspace(created.id!));
      }
      if (action === "generate-preview" || action === "generate") {
        let input = command.argument.slice(action.length).trim();
        if (action === "generate") {
          if (!input.endsWith(" confirm-cost")) throw new ClientError("candidate_generation_command", "Review selected source/model/cost and append confirm-cost. No model was called.");
          input = input.slice(0, -" confirm-cost".length).trim();
        }
        const value: unknown = JSON.parse(input), allowed = action === "generate" ? ["stageWorkspaceId", "input", "expectedDigest"] : ["stageWorkspaceId", "input"];
        if (!isRecord(value) || Object.keys(value).some((key) => !allowed.includes(key)) || typeof value.stageWorkspaceId !== "string") throw new ClientError("candidate_generation_command", "Use exact {stageWorkspaceId,input,expectedDigest?}; root/model/actor come from the selected session.");
        const selected = parse(CandidateGenerationInputSchema, value.input);
        if (action === "generate-preview") return result(await sdk.candidates.generatePreview(session.id, value.stageWorkspaceId, selected));
        if (typeof value.expectedDigest !== "string" || !/^[a-f0-9]{64}$/.test(value.expectedDigest)) throw new ClientError("candidate_generation_command", "Pass the exact reviewed generation preview digest.");
        const created = await sdk.candidates.generate(session.id, value.stageWorkspaceId, selected, value.expectedDigest, true);
        return result(await sdk.candidates.waitGeneration(created.id!));
      }
      if (action === "preview" || action === "stage") {
        let input = command.argument.slice(action.length).trim();
        if (action === "stage") {
          if (!input.endsWith(" confirm-stage")) throw new ClientError("candidate_command", "Review exact candidate roots/bases/bytes and append confirm-stage.");
          input = input.slice(0, -" confirm-stage".length).trim();
        }
        const value: unknown = JSON.parse(input), allowed = action === "stage" ? ["stageWorkspaceId", "patch", "expectedDigest", "generationId", "roleSequenceId"] : ["stageWorkspaceId", "patch", "roleSequenceId"];
        if (!isRecord(value) || Object.keys(value).some((key) => !allowed.includes(key)) || typeof value.stageWorkspaceId !== "string") throw new ClientError("candidate_command", "Use exact {stageWorkspaceId,patch,expectedDigest?} data; session/actor come from this command, never a model.");
        if (value.roleSequenceId !== undefined && (typeof value.roleSequenceId !== "string" || !value.roleSequenceId) ||
          value.roleSequenceId !== undefined && value.generationId !== undefined) throw new ClientError("role_proposal_source", "Use one exact retained role sequence ID or generation origin, never both.");
        const origin = typeof value.roleSequenceId === "string" ? { roleSequenceId: value.roleSequenceId } : undefined;
        const patch = parse(CandidatePatchSchema, value.patch);
        if (action === "preview") return result(await sdk.candidates.preview(session.id, value.stageWorkspaceId, patch, origin));
        if (typeof value.expectedDigest !== "string" || !/^[a-f0-9]{64}$/.test(value.expectedDigest)) throw new ClientError("candidate_command", "Stage requires the exact reviewed preview digest.");
        if (value.generationId !== undefined && typeof value.generationId !== "string") throw new ClientError("candidate_generation_command", "A model-origin stage needs its exact retained generation ID.");
        const created = await sdk.candidates.stage(session.id, value.stageWorkspaceId, patch, value.expectedDigest, origin ?? value.generationId);
        return result(await sdk.candidates.wait(created.id!));
      }
      const [id, revision, digest, confirmation] = parts;
      if (action === "role-proposal" && id && parts.length === 1) return result(await sdk.candidates.roleProposal(id));
      if (action === "generation" && id && parts.length === 1) return result(await sdk.candidates.generation(id));
      if (action === "generation-stop" && id && parts.length === 1) { await sdk.candidates.stopGeneration(id); return result(await sdk.candidates.generation(id)); }
      if (action === "read" && id && parts.length === 1) return result(await sdk.candidates.read(id));
      if (action === "apply-preview" && id && parts.length === 1) return result(await sdk.candidates.applyPreview(id, session.id));
      if (action === "apply" && id && revision && /^\d+$/.test(revision) && Number.isSafeInteger(Number(revision)) && digest && /^[a-f0-9]{64}$/.test(digest) && confirmation === "confirm-apply" && parts.length === 4) {
        await sdk.candidates.apply(id, session.id, Number(revision), digest); return result(await sdk.candidates.wait(id));
      }
      if (action === "reject" && id && revision && /^\d+$/.test(revision) && Number.isSafeInteger(Number(revision)) && digest === "confirm-reject" && parts.length === 3) return result(await sdk.candidates.reject(id, Number(revision), true));
      if (action === "stop" && id && parts.length === 1) {
        await sdk.candidates.stop(id); return { kind: "ok", message: "Stop requested only for the captured active candidate job. Inspect its actual cancelled/partial outcome; no rollback or later job was inferred." };
      }
      throw new ClientError("candidate_command", "Use role-proposal ID; generate-preview JSON, generate JSON confirm-cost, generation/generation-stop ID; or preview/stage/read/apply-preview/apply/reject/stop for separately reviewed candidate files.");
    }
    case "mcp-remote": {
      const parts = command.argument.trim().split(/\s+/).filter(Boolean), [action = "calls", id, value, revision, confirmation, access] = parts;
      const text = (value: unknown): SlashResult => ({ kind: "text", text: JSON.stringify(value, null, 2) });
      if (action === "servers" && parts.length === 1) return text(await sdk.mcp.servers(session.id));
      if (action === "calls" && parts.length <= 1) return text(await sdk.mcp.remoteCalls(session.id));
      if (action === "inspect" && id && parts.length === 2) return text(await sdk.mcp.remoteCall(session.id, id));
      if (action === "preview" && id && parts.length === 2) return text(await sdk.mcp.remotePreview(session.id, id));
      if (action === "grant" && id && value && /^[a-f0-9]{64}$/.test(value) && revision && /^\d+$/.test(revision) && Number.isSafeInteger(Number(revision)) &&
        confirmation === "confirm-reviewed" && (parts.length === 5 || parts.length === 6 && access === "forward-access")) {
        await sdk.mcp.grantRemote(session.id, id, value, Number(revision), access === "forward-access", true);
        return { kind: "ok", message: "Exact peer/resource grant saved. Probe SSH again and rediscover tools. No credential was forwarded or tool approved by this setting." };
      }
      if (action === "revoke" && id && value && /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && revision === "confirm-revoke" && parts.length === 4) {
        await sdk.mcp.revokeRemote(session.id, id, Number(value), true);
        return { kind: "ok", message: "Remote MCP grant revoked. Received access and started effects cannot be rolled back; existing results stay readable." };
      }
      throw new ClientError("remote_mcp_command", "Use /mcp-remote servers, preview SERVER, grant SERVER SHA256 REV confirm-reviewed [forward-access], revoke SERVER REV confirm-revoke, calls or inspect OPERATION_ID. Forwarding may expose a long-lived bearer key; refresh credentials never leave their backend.");
    }
    case "models":
    case "model": {
      if (command.name === "models" && command.argument) {
        const [action, id, value, ...extra] = command.argument.split(/\s+/);
        if (action === "catalogue" && !id) return { kind: "text", text: JSON.stringify(sdk.models.catalogue(), null, 2) };
        if ((action === "enable" || action === "disable") && id && !value) await sdk.models.setEnabled(id, action === "enable");
        else if (action === "provider" && id && (value === "enable" || value === "disable") && !extra.length) await sdk.models.setProviderEnabled(id, value === "enable");
        else if (action === "source" && id && value && !extra.length) await sdk.models.selectSource(id, value);
        else throw new ClientError("model_preference_command", "Use /models catalogue, enable API_ID, disable API_ID, provider PROVIDER_ID enable|disable, or source API_ID MODEL_ID. These profile preferences never sign in or start inference.");
        return { kind: "ok", message: "Profile model availability saved. Existing session IDs, credentials and model charges were preserved; no inference started." };
      }
      if (command.name === "models" || !command.argument) return client === "cli" ? { kind: "text", text: JSON.stringify(sdk.getState().snapshot!.provider.models, null, 2) } : { kind: "panel", panel: "Models" };
      const model = sdk.getState().snapshot!.provider.models.find((model) => model.id === command.argument && (!model.environments || model.environments.includes(session.controls.env)));
      if (!model) throw new ClientError("model_unavailable", "Choose an exact available model ID for this env. Inspect /models and /kupo status; no provider or policy fallback was used.");
      await sdk.sessions.selectModel(session.id, model.id, session.revision);
      return { kind: "ok", message: model.synthetic ? `Kupo ${sdk.routing.policy()?.workflow === "auto" ? "Automatic" : sdk.routing.policy()?.workflow === "compound" ? "Compound" : "Single"} selected. Actual roles are metered separately; no inference started and no permission changed.` : `${model.name} selected explicitly. Previous model-specific options were cleared; no inference started.` };
    }
    case "roles": {
      if (!command.argument) return { kind: "text", text: JSON.stringify(sdk.roleSequences.list(), null, 2) };
      const parts = command.argument.split(/\s+/);
      if (parts[0] === "contract") {
        if (parts.length !== 3 || !/^\d+$/.test(parts[2]!)) throw new ClientError("role_contract_command", "Use /roles contract SEQUENCE_ID ROLE_INDEX. Contract validity is not quality, independence or approval.");
        return { kind: "text", text: JSON.stringify(await sdk.roleSequences.contract(parts[1]!, Number(parts[2])), null, 2) };
      }
      if (parts.length > 2 || parts[1] !== undefined && !/^\d+$/.test(parts[1])) throw new ClientError("role_sequence_command", "Use /roles SEQUENCE_ID [ROLE_INDEX] to inspect retained data; this command cannot run a model.");
      return { kind: "text", text: JSON.stringify(await sdk.roleSequences.read(parts[0]!, parts[1] === undefined ? undefined : Number(parts[1])), null, 2) };
    }
    case "decisions": {
      if (!command.argument || command.argument === "status") return { kind: "text", text: JSON.stringify(await sdk.decisions.status(session.id), null, 2) };
      if (command.argument === "list") return { kind: "text", text: JSON.stringify(sdk.decisions.list(session.id), null, 2) };
      if (command.argument.startsWith("set ")) {
        const policy = parse(DecisionSettingsSchema, JSON.parse(command.argument.slice(4))), settings = sdk.settings.get();
        if (!settings) throw new ClientError("decision_scope", "Connect to the exact immutable profile before reviewing decision policy.");
        await sdk.settings.update({ ...settings.values, decisions: policy }, settings.revision);
        return { kind: "ok", message: "Explicit decision-provider policy saved. No solver, Env, model call, answer, permission or steer was selected/applied. Max remains a separate explicit choice." };
      }
      const [action, id, confirmation, ...extra] = command.argument.split(/\s+/);
      if (action === "read" && id && confirmation === undefined) return { kind: "text", text: JSON.stringify(await sdk.decisions.read(id), null, 2) };
      if (action === "stop" && id && confirmation === "confirm-stop" && !extra.length) {
        const record = (await sdk.decisions.read(id)).decision;
        if (record.sessionId !== session.id) throw new ClientError("decision_scope", "Select the original actual parent before stopping this exact decision. No other session or root was adopted.");
        await sdk.decisions.stop(id);
        return { kind: "ok", message: "Only this original decision stop was requested. Actual human interaction and unknown charges remain; no answer, grant or retry was inferred." };
      }
      throw new ClientError("decision_command", "Use /decisions status/list/read ID, stop ID confirm-stop or set POLICY_JSON. This surface cannot run a model or supply an answer/approval.");
    }
    case "winddown": {
      if (!command.argument) return client === "desktop" ? { kind: "panel", panel: "Candidates" } : { kind: "text", text: JSON.stringify(sdk.winddown.list(session.id), null, 2) };
      if (command.argument === "status") return { kind: "text", text: JSON.stringify(await sdk.winddown.status(session.id), null, 2) };
      if (command.argument === "list") return { kind: "text", text: JSON.stringify(sdk.winddown.list(session.id), null, 2) };
      const sourcePreview = command.argument.match(/^source-preview\s+(\S+)\s+([\s\S]+)$/);
      if (sourcePreview) {
        const paths: unknown = JSON.parse(sourcePreview[2]!);
        if (!Array.isArray(paths) || !paths.every((path) => typeof path === "string")) throw new ClientError("winddown_source", "Use an exact JSON array of peer source paths.");
        const result = await sdk.winddown.sourcePreview(sourcePreview[1]!, paths);
        return { kind: "text", text: JSON.stringify({ ...result, acceptCommand: `/winddown source-accept ${sourcePreview[1]} ${result.preview.revision} ${result.preview.digest} confirm-source ${JSON.stringify(paths)}` }, null, 2) };
      }
      const sourceAccept = command.argument.match(/^source-accept\s+(\S+)\s+(\d+)\s+([a-f0-9]{64})\s+confirm-source\s+([\s\S]+)$/);
      if (sourceAccept) {
        const value = parse(WinddownCommandSchema, { type: "winddown.source.accept", winddownId: sourceAccept[1], paths: JSON.parse(sourceAccept[4]!),
          expectedRevision: Number(sourceAccept[2]), expectedDigest: sourceAccept[3], confirm: true });
        await sdk.command(value); return { kind: "ok", message: "Only the exact peer source was accepted by the user. Git still needs its separate original new-branch review." };
      }
      const preview = command.argument.match(/^commit-preview\s+([\s\S]+)$/), commit = command.argument.match(/^commit\s+(\d+)\s+([a-f0-9]{64})\s+confirm-git\s+([\s\S]+)$/);
      if (preview || commit) {
        const value: unknown = JSON.parse(preview?.[1] ?? commit![3]!);
        if (!isRecord(value) || Object.hasOwn(value, "sessionId")) throw new ClientError("winddown_scope", "The shared command binds this exact actual source session. Do not include session/profile/root/actor overrides.");
        if (preview) {
          const result = await sdk.query(parse(WinddownQuerySchema, { ...value, type: "winddown.commit.preview", sessionId: session.id }));
          if (result.type !== "winddown.commit.preview") throw new ClientError("winddown_preview", "The exact accepted-work preview changed its requested type. No fallback.");
          return { kind: "text", text: JSON.stringify({ ...result, confirmCommand: `/winddown commit ${result.preview.revision} ${result.preview.digest} confirm-git ${JSON.stringify(value)}` }, null, 2) };
        }
        const input = parse(WinddownCommandSchema, { ...value, type: "winddown.commit", sessionId: session.id, expectedRevision: Number(commit![1]), expectedDigest: commit![2], confirm: true });
        const created = await sdk.command(input);
        if (!created.id) throw new ClientError("winddown_intent", "No original user/Git intent was acknowledged. Inspect its retained record before another review.");
        return { kind: "text", text: JSON.stringify(await sdk.winddown.waitCommit(created.id), null, 2) };
      }
      const reconciliation = command.argument.match(/^reconcile\s+(\S+)\s+(\d+)\s+([a-f0-9]{64})\s+confirm-inspection$/);
      if (reconciliation) {
        await sdk.winddown.reconcileCommit(reconciliation[1]!, Number(reconciliation[2]), reconciliation[3]!, true);
        return { kind: "ok", message: "Only the original checkpoint writer inspection was acknowledged. Partial job, task outcome and charges remain unchanged; no Git/model replay." };
      }
      const [action, id, revision, confirmation, ...extra] = command.argument.split(/\s+/);
      if (action === "inspect" && id && revision === undefined) {
        const result = await sdk.winddown.inspectCommit(id);
        return { kind: "text", text: JSON.stringify({ ...result, reconciliationCommand: `/winddown reconcile ${id} ${result.inspection.review.revision} ${result.inspection.review.digest} confirm-inspection` }, null, 2) };
      }
      if (action === "read" && id && revision === undefined) return { kind: "text", text: JSON.stringify(await sdk.winddown.read(id), null, 2) };
      if (action === "stop" && id && revision === "confirm-stop" && confirmation === undefined) {
        await sdk.winddown.stop(id); return { kind: "ok", message: "Original finishing model/Git stop requested. Actual cleanup/publication may remain partial; no replay or rollback." };
      }
      if (action === "decline" && id && revision && /^\d+$/.test(revision) && confirmation === "confirm-decline" && !extra.length) {
        await sdk.winddown.decline(id, Number(revision), true); return { kind: "ok", message: "Actual user declined this exact checkpoint's Git publication. No extra model or branch was created." };
      }
      throw new ClientError("winddown_command", "Use /winddown status/list/read ID, source-preview ID PATHS_JSON and its source-accept command, commit-preview JSON and its commit command, inspect ID and its reconcile command, decline ID REV confirm-decline or stop ID confirm-stop.");
    }
    case "compound": {
      if (!command.argument) return client === "desktop" ? { kind: "panel", panel: "Candidates" } : { kind: "text", text: JSON.stringify(sdk.compound.list(session.id), null, 2) };
      if (command.argument === "list") return { kind: "text", text: JSON.stringify(sdk.compound.list(session.id), null, 2) };
      const preview = command.argument.match(/^preview\s+([\s\S]+)$/), start = command.argument.match(/^start\s+([a-f0-9]{64})\s+confirm-cost\s+([\s\S]+)$/);
      if (preview || start) {
        const value: unknown = JSON.parse(preview?.[1] ?? start![2]!);
        if (!isRecord(value) || Object.hasOwn(value, "sessionId")) throw new ClientError("compound_scope", "The shared command binds this exact current session. Do not pass session/profile/root/actor overrides.");
        const input = parse(CompoundInputSchema, { ...value, sessionId: session.id });
        if (preview) {
          const result = await sdk.compound.preview(input);
          return { kind: "text", text: JSON.stringify({ ...result, confirmCommand: `/compound start ${result.preview.digest} confirm-cost ${JSON.stringify(value)}` }, null, 2) };
        }
        return { kind: "text", text: JSON.stringify(await sdk.compound.start(input, start![1]!, true), null, 2) };
      }
      const parts = command.argument.split(/\s+/), [action, id, validationId, revision, digest, confirmation] = parts;
      if (action === "read" && id && parts.length === 2) return { kind: "text", text: JSON.stringify(await sdk.compound.read(id), null, 2) };
      if (action === "validation" && id && parts.length === 2) {
        const value = await sdk.compound.validationPreview(id);
        return { kind: "text", text: JSON.stringify({ type: "compound.validation.preview",
          confirmCommand: `/compound review ${value.workflowId} ${value.review.validationId} ${value.revision} ${value.review.digest} confirm-stage-and-test`,
          denyCommand: `/compound deny ${value.workflowId} ${value.review.validationId} ${value.revision} ${value.review.digest} confirm-deny`, ...value }, null, 2) };
      }
      if (action === "stop" && id && validationId === "confirm-stop" && parts.length === 3) {
        const record = (await sdk.compound.read(id)).workflow;
        if (record.sessionId !== session.id) throw new ClientError("compound_scope", "Select the actual owning session before stopping its exact workflow.");
        await sdk.compound.stop(id); return { kind: "ok", message: "Stop requested for the original public workflow. Inspect actual model/test cleanup; nothing was replayed." };
      }
      if ((action === "review" || action === "deny") && id && validationId && revision && /^\d+$/.test(revision) && digest && /^[a-f0-9]{64}$/.test(digest) &&
        confirmation === (action === "review" ? "confirm-stage-and-test" : "confirm-deny") && parts.length === 6) {
        const record = (await sdk.compound.read(id)).workflow;
        if (record.sessionId !== session.id) throw new ClientError("compound_scope", "Select the exact original owning session before deciding staging/test execution.");
        await sdk.compound.review(id, validationId, Number(revision), digest, action === "review");
        return { kind: "ok", message: action === "review" ? "Actual-user staging and exact project tests authorized. No source application, quality or Git permission was inferred." : "Actual user denied this exact staging/test operation. No next model or source acceptance was authorized." };
      }
      throw new ClientError("compound_command", "Use /compound preview INPUT_JSON, start SHA confirm-cost INPUT_JSON, read ID, validation ID, review ID VALIDATION REV SHA confirm-stage-and-test, deny ID VALIDATION REV SHA confirm-deny, or stop ID confirm-stop.");
    }
    case "kupo": {
      if (!command.argument || command.argument === "status") return { kind: "text", text: JSON.stringify({ policy: sdk.routing.policy(), models: sdk.getState().snapshot!.provider.models,
        capabilities: sdk.routing.capabilities(), diagnostics: sdk.getState().snapshot!.routingDiagnostics, warning: sdk.routing.policy()?.workflow === "auto" ?
        "Automatic Kupo uses configured models by default. Zero eligible models blocks inference; one runs directly without a classifier. Multiple models use Single, gated Cascade or source-reviewed independent Critique with one revision. Exact role/context/image/selected-Env readiness remains authoritative. Every role is metered; finite work needs complete holds and qualified selected-boundary wind-down. Missing native qualification stays blocked, never Local fallback." : sdk.routing.policy()?.workflow === "compound" ?
        "Reviewed Cascade/Critique requires exact selected-Env source/stages/test input through /compound and separate actual-user source application. Native sources are private snapshots, not the live Local repository. Lineage and quality remain limited claims, not permission. Finite turns additionally need qualified reserved wind-down; inspect /winddown status." :
        "Experimental Single only in this saved policy, with exact model/context/image/Env eligibility, hosted-data consent and no automatic workflow upgrade or fallback. Finite turns require qualified selected-boundary reserved wind-down; inspect /winddown status. Compound needs its separately reviewed source/stages/test policy." }, null, 2) };
      if (command.argument === "history") return { kind: "text", text: JSON.stringify(sdk.routing.history(session.id), null, 2) };
      if (command.argument.startsWith("set ")) {
        await sdk.routing.configure(parse(KupoSettingsSchema, JSON.parse(command.argument.slice(4))), sdk.settings.get()!.revision);
        return { kind: "ok", message: "Explicit scoped routing policy saved. No model or inference was selected/started. Hosted data and concrete compound routes need their explicit review; policy cannot lift hard budgets." };
      }
      throw new ClientError("routing_command", "Use /kupo status, history or set POLICY_JSON. Select /model kupo to use the configured eligible model pool.");
    }
    case "notification-sounds": {
      const [action = "list", id, digest, confirmation, ...extra] = command.argument.split(/\s+/).filter(Boolean);
      if (action === "list" && !id) return { kind: "text", text: JSON.stringify(sdk.notifications.list(), null, 2) };
      if (action === "read" && id && !digest) return { kind: "text", text: JSON.stringify((await sdk.notifications.sound(id)).sound, null, 2) };
      if (action === "remove" && id && digest && confirmation === "confirm-remove" && !extra.length) {
        await sdk.notifications.removeSound(id, digest, true);
        return { kind: "ok", message: "The unused sound's independent encrypted retention was removed. No alternative sound was selected." };
      }
      throw new ClientError("notification_sounds_command", "Use /notification-sounds list, read ID or remove ID SHA confirm-remove. Explicit file imports use CLI notification-sounds import FILE.wav --confirm-write or desktop Settings. No terminal audio playback.");
    }
    case "repo-trust": {
      if (!session.projectId || session.repositories) throw new ClientError("repository_trust_project", "Select one exact project for repository trust. No Home, group first-root or inherited project is inferred.");
      const [action = "preview", value, revision, confirmation, ...extra] = command.argument.split(/\s+/).filter(Boolean);
      if (action === "preview" && !value) return { kind: "text", text: JSON.stringify(await sdk.repositoryTrust.preview(session.projectId), null, 2) };
      if (action === "trust" && value && /^[a-f0-9]{64}$/.test(value) && revision && /^(?:-1|[0-9]+)$/.test(revision) &&
        confirmation === "confirm-existing" && !extra.length) {
        await sdk.command({ type: "repository.trust.approve", projectId: session.projectId, baselineDigest: value,
          expectedRevision: Number(revision), confirmExistingScripts: true });
        return { kind: "ok", message: "The actual user trusted this exact existing script baseline. No execution permission, new package trust or automatic replay was granted." };
      }
      if (action === "revoke" && value && /^[0-9]+$/.test(value) && revision === "confirm-revoke" && !confirmation && !extra.length) {
        await sdk.repositoryTrust.revoke(session.projectId, Number(value));
        return { kind: "ok", message: "Repository script trust revoked. New admissions require full-source review; already admitted work was not replayed or relabelled." };
      }
      throw new ClientError("repository_trust_command", "Use /repo-trust preview, trust SHA REV confirm-existing, or revoke REV confirm-revoke. Review the exact Local baseline first; trust never grants execution permission.");
    }
    case "script-review": {
      const [action = "list", id, revision, digest, sessionRevision, confirm, ...extra] = command.argument.split(/\s+/).filter(Boolean);
      if (action === "list" && !id) return { kind: "text", text: JSON.stringify(sdk.getState().snapshot?.scriptReviews.filter((review) => review.sessionId === session.id) ?? [], null, 2) };
      if (action === "read" && id && !revision) return { kind: "text", text: JSON.stringify(await sdk.scriptReviews.read(session.id, id), null, 2) };
      if (action === "approve" && id && revision && /^\d+$/.test(revision) && digest && /^[a-f0-9]{64}$/.test(digest) &&
        sessionRevision && /^\d+$/.test(sessionRevision) && confirm === "confirm-reviewed" && !extra.length) {
        await sdk.scriptReviews.approve(session.id, id, digest, Number(revision), Number(sessionRevision));
        return { kind: "ok", message: "The actual user approved this exact safe script assessment. No execution permission, model continuation or replay was granted." };
      }
      if (action === "force" && id && revision && /^\d+$/.test(revision) && digest && /^[a-f0-9]{64}$/.test(digest) &&
        sessionRevision && /^\d+$/.test(sessionRevision) && confirm === "confirm-unsafe" && !extra.length) {
        const result = await sdk.scriptReviews.force(session.id, id, digest, Number(revision), Number(sessionRevision));
        return { kind: "text", text: JSON.stringify({ ...result, warning: "Actual user forced only this unsafe advisory. Inspect the original job/approval; hard policy and exact source/root checks still apply. No model was resumed." }, null, 2) };
      }
      throw new ClientError("script_review_command", "Use /script-review list, read ID, approve ID REVIEW_REV SHA SESSION_REV confirm-reviewed, or force ID REVIEW_REV SHA SESSION_REV confirm-unsafe after inspecting the entire exact source. Review approval is not execution permission.");
    }
    case "rewind": return checkpointSlash(sdk, session.id, command.argument);
    case "updates": {
      if (command.argument === "token-help") return { kind: "text", text: JSON.stringify({ url: UPDATE_TOKEN_CREATION_URL, steps: UPDATE_TOKEN_GUIDANCE }, null, 2) };
      const [action = "status", id, ...extra] = command.argument.split(/\s+/).filter(Boolean);
      if (extra.length) throw new ClientError("update_command", "Use /updates status/history/read ID/check/cancel ID. Credentials and installation never enter chat.");
      const result = !id && action === "status" ? await sdk.application.updates.status() : !id && action === "history" ? await sdk.application.updates.history() :
        !id && action === "check" ? await sdk.application.updates.check() : id && action === "read" ? await sdk.application.updates.read(id) : id && action === "cancel" ? await sdk.application.updates.cancel(id) : null;
      if (!result) throw new ClientError("update_command", "Use /updates status/history/read ID/check/cancel ID. This never grants an installer or provider permission.");
      return { kind: "text", text: JSON.stringify(result, null, 2) };
    }
    case "runtime":
      if (command.argument === "storage") return { kind: "text", text: JSON.stringify(await sdk.application.storage.status(), null, 2) };
      if (command.argument.startsWith("storage-preview ")) return { kind: "text", text: JSON.stringify(await sdk.application.storage.preview(command.argument.slice("storage-preview ".length)), null, 2) };
      if (command.argument === "disk") return { kind: "text", text: JSON.stringify(await sdk.application.disk.status(), null, 2) };
      if (command.argument === "disk-off" || /^disk-size [1-9][0-9]{0,3}$/.test(command.argument)) {
        const revision = (await sdk.application.disk.status()).disk.disk?.revision ?? 0;
        const size = command.argument === "disk-off" ? null : Number(command.argument.slice("disk-size ".length));
        await sdk.application.disk.configure(size, revision);
        return { kind: "text", text: size === null ? "Turning Moguri's virtual disk off. /runtime disk shows when it's done." : `Setting Moguri's virtual disk to ${size} GB. /runtime disk shows when it's ready.` };
      }
      if (command.argument && command.argument !== "power-retry") throw new ClientError("runtime_command", "Use /runtime, /runtime power-retry, storage, storage-preview PATH, disk, disk-size GB or disk-off. This never resumes a model or changes an execution environment.");
      if (command.argument === "power-retry") await sdk.runtime.retryPower();
      return { kind: "text", text: JSON.stringify(await sdk.runtime.status(), null, 2) };
    case "profiles": return client === "cli" ? { kind: "text", text: JSON.stringify(await sdk.profiles.list(), null, 2) } : { kind: "profiles" };
    case "profile": {
      const [action, id, revision, ...name] = command.argument.split(/\s+/);
      if (!action) return { kind: "text", text: JSON.stringify({ currentProfileId: sdk.profileId, ...(await sdk.profiles.list()) }, null, 2) };
      if (action === "use" && id && !revision) {
        const profile = (await sdk.profiles.list()).catalog.profiles.find((profile) => profile.id === id);
        if (!profile || profile.status !== "ready") throw new ClientError("profile_unready", "Choose a ready registered profile. No Default fallback was used.");
        return { kind: "profile", profileId: id };
      }
      if (action === "create" && id) {
        const created = await sdk.profiles.create([id, revision, ...name].filter(Boolean).join(" "));
        return { kind: "text", text: JSON.stringify({ profile: await sdk.profiles.wait(created.id!), warning: "Created without copying accounts, projects or model context. Choose it explicitly." }, null, 2) };
      }
      if (action === "rename" && id && revision && /^\d+$/.test(revision) && name.length) {
        await sdk.profiles.update(id, { name: name.join(" ") }, Number(revision));
        return { kind: "ok", message: "Profile display name changed; immutable identity, data and credentials were preserved." };
      }
      if (action === "retry" && id && revision && /^\d+$/.test(revision) && name.length === 1 && name[0] === "confirm-review") {
        await sdk.profiles.retry(id, Number(revision), true); return { kind: "text", text: JSON.stringify(await sdk.profiles.wait(id), null, 2) };
      }
      if (action === "stop" && id && !revision) { await sdk.profiles.stop(id); return { kind: "ok", message: "Owned profile setup stop requested. Inspect actual metadata; partial resources were preserved." }; }
      throw new ClientError("profile_command", "Use /profiles, /profile use ID, create NAME, rename ID REV NAME, retry ID REV confirm-review, or stop ID. CLI navigation returns an action; --profile ID selects its immutable scope.");
    }
    case "memory": {
      const [action = "state", ...parts] = command.argument ? command.argument.split(/\s+/) : [];
      if (action === "state" && !parts.length) return { kind: "text", text: JSON.stringify(await sdk.memory.state(session.id), null, 2) };
      if (action === "index" && !parts.length) {
        const result = await sdk.memory.indexSession(session.id);
        return { kind: "ok", message: `Repository index ${result.id} requested for this session's captured environment. Inspect its actual job outcome and /memory state; no model was dispatched.` };
      }
      if (action === "search" && parts.length) return { kind: "text", text: JSON.stringify(await sdk.memory.searchSession(session.id, parts.join(" ")), null, 2) };
      if (action === "graph") return { kind: "text", text: JSON.stringify(await sdk.memory.graphSession(session.id, parts.join(" ")), null, 2) };
      if (action === "remember" && parts.length) {
        if (!session.projectId) throw new ClientError("project_required", "Select an actual project for user-authored coding conventions. No previous project was reused.");
        await sdk.memory.remember(session.projectId, parts.join(" "));
        return { kind: "ok", message: "User-authored project convention retained. This does not grant tools, enable indexing or approve model-generated evolution." };
      }
      if (action === "stop" && parts.length === 1) {
        const job = sdk.getState().snapshot?.jobs.find((job) => job.id === parts[0] && job.sessionId === session.id && job.kind === "memory.index");
        if (!job) throw new ClientError("memory_job", "Choose an exact repository index owned by this session.");
        await sdk.jobs.cancel(job.id); return { kind: "ok", message: "Stop requested for that exact index. Inspect partial/cancelled outcomes; no newer job or complete cache was removed." };
      }
      throw new ClientError("memory_command", "Use /memory state, index, search TEXT, graph [PATH], remember CONVENTION or stop JOB_ID. Optional indexing must be enabled explicitly; no Local fallback.");
    }
    case "repository": {
      const [action = "preview", ...parts] = command.argument ? command.argument.split(/\s+/) : [];
      if ((action === "preview" || action === "state") && !parts.length) return { kind: "text", text: JSON.stringify(action === "preview" ? await sdk.repositories.preview(session.id) : await sdk.repositories.state(session.id), null, 2) };
      if (action === "refresh" && parts.length === 3 && /^[a-f0-9]{64}$/.test(parts[0]!) && /^\d+$/.test(parts[1]!) && parts[2] === "confirm-lookup") {
        const result = await sdk.repositories.refresh(session.id, parts[0]!, Number(parts[1]), true);
        return { kind: "ok", message: `Metadata refresh ${result.id} requested for the reviewed binding. Inspect its actual job outcome and /repository state. No model was dispatched.` };
      }
      if (action === "clear" && parts.length === 2 && /^\d+$/.test(parts[0]!) && parts[1] === "confirm-clear") {
        await sdk.repositories.clear(session.id, Number(parts[0]), true);
        return { kind: "ok", message: "Future repository attribution cleared. Historical names, observations and charges were not rewritten or refunded." };
      }
      if (action === "stop" && parts.length === 1) {
        const job = sdk.getState().snapshot?.jobs.find((job) => job.id === parts[0] && job.sessionId === session.id && job.kind === "repository.refresh");
        if (!job) throw new ClientError("repository_job", "Choose an exact metadata refresh owned by this session.");
        await sdk.jobs.cancel(job.id);
        return { kind: "ok", message: "Stop requested for that exact metadata refresh. Inspect cancelled/partial/failed outcomes; no newer job was targeted." };
      }
      throw new ClientError("repository_command", "Use /repository preview/state, refresh BINDING REV confirm-lookup, clear REV confirm-clear, or stop JOB_ID. Refresh is explicit network lookup, not execution or model authority.");
    }
    case "dashboard": {
      if (!command.argument && client === "desktop") return { kind: "panel", panel: "Dashboard" };
      if (/^(work|usage|cost|velocity)(?:\s|$)/.test(command.argument)) {
        const space = command.argument.indexOf(" "), input: unknown = space < 0 ? {} : JSON.parse(command.argument.slice(space + 1));
        if (!isRecord(input) || Object.hasOwn(input, "type")) throw new ClientError("dashboard_query", "Use a dashboard filter object with range and optional projectId.");
        return { kind: "text", text: JSON.stringify(await sdk.query(parse(DashboardQuerySchema, { ...input, type: "dashboard.overview" })), null, 2) };
      }
      if (command.argument === "analytics" || command.argument.startsWith("analytics ")) {
        const sessionId = command.argument.slice("analytics".length).trim();
        return { kind: "text", text: JSON.stringify(sessionId ? await sdk.analytics.session(sessionId) : await sdk.analytics.overview(), null, 2) };
      }
      if (command.argument === "storage") return { kind: "text", text: JSON.stringify(await sdk.telemetry.storage(), null, 2) };
      if (command.argument === "operations" || command.argument.startsWith("operations ")) {
        const argument = command.argument.slice("operations".length).trim(), filters: unknown = argument ? JSON.parse(argument) : {};
        if (!isRecord(filters) || Object.hasOwn(filters, "type")) throw new ClientError("telemetry_query", "Use an object of operation filters, without a query type.");
        const query = parse(TelemetryQuerySchema, { ...filters, type: "telemetry.operations" });
        return { kind: "text", text: JSON.stringify(await sdk.query(query), null, 2) };
      }
      const calls = command.argument === "calls" || command.argument.startsWith("calls ");
      const plans = command.argument === "plans" || command.argument.startsWith("plans ");
      const argument = calls || plans ? command.argument.slice(5).trim() : command.argument;
      const filters: unknown = argument ? JSON.parse(argument) : {};
      if (!isRecord(filters) || Object.hasOwn(filters, "type")) throw new ClientError("budget_query", "Use an object of dashboard filter fields, without a query type.");
      const query = parse(BudgetQuerySchema, { ...filters, type: calls ? "budget.calls" : plans ? "budget.plans" : "budget.dashboard" });
      if (query.type === "budget.status") throw new ClientError("budget_query", "Use dashboard/calls/plans filter fields, not another query type.");
      return { kind: "text", text: JSON.stringify(await sdk.query(query), null, 2) };
    }
    case "compact": {
      const [action = "now", ...parts] = command.argument ? command.argument.split(/\s+/) : [];
      if (action === "now" && parts.length <= 1) {
        if (!parts.length && session.controls.modelId === KUPO_MODEL_ID) throw new ClientError("compaction_model", "Kupo compacts automatically. To compact now, name the model: /compact now MODEL_ID.");
        const result = await sdk.compactions.compact(session.id, parts.length ? { modelId: parts[0]! } : {});
        return { kind: "ok", message: `Compacting ${result.preview.prefixMessages} older messages with ${result.preview.modelId} (metered). The last ${result.preview.keepRecentTurns} turns stay intact; it applies only if complete and smaller. Original history is kept: /compact restore brings it back.` };
      }
      if (action === "state" && !parts.length) return { kind: "text", text: JSON.stringify(await sdk.compactions.state(session.id), null, 2) };
      if (action === "restore" && !parts.length) {
        const state = await sdk.compactions.state(session.id);
        if (!state.activeId) throw new ClientError("compaction_restore", "No compaction is active. The original history is already in use.");
        await sdk.compactions.restore(session.id, state.activeId, state.sourceDigest, true);
        return { kind: "ok", message: "Original history restored without a model call, replay or accounting reset. Normal context-window admission still applies." };
      }
      if (action === "read" && parts.length === 1) {
        const result = await sdk.compactions.read(session.id, parts[0]!);
        return { kind: "text", text: `Model-produced context proposal ${result.compaction.id}, revision ${result.compaction.revision}, ${result.compaction.status}.\nOriginal history is retained; this is not a user answer or permission.\n\n${result.text ?? "No summary was retained."}\n\n${JSON.stringify(result.compaction, null, 2)}` };
      }
      if (action === "stop" && parts.length === 1) {
        await sdk.compactions.stop(session.id, parts[0]!);
        return { kind: "ok", message: "Stop requested for this exact compaction. Inspect its actual stopped/partial outcome; no newer turn was targeted." };
      }
      if (action === "preview") {
        const value: unknown = parts.length ? JSON.parse(parts.join(" ")) : {};
        if (!isRecord(value) || Object.keys(value).some((key) => key !== "modelId" && key !== "keepRecentTurns")) throw new ClientError("compaction_command", "Preview options are modelId and keepRecentTurns only.");
        const query = parse(CompactionQuerySchema, { type: "compaction.preview", sessionId: session.id, ...value });
        return { kind: "text", text: JSON.stringify(await sdk.query(query), null, 2) };
      }
      if (action === "generate" && parts.at(-1) === "confirm-cost") {
        const value: unknown = JSON.parse(parts.slice(0, -1).join(" "));
        if (!isRecord(value) || Object.keys(value).some((key) => !["digest", "modelId", "keepRecentTurns"].includes(key))) throw new ClientError("compaction_command", "Use the reviewed preview's digest, modelId and keepRecentTurns, followed by confirm-cost.");
        const request = parse(CompactionCommandSchema, { type: "compaction.generate", sessionId: session.id, expectedDigest: value.digest, modelId: value.modelId, keepRecentTurns: value.keepRecentTurns, confirmCost: true });
        const result = await sdk.command(request);
        return { kind: "ok", message: `Compaction ${result.id} requested. Inspect /compact state and /compact read ID after settlement. Original context is unchanged; no result was automatically applied.` };
      }
      if ((action === "apply" || action === "discard") && parts.length === (action === "apply" ? 3 : 2) && /^\d+$/.test(parts[1]!) && (action !== "apply" || parts[2] === "confirm-reviewed")) {
        if (action === "apply") await sdk.compactions.apply(session.id, parts[0]!, Number(parts[1]));
        else await sdk.compactions.discard(session.id, parts[0]!, Number(parts[1]));
        return { kind: "ok", message: action === "apply" ? "Reviewed context prefix applied. Recent turns, original history, drafts and charges remain retained." : "Proposal discarded. Original context and all actual charges were preserved." };
      }
      if (action === "restore" && parts.length === 3 && parts[2] === "confirm-restore") {
        await sdk.compactions.restore(session.id, parts[0]!, parts[1]!, true);
        return { kind: "ok", message: "Original retained context restored without a model call, replay or accounting reset. Normal context-window admission still applies." };
      }
      throw new ClientError("compaction_command", "Use /compact (or /compact now MODEL_ID), /compact restore, state, preview OPTIONS_JSON, generate {digest,modelId,keepRecentTurns} confirm-cost, read ID, stop ID, apply ID REV confirm-reviewed, discard ID REV, or restore ACTIVE_ID SOURCE_SHA confirm-restore.");
    }
    case "budget": {
      const [action, ...args] = command.argument.split(/\s+/);
      if (!action || action === "status") return { kind: "text", text: JSON.stringify(await sdk.budgets.status(session.id), null, 2) };
      if ((action === "Unlimited" || action === "unlimited") && !args.length) {
        await sdk.sessions.configure(session.id, { ...session.controls, budget: { kind: "unlimited" } }, session.revision);
        return { kind: "ok", message: "Session preference is Unlimited. Profile/global hard policy and cumulative accounting were preserved." };
      }
      if ((action === "clear-profile" || action === "clear-global") && args.length === 2 && /^\d+$/.test(args[0]!) && args[1] === "confirm-policy") {
        if (action === "clear-global") await sdk.profiles.globalBudget(null, Number(args[0]), true);
        else await sdk.budgets.policy(null, Number(args[0]), true);
        return { kind: "ok", message: `${action === "clear-global" ? "Global" : "Profile"} cap explicitly removed. Accounting was not reset.` };
      }
      const policy = action === "profile" || action === "global", expected = policy ? 4 : 3;
      if ((action !== "set" && !policy) || args.length !== expected || args.at(-1) !== "confirm-estimates" ||
        args[0] !== "-" && !/^\d+$/.test(args[0]!) || args[1] !== "-" && !Number.isFinite(Number(args[1]))) throw new ClientError("budget_command", `Use /budget set TOKENS|- USD|- confirm-estimates, or profile/global TOKENS|- USD|- REV confirm-estimates. ${BUDGET_WARNING}`);
      const limit = { basis: "estimate" as const, ...(args[0] === "-" ? {} : { tokens: Number(args[0]) }), ...(args[1] === "-" ? {} : { usd: Number(args[1]) }) };
      if (policy) {
        if (!/^\d+$/.test(args[2]!)) throw new ClientError("budget_revision", "Use the observed policy revision from /dashboard or /profile.");
        if (action === "global") await sdk.profiles.globalBudget(limit, Number(args[2]), true);
        else await sdk.budgets.policy(limit, Number(args[2]), true);
      } else await sdk.sessions.configure(session.id, { ...session.controls, budget: { kind: "limited", ...limit } }, session.revision);
      return { kind: "ok", message: `${action === "global" ? "Global" : policy ? "Profile" : "Session"} estimate-based cap saved. Existing charges/reservations were preserved. ${BUDGET_WARNING}` };
    }
    case "question": {
      const [action, id, revision, ...text] = command.argument.split(/\s+/);
      const question = sdk.getState().snapshot!.questions.find((question) => question.id === session.pendingQuestionId && question.status === "open");
      if (!action) return { kind: "text", text: JSON.stringify({ question: question ?? null, diagnostic: "Only an actual answer endpoint resolves this state; heuristic attention or a queued prompt does not answer." }, null, 2) };
      if (!["answer", "other"].includes(action) || !id || !revision || !/^\d+$/.test(revision) || !text.length) throw new ClientError("question_answer", "Use /question, /question answer ID REV TEXT, or /question other ID REV TEXT. No answer or permission is inferred.");
      if (!question || question.id !== id) throw new ClientError("question_scope", "This is not the current question for this conversation.");
      if (action === "other") await sdk.questions.answerOther(id, text.join(" "), Number(revision));
      else await sdk.questions.answer(id, text.join(" "), Number(revision));
      return { kind: "ok", message: "Actual user answer recorded. Tool/Git permissions and policy were not changed." };
    }
    case "project-removal": {
      if (!session.projectId) throw new ClientError("project_required", "Select a project for its explicit removal workflow. No previous project was inferred.");
      const [action, ...args] = command.argument.split(/\s+/);
      if (!action || action === "preview") return { kind: "text", text: JSON.stringify({ ...(await sdk.artifacts.projectPreview(session.projectId)), workspaces: sdk.getState().snapshot!.managedWorkspaces.filter((workspace) => workspace.projectId === session.projectId && workspace.status !== "removed"), warning: "Removal forgets project data. Choose retain/export/materialize/delete for artifacts; source files and branches are never deleted. Materialization explicitly writes only a reviewed new repository copy." }, null, 2) };
      if (action === "materialize-preview" && args.length <= 2) {
        return { kind: "text", text: JSON.stringify(await sdk.artifacts.materializePreview(session.projectId, { ...(args[0] && args[0] !== "-" ? { workspaceId: args[0] } : {}), ...(args[1] && args[1] !== "-" ? { commitBranch: args[1] } : {}) }), null, 2) };
      }
      if ((action === "materialization" || action === "materialize-stop") && args.length === 1) {
        const result = await sdk.artifacts.materialization(args[0]!);
        if (result.job.projectId !== session.projectId) throw new ClientError("artifact_scope", "Choose a materialization owned by this project.");
        if (action === "materialize-stop") { await sdk.jobs.cancel(args[0]!); return { kind: "ok", message: "Repository stop requested. Inspect actual job status; partial copies or local commits were not deleted." }; }
        return { kind: "text", text: JSON.stringify(result, null, 2) };
      }
      if (action === "materialize" && args.length === 4 && args[3] === "confirm-write" && /^[a-f0-9]{64}$/.test(args[0]!)) {
        const created = await sdk.artifacts.materialize(session.projectId, args[0]!, { ...(args[1] !== "-" ? { workspaceId: args[1]! } : {}), ...(args[2] !== "-" ? { commitBranch: args[2]! } : {}) });
        return { kind: "ok", message: `Owned repository job ${created.id}. Use /project-removal materialization ${created.id} to inspect actual status; no source documents were deleted.` };
      }
      if (action === "export") {
        if (client !== "desktop" && !args.length) throw new ClientError("artifact_export_path", "Use /project-removal export ABSOLUTE_NEW_FILE_PATH, then preserve the returned export digest.");
        if (client === "desktop" && args.length) throw new ClientError("artifact_export_path", "Desktop uses the explicit native save dialog. Use /project-removal export.");
        return { kind: "export", document: (await sdk.artifacts.projectExport(session.projectId)).export, ...(args.length ? { path: args.join(" ") } : {}) };
      }
      const confirmRunning = args.at(-1) === "confirm-running", reviewed = confirmRunning ? args.slice(0, -1) : args;
      const matches = (action === "retain" || action === "delete") && reviewed.length === 2 && reviewed[1] === "confirm-remove" || (action === "export-delete" || action === "materialize-delete") && reviewed.length === 3 && reviewed[2] === "confirm-remove";
      if (!matches || !/^[a-f0-9]{64}$/.test(reviewed[0] ?? "") || action === "export-delete" && !/^[a-f0-9]{64}$/.test(reviewed[1] ?? "")) throw new ClientError("project_removal", "Preview first. Use retain/delete SET_SHA confirm-remove, export-delete SET_SHA EXPORT_SHA confirm-remove, or materialize-delete SET_SHA COMPLETED_JOB confirm-remove; add confirm-running to stop running sessions. Repository copies use materialize-preview, then materialize REVIEW_SHA WORKSPACE|- BRANCH|- confirm-write. Worktrees must be removed separately.");
      const configuration = (await sdk.projects.configuration(session.projectId)).configuration;
      await sdk.projects.remove(session.projectId, true, configuration.revision, { action: action === "export-delete" ? "export" : action === "materialize-delete" ? "materialize" : action === "retain" ? "retain" : "delete", expectedDigest: reviewed[0]!, ...(action === "export-delete" ? { exportedDigest: reviewed[1]! } : {}), ...(action === "materialize-delete" ? { materializationId: reviewed[1]! } : {}) },
        confirmRunning ? { confirmRunning: true } : {}).catch((error: unknown) => {
        if (error instanceof ClientError && error.code === "session_running") throw new ClientError(error.code, `${error.message} Add confirm-running to the same command to stop it and remove the project.`, error.status);
        throw error;
      });
      return { kind: "ok", message: "Project data removed with your exact artifact choice. Repository files, branches, external PRs and shared stores were preserved." };
    }
    case "artifacts":
      if (command.argument === "library") return { kind: "text", text: JSON.stringify(await sdk.artifacts.library(session.projectId), null, 2) };
      if (command.argument) throw new ClientError("artifact_command", "Use /artifacts for retained documents or /artifacts library for this project's build outputs and agent-written files.");
      return client === "desktop" || client === "tui" ? { kind: "panel", panel: "Artifacts" } : { kind: "text", text: JSON.stringify(sdk.getState().snapshot!.artifacts, null, 2) };
    case "artifact": {
      const [action, id, ...rest] = command.argument.split(/\s+/);
      if (action === "new" && id && rest.length) return { kind: "artifact-editor", artifact: { id: null, revision: 0, kind: parse(ArtifactKindSchema, id), name: rest.join(" "), text: "", projectId: session.projectId, sessionId: session.id, status: "active" } };
      if (!action) return { kind: "text", text: JSON.stringify(sdk.getState().snapshot!.artifacts, null, 2) };
      if (action === "edit" && id && !rest.length) {
        const value = await sdk.artifacts.read(id);
        const artifact = value.artifact;
        return { kind: "artifact-editor", artifact: { id: artifact.id, revision: artifact.revision, kind: artifact.kind, name: artifact.name,
          text: value.text, sessionId: artifact.originSessionId, projectId: artifact.projectId, status: artifact.status,
          folderId: artifact.folderId, workItemId: artifact.workItemId } };
      }
      if (action === "history" && id && !rest.length) return { kind: "text", text: JSON.stringify(await sdk.artifacts.history(id), null, 2) };
      if ((action === "archive" || action === "restore") && id && !rest.length) {
        const value = await sdk.artifacts.read(id); await sdk.artifacts.update(id, { status: action === "archive" ? "archived" : "active" }, value.artifact.revision);
        return { kind: "ok", message: `Artifact ${action === "archive" ? "archived" : "restored"}; no source session or file was changed.` };
      }
      if (action === "delete" && id && rest.length === 2 && /^\d+$/.test(rest[0]!) && rest[1] === "confirm-delete") {
        await sdk.artifacts.delete(id, Number(rest[0]), true); return { kind: "ok", message: "Selected artifact grants deleted. Source files/conversations and other copies were not erased." };
      }
      if (action === "export" && id) {
        if (client !== "desktop" && !rest.length) throw new ClientError("artifact_export_path", "Use /artifact export ID ABSOLUTE_NEW_FILE_PATH. Existing files are preserved.");
        if (client === "desktop" && rest.length) throw new ClientError("artifact_export_path", "Desktop uses the explicit native save dialog. Use /artifact export ID.");
        return { kind: "export", document: (await sdk.artifacts.export(id)).export, ...(rest.length ? { path: rest.join(" ") } : {}) };
      }
      if (!id) { const value = await sdk.artifacts.read(action); return { kind: "text", text: JSON.stringify(value, null, 2) }; }
      throw new ClientError("artifact_command", "Use /artifacts, /artifact ID, new KIND NAME, edit/history/archive/restore ID, delete ID REV confirm-delete, or export ID PATH.");
    }
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
    case "sandbox": {
      const [action = "", ...parts] = command.argument.split(/\s+/).filter(Boolean), [id, confirmation, extra] = parts;
      const text = (value: unknown): SlashResult => ({ kind: "text", text: JSON.stringify(value, null, 2) });
      if (action === "setup") {
        const status = await sdk.sandbox.setup.status();
        if (!status.setup.supported) return text(status);
        const value = await sdk.sandbox.setup.review(id);
        return text({ ...value, confirmCommand: `/sandbox enable ${value.review.version} ${value.review.digest} ${value.review.settingsRevision} confirm-setup` });
      }
      if (action === "enable") {
        const [version, digest, revision, confirm, ...remaining] = parts;
        if (!version || !digest || !revision || !/^[0-9]+$/.test(revision) || confirm !== "confirm-setup" || remaining.length) {
          throw new ClientError("sandbox_setup_review", "Use the exact /sandbox enable command from /sandbox setup after reviewing its version, package, worker, network and automatic-workspace policy.");
        }
        const admitted = await sdk.sandbox.setup.apply({ version, digest, settingsRevision: Number(revision) });
        return text(await sdk.sandbox.setup.wait(admitted.id!));
      }
      if (action === "updates" && !id) { const admitted = await sdk.sandbox.setup.check(); return text(await sdk.sandbox.setup.wait(admitted.id!)); }
      if (action === "prepare-version" && id && confirmation === "confirm-download" && !extra) {
        const admitted = await sdk.sandbox.setup.prepare(id); return text(await sdk.sandbox.setup.wait(admitted.id!));
      }
      if (action === "cancel-setup" && id && confirmation === "confirm-stop" && !extra) {
        await sdk.sandbox.setup.cancel(id); return text(await sdk.sandbox.setup.operation(id));
      }
      if (!action && client === "desktop") return { kind: "panel", panel: "Sandbox" };
      if (!action || action === "status" && !id) {
        const snapshot = sdk.getState().snapshot!;
        return text({ ...(await sdk.sandbox.status()), workspace: (snapshot.sandboxWorkspaces ?? []).find((value) => value.id === session.sandboxWorkspaceId) ?? null,
          executions: (snapshot.sandboxExecutions ?? []).filter((value) => value.sessionId === session.id).map(({ id, status, cleanup, cancellation, revision, resultDigest }) => ({ id, status, cleanup, cancellation, revision, resultDigest })),
          publications: (snapshot.sandboxPublications ?? []).map(({ id, executionId, status, revision, publishedPaths, diagnostic }) => ({ id, executionId, status, revision, publishedPaths, diagnostic })) });
      }
      if (action === "probe" && id === "confirm-native" && !confirmation) { await sdk.sandbox.probe(); return text(await sdk.sandbox.status()); }
      if (action === "preview") {
        const input = parse(SandboxQuerySchema, { type: "sandbox.preview", sessionId: session.id, paths: JSON.parse(command.argument.slice(action.length).trim()) });
        const result = await sdk.query(input);
        if (result.type !== "sandbox.preview") throw new ClientError("sandbox_command", "Native preview changed its exact response type.");
        return text({ ...result, confirmCommand: `/sandbox prepare ${JSON.stringify({ paths: result.preview.paths, expectedDigest: result.preview.digest,
          expectedRevision: sdk.getState().snapshot!.sessions.find((value) => value.id === session.id)!.revision })} confirm-stage` });
      }
      if (action === "prepare" || action === "publish") {
        const suffix = action === "prepare" ? " confirm-stage" : " confirm-publish";
        let input = command.argument.slice(action.length).trim();
        if (!input.endsWith(suffix)) throw new ClientError("sandbox_review", `Review the exact native bytes/root/policy and append ${suffix.trim()}. No native stage or source effect was started.`);
        input = input.slice(0, -suffix.length);
        const value: unknown = JSON.parse(input), allowed = action === "prepare" ? ["paths", "expectedDigest", "expectedRevision"] : ["executionId", "paths", "expectedDigest", "expectedRevision"];
        if (!isRecord(value) || Object.keys(value).some((key) => !allowed.includes(key))) throw new ClientError("sandbox_review", "Use only exact paths, review digest/revision and the publication's original execution ID; root, profile and actual actor are not client input.");
        const request = parse(SandboxCommandSchema, { ...value, type: action === "prepare" ? "sandbox.prepare" : "sandbox.publish",
          ...(action === "prepare" ? { sessionId: session.id } : {}), confirm: true });
        const created = await sdk.command(request);
        if (action !== "publish") return text({ ...created, notice: "Exact reviewed private native stage prepared. Source unchanged; no model turn was started." });
        const published = await sdk.sandbox.waitPublication(created.id!);
        if (published.publication.status !== "completed") throw new ClientError("sandbox_publication_partial", `Native source publication ${published.publication.status}: ${published.publication.diagnostic ?? "Inspect its original attempts."} Use /sandbox publication ${created.id}. No successful copy or retry was inferred.`);
        return text(published);
      }
      if (action === "execution" && id && !confirmation) return text(await sdk.sandbox.execution(id));
      if (action === "result" && id && !confirmation) return text(await sdk.sandbox.result(id));
      if (action === "publication" && id && !confirmation) return text(await sdk.sandbox.publication(id));
      if (action === "stop" && id && confirmation === "confirm-stop" && !extra) { await sdk.sandbox.stop(id); return text(await sdk.sandbox.execution(id)); }
      if (action === "reconcile" && id && confirmation === "confirm-inspect" && !extra) { await sdk.sandbox.reconcile(id); return text(await sdk.sandbox.execution(id)); }
      if (action === "stop-publication" && id && confirmation === "confirm-stop" && !extra) {
        const record = (await sdk.sandbox.publication(id)).publication;
        await sdk.jobs.cancel(record.jobId); return text(await sdk.sandbox.publication(id));
      }
      if (action === "publish-preview" && id) {
        const requested = command.argument.slice(action.length).trim().slice(id.length).trim();
        const value: unknown = JSON.parse(requested);
        if (!Array.isArray(value) && (!isRecord(value) || Object.keys(value).some((key) => key !== "paths" && key !== "repository"))) {
          throw new ClientError("sandbox_command", "Use an exact paths array, or {paths,repository} for one original captured group member.");
        }
        const input = parse(SandboxQuerySchema, { type: "sandbox.publication.preview", executionId: id, ...(Array.isArray(value) ? { paths: value } : value) });
        const result = await sdk.query(input);
        if (result.type !== "sandbox.publication.preview") throw new ClientError("sandbox_command", "Native publication preview changed its requested response type.");
        const execution = (await sdk.sandbox.execution(id)).execution;
        return text({ ...result, confirmCommand: `/sandbox publish ${JSON.stringify({ executionId: id, paths: result.preview.document.patch.edits.map((edit) => edit.path),
          expectedDigest: result.preview.digest, expectedRevision: execution.revision,
          ...(result.preview.document.version === 2 ? { repository: result.preview.document.repositoryId } : {}) })} confirm-publish` });
      }
      throw new ClientError("sandbox_command", "Use /sandbox status; probe confirm-native; preview PATHS_JSON; prepare REVIEW_JSON confirm-stage; execution/result/publication ID; stop/reconcile ID confirm-stop|confirm-inspect; or publish-preview ID PATHS_JSON and publish REVIEW_JSON confirm-publish. No Local fallback or automatic acceptance.");
    }
    case "remote": {
      const [action, id, extra] = command.argument.split(/\s+/);
      if (!action) return { kind: "text", text: JSON.stringify((await sdk.remote.status()).remote, null, 2) };
      if (action === "probe" && !id) { await sdk.remote.probe(); return { kind: "text", text: JSON.stringify((await sdk.remote.status()).remote, null, 2) }; }
      if (action === "reconcile" && id && !extra) { await sdk.remote.reconcile(id); return { kind: "ok", message: "Existing remote receipts/status reconciled. No effect was replayed; partial turns were not rewritten as successful." }; }
      if (action === "acknowledge" && id && !extra) { await sdk.remote.acknowledge(id, true); return { kind: "ok", message: "Your remote process-inspection acknowledgement was recorded. This does not prove containment or cleanup." }; }
      throw new ClientError("remote_action", "Use /remote, /remote probe, /remote reconcile ID, or only after process inspection /remote acknowledge ID.");
    }
    case "document-cancel": {
      await sdk.attachments.cancelDocument(session.id, command.argument);
      return { kind: "ok", message: "Stop requested for that exact document capture. Inspect its settled draft; no other task was cancelled." };
    }
    case "document-read":
    case "document-search": {
      const match = command.argument.match(/^(\S+)(?:\s+([\s\S]+))?$/);
      if (!match) throw new ClientError("document_input", "Use an exact document ID followed by bounded JSON options.");
      const value: unknown = JSON.parse(match[2] ?? "{}");
      return { kind: "text", text: JSON.stringify(command.name === "document-read" ?
        await sdk.attachments.readDocument(session.id, match[1]!, parse(DocumentReadOptionsSchema, value)) :
        await sdk.attachments.searchDocument(session.id, match[1]!, parse(DocumentSearchOptionsSchema, value)), null, 2) };
    }
    case "attach-file":
    case "attach-document":
    case "attach-image": {
      if (!command.argument) throw new ClientError("attachment_path", "Choose an explicit absolute file path.");
      const result = await sdk.attachments.file(session.id, command.argument, command.name === "attach-image" ? "image" : command.name === "attach-document" ? "document" : "auto");
      return { kind: "ok", message: `Captured attachment ${result.id}. No prompt was sent.` };
    }
    case "attach-folder":
    case "attach-github":
    case "attach-session": {
      const useCli = command.name === "attach-github" && command.argument.startsWith("gh-cli ");
      const argument = useCli ? command.argument.slice(7) : command.argument;
      const match = argument.match(/^([a-f0-9]{64})\s+([\s\S]+)$/);
      let target = match?.[2] ?? argument;
      if (!target) throw new ClientError("attachment_source", "Select a folder, canonical reference URL or source session ID.");
      if (command.name === "attach-session") {
        const matches = resolveSessionReference(sdk.getState().snapshot?.sessions ?? [], target);
        if (matches.length > 1) throw new ClientError("session_reference", `Session ID ${target} matches ${matches.length} sessions. Use more characters or the full ID; nothing was attached.`);
        target = matches[0]?.id ?? target;
      }
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
      return { kind: "text", text: result.content.kind === "text" ? result.content.text : JSON.stringify({ attachment: result.attachment, diagnostic: result.content.kind === "document" ? "Original and extraction are retained privately. Use /document-read ID with page/section/sheet/range options, or /document-search ID with a literal query. No complete document was injected." : "Image retained privately. Desktop previews pixels; terminal/CLI may inspect its typed metadata without pretending clipboard support." }, null, 2) };
    }
    case "meta": {
      const created = await sdk.metachat.create(session.projectId, session.id, command.argument || undefined);
      return { kind: "session", sessionId: created.id!, side: false };
    }
    case "skills": {
      const [action = "find", ...parts] = command.argument ? command.argument.split(/\s+/) : [];
      if (action === "sources" && !parts.length) return { kind: "text", text: JSON.stringify(sdk.settings.get()?.values.skillSources ?? [], null, 2) };
      if (action === "find") return { kind: "text", text: JSON.stringify(await sdk.skills.find(parts.join(" "), { sessionId: session.id }), null, 2) };
      if (action === "read" && parts.length === 2) return { kind: "text", text: JSON.stringify(await sdk.skills.read(parts[0]!, parts[1]!, session.id), null, 2) };
      if (action === "inspect" && parts.length === 2) return { kind: "text", text: JSON.stringify(await sdk.skills.inspect(session.id, parts[0]!, parts[1]!), null, 2) };
      if (action === "audit" && !parts.length) return { kind: "text", text: JSON.stringify(await sdk.skills.audit(session.id), null, 2) };
      if (action === "publishers" && !parts.length) {
        const snapshot = sdk.getState().snapshot;
        return { kind: "text", text: JSON.stringify({ publishers: snapshot?.skillPublishers ?? [], blocks: snapshot?.skillTrustBlocks ?? [],
          warning: "Saved keys verify signatures, not who the publisher is. Blocks are permanent and stop new admissions and future loads." }, null, 2) };
      }
      const saved = command.argument.match(/^publisher-save confirm-trusted ([\s\S]+)$/);
      if (saved) {
        const input: unknown = JSON.parse(saved[1]!);
        if (!isRecord(input) || typeof input.identity !== "string" || typeof input.publicKey !== "string") throw new ClientError("skill_command", "Use /skills publisher-save confirm-trusted {\"identity\":\"NAME\",\"publicKey\":\"PEM\"}.");
        const result = await sdk.skills.savePublisher(input.identity, input.publicKey);
        return { kind: "ok", message: `Publisher key ${result.id} saved in this profile. It verifies signatures; it doesn't prove who the publisher is.` };
      }
      const blocked = command.argument.match(/^block (key|artifact) ([a-f0-9]{64}) confirm-block ([\s\S]+)$/);
      if (blocked) {
        await sdk.skills.block(blocked[1] as "key" | "artifact", blocked[2]!, blocked[3]!.trim());
        return { kind: "ok", message: `Blocked ${blocked[1]} ${blocked[2]}. Admissions and loads that depend on it stop now; already delivered instructions can't be recalled. Blocks are permanent.` };
      }
      const admitted = command.argument.match(/^admit ([a-f0-9]{64}) confirm-reviewed ([\s\S]+)$/);
      if (admitted) return { kind: "text", text: JSON.stringify(await sdk.command(parse(SkillAdmissionCommandSchema, {
        ...JSON.parse(admitted[2]!), type: "skill.admit", sessionId: session.id, expectedInspectionDigest: admitted[1]!, confirmReviewed: true,
      })), null, 2) };
      const revoked = command.argument.match(/^revoke (\S+) (\d+) confirm-revoke ([\s\S]+)$/);
      if (revoked) return { kind: "text", text: JSON.stringify(await sdk.skills.revoke(session.id, revoked[1]!, Number(revoked[2]), revoked[3]!), null, 2) };
      const deleted = command.argument.match(/^delete (\S+) (\d+) confirm-delete$/);
      if (deleted) {
        await sdk.capabilities.delete(deleted[1]!, Number(deleted[2]), true);
        return { kind: "ok", message: `Skill ${deleted[1]} deleted. Existing admissions of it are revoked; no other capability changed.` };
      }
      const install = command.argument.match(/^install (\S+) ([a-f0-9]{64})( global)?$/);
      if (install) {
        const projectId = install[3] ? null : session.projectId;
        if (!install[3] && !projectId) throw new ClientError("skill_command", "This chat has no project. Use /skills install ID SHA global to install for every project.");
        const result = await sdk.skills.install(projectId, install[1]!, install[2]!);
        return { kind: "ok", message: `Skill ${result.id} installed disabled ${projectId ? "in this project" : "for every project"}. Enable it to use it; installing never grants tools.${result.notice ? ` ${result.notice}` : ""}` };
      }
      if (action === "import" && parts.length && session.projectId) {
        const result = await sdk.capabilities.importSkill(session.projectId, command.argument.slice("import ".length));
        return { kind: "ok", message: `Skill ${result.id} imported disabled. Discovery and use never grant tool permissions.${result.notice ? ` ${result.notice}` : ""}` };
      }
      throw new ClientError("skill_command", "Use /skills find QUERY, read/inspect ID SHA, install ID SHA [global], audit, admit INSPECTION_SHA confirm-reviewed INPUT_JSON, revoke ID REV confirm-revoke REASON, sources, import SKILL.md, delete ID REV confirm-delete, publishers, publisher-save confirm-trusted JSON, or block key|artifact SHA confirm-block REASON. Complete review/admission never grants tools; changed/revoked sources need fresh review.");
    }
    case "suggestions": {
      const [action, hash] = command.argument.split(/\s+/);
      if (action === "run" || action === "run-all") {
        if (!hash) throw new ClientError("suggestion_scope", "Preview first, then use /suggestions run DIGEST or run-all DIGEST.");
        const created = await sdk.suggestions.generate(action === "run-all" ? null : session.id, hash, action === "run-all", true);
        return { kind: "session", sessionId: created.id!, side: false };
      }
      if (command.argument && command.argument !== "all" && command.argument !== "session") throw new ClientError("suggestion_scope", "Use /suggestions for this actual project (or project-free scope), /suggestions all for an explicit global review, or run/run-all with its reviewed digest.");
      const allProjects = command.argument === "all";
      const { preview } = await sdk.suggestions.preview(allProjects ? null : session.id, allProjects);
      return client === "desktop" ? { kind: "panel", panel: "Suggestions", allProjects } : { kind: "text", text: JSON.stringify(preview, null, 2) + `\n\nOnly after scope review: /suggestions ${allProjects ? "run-all" : "run"} ${preview.digest}` };
    }
    case "inbox":
    case "attention": {
      if (command.argument === "list" || command.argument.startsWith("list ")) return { kind: "text",
        text: JSON.stringify(sdk.attention.list(command.argument === "list" ? {} : parse(AttentionFiltersSchema, JSON.parse(command.argument.slice(5)))), null, 2) };
      if (command.argument) {
        const [action, id, extra] = command.argument.split(/\s+/);
        if (!["read", "delete"].includes(action ?? "") || !id || extra) throw new ClientError("attention_read", 'Use /inbox, /inbox list {"query":"text","type":"question","state":"unread"}, /inbox read ID or /inbox delete ID. Filtering, reading and deleting never answer or approve.');
        if (action === "delete") { await sdk.attention.delete([id]); return { kind: "ok", message: "Notification deleted. No session, question, tool or budget was changed." }; }
        await sdk.attention.acknowledge([id]);
        return { kind: "ok", message: "Marked read, not resolved. No question was answered or tool approved." };
      }
      return client === "desktop" ? { kind: "panel", panel: "Attention" } : { kind: "text", text: JSON.stringify(sdk.attention.list(), null, 2) };
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
    case "reorder-sessions":
      if (!command.argument.trim()) throw new ClientError("slash_arguments", "Use /reorder-sessions followed by every sibling session ID in the desired order.");
      await sdk.sessions.reorder(command.argument.trim().split(/\s+/));
      return { kind: "ok", message: "Shared sibling order saved. No session was reparented or resumed." };
    case "side": {
      const result = command.argument ? await sdk.sessions.askSide(sessionId, command.argument,
        session.draft.text.trim() === text.trim() ? session.draft.revision : undefined) : await sdk.sessions.side(sessionId);
      return { kind: "session", sessionId: result.id!, side: true };
    }
    case "subsession": {
      const result = await sdk.sessions.spawn(sessionId, "agent", command.argument || undefined);
      return { kind: "session", sessionId: result.id!, side: false };
    }
    case "spawn": {
      if (!command.argument.trim()) throw new ClientError("spawn_prompt", "Use /spawn PROMPT. An empty child assignment was not created.");
      const result = await sdk.sessions.spawnPrompt(sessionId, command.argument,
        session.draft.text.trim() === text.trim() ? session.draft.revision : undefined);
      return { kind: "session", sessionId: result.id!, side: false };
    }
    case "terminal":
      if (command.argument === "global") throw new ClientError("terminal_removed", "Global Terminal was removed. Use the selected session terminal; existing consoles remain inspectable through /terminals list/read/close.");
      if (command.argument) throw new ClientError("terminal_command", "Use /terminal without arguments to open this session's terminal.");
      if (client !== "desktop") throw new ClientError("terminal_context", "This client is already a terminal. Use /terminals open/list/read for explicit Local or pinned SSH user consoles; /terminal opens Ghostty only in desktop.");
      return { kind: "panel", panel: "Terminal" };
    case "terminals": {
      const [action = "list", id, option, extra] = command.argument.trim().split(/\s+/).filter(Boolean);
      if (action === "global") throw new ClientError("terminal_removed", "Global Terminal was removed. Use /terminals open for this session terminal; retained consoles remain inspectable with list/read/close.");
      if (action === "open") {
        const root = command.argument.slice("open".length).trim() || undefined;
        const opened = await sdk.terminal.open(session.id, 80, 24, undefined, root);
        return client === "desktop" ? { kind: "panel", panel: "Terminal" } : { kind: "text", text: JSON.stringify({ ...opened,
          terminal: sdk.getState().snapshot!.terminals.find((terminal) => terminal.id === opened.id), warning: "Explicit user console opened at its captured Local or SSH boundary. Input is not a composer command and never replays." }, null, 2) };
      }
      if (action === "list" && !id) {
        const terminals = sdk.getState().snapshot!.terminals.filter((terminal) => terminal.sessionId === session.id || terminal.sessionId === null);
        return { kind: "text", text: JSON.stringify({ terminals, owners: sdk.getState().snapshot!.terminalOwners,
          warning: "Local and pinned SSH user consoles keep their actual env/peer/root. Bounded volatile output, no agent context, shell replacement or input replay. Service restart preserves; service stop closes known groups." }, null, 2) };
      }
      if (action === "owner-reconcile" && id && !option) {
        await sdk.terminal.reconcileOwner(id);
        return { kind: "text", text: JSON.stringify(sdk.getState().snapshot!.terminalOwners.find((owner) => owner.id === id), null, 2) };
      }
      if (action === "owner-acknowledge" && id && option === "confirm-inspected" && !extra) {
        await sdk.terminal.acknowledgeOwner(id, true); return { kind: "ok", message: "Your explicit shared-owner inspection was acknowledged. No cleanup proof, key removal or process replacement was inferred." };
      }
      if (!id || extra || !sdk.getState().snapshot!.terminals.some((terminal) => terminal.id === id && (terminal.sessionId === session.id || terminal.sessionId === null))) throw new ClientError("terminal_scope", "Choose an existing terminal in this session or a profile-owned global console.");
      if (action === "read" && (!option || /^\d+$/.test(option) && Number.isSafeInteger(Number(option)))) return { kind: "text", text: JSON.stringify(await sdk.terminal.read(id, Number(option ?? 0)), null, 2) };
      if (action === "reconcile" && !option) {
        await sdk.terminal.reconcile(id);
        return { kind: "text", text: JSON.stringify(sdk.getState().snapshot!.terminals.find((terminal) => terminal.id === id), null, 2) };
      }
      if (action === "close" && !option) { await sdk.terminal.close(id); return { kind: "ok", message: "Exact owned terminal stop observed. Detached/reparented descendants are not proven contained." }; }
      if (action === "acknowledge" && option === "confirm-inspected") {
        await sdk.terminal.acknowledge(id, true); return { kind: "ok", message: "Your explicit process inspection was acknowledged, not proof of historical cleanup." };
      }
      throw new ClientError("terminal_command", "Use /terminals open (explicit new console), list, read ID [OFFSET], reconcile ID, close ID, or acknowledge ID confirm-inspected. Inspection never launches a replacement or replays input.");
    }
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
      if (session.controls.env === "Sandbox") throw new ClientError("diff_env", "Diff transport is not qualified for this env yet. No local checkout was read as a fallback.");
      if (!session.projectId) throw new ClientError("project_required", "Select a project to inspect its bound changes.");
      if (client === "desktop") return { kind: "panel", panel: "Changes" };
      const result = await sdk.workspaces.git(session.id);
      return { kind: "text", text: `${result.branch}\n${result.status}\n\n${result.diff || "No tracked diff. Untracked files are listed above."}` };
    }
    case "plan": {
      if (!session.projectId) throw new ClientError("project_required", "Select a project to open its plan.");
      if (command.argument === "edit") {
        if (client === "desktop") return { kind: "panel", panel: "Plan" };
        const result = await sdk.plans.read(session.id);
        if (client === "cli") return { kind: "text", text: JSON.stringify({ ...result, guidance: "Use plan save FILE --digest OBSERVED_DIGEST and --binding BINDING_SHA for Remote. No Local file opener was used." }, null, 2) };
        return { kind: "panel", panel: "Plan", planEditor: { sessionId: session.id, path: result.path, text: result.text, digest: result.digest, bindingDigest: result.bindingDigest, boundary: result.boundary, env: session.controls.env } };
      }
      if (command.argument === "saves") return { kind: "text", text: JSON.stringify(await sdk.plans.saves(session.id), null, 2) };
      if (command.argument.startsWith("info ")) return { kind: "text", text: JSON.stringify(await sdk.plans.saveInfo(session.id, command.argument.slice(5).trim()), null, 2) };
      if (command.argument.startsWith("stop ")) {
        await sdk.plans.stopSave(session.id, command.argument.slice(5).trim());
        return { kind: "ok", message: "Stop requested for this exact Remote plan save. Inspect its actual outcome; no newer turn was targeted." };
      }
      if (command.argument.startsWith("save ") && command.argument.endsWith(" confirm-write")) {
        const value: unknown = JSON.parse(command.argument.slice(5, -" confirm-write".length));
        if (!isRecord(value) || Object.keys(value).some((key) => !["text", "expectedDigest", "expectedBinding"].includes(key)) || typeof value.text !== "string" || typeof value.expectedDigest !== "string" || value.expectedBinding !== undefined && typeof value.expectedBinding !== "string") throw new ClientError("plan_command", "Use /plan save {text,expectedDigest,expectedBinding?} confirm-write after reviewing the exact bound plan. Remote requires its reviewed binding.");
        const saved = await sdk.plans.save(session.id, value.text, value.expectedDigest, value.expectedBinding);
        return { kind: "ok", message: `Exact plan saved and independently retained as ${saved.id}. No model was called or permission changed.` };
      }
      if (command.argument) throw new ClientError("plan_command", "Use /plan, saves, info ID, stop ID, or save {text,expectedDigest} confirm-write. Inspect partial outcomes before a new explicit save.");
      if (client === "desktop") return { kind: "panel", panel: "Plan" };
      const result = await sdk.plans.read(session.id);
      if (session.controls.env === "Remote") return { kind: "text", text: result.exists ? result.text : `No plan file at ${result.path}. Use the explicit SDK/plan save action; no Local file opener was used.` };
      const project = sdk.getState().snapshot!.projects.find((project) => project.id === session.projectId)!;
      const workspace = session.workspaceId ? sdk.getState().snapshot!.managedWorkspaces.find((value) => value.id === session.workspaceId) : undefined;
      if (session.workspaceId && !workspace) throw new ClientError("workspace_missing", "The bound worktree is unavailable. No base plan path was substituted.");
      if (!result.exists) throw new ClientError("plan_missing", `No plan file at ${result.path}. Save one explicitly first.`);
      return { kind: "panel", panel: "Plan", path: `${(workspace?.path ?? project.path).replace(/\/$/, "")}/${result.path}`, text: result.text };
    }
    case "insights": return { kind: "panel", panel: "Insights" };
    case "pr": {
      const url = sessionPullRequestUrl(session, sdk.getState().snapshot!);
      if (!url) throw new ClientError("pr_missing", "This session has no connected PR.");
      return { kind: "panel", panel: "PR", url };
    }
    case "copy": return { kind: "copy", text: sdk.prompts.text(sessionId, command.argument || undefined) };
    case "queue": return { kind: "panel", panel: "Queue", text: JSON.stringify(session.queue, null, 2) };
    case "run": {
      if (!command.argument) throw new ClientError("slash_arguments", "Use /run QUEUED_PROMPT_ID.");
      await sdk.prompts.release(sessionId, command.argument, session.queueRevision); return { kind: "ok", message: "Released for admission." };
    }
    case "help": {
      const entries = await sdk.commands.list(sessionId), shadowed = entries.filter((entry) => entry.kind === "shadowed");
      const help = [...slashCommands.map((entry) => `/${entry.name}${"argument" in entry ? ` ${entry.argument}` : ""}  ${entry.description}`),
        ...entries.flatMap((entry) => entry.kind === "skill" ? [`/${entry.name}  Skill / ${entry.skill.sourceName}: ${entry.description}`] : []),
        ...shadowed.length ? ["", "Skills to rename (a built-in command takes precedence):", ...shadowed.map((entry) => `${entry.name}  ${entry.skill.sourceName}: ${entry.description}`)] : []].join("\n");
      return client === "tui" ? { kind: "client-view", name: "help", argument: command.argument, text: help } : { kind: "text", text: help };
    }
    default: {
      const entries = await sdk.commands.list(sessionId), matches = entries.filter((entry) => entry.kind === "skill" && entry.name === command.name);
      const shadowed = entries.find((entry) => entry.kind === "shadowed" && entry.name === command.name);
      if (!matches.length && shadowed?.kind === "shadowed") throw new ClientError("skill_shadowed", shadowed.description);
      if (matches.length !== 1 || matches[0]?.kind !== "skill") throw new ClientError("unknown_slash", matches.length > 1 ? "Multiple skills share this name. Select its exact source from the slash list." : "Unknown shared slash command. Use /help.");
      const selected = matches[0].skill;
      await sdk.skills.use(sessionId, selected.id, selected.digest, session.draft.revision, command.argument);
      return { kind: "ok", message: `Skill ${selected.name} loaded and attached to this draft as untrusted guidance. Send the draft to use it; no model or permission was started.` };
    }
  }
}
