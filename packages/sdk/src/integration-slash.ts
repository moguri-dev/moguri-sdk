import { ClientError } from "../../client/src/index.ts";
import {
  GitActionSchema, RepositoryRemoteActionSchema, GithubActionSchema, GithubBrowseSchema, GithubCommandSchema, LinearCatalogResourceSchema, LinearWorkflowInputSchema,
  isRecord, parse, type GithubScope, type GithubWorkSource, type Session,
} from "../../protocol/src/index.ts";
import type { MoguriSdk } from "./index.ts";
import type { SlashResult } from "./slash.ts";
import { gitSessionScope } from "./git.ts";

const result = (value: unknown): SlashResult => ({ kind: "text", text: JSON.stringify(value, null, 2) });
function object(text: string) {
  const value: unknown = JSON.parse(text);
  if (!isRecord(value)) throw new ClientError("integration_input", "Use one complete JSON object. No operation was admitted.");
  return value;
}
export async function integrationSlash(sdk: MoguriSdk, session: Session, name: "git" | "github" | "linear", argument: string, client: "desktop" | "tui" | "cli" = "cli"): Promise<SlashResult> {
  const match = argument.trim().match(/^(\S+)(?:\s+([\s\S]*))?$/), action = match?.[1] ?? "history", tail = match?.[2] ?? "";
  if (name === "git") {
    if (action === "remote-preview") {
      const input = object(tail), remote = parse(RepositoryRemoteActionSchema, { kind: "git.remote.set", ...input });
      return result(await sdk.github.preview(gitSessionScope(sdk, session.id), remote));
    }
    if (action === "remote-set" && tail.startsWith("confirm-write ")) {
      const input = object(tail.slice("confirm-write ".length));
      if (["type", "scope", "confirm"].some((key) => key in input)) throw new ClientError("git_input", "Use the original remote action, digest and confirmations; the actual selected Local session owns this review.");
      parse(RepositoryRemoteActionSchema, input.action);
      return result(await sdk.command(parse(GithubCommandSchema, { ...input, type: "github.execute", scope: gitSessionScope(sdk, session.id), confirm: true })));
    }
    if (action === "history" && !tail) return result(await sdk.git.history({ ...(session.projectId ? { projectId: session.projectId } : {}) }));
    if (action === "read" && tail) return result(await sdk.git.operation(tail));
    if (action === "wait" && tail) return result(await sdk.git.wait(tail));
    if (action === "stop" && tail.endsWith(" confirm-stop")) return result(await sdk.git.cancel(tail.slice(0, -" confirm-stop".length)));
    if (action === "status" && !tail) return result(await sdk.git.status(session.id));
    if (action === "branches" && !tail) return result(await sdk.git.branches(session.id));
    if (action === "log" && !tail) return result(await sdk.git.log(session.id));
    if (action === "show" && /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(tail)) return result(await sdk.git.show(session.id, tail));
    if (action === "diff" && (!tail || tail === "staged")) return result(await sdk.git.diff(session.id, tail === "staged"));
    if (action === "preview") return result(await sdk.git.preview(session.id, parse(GitActionSchema, JSON.parse(tail))));
    if (action === "execute" && tail.startsWith("confirm-write ")) {
      const input = object(tail.slice("confirm-write ".length));
      if (["type", "scope", "confirm"].some((key) => key in input)) throw new ClientError("git_input", "Supply action, original expectedDigest and exact confirmations only. This selected session owns the immutable root.");
      parse(GitActionSchema, input.action);
      return result(await sdk.command(parse(GithubCommandSchema, { ...input, type: "github.execute", scope: gitSessionScope(sdk, session.id), confirm: true })));
    }
    throw new ClientError("git_command", 'Use /git status, branches, log, show COMMIT_SHA, diff [staged], preview ACTION_JSON, execute confirm-write {action,expectedDigest,confirmations}, remote-preview {"remote":"origin","url":"URL"}, remote-set confirm-write {action,expectedDigest,confirmations}, history, read/wait ID or stop ID confirm-stop. Rollback is git.revert for the exact current commit, never reset.');
  }
  if (name === "github") {
    if (action === "repos") {
      const query = tail.startsWith("public ") ? tail.slice(7) : tail, repositories = await sdk.github.repositories({ source: tail.startsWith("public ") ? "public" : "account", query });
      return client === "tui" ? { kind: "github-view", view: { kind: "repositories", query, result: repositories } } : result(repositories);
    }
    if (action === "history" && !tail) return result(await sdk.github.history({ ...(session.projectId ? { projectId: session.projectId } : {}) }));
    if (action === "read" && tail) return result(await sdk.github.read(tail));
    if (action === "wait" && tail) return result(await sdk.github.wait(tail));
    if (action === "stop" && tail.endsWith(" confirm-stop")) return result(await sdk.github.cancel(tail.slice(0, -" confirm-stop".length)));
    const inspection = tail.match(/^(\S+)\s+(\d+)\s+([a-f0-9]{64})\s+confirm-inspected$/);
    if (action === "acknowledge" && inspection) return result(await sdk.github.acknowledge(inspection[1]!, Number(inspection[2]), inspection[3]!, true));
    if (!session.projectId || session.controls.env !== "Local") throw new ClientError("github_scope", "This operation needs the actual Local project/worktree. Remote/Sandbox cannot borrow a Local source checkout. Independently retained reads/history remain available.");
    const scope: GithubScope = { env: "Local", projectId: session.projectId, sessionId: session.id, ...(session.workspaceId ? { workspaceId: session.workspaceId } : {}) };
    if (action === "project" && !tail) return result(await sdk.github.project(scope));
    if ((action === "issues" || action === "pulls") && !tail) {
      const project = await sdk.github.project(scope);
      const items = await sdk.github.browse(scope, { resource: action, repository: project.repository, account: project.account });
      if (items.accountId !== project.accountId) throw new ClientError("github_account", "The captured GitHub account changed. No replacement picker was opened.");
      return client === "tui" ? { kind: "github-view", view: { kind: "items", scope, context: project, resource: action === "pulls" ? "pull" : "issue",
        items: items.items, nextPage: items.nextPage } } : result(items);
    }
    if (action === "source" || action === "start") {
      const [kind, number, hash, extra] = tail.split(/\s+/);
      if ((kind !== "issue" && kind !== "pull") || !number || !/^[1-9]\d*$/.test(number) || !Number.isSafeInteger(Number(number)) ||
        extra || action === "source" && hash || action === "start" && (!hash || !/^[a-f0-9]{64}$/.test(hash))) {
        throw new ClientError("github_source", "Use /github source issue|pull NUMBER to review the full source, then /github start issue|pull NUMBER SHA using that exact digest.");
      }
      const project = await sdk.github.project(scope), source: GithubWorkSource = { kind, number: Number(number), repository: project.repository, account: project.account, accountId: project.accountId };
      if (action === "source") return result(await sdk.github.source(scope, source));
      const started = await sdk.github.startSession(scope, source, hash!);
      return { kind: "session", sessionId: started.id!, side: false };
    }
    if (action === "preview") return result(await sdk.github.preview(scope, parse(GithubActionSchema, JSON.parse(tail))));
    if (action === "browse") {
      const input = object(tail);
      return result(await sdk.github.browse(scope, parse(GithubBrowseSchema, { ...input, page: input.page === undefined ? 1 : input.page, perPage: input.perPage === undefined ? 30 : input.perPage })));
    }
    if (action === "execute" && tail.startsWith("confirm-write ")) {
      const input = object(tail.slice("confirm-write ".length));
      if (["type", "scope", "confirm"].some((key) => key in input)) throw new ClientError("github_input", "Supply only action, expectedDigest and the exact preview confirmations. This selected session owns the immutable scope; confirm-write is explicit user intent.");
      return result(await sdk.command(parse(GithubCommandSchema, { ...input, type: "github.execute", scope, confirm: true })));
    }
    throw new ClientError("github_command", "Use /github browse REQUEST_JSON, preview ACTION_JSON, execute confirm-write {action,expectedDigest,confirmations}, history, read/wait ID, stop ID confirm-stop, or acknowledge ID REV INPUT_SHA confirm-inspected. Inspection never proves cleanup or turns partial work successful.");
  }
  if (action === "read" && tail) return result(await sdk.linear.read(tail));
  if (action === "wait" && tail) return result(await sdk.linear.wait(tail));
  if (action === "stop" && tail.endsWith(" confirm-stop")) return result(await sdk.linear.cancel(tail.slice(0, -" confirm-stop".length)));
  if (action === "history" && !tail) return result(await sdk.linear.history(session.projectId ?? undefined));
  if (!session.projectId) throw new ClientError("project_required", "Choose an actual project with an explicitly enabled Linear team. No previous project/account was reused.");
  if (action === "status" && !tail) return result(await sdk.linear.status(session.projectId));
  if (action === "import") return result(await sdk.linear.import(session.projectId, tail || undefined));
  if (action === "clear-token" && !tail) return result(await sdk.linear.clearToken());
  if (action === "issue" && tail) return result(await sdk.linear.issue(session.projectId, tail));
  if (action === "catalog") {
    const input = object(tail);
    if (Object.keys(input).some((key) => !["resource", "issueId", "cursor"].includes(key)) ||
      input.issueId !== undefined && typeof input.issueId !== "string" || input.cursor !== undefined && typeof input.cursor !== "string") throw new ClientError("linear_input", "Catalog JSON supports only resource, optional exact issueId and optional cursor.");
    return result(await sdk.linear.catalog(session.projectId, parse(LinearCatalogResourceSchema, input.resource), {
      ...(typeof input.issueId === "string" ? { issueId: input.issueId } : {}), ...(typeof input.cursor === "string" ? { cursor: input.cursor } : {}),
    }));
  }
  const scope = { projectId: session.projectId, sessionId: session.id };
  if (action === "preview") return result(await sdk.linear.preview(scope, parse(LinearWorkflowInputSchema, JSON.parse(tail))));
  const execute = tail.match(/^([a-f0-9]{64})\s+confirm-write\s+([\s\S]+)$/);
  if (action === "execute" && execute) return result(await sdk.linear.execute(scope, parse(LinearWorkflowInputSchema, JSON.parse(execute[2]!)), execute[1]!, true));
  throw new ClientError("linear_command", "Use /linear status, import [CURSOR], catalog {resource,issueId?,cursor?}, issue UUID, preview INPUT_JSON, execute SHA confirm-write INPUT_JSON, history, read/wait ID, or stop ID confirm-stop. Credentials need the dedicated masked/keychain path, never a prompt.");
}
