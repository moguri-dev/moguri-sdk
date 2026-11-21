import { randomUUID } from "node:crypto";
import { stripMarkdownComments } from "../../../packages/protocol/src/markdown.ts";
import { isRecord, observedPrReadiness, MoguriError, type PrActivity, type GitHubConnection, type GithubBoardSource, type LinearConnection, type IssueBoard, type LocalIssue, type PullRequestLink } from "../../../packages/protocol/src/index.ts";
import { boundedBody, fetchJson } from "./network.ts";
import { runProgram } from "./program.ts";
import type { SecretVault } from "./gateway.ts";
import { loadRepository, lookupRepository, type RepositoryReadBinding } from "./repository-metadata.ts";
import { redactSecrets } from "./secret-redactor.ts";

export interface IntegrationOptions {
  fetch?: typeof fetch; vault?: SecretVault; prRefreshMs?: number; program?: typeof runProgram;
  githubCliRead?: (endpoint: string, root: string, signal: AbortSignal) => Promise<unknown>;
  githubGraphqlRead?: (query: string, variables: Record<string, string | null>, root: string, signal: AbortSignal) => Promise<unknown>;
}
export interface GithubBoardIssue {
  nodeId: string; databaseId: number; repo: string; number: number; url: string; title: string; body: string;
  state: "open" | "closed"; stateReason: "completed" | "not_planned" | "duplicate" | null; updatedAt: string; pullRequests: PullRequestLink[];
}
const githubBoardFragment = `fragment MoguriKanbanCard on Issue {
  id databaseId: fullDatabaseId number url title body state stateReason updatedAt repository { nameWithOwner }
  closedByPullRequestsReferences(first: 100, includeClosedPrs: false) {
    nodes { number url state isDraft mergedAt repository { nameWithOwner } }
    pageInfo { hasNextPage endCursor }
  }
}`;
function githubDatabaseId(value: unknown): number {
  const parsed = typeof value === "string" && /^[1-9][0-9]{0,15}$/.test(value) ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isSafeInteger(parsed) || parsed < 1) {
    throw new MoguriError("github_sync_identity", "GitHub did not return an exact safely representable database identity. No rounded or substituted identifier was retained.", 502);
  }
  return parsed;
}
function githubBoardIssue(value: unknown, repository: string, expectedNumber?: number): GithubBoardIssue {
  if (!isRecord(value)) throw new MoguriError("github_sync_issue", "The exact linked issue is missing or unavailable. No closure or replacement was inferred.", 502);
  const databaseId = githubDatabaseId(value.databaseId);
  if (typeof value.id !== "string" || !/^[A-Za-z0-9_+/=-]{1,256}$/.test(value.id) ||
    !Number.isSafeInteger(value.number) || Number(value.number) < 1 ||
    expectedNumber !== undefined && value.number !== expectedNumber || value.url !== `https://github.com/${repository}/issues/${value.number}` ||
    !isRecord(value.repository) || value.repository.nameWithOwner !== repository || typeof value.title !== "string" || !value.title.trim() ||
    value.title.length > 256 || typeof value.body !== "string" || value.body.length > 64 * 1024 ||
    !["OPEN", "CLOSED"].includes(String(value.state)) || value.stateReason !== null && !["COMPLETED", "NOT_PLANNED", "DUPLICATE", "REOPENED"].some((reason) => reason === value.stateReason) ||
    typeof value.updatedAt !== "string" || !Number.isFinite(Date.parse(value.updatedAt))) {
    throw new MoguriError("github_sync_issue", "GitHub did not return this exact complete bounded issue. Original cards were preserved.", 502);
  }
  const links = value.closedByPullRequestsReferences;
  if (!isRecord(links) || !Array.isArray(links.nodes) || links.nodes.length > 100 ||
    !isRecord(links.pageInfo) || links.pageInfo.hasNextPage !== false) {
    throw new MoguriError("github_sync_links", "GitHub's actual linked-PR collection is incomplete or exceeds its bound. No mention was inferred to be an attachment.", 502);
  }
  const urls = new Set<string>(), checkedAt = new Date().toISOString();
  const pullRequests: PullRequestLink[] = links.nodes.map((request: unknown) => {
    if (!isRecord(request) || !Number.isSafeInteger(request.number) || Number(request.number) < 1 || typeof request.isDraft !== "boolean" ||
      !["OPEN", "CLOSED", "MERGED"].includes(String(request.state)) || !isRecord(request.repository) || typeof request.repository.nameWithOwner !== "string" ||
      !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(request.repository.nameWithOwner)) throw new MoguriError("github_sync_links", "GitHub returned an invalid linked PR. No phase was changed.", 502);
    const repo = request.repository.nameWithOwner, number = Number(request.number), url = `https://github.com/${repo}/pull/${number}`;
    if (request.url !== url || urls.has(url) || request.state === "MERGED" && (typeof request.mergedAt !== "string" || !Number.isFinite(Date.parse(request.mergedAt)))) {
      throw new MoguriError("github_sync_links", "A linked PR lost its exact source or merged evidence. No phase was changed.", 502);
    }
    urls.add(url);
    return { url, repo, number, state: request.state === "MERGED" ? "merged" : request.state === "CLOSED" ? "closed" : "open",
      draft: request.isDraft, checkedAt, diagnostic: null };
  });
  return { nodeId: value.id, databaseId, repo: repository, number: Number(value.number), url: String(value.url),
    title: stripMarkdownComments(value.title), body: stripMarkdownComments(value.body), state: value.state === "CLOSED" ? "closed" : "open",
    stateReason: value.stateReason === "NOT_PLANNED" ? "not_planned" : value.stateReason === "COMPLETED" ? "completed" : value.stateReason === "DUPLICATE" ? "duplicate" : null,
    updatedAt: value.updatedAt, pullRequests };
}
export interface LinearAccess {
  readonly generation: string;
  readonly signal: AbortSignal;
  current(): boolean;
  protect(value: unknown): void;
  request(query: string, variables: Record<string, unknown>, signal: AbortSignal, beforeMutation?: () => void): Promise<Record<string, unknown>>;
}
export class LinearResponseError extends MoguriError {
  constructor(readonly evidence: Record<string, unknown> | null) {
    super("linear_response", "Linear returned rejected, partial or missing GraphQL data. Provider messages were withheld to protect the credential; no complete result was acknowledged.", 502);
  }
}
function linearSignal(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException("The owned Linear request was cancelled. No automatic retry was made.", "AbortError");
}
export function validateLinearCursor(cursor: string | undefined): void {
  if (cursor !== undefined && (!/^[A-Za-z0-9+/_=-]{1,512}$/.test(cursor) || /^https?/i.test(cursor))) throw new MoguriError("linear_cursor", "Use only the opaque cursor returned by this exact Linear collection.");
}
/** The workflow run of a GitHub Actions check run, from its canonical job link; it ties a rerun to its original job. */
function actionsRun(url: unknown, id: unknown): { runId?: number } {
  const match = typeof url === "string" ? url.match(/^https:\/\/github\.com\/[^/]+\/[^/]+\/actions\/runs\/([1-9]\d{0,15})\/job\/([1-9]\d{0,15})(?:[?#].*)?$/) : null;
  return match && Number(match[2]) === id && Number.isSafeInteger(Number(match[1])) ? { runId: Number(match[1]) } : {};
}
export function pullRequestLink(input: string): PullRequestLink {
  let url: URL;
  try { url = new URL(input); } catch { throw new MoguriError("issue_pr", "Use a canonical https://github.com/OWNER/REPO/pull/NUMBER URL."); }
  const match = url.pathname.match(/^\/([A-Za-z0-9][A-Za-z0-9_.-]*)\/([A-Za-z0-9][A-Za-z0-9_.-]*)\/pull\/([1-9]\d*)\/?$/);
  if (url.protocol !== "https:" || url.host !== "github.com" || url.username || url.password || url.search || url.hash || !match || !Number.isSafeInteger(Number(match[3]))) throw new MoguriError("issue_pr", "Use a canonical github.com pull request URL, without credentials, query or fragment.");
  const repo = `${match[1]}/${match[2]}`;
  return { url: `https://github.com/${repo}/pull/${match[3]}`, repo, number: Number(match[3]), state: "unknown", draft: null, checkedAt: null, diagnostic: null };
}
export class ProjectIntegrations {
  private linearGeneration = randomUUID();
  private linearAbort = new AbortController();
  private linearToken: string | undefined;
  private linearChanging = false;
  private readonly linearProjects = new Map<string, AbortController>();
  constructor(readonly vault: SecretVault, private readonly options: IntegrationOptions = {}) {}
  private async boardGraphql(repository: string, accountId: string, root: string, fields: string, cursor: string | null, signal: AbortSignal): Promise<Record<string, unknown> & { databaseId: number }> {
    const [owner, name, extra] = repository.split("/");
    if (extra || !owner || !name || !/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(name)) throw new MoguriError("github_sync_repository", "Use the exact reviewed GitHub repository.");
    const query = `query MoguriKanban($owner: String!, $name: String!${fields.includes("$cursor") ? ", $cursor: String" : ""}) {
      viewer { login databaseId } repository(owner: $owner, name: $name) { databaseId: fullDatabaseId nameWithOwner url ${fields} }
    }${fields.includes("MoguriKanbanCard") ? githubBoardFragment : ""}`;
    const variables: Record<string, string | null> = { owner, name, ...(fields.includes("$cursor") ? { cursor } : {}) };
    let response: unknown;
    if (this.options.githubGraphqlRead) response = await this.options.githubGraphqlRead(query, variables, root, signal);
    else {
      const args = ["api", "--hostname", "github.com", "--method", "POST", "graphql", "--raw-field", `query=${query}`,
        ...Object.entries(variables).flatMap(([key, value]) => value === null ? [] : ["--raw-field", `${key}=${value}`])];
      let output: string;
      try {
        output = await (this.options.program ?? runProgram)("gh", args, { cwd: root, signal, timeoutMs: 20000, maxBytes: 8 * 1024 * 1024,
          label: "Read synchronized GitHub board", env: { GH_PROMPT_DISABLED: "1", GH_NO_UPDATE_NOTIFIER: "1" } });
      } catch {
        signal.throwIfAborted();
        throw new MoguriError("github_sync_read", "The captured GitHub account could not read issue and linked-PR status. No public, account or credential fallback was used.", 403);
      }
      try { response = JSON.parse(output); } catch { throw new MoguriError("github_sync_response", "GitHub returned invalid board JSON. No observation was applied.", 502); }
    }
    signal.throwIfAborted();
    if (!isRecord(response) || response.errors !== undefined && (!Array.isArray(response.errors) || response.errors.length > 0) || !isRecord(response.data) ||
      !isRecord(response.data.viewer) || typeof response.data.viewer.login !== "string" || !Number.isSafeInteger(response.data.viewer.databaseId) ||
      `${response.data.viewer.login}:${response.data.viewer.databaseId}` !== accountId || !isRecord(response.data.repository)) {
      throw new MoguriError("github_sync_account", "The complete GitHub response did not verify the captured account. Partial or foreign observations were preserved as errors.", 409);
    }
    const result = response.data.repository;
    const repositoryId = githubDatabaseId(result.databaseId);
    if (result.nameWithOwner !== repository || result.url !== `https://github.com/${repository}`) {
      throw new MoguriError("github_sync_repository", "The response did not verify this exact repository identity. No source was substituted.", 409);
    }
    return { ...result, databaseId: repositoryId };
  }
  async githubBoardIdentity(repository: string, accountId: string, root: string, signal: AbortSignal): Promise<number> {
    return (await this.boardGraphql(repository, accountId, root, "", null, signal)).databaseId;
  }
  async githubBoardPage(source: GithubBoardSource, cursor: string | null, signal: AbortSignal): Promise<{ items: GithubBoardIssue[]; nextCursor: string | null }> {
    if (cursor !== null && (!cursor || cursor.length > 512 || /[\u0000-\u001f]/.test(cursor))) throw new MoguriError("github_sync_cursor", "The original GitHub cursor is invalid.");
    const repository = await this.boardGraphql(source.repository, source.accountId, source.binding.root.root,
      "issues(first: 20, states: [OPEN], after: $cursor, orderBy: {field: UPDATED_AT, direction: DESC}) { nodes { ...MoguriKanbanCard } pageInfo { hasNextPage endCursor } }", cursor, signal);
    if (repository.databaseId !== source.repositoryId || !isRecord(repository.issues) || !Array.isArray(repository.issues.nodes) || repository.issues.nodes.length > 20 ||
      !isRecord(repository.issues.pageInfo) || typeof repository.issues.pageInfo.hasNextPage !== "boolean") {
      throw new MoguriError("github_sync_page", "The complete issue page lost its captured repository or bounds. Nothing was imported.", 502);
    }
    const page = repository.issues.pageInfo, next = page.hasNextPage ? page.endCursor : null;
    if (next !== null && (typeof next !== "string" || !next || next.length > 512 || next === cursor)) throw new MoguriError("github_sync_cursor", "GitHub pagination did not advance. Nothing was silently truncated.", 502);
    const items = repository.issues.nodes.map((item) => githubBoardIssue(item, source.repository));
    if (items.some((item) => item.state !== "open") || new Set(items.map((item) => item.nodeId)).size !== items.length) throw new MoguriError("github_sync_page", "The open-issue page contains a duplicate or contradictory source.", 502);
    return { items, nextCursor: typeof next === "string" ? next : null };
  }
  async githubBoardIssues(source: GithubBoardSource, numbers: number[], signal: AbortSignal): Promise<GithubBoardIssue[]> {
    if (!numbers.length) return [];
    if (numbers.length > 20 || numbers.some((number) => !Number.isSafeInteger(number) || number < 1) || new Set(numbers).size !== numbers.length) throw new MoguriError("github_sync_batch", "Inspect at most 20 exact unique issue identities per read.");
    const fields = numbers.map((number, index) => `card${index}: issue(number: ${number}) { ...MoguriKanbanCard }`).join("\n");
    const repository = await this.boardGraphql(source.repository, source.accountId, source.binding.root.root, fields, null, signal);
    if (repository.databaseId !== source.repositoryId) throw new MoguriError("github_sync_repository", "The captured GitHub repository changed identity. Original links were preserved.", 409);
    return numbers.map((number, index) => githubBoardIssue(repository[`card${index}`], source.repository, number));
  }
  async githubConnection(root: string, signal: AbortSignal): Promise<GitHubConnection> {
    const result = await this.githubRequest("user", "gh-cli", root, signal);
    if (!isRecord(result) || typeof result.login !== "string" || !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(result.login) ||
      typeof result.id !== "number" || !Number.isSafeInteger(result.id) || result.id < 1) throw new MoguriError("github_account", "The existing GitHub CLI account was not verified. Sign in with gh explicitly; Copilot and update credentials were not used.", 401);
    return { login: result.login, id: result.id, boundary: "control-plane-gh-cli" };
  }
  async linearConnection(verify: boolean, signal: AbortSignal): Promise<LinearConnection> {
    const generation = this.linearGeneration, source = this.linearAbort;
    if (this.linearChanging) throw new MoguriError("linear_auth_changing", "Wait for the profile credential change before inspecting it.", 409);
    const credential = await this.vault.read("linear", AbortSignal.any([signal, source.signal]));
    signal.throwIfAborted();
    if (source.signal.aborted || generation !== this.linearGeneration || this.linearChanging) throw new MoguriError("linear_auth_changed", "The profile credential changed during inspection. No old account was adopted.", 409);
    if (!credential) return { credential: "required", account: null };
    if (!verify) return { credential: "configured", account: null };
    const access = await this.linearAccess(signal);
    const result = await access.request("query MoguriConnection { viewer { id name } organization { id name } }", {}, signal);
    const valid = (value: unknown): value is { id: string; name: string } => isRecord(value) && typeof value.id === "string" && value.id.length > 0 && value.id.length <= 128 &&
      typeof value.name === "string" && value.name.length > 0 && value.name.length <= 200 && !/[\u0000-\u001f\u007f]/.test(value.name);
    if (!access.current() || !valid(result.viewer) || !valid(result.organization)) throw new MoguriError("linear_identity", "Linear did not verify the exact account/workspace. No team or credential was substituted.", 409);
    return { credential: "configured", account: { id: result.viewer.id, name: result.viewer.name, workspaceId: result.organization.id, workspaceName: result.organization.name } };
  }
  invalidateLinearCredentials(): void {
    this.linearAbort.abort();
    this.linearAbort = new AbortController();
    this.linearGeneration = randomUUID();
    this.linearToken = undefined;
  }
  invalidateLinearProject(projectId: string): void {
    this.linearProjects.get(projectId)?.abort();
    this.linearProjects.delete(projectId);
  }
  async setLinearToken(token: string | undefined, signal: AbortSignal): Promise<void> {
    if (token !== undefined && !/^[\x21-\x7e]{1,4096}$/.test(token)) throw new MoguriError("linear_token", "Use the personal API key without whitespace/control characters.");
    if (this.linearChanging) throw new MoguriError("linear_auth_changing", "A Linear credential change is already pending.", 409);
    this.linearChanging = true;
    this.invalidateLinearCredentials();
    try {
      if (token === undefined) await this.vault.remove("linear", signal);
      else await this.vault.write("linear", token, signal);
      signal.throwIfAborted();
    } catch {
      throw new MoguriError("linear_auth_write", "The OS-keychain credential change was not confirmed. Old requests and reviews remain invalid; inspect the keychain before a new review.", 409);
    } finally { this.invalidateLinearCredentials(); this.linearChanging = false; }
  }
  async linearAccess(signal: AbortSignal, projectId?: string): Promise<LinearAccess> {
    if (this.linearChanging) throw new MoguriError("linear_auth_changing", "Wait for the explicit Linear keychain change to finish; no previous credential was used.", 409);
    const generation = this.linearGeneration, owner = this.linearAbort;
    const project = projectId ? this.linearProjects.get(projectId) ?? new AbortController() : undefined;
    if (projectId && project) this.linearProjects.set(projectId, project);
    const combined = AbortSignal.any([signal, owner.signal, ...(project ? [project.signal] : []), AbortSignal.timeout(20_000)]);
    let token: string | null;
    try { token = await this.vault.read("linear", combined); }
    catch { linearSignal(combined); throw new MoguriError("linear_auth", "The explicit profile OS-keychain Linear credential could not be read. No fallback was used.", 401); }
    linearSignal(combined);
    if (generation !== this.linearGeneration || this.linearChanging) throw new MoguriError("linear_auth_changed", "Linear credentials changed during access. Review again with the actual account.", 409);
    if (!token) throw new MoguriError("linear_auth", "Store a Linear personal API key in the profile OS keychain. No ambient or plaintext fallback exists.", 401);
    if (this.linearToken !== undefined && this.linearToken !== token) {
      this.invalidateLinearCredentials();
      throw new MoguriError("linear_auth_changed", "The keychain credential changed outside this request. All old requests/reviews were invalidated; explicitly review again.", 409);
    }
    this.linearToken = token;
    const credential = token;
    const current = () => generation === this.linearGeneration && !this.linearChanging && !owner.signal.aborted && !project?.signal.aborted;
    const protect = (value: unknown) => {
      if (JSON.stringify(value) !== JSON.stringify(redactSecrets(value, [credential]))) throw new MoguriError("linear_secret", "The input contains the active Linear credential. It was neither stored nor sent as issue/project content.");
    };
    return {
      generation, signal: AbortSignal.any([owner.signal, ...(project ? [project.signal] : [])]), current, protect,
      request: async (query, variables, requested, beforeMutation) => {
        const mutation = /^\s*mutation\s+Moguri[A-Za-z0-9_]+\b/.test(query);
        if ((!mutation && !/^\s*query\s+Moguri[A-Za-z0-9_]+\b/.test(query)) || mutation !== Boolean(beforeMutation)) throw new MoguriError("linear_request", "Only a fixed reviewed Linear operation may be dispatched.");
        const requestSignal = AbortSignal.any([requested, owner.signal, ...(project ? [project.signal] : []), AbortSignal.timeout(20_000)]);
        linearSignal(requestSignal);
        if (!current()) throw new MoguriError("linear_auth_changed", "Linear credentials or the selected board changed. No credential was substituted.", 409);
        let actual: string | null;
        try { actual = await this.vault.read("linear", requestSignal); }
        catch { linearSignal(requestSignal); throw new MoguriError("linear_auth", "The explicit Linear keychain credential could not be rechecked.", 401); }
        linearSignal(requestSignal);
        if (actual !== credential) {
          this.invalidateLinearCredentials();
          throw new MoguriError("linear_auth_changed", "The Linear key was revoked or replaced. The old request and review were invalidated.", 409);
        }
        if (!current()) throw new MoguriError("linear_auth_changed", "The selected credential or board changed before dispatch.", 409);
        protect(variables);
        const body = JSON.stringify({ query, variables });
        if (Buffer.byteLength(body) > 192 * 1024) throw new MoguriError("linear_limit", "The complete Linear request exceeded its reviewed 192-KiB limit. Nothing was truncated.");
        beforeMutation?.();
        let response: Response;
        try {
          response = await (this.options.fetch ?? fetch)("https://api.linear.app/graphql", {
            method: "POST", headers: { "Content-Type": "application/json", Authorization: credential }, body, signal: requestSignal, redirect: "error",
          });
        } catch {
          linearSignal(requestSignal);
          throw new MoguriError("linear_transport", mutation ? "Linear mutation response was not received. Its outcome is unknown; inspect the retained intent without replaying it." : "Linear could not be reached. No data was applied.", 502);
        }
        if (!response.ok) {
          await response.body?.cancel().catch(() => {});
          throw new MoguriError("linear_http", `Linear returned HTTP ${response.status}. No complete result was acknowledged.`, 502);
        }
        let result: unknown;
        try {
          const bytes = await boundedBody(response, 2 * 1024 * 1024, mutation ? AbortSignal.timeout(5_000) : requestSignal);
          result = redactSecrets(JSON.parse(bytes.toString("utf8")), [credential]);
        } catch { linearSignal(requestSignal); throw new MoguriError("linear_response", "Linear returned an unreadable, cancelled or oversized response. No complete result was acknowledged.", 502); }
        if (!isRecord(result) || result.errors !== undefined && (!Array.isArray(result.errors) || result.errors.length > 0) || !isRecord(result.data)) {
          throw new LinearResponseError(mutation && isRecord(result) && isRecord(result.data) ? result.data : null);
        }
        if (!mutation) {
          linearSignal(requestSignal);
          if (!current()) throw new MoguriError("linear_auth_changed", "The board or key changed while reading Linear. No stale data was applied.", 409);
        }
        return result.data;
      },
    };
  }
  async githubRead(endpoint: string, access: "public" | "gh-cli", root: string, signal: AbortSignal): Promise<unknown> {
    const repository = endpoint.match(/^repos\/([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9_.-]{1,100})\//);
    if (!repository || [".", ".."].includes(repository[2]!) ||
      !/^repos\/[^/]+\/[^/]+\/(?:(?:pulls|issues)\/[1-9]\d*|contents\/[A-Za-z0-9%_.~!/-]+)$/.test(endpoint)) throw new MoguriError("github_endpoint", "Choose an exact repository issue, PR or file read endpoint.");
    return this.githubRequest(endpoint, access, root, signal);
  }
  async repositoryMetadata(readBinding: () => Promise<RepositoryReadBinding>, access: "public" | "gh-cli", root: string, signal: AbortSignal) {
    if (access === "gh-cli") return loadRepository(readBinding, (fullName) => this.githubRequest(`repos/${fullName}`, access, root, signal), signal);
    const result = await lookupRepository(readBinding, this.options.fetch ?? fetch, signal);
    if (result.repository.visibility !== "public") throw new MoguriError("repository_access", "A private/internal repository needs explicitly selected authenticated GitHub access. No credential fallback was used.", 403);
    return result;
  }
  private async githubRequest(endpoint: string, access: "public" | "gh-cli", root: string | null, signal: AbortSignal): Promise<unknown> {
    if (access === "gh-cli") {
      if (root === null) throw new MoguriError("github_root", "Authenticated PR inspection requires an explicit bound Local project root. No previous project or account was substituted.", 409);
      if (this.options.githubCliRead) return this.options.githubCliRead(endpoint, root, signal);
      let text: string;
      try {
        text = await (this.options.program ?? runProgram)("gh", ["api", "--hostname", "github.com", "--method", "GET", endpoint], {
          cwd: root, signal, timeoutMs: 15_000, maxBytes: 2 * 1024 * 1024, label: "Read selected GitHub metadata",
          env: { GH_PROMPT_DISABLED: "1", GH_NO_UPDATE_NOTIFIER: "1" },
        });
      } catch {
        signal.throwIfAborted();
        throw new MoguriError("github_cli_unavailable", "The selected GitHub CLI account could not read this reference. Check gh authentication and repository access.", 403);
      }
      try { return JSON.parse(text); } catch { throw new MoguriError("issue_pr_response", "GitHub CLI returned invalid reference JSON. Nothing was applied."); }
    }
    return fetchJson(this.options.fetch ?? fetch, `https://api.github.com/${endpoint}`, { headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" } }, AbortSignal.any([signal, AbortSignal.timeout(15_000)]))
      .catch((error: unknown) => {
        // GitHub answers 404 to unauthenticated reads of private repositories, so say how to grant access instead of only "not found".
        if (error instanceof MoguriError && error.code === "remote_failed" && / HTTP 404\./.test(error.message)) {
          throw new MoguriError("github_public_access", "GitHub returned 404 to an unauthenticated read. If this repository is private, set this project's GitHub read access to your GitHub CLI account (Project settings); nothing was read or applied.", 403);
        }
        throw error;
      });
  }
  async pullRequest(link: PullRequestLink, board: Pick<IssueBoard, "githubAccess">, root: string | null, signal: AbortSignal): Promise<PullRequestLink> {
    const current = pullRequestLink(link.url);
    const result = await this.githubRequest(`repos/${current.repo}/pulls/${current.number}`, board.githubAccess, root, signal);
    if (!isRecord(result) || result.number !== current.number || result.html_url !== current.url || !["open", "closed"].includes(String(result.state)) ||
      typeof result.draft !== "boolean" || typeof result.merged !== "boolean" || result.merged && (result.state !== "closed" || typeof result.merged_at !== "string" || !Number.isFinite(Date.parse(result.merged_at)))) {
      throw new MoguriError("issue_pr_response", "The response did not verify this exact PR's state. No phase was changed.");
    }
    const readiness = observedPrReadiness(result);
    return { ...current, state: result.merged ? "merged" : result.state === "closed" ? "closed" : "open", draft: result.draft, checkedAt: new Date().toISOString(), diagnostic: null,
      ...(readiness !== undefined && isRecord(result.head) && typeof result.head.sha === "string" ? { readyToMerge: readiness, headSha: result.head.sha } : {}) };
  }
  /** Bounded read of one PR's head, reviews and head check runs for lifecycle follow-ups. Nothing is retained. */
  async pullRequestActivity(link: PullRequestLink, access: "public" | "gh-cli", root: string | null, signal: AbortSignal): Promise<PrActivity> {
    const current = pullRequestLink(link.url), base = `repos/${current.repo}`;
    const pull = await this.githubRequest(`${base}/pulls/${current.number}`, access, root, signal);
    if (!isRecord(pull) || pull.number !== current.number || pull.html_url !== current.url || !isRecord(pull.head) || typeof pull.head.sha !== "string" ||
      !/^[a-f0-9]{40}$/.test(pull.head.sha) || !["open", "closed"].includes(String(pull.state))) {
      throw new MoguriError("issue_pr_response", "The response did not verify this exact PR's head. No follow-up was inferred.");
    }
    const headSha = pull.head.sha, author = isRecord(pull.user) && typeof pull.user.login === "string" ? pull.user.login : null;
    const reviews: PrActivity["reviews"] = [];
    for (let page = 1; page <= 3; page++) {
      const values = await this.githubRequest(`${base}/pulls/${current.number}/reviews?per_page=100&page=${page}`, access, root, signal);
      if (!Array.isArray(values)) throw new MoguriError("issue_pr_response", "GitHub returned an invalid review list. No follow-up was inferred.");
      for (const value of values) if (isRecord(value) && Number.isSafeInteger(value.id) && typeof value.state === "string") reviews.push({ id: Number(value.id), state: value.state,
        author: isRecord(value.user) && typeof value.user.login === "string" ? value.user.login : null, submittedAt: typeof value.submitted_at === "string" ? value.submitted_at : null });
      if (values.length < 100) break;
    }
    const runs = await this.githubRequest(`${base}/commits/${headSha}/check-runs?filter=latest&per_page=100`, access, root, signal);
    if (!isRecord(runs) || !Array.isArray(runs.check_runs)) throw new MoguriError("issue_pr_response", "GitHub returned invalid check runs. No follow-up was inferred.");
    const at = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
    const checks: PrActivity["checks"] = runs.check_runs.flatMap((value) => isRecord(value) && typeof value.name === "string" && typeof value.status === "string" && value.head_sha === headSha ?
      [{ name: value.name, status: value.status, conclusion: typeof value.conclusion === "string" ? value.conclusion : null,
        ...(Number.isSafeInteger(value.id) && Number(value.id) > 0 ? { id: Number(value.id) } : {}),
        ...actionsRun(value.details_url, value.id),
        app: isRecord(value.app) && typeof value.app.slug === "string" ? value.app.slug.slice(0, 100) : null,
        url: typeof value.html_url === "string" && value.html_url.startsWith("https://github.com/") ? value.html_url.slice(0, 2048) : null,
        startedAt: at(value.started_at), completedAt: at(value.completed_at) }] : []);
    // A truncated list cannot prove every check finished, so report it as still running.
    if (typeof runs.total_count === "number" && runs.total_count > checks.length) checks.push({ name: "(more checks)", status: "in_progress", conclusion: null });
    // CI that reports through the commit Status API (not check runs) counts too: pending is running, error/failure failed.
    const combined = await this.githubRequest(`${base}/commits/${headSha}/status?per_page=100`, access, root, signal);
    if (!isRecord(combined) || !Array.isArray(combined.statuses)) throw new MoguriError("issue_pr_response", "GitHub returned an invalid commit status. No follow-up was inferred.");
    for (const value of combined.statuses) if (isRecord(value) && typeof value.context === "string" && typeof value.state === "string") {
      checks.push({ name: value.context, status: value.state === "pending" ? "in_progress" : "completed",
        conclusion: value.state === "pending" ? null : value.state === "success" ? "success" : "failure" });
    }
    if (typeof combined.total_count === "number" && combined.total_count > combined.statuses.length) checks.push({ name: "(more checks)", status: "in_progress", conclusion: null });
    const target = isRecord(pull.base) && typeof pull.base.ref === "string" && typeof pull.base.sha === "string" && /^[a-f0-9]{40}$/.test(pull.base.sha) ?
      { baseRef: pull.base.ref.slice(0, 255), baseSha: pull.base.sha } : {};
    return { headSha, headRef: typeof pull.head.ref === "string" ? pull.head.ref : "", state: pull.merged === true ? "merged" : pull.state === "closed" ? "closed" : "open", author, reviews, checks, ...target,
      mergeable: typeof pull.mergeable === "boolean" ? pull.mergeable : null, mergeableState: typeof pull.mergeable_state === "string" ? pull.mergeable_state.slice(0, 64) : null };
  }
  async importLinear(board: IssueBoard, cursor: string | undefined, signal: AbortSignal): Promise<{
    items: { title: string; body: string; linear: NonNullable<LocalIssue["linear"]> }[]; nextCursor: string | null;
  }> {
    if (!board.linear.enabled || !board.linear.teamId) throw new MoguriError("linear_disabled", "Linear is optional and off by default. Enable a team explicitly before importing.", 409);
    validateLinearCursor(cursor);
    const access = await this.linearAccess(signal, board.projectId);
    const result = await access.request(
      "query MoguriTeamIssues($team: String!, $after: String) { team(id: $team) { id issues(first: 50, after: $after) { nodes { id identifier url title description updatedAt } pageInfo { hasNextPage endCursor } } } }",
      { team: board.linear.teamId, after: cursor ?? null }, signal,
    );
    if (!isRecord(result.team) || result.team.id !== board.linear.teamId || !isRecord(result.team.issues)) {
      throw new MoguriError("linear_response", "Linear returned missing, partial or rejected team data. Check team access and the API key; nothing was imported.", 502);
    }
    const connection = result.team.issues;
    if (!Array.isArray(connection.nodes) || connection.nodes.length > 50 || !isRecord(connection.pageInfo) || typeof connection.pageInfo.hasNextPage !== "boolean" ||
      connection.pageInfo.hasNextPage && (typeof connection.pageInfo.endCursor !== "string" || !connection.pageInfo.endCursor || connection.pageInfo.endCursor === cursor) ||
      connection.pageInfo.endCursor !== null && (typeof connection.pageInfo.endCursor !== "string" || connection.pageInfo.endCursor.length > 512)) {
      throw new MoguriError("linear_response", "Linear returned invalid pagination. Nothing was imported.", 502);
    }
    if (connection.pageInfo.hasNextPage) validateLinearCursor(String(connection.pageInfo.endCursor));
    const ids = new Set<string>();
    const items = connection.nodes.map((node: unknown) => {
      if (!isRecord(node) || typeof node.id !== "string" || !node.id || node.id.length > 128 || ids.has(node.id) ||
        typeof node.identifier !== "string" || node.identifier.length > 80 || typeof node.title !== "string" || !node.title.trim() ||
        typeof node.url !== "string" || typeof node.updatedAt !== "string" || !Number.isFinite(Date.parse(node.updatedAt)) ||
        node.description !== null && typeof node.description !== "string") throw new MoguriError("linear_response", "Linear returned an invalid issue. The page was not imported.");
      const url = new URL(node.url);
      if (url.protocol !== "https:" || url.host !== "linear.app" || url.username || url.password || url.search || url.hash) throw new MoguriError("linear_response", "The remote issue link is not a canonical Linear destination.");
      ids.add(node.id);
      return {
        title: stripMarkdownComments(node.title).slice(0, 160), body: stripMarkdownComments(node.description ?? "").slice(0, 64 * 1024),
        linear: { id: node.id, identifier: node.identifier, url: url.href, updatedAt: node.updatedAt },
      };
    });
    return { items, nextCursor: connection.pageInfo.hasNextPage ? String(connection.pageInfo.endCursor) : null };
  }
}
