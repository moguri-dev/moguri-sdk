import { ClientError } from "../../client/src/index.ts";
import type { MoguriSdk } from "./index.ts";
import { ArtifactKindSchema, CandidatePatchSchema, CandidateGenerationInputSchema, CompoundInputSchema, WinddownQuerySchema, WinddownCommandSchema, DecisionSettingsSchema, BudgetQuerySchema, TelemetryQuerySchema, CompactionCommandSchema, CompactionQuerySchema, KupoSettingsSchema, KUPO_MODEL_ID, ModelOptionsSchema, SandboxCommandSchema, SandboxQuerySchema, DocumentReadOptionsSchema, DocumentSearchOptionsSchema, DocumentListOptionsSchema, parse, isRecord, BUDGET_WARNING, type ArtifactExport, type ArtifactKind, type PlanBinding } from "../../protocol/src/index.ts";
import { workspaceFeatureSlash } from "./workspace-features.ts";
import { integrationSlash } from "./integration-slash.ts";

export type SessionPanel = "Terminal" | "Browser" | "Insights" | "Dashboard" | "PR" | "Changes" | "Files" | "Plan" | "Artifacts" | "Candidates" | "Side chat" | "Suggestions" | "Attention" | "Sandbox";
export interface ArtifactEditorRequest { id: string | null; revision: number; kind: ArtifactKind; name: string; text: string; projectId: string | null; sessionId: string | null; status: "active" | "archived"; folderId?: string | null; workItemId?: string | null }
export interface PlanEditorRequest extends Partial<PlanBinding> { sessionId: string; path: string; text: string; digest: string; env: "Local" | "Remote" | "Sandbox" }
export type SlashResult =
  | { kind: "ok"; message: string }
  | { kind: "session"; sessionId: string; side: boolean }
  | { kind: "panel"; panel: SessionPanel | "Settings" | "Models" | "Queue"; url?: string; path?: string; text?: string; allProjects?: boolean; planEditor?: PlanEditorRequest }
  | { kind: "text"; text: string }
  | { kind: "copy"; text: string }
  | { kind: "artifact-editor"; artifact: ArtifactEditorRequest }
  | { kind: "profiles" }
  | { kind: "profile"; profileId: string }
  | { kind: "export"; document: ArtifactExport; path?: string };
