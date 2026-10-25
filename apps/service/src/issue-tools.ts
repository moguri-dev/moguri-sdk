import { MoguriError, parse, type Session, type ModelAdviceSource } from "../../../packages/protocol/src/index.ts";
import { CreateIssueSchema } from "../../../packages/protocol/src/tooling.ts";
import type { GitHubWorkflows } from "./github-workflows.ts";
import type { LinearWorkflows } from "./linear-workflows.ts";
import type { WorkspaceFinish } from "./session-workspace.ts";

export class IssueTools {
  constructor(private readonly github: GitHubWorkflows, private readonly linear: LinearWorkflows) {}
  async execute(session: Session, input: unknown, source: ModelAdviceSource, signal: AbortSignal, finish: WorkspaceFinish) {
    const args = parse(CreateIssueSchema, input);
    if (session.controls.env !== "Local" || !session.projectId || session.mode !== "agent" || session.pendingMode === "read-only") throw new MoguriError("issue_scope", "Issue writes use the actual reviewed Local project/account pipeline. Side/Remote/Sandbox never fall back.", 403);
    if (args.service === "github") {
      const scope = { env: "Local" as const, projectId: session.projectId, sessionId: session.id, ...(session.workspaceId ? { workspaceId: session.workspaceId } : {}) };
      if (args.action === "preview") {
        const review = await this.github.query({ type: "github.preview", scope, action: args.input });
        if (review.type !== "github.preview") throw new MoguriError("issue_review", "The GitHub review response changed type.");
        return { text: JSON.stringify({ service: "github", digest: review.preview.digest, root: review.preview.document.root,
          repository: args.input.repository, account: args.input.account, confirmations: review.preview.document.confirmations, warnings: review.preview.document.warnings,
          effect: "Preview only. Create with these exact inputs/digest through its separate tool approval or existing delegation." }), isError: false, outcome: "completed" };
      }
      if (!args.expectedDigest) throw new MoguriError("issue_review", "Preview the exact issue inputs and account before requesting creation.");
      const admitted = await this.github.execute({ type: "github.execute", scope, action: args.input, expectedDigest: args.expectedDigest,
        confirmations: args.confirmations ?? [], confirm: true }, finish, source);
      if (!admitted.id) throw new MoguriError("issue_intent", "The original issue intent was not acknowledged.");
      const deadline = Date.now() + 60000;
      for (;;) {
        signal.throwIfAborted();
        const read = await this.github.query({ type: "github.read", operationId: admitted.id });
        if (read.type !== "github.read") throw new MoguriError("issue_result", "The original issue report changed response type.");
        if (read.operation.status !== "running") return { text: JSON.stringify({ operationId: read.operation.id, status: read.operation.status,
          url: read.result?.resource?.url ?? null, diagnostic: read.operation.diagnostic, actor: read.operation.actor }),
          isError: read.operation.status !== "completed", outcome: read.operation.status === "cancelled" ? "stopped" : read.operation.status };
        if (Date.now() >= deadline) return { text: JSON.stringify({ operationId: admitted.id, status: "running", diagnostic: "The original operation is still running. Inspect it; no retry or successful creation was inferred." }), isError: true, outcome: "partial" };
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    if (args.action === "preview") {
      const review = await this.linear.query({ type: "linear.workflow.preview", projectId: session.projectId, sessionId: session.id, input: args.input });
      if (review.type !== "linear.workflow.preview") throw new MoguriError("issue_review", "The Linear review response changed type.");
      return { text: JSON.stringify({ service: "linear", digest: review.preview.digest, root: review.preview.document.binding.root,
        teamId: review.preview.document.team.id, workspaceId: review.preview.document.identity.workspaceId, effect: "Preview only; no API mutation. Actual credentials, team/account and input remain bound by the existing workflow." }), isError: false, outcome: "completed" };
    }
    if (!args.expectedDigest) throw new MoguriError("issue_review", "Preview the exact issue input/team before requesting creation.");
    const admitted = await this.linear.execute({ type: "linear.workflow.execute", projectId: session.projectId, sessionId: session.id, input: args.input,
      expectedDigest: args.expectedDigest, confirm: true }, finish, source);
    if (!admitted.id) throw new MoguriError("issue_intent", "The original Linear issue intent was not acknowledged.");
    const deadline = Date.now() + 60000;
    for (;;) {
      signal.throwIfAborted();
      const read = await this.linear.query({ type: "linear.workflow.read", operationId: admitted.id });
      if (read.type !== "linear.workflow.read") throw new MoguriError("issue_result", "The original Linear issue report changed response type.");
      if (read.operation.status !== "running") return { text: JSON.stringify({ operationId: read.operation.id, status: read.operation.status,
        urls: read.result?.remote.filter((entity) => entity.kind === "issue").map((entity) => entity.url) ?? [], diagnostic: read.operation.diagnostic, origin: "model" }),
        isError: read.operation.status !== "completed", outcome: read.operation.status === "cancelled" ? "stopped" : read.operation.status };
      if (Date.now() >= deadline) return { text: JSON.stringify({ operationId: admitted.id, status: "running", diagnostic: "The original mutation still needs observation; no second API request or success was inferred." }), isError: true, outcome: "partial" };
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}
