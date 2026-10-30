import { randomUUID } from "node:crypto";
import { stripMarkdownComments } from "../../../packages/protocol/src/markdown.ts";
import {
  compareIssues, defaultBoard, githubIssuePhase, githubManagedIssue, githubSourceOwner, githubSyncSettings, issuePosition, kanbanPreferences, MoguriError, type BoardConfig, type CommandResult, type EventInput, type GithubBoardSource,
  type IssueBoard, type LocalIssue, type Project, type Snapshot, type WorkspaceCommand, type WorkspaceQuery, type WorkspaceResponse,
} from "../../../packages/protocol/src/index.ts";
import { DependencyCache, type DependencyCacheOptions } from "./dependency-cache.ts";
import { McpKeychain } from "./gateway.ts";
import { ProjectIntegrations, pullRequestLink, type GithubBoardIssue, type IntegrationOptions } from "./project-integrations.ts";
import { digest, EventStore } from "./store.ts";
import { sourceRootSync } from "./repository-source.ts";

export interface WorkspaceOptions { cache?: DependencyCacheOptions; integrations?: IntegrationOptions }
interface WorkspaceHost {
  snapshot(): Snapshot;
  project(id: string, workspaceId?: string): Project;
  commit(events: EventInput[]): void;
  job(kind: string, projectId: string, execute: (signal: AbortSignal, progress: (message: string) => void) => Promise<unknown>, settled?: () => void, workspaceId?: string): string;
  wake(): void;
  closing(id: string): boolean;
  publicationBusy(projectId: string, workspaceId?: string | null): boolean;
  assertRoot?(projectId: string, workspaceId: string | undefined, signal: AbortSignal): Promise<void>;
  onLinearCredentialsChanged?(): void;
  onLinearBoardChanged?(projectId: string): void;
  githubPolicy?(projectId: string): string;
  githubProject?(projectId: string, signal: AbortSignal, source?: GithubBoardSource): Promise<Extract<import("../../../packages/protocol/src/github-workflows.ts").GithubResponse, { type: "github.project" }>>;
}
function boardObservationPolicy(board: BoardConfig) {
  return { columns: board.columns.map(({ id, name }) => ({ id, name })), mergedColumnId: board.mergedColumnId,
    autoRefreshPrs: board.autoRefreshPrs, githubAccess: board.githubAccess,
    linear: { enabled: board.linear.enabled, teamId: board.linear.teamId }, githubSync: githubSyncSettings(board) };
}
const boardObservationSignature = (board: IssueBoard) => digest(JSON.stringify({ policy: boardObservationPolicy(board), source: board.githubSource ?? null }));
const boardPresentationOnly = (previous: IssueBoard, next: BoardConfig) => {
  const binding = (board: BoardConfig) => JSON.stringify({ policy: boardObservationPolicy(board), kanban: { ...kanbanPreferences(board), visible: false } });
  return binding(previous) === binding(next);
};
const githubSourceIdentity = (source: GithubBoardSource) => JSON.stringify({
  repository: source.repository, repositoryId: source.repositoryId, account: source.account, accountId: source.accountId,
  binding: githubSourceOwner(source.binding), remote: { name: source.remote.name, fetchUrl: source.remote.fetchUrl },
});
export class WorkspaceRuntime {
  readonly cache: DependencyCache;
  readonly integrations: ProjectIntegrations;
  private readonly busyRoots = new Set<string>();
  private readonly busyPaths = new Set<string>();
  private timer?: ReturnType<typeof setInterval>;
  private refreshing = new Map<string, string>();
  private prAborts = new Map<string, AbortController>();
  private linear = new Map<string, AbortController>();
  private importedAt = new Map<string, number>();
  constructor(private readonly host: WorkspaceHost, private readonly store: EventStore, private readonly stateDir: string, private readonly options: WorkspaceOptions = {}) {
    this.cache = new DependencyCache(store, stateDir, { ...options.cache, registries: () => this.host.snapshot().dependencyRegistries ?? [] });
    this.integrations = new ProjectIntegrations(options.integrations?.vault ?? new McpKeychain(`dev.moguri.profile.${this.host.snapshot().profileId}.integrations`), options.integrations);
  }
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      for (const board of this.host.snapshot().boards) {
        if (this.host.closing(board.projectId)) continue;
        if (board.autoRefreshPrs && (githubSyncSettings(board).importIssues && Date.now() - (this.importedAt.get(board.projectId) ?? 0) >= 300_000 ||
          this.host.snapshot().issues.some((issue) => issue.projectId === board.projectId && this.due(issue)))) this.refresh(board.projectId, false);
      }
    }, this.options.integrations?.prRefreshMs ?? 60_000);
    this.timer.unref();
  }
  close(): void { clearInterval(this.timer); this.timer = undefined; this.cache.close(); this.integrations.invalidateLinearCredentials(); for (const abort of [...this.linear.values(), ...this.prAborts.values()]) abort.abort(); }
  isBusy(projectId: string, workspaceId?: string | null): boolean {
    if (this.busyRoots.has(`${projectId}:${workspaceId ?? "base"}`)) return true;
    if (!this.busyPaths.size) return false;
    const snapshot = this.host.snapshot();
    const root = workspaceId ? snapshot.managedWorkspaces.find((workspace) => workspace.id === workspaceId && workspace.projectId === projectId)?.path :
      snapshot.projects.find((project) => project.id === projectId)?.path;
    if (!root) { console.error("Managed cache lease has no exact registered root metadata."); return true; }
    return this.busyPaths.has(root);
  }
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
    const filtered = { ...issue, title: stripMarkdownComments(issue.title), body: stripMarkdownComments(issue.body) };
    if (!filtered.title.trim()) throw new MoguriError("issue_title", "Give this ticket a visible title after hidden comments are removed.");
    return { event_type: "issue.saved", profile_id: this.host.snapshot().profileId, project_id: issue.projectId, payload: { issue: filtered, actor } };
  }
  private unchangedImportedText(issue: LocalIssue, field: "title" | "body"): boolean {
    const expected = field === "title" ? issue.github?.titleDigest : issue.github?.bodyDigest;
    if (!expected) return false;
    if (digest(issue[field]) === expected) return true;
    return this.store.events().some((event) => event.profile_id === this.host.snapshot().profileId && event.event_type === "issue.saved" &&
      event.payload.issue.id === issue.id && digest(event.payload.issue[field]) === expected && stripMarkdownComments(event.payload.issue[field]) === issue[field]);
  }
  private initialBoard(board: IssueBoard): EventInput[] {
    return this.host.snapshot().boards.some((entry) => entry.projectId === board.projectId) ? [] : [{ event_type: "board.saved", profile_id: this.host.snapshot().profileId, project_id: board.projectId, payload: { board } }];
  }
  private due(issue: LocalIssue): boolean {
    const checked = issue.github?.checkedAt ?? issue.pullRequest?.checkedAt;
    return !issue.archived && Boolean(issue.github || issue.pullRequest) && (!checked || Date.now() - Date.parse(checked) >= 60_000);
  }
  private observe(board: IssueBoard, issue: LocalIssue): void {
    if (board.autoRefreshPrs && this.due(issue)) queueMicrotask(() => this.refresh(board.projectId, false));
  }
  private githubPolicy(projectId: string): string {
    if (!this.host.githubPolicy) throw new MoguriError("github_sync_unavailable", "This host cannot capture current GitHub observation policy. No source or policy fallback was used.", 409);
    return this.host.githubPolicy(projectId);
  }
  private async currentGithubSource(board: IssueBoard, signal: AbortSignal): Promise<GithubBoardSource> {
    const source = board.githubSource;
    if (!source) throw new MoguriError("github_sync_source", "Enable the optional GitHub issue import with its actual repository/account before synchronizing imported cards.", 409);
    if (!this.host.githubProject) throw new MoguriError("github_sync_unavailable", "This host has no qualified repository/account source reader. No fallback was used.", 409);
    signal.throwIfAborted(); await this.host.assertRoot?.(board.projectId, undefined, signal);
    const actual = await this.host.githubProject(board.projectId, signal, source);
    if (actual.repository !== source.repository || actual.accountId !== source.accountId || actual.account !== source.account ||
      JSON.stringify(githubSourceOwner(actual.binding)) !== JSON.stringify(githubSourceOwner(source.binding))) {
      throw new MoguriError("github_sync_source_changed", "The captured GitHub account, repository, root or policy changed. Original cards were kept; no source or account was substituted.", 409);
    }
    return source;
  }
  private async readGithubIssues(board: IssueBoard, force: boolean, signal: AbortSignal, progress: (message: string) => void) {
    const original = this.host.snapshot().issues.filter((issue) => issue.projectId === board.projectId && issue.github);
    const importing = githubSyncSettings(board).importIssues && (force || Date.now() - (this.importedAt.get(board.projectId) ?? 0) >= 300_000);
    if (!importing && !original.some((issue) => force || this.due(issue))) return { items: [] as GithubBoardIssue[], source: null, importing: false, policy: null };
    const policy = this.githubPolicy(board.projectId);
    const source = await this.currentGithubSource(board, signal), items = new Map<number, GithubBoardIssue>();
    const sourceDigest = digest(JSON.stringify(source));
    if (original.some((issue) => issue.github?.sourceDigest !== sourceDigest || issue.github.repo !== source.repository)) {
      throw new MoguriError("github_sync_source_changed", "An imported card belongs to a different retained source binding. No existing link was retargeted.", 409);
    }
    if (importing) {
      let cursor: string | null = null;
      const seen = new Set<string>();
      for (let page = 0; ; page++) {
        signal.throwIfAborted();
        const result = await this.integrations.githubBoardPage(source, cursor, signal);
        for (const item of result.items) {
          if (seen.has(item.nodeId)) throw new MoguriError("github_sync_paging", "The issue collection changed while paging. Original cards were preserved; no incomplete import was reported.", 409);
          seen.add(item.nodeId); items.set(item.number, item);
          if (seen.size > 500) throw new MoguriError("issue_limit", "This alpha board retains at most 500 cards. The repository import exceeded that bound; no page was silently dropped.", 409);
        }
        progress(`Read ${seen.size} open GitHub issues; source pages remain staged until complete validation.`);
        if (!result.nextCursor) break;
        if (page >= 49) throw new MoguriError("github_sync_paging", "The bounded GitHub collection did not finish paging. No partial import was published.", 409);
        cursor = result.nextCursor;
      }
    }
    const required = original.filter((issue) => !issue.archived && (force || this.due(issue)) && !items.has(issue.github!.number));
    for (let offset = 0; offset < required.length; offset += 20) {
      signal.throwIfAborted();
      const group = required.slice(offset, offset + 20);
      for (const item of await this.integrations.githubBoardIssues(source, group.map((issue) => issue.github!.number), signal)) items.set(item.number, item);
    }
    return { items: [...items.values()], source, importing, policy };
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
        const originalRoot = sourceRootSync(project.path);
        const board = this.board(projectId);
        const github = await this.readGithubIssues(board, force, signal, progress);
        const issues = this.host.snapshot().issues.filter((issue) => issue.projectId === projectId && !issue.archived && issue.pullRequest && (force || this.due(issue)))
          .sort((a, b) => (a.pullRequest?.checkedAt ?? "").localeCompare(b.pullRequest?.checkedAt ?? "")).slice(0, 20);
        const observedLinks = new Map<string, NonNullable<LocalIssue["pullRequest"]>>();
        const linkRevisions = new Map<string, number>();
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
          if (!latest || latest.revision !== issue.revision || boardObservationSignature(currentBoard) !== boardObservationSignature(board) || latest.pullRequest?.url !== link.url) { skipped++; continue; }
          observedLinks.set(issue.id, link);
          linkRevisions.set(issue.id, issue.revision);
          observed++; progress(`Observed ${observed} linked PRs; ${skipped} concurrent edits preserved.`);
        }
        signal.throwIfAborted();
        const currentBoard = this.board(projectId);
        if (boardObservationSignature(currentBoard) !== boardObservationSignature(board) || this.host.closing(projectId)) throw new MoguriError("github_sync_changed", "Board configuration or ownership changed during synchronization. No stale observation was applied.", 409);
        if (github.source) {
          if (github.policy !== this.githubPolicy(projectId)) throw new MoguriError("github_sync_changed", "Current GitHub read policy changed during synchronization. Original cards were kept; no old page was published.", 409);
          await this.currentGithubSource(board, signal);
        }
        await this.host.assertRoot?.(projectId, undefined, signal);
        if (boardObservationSignature(this.board(projectId)) !== boardObservationSignature(board) || this.host.closing(projectId) || this.host.project(projectId).path !== project.path ||
          JSON.stringify(sourceRootSync(project.path)) !== JSON.stringify(originalRoot) ||
          github.source && github.policy !== this.githubPolicy(projectId)) {
          throw new MoguriError("github_sync_changed", "The exact board/root changed before observation commit. Original cards were preserved.", 409);
        }
        const all = this.host.snapshot().issues.filter((issue) => issue.projectId === projectId), now = new Date().toISOString();
        for (const [id, link] of observedLinks) {
          const current = all.find((issue) => issue.id === id);
          if (!current || current.revision !== linkRevisions.get(id) || current.pullRequest?.url !== link.url) { observedLinks.delete(id); skipped++; }
        }
        const events = new Map<string, LocalIssue>(), byNumber = new Map<number, LocalIssue>();
        for (const issue of all) if (issue.github && github.source && issue.github.repo === github.source.repository) {
          if (byNumber.has(issue.github.number)) throw new MoguriError("github_sync_duplicate", "Multiple cards claim the same exact GitHub issue. No duplicate or latest-wins import was created.", 409);
          byNumber.set(issue.github.number, issue);
        }
        const added = github.items.filter((item) => item.state === "open" && !byNumber.has(item.number));
        if (all.length + added.length > 500) throw new MoguriError("issue_limit", "Import would exceed this project's 500 retained-card bound. No existing card was discarded.", 409);
        let nextNumber = Math.max(0, ...all.map((issue) => issue.number));
        for (const item of github.items) {
          const previous = byNumber.get(item.number);
          if (!previous && item.state !== "open" || previous?.archived) continue;
          if (previous?.github && (previous.github.nodeId !== item.nodeId || previous.github.databaseId !== item.databaseId || previous.github.url !== item.url)) {
            throw new MoguriError("github_sync_issue_changed", "An imported GitHub issue changed its exact identity. The original card was preserved.", 409);
          }
          const base: LocalIssue = previous ?? { id: randomUUID(), projectId, number: ++nextNumber, title: item.title, body: item.body, kind: "misc",
            phaseId: githubSyncSettings(board).phases.backlog, revision: -1, archived: false, createdAt: now, updatedAt: now, linear: null, pullRequest: null };
          const next: LocalIssue = { ...base,
            title: !previous || this.unchangedImportedText(previous, "title") ? item.title : previous.title,
            body: !previous || this.unchangedImportedText(previous, "body") ? item.body : previous.body,
            github: { nodeId: item.nodeId, databaseId: item.databaseId, repo: item.repo, number: item.number, url: item.url, state: item.state,
              stateReason: item.stateReason, updatedAt: item.updatedAt, checkedAt: now, diagnostic: null, pullRequests: item.pullRequests,
              sourceDigest: digest(JSON.stringify(github.source)), titleDigest: digest(item.title), bodyDigest: digest(item.body) },
            pullRequest: observedLinks.get(base.id) ?? base.pullRequest, revision: base.revision + 1, updatedAt: now };
          next.phaseId = githubIssuePhase(currentBoard, next) ?? base.phaseId;
          events.set(next.id, next);
        }
        for (const [id, link] of observedLinks) {
          if (events.has(id)) continue;
          const latest = all.find((issue) => issue.id === id)!;
          const phaseId = !link.diagnostic ? githubIssuePhase(currentBoard, { ...latest, pullRequest: link }) ?? latest.phaseId : latest.phaseId;
          events.set(id, { ...latest, phaseId, pullRequest: link, revision: latest.revision + 1, updatedAt: now });
        }
        signal.throwIfAborted();
        if (events.size) this.host.commit([...events.values()].map((issue) => this.saved(issue, "github")));
        if (github.importing) this.importedAt.set(projectId, Date.now());
        if (failures) throw new MoguriError("issue_pr_refresh", `${failures} linked PR checks failed. Ticket diagnostics show why; no unverified merge was applied.`);
        return { observed: events.size, skipped, boundedAt: 500, diagnostic: "GitHub only updates local cards. No GitHub write, source retargeting or stale local edit replacement was authorized." };
      } finally { this.refreshing.delete(projectId); this.prAborts.delete(projectId); }
    });
    this.refreshing.set(projectId, id);
    return id;
  }
  async query(query: WorkspaceQuery): Promise<WorkspaceResponse> {
    switch (query.type) {
      case "github.connection": return { type: query.type, connection: await this.integrations.githubConnection(this.stateDir, AbortSignal.timeout(15_000)) };
      case "linear.connection": return { type: query.type, connection: await this.integrations.linearConnection(query.verify, AbortSignal.timeout(15_000)) };
      case "board.get": return { type: query.type, board: this.board(query.projectId), issues: this.host.snapshot().issues.filter((issue) => issue.projectId === query.projectId) };
      case "cache.inspect": {
        const signal = AbortSignal.timeout(30_000);
        await this.host.assertRoot?.(query.projectId, query.workspaceId, signal);
        const plan = { ...await this.cache.inspect(this.host.project(query.projectId, query.workspaceId), query.manager), workspaceId: query.workspaceId ?? null };
        await this.host.assertRoot?.(query.projectId, query.workspaceId, signal);
        return { type: query.type, plan };
      }
      case "cache.registries": return { type: query.type, registries: await this.cache.registries.previews() };
      case "linear.status": {
        const board = this.board(query.projectId);
        const token = await this.integrations.vault.read("linear", AbortSignal.timeout(15_000));
        return { type: query.type, enabled: board.linear.enabled, credential: token ? "configured" : "required", diagnostic: "Optional read-only import remains explicit. Separate Linear workflows require exact source review and confirmation; importing a page never uploads local tickets." };
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
        if (config.kanban?.phaseIds.some((id) => !ids.includes(id) || id === config.mergedColumnId)) {
          throw new MoguriError("kanban_phases", "Continue work may select only existing non-final Kanban phases.");
        }
        if (config.autoRefreshPrs && config.githubSync && Object.values(config.githubSync.phases).some((phase) => !ids.includes(phase))) {
          throw new MoguriError("github_sync_phases", "Map each GitHub state to an existing board column.");
        }
        if (this.host.snapshot().issues.some((issue) => issue.projectId === board.projectId && !ids.includes(issue.phaseId))) throw new MoguriError("board_occupied", "Move all tickets, including archived ones, before removing an occupied phase.", 409);
        if (config.linear.enabled && !/^[A-Za-z0-9-]{1,128}$/.test(config.linear.teamId)) throw new MoguriError("linear_team", "Choose the exact Linear team UUID before enabling import.");
        const presentationOnly = boardPresentationOnly(board, config);
        let githubSource = board.githubSource;
        if (!presentationOnly && config.autoRefreshPrs && githubSyncSettings(config).importIssues) {
          if (!this.host.githubProject) throw new MoguriError("github_sync_unavailable", "This host has no qualified repository/account source reader. No fallback was used.", 409);
          if (config.githubAccess !== "gh-cli") throw new MoguriError("github_sync_auth", "Repository issue import needs your explicitly selected signed-in GitHub CLI account. No public fallback is used.", 403);
          const signal = AbortSignal.timeout(60000);
          const retainedSource = board.githubSource && this.host.snapshot().issues.some((issue) => issue.projectId === board.projectId && issue.github) ? board.githubSource : undefined;
          const context = await this.host.githubProject(board.projectId, signal, retainedSource);
          const repositoryId = await this.integrations.githubBoardIdentity(context.repository, context.accountId, context.binding.root.root, signal);
          const captured = { repository: context.repository, repositoryId, account: context.account, accountId: context.accountId, binding: context.binding,
            remote: { name: context.remote.name, fetchUrl: context.remote.fetchUrl } };
          await this.host.githubProject(board.projectId, signal, captured);
          if (board.githubSource && this.host.snapshot().issues.some((issue) => issue.projectId === board.projectId && issue.github) &&
            githubSourceIdentity(captured) !== githubSourceIdentity(board.githubSource)) {
            throw new MoguriError("github_sync_source_changed", "Existing imported cards retain another exact root/account/repository binding. No source was retargeted; leave sync off until the original binding is restored.", 409);
          }
          githubSource = retainedSource ?? captured;
          if (this.board(board.projectId).revision !== command.expectedRevision || this.host.closing(board.projectId)) throw new MoguriError("board_conflict", "This board changed while reviewing its exact GitHub source. Your settings were not overwritten.", 409);
        }
        if (!presentationOnly) {
          this.linear.get(board.projectId)?.abort();
          this.prAborts.get(board.projectId)?.abort();
          this.integrations.invalidateLinearProject(board.projectId);
          this.host.onLinearBoardChanged?.(board.projectId);
        }
        const result = finish([{ event_type: "board.saved", profile_id: this.host.snapshot().profileId, project_id: board.projectId,
          payload: { board: { ...config, projectId: board.projectId, revision: board.revision + 1, ...(githubSource ? { githubSource } : {}) } } }], { revision: board.revision + 1 });
        if (!presentationOnly && config.autoRefreshPrs && githubSyncSettings(config).importIssues) queueMicrotask(() => this.refresh(board.projectId, false));
        return result;
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
      case "issue.reorder": {
        const issue = this.issue(command.issueId, command.expectedRevision), board = this.board(issue.projectId);
        this.phase(board, command.phaseId);
        if (githubManagedIssue(board, issue) && command.phaseId !== issue.phaseId) throw new MoguriError("issue_github_managed", "GitHub controls this card's column while Sync with GitHub is on. Reorder within the column, or turn synchronization off for a local phase override.", 409);
        const current = this.host.snapshot().issues.filter((entry) => entry.projectId === issue.projectId && entry.archived === issue.archived &&
          [issue.phaseId, command.phaseId].includes(entry.phaseId));
        const expected = new Map(command.expectedOrder.map((entry) => [entry.issueId, entry]));
        if (expected.size !== command.expectedOrder.length || expected.size !== current.length || current.some((entry) => {
          const before = expected.get(entry.id), actual = issuePosition(entry);
          return !before || before.phaseId !== actual.phaseId || before.order !== actual.order;
        })) throw new MoguriError("issue_order_conflict", "The source or destination card order, membership or phase changed. Start the move again; no newer arrangement was overwritten.", 409);
        const destination = current.filter((entry) => entry.phaseId === command.phaseId && entry.id !== issue.id).sort(compareIssues);
        const before = command.beforeIssueId === null ? destination.length : destination.findIndex((entry) => entry.id === command.beforeIssueId);
        if (before < 0 || command.beforeIssueId === issue.id) throw new MoguriError("issue_order_target", "Choose an actual other card in the destination phase, or append to that column.", 409);
        destination.splice(before, 0, issue);
        const columns = [{ phaseId: command.phaseId, issues: destination },
          ...(issue.phaseId === command.phaseId ? [] : [{ phaseId: issue.phaseId, issues: current.filter((entry) => entry.phaseId === issue.phaseId && entry.id !== issue.id).sort(compareIssues) }])];
        const now = new Date().toISOString(), events: EventInput[] = [];
        let revision = issue.revision;
        for (const column of columns) for (const [index, entry] of column.issues.entries()) {
          const order = index + 1;
          if (entry.phaseId === column.phaseId && (entry.order ?? entry.number) === order) continue;
          const next = { ...entry, phaseId: column.phaseId, order, revision: entry.revision + 1, updatedAt: now };
          events.push(this.saved(next));
          if (entry.id === issue.id) revision = next.revision;
        }
        return finish(events, { id: issue.id, revision });
      }
      case "issue.update":
      case "issue.move":
      case "issue.archive": {
        const issue = this.issue(command.issueId, command.expectedRevision);
        const board = this.board(issue.projectId);
        const updated = { ...issue, revision: issue.revision + 1, updatedAt: new Date().toISOString() };
        if (command.type === "issue.archive") updated.archived = command.archived;
        else {
          if (githubManagedIssue(board, issue) && command.phaseId !== issue.phaseId) throw new MoguriError("issue_github_managed", "GitHub controls this card's column while synchronization is enabled. No GitHub write or conflicting local phase was applied.", 409);
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
      case "cache.registry.save": {
        const previous = command.registryId ? this.cache.registries.get(command.registryId) : undefined;
        if ((previous?.revision ?? 0) !== command.expectedRevision) throw new MoguriError("cache_registry_conflict", "Another client changed this registry. Reload its exact resources before saving.", 409);
        const registry = this.cache.registries.validate(command.config, previous);
        const result = finish([{ event_type: "cache.registry.saved", profile_id: this.host.snapshot().profileId, payload: { registry } }], { id: registry.id, revision: registry.revision });
        if (previous) await this.cache.registries.revoke(previous);
        return result;
      }
      case "cache.registry.remove": {
        const registry = this.cache.registries.get(command.registryId);
        if (registry.revision !== command.expectedRevision) throw new MoguriError("cache_registry_conflict", "Another client changed this registry. Reload before revoking it.", 409);
        const result = finish([{ event_type: "cache.registry.removed", profile_id: this.host.snapshot().profileId, payload: { registryId: registry.id } }]);
        await this.cache.registries.revoke(registry);
        return result;
      }
      case "cache.registry.token.set":
      case "cache.registry.token.clear": {
        const registry = this.cache.registries.get(command.registryId);
        let result: CommandResult = {};
        await this.cache.registries.changeToken(registry, command.type === "cache.registry.token.set" ? command.token : undefined, (next) => {
          result = finish([{ event_type: "cache.registry.saved", profile_id: this.host.snapshot().profileId, payload: { registry: next } }], { id: next.id, revision: next.revision });
        });
        return result;
      }
      case "cache.prepare":
      case "cache.install": {
        const project = this.host.project(command.projectId, command.workspaceId);
        const snapshot = this.host.snapshot();
        if (!snapshot.policy.allowedEnvs.includes("Local")) throw new MoguriError("cache_env", "Managed cache work has no qualified protected-env broker. It cannot silently run on Local.", 403);
        if (command.type === "cache.install" && command.manager !== "npm" && command.manager !== "pnpm") throw new MoguriError("cache_only", "Python, Cargo and Go expose verified native-manager caches, not a host environment install or build. Use cache.prepare; executable installation/build requires an explicitly qualified boundary.", 409);
        if (command.type === "cache.install" && command.runScripts) throw new MoguriError("cache_sandbox", "Lifecycle scripts require a qualified real SendBox boundary. It is unavailable; no script, download or host fallback was started.", 409);
        const rootKey = `${project.id}:${command.workspaceId ?? "base"}`;
        const quarantined = command.workspaceId ? snapshot.blockedWorkspaces.includes(command.workspaceId) : snapshot.blockedProjects.includes(project.id);
        const active = snapshot.sessions.some((session) => {
          if (!session.turnId || session.controls.env !== "Local" || !session.projectId) return false;
          try { return this.host.project(session.projectId, session.workspaceId ?? undefined).path === project.path; }
          catch (error) { console.error("Active cache writer root is unconfirmed:", error instanceof MoguriError ? error.code : "cache_root"); return true; }
        });
        if (this.busyRoots.has(rootKey) || this.busyPaths.has(project.path) || this.host.publicationBusy(project.id, command.workspaceId) || command.type === "cache.install" && (active || quarantined)) throw new MoguriError("cache_busy", "This workspace is busy or unconfirmed. Inspect and finish owned work first.", 409);
        if (command.type === "cache.install") { this.busyRoots.add(rootKey); this.busyPaths.add(project.path); }
        const id = this.host.job(command.type, project.id, async (signal, progress) => {
          const guard = async () => {
            signal.throwIfAborted();
            if (!this.host.snapshot().policy.allowedEnvs.includes("Local")) throw new MoguriError("cache_env", "Current policy no longer permits this Local managed operation. No protected-env or source-root fallback.", 403);
            await this.host.assertRoot?.(project.id, command.workspaceId, signal);
            signal.throwIfAborted();
          };
          const receipt = { ...await (command.type === "cache.install" ? this.cache.install(project, command.manager, command.expectedDigest, signal, progress, guard) : this.cache.prepare(project, command.manager, command.expectedDigest, signal, progress, guard)), workspaceId: command.workspaceId ?? null };
          signal.throwIfAborted();
          this.host.commit([{ event_type: "cache.prepared", profile_id: this.host.snapshot().profileId, project_id: project.id, payload: { receipt } }]);
          return receipt;
        }, () => { if (command.type === "cache.install") { this.busyRoots.delete(rootKey); this.busyPaths.delete(project.path); this.host.wake(); } }, command.workspaceId);
        return finish([], { id });
      }
      case "linear.token.set":
      case "linear.token.clear": {
        this.host.onLinearCredentialsChanged?.();
        for (const controller of this.linear.values()) controller.abort();
        const signal = AbortSignal.timeout(15_000);
        await this.integrations.setLinearToken(command.type === "linear.token.set" ? command.token : undefined, signal);
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
