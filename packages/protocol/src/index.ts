import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";
import { PlatformCommandSchema, defaultSettings, type UserSettings, type CapabilityEntry, type Proposal, type CapabilityJob, type PlatformSnapshot, type IssueBoard, type LocalIssue, type CacheReceipt } from "./platform.ts";
export * from "./platform.ts";

export const PROTOCOL_VERSION = 3;
export const PROFILE_ID = "default";
export const MAX_TEXT = 128 * 1024;
const id = Type.String({ minLength: 1, maxLength: 128 });
const text = Type.String({ maxLength: MAX_TEXT });
const revision = Type.Integer({ minimum: 0 });
const object = <T extends Record<string, TSchema>>(properties: T) => Type.Object(properties, { additionalProperties: false });

export const ControlsSchema = object({
  env: Type.Union([Type.Literal("Local"), Type.Literal("Sandbox"), Type.Literal("Remote")]),
  modelId: Type.Union([id, Type.Null()]),
  autonomy: Type.Union([Type.Literal("Manual"), Type.Literal("Guided"), Type.Literal("Autopilot"), Type.Literal("Autopilot Max")]),
  budget: Type.Union([
    object({ kind: Type.Literal("unlimited") }),
    object({ kind: Type.Literal("limited"), tokens: Type.Optional(Type.Integer({ minimum: 1 })), usd: Type.Optional(Type.Number({ exclusiveMinimum: 0 })) }),
  ]),
});
export type Controls = Static<typeof ControlsSchema>;
export const factoryControls = (): Controls => ({ env: "Local", modelId: null, autonomy: "Manual", budget: { kind: "unlimited" } });

export const AttachmentSchema = object({
  id, kind: Type.Literal("project_file"), path: Type.String({ minLength: 1, maxLength: 4096 }),
  digest: Type.String({ pattern: "^[a-f0-9]{64}$" }), bytes: Type.Integer({ minimum: 0, maximum: MAX_TEXT }),
});
export type Attachment = Static<typeof AttachmentSchema>;
const attachments = Type.Array(AttachmentSchema, { maxItems: 16 });
const sessionId = { sessionId: id };

export const CommandSchema = object({
  id,
  profileId: Type.Literal("default"),
  command: Type.Union([
    object({ type: Type.Literal("project.add"), path: Type.String({ minLength: 1, maxLength: 4096 }) }),
    object({ type: Type.Literal("session.create"), projectId: id, title: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })) }),
    object({ type: Type.Literal("session.configure"), ...sessionId, expectedRevision: revision, controls: ControlsSchema }),
    object({ type: Type.Literal("session.archive"), ...sessionId }),
    object({ type: Type.Literal("session.restore"), ...sessionId }),
    object({ type: Type.Literal("session.resume"), ...sessionId }),
    object({ type: Type.Literal("draft.save"), ...sessionId, expectedRevision: revision, text, attachments }),
    object({ type: Type.Literal("attachment.add"), ...sessionId, expectedRevision: revision, path: Type.String({ minLength: 1, maxLength: 4096 }) }),
    object({ type: Type.Literal("message.send"), ...sessionId, expectedRevision: revision, delivery: Type.Union([Type.Literal("queue"), Type.Literal("steer"), Type.Literal("interrupt")]) }),
    object({ type: Type.Literal("queue.edit"), ...sessionId, messageId: id, expectedRevision: revision, text }),
    object({ type: Type.Literal("queue.remove"), ...sessionId, messageId: id, expectedRevision: revision }),
    object({ type: Type.Literal("queue.make-turn"), ...sessionId, messageId: id, expectedRevision: revision }),
    object({ type: Type.Literal("queue.reorder"), ...sessionId, messageIds: Type.Array(id, { maxItems: 100 }), expectedRevision: revision }),
    object({ type: Type.Literal("session.stop"), ...sessionId }),
    object({ type: Type.Literal("approval.respond"), ...sessionId, approvalId: id, allow: Type.Boolean() }),
    object({ type: Type.Literal("provider.login") }),
    object({ type: Type.Literal("provider.cancel") }),
    object({ type: Type.Literal("provider.logout") }),
    object({ type: Type.Literal("provider.refresh") }),
    object({ type: Type.Literal("policy.set"), allowedEnvs: Type.Array(Type.Union([Type.Literal("Local"), Type.Literal("Sandbox"), Type.Literal("Remote")]), { minItems: 1, uniqueItems: true }) }),
    PlatformCommandSchema,
  ]),
});
export type CommandEnvelope = Static<typeof CommandSchema>;
export type Command = CommandEnvelope["command"];
export type CommandResult = { id?: string; revision?: number };

