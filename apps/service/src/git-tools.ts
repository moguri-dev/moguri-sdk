import { MAX_TEXT, MoguriError, parse, GitReadSchema, GitWriteToolSchema, GithubReadToolSchema, type Session, type ModelAdviceSource } from "../../../packages/protocol/src/index.ts";
import type { GitHubWorkflows, GitToolAuthority } from "./github-workflows.ts";
import type { WorkspaceFinish } from "./session-workspace.ts";
import { setTimeout as delay } from "node:timers/promises";

const scope = (session: Session) => {
  if (!session.projectId || session.controls.env !== "Local" || session.repositories || session.status === "archived") throw new MoguriError("git_scope", "Built-in Git requires the exact active Local project/worktree. No controller, Home, captured-group, Remote or Sandbox fallback.", 403);
  return { env: "Local" as const, projectId: session.projectId, sessionId: session.id, ...(session.workspaceId ? { workspaceId: session.workspaceId } : {}) };
};
export class GitTools {
  constructor(private readonly github: GitHubWorkflows) {}
  async readGithub(session: Session, input: unknown, signal: AbortSignal) {
    const args = parse(GithubReadToolSchema, input), bound = scope(session);
    const project = await this.github.query({ type: "github.project", scope: bound }, signal);
    if (project.type !== "github.project") throw new MoguriError("github_tool_response", "The authoritative project query returned a different response. No repository or account was inferred.", 502);
    if (args.action === "browse" && (args.input.repository.toLowerCase() !== project.repository.toLowerCase() || args.input.account.toLowerCase() !== project.account.toLowerCase())) {
      throw new MoguriError("github_tool_scope", "Use only this exact project's discovered repository and account. No foreign source or different login was requested.", 409);
    }
    const result = args.action === "project" ? project : await this.github.query({ type: "github.browse", scope: bound, input: args.input }, signal);
    if (result.type !== "github.project" && result.type !== "github.browse") throw new MoguriError("github_tool_response", "The authoritative GitHub read returned a different response. No alternate result was adopted.", 502);
    if (result.accountId !== project.accountId) throw new MoguriError("github_account", "The discovered numeric GitHub account changed. No replacement result was adopted.", 409);
    const text = JSON.stringify(result);
    if (text.length > MAX_TEXT) throw new MoguriError("github_view_limit", "This complete GitHub page exceeds the model-tool limit. Request fewer items; no source was truncated.", 409);
    return { text, isError: false, outcome: "completed" };
  }
  async read(session: Session, input: unknown, signal: AbortSignal) {
    const result = await this.github.query({ type: "git.read", scope: scope(session), input: parse(GitReadSchema, input) }, signal);
    if (result.type !== "git.read") throw new MoguriError("git_response", "The original Git read returned another response type.");
    if ("text" in result.data) {
      const rawText = result.data.text;
      const text = JSON.stringify({ ...result, data: { ...result.data, text: rawText.slice(0, 12000), viewComplete: rawText.length <= 12000 } });
      if (text.length > MAX_TEXT) throw new MoguriError("git_view_limit", "Git metadata exceeds the complete model-tool view. Inspect it through the SDK; no output prefix or different source was substituted.", 409);
      return { text,
        rawText, rawComplete: true, isError: false, outcome: "completed" };
    }
    const text = JSON.stringify(result);
    if (text.length > MAX_TEXT) throw new MoguriError("git_view_limit", "This Git metadata page exceeds the complete tool view. Request a smaller log page or inspect it through the SDK; no records were silently dropped.", 409);
    return { text, isError: false, outcome: "completed" };
  }
  async write(session: Session, input: unknown, source: ModelAdviceSource, authority: GitToolAuthority, finish: WorkspaceFinish) {
    const args = parse(GitWriteToolSchema, input), bound = scope(session);
    authority.guard();
    if (args.action === "preview") {
      const review = await this.github.toolPreview(bound, args.input, authority);
      const text = JSON.stringify({ digest: review.digest, document: review.document,
        effect: "Review only. Execute these exact inputs/digest through a separate actual tool approval or current user delegation; preview is not permission." });
      if (text.length > MAX_TEXT) throw new MoguriError("git_review_limit", "The complete Git review exceeds the model-tool view. Select fewer exact paths or use the SDK review. No truncated review or write was admitted.", 409);
      return { text, isError: false, outcome: "completed" };
    }
    if (!args.expectedDigest || !args.confirmations) throw new MoguriError("git_review", "Preview this exact action first, then supply its original digest and confirmations. No effect was admitted.", 409);
    const admitted = await this.github.execute({ type: "github.execute", scope: bound, action: args.input, expectedDigest: args.expectedDigest,
      confirmations: args.confirmations, confirm: true }, finish, source, undefined, authority);
    if (!admitted.id) throw new MoguriError("git_intent", "The original Git intent was not acknowledged. No replacement was started.", 409);
    const operationId = admitted.id, deadline = Date.now() + 180_000;
    for (;;) {
      const read = await this.github.query({ type: "github.read", operationId });
      if (read.type !== "github.read") throw new MoguriError("git_result", "The original retained Git result changed response type.", 409);
      if (read.operation.status !== "running") {
        const rawText = JSON.stringify({ operationId, status: read.operation.status, result: read.result,
          diagnostic: read.operation.diagnostic, actor: read.operation.actor });
        return { text: rawText.length <= MAX_TEXT ? rawText : JSON.stringify({ operationId, status: read.operation.status,
          diagnostic: read.operation.diagnostic, actor: read.operation.actor, viewComplete: false,
          observation: "The complete original operation result is retained in this tool source. Page it before relying on omitted details." }),
          ...(rawText.length > MAX_TEXT ? { rawText, rawComplete: true } : {}),
          isError: read.operation.status !== "completed", outcome: read.operation.status === "cancelled" ? "stopped" : read.operation.status };
      }
      if (Date.now() >= deadline) return { text: JSON.stringify({ operationId, status: "running",
        diagnostic: "The original Git job still needs observation. Inspect it; no retry or successful outcome was inferred." }), isError: true, outcome: "partial" };
      await delay(25);
    }
  }
}
