import assert from "node:assert/strict";
import { githubApplicationFixture } from "../github-workflows-fixture.ts";
import type { IntegrationOptions } from "../../apps/service/src/project-integrations.ts";

export interface GeneratedGithubCard {
  number: number; title: string; body: string; state: "OPEN" | "CLOSED"; reason: "COMPLETED" | "NOT_PLANNED" | "DUPLICATE" | null;
  draft: boolean | null; updatedAt: string;
}
export async function githubBoardFixture(options: { refreshMs?: number; retentionKey?: Buffer } = {}) {
  const state: {
    cards: GeneratedGithubCard[]; viewerId: number; repositoryId: number; bigIdentifiers: boolean; responseOverride?: unknown;
    beforeRead?: (query: string, signal: AbortSignal) => Promise<void>;
  } = {
    cards: [{ number: 7, title: "Generated GitHub issue", body: "Generated remote body.", state: "OPEN", reason: null, draft: true, updatedAt: "2026-01-02T00:00:00Z" }],
    viewerId: 42, repositoryId: 41, bigIdentifiers: false,
  };
  const reads: Array<{ query: string; variables: Record<string, string | null> }> = [];
  const integrations: IntegrationOptions = {
    ...(options.refreshMs ? { prRefreshMs: options.refreshMs } : {}),
    githubGraphqlRead: async (query, variables, _root, signal) => {
      assert.ok(query.startsWith("query MoguriKanban")); assert.equal(/\bmutation\b/.test(query), false);
      reads.push({ query, variables: { ...variables } });
      await state.beforeRead?.(query, signal); signal.throwIfAborted();
      if (state.responseOverride !== undefined) return state.responseOverride;
      const repository = { databaseId: state.bigIdentifiers ? String(3_000_000_000 + state.repositoryId) : state.repositoryId, nameWithOwner: "generated-owner/fixture", url: "https://github.com/generated-owner/fixture" };
      const document = (card: GeneratedGithubCard) => ({
        id: `I_generated_${card.number}`, databaseId: state.bigIdentifiers ? String(3_000_000_000 + card.number) : card.number + 100, number: card.number, title: card.title, body: card.body,
        url: `${repository.url}/issues/${card.number}`, state: card.state, stateReason: card.reason, updatedAt: card.updatedAt,
        repository: { nameWithOwner: repository.nameWithOwner },
        closedByPullRequestsReferences: {
          nodes: card.draft === null ? [] : [{ number: card.number + 1000, url: `${repository.url}/pull/${card.number + 1000}`,
            state: "OPEN", isDraft: card.draft, mergedAt: null, repository: { nameWithOwner: repository.nameWithOwner } }],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      });
      const cards: Record<string, unknown> = {};
      for (const match of query.matchAll(/card(\d+):\s*issue\(number:\s*(\d+)\)/g)) {
        const card = state.cards.find((card) => card.number === Number(match[2]));
        cards[`card${match[1]}`] = card ? document(card) : null;
      }
      const match = variables.cursor?.match(/^generated-page-(\d+)$/);
      if (variables.cursor && !match) throw new Error("Generated cursor did not match its original collection.");
      const offset = match ? Number(match[1]) : 0, open = state.cards.filter((card) => card.state === "OPEN");
      return { data: { viewer: { login: "generated-owner", databaseId: state.viewerId }, repository: { ...repository, ...cards,
        ...(query.includes("issues(") ? { issues: { nodes: open.slice(offset, offset + 20).map(document),
          pageInfo: { hasNextPage: open.length > offset + 20, endCursor: open.length > offset + 20 ? `generated-page-${offset + 20}` : null } } } : {}) } } };
    },
  };
  const fixture = await githubApplicationFixture({ integrations, retentionKey: options.retentionKey });
  const configure = async (enabled: boolean, importIssues = true) => {
    const { board } = await fixture.sdk.issues.board(fixture.projectId);
    return fixture.sdk.issues.configure(fixture.projectId, { ...board, autoRefreshPrs: enabled, githubAccess: "gh-cli",
      githubSync: { importIssues, phases: { backlog: "backlog", inProgress: "in-progress", review: "review", done: "done" } } }, board.revision);
  };
  const refresh = async () => {
    const job = await fixture.sdk.issues.refresh(fixture.projectId);
    return fixture.sdk.jobs.wait(job.id!);
  };
  return { ...fixture, state, reads, integrations, configure, refresh };
}