export class MoguriError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400) { super(message); }
}
export function parse<T extends TSchema>(schema: T, value: unknown): Static<T> {
  if (!Value.Check(schema, value)) throw new MoguriError("invalid_request", "The request does not match the protocol schema.");
  return value;
}
export const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

export interface Project { id: string; name: string; path: string }
export interface ToolCall { id: string; name: string; arguments: Record<string, unknown> }
export interface PublicMessage {
  id: string;
  turnId: string;
  role: "user" | "assistant" | "tool" | "notice";
  text: string;
  timestamp: string;
  reasoning?: string;
  toolCalls?: ToolCall[];
  outcome?: string;
}
export interface Usage {
  stepId: string;
  modelId: string;
  role: "solver" | "subagent";
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  totalTokens: number | null;
  estimatedUsd: number | null;
  providerReportedUsd: number | null;
  billedUsd: number | null;
  requestMs: number;
  quality: "provider-reported" | "unknown";
  outcome: string;
}
export interface QueueItem {
  id: string;
  text: string;
  attachments: Attachment[];
  delivery: "queue" | "steer" | "interrupt";
  targetTurnId?: string;
}
export interface Approval { id: string; stepId: string; call: ToolCall; policyRevision: number; permissionRevision?: number; recommendation?: string }
export interface OwnedProcess { callId: string; pid: number; processGroup: number; turnId: string; outcome: string }
export type SessionStatus = "idle" | "queued" | "running" | "waiting_input" | "stopping" | "completed" | "stopped" | "failed" | "partial" | "archived";
export interface Session {
  id: string;
  projectId: string;
  title: string;
  controls: Controls;
  revision: number;
  status: SessionStatus;
  beforeArchive?: SessionStatus;
  draft: { revision: number; text: string; attachments: Attachment[] };
  queue: QueueItem[];
  queueRevision: number;
  messages: PublicMessage[];
  usage: Usage[];
  processes: OwnedProcess[];
  turnId: string | null;
  pendingApproval: Approval | null;
  lastError: string | null;
  localFinishing: boolean;
  createdAt: string;
  updatedAt: string;
  parentSessionId?: string;
  readOnly?: boolean;
}
export interface ModelInfo { id: string; name: string; contextWindow: number; imageInput: boolean }
export interface ProviderState {
  status: "disconnected" | "connecting" | "connected" | "error";
  models: ModelInfo[];
  login: { code: string; url: string; expiresAt: number } | null;
  diagnostic: string | null;
}
export interface Policy { revision: number; allowedEnvs: Controls["env"][] }
export interface Snapshot extends PlatformSnapshot {
  protocolVersion: number;
  seq: number;
  profileId: "default";
  projects: Project[];
  sessions: Session[];
  provider: ProviderState;
  policy: Policy;
  blockedProjects: string[];
  capabilities: { env: Controls["env"]; ready: boolean; reason: string }[];
}
export interface Connection {
  protocolVersion: number;
  baseUrl: string;
  wsUrl: string;
  token: string;
  pid: number;
}

