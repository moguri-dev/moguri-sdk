import assert from "node:assert/strict";
import { test } from "node:test";
import { MoguriSdk, defaultBoard, type BoardConfig, type IssueInput } from "../packages/sdk/src/index.ts";
import { setupFixture, waitFor } from "./fixture.ts";
import type { SecretVault } from "../apps/service/src/gateway.ts";

const fields = (title = "Generated local ticket"): IssueInput => ({ title, body: "Generated issue description.", kind: "feature", phaseId: "backlog", pullRequestUrl: null });
async function manualBoard(sdk: MoguriSdk, projectId: string, change?: (board: BoardConfig) => void) {
  const { board } = await sdk.issues.board(projectId);
  board.autoRefreshPrs = false; change?.(board);
  const { projectId: _, revision, ...config } = board;
  await sdk.issues.configure(projectId, config, revision);
}
test("local project boards share feature/bug/misc tickets and reject conflicting edits or occupied-phase deletion", async () => {
  const fixture = await setupFixture();
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  const other = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const projectId = fixture.session().projectId;
    const feature = await sdk.issues.create(projectId, fields());
    await sdk.issues.create(projectId, { ...fields("Generated bug"), kind: "bug" });
    await sdk.issues.create(projectId, { ...fields("Generated maintenance"), kind: "misc" });
    await waitFor(() => other.getState().snapshot?.issues.length === 3);
    assert.deepEqual(other.getState().snapshot?.issues.map((issue) => issue.number), [1, 2, 3]);
    await sdk.issues.move(feature.id!, "in-progress", 0);
    await assert.rejects(() => other.issues.update(feature.id!, fields("Generated stale edit"), 0), /Another client/);
    const { board } = await sdk.issues.board(projectId);
    await assert.rejects(() => sdk.issues.configure(projectId, { ...board, columns: board.columns.filter((column) => column.id !== "in-progress") }, board.revision), /occupied phase/);
    await sdk.issues.archive(feature.id!, true, 1);
    const archived = (await sdk.issues.board(projectId)).issues.find((issue) => issue.id === feature.id)!;
    assert.equal(archived.archived, true);
    assert.equal(fixture.requests.length, 0);
    await assert.rejects(() => sdk.issues.board("generated-other-project"), /outside this profile/);
  } finally { sdk.disconnect(); other.disconnect(); await fixture.close(); }
});

