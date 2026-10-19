import { isRecord, MoguriError, type IssueBoard, type LocalIssue, type PullRequestLink } from "../../../packages/protocol/src/index.ts";
import { fetchJson } from "./network.ts";
import { runProgram } from "./program.ts";
import type { SecretVault } from "./gateway.ts";

export interface IntegrationOptions { fetch?: typeof fetch; vault?: SecretVault; prRefreshMs?: number }
export function pullRequestLink(input: string): PullRequestLink {
  let url: URL;
  try { url = new URL(input); } catch { throw new MoguriError("issue_pr", "Use a canonical https://github.com/OWNER/REPO/pull/NUMBER URL."); }
  const match = url.pathname.match(/^\/([A-Za-z0-9][A-Za-z0-9_.-]*)\/([A-Za-z0-9][A-Za-z0-9_.-]*)\/pull\/([1-9]\d*)\/?$/);
  if (url.protocol !== "https:" || url.host !== "github.com" || url.username || url.password || url.search || url.hash || !match || !Number.isSafeInteger(Number(match[3]))) throw new MoguriError("issue_pr", "Use a canonical github.com pull request URL, without credentials, query or fragment.");
  const repo = `${match[1]}/${match[2]}`;
  return { url: `https://github.com/${repo}/pull/${match[3]}`, repo, number: Number(match[3]), state: "unknown", checkedAt: null, diagnostic: null };
}
export class ProjectIntegrations {
  constructor(readonly vault: SecretVault, private readonly options: IntegrationOptions = {}) {}
  async pullRequest(link: PullRequestLink, board: IssueBoard, root: string, signal: AbortSignal): Promise<PullRequestLink> {
    const current = pullRequestLink(link.url);
    const endpoint = `repos/${current.repo}/pulls/${current.number}`;
    let result: unknown;
    if (board.githubAccess === "gh-cli") {
      const text = await runProgram("gh", ["api", "--hostname", "github.com", "--method", "GET", endpoint], {
        cwd: root, signal, timeoutMs: 15_000, maxBytes: 2 * 1024 * 1024, label: "Read linked GitHub pull request",
        env: { GH_PROMPT_DISABLED: "1", GH_NO_UPDATE_NOTIFIER: "1" },
      });
      try { result = JSON.parse(text); } catch { throw new MoguriError("issue_pr_response", "GitHub CLI returned invalid PR JSON. No phase was changed."); }
    } else {
      result = await fetchJson(this.options.fetch ?? fetch, `https://api.github.com/${endpoint}`, { headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" } }, AbortSignal.any([signal, AbortSignal.timeout(15_000)]));
    }
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
    const token = await this.vault.read("linear", AbortSignal.any([signal, AbortSignal.timeout(15_000)]));
    signal.throwIfAborted();
    if (!token) throw new MoguriError("linear_auth", "Store a Linear personal API key in the OS keychain. No ambient or plaintext credential fallback exists.", 401);
    const result = await fetchJson(this.options.fetch ?? fetch, "https://api.linear.app/graphql", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: token },
      body: JSON.stringify({
        query: "query MoguriTeamIssues($team: String!, $after: String) { team(id: $team) { id issues(first: 50, after: $after) { nodes { id identifier url title description updatedAt } pageInfo { hasNextPage endCursor } } } }",
        variables: { team: board.linear.teamId, after: cursor ?? null },
      }),
    }, AbortSignal.any([signal, AbortSignal.timeout(20_000)]));
    if (!isRecord(result) || result.errors !== undefined && (!Array.isArray(result.errors) || result.errors.length > 0) ||
      !isRecord(result.data) || !isRecord(result.data.team) || result.data.team.id !== board.linear.teamId || !isRecord(result.data.team.issues)) {
      throw new MoguriError("linear_response", "Linear returned missing, partial or rejected team data. Check team access and the API key; nothing was imported.", 502);
    }
    const connection = result.data.team.issues;
    if (!Array.isArray(connection.nodes) || connection.nodes.length > 50 || !isRecord(connection.pageInfo) || typeof connection.pageInfo.hasNextPage !== "boolean" ||
      connection.pageInfo.hasNextPage && (typeof connection.pageInfo.endCursor !== "string" || !connection.pageInfo.endCursor || connection.pageInfo.endCursor === cursor)) {
      throw new MoguriError("linear_response", "Linear returned invalid pagination. Nothing was imported.", 502);
    }
    const clean = (value: string) => value.split(token).join("[redacted]");
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
        title: clean(node.title).slice(0, 160), body: clean(node.description ?? "").slice(0, 64 * 1024),
        linear: { id: clean(node.id), identifier: clean(node.identifier), url: clean(url.href), updatedAt: node.updatedAt },
      };
    });
    return { items, nextCursor: connection.pageInfo.hasNextPage ? String(connection.pageInfo.endCursor) : null };
  }
}
