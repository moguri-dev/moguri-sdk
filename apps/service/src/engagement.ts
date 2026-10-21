import { randomUUID } from "node:crypto";
import {
  ConfigurationSpecSchema, EngagementCommandSchema, EngagementQuerySchema, SettingsSchema, ProjectSettingsSchema,
  isRecord, MoguriError, parse, SYSTEM_PROMPT_WARNING,
  type CapabilityEntry, type CommandResult, type ConfigurationProposal, type ConfigurationSpec, type Controls,
  type EngagementCommand, type EngagementQuery, type EngagementResponse, type EventInput, type Session, type Snapshot, type SuggestionPreview, type SuggestionSource, type UserSettings, type ResolvedControls, type Project,
} from "../../../packages/protocol/src/index.ts";
import { Value } from "typebox/value";
import { digest, EventStore } from "./store.ts";
import type { ProjectService } from "./project-service.ts";
import type { WorkspaceFinish } from "./session-workspace.ts";
import { assertFolderAccess, assertFolderName, folderPolicy } from "./project-policy.ts";
import { readProjectFile, writeProjectFile } from "./files.ts";

export const isEngagementCommand = (value: unknown): value is EngagementCommand => Value.Check(EngagementCommandSchema, value);
export const isEngagementQuery = (value: unknown): value is EngagementQuery => Value.Check(EngagementQuerySchema, value);
interface Host {
  snapshot(): Snapshot;
  commit(events: EventInput[]): void;
  invalidate(): void;
  wake(): void;
  admit(controls: Controls): void;
  settingsEvent(settings: UserSettings, revision: number, acknowledge: boolean): EventInput;
  skill(content: string): { name: string; description: string };
  startup(projectId: string | null): ResolvedControls;
  workspaceProject(session: ScopeSession): Project;
  rootBusy(root: string): boolean;
}
interface Target { before: unknown; revision: number | null }
type ScopeSession = Pick<Session, "id" | "projectId" | "workspaceId">;
export class Engagement {
  private readonly writers = new Set<string>();
  constructor(private readonly store: EventStore, private readonly projects: ProjectService, private readonly host: Host) {}
  writeRoots(): string[] { return [...this.writers]; }
  private snapshot() { return this.host.snapshot(); }
  private session(id: string) {
    const session = this.snapshot().sessions.find((session) => session.id === id);
    if (!session) throw new MoguriError("session_missing", "Choose an existing session.", 404);
    return session;
  }
  private project(session: ScopeSession) {
    return this.host.workspaceProject(session);
  }
  preview(session: Session, allProjects: boolean): SuggestionPreview {
    if (allProjects && session.projectId !== null) throw new MoguriError("suggestion_scope", "Cross-project analysis is available only from an explicitly project-free chat.");
    const candidates = this.snapshot().sessions.filter((source) => source.id !== session.id && ["agent", "side"].includes(source.kind) && (allProjects || source.projectId === session.projectId)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 12);
    const sources: SuggestionSource[] = [];
    let remaining = 32 * 1024;
    for (const source of candidates) for (const message of source.messages.filter((message) => message.role === "user").slice(-8)) {
      if (remaining <= 0) break;
      let text = "", count = 0, bytes = 0;
      for (const character of message.text) {
        const size = Buffer.byteLength(character);
        if (count === 4000 || bytes + size > remaining) break;
        text += character; bytes += size; count++;
      }
      if (!text.trim()) continue;
      remaining -= bytes;
      sources.push({ sessionId: source.id, messageId: message.id, title: source.title, projectId: source.projectId, text });
    }
    const phrases = new Map<string, { text: string; ids: Set<string>; sessions: Set<string> }>();
    for (const source of sources) for (const line of source.text.split(/[\n.!?]+/).map((line) => line.trim()).filter((line) => line.length >= 25 && line.length <= 300)) {
      const key = line.toLowerCase().replace(/\s+/g, " ");
      const phrase = phrases.get(key) ?? { text: line, ids: new Set(), sessions: new Set() };
      phrase.ids.add(source.messageId); phrase.sessions.add(source.sessionId); phrases.set(key, phrase);
    }
    const repeated = [...phrases.values()].filter((phrase) => phrase.sessions.size >= 2).sort((a, b) => b.sessions.size - a.sessions.size).slice(0, 12).map((phrase) => ({ text: phrase.text, count: phrase.sessions.size, messageIds: [...phrase.ids].slice(0, 20) }));
    const scope = allProjects ? "all-projects" : session.projectId ? "project" : "project-free";
    return { scope, sources, repeated, digest: digest(JSON.stringify({ scope, sources })), diagnostic: allProjects ? "Explicit cross-project analysis copies these approved excerpts into a profile-owned settings chat. Review scope before generation." : "Only prior user prompts in this scope are included. Preview is local and makes no model call." };
  }
  private async target(session: ScopeSession, spec: ConfigurationSpec, legacy = false): Promise<Target> {
    const snapshot = this.snapshot();
    if (spec.target === "global") {
      if (!Object.hasOwn(snapshot.settings.values, spec.section)) throw new MoguriError("configuration_section", "Choose an existing non-secret global settings section.");
      return { before: snapshot.settings.values[spec.section as keyof UserSettings], revision: snapshot.settings.revision };
    }
    if (spec.target === "policy") return { before: snapshot.policy.allowedEnvs, revision: snapshot.policy.revision };
    if (spec.target === "skill") {
      const existing = snapshot.registry.find((entry) => entry.projectId === session.projectId && entry.kind === "skill" && entry.name === spec.section);
      return { before: existing ? { id: existing.id, contentDigest: existing.contentDigest, content: this.store.blob(existing.contentDigest), revision: existing.revision } : null, revision: existing?.revision ?? 0 };
    }
    const project = this.project(session);
    const configuration = this.projects.configuration(project.id);
    if (spec.target === "repo-instructions") {
      const source = await this.projects.instructionSource(project);
      let fileDigest = "absent";
      if (source.instructions !== null) fileDigest = (await readProjectFile(project.path, source.instructionsPath)).digest;
      return { before: { text: source.instructions ?? "", digest: fileDigest, path: source.instructionsPath, configurationRevision: configuration.revision, ...(legacy ? {} : { workspaceId: session.workspaceId, root: project.path }) }, revision: configuration.revision };
    }
    if (!Object.hasOwn(configuration.values, spec.section)) throw new MoguriError("configuration_section", "Choose an existing project settings section.");
    return { before: configuration.values[spec.section as keyof typeof configuration.values], revision: configuration.revision };
  }
  private validate(session: ScopeSession, spec: ConfigurationSpec): void {
    if (spec.target === "global") {
      this.host.settingsEvent(parse(SettingsSchema, { ...this.snapshot().settings.values, [spec.section]: spec.value }), this.snapshot().settings.revision, true);
    } else if (spec.target === "project") {
      const project = this.project(session);
      const settings = parse(ProjectSettingsSchema, { ...this.projects.configuration(project.id).values, [spec.section]: spec.value });
      this.projects.validate(settings, project.id);
    } else if (spec.target === "policy") {
      if (!Array.isArray(spec.value) || !spec.value.length || spec.value.some((value) => !["Local", "Sandbox", "Remote"].includes(String(value))) || new Set(spec.value).size !== spec.value.length) throw new MoguriError("configuration_policy", "Choose a non-empty exact allowed-environment list.");
    } else if (spec.target === "skill") {
      if (typeof spec.value !== "string" || this.host.skill(spec.value).name !== spec.section) throw new MoguriError("configuration_skill", "Use a standard SKILL.md whose name matches the proposed skill.");
    } else if (typeof spec.value !== "string" || Buffer.byteLength(spec.value) > 64 * 1024) throw new MoguriError("configuration_instructions", "Repository instruction proposals must be bounded text.");
    if (/-----BEGIN .*PRIVATE KEY-----|(?:ghp|gho|github_pat)_[A-Za-z0-9_]{20,}/.test(JSON.stringify(spec))) throw new MoguriError("configuration_secret", "Do not include credentials in configuration proposals. Use MCP OAuth or the explicit secret backend.");
  }
  async propose(session: Session, input: unknown, actor: "user" | "model", finish?: WorkspaceFinish, signal?: AbortSignal): Promise<CommandResult> {
    signal?.throwIfAborted();
    if (actor === "model" && (session.kind !== "metachat" || session.mode !== "agent" || session.pendingMode === "read-only")) throw new MoguriError("configuration_mode", "Only an explicit settings chat may propose configuration changes. Nothing was applied.", 403);
    const spec = parse(ConfigurationSpecSchema, input);
    this.validate(session, spec);
    const target = await this.target(session, spec);
    signal?.throwIfAborted();
    const sources = session.suggestionSources ?? this.preview(session, false).sources;
    const allowed = new Set(sources.map((source) => source.messageId));
    if (spec.evidence?.some((id) => !allowed.has(id))) throw new MoguriError("configuration_evidence", "A proposed evidence reference is outside the explicitly approved source scope.");
    if (actor === "model" && session.suggestionSources?.length && !spec.evidence?.length) throw new MoguriError("configuration_evidence", "A history-based suggestion must cite at least one approved source message. Nothing was applied.");
    const evidence = sources.filter((source) => spec.evidence?.includes(source.messageId));
    const proposal: ConfigurationProposal = {
      id: randomUUID(), projectId: spec.target === "global" || spec.target === "policy" ? null : session.projectId, sessionId: session.id, actor, target: spec.target, section: spec.section, reason: spec.reason,
      contentDigest: this.store.putBlob(JSON.stringify(spec)), baseDigest: this.store.putBlob(JSON.stringify(target.before)),
      baseRevision: target.revision, status: "pending", createdAt: new Date().toISOString(), evidence,
      workspaceId: spec.target === "repo-instructions" ? session.workspaceId : null,
    };
    const events: EventInput[] = [{ event_type: "configuration.proposed", profile_id: this.snapshot().profileId, project_id: proposal.projectId, payload: { proposal } }];
    if (finish) return finish(events, { id: proposal.id });
    this.host.commit(events); return { id: proposal.id };
  }
  async read(session: Session, target: string, section: string): Promise<unknown> {
    if (session.kind !== "metachat") throw new MoguriError("configuration_mode", "Use an explicit settings chat for configuration access.");
    const spec = parse(ConfigurationSpecSchema, { target, section, value: null, reason: "Read configuration" });
    const value = await this.target(session, spec);
    return { scope: session.projectId ?? "global", target, section, value: value.before, revision: value.revision, diagnostic: "No secret backend, provider credentials or connection tokens are exposed. Changes require a reviewed proposal." };
  }
  private create(scope: string | null, parent: Session | undefined, prompt: string, context: string | undefined, run: boolean, finish: WorkspaceFinish, sources?: SuggestionSource[]) {
    if (scope !== null && !this.snapshot().projects.some((project) => project.id === scope)) throw new MoguriError("project_missing", "This project no longer exists.");
    if (parent && parent.projectId !== scope) throw new MoguriError("metachat_scope", "A linked settings chat must use the parent's scope.");
    let ancestor = parent; let depth = 0;
    while (ancestor) { if (++depth >= 8) throw new MoguriError("session_depth", "Settings chats keep the eight-level attachment limit."); const parentId = ancestor.parentSessionId; ancestor = this.snapshot().sessions.find((session) => session.id === parentId); }
    const startup = parent ? undefined : this.host.startup(scope);
    const controls = { ...(parent?.controls ?? startup!.controls), autonomy: "Manual" as const };
    if (run) this.host.admit(controls);
    const id = randomUUID();
    const events: EventInput[] = [{ event_type: "session.created", profile_id: this.snapshot().profileId, project_id: scope, session_id: id, payload: {
      title: context ? "Moguri suggestions" : "Moguri settings", kind: "metachat", controls, ...(startup ? { defaults: startup.defaults } : {}), ...(parent ? { parentSessionId: parent.id } : {}),
      ...(sources ? { suggestionSources: sources } : {}),
      workspaceId: parent?.workspaceId ?? null,
      ...(context ? { contextDigest: this.store.putBlob(JSON.stringify([{ role: "user", content: context, timestamp: Date.now() }])) } : {}),
    } }];
    if (run) events.push({ event_type: "queue.enqueued", profile_id: this.snapshot().profileId, project_id: scope, session_id: id, payload: { item: { id: randomUUID(), text: prompt, attachments: [], delivery: "queue" } } });
    else if (prompt) events.push({ event_type: "draft.saved", profile_id: this.snapshot().profileId, project_id: scope, session_id: id, payload: { text: prompt, attachments: [] } });
    const result = finish(events, { id }); if (run) this.host.wake(); return result;
  }
  async query(query: EngagementQuery): Promise<EngagementResponse> {
    if (query.type === "suggestions.preview") return { type: query.type, preview: this.preview(this.session(query.sessionId), query.allProjects) };
    const proposal = this.snapshot().configurationProposals.find((proposal) => proposal.id === query.proposalId);
    if (!proposal) throw new MoguriError("configuration_missing", "This proposal is outside the active profile.", 404);
    const spec = parse(ConfigurationSpecSchema, JSON.parse(this.store.blob(proposal.contentDigest)));
    return { type: query.type, proposal, spec, before: JSON.parse(this.store.blob(proposal.baseDigest)), warning: "Review the exact scope and before/after value. Model advice is not user approval. Applying never authenticates an MCP, enables a skill, commits or pushes. " + (spec.target === "global" && spec.section === "systemPrompt" ? SYSTEM_PROMPT_WARNING : "Guidance cannot override hard permissions; any permission change requires this explicit user decision.") };
  }
  async execute(command: EngagementCommand, finish: WorkspaceFinish): Promise<CommandResult> {
    if (command.type === "metachat.create") return this.create(command.projectId, command.parentSessionId ? this.session(command.parentSessionId) : undefined, command.prompt ?? "", undefined, false, finish);
    if (command.type === "suggestions.generate") {
      const session = this.session(command.sessionId); const preview = this.preview(session, command.allProjects);
      if (preview.digest !== command.expectedDigest) throw new MoguriError("suggestion_stale", "Source conversations changed after preview. Review the current scope before generation.", 409);
      if (!preview.sources.length) throw new MoguriError("suggestion_empty", "No earlier user prompts exist in this scope. Nothing was sent.");
      return this.create(session.projectId, session, "Suggest concrete ways to use Moguri better based on the approved prior prompt excerpts. Identify repeated user guidance that belongs in instructions, useful disabled skills, or configuration changes. Use moguri_config to read non-secret settings and create exact proposals, citing the relevant source message IDs as evidence. Never apply or enable a change yourself.", `<untrusted-prior-user-prompts scope="${preview.scope}" digest="${preview.digest}">\n${JSON.stringify(preview.sources)}\n</untrusted-prior-user-prompts>`, true, finish, preview.sources);
    }
    if (command.type === "configuration.propose") return this.propose(this.session(command.sessionId), command.proposal, "user", finish);
    if (command.type === "attention.acknowledge") {
      const entries = command.attentionIds.map((id) => this.snapshot().attention.find((entry) => entry.id === id));
      if (entries.some((entry) => !entry)) throw new MoguriError("attention_missing", "An attention item was removed or is outside the profile.");
      return finish([{ event_type: "attention.acknowledged", profile_id: this.snapshot().profileId, payload: { attentionIds: command.attentionIds } }]);
    }
    const proposal = this.snapshot().configurationProposals.find((proposal) => proposal.id === command.proposalId);
    if (!proposal || proposal.status !== "pending" || proposal.contentDigest !== command.expectedDigest) throw new MoguriError("configuration_stale", "Review the current pending proposal before deciding.", 409);
    const spec = parse(ConfigurationSpecSchema, JSON.parse(this.store.blob(proposal.contentDigest)));
    const contextSession: ScopeSession = { projectId: proposal.projectId, id: proposal.sessionId, workspaceId: proposal.workspaceId ?? null };
    const events: EventInput[] = [];
    let writtenInstructions: string | undefined;
    if (command.approve) {
      if (!command.acknowledgeRisk) throw new MoguriError("configuration_review", "Acknowledge the exact reviewed configuration risk before applying.");
      const current = await this.target(contextSession, spec, proposal.workspaceId === undefined);
      const snapshot = this.snapshot();
      const liveRevision = spec.target === "global" ? snapshot.settings.revision : spec.target === "policy" ? snapshot.policy.revision :
        spec.target === "skill" ? snapshot.registry.find((entry) => entry.projectId === proposal.projectId && entry.kind === "skill" && entry.name === spec.section)?.revision ?? 0 :
          this.projects.configuration(this.project(contextSession).id).revision;
      if (snapshot.configurationProposals.find((entry) => entry.id === proposal.id)?.status !== "pending" || digest(JSON.stringify(current.before)) !== proposal.baseDigest || current.revision !== proposal.baseRevision || liveRevision !== proposal.baseRevision) throw new MoguriError("configuration_stale", "The target changed after proposal creation. Generate and review a fresh proposal.", 409);
      this.validate(contextSession, spec);
      if (spec.target === "global") events.push(this.host.settingsEvent(parse(SettingsSchema, { ...this.snapshot().settings.values, [spec.section]: spec.value }), proposal.baseRevision!, true));
      else if (spec.target === "project") {
        const project = this.project(contextSession); const configuration = this.projects.configuration(project.id);
        events.push({ event_type: "project.configured", profile_id: this.snapshot().profileId, project_id: project.id, payload: { configuration: { ...configuration, revision: configuration.revision + 1, values: parse(ProjectSettingsSchema, { ...configuration.values, [spec.section]: spec.value }) } } });
      } else if (spec.target === "policy") {
        const allowedEnvs = this.snapshot().policy.allowedEnvs.filter((env) => Array.isArray(spec.value) && spec.value.includes(env));
        const values = spec.value;
        if (!Array.isArray(values)) throw new MoguriError("configuration_policy", "Invalid environment policy.");
        for (const env of ["Local", "Sandbox", "Remote"] as const) if (values.includes(env) && !allowedEnvs.includes(env)) allowedEnvs.push(env);
        events.push({ event_type: "policy.updated", profile_id: this.snapshot().profileId, payload: { policy: { revision: this.snapshot().policy.revision + 1, allowedEnvs }, finishingTurnIds: this.snapshot().sessions.filter((session) => session.turnId && session.controls.env === "Local").map((session) => session.turnId!) } });
      } else if (spec.target === "skill") {
        const metadata = this.host.skill(String(spec.value)); const existing = this.snapshot().registry.find((entry) => entry.projectId === proposal.projectId && entry.kind === "skill" && entry.name === spec.section);
        const entry: CapabilityEntry = { id: existing?.id ?? randomUUID(), projectId: proposal.projectId, kind: "skill", name: metadata.name, description: metadata.description, contentDigest: this.store.putBlob(String(spec.value)), enabled: false, revision: existing ? existing.revision + 1 : 0, source: "approved-proposal", createdAt: new Date().toISOString() };
        events.push({ event_type: "capability.saved", profile_id: this.snapshot().profileId, project_id: proposal.projectId, payload: { entry } });
      } else {
        const project = this.project(contextSession); const before = current.before;
        if (!isRecord(before) || typeof before.path !== "string" || typeof before.digest !== "string") throw new MoguriError("configuration_base", "Instruction base is invalid.");
        const policy = folderPolicy(this.projects.configuration(project.id).values);
        if (this.writers.has(project.path) || this.host.rootBusy(project.path)) throw new MoguriError("workspace_busy", "An owned writer holds this instruction root. Wait before applying the reviewed configuration.", 409);
        assertFolderName(before.path, true, policy);
        this.writers.add(project.path);
        try {
          const path = before.path;
          await this.projects.prepareDirectory(project.path, path);
          await assertFolderAccess(project.path, path, true, policy);
          await writeProjectFile(project.path, path, String(spec.value), before.digest, {
            beforeCommit: () => {
              if (this.project(contextSession).path !== project.path || !this.snapshot().policy.allowedEnvs.includes("Local")) throw new MoguriError("configuration_stale", "Instruction root or Local policy changed before publication.", 409);
              assertFolderName(path, true, folderPolicy(this.projects.configuration(project.id).values));
            },
            committed: () => { writtenInstructions = path; },
          });
        } catch (error) {
          if (!writtenInstructions) throw error;
          console.error("Configuration instruction publication is unconfirmed:", error instanceof Error && "code" in error ? String(error.code) : "configuration_write");
          throw new MoguriError("configuration_partial", "Instructions were published, but final durability was not acknowledged. Inspect the file; no successful apply or rollback was recorded.", 409);
        } finally { this.writers.delete(project.path); this.host.wake(); }
      }
    }
    events.push({ event_type: "configuration.decided", profile_id: this.snapshot().profileId, project_id: proposal.projectId, payload: { proposalId: proposal.id, approve: command.approve, actor: "user" } });
    let result: CommandResult;
    try { result = finish(events); }
    catch (error) {
      if (!writtenInstructions) throw error;
      console.error("Configuration instruction write completed, but its decision was not recorded:", writtenInstructions);
      throw new MoguriError("configuration_partial", `Instructions were written locally to ${writtenInstructions}, but the decision could not be recorded. Inspect the file and create a fresh proposal; no commit or push was made.`, 409);
    }
    if (command.approve) { this.host.invalidate(); this.host.wake(); } return result;
  }
}
