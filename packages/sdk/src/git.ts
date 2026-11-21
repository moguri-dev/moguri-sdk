import { ClientError } from "../../client/src/index.ts";
import { GitActionSchema, parse, type GitAction, type GitRead, type GithubPreview, type GithubScope } from "../../protocol/src/index.ts";
import type { MoguriSdk } from "./index.ts";

export function gitSessionScope(sdk: MoguriSdk, sessionId: string): GithubScope {
  const session = sdk.getState().snapshot?.sessions.find((session) => session.id === sessionId);
  if (!session?.projectId || session.controls.env !== "Local" || session.repositories) throw new ClientError("git_scope", "Built-in reviewed Git requires this exact Local project/worktree. Remote host, Sandbox, captured groups and Home cannot borrow a controller checkout.");
  return { env: "Local", projectId: session.projectId, sessionId, ...(session.workspaceId ? { workspaceId: session.workspaceId } : {}) };
}
export function createGitApi(sdk: MoguriSdk) {
  const read = (sessionId: string, input: GitRead, signal?: AbortSignal) => sdk.query({ type: "git.read", scope: gitSessionScope(sdk, sessionId), input }, signal);
  return {
    read,
    status: (sessionId: string, signal?: AbortSignal) => read(sessionId, { action: "status" }, signal),
    branches: (sessionId: string, signal?: AbortSignal) => read(sessionId, { action: "branches" }, signal),
    log: (sessionId: string, options: Omit<Extract<GitRead, { action: "log" }>, "action"> = {}, signal?: AbortSignal) => read(sessionId, { action: "log", ...options }, signal),
    show: (sessionId: string, commit: string, signal?: AbortSignal) => read(sessionId, { action: "show", commit }, signal),
    diff: (sessionId: string, staged = false, path?: string, signal?: AbortSignal) => read(sessionId, { action: "diff", staged, ...(path ? { path } : {}) }, signal),
    preview: (sessionId: string, action: GitAction) => sdk.github.preview(gitSessionScope(sdk, sessionId), action),
    execute: (review: GithubPreview, confirmations: string[], confirm: true, commandId?: string) => {
      parse(GitActionSchema, review.document.action);
      return sdk.github.execute(review, confirmations, confirm, commandId);
    },
    operation: sdk.github.read,
    wait: sdk.github.wait,
    cancel: sdk.github.cancel,
    history: sdk.github.history,
  };
}
