import type { MoguriSdk } from "./index.ts";
import { ClientError } from "../../client/src/index.ts";
import type {
  GithubAction, GithubBrowse, GithubCommand, GithubPreview, GithubQuery, GithubScope, GithubWorkSource,
} from "../../protocol/src/github-workflows.ts";

type WithoutPage<T> = T extends unknown ? Omit<T, "page" | "perPage"> & { page?: number; perPage?: number } : never;
export type GithubBrowseRequest = WithoutPage<GithubBrowse>;
export function createGithubApi(sdk: MoguriSdk) {
  const preview = (scope: GithubScope, action: GithubAction) => sdk.query({ type: "github.preview", scope, action });
  const browse = (scope: GithubScope, input: GithubBrowseRequest) => sdk.query({
    type: "github.browse", scope, input: { ...input, page: input.page ?? 1, perPage: input.perPage ?? 30 },
  });
  const read = (operationId: string) => sdk.query({ type: "github.read", operationId });
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
