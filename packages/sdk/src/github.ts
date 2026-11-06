import type { MoguriSdk } from "./index.ts";
import { ClientError } from "../../client/src/index.ts";
import { githubItemIdentity } from "../../protocol/src/github-workflows.ts";
import { sessionPullRequestUrls } from "../../protocol/src/session-status.ts";
import { gitSessionScope } from "./git.ts";
import type {
  GithubAction, GithubBrowse, GithubCommand, GithubPreview, GithubPullSource, GithubQuery, GithubScope, GithubSourceBinding, GithubWorkSource,
} from "../../protocol/src/github-workflows.ts";

type WithoutPage<T> = T extends unknown ? Omit<T, "page" | "perPage"> & { page?: number; perPage?: number } : never;
export type GithubBrowseRequest = WithoutPage<GithubBrowse>;
export function createGithubApi(sdk: MoguriSdk) {
  const sessionCiSource = async (sessionId: string, number?: number) => {
    const scope = gitSessionScope(sdk, sessionId), project = await sdk.query({ type: "github.project", scope });
    const snapshot = sdk.getState().snapshot, session = snapshot?.sessions.find((session) => session.id === sessionId);
    if (!snapshot || !session || JSON.stringify(gitSessionScope(sdk, sessionId)) !== JSON.stringify(scope)) {
      throw new ClientError("github_ci_scope", "The selected CI session/root changed during source discovery. No replacement session was used.");
    }
    if (number === undefined) {
      const urls = sessionPullRequestUrls(session, snapshot);
      if (urls.length !== 1) throw new ClientError("github_ci_selection", "Choose an explicit PR number when there is no unique linked PR. No first PR or remembered head was guessed.");
      const selected = githubItemIdentity(urls[0]!);
      if (selected.kind !== "pull" || selected.repository.toLowerCase() !== project.repository.toLowerCase()) {
        throw new ClientError("github_ci_selection", "The linked PR does not belong to this exact project repository. No alternate source was adopted.");
      }
      number = selected.number;
    }
    if (!Number.isSafeInteger(number) || number < 1) throw new ClientError("github_ci_selection", "Select one actual positive PR number.");
    const source: GithubPullSource = { kind: "pull", repository: project.repository, account: project.account, accountId: project.accountId, number };
    return { scope, source, binding: project.binding };
  };
  const preview = (scope: GithubScope, action: GithubAction) => sdk.query({ type: "github.preview", scope, action });
  const browse = (scope: GithubScope, input: GithubBrowseRequest) => sdk.query({
    type: "github.browse", scope, input: { ...input, page: input.page ?? 1, perPage: input.perPage ?? 30 },
  });
  const read = (operationId: string, signal?: AbortSignal) => sdk.query({ type: "github.read", operationId }, signal);
  const execute = (review: GithubPreview, confirmations: string[], confirm: true, commandId?: string) => {
    const command: GithubCommand = { type: "github.execute", scope: review.document.scope, action: review.document.action,
      expectedDigest: review.digest, confirmations, confirm };
    return sdk.command(command, commandId);
  };
  return {
    preview, browse, read, execute,
    repositories: (input: { source?: "account" | "public"; query?: string; account?: string; accountId?: string; page?: number; perPage?: number } = {}) =>
      sdk.query({ type: "github.repositories", source: input.source ?? "account", query: input.query ?? "", page: input.page ?? 1,
        perPage: input.perPage ?? 30, ...(input.account ? { account: input.account } : {}), ...(input.accountId ? { accountId: input.accountId } : {}) }),
    project: (scope: GithubScope) => sdk.query({ type: "github.project", scope }),
    source: (scope: GithubScope, source: GithubWorkSource) => sdk.query({ type: "github.source", scope, source }),
    ci: (scope: GithubScope, source: GithubPullSource, signal?: AbortSignal, binding?: GithubSourceBinding) =>
      sdk.query({ type: "github.ci", scope, source, ...(binding ? { binding } : {}) }, signal),
    ciForSession: async (sessionId: string, number?: number) => {
      const current = await sessionCiSource(sessionId, number);
      return sdk.github.ci(current.scope, current.source, undefined, current.binding);
    },
    previewCiForSession: async (sessionId: string, number?: number) => {
      const current = await sessionCiSource(sessionId, number);
      return sdk.github.previewCi(current.scope, current.source, { binding: current.binding });
    },
    previewCi: async (scope: GithubScope, source: GithubPullSource, options: { headSha?: string; timeoutMs?: number; pollMs?: number; signal?: AbortSignal; binding?: GithubSourceBinding } = {}) => {
      const current = await sdk.query({ type: "github.ci", scope, source, ...(options.binding ? { binding: options.binding } : {}) }, options.signal);
      if (current.item.state !== "open" || !current.item.headSha || options.headSha && current.item.headSha !== options.headSha) {
        throw new ClientError("github_ci_head", "The selected PR is closed or its exact head changed. Reload and review that PR; no different head was adopted.");
      }
      return (await sdk.query({ type: "github.preview", scope, action: { kind: "github.ci.watch",
        repository: current.source.repository, account: current.source.account, accountId: current.accountId, prNumber: source.number,
        headSha: current.item.headSha, timeoutMs: options.timeoutMs ?? 120000, pollMs: options.pollMs ?? 2000 } }, options.signal)).preview;
    },
    startSession: (scope: GithubScope, source: GithubWorkSource, expectedDigest: string) =>
      sdk.command({ type: "session.from-work", projectId: scope.projectId, ...(scope.workspaceId ? { workspaceId: scope.workspaceId } : {}),
        github: { ...source, expectedDigest } }),
    acknowledge: (operationId: string, expectedRevision: number, expectedInputDigest: string, confirm: true, commandId?: string) =>
      sdk.command({ type: "github.acknowledge", operationId, expectedRevision, expectedInputDigest, confirm }, commandId),
    history: (filters: Omit<Extract<GithubQuery, { type: "github.history" }>, "type" | "offset" | "limit"> & { offset?: number; limit?: number } = {}) =>
      sdk.query({ type: "github.history", ...filters, offset: filters.offset ?? 0, limit: filters.limit ?? 30 }),
    list: (projectId?: string) => [...(sdk.getState().snapshot?.githubOperations ?? [])]
      .filter((operation) => !projectId || operation.projectId === projectId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    issues: (scope: GithubScope, repository: string, account: string, page = 1, perPage = 30) => browse(scope, { resource: "issues", repository, account, page, perPage }),
    pulls: (scope: GithubScope, repository: string, account: string, page = 1, perPage = 30) => browse(scope, { resource: "pulls", repository, account, page, perPage }),
    reviews: (scope: GithubScope, repository: string, account: string, number: number, page = 1, perPage = 30) => browse(scope, { resource: "reviews", repository, account, number, page, perPage }),
    threads: (scope: GithubScope, repository: string, account: string, number: number, page = 1, perPage = 30) => browse(scope, { resource: "threads", repository, account, number, page, perPage }),
    files: (scope: GithubScope, repository: string, account: string, number: number, headSha: string, page = 1, perPage = 30) => browse(scope, { resource: "files", repository, account, number, headSha, page, perPage }),
    jobs: (scope: GithubScope, repository: string, account: string, runId: number, headSha: string, page = 1, perPage = 30) => browse(scope, { resource: "jobs", repository, account, runId, headSha, page, perPage }),
    comments: (scope: GithubScope, repository: string, account: string, number: number, reviewComments = false, page = 1, perPage = 30) =>
      browse(scope, { resource: reviewComments ? "review-comments" : "comments", repository, account, number, page, perPage }),
    checks: (scope: GithubScope, repository: string, account: string, headSha: string, page = 1, perPage = 30) => browse(scope, { resource: "checks", repository, account, headSha, page, perPage }),
    runs: (scope: GithubScope, repository: string, account: string, headSha?: string, page = 1, perPage = 30) => browse(scope, { resource: "runs", repository, account, ...(headSha ? { headSha } : {}), page, perPage }),
    logs: (scope: GithubScope, repository: string, account: string, runId: number) => browse(scope, { resource: "logs", repository, account, runId }),
    releases: (scope: GithubScope, repository: string, account: string, page = 1, perPage = 30) => browse(scope, { resource: "releases", repository, account, page, perPage }),
    cancel: async (operationId: string) => sdk.command({ type: "job.cancel", jobId: (await read(operationId)).operation.jobId }),
    wait: async (operationId: string, options: { signal?: AbortSignal; timeoutMs?: number; pollMs?: number } = {}) => {
      const deadline = Date.now() + (options.timeoutMs ?? 30_000);
      for (;;) {
        options.signal?.throwIfAborted();
        await sdk.refresh();
        const value = await read(operationId);
        if (value.operation.status !== "running") return value;
        if (Date.now() >= deadline) throw new ClientError("github_wait_timeout", "The original Git/GitHub operation is still running. It was not cancelled or replayed; inspect its retained history.");
        await new Promise<void>((resolve, reject) => {
          const finish = () => { options.signal?.removeEventListener("abort", abort); resolve(); };
          const timer = setTimeout(finish, Math.min(options.pollMs ?? 100, deadline - Date.now()));
          const abort = () => { clearTimeout(timer); options.signal?.removeEventListener("abort", abort); reject(options.signal?.reason ?? new DOMException("Cancelled", "AbortError")); };
          options.signal?.addEventListener("abort", abort, { once: true });
          if (options.signal?.aborted) abort();
        });
      }
    },
  };
}
export type GithubApi = ReturnType<typeof createGithubApi>;