export const slashCommands = [
  { name: "progress", description: "Compare the bound plan checklist with optional long-task model estimates" },
  { name: "attach-file", description: "Capture a local source/text file, image, PDF, DOCX or XLSX snapshot", argument: "ABSOLUTE_PATH" },
  { name: "attach-document", description: "Extract a PDF/DOCX/XLSX locally without whole-document model injection", argument: "ABSOLUTE_PATH" },
  { name: "document-read", description: "Bounded retained page/section/spreadsheet-range inspection", argument: "ID [OPTIONS_JSON]" },
  { name: "documents", description: "Bounded document descriptor inventory", argument: "[OPTIONS_JSON]" },
  { name: "document-search", description: "Literal retained-document search with bounded provenance", argument: "ID OPTIONS_JSON" },
  { name: "document-cancel", description: "Cancel one exact active document capture", argument: "CAPTURE_ID" },
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
  { name: "terminals", description: "Explicitly open or inspect user consoles at their actual Local/SSH boundary", argument: "[open|list|read ID [OFFSET]|reconcile ID|close ID|acknowledge ID confirm-inspected|owner-reconcile OWNER|owner-acknowledge OWNER confirm-inspected]" },
  { name: "browser", description: "Open a preview browser", argument: "[URL]" },
  { name: "diff", description: "Read local file changes" },
  { name: "plan", description: "Read or explicitly save the bound project plan; inspect/stop exact Remote saves", argument: "[edit|saves|info SAVE_ID|stop SAVE_ID|save {text,expectedDigest,expectedBinding?} confirm-write]" },
  { name: "artifacts", description: "View independent retained documents" },
  { name: "candidates", description: "Review retained repository proposals and actual stage/apply outcomes" },
  { name: "candidate", description: "Read retained role proposals, generate unaccepted data or stage reviewed bytes; application stays separate", argument: "[role-proposal ID|generate-preview JSON|generate JSON confirm-cost|generation ID|generation-stop ID|preview JSON|stage JSON confirm-stage|read ID|apply-preview ID|apply ID REV SHA confirm-apply|reject ID REV confirm-reject|stop ID]" },
  { name: "model-evidence", description: "Explicitly inspect provider-declared family/version, not independence or approval; no inference", argument: "[MODEL_ID]" },
  { name: "roles", description: "Inspect retained role intent, calls, raw data and declared contracts; never dispatch or approve", argument: "[SEQUENCE_ID [ROLE_INDEX]|contract SEQUENCE_ID ROLE_INDEX]" },
  { name: "compound", description: "Review bounded Cascade/Critique and separately approve owned project tests; source application stays separate", argument: "[list|preview INPUT_JSON|start SHA confirm-cost INPUT_JSON|read ID|validation ID|review ID VALIDATION REV SHA confirm-stage-and-test|deny ID VALIDATION REV SHA confirm-deny|stop ID confirm-stop]" },
  { name: "winddown", description: "Inspect reserved finishing models and separately review actual-user accepted-work Git checkpoints", argument: "[status|list|read ID|commit-preview JSON|commit REV SHA confirm-git JSON|decline ID REV confirm-decline|stop ID confirm-stop]" },
  { name: "decisions", description: "Configure bounded decision advice and inspect actual actor/charges; never answer or approve", argument: "[status|list|read ID|stop ID confirm-stop|set POLICY_JSON]" },
  { name: "artifact", description: "Read/edit/archive/delete/export an independent document", argument: "[ID|new KIND NAME|edit ID|history ID|archive ID|restore ID|delete ID REV confirm-delete|export ID [ABSOLUTE_PATH]]" },
  { name: "question", description: "Inspect or explicitly answer an actual pending question", argument: "[answer ID REV TEXT]" },
  { name: "budget", description: "Inspect cumulative accounting or explicitly set estimated limits", argument: "[status|Unlimited|set TOKENS|- USD|- confirm-estimates|profile/global TOKENS|- USD|- REV confirm-estimates|clear-profile/clear-global REV confirm-policy]" },
  { name: "dashboard", description: "Inspect model accounting, planned holds, tool/MCP outcomes and retained storage", argument: "[FILTERS_JSON|calls FILTERS_JSON|plans FILTERS_JSON|operations FILTERS_JSON|storage]" },
  { name: "repository", description: "Review explicit root-bound metadata; no automatic GitHub or model request", argument: "[preview|state|refresh BINDING REV confirm-lookup|clear REV confirm-clear|stop JOB_ID]" },
  { name: "memory", description: "Index/search the session's actual Local or pinned SSH repository; no model request", argument: "[state|index|search TEXT|graph [PATH]|remember CONVENTION|stop JOB_ID]" },
  { name: "knowledge", description: "Review Sky/Terra/Glacier knowledge with explicit source promotion and version rollback", argument: "[list TIER|search TIER TEXT|read ID|save JSON|update ID REV JSON|promote ID REV SHA confirm-promote JSON|history ID|version ID SHA|rollback ID REV SHA confirm-rollback|forget ID REV confirm-forget]" },
  { name: "marketplace", description: "Browse exact committed repository catalogs and install reviewed bundles disabled", argument: "[catalog SOURCE_JSON|preview INPUT_JSON|install SHA confirm-install INPUT_JSON]" },
  { name: "hooks", description: "Inspect or import disabled, bounded lifecycle hooks; execution requires actual tool approval", argument: "[list|import DEFINITION_JSON]" },
  { name: "capability", description: "Inspect historical bytes, explicitly enable/disable, roll back disabled or insert a reviewed skill", argument: "[history ID|version ID SHA|enable/disable ID REV confirm-state|rollback ID REV SHA confirm-rollback|use ID SHA]" },
  { name: "containment", description: "Inspect process-group limits or require qualified SendBox for whole-session containment", argument: "[status|require-sandbox confirm-policy]" },
  { name: "cache", description: "Inspect verified Local dependency plans and explicit private registry scopes", argument: "[inspect MANAGER|prepare MANAGER SHA accept-metadata|install MANAGER SHA accept-metadata replace-node-modules|registries|registry-save REV ID|- JSON|registry-remove ID REV confirm-remove|token ID|clear-token ID]" },
  { name: "github", description: "Two-way Git/GitHub with exact-root review, protected-write confirmations, pinned CI and no replay", argument: "[browse JSON|preview ACTION_JSON|execute confirm-write {action,expectedDigest,confirmations}|history|read/wait ID|stop ID confirm-stop]" },
  { name: "linear", description: "Reviewed Linear issue/project/comment workflows and explicit two-way local ticket sync", argument: "[status|import [CURSOR]|catalog JSON|issue UUID|preview JSON|execute SHA confirm-write JSON|history|read/wait ID|stop ID confirm-stop|token]" },
  { name: "compact", description: "Review explicit metered context proposals; originals stay retained", argument: "[state|preview OPTIONS_JSON|generate PREVIEW_JSON confirm-cost|read ID|stop ID|apply ID REV confirm-reviewed|discard ID REV|restore ACTIVE_ID SOURCE_SHA confirm-restore]" },
  { name: "profiles", description: "Choose or manage isolated profiles" },
  { name: "profile", description: "Explicit profile navigation and metadata", argument: "[use ID|create NAME|rename ID REV NAME|retry ID REV confirm-review|stop ID]" },
  { name: "kupo", description: "Inspect or explicitly configure experimental Single routing", argument: "[status|history|set POLICY_JSON]" },
  { name: "project-removal", description: "Review artifact retention, repository copies and explicit project removal", argument: "[preview|export PATH|materialize-preview [WORKSPACE|-] [NEW_BRANCH]|materialize REVIEW_SHA WORKSPACE|- BRANCH|- confirm-write|materialization JOB|materialize-delete SET_SHA JOB confirm-remove|retain/delete SET_SHA confirm-remove|export-delete SET_SHA EXPORT_SHA confirm-remove]" },
  { name: "insights", description: "Inspect session metadata and usage" },
  { name: "pr", description: "Open the connected pull request" },
  { name: "copy", description: "Copy a queued or sent prompt", argument: "[ID]" },
  { name: "queue", description: "Show queued prompts" },
  { name: "run", description: "Release a held prompt", argument: "ID" },
  { name: "settings", description: "Open shared settings" },
  { name: "models", description: "Choose an available model" },
  { name: "model-settings", description: "Inspect supported working windows or explicitly set model tuning", argument: "[reset|OPTIONS_JSON]" },
  { name: "model", description: "Explicitly select an available fixed model or configured kupo Single", argument: "[EXACT_MODEL_ID]" },
  { name: "remote", description: "Inspect/probe the pinned SSH target or reconcile an existing run", argument: "[probe|reconcile ID|acknowledge ID]" },
  { name: "sandbox", description: "Review native source staging, exact owned runs and separate user publication", argument: "[status|probe confirm-native|preview PATHS_JSON|prepare REVIEW_JSON confirm-stage|execution ID|result ID|stop ID confirm-stop|reconcile ID confirm-inspect|publish-preview ID PATHS_JSON|publish REVIEW_JSON confirm-publish|publication ID|stop-publication ID confirm-stop]" },
  { name: "mcp-remote", description: "Review exact Remote MCP grants and retained calls; never authenticate or approve a tool", argument: "[servers|preview SERVER|grant SERVER SHA256 REV confirm-reviewed [forward-access]|revoke SERVER REV confirm-revoke|calls|inspect OPERATION_ID]" },
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
  const match = text.trim().match(/^\/(\S+)(?:\s+([\s\S]*))?$/);
  if (!match) return null;
  const name = match[1]!;
  return { name: name === "termnial" ? "terminal" : name === "metachat" ? "meta" : name, argument: match[2] ?? "" };
}
export const isSharedSlash = (name: string): boolean => slashCommands.some((command) => command.name === name || "aliases" in command && command.aliases.some((alias) => alias === name));
export async function executeSlash(sdk: MoguriSdk, sessionId: string, text: string, client: "desktop" | "tui" | "cli"): Promise<SlashResult> {
  const command = parseSlash(text);
  if (!command) throw new ClientError("slash", "Use a slash command beginning with /.");
  const session = sdk.getState().snapshot?.sessions.find((session) => session.id === sessionId);
  if (!session) throw new ClientError("session_missing", "Choose an existing session.");
  switch (command.name) {
    case "documents": return { kind: "text", text: JSON.stringify(await sdk.attachments.listDocuments(session.id, parse(DocumentListOptionsSchema, JSON.parse(command.argument || "{}"))), null, 2) };
    case "progress": return { kind: "text", text: JSON.stringify(await sdk.sessions.progress(session.id), null, 2) };
    case "github":
    case "linear": return integrationSlash(sdk, session, command.name, command.argument);
    case "knowledge":
    case "marketplace":
    case "hooks":
    case "capability":
    case "containment":
    case "cache": return workspaceFeatureSlash(sdk, session, command.name, command.argument);
    case "model-settings": {
      if (!command.argument) return { kind: "text", text: JSON.stringify({ options: session.controls.modelOptions ?? {}, context: (await sdk.sessions.context(session.id)).context }, null, 2) };
      if (command.argument === "reset") {
        const { modelOptions: _, ...controls } = session.controls;
        await sdk.sessions.configure(session.id, controls, session.revision);
      } else await sdk.sessions.modelOptions(session.id, parse(ModelOptionsSchema, JSON.parse(command.argument)), session.revision);
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
      if (command.name === "models" || !command.argument) return client === "cli" ? { kind: "text", text: JSON.stringify(sdk.getState().snapshot!.provider.models, null, 2) } : { kind: "panel", panel: "Models" };
      const model = sdk.getState().snapshot!.provider.models.find((model) => model.id === command.argument && (!model.environments || model.environments.includes(session.controls.env)));
      if (!model) throw new ClientError("model_unavailable", "Choose an exact available model ID for this env. Inspect /models and /kupo status; no provider or policy fallback was used.");
      const { modelOptions: _, ...controls } = session.controls;
      await sdk.sessions.configure(session.id, { ...controls, modelId: model.id }, session.revision);
      return { kind: "ok", message: model.synthetic ? `kupo ${sdk.routing.policy()?.workflow === "compound" ? "Compound" : "Single"} selected. Actual roles are metered separately; no inference started and no permission changed.` : `${model.name} selected explicitly. Previous model-specific options were cleared; no inference started.` };
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
      const [action, id, revision, confirmation, ...extra] = command.argument.split(/\s+/);
      if (action === "read" && id && revision === undefined) return { kind: "text", text: JSON.stringify(await sdk.winddown.read(id), null, 2) };
      if (action === "stop" && id && revision === "confirm-stop" && confirmation === undefined) {
        await sdk.winddown.stop(id); return { kind: "ok", message: "Original finishing model/Git stop requested. Actual cleanup/publication may remain partial; no replay or rollback." };
      }
      if (action === "decline" && id && revision && /^\d+$/.test(revision) && confirmation === "confirm-decline" && !extra.length) {
        await sdk.winddown.decline(id, Number(revision), true); return { kind: "ok", message: "Actual user declined this exact checkpoint's Git publication. No extra model or branch was created." };
      }
      throw new ClientError("winddown_command", "Use /winddown status/list/read ID, commit-preview JSON, its exact commit REV SHA confirm-git JSON, decline ID REV confirm-decline or stop ID confirm-stop.");
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
      if (!command.argument || command.argument === "status") return { kind: "text", text: JSON.stringify({ policy: sdk.routing.policy(), models: sdk.getState().snapshot!.provider.models, diagnostics: sdk.getState().snapshot!.routingDiagnostics, warning: sdk.routing.policy()?.workflow === "compound" ?
        "Reviewed Local Cascade/Critique requires exact source/stages/test input through /compound and actual-user source application. Lineage and quality remain limited claims, not permission. Finite Local turns additionally require explicit reserved wind-down; inspect /winddown status." :
        "Experimental Single only in this saved policy, explicit hosted-data consent, no automatic fallback. Finite Local turns require explicit reserved wind-down; inspect /winddown status. Compound uses its separately reviewed policy; images remain unavailable." }, null, 2) };
      if (command.argument === "history") return { kind: "text", text: JSON.stringify(sdk.routing.history(session.id), null, 2) };
      if (command.argument.startsWith("set ")) {
        await sdk.routing.configure(parse(KupoSettingsSchema, JSON.parse(command.argument.slice(4))), sdk.settings.get()!.revision);
        return { kind: "ok", message: "Explicit scoped routing policy saved. No model or inference was selected/started. Hosted data and concrete compound routes need their explicit review; policy cannot lift hard budgets." };
      }
      throw new ClientError("routing_command", "Use /kupo status, history or set POLICY_JSON. Configure the actual scoped pool before explicitly selecting /model kupo.");
    }
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
      const [action = "state", ...parts] = command.argument ? command.argument.split(/\s+/) : [];
      if (action === "state" && !parts.length) return { kind: "text", text: JSON.stringify(await sdk.compactions.state(session.id), null, 2) };
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
      throw new ClientError("compaction_command", "Use /compact state, preview OPTIONS_JSON, generate {digest,modelId,keepRecentTurns} confirm-cost, read ID, stop ID, apply ID REV confirm-reviewed, discard ID REV, or restore ACTIVE_ID SOURCE_SHA confirm-restore.");
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
      if (action !== "answer" || !id || !revision || !/^\d+$/.test(revision) || !text.length) throw new ClientError("question_answer", "Use /question, or explicitly /question answer ID REV TEXT. No answer or permission is inferred.");
      if (!question || question.id !== id) throw new ClientError("question_scope", "This is not the current question for this conversation.");
      await sdk.questions.answer(id, text.join(" "), Number(revision)); return { kind: "ok", message: "Actual user answer recorded. Tool/Git permissions and policy were not changed." };
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
      const matches = (action === "retain" || action === "delete") && args.length === 2 && args[1] === "confirm-remove" || (action === "export-delete" || action === "materialize-delete") && args.length === 3 && args[2] === "confirm-remove";
      if (!matches || !/^[a-f0-9]{64}$/.test(args[0] ?? "") || action === "export-delete" && !/^[a-f0-9]{64}$/.test(args[1] ?? "")) throw new ClientError("project_removal", "Preview first. Use retain/delete SET_SHA confirm-remove, export-delete SET_SHA EXPORT_SHA confirm-remove, or materialize-delete SET_SHA COMPLETED_JOB confirm-remove. Repository copies use materialize-preview, then materialize REVIEW_SHA WORKSPACE|- BRANCH|- confirm-write. Worktrees must be removed separately.");
      const configuration = (await sdk.projects.configuration(session.projectId)).configuration;
      await sdk.projects.remove(session.projectId, true, configuration.revision, { action: action === "export-delete" ? "export" : action === "materialize-delete" ? "materialize" : action === "retain" ? "retain" : "delete", expectedDigest: args[0]!, ...(action === "export-delete" ? { exportedDigest: args[1]! } : {}), ...(action === "materialize-delete" ? { materializationId: args[1]! } : {}) });
      return { kind: "ok", message: "Project data removed with your exact artifact choice. Repository files, branches, external PRs and shared stores were preserved." };
    }
    case "artifacts": return client === "desktop" || client === "tui" ? { kind: "panel", panel: "Artifacts" } : { kind: "text", text: JSON.stringify(sdk.getState().snapshot!.artifacts, null, 2) };
    case "artifact": {
      const [action, id, ...rest] = command.argument.split(/\s+/);
      if (action === "new" && id && rest.length) return { kind: "artifact-editor", artifact: { id: null, revision: 0, kind: parse(ArtifactKindSchema, id), name: rest.join(" "), text: "", projectId: session.projectId, sessionId: session.id, status: "active" } };
      if (!action) return { kind: "text", text: JSON.stringify(sdk.getState().snapshot!.artifacts, null, 2) };
      if (action === "edit" && id && !rest.length) {
        const value = await sdk.artifacts.read(id);
        return { kind: "artifact-editor", artifact: { ...value.artifact, text: value.text, sessionId: value.artifact.originSessionId } };
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
        const input = parse(SandboxQuerySchema, { type: "sandbox.publication.preview", executionId: id, paths: JSON.parse(requested) });
        const result = await sdk.query(input);
        if (result.type !== "sandbox.publication.preview") throw new ClientError("sandbox_command", "Native publication preview changed its requested response type.");
        const execution = (await sdk.sandbox.execution(id)).execution;
        return text({ ...result, confirmCommand: `/sandbox publish ${JSON.stringify({ executionId: id, paths: result.preview.document.patch.edits.map((edit) => edit.path),
          expectedDigest: result.preview.digest, expectedRevision: execution.revision })} confirm-publish` });
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
      return { kind: "text", text: result.content.kind === "text" ? result.content.text : JSON.stringify({ attachment: result.attachment, diagnostic: result.content.kind === "document" ? "Original and extraction are retained privately. Use /document-read ID with page/section/sheet/range options, or /document-search ID with a literal query. No complete document was injected." : "Image retained privately. Desktop previews pixels; terminal/CLI may inspect its typed metadata without pretending clipboard support." }, null, 2) };
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
      if (client !== "desktop") throw new ClientError("terminal_context", "This client is already a terminal. Use /terminals open/list/read for explicit Local or pinned SSH user consoles; /terminal opens Ghostty only in desktop.");
      return { kind: "panel", panel: "Terminal" };
    case "terminals": {
      const [action = "list", id, option, extra] = command.argument.trim().split(/\s+/).filter(Boolean);
      if (action === "open" && !id) {
        const opened = await sdk.terminal.open(session.id);
        return client === "desktop" ? { kind: "panel", panel: "Terminal" } : { kind: "text", text: JSON.stringify({ ...opened,
          terminal: sdk.getState().snapshot!.terminals.find((terminal) => terminal.id === opened.id), warning: "Explicit user console opened at its captured Local or SSH boundary. Input is not a composer command and never replays." }, null, 2) };
      }
      if (action === "list" && !id) {
        const terminals = sdk.getState().snapshot!.terminals.filter((terminal) => terminal.sessionId === session.id);
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
      if (!id || extra || !sdk.getState().snapshot!.terminals.some((terminal) => terminal.id === id && terminal.sessionId === session.id)) throw new ClientError("terminal_scope", "Choose an existing terminal ID from /terminals in this session.");
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
    case "help": return { kind: "text", text: slashCommands.map((entry) => `/${entry.name}${"argument" in entry ? ` ${entry.argument}` : ""}  ${entry.description}`).join("\n") };
    default: throw new ClientError("unknown_slash", "Unknown shared slash command. Use /help.");
  }
}