export interface EventPayloads {
  "project.added": { project: Project };
  "session.created": { title: string; controls: Controls; parentSessionId?: string; readOnly?: boolean; contextDigest?: string };
  "session.configured": { controls: Controls };
  "session.archived": Record<string, never>;
  "session.restored": Record<string, never>;
  "session.resumed": Record<string, never>;
  "session.blocked": { diagnostic: string };
  "draft.saved": { text: string; attachments: Attachment[] };
  "queue.enqueued": { item: QueueItem };
  "queue.edited": { messageId: string; text: string };
  "queue.removed": { messageId: string };
  "queue.reordered": { messageIds: string[] };
  "queue.delivery_changed": { messageId: string; delivery: "queue" };
  "turn.started": { item: QueueItem; controls: Controls; policyRevision: number; promptDigest?: string };
  "steer.applied": { item: QueueItem };
  "model.started": { modelId: string };
  "assistant.delta": { text: string };
  "model.completed": { message: PublicMessage; contextDigest: string; usage: Usage };
  "tool.requested": { approval: Approval };
  "tool.decided": { approvalId: string; allow: boolean; actor: "user" | "policy" | "delegation"; ruleId?: string };
  "tool.started": { call: ToolCall };
  "tool.output": { callId: string; text: string };
  "process.started": { callId: string; pid: number; processGroup: number };
  "tool.completed": { call: ToolCall; text: string; isError: boolean; outcome: string };
  "turn.stop_requested": Record<string, never>;
  "turn.stop_acknowledged": Record<string, never>;
  "turn.finished": { outcome: "completed" | "stopped" | "failed" | "partial"; diagnostic: string | null };
  "policy.updated": { policy: Policy; finishingTurnIds: string[] };
  "provider.changed": { status: ProviderState["status"]; diagnostic: string | null };
  "settings.updated": { settings: UserSettings; revision: number; permissionRevision: number };
  "capability.saved": { entry: CapabilityEntry };
  "capability.proposed": { proposal: Proposal };
  "proposal.decided": { proposalId: string; approve: boolean; actor: "user" };
  "job.started": { job: CapabilityJob };
  "job.progress": { jobId: string; progress: string; status?: "running" };
  "job.finished": { jobId: string; status: CapabilityJob["status"]; resultDigest: string | null; error: string | null };
  "board.saved": { board: IssueBoard };
  "issue.saved": { issue: LocalIssue; actor: "user" | "github" | "linear" };
  "cache.prepared": { receipt: CacheReceipt };
}
export type EventType = keyof EventPayloads;
interface EventMetadata {
  profile_id: string;
  project_id?: string | null;
  session_id?: string | null;
  turn_id?: string | null;
  step_id?: string | null;
  correlation_id?: string | null;
}
export type EventInput = { [K in EventType]: EventMetadata & { event_type: K; payload: EventPayloads[K] } }[EventType];
export type StoredEvent = EventInput & {
  seq: number;
  id: string;
  schema_version: 1;
  timestamp: string;
  work_item_id: null;
  parent_event_id: null;
};
export const eventTypes: readonly EventType[] = [
  "project.added", "session.created", "session.configured", "session.archived", "session.restored", "session.resumed", "session.blocked",
  "draft.saved", "queue.enqueued", "queue.edited", "queue.removed", "queue.reordered", "queue.delivery_changed", "turn.started",
  "steer.applied", "model.started", "assistant.delta", "model.completed", "tool.requested", "tool.decided",
  "tool.started", "tool.output", "process.started", "tool.completed", "turn.stop_requested", "turn.stop_acknowledged",
  "turn.finished", "policy.updated", "provider.changed",
  "settings.updated", "capability.saved", "capability.proposed", "proposal.decided", "job.started", "job.progress", "job.finished",
  "board.saved", "issue.saved", "cache.prepared",
];

