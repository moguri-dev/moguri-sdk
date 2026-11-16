import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";
import { MAX_TEXT, MoguriError } from "./core.ts";
import { ArtifactKindSchema, type ArtifactExport, type ArtifactKind } from "./artifacts.ts";
import type { PlanBinding } from "./plan-saves.ts";
import { ContinueWorkReviewSchema, type ContinueWorkReview } from "./kanban.ts";
import { GithubItemSchema, GithubProjectResponseSchema, GithubRepositorySchema, GithubScopeSchema } from "./github-workflows.ts";
import type { QueueItem, StoredEvent } from "./index.ts";

const object = <T extends Record<string, TSchema>>(properties: T) => Type.Object(properties, { additionalProperties: false });
const id = Type.String({ minLength: 1, maxLength: 128 });
const hash = Type.String({ pattern: "^[a-f0-9]{64}$" });
export const CommandClientSchema = Type.Union([Type.Literal("desktop"), Type.Literal("tui"), Type.Literal("cli")]);
export type CommandClient = Static<typeof CommandClientSchema>;
export type SessionPanel = "Terminal" | "Browser" | "Insights" | "Dashboard" | "PR" | "Code change" | "Work item" | "Changes" | "Files" | "Plan" | "Artifacts" | "Candidates" | "Side chat" | "Suggestions" | "Attention" | "Sandbox";
export interface ArtifactEditorRequest { id: string | null; revision: number; kind: ArtifactKind; name: string; text: string; projectId: string | null; sessionId: string | null; status: "active" | "archived"; folderId?: string | null; workItemId?: string | null }
export interface PlanEditorRequest extends Partial<PlanBinding> { sessionId: string; path: string; text: string; digest: string; env: "Local" | "Remote" | "Sandbox" }
export const GithubCommandViewSchema = Type.Union([
  object({ kind: Type.Literal("repositories"), query: Type.String({ maxLength: 4096 }),
    result: object({ type: Type.Literal("github.repositories"), boundary: Type.Literal("controller-gh-account-not-ssh"), account: id, accountId: id,
      source: Type.Union([Type.Literal("account"), Type.Literal("public")]), repositories: Type.Array(GithubRepositorySchema, { maxItems: 3000 }),
      page: Type.Integer({ minimum: 1 }), nextPage: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]), warning: Type.String({ maxLength: 8192 }) }) }),
  object({ kind: Type.Literal("items"), scope: GithubScopeSchema, context: GithubProjectResponseSchema,
    resource: Type.Union([Type.Literal("issue"), Type.Literal("pull")]), items: Type.Array(GithubItemSchema, { maxItems: 3000 }),
    nextPage: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]) }),
]);
export type GithubCommandView = Static<typeof GithubCommandViewSchema>;
export type SlashResult =
  | { kind: "ok"; message: string }
  | { kind: "session"; sessionId: string; side: boolean }
  | { kind: "panel"; panel: SessionPanel | "Settings" | "Models" | "Queue"; url?: string; path?: string; text?: string; allProjects?: boolean; planEditor?: PlanEditorRequest }
  | { kind: "text"; text: string }
  | { kind: "continue-work"; review: ContinueWorkReview; choices: ["kanban", "prompt"] }
  | { kind: "copy"; text: string }
  | { kind: "artifact-editor"; artifact: ArtifactEditorRequest }
  | { kind: "profiles" }
  | { kind: "profile"; profileId: string }
  | { kind: "export"; document: ArtifactExport; path?: string }
  | { kind: "github-view"; view: GithubCommandView }
  | { kind: "client-view"; name: string; argument: string; text?: string };
