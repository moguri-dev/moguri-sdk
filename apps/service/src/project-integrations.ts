import { randomUUID } from "node:crypto";
import { isRecord, MoguriError, type GitHubConnection, type LinearConnection, type IssueBoard, type LocalIssue, type PullRequestLink } from "../../../packages/protocol/src/index.ts";
import { boundedBody, fetchJson } from "./network.ts";
import { runProgram } from "./program.ts";
import type { SecretVault } from "./gateway.ts";
import { loadRepository, lookupRepository, type RepositoryReadBinding } from "./repository-metadata.ts";
import { redactSecrets } from "./secret-redactor.ts";

export interface IntegrationOptions {
  fetch?: typeof fetch; vault?: SecretVault; prRefreshMs?: number; program?: typeof runProgram;
  githubCliRead?: (endpoint: string, root: string, signal: AbortSignal) => Promise<unknown>;
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
export function pullRequestLink(input: string): PullRequestLink {
  let url: URL;
  try { url = new URL(input); } catch { throw new MoguriError("issue_pr", "Use a canonical https://github.com/OWNER/REPO/pull/NUMBER URL."); }
  const match = url.pathname.match(/^\/([A-Za-z0-9][A-Za-z0-9_.-]*)\/([A-Za-z0-9][A-Za-z0-9_.-]*)\/pull\/([1-9]\d*)\/?$/);
  if (url.protocol !== "https:" || url.host !== "github.com" || url.username || url.password || url.search || url.hash || !match || !Number.isSafeInteger(Number(match[3]))) throw new MoguriError("issue_pr", "Use a canonical github.com pull request URL, without credentials, query or fragment.");
  const repo = `${match[1]}/${match[2]}`;
  return { url: `https://github.com/${repo}/pull/${match[3]}`, repo, number: Number(match[3]), state: "unknown", checkedAt: null, diagnostic: null };
}
export class ProjectIntegrations {
  private linearGeneration = randomUUID();
  private linearAbort = new AbortController();
  private linearToken: string | undefined;
  private linearChanging = false;
  private readonly linearProjects = new Map<string, AbortController>();
  constructor(readonly vault: SecretVault, private readonly options: IntegrationOptions = {}) {}
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
  private async githubRequest(endpoint: string, access: "public" | "gh-cli", root: string, signal: AbortSignal): Promise<unknown> {
    if (access === "gh-cli") {
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
    return fetchJson(this.options.fetch ?? fetch, `https://api.github.com/${endpoint}`, { headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" } }, AbortSignal.any([signal, AbortSignal.timeout(15_000)]));
  }
  async pullRequest(link: PullRequestLink, board: IssueBoard, root: string, signal: AbortSignal): Promise<PullRequestLink> {
    const current = pullRequestLink(link.url);
    const result = await this.githubRead(`repos/${current.repo}/pulls/${current.number}`, board.githubAccess, root, signal);
    if (!isRecord(result) || result.number !== current.number || result.html_url !== current.url || !["open", "closed"].includes(String(result.state)) ||
      typeof result.merged !== "boolean" || result.merged && (result.state !== "closed" || typeof result.merged_at !== "string" || !Number.isFinite(Date.parse(result.merged_at)))) {
      throw new MoguriError("issue_pr_response", "The response did not verify this exact PR's state. No phase was changed.");
    }
    return { ...current, state: result.merged ? "merged" : result.state === "closed" ? "closed" : "open", checkedAt: new Date().toISOString(), diagnostic: null };
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
        title: node.title.slice(0, 160), body: (node.description ?? "").slice(0, 64 * 1024),
        linear: { id: node.id, identifier: node.identifier, url: url.href, updatedAt: node.updatedAt },
      };
    });
    return { items, nextCursor: connection.pageInfo.hasNextPage ? String(connection.pageInfo.endCursor) : null };
  }
}