export function projectEvents(events: StoredEvent[]): { projects: Project[]; sessions: Session[]; policy: Policy; blockedProjects: string[] } & PlatformSnapshot {
  const projects = new Map<string, Project>();
  const sessions = new Map<string, Session>();
  let policy: Policy = { revision: 0, allowedEnvs: ["Local", "Sandbox", "Remote"] };
  const blockedProjects = new Set<string>();
  let settings: PlatformSnapshot["settings"] = { revision: 0, permissionRevision: 0, values: defaultSettings(), defaults: defaultSettings() };
  const registry = new Map<string, CapabilityEntry>();
  const proposals = new Map<string, Proposal>();
  const jobs = new Map<string, CapabilityJob>();
  const boards = new Map<string, IssueBoard>();
  const issues = new Map<string, LocalIssue>();
  const dependencyCaches = new Map<string, CacheReceipt>();
  for (const event of events) {
    if (event.profile_id !== PROFILE_ID) continue;
    if (event.event_type === "board.saved") boards.set(event.payload.board.projectId, structuredClone(event.payload.board));
    if (event.event_type === "issue.saved") issues.set(event.payload.issue.id, structuredClone(event.payload.issue));
    if (event.event_type === "cache.prepared") dependencyCaches.set(`${event.payload.receipt.projectId}:${event.payload.receipt.manager}`, { ...event.payload.receipt });
    if (event.event_type === "settings.updated") settings = { revision: event.payload.revision, permissionRevision: event.payload.permissionRevision, defaults: defaultSettings(), values: event.payload.settings };
    if (event.event_type === "capability.saved") registry.set(event.payload.entry.id, { ...event.payload.entry });
    if (event.event_type === "capability.proposed") proposals.set(event.payload.proposal.id, { ...event.payload.proposal });
    if (event.event_type === "proposal.decided") {
      const proposal = proposals.get(event.payload.proposalId);
      if (proposal) proposal.status = event.payload.approve ? "approved" : "rejected";
    }
    if (event.event_type === "job.started") jobs.set(event.payload.job.id, { ...event.payload.job });
    if (event.event_type === "job.progress") {
      const job = jobs.get(event.payload.jobId);
      if (job) { job.progress = event.payload.progress; if (event.payload.status) job.status = event.payload.status; }
    }
    if (event.event_type === "job.finished") {
      const job = jobs.get(event.payload.jobId);
      if (job) Object.assign(job, { status: event.payload.status, resultDigest: event.payload.resultDigest, error: event.payload.error });
      if (job?.kind === "cache.install" && event.payload.status === "partial" && job.projectId) blockedProjects.add(job.projectId);
    }
    if (event.event_type === "turn.finished" && ["partial", "failed"].includes(event.payload.outcome) && event.project_id) blockedProjects.add(event.project_id);
    if (event.event_type === "session.resumed" && event.project_id) blockedProjects.delete(event.project_id);
    if (event.event_type === "project.added") projects.set(event.payload.project.id, event.payload.project);
    if (event.event_type === "policy.updated") {
      policy = event.payload.policy;
      for (const session of sessions.values()) session.localFinishing = session.turnId !== null && event.payload.finishingTurnIds.includes(session.turnId);
    }
    if (event.event_type === "session.created") {
      if (!event.session_id || !event.project_id) throw new Error("Invalid session.created event scope.");
      sessions.set(event.session_id, {
        id: event.session_id, projectId: event.project_id, title: event.payload.title,
        controls: event.payload.controls, revision: 0, status: "idle", draft: { revision: 0, text: "", attachments: [] },
        queue: [], queueRevision: 0, messages: [], usage: [], processes: [], turnId: null, pendingApproval: null,
        lastError: null, localFinishing: false, createdAt: event.timestamp, updatedAt: event.timestamp,
        parentSessionId: event.payload.parentSessionId, readOnly: event.payload.readOnly,
      });
    }
    const session = event.session_id ? sessions.get(event.session_id) : undefined;
    if (!session) continue;
    session.updatedAt = event.timestamp;
    const addUser = (item: QueueItem) => session.messages.push({
      id: item.id, turnId: event.turn_id ?? "", role: "user", text: item.text +
        (item.attachments.length ? `\n\nAttached: ${item.attachments.map((attachment) => attachment.path).join(", ")}` : ""),
      timestamp: event.timestamp,
    });
    switch (event.event_type) {
      case "session.configured": session.controls = event.payload.controls; session.revision++; break;
      case "session.archived": session.beforeArchive = session.status; session.status = "archived"; break;
      case "session.restored": session.status = session.beforeArchive ?? "idle"; break;
      case "session.resumed": session.status = session.queue.length ? "queued" : "idle"; session.lastError = null; break;
      case "session.blocked": session.status = "waiting_input"; session.lastError = event.payload.diagnostic; break;
      case "draft.saved": session.draft = { ...event.payload, revision: session.draft.revision + 1 }; break;
      case "queue.enqueued":
        session.queue.push(structuredClone(event.payload.item)); session.queueRevision++;
        if (!session.turnId) session.status = "queued";
        break;
      case "queue.edited": {
        const item = session.queue.find((item) => item.id === event.payload.messageId);
        if (item) item.text = event.payload.text;
        session.queueRevision++;
        break;
      }
      case "queue.removed": session.queue = session.queue.filter((item) => item.id !== event.payload.messageId); session.queueRevision++; break;
      case "queue.delivery_changed": {
        const item = session.queue.find((item) => item.id === event.payload.messageId);
        if (item) { item.delivery = event.payload.delivery; delete item.targetTurnId; }
        session.queueRevision++;
        break;
      }
      case "queue.reordered": {
        const items = new Map(session.queue.map((item) => [item.id, item]));
        session.queue = event.payload.messageIds.map((id) => items.get(id)).filter((item): item is QueueItem => item !== undefined);
        session.queueRevision++;
        break;
      }
      case "turn.started":
        session.turnId = event.turn_id ?? null; session.status = "running"; session.lastError = null; session.localFinishing = false;
        session.queue = session.queue.filter((item) => item.id !== event.payload.item.id); session.queueRevision++;
        addUser(event.payload.item);
        break;
      case "steer.applied":
        session.queue = session.queue.filter((item) => item.id !== event.payload.item.id); session.queueRevision++;
        addUser(event.payload.item);
        break;
      case "model.started":
        session.messages.push({ id: event.step_id ?? event.id, turnId: event.turn_id ?? "", role: "assistant", text: "", timestamp: event.timestamp });
        session.usage.push({
          stepId: event.step_id ?? event.id, modelId: event.payload.modelId, role: session.parentSessionId ? "subagent" : "solver",
          inputTokens: null, outputTokens: null, cacheReadTokens: null, totalTokens: null,
          estimatedUsd: null, providerReportedUsd: null, billedUsd: null, requestMs: 0, quality: "unknown", outcome: "running",
        });
        break;
      case "assistant.delta": {
        const message = session.messages.find((message) => message.id === event.step_id);
        if (message) message.text += event.payload.text;
        break;
      }
      case "model.completed": {
        const index = session.messages.findIndex((message) => message.id === event.payload.message.id);
        if (index >= 0) session.messages[index] = event.payload.message;
        else session.messages.push(event.payload.message);
        const usageIndex = session.usage.findIndex((usage) => usage.stepId === event.payload.usage.stepId);
        if (usageIndex >= 0) session.usage[usageIndex] = event.payload.usage; else session.usage.push(event.payload.usage);
        break;
      }
      case "tool.requested": session.pendingApproval = event.payload.approval; session.status = "waiting_input"; break;
      case "tool.decided": session.pendingApproval = null; if (session.status !== "stopping") session.status = "running"; break;
      case "tool.started":
        session.messages.push({ id: event.payload.call.id, turnId: event.turn_id ?? "", role: "tool", text: `${event.payload.call.name}\n`, timestamp: event.timestamp, toolCalls: [event.payload.call], outcome: "running" });
        break;
      case "tool.output": {
        const message = session.messages.find((message) => message.id === event.payload.callId);
        if (message) message.text = (message.text + event.payload.text).slice(-MAX_TEXT);
        break;
      }
      case "process.started": session.processes.push({ ...event.payload, turnId: event.turn_id ?? "", outcome: "running" }); break;
      case "tool.completed": {
        const message: PublicMessage = {
          id: event.payload.call.id, turnId: event.turn_id ?? "", role: "tool", text: event.payload.text,
          timestamp: event.timestamp, toolCalls: [event.payload.call], outcome: event.payload.outcome,
        };
        const index = session.messages.findIndex((item) => item.id === message.id);
        if (index >= 0) session.messages[index] = message; else session.messages.push(message);
        for (const process of session.processes) if (process.callId === event.payload.call.id) process.outcome = event.payload.outcome;
        break;
      }
      case "turn.stop_requested": session.status = "stopping"; break;
      case "turn.stop_acknowledged": break;
      case "turn.finished":
        session.status = event.payload.outcome; session.turnId = null; session.pendingApproval = null;
        session.lastError = event.payload.diagnostic; session.localFinishing = false;
        for (const usage of session.usage) if (usage.outcome === "running") usage.outcome = "unconfirmed";
        for (const process of session.processes) if (process.outcome === "running") process.outcome = "unconfirmed";
        if (event.payload.diagnostic) session.messages.push({
          id: event.id, turnId: event.turn_id ?? "", role: "notice", text: event.payload.diagnostic, timestamp: event.timestamp, outcome: event.payload.outcome,
        });
        break;
    }
  }
  return { projects: [...projects.values()], sessions: [...sessions.values()], policy, blockedProjects: [...blockedProjects],
    settings, registry: [...registry.values()], proposals: [...proposals.values()], jobs: [...jobs.values()],
    boards: [...boards.values()], issues: [...issues.values()], dependencyCaches: [...dependencyCaches.values()] };
}