test("only a verified merged PR advances a customizable phase and stale observations preserve concurrent edits", async () => {
  let merged = false; let state = "closed"; let hold: (() => void) | undefined; let started = false;
  const fixture = await setupFixture({ platform: { integrations: { fetch: async (url) => {
    assert.equal(url, "https://api.github.com/repos/generated/project/pulls/7");
    if (hold) { started = true; await new Promise<void>((resolve) => { hold = resolve; }); }
    return Response.json({ number: 7, html_url: "https://github.com/generated/project/pull/7", state, draft: false, merged, merged_at: merged ? "2026-01-01T00:00:00Z" : null });
  } } } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const projectId = fixture.session().projectId;
    await manualBoard(sdk, projectId, (board) => { board.columns.push({ id: "shipped", name: "Shipped" }); board.mergedColumnId = "shipped"; });
    const created = await sdk.issues.create(projectId, { ...fields(), pullRequestUrl: "https://github.com/generated/project/pull/7" });
    let job = await sdk.issues.refresh(projectId);
    assert.equal((await sdk.jobs.wait(job.id!)).status, "completed");
    let issue = sdk.getState().snapshot!.issues.find((issue) => issue.id === created.id)!;
    assert.equal(issue.pullRequest?.state, "closed");
    assert.equal(issue.phaseId, "backlog");
    merged = true; hold = () => {}; job = await sdk.issues.refresh(projectId);
    await waitFor(() => started);
    await sdk.issues.update(issue.id, { ...fields("Generated concurrent local edit"), pullRequestUrl: issue.pullRequest!.url }, issue.revision);
    hold!();
    assert.equal((await sdk.jobs.wait(job.id!)).status, "completed");
    issue = sdk.getState().snapshot!.issues.find((issue) => issue.id === created.id)!;
    assert.equal(issue.title, "Generated concurrent local edit");
    assert.equal(issue.phaseId, "backlog");
    hold = undefined;
    job = await sdk.issues.refresh(projectId);
    assert.equal((await sdk.jobs.wait(job.id!)).status, "completed");
    issue = sdk.getState().snapshot!.issues.find((issue) => issue.id === created.id)!;
    assert.equal(issue.phaseId, "shipped");
    assert.equal(issue.pullRequest?.state, "merged");
    assert.ok(fixture.service.controller.events(0).some((event) => event.event_type === "issue.saved" && event.payload.actor === "github"));
    state = "open"; merged = false;
    const immutable = fixture.service.controller.events(0).find((event) => event.event_type === "issue.saved")!;
    assert.equal(immutable.event_type === "issue.saved" && immutable.payload.issue.phaseId, "backlog");
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("linking a PR authorizes automatic read-only merge observation, not merge actions or provider calls", async () => {
  let reads = 0;
  const fixture = await setupFixture({ platform: { integrations: { fetch: async (_, init) => {
    assert.equal(init?.method ?? "GET", "GET"); reads++;
    return Response.json({ number: 3, html_url: "https://github.com/generated/project/pull/3", state: "closed", draft: false, merged: true, merged_at: "2026-01-01T00:00:00Z" });
  } } } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const created = await sdk.issues.create(fixture.session().projectId, { ...fields(), pullRequestUrl: "https://github.com/generated/project/pull/3" });
    await waitFor(() => fixture.service.controller.snapshot().issues.find((issue) => issue.id === created.id)?.phaseId === "done");
    assert.equal(reads, 1); assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});

class FixtureVault implements SecretVault {
  value: string | null = null;
  async read() { return this.value; }
  async write(_: string, value: string) { this.value = value; }
  async remove() { this.value = null; }
}
test("optional Linear imports are keychain-only, bounded, provenance-preserving and never export local tickets", async () => {
  const vault = new FixtureVault();
  let calls = 0; let partial = false;
  const fixture = await setupFixture({ platform: { integrations: { vault, fetch: async (url, init) => {
    calls++; assert.equal(url, "https://api.linear.app/graphql");
    assert.ok(init?.body && !String(init.body).includes("mutation"));
    assert.equal((init?.headers as Record<string, string>).Authorization, "generated-linear-secret");
    return Response.json({ ...(partial ? { errors: [{ message: "Generated partial GraphQL failure" }] } : {}),
      data: { team: { id: "generated-team", issues: { nodes: [{ id: "generated-linear-issue", identifier: "GEN-7", title: "Generated remote ticket", description: "Generated only.", url: "https://linear.app/generated/issue/GEN-7", updatedAt: "2026-01-01T00:00:00Z" }], pageInfo: { hasNextPage: false, endCursor: null } } } } });
  } } } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const projectId = fixture.session().projectId;
    await assert.rejects(() => sdk.linear.import(projectId), /off by default/);
    assert.equal(calls, 0);
    await manualBoard(sdk, projectId, (board) => { board.linear = { enabled: true, teamId: "generated-team" }; });
    await sdk.linear.setToken("generated-linear-secret");
    let job = await sdk.linear.import(projectId);
    assert.equal((await sdk.jobs.wait(job.id!)).status, "completed");
    const imported = sdk.getState().snapshot!.issues[0]!;
    assert.equal(imported.linear?.identifier, "GEN-7");
    await sdk.issues.update(imported.id, { ...fields("Generated local edit wins"), kind: "bug" }, imported.revision);
    job = await sdk.linear.import(projectId);
    assert.equal((await sdk.jobs.wait(job.id!)).status, "completed");
    assert.equal(sdk.getState().snapshot!.issues.length, 1);
    assert.equal(sdk.getState().snapshot!.issues[0]!.title, "Generated local edit wins");
    partial = true; job = await sdk.linear.import(projectId);
    assert.equal((await sdk.jobs.wait(job.id!)).status, "failed");
    assert.equal(JSON.stringify(fixture.service.controller.events(0)).includes("generated-linear-secret"), false);
    assert.equal(defaultBoard(projectId).linear.enabled, false);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("missing PR access cannot look merged, and disabling Linear cancels a pending page before import", async () => {
  const vault = new FixtureVault();
  let importing = false; let aborted = false;
  const fixture = await setupFixture({ platform: { integrations: { vault, fetch: async (url, init) => {
    if (String(url).includes("api.github.com")) return new Response("Generated not found", { status: 404 });
    importing = true;
    return new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => { aborted = true; reject(new DOMException("Generated revoked", "AbortError")); }, { once: true }));
  } } } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const projectId = fixture.session().projectId;
    await manualBoard(sdk, projectId, (board) => { board.linear = { enabled: true, teamId: "generated-team" }; });
    const created = await sdk.issues.create(projectId, { ...fields(), pullRequestUrl: "https://github.com/generated/project/pull/2" });
    const refresh = await sdk.issues.refresh(projectId);
    assert.equal((await sdk.jobs.wait(refresh.id!)).status, "failed");
    const issue = sdk.getState().snapshot!.issues.find((issue) => issue.id === created.id)!;
    assert.equal(issue.phaseId, "backlog"); assert.equal(issue.pullRequest?.state, "unknown");
    assert.match(issue.pullRequest!.diagnostic!, /HTTP 404/);
    await sdk.linear.setToken("generated-revocable-key");
    const job = await sdk.linear.import(projectId);
    await waitFor(() => importing);
    const { board } = await sdk.issues.board(projectId);
    await sdk.issues.configure(projectId, { ...board, linear: { ...board.linear, enabled: false } }, board.revision);
    assert.equal((await sdk.jobs.wait(job.id!)).status, "cancelled");
    assert.equal(aborted, true);
    assert.equal(sdk.getState().snapshot!.issues.length, 1);
  } finally { sdk.disconnect(); await fixture.close(); }
});
