import { randomUUID } from "node:crypto";
import {
  defaultBoard, MoguriError, PROFILE_ID, type BoardConfig, type CommandResult, type EventInput,
  type IssueBoard, type LocalIssue, type Project, type Snapshot, type WorkspaceCommand, type WorkspaceQuery, type WorkspaceResponse,
} from "../../../packages/protocol/src/index.ts";
import { DependencyCache, type DependencyCacheOptions } from "./dependency-cache.ts";
import { McpKeychain } from "./gateway.ts";
import { ProjectIntegrations, pullRequestLink, type IntegrationOptions } from "./project-integrations.ts";
import { EventStore } from "./store.ts";

export interface WorkspaceOptions { cache?: DependencyCacheOptions; integrations?: IntegrationOptions }
interface WorkspaceHost {
  snapshot(): Snapshot;
  project(id: string): Project;
  commit(events: EventInput[]): void;
  job(kind: string, projectId: string, execute: (signal: AbortSignal, progress: (message: string) => void) => Promise<unknown>, settled?: () => void): string;
  wake(): void;
  closing(id: string): boolean;
}
export class WorkspaceRuntime {
  readonly cache: DependencyCache;
  readonly integrations: ProjectIntegrations;
  readonly busyProjects = new Set<string>();
  private timer?: ReturnType<typeof setInterval>;
  private refreshing = new Map<string, string>();
  private prAborts = new Map<string, AbortController>();
  private linear = new Map<string, AbortController>();
  constructor(private readonly host: WorkspaceHost, store: EventStore, stateDir: string, private readonly options: WorkspaceOptions = {}) {
    this.cache = new DependencyCache(store, stateDir, options.cache);
    this.integrations = new ProjectIntegrations(options.integrations?.vault ?? new McpKeychain("dev.moguri.profile.default.integrations"), options.integrations);
  }
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      for (const board of this.host.snapshot().boards) {
        if (this.host.closing(board.projectId)) continue;
        if (board.autoRefreshPrs && this.host.snapshot().issues.some((issue) => issue.projectId === board.projectId && this.due(issue))) this.refresh(board.projectId, false);
      }
    }, this.options.integrations?.prRefreshMs ?? 60_000);
    this.timer.unref();
  }
  close(): void { clearInterval(this.timer); this.timer = undefined; for (const abort of [...this.linear.values(), ...this.prAborts.values()]) abort.abort(); }
  private board(id: string): IssueBoard {
    this.host.project(id);
    return this.host.snapshot().boards.find((board) => board.projectId === id) ?? defaultBoard(id);
  }
  private issue(id: string, revision: number): LocalIssue {
    const issue = this.host.snapshot().issues.find((issue) => issue.id === id);
    if (!issue) throw new MoguriError("issue_scope", "Issue is outside this profile.", 404);
    if (issue.revision !== revision) throw new MoguriError("issue_conflict", "Another client changed this ticket. Your edit is preserved; reload before saving.", 409);
    return issue;
  }
  private phase(board: IssueBoard, id: string): void {
    if (!board.columns.some((column) => column.id === id)) throw new MoguriError("issue_phase", "Choose an existing phase from this project's board.");
  }
  private saved(issue: LocalIssue, actor: "user" | "github" | "linear" = "user"): EventInput {
    return { event_type: "issue.saved", profile_id: PROFILE_ID, project_id: issue.projectId, payload: { issue, actor } };
  }
  private initialBoard(board: IssueBoard): EventInput[] {
    return this.host.snapshot().boards.some((entry) => entry.projectId === board.projectId) ? [] : [{ event_type: "board.saved", profile_id: PROFILE_ID, project_id: board.projectId, payload: { board } }];
  }
  private due(issue: LocalIssue): boolean {
    return !issue.archived && !!issue.pullRequest && issue.pullRequest.state !== "merged" && (!issue.pullRequest.checkedAt || Date.now() - Date.parse(issue.pullRequest.checkedAt) >= 120_000);
  }
  private observe(board: IssueBoard, issue: LocalIssue): void {
    if (board.autoRefreshPrs && this.due(issue)) queueMicrotask(() => this.refresh(board.projectId, false));
  }
  private refresh(projectId: string, force: boolean): string {
    const existing = this.refreshing.get(projectId);
    if (existing) return existing;
    const abort = new AbortController(); this.prAborts.set(projectId, abort);
    const id = this.host.job("issues.refresh", projectId, async (requested, progress) => {
      const signal = AbortSignal.any([requested, abort.signal]);
      let observed = 0; let skipped = 0; let failures = 0;
      try {
        const project = this.host.project(projectId);
        const board = this.board(projectId);
        const issues = this.host.snapshot().issues.filter((issue) => issue.projectId === projectId && !issue.archived && issue.pullRequest && (force || this.due(issue)))
          .sort((a, b) => (a.pullRequest?.checkedAt ?? "").localeCompare(b.pullRequest?.checkedAt ?? "")).slice(0, 20);
        for (const issue of issues) {
          signal.throwIfAborted();
          let link = issue.pullRequest!;
          try { link = await this.integrations.pullRequest(link, board, project.path, signal); }
          catch (error) {
            signal.throwIfAborted(); failures++;
            console.error("Linked PR observation failed:", error instanceof Error ? error.message : "Unknown GitHub response");
            link = { ...link, checkedAt: new Date().toISOString(), diagnostic: error instanceof MoguriError ? error.message : "GitHub could not be reached. No phase was changed." };
          }
          signal.throwIfAborted();
          const latest = this.host.snapshot().issues.find((current) => current.id === issue.id);
          const currentBoard = this.board(projectId);
          if (!latest || latest.revision !== issue.revision || currentBoard.revision !== board.revision || latest.pullRequest?.url !== link.url) { skipped++; continue; }
          const phaseId = !link.diagnostic && link.state === "merged" && latest.pullRequest?.state !== "merged" ? currentBoard.mergedColumnId : latest.phaseId;
          this.host.commit([this.saved({ ...latest, phaseId, pullRequest: link, revision: latest.revision + 1, updatedAt: new Date().toISOString() }, "github")]);
          observed++; progress(`Observed ${observed} linked PRs; ${skipped} concurrent edits preserved.`);
        }
        if (failures) throw new MoguriError("issue_pr_refresh", `${failures} linked PR checks failed. Ticket diagnostics show why; no unverified merge was applied.`);
        return { observed, skipped, boundedAt: 20, diagnostic: "Only verified merged PRs advance the configured phase. Local edits are never overwritten by a stale response." };
      } finally { this.refreshing.delete(projectId); this.prAborts.delete(projectId); }
    });
    this.refreshing.set(projectId, id);
    return id;
  }
  async query(query: WorkspaceQuery): Promise<WorkspaceResponse> {
    switch (query.type) {
      case "board.get": return { type: query.type, board: this.board(query.projectId), issues: this.host.snapshot().issues.filter((issue) => issue.projectId === query.projectId) };
      case "cache.inspect": return { type: query.type, plan: await this.cache.inspect(this.host.project(query.projectId), query.manager) };
      case "linear.status": {
        const board = this.board(query.projectId);
        const token = await this.integrations.vault.read("linear", AbortSignal.timeout(15_000));
        return { type: query.type, enabled: board.linear.enabled, credential: token ? "configured" : "required", diagnostic: "Optional read-only import. Local tickets are never uploaded; enable one team and explicitly import a page." };
      }
    }
  }
  async execute(command: WorkspaceCommand, finish: (events: EventInput[], result?: CommandResult) => CommandResult): Promise<CommandResult> {
    switch (command.type) {
      case "board.save": {
        const board = this.board(command.projectId);
        if (board.revision !== command.expectedRevision) throw new MoguriError("board_conflict", "Another client changed this board. Reload its phases before saving.", 409);
        const config: BoardConfig = structuredClone(command.config);
        const ids = config.columns.map((column) => column.id);
        if (new Set(ids).size !== ids.length || !ids.includes(config.mergedColumnId) || config.columns.some((column) => !column.name.trim())) throw new MoguriError("board_columns", "Use unique phase IDs, non-empty names and an existing merged-PR destination.");
        if (this.host.snapshot().issues.some((issue) => issue.projectId === board.projectId && !ids.includes(issue.phaseId))) throw new MoguriError("board_occupied", "Move all tickets, including archived ones, before removing an occupied phase.", 409);
        if (config.linear.enabled && !/^[A-Za-z0-9-]{1,128}$/.test(config.linear.teamId)) throw new MoguriError("linear_team", "Choose the exact Linear team UUID before enabling import.");
        this.linear.get(board.projectId)?.abort();
        this.prAborts.get(board.projectId)?.abort();
        return finish([{ event_type: "board.saved", profile_id: PROFILE_ID, project_id: board.projectId, payload: { board: { ...config, projectId: board.projectId, revision: board.revision + 1 } } }], { revision: board.revision + 1 });
      }
      case "issue.create": {
        const board = this.board(command.projectId); this.phase(board, command.phaseId);
        const current = this.host.snapshot().issues.filter((issue) => issue.projectId === board.projectId);
        if (current.length >= 500) throw new MoguriError("issue_limit", "This alpha board is bounded to 500 retained tickets per project.");
        if (!command.title.trim()) throw new MoguriError("issue_title", "Give this ticket a non-empty title.");
        const now = new Date().toISOString();
        const issue: LocalIssue = { id: randomUUID(), projectId: board.projectId, number: Math.max(0, ...current.map((issue) => issue.number)) + 1,
          title: command.title.trim(), body: command.body, kind: command.kind, phaseId: command.phaseId, revision: 0, archived: false, createdAt: now, updatedAt: now,
          pullRequest: command.pullRequestUrl ? pullRequestLink(command.pullRequestUrl) : null, linear: null };
        const result = finish([...this.initialBoard(board), this.saved(issue)], { id: issue.id, revision: issue.revision });
        this.observe(board, issue); return result;
      }
      case "issue.update":
      case "issue.move":
      case "issue.archive": {
        const issue = this.issue(command.issueId, command.expectedRevision);
        const board = this.board(issue.projectId);
        const updated = { ...issue, revision: issue.revision + 1, updatedAt: new Date().toISOString() };
        if (command.type === "issue.archive") updated.archived = command.archived;
        else {
          this.phase(board, command.phaseId); updated.phaseId = command.phaseId;
          if (command.type === "issue.update") {
            if (!command.title.trim()) throw new MoguriError("issue_title", "Give this ticket a non-empty title.");
            updated.title = command.title.trim(); updated.body = command.body; updated.kind = command.kind;
            const link = command.pullRequestUrl ? pullRequestLink(command.pullRequestUrl) : null;
            updated.pullRequest = link?.url === issue.pullRequest?.url ? issue.pullRequest : link;
          }
        }
        const result = finish([this.saved(updated)], { id: issue.id, revision: updated.revision });
        this.observe(board, updated); return result;
      }
      case "issues.refresh": this.host.project(command.projectId); return finish([], { id: this.refresh(command.projectId, true) });
      case "cache.prepare":
      case "cache.install": {
        const project = this.host.project(command.projectId);
        const snapshot = this.host.snapshot();
        if (!snapshot.policy.allowedEnvs.includes("Local")) throw new MoguriError("cache_env", "Managed cache work has no qualified protected-env broker. It cannot silently run on Local.", 403);
        if (command.type === "cache.install" && command.runScripts) throw new MoguriError("cache_sandbox", "Lifecycle scripts require a qualified real SendBox boundary. It is unavailable; no script, download or host fallback was started.", 409);
        if (this.busyProjects.has(project.id) || command.type === "cache.install" && (snapshot.sessions.some((session) => session.projectId === project.id && session.turnId) || snapshot.blockedProjects.includes(project.id))) throw new MoguriError("cache_busy", "This project's workspace is busy or unconfirmed. Inspect and finish owned work first.", 409);
        if (command.type === "cache.install") this.busyProjects.add(project.id);
        const id = this.host.job(command.type, project.id, async (signal, progress) => {
          const receipt = await (command.type === "cache.install" ? this.cache.install(project, command.manager, command.expectedDigest, signal, progress) : this.cache.prepare(project, command.manager, command.expectedDigest, signal, progress));
          signal.throwIfAborted();
          this.host.commit([{ event_type: "cache.prepared", profile_id: PROFILE_ID, project_id: project.id, payload: { receipt } }]);
          return receipt;
        }, () => { if (command.type === "cache.install") { this.busyProjects.delete(project.id); this.host.wake(); } });
        return finish([], { id });
      }
      case "linear.token.set":
      case "linear.token.clear": {
        for (const controller of this.linear.values()) controller.abort();
        const signal = AbortSignal.timeout(15_000);
        if (command.type === "linear.token.set") {
          if (!/^[\x21-\x7e]+$/.test(command.token)) throw new MoguriError("linear_token", "Use the personal API key without whitespace/control characters.");
          await this.integrations.vault.write("linear", command.token, signal);
        } else await this.integrations.vault.remove("linear", signal);
        return finish([]);
      }
      case "linear.import": {
        const board = this.board(command.projectId);
        if (!board.linear.enabled) throw new MoguriError("linear_disabled", "Linear is optional and off by default. Enable one team explicitly.", 409);
        if (this.linear.has(board.projectId)) throw new MoguriError("linear_busy", "A Linear import already owns this project's page.", 409);
        const abort = new AbortController(); this.linear.set(board.projectId, abort);
        return finish([], { id: this.host.job("linear.import", board.projectId, async (signal) => {
          try {
            const result = await this.integrations.importLinear(board, command.cursor, AbortSignal.any([signal, abort.signal]));
            signal.throwIfAborted(); abort.signal.throwIfAborted();
            if (this.board(board.projectId).revision !== board.revision) throw new MoguriError("linear_conflict", "Board/team configuration changed while importing. Nothing was applied.", 409);
            const current = this.host.snapshot().issues.filter((issue) => issue.projectId === board.projectId);
            const fresh = result.items.filter((item) => !current.some((issue) => issue.linear?.id === item.linear.id));
            if (current.length + fresh.length > 500) throw new MoguriError("issue_limit", "This import would exceed the 500-ticket project bound.");
            let number = Math.max(0, ...current.map((issue) => issue.number));
            const now = new Date().toISOString();
            const events = fresh.map((item) => this.saved({ ...item, id: randomUUID(), projectId: board.projectId, number: ++number,
              kind: "misc", phaseId: board.columns[0]!.id, revision: 0, archived: false, createdAt: now, updatedAt: now, pullRequest: null }, "linear"));
            this.host.commit([...this.initialBoard(board), ...events]);
            return { imported: fresh.length, preserved: result.items.length - fresh.length, nextCursor: result.nextCursor, direction: "read-only; no local ticket was exported" };
          } finally { this.linear.delete(board.projectId); }
        }) });
      }
    }
  }
}