const nullableId = Type.Union([id, Type.Null()]);
const panel = Type.Union([
  Type.Literal("Terminal"), Type.Literal("Browser"), Type.Literal("Insights"), Type.Literal("Dashboard"), Type.Literal("PR"),
  Type.Literal("Code change"), Type.Literal("Work item"), Type.Literal("Changes"), Type.Literal("Files"), Type.Literal("Plan"),
  Type.Literal("Artifacts"), Type.Literal("Candidates"), Type.Literal("Side chat"), Type.Literal("Suggestions"), Type.Literal("Attention"),
  Type.Literal("Sandbox"), Type.Literal("Settings"), Type.Literal("Models"), Type.Literal("Queue"),
]);
const longText = Type.String({ maxLength: 8 * 1024 * 1024 });
export const SlashResultSchema = Type.Union([
  object({ kind: Type.Literal("ok"), message: longText }),
  object({ kind: Type.Literal("session"), sessionId: id, side: Type.Boolean() }),
  object({ kind: Type.Literal("text"), text: longText }),
  object({ kind: Type.Literal("copy"), text: longText }),
  object({ kind: Type.Literal("profiles") }),
  object({ kind: Type.Literal("profile"), profileId: id }),
  object({ kind: Type.Literal("github-view"), view: GithubCommandViewSchema }),
  object({ kind: Type.Literal("client-view"), name: Type.String({ minLength: 1, maxLength: 128 }), argument: Type.String({ maxLength: MAX_TEXT }), text: Type.Optional(longText) }),
  object({ kind: Type.Literal("export"), document: object({ filename: Type.String({ minLength: 1, maxLength: 4096 }),
    mediaType: Type.Literal("application/json"), text: longText, digest: hash }), path: Type.Optional(Type.String({ maxLength: 4096 })) }),
  object({ kind: Type.Literal("artifact-editor"), artifact: object({ id: nullableId, revision: Type.Integer({ minimum: 0 }), kind: ArtifactKindSchema,
    name: Type.String({ maxLength: 160 }), text: longText, projectId: nullableId, sessionId: nullableId,
    status: Type.Union([Type.Literal("active"), Type.Literal("archived")]), folderId: Type.Optional(nullableId), workItemId: Type.Optional(nullableId) }) }),
  object({ kind: Type.Literal("continue-work"), review: ContinueWorkReviewSchema,
    choices: Type.Tuple([Type.Literal("kanban"), Type.Literal("prompt")]) }),
  object({ kind: Type.Literal("panel"), panel, url: Type.Optional(Type.String({ maxLength: 8192 })), path: Type.Optional(Type.String({ maxLength: 4096 })),
    text: Type.Optional(longText), allProjects: Type.Optional(Type.Boolean()), planEditor: Type.Optional(object({
      sessionId: id, path: Type.String({ maxLength: 4096 }), text: longText, digest: Type.String({ maxLength: 128 }),
      env: Type.Union([Type.Literal("Local"), Type.Literal("Remote"), Type.Literal("Sandbox")]), bindingDigest: Type.Optional(hash),
      boundary: Type.Optional(object({ env: Type.Literal("Remote"), root: Type.String({ maxLength: 4096 }), hostFingerprint: Type.String({ maxLength: 256 }), workerDigest: hash })),
    })) }),
]);
export const CommandBindingSchema = object({
  profileId: id, sessionId: id, projectId: Type.Union([id, Type.Null()]), workspaceId: Type.Union([id, Type.Null()]),
  env: Type.Union([Type.Literal("Local"), Type.Literal("Remote"), Type.Literal("Sandbox")]),
  roots: Type.Array(object({ projectId: Type.Union([id, Type.Null()]), root: Type.String({ minLength: 1, maxLength: 4096 }),
    device: Type.String({ pattern: "^[0-9]+$", maxLength: 40 }), inode: Type.String({ pattern: "^[0-9]+$", maxLength: 40 }) }), { maxItems: 1000 }),
  remote: Type.Union([object({ targetDigest: hash, root: Type.Union([Type.String({ minLength: 1, maxLength: 4096 }), Type.Null()]) }), Type.Null()]),
});
export type CommandBinding = Static<typeof CommandBindingSchema>;
export const QueuedSlashSchema = object({
  version: Type.Literal(1), actor: Type.Literal("user"), client: CommandClientSchema, name: Type.String({ minLength: 1, maxLength: 128 }),
  argument: Type.String({ maxLength: MAX_TEXT }), binding: CommandBindingSchema, bindingDigest: hash, draftRevision: Type.Optional(Type.Integer({ minimum: 0 })),
});
export type QueuedSlash = Static<typeof QueuedSlashSchema>;
export const CommandExecutionSchema = object({
  version: Type.Literal(1), id, profileId: id, sessionId: id, projectId: Type.Union([id, Type.Null()]),
  queueItemId: id, name: Type.String({ minLength: 1, maxLength: 128 }), client: CommandClientSchema, actor: Type.Literal("user"),
  bindingDigest: hash, inputDigest: hash, resultDigest: Type.Union([hash, Type.Null()]),
  revision: Type.Integer({ minimum: 0 }),
  status: Type.Union([Type.Literal("running"), Type.Literal("waiting-client"), Type.Literal("claimed"),
    Type.Literal("completed"), Type.Literal("failed"), Type.Literal("cancelled"), Type.Literal("partial")]),
  stopRequested: Type.Boolean(), mutationAttempted: Type.Boolean(), jobIds: Type.Array(id, { maxItems: 100, uniqueItems: true }),
  claim: Type.Union([object({ id, clientId: id, tokenDigest: hash }), Type.Null()]),
  createdAt: Type.String({ format: "date-time" }), updatedAt: Type.String({ format: "date-time" }),
  diagnostic: Type.Union([Type.String({ minLength: 1, maxLength: 4096 }), Type.Null()]),
});
export type CommandExecution = Static<typeof CommandExecutionSchema>;
export const CommandDraftSourceSchema = object({ actor: Type.Literal("user"), inputId: id, executionId: id });
export type CommandDraftSource = Static<typeof CommandDraftSourceSchema>;
export interface QueuedCommandsSnapshot { commandExecutions: CommandExecution[] }
export const LiveSlashControlSchema = object({
  version: Type.Literal(1), id, actor: Type.Literal("user"),
  action: Type.Union([Type.Literal("yolo"), Type.Literal("approve"), Type.Literal("stop")]),
  phase: Type.Union([Type.Literal("intent"), Type.Literal("acknowledged"), Type.Literal("partial")]),
  inputDigest: hash, targetTurnId: nullableId, approvalId: nullableId,
  diagnostic: Type.Union([Type.String({ minLength: 1, maxLength: 4096 }), Type.Null()]),
});
export type LiveSlashControl = Static<typeof LiveSlashControlSchema>;
export interface CommandClaim { executionId: string; token: string; revision: number }
export const QueuedContinuationChoiceSchema = object({
  executionId: id, inputDigest: hash, bindingDigest: hash, choice: Type.Union([Type.Literal("kanban"), Type.Literal("prompt")]), actor: Type.Literal("user"),
});
export type QueuedContinuationChoice = Static<typeof QueuedContinuationChoiceSchema>;
/** Session controls that a client may change during a turn by queueing their exact slash command after the work already queued. */
export const QUEUEABLE_CONTROL_COMMANDS = ["model", "effort", "context-window", "model-settings", "kupo-mode", "env", "autonomy", "budget"] as const;
export type QueueableControlCommand = typeof QUEUEABLE_CONTROL_COMMANDS[number];
export const QueuedCommandCommandSchema = Type.Union([
  object({ type: Type.Literal("slash.control.enqueue"), sessionId: id, client: CommandClientSchema,
    name: Type.Union([Type.Literal("model"), Type.Literal("effort"), Type.Literal("context-window"), Type.Literal("model-settings"),
      Type.Literal("kupo-mode"), Type.Literal("env"), Type.Literal("autonomy"), Type.Literal("budget")]), argument: Type.String({ minLength: 1, maxLength: 4096 }) }),
  object({ type: Type.Literal("slash.restore.enqueue"), sessionId: id, client: CommandClientSchema, expectedRevision: Type.Integer({ minimum: 0 }), held: Type.Optional(Type.Boolean()) }),
  object({ type: Type.Literal("slash.prompt.enqueue"), sessionId: id }),
  object({ type: Type.Literal("slash.client.attach"), clientId: id, client: CommandClientSchema,
    handlers: Type.Array(Type.String({ minLength: 1, maxLength: 160 }), { minItems: 1, maxItems: 100, uniqueItems: true }) }),
  object({ type: Type.Literal("slash.client.claim"), clientId: id, executionId: id, expectedRevision: Type.Integer({ minimum: 0 }) }),
  object({ type: Type.Literal("slash.client.complete"), clientId: id, executionId: id, expectedRevision: Type.Integer({ minimum: 0 }),
    token: Type.String({ minLength: 32, maxLength: 256 }), outcome: Type.Union([Type.Literal("completed"), Type.Literal("cancelled"), Type.Literal("failed"), Type.Literal("partial")]),
    diagnostic: Type.Optional(Type.String({ minLength: 1, maxLength: 4096 })), restoreInput: Type.Optional(Type.Boolean()) }),
  object({ type: Type.Literal("slash.client.choose"), clientId: id, executionId: id, expectedRevision: Type.Integer({ minimum: 0 }),
    token: Type.String({ minLength: 32, maxLength: 256 }), choice: Type.Union([Type.Literal("kanban"), Type.Literal("prompt")]) }),
  object({ type: Type.Literal("slash.client.detach"), clientId: id }),
]);
export type QueuedCommandCommand = Static<typeof QueuedCommandCommandSchema>;
export const isQueuedCommandCommand = (input: unknown): input is QueuedCommandCommand => Value.Check(QueuedCommandCommandSchema, input);
export const QueuedCommandQuerySchema = object({ type: Type.Literal("slash.read"), executionId: id });
export type QueuedCommandQuery = Static<typeof QueuedCommandQuerySchema>;
export const isQueuedCommandQuery = (input: unknown): input is QueuedCommandQuery => Value.Check(QueuedCommandQuerySchema, input);
export interface QueuedCommandResponse { type: "slash.read"; execution: CommandExecution; item: QueueItem; result: SlashResult | null }
export const commandViewKey = (result: SlashResult) => result.kind === "client-view" ? `client-view:${result.name}` : result.kind;
export function parseSlashInput(text: string): { name: string; argument: string } | null {
  if (!text.startsWith("/")) return null;
  const match = text.trim().match(/^\/(\S+)(?:\s+([\s\S]*))?$/);
  if (!match) return null;
  const name = match[1]!;
  return { name: name === "termnial" ? "terminal" : name === "metachat" ? "meta" : name, argument: match[2] ?? "" };
}
export const terminalCommandExecution = (status: CommandExecution["status"]) => ["completed", "failed", "cancelled", "partial"].includes(status);
export function hasCombinedWorkspaceHistory(events: readonly StoredEvent[]): boolean {
  const grouped = new Set<string>();
  return events.some((event) => {
    const owner = `${event.profile_id}/${event.session_id}`;
    if (event.event_type === "session.created" && event.payload.repositories?.length) grouped.add(owner);
    return event.event_type.startsWith("slash.") || event.event_type === "draft.saved" && event.payload.source !== undefined ||
      (event.event_type === "queue.enqueued" || event.event_type === "turn.started") && Object.hasOwn(event.payload.item, "command") ||
      (event.event_type === "session.created" || event.event_type === "session.configured") && grouped.has(owner) && event.payload.controls.env === "Sandbox" ||
      event.event_type === "sandbox.workspace_recorded" && Object.hasOwn(event.payload.workspace, "repositories") ||
      event.event_type === "sandbox.execution_recorded" && Object.hasOwn(event.payload.execution, "repositories") ||
      event.event_type === "sandbox.publication_recorded" && event.payload.publication.version === 2;
  });
}
export function projectCommandExecution(previous: CommandExecution | undefined, next: CommandExecution): CommandExecution {
  const immutable = (entry: CommandExecution) => [entry.version, entry.id, entry.profileId, entry.sessionId, entry.projectId,
    entry.queueItemId, entry.name, entry.client, entry.actor, entry.bindingDigest, entry.inputDigest, entry.createdAt];
  if (!Value.Check(CommandExecutionSchema, next) || previous && (terminalCommandExecution(previous.status) ||
    next.revision !== previous.revision + 1 || JSON.stringify(immutable(previous)) !== JSON.stringify(immutable(next))) ||
    !previous && (next.revision !== 0 || next.status !== "running" || next.stopRequested || next.mutationAttempted || next.resultDigest !== null || next.claim !== null)) {
    throw new MoguriError("command_history", "Queued command history lost its original user, input, source or execution ownership. Original state was preserved.", 409);
  }
  if (previous?.stopRequested && !next.stopRequested || previous?.mutationAttempted && !next.mutationAttempted || next.status === "completed" && next.stopRequested ||
    ["waiting-client", "claimed", "completed"].includes(next.status) && next.resultDigest === null ||
    next.status === "claimed" && next.claim === null) {
    throw new MoguriError("command_history", "Queued command completion or client ownership is inconsistent. No result or approval was invented.", 409);
  }
  if (previous && (previous.resultDigest !== null && next.resultDigest !== previous.resultDigest ||
    previous.claim !== null && JSON.stringify(next.claim) !== JSON.stringify(previous.claim) ||
    previous.jobIds.some((id) => !next.jobIds.includes(id)) ||
    previous.status !== "running" && next.status === "running" ||
    previous.status === "claimed" && next.status === "waiting-client")) {
    throw new MoguriError("command_history", "Queued command results, admitted jobs or client claims cannot be replaced or replayed. Original state was preserved.", 409);
  }
  return structuredClone(next);
}
