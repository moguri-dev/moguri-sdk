import assert from "node:assert/strict";
import test from "node:test";
import { kanbanPreferences, MoguriSdk } from "../packages/sdk/src/index.ts";
import { setupFixture, waitFor } from "./fixture.ts";
import { githubBoardFixture } from "./fixtures/github-board.ts";
import { ProjectIntegrations } from "../apps/service/src/project-integrations.ts";
import { startService } from "../apps/service/src/server.ts";
import { mkdir, rename, rmdir } from "node:fs/promises";

test("hiding a synced board preserves its captured source and cards without a new GitHub read even after presentation changes", async () => {
  const fixture = await githubBoardFixture();
  try {
    await fixture.configure(true); assert.equal((await fixture.refresh()).status, "completed");
    const configuration = (await fixture.sdk.projects.configuration(fixture.projectId)).configuration;
    await fixture.sdk.projects.organize(fixture.projectId, { folderId: configuration.folderId, color: "#3b82f6", order: configuration.order }, configuration.revision);
    const original = await fixture.sdk.issues.board(fixture.projectId), calls = fixture.calls.length, reads = fixture.reads.length;
    await fixture.sdk.issues.configure(fixture.projectId, { ...original.board, kanban: { ...kanbanPreferences(original.board), visible: false } }, original.board.revision);
    const hidden = await fixture.sdk.issues.board(fixture.projectId);
    assert.equal(kanbanPreferences(hidden.board).visible, false);
    assert.deepEqual(hidden.board.githubSource, original.board.githubSource);
    assert.deepEqual(hidden.issues, original.issues);
    assert.equal(fixture.calls.length, calls); assert.equal(fixture.reads.length, reads);
    assert.equal((await fixture.refresh()).status, "completed");
    assert.deepEqual((await fixture.sdk.issues.board(fixture.projectId)).board.githubSource, original.board.githubSource);
  } finally { await fixture.close(); }
});

test("a retained board uses fresh read policy without retargeting its source or requiring an old settings epoch", async () => {
  const fixture = await githubBoardFixture();
  try {
    await fixture.configure(true); assert.equal((await fixture.refresh()).status, "completed");
    const original = await fixture.sdk.issues.board(fixture.projectId), settings = fixture.sdk.settings.get()!;
    await fixture.sdk.settings.update({ ...settings.values, permissions: { ...settings.values.permissions, tools: [
      ...settings.values.permissions.tools, { id: "generated-unrelated-read-policy", tool: "read_file", pathPrefix: "", decision: "ask" },
    ] } }, settings.revision);
    fixture.state.cards[0]!.draft = false;
    assert.equal((await fixture.refresh()).status, "completed");
    const current = await fixture.sdk.issues.board(fixture.projectId);
    assert.deepEqual(current.board.githubSource, original.board.githubSource);
    assert.equal(current.issues[0]?.github?.sourceDigest, original.issues[0]?.github?.sourceDigest);
    assert.equal(current.issues[0]?.phaseId, "review");
    await fixture.configure(false); await fixture.configure(true);
    assert.equal((await fixture.refresh()).status, "completed");
    assert.deepEqual((await fixture.sdk.issues.board(fixture.projectId)).board.githubSource, original.board.githubSource);
  } finally { await fixture.close(); }
});

test("a presentation revision during an owned issue read does not invalidate its unchanged root and source", async () => {
  const fixture = await githubBoardFixture(), gate = Promise.withResolvers<void>(); let entered = false;
  try {
    await fixture.configure(true); assert.equal((await fixture.refresh()).status, "completed");
    const original = await fixture.sdk.issues.board(fixture.projectId);
    fixture.state.beforeRead = async (query) => { if (query.includes("issues(")) { entered = true; await gate.promise; } };
    const job = await fixture.sdk.issues.refresh(fixture.projectId); await waitFor(() => entered);
    const configuration = (await fixture.sdk.projects.configuration(fixture.projectId)).configuration;
    await fixture.sdk.projects.organize(fixture.projectId, { folderId: configuration.folderId, color: "#3b82f6", order: configuration.order }, configuration.revision);
    fixture.state.cards[0]!.draft = false; gate.resolve();
    assert.equal((await fixture.sdk.jobs.wait(job.id!)).status, "completed");
    const current = await fixture.sdk.issues.board(fixture.projectId);
    assert.deepEqual(current.board.githubSource, original.board.githubSource);
    assert.equal(current.issues[0]?.phaseId, "review");
  } finally { gate.resolve(); await fixture.close(); }
});

test("an actual permission change during a read rejects its late page, while a later newly allowed read can recover", async () => {
  const fixture = await githubBoardFixture(), gate = Promise.withResolvers<void>(); let entered = false;
  try {
    await fixture.configure(true); assert.equal((await fixture.refresh()).status, "completed");
    const original = await fixture.sdk.issues.board(fixture.projectId);
    fixture.state.beforeRead = async (query) => { if (query.includes("issues(")) { entered = true; await gate.promise; } };
    const job = await fixture.sdk.issues.refresh(fixture.projectId); await waitFor(() => entered);
    const settings = fixture.sdk.settings.get()!;
    await fixture.sdk.settings.update({ ...settings.values, permissions: { ...settings.values.permissions, tools: [
      ...settings.values.permissions.tools, { id: "generated-deny-board-read", tool: "github", pathPrefix: "", decision: "deny" },
    ] } }, settings.revision);
    fixture.state.cards[0]!.draft = false; gate.resolve();
    assert.equal((await fixture.sdk.jobs.wait(job.id!)).status, "failed");
    assert.deepEqual((await fixture.sdk.issues.board(fixture.projectId)).issues, original.issues);
    const reads = fixture.reads.length, calls = fixture.calls.length;
    assert.equal((await fixture.refresh()).status, "failed");
    assert.equal(fixture.reads.length, reads); assert.equal(fixture.calls.length, calls);
    await fixture.sdk.settings.update(settings.values, fixture.sdk.settings.get()!.revision);
    assert.equal((await fixture.refresh()).status, "completed");
    assert.deepEqual((await fixture.sdk.issues.board(fixture.projectId)).board.githubSource, original.board.githubSource);
    assert.equal((await fixture.sdk.issues.board(fixture.projectId)).issues[0]?.phaseId, "review");
  } finally { gate.resolve(); await fixture.close(); }
});

for (const changed of ["root", "remote", "folder-policy", "environment"] as const) test(`a changed ${changed} cannot borrow a board's original read ownership`, async () => {
  const fixture = await githubBoardFixture();
  try {
    await fixture.configure(true); assert.equal((await fixture.refresh()).status, "completed");
    const original = await fixture.sdk.issues.board(fixture.projectId), calls = fixture.calls.length, reads = fixture.reads.length;
    if (changed === "root") {
      await rename(fixture.root, `${fixture.root}-original`);
      try {
        await mkdir(fixture.root);
        try { assert.equal((await fixture.refresh()).status, "failed"); }
        finally { await rmdir(fixture.root); }
      } finally { await rename(`${fixture.root}-original`, fixture.root); }
    } else {
      if (changed === "remote") fixture.git(["remote", "set-url", "origin", "git@github.com:generated-owner/other.git"]);
      if (changed === "folder-policy") {
        const configuration = (await fixture.sdk.projects.configuration(fixture.projectId)).configuration;
        await fixture.sdk.projects.configure(fixture.projectId, { ...configuration.values, deniedFolders: ["generated-private"] }, configuration.revision);
      }
      if (changed === "environment") await fixture.sdk.command({ type: "policy.set", allowedEnvs: ["Remote"] });
      assert.equal((await fixture.refresh()).status, "failed");
    }
    assert.equal(fixture.calls.length, calls); assert.equal(fixture.reads.length, reads);
    const current = await fixture.sdk.issues.board(fixture.projectId);
    assert.deepEqual(current.issues, original.issues); assert.deepEqual(current.board.githubSource, original.board.githubSource);
  } finally { await fixture.close(); }
});

test("hiding navigation does not cancel an already owned read or let it publish through another board binding", async () => {
  const fixture = await githubBoardFixture(), gate = Promise.withResolvers<void>();
  let reading = false, aborted = false;
  fixture.state.beforeRead = async (query, signal) => {
    if (!query.includes("issues(")) return;
    reading = true; signal.addEventListener("abort", () => { aborted = true; }, { once: true });
    await gate.promise; signal.throwIfAborted();
  };
  try {
    await fixture.configure(true); await waitFor(() => reading);
    const job = fixture.service.controller.snapshot().jobs.findLast((job) => job.kind === "issues.refresh")!;
    const { board } = await fixture.sdk.issues.board(fixture.projectId);
    const calls = fixture.calls.length, reads = fixture.reads.length;
    await fixture.sdk.issues.configure(fixture.projectId, { ...board, kanban: { ...kanbanPreferences(board), visible: false } }, board.revision);
    assert.equal(fixture.calls.length, calls); assert.equal(fixture.reads.length, reads); assert.equal(aborted, false);
    gate.resolve(); assert.equal((await fixture.sdk.jobs.wait(job.id)).status, "completed");
    const hidden = await fixture.sdk.issues.board(fixture.projectId);
    assert.equal(kanbanPreferences(hidden.board).visible, false); assert.equal(hidden.issues.length, 1);
    assert.deepEqual(hidden.board.githubSource, board.githubSource);
  } finally { gate.resolve(); await fixture.close(); }
});

test("GitHub synchronization reflects real draft, ready, closed and reopened PR states using reads only", async () => {
  let state = "open", draft = true, merged = false;
  const methods: string[] = [];
  const fixture = await setupFixture({ platform: { integrations: { fetch: async (_url, init) => {
    methods.push(init?.method ?? "GET");
    return Response.json({ number: 7, html_url: "https://github.com/generated/project/pull/7", state, draft, merged,
      merged_at: merged ? "2026-01-01T00:00:00Z" : null });
  } } } }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const projectId = fixture.session().projectId!, { board } = await sdk.issues.board(projectId);
    await sdk.issues.configure(projectId, { ...board, autoRefreshPrs: false }, board.revision);
    const created = await sdk.issues.create(projectId, { title: "Generated synchronized card", body: "", kind: "feature", phaseId: "backlog", pullRequestUrl: "https://github.com/generated/project/pull/7" });
    const refresh = async (phase: string) => {
      const job = await sdk.issues.refresh(projectId);
      assert.equal((await sdk.jobs.wait(job.id!)).status, "completed");
      assert.equal((await sdk.issues.board(projectId)).issues.find((issue) => issue.id === created.id)?.phaseId, phase);
    };
    await refresh("in-progress");
    draft = false; await refresh("review");
    state = "closed"; await refresh("done");
    state = "open"; draft = true; await refresh("in-progress");
    state = "closed"; merged = true; await refresh("done");
    assert.ok(methods.every((method) => method === "GET"));
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("synchronized columns remain GitHub-owned while explicit local text edits survive later source updates", async () => {
  const fixture = await githubBoardFixture();
  try {
    await fixture.configure(true); assert.equal((await fixture.refresh()).status, "completed");
    const card = (await fixture.sdk.issues.board(fixture.projectId)).issues[0]!;
    await fixture.sdk.issues.update(card.id, { title: "Generated local title override", body: card.body, kind: "bug", phaseId: card.phaseId, pullRequestUrl: null }, card.revision);
    fixture.state.cards[0]!.title = "Generated changed remote title"; fixture.state.cards[0]!.body = "Generated changed remote body.";
    assert.equal((await fixture.refresh()).status, "completed");
    const current = (await fixture.sdk.issues.board(fixture.projectId)).issues[0]!;
    assert.equal(current.title, "Generated local title override"); assert.equal(current.body, "Generated changed remote body."); assert.equal(current.kind, "bug");
    await assert.rejects(() => fixture.sdk.issues.move(current.id, "done", current.revision), { code: "issue_github_managed" });
    await assert.rejects(() => fixture.sdk.issues.reorder(current.id, "review", null, [{ issueId: current.id, phaseId: current.phaseId, order: current.order ?? current.number }], current.revision), { code: "issue_github_managed" });
    assert.ok(fixture.calls.every((call) => call.method === "GET"));
  } finally { await fixture.close(); }
});

test("disabling sync cancels a held import before any card or partial source page is published", async () => {
  const fixture = await githubBoardFixture(); let started = false, aborted = false;
  fixture.state.beforeRead = async (query, signal) => {
    if (!query.includes("issues(")) return;
    started = true;
    await new Promise<void>((_resolve, reject) => signal.addEventListener("abort", () => { aborted = true; reject(signal.reason); }, { once: true }));
  };
  try {
    await fixture.configure(true); await waitFor(() => started);
    const job = fixture.service.controller.snapshot().jobs.findLast((job) => job.kind === "issues.refresh")!;
    await fixture.configure(false);
    const terminal = await fixture.sdk.jobs.wait(job.id);
    assert.notEqual(terminal.status, "completed"); assert.equal(aborted, true);
    assert.equal((await fixture.sdk.issues.board(fixture.projectId)).issues.length, 0);
    assert.equal((await fixture.sdk.issues.board(fixture.projectId)).board.autoRefreshPrs, false);
  } finally { await fixture.close(); }
});

test("partial GraphQL responses and foreign viewers never replace retained issue facts or leak provider messages", async () => {
  const fixture = await githubBoardFixture();
  try {
    await fixture.configure(true); assert.equal((await fixture.refresh()).status, "completed");
    const before = (await fixture.sdk.issues.board(fixture.projectId)).issues;
    fixture.state.responseOverride = { errors: [{ message: "generated-private-provider-message-not-for-retention" }], data: {} };
    assert.equal((await fixture.refresh()).status, "failed");
    assert.deepEqual((await fixture.sdk.issues.board(fixture.projectId)).issues, before);
    assert.equal(JSON.stringify(fixture.service.controller.events(0)).includes("generated-private-provider-message-not-for-retention"), false);
    fixture.state.responseOverride = undefined; fixture.state.viewerId = 99;
    assert.equal((await fixture.refresh()).status, "failed");
    assert.deepEqual((await fixture.sdk.issues.board(fixture.projectId)).issues, before);
  } finally { await fixture.close(); }
});

test("a changed numeric CLI account stops before repository or GraphQL reads with its replacement", async () => {
  const fixture = await githubBoardFixture();
  try {
    await fixture.configure(true); assert.equal((await fixture.refresh()).status, "completed");
    const before = (await fixture.sdk.issues.board(fixture.projectId)).issues;
    const repositoryReads = fixture.calls.filter((call) => call.path === "repos/generated-owner/fixture").length, graphReads = fixture.reads.length;
    fixture.changeAccount(99); fixture.state.viewerId = 99;
    const result = await fixture.refresh();
    assert.equal(result.status, "failed"); assert.match(result.error ?? "", /numeric GitHub account changed|captured GitHub account/i);
    assert.equal(fixture.calls.filter((call) => call.path === "repos/generated-owner/fixture").length, repositoryReads);
    assert.equal(fixture.reads.length, graphReads);
    assert.deepEqual((await fixture.sdk.issues.board(fixture.projectId)).issues, before);
  } finally { await fixture.close(); }
});

test("paged imports deduplicate exact issue identities and report an exceeded board bound without publishing a prefix", async (t) => {
  for (const count of [21, 501]) await t.test(`${count} generated issues`, async () => {
    const fixture = await githubBoardFixture();
    fixture.state.cards = Array.from({ length: count }, (_, index) => ({ number: index + 1, title: `Generated issue ${index + 1}`, body: "",
      state: "OPEN", reason: null, draft: null, updatedAt: "2026-01-02T00:00:00Z" }));
    try {
      await fixture.configure(true); const completed = await fixture.refresh(), issues = (await fixture.sdk.issues.board(fixture.projectId)).issues;
      if (count === 501) { assert.equal(completed.status, "failed"); assert.equal(issues.length, 0); }
      else {
        assert.equal(completed.status, "completed"); assert.equal(issues.length, 21);
        assert.equal(new Set(issues.map((issue) => issue.github?.nodeId)).size, 21);
        assert.equal((await fixture.refresh()).status, "completed");
        assert.equal((await fixture.sdk.issues.board(fixture.projectId)).issues.length, 21);
      }
    } finally { await fixture.close(); }
  });
});

test("the enabled service poller applies fresh linked status without a manual refresh button", async (t) => {
  const fixture = await githubBoardFixture({ refreshMs: 20 });
  try {
    await fixture.configure(true);
    await waitFor(() => fixture.service.controller.snapshot().issues[0]?.phaseId === "in-progress");
    fixture.state.cards[0]!.draft = false;
    const now = Date.now.bind(Date); t.mock.method(Date, "now", () => now() + 61_000);
    await waitFor(() => fixture.service.controller.snapshot().issues[0]?.phaseId === "review");
    assert.ok(fixture.reads.some((read) => read.query.includes("card0:")));
    assert.ok(fixture.calls.every((call) => call.method === "GET"));
  } finally { await fixture.close(); }
});

test("optional read-only issue import retains exact links and follows issue closure, linked draft/ready PRs and reopening", async () => {
  const fixture = await githubBoardFixture();
  try {
    await fixture.configure(true);
    const refresh = async (phase: string) => {
      assert.equal((await fixture.refresh()).status, "completed");
      const issues = (await fixture.sdk.issues.board(fixture.projectId)).issues;
      assert.equal(issues.length, 1); assert.equal(issues[0]?.phaseId, phase);
      assert.equal(issues[0]?.github?.url, "https://github.com/generated-owner/fixture/issues/7");
      return issues[0]!;
    };
    await refresh("in-progress");
    fixture.state.cards[0]!.draft = false; fixture.state.cards[0]!.title = "Generated updated GitHub title";
    assert.equal((await refresh("review")).title, fixture.state.cards[0]!.title);
    fixture.state.cards[0]!.state = "CLOSED"; fixture.state.cards[0]!.reason = "NOT_PLANNED";
    assert.equal((await refresh("done")).github?.stateReason, "not_planned");
    fixture.state.cards[0]!.reason = "COMPLETED";
    assert.equal((await refresh("done")).github?.stateReason, "completed");
    fixture.state.cards[0]!.reason = "DUPLICATE";
    assert.equal((await refresh("done")).github?.stateReason, "duplicate");
    fixture.state.cards[0]!.state = "OPEN"; fixture.state.cards[0]!.reason = null; fixture.state.cards[0]!.draft = null;
    await refresh("backlog");
    assert.ok(fixture.reads.length > 0);
    assert.ok(fixture.calls.every((call) => call.method === "GET"));
    assert.equal(fixture.service.controller.snapshot().sessions[0]?.usage.length, 0);
  } finally { await fixture.close(); }
});

test("the actual CLI adapter sends only a bounded literal read query through the captured controller account", async () => {
  let calls = 0;
  const reader = new ProjectIntegrations({ read: async () => null, write: async () => {}, remove: async () => {} }, {
    program: async (executable, args, options) => {
      calls++;
      assert.equal(executable, "gh"); assert.equal(options.cwd, "/generated/exact-root");
      assert.equal(args[args.indexOf("--method") + 1], "POST"); assert.ok(args.includes("graphql"));
      const fields = args.filter((_arg, index) => args[index - 1] === "--raw-field");
      const query = fields.find((field) => field.startsWith("query="))!;
      assert.ok(query.startsWith("query=query MoguriKanban")); assert.equal(/\bmutation\b/.test(query), false);
      assert.ok(fields.includes("owner=generated-owner")); assert.ok(fields.includes("name=fixture"));
      assert.deepEqual(options.env, { GH_PROMPT_DISABLED: "1", GH_NO_UPDATE_NOTIFIER: "1" });
      assert.equal(options.maxBytes, 8 * 1024 * 1024);
      return JSON.stringify({ data: { viewer: { login: "generated-owner", databaseId: 42 },
        repository: { databaseId: 41, nameWithOwner: "generated-owner/fixture", url: "https://github.com/generated-owner/fixture" } } });
    },
  });
  assert.equal(await reader.githubBoardIdentity("generated-owner/fixture", "generated-owner:42", "/generated/exact-root", AbortSignal.timeout(5000)), 41);
  assert.equal(calls, 1);
});

test("a transport that ignores cancellation cannot publish a late issue page after synchronization is disabled", async () => {
  const fixture = await githubBoardFixture(), gate = Promise.withResolvers<void>(); let started = false;
  fixture.state.beforeRead = async (query) => { if (query.includes("issues(")) { started = true; await gate.promise; } };
  try {
    await fixture.configure(true); await waitFor(() => started);
    const job = fixture.service.controller.snapshot().jobs.findLast((job) => job.kind === "issues.refresh")!;
    await fixture.configure(false); gate.resolve();
    assert.notEqual((await fixture.sdk.jobs.wait(job.id)).status, "completed");
    assert.equal((await fixture.sdk.issues.board(fixture.projectId)).issues.length, 0);
  } finally { gate.resolve(); await fixture.close(); }
});

test("concurrent source reads preserve a local edit made while the GraphQL response is pending", async () => {
  const fixture = await githubBoardFixture(), gate = Promise.withResolvers<void>(); let started = false;
  try {
    await fixture.configure(true); assert.equal((await fixture.refresh()).status, "completed");
    const card = (await fixture.sdk.issues.board(fixture.projectId)).issues[0]!;
    fixture.state.beforeRead = async (query) => { if (query.includes("issues(")) { started = true; await gate.promise; } };
    const job = await fixture.sdk.issues.refresh(fixture.projectId); await waitFor(() => started);
    await fixture.sdk.issues.update(card.id, { title: "Generated edit during read", body: card.body, kind: card.kind, phaseId: card.phaseId, pullRequestUrl: null }, card.revision);
    fixture.state.cards[0]!.body = "Generated new remote body during the read."; gate.resolve();
    assert.equal((await fixture.sdk.jobs.wait(job.id!)).status, "completed");
    const latest = (await fixture.sdk.issues.board(fixture.projectId)).issues[0]!;
    assert.equal(latest.title, "Generated edit during read"); assert.equal(latest.body, fixture.state.cards[0]!.body);
  } finally { gate.resolve(); await fixture.close(); }
});

test("an actual service restart retains exact source ownership and imports updates without duplicates or replaying an old job", async () => {
  const retentionKey = Buffer.alloc(32, 0x68), fixture = await githubBoardFixture({ retentionKey });
  let restarted: Awaited<ReturnType<typeof startService>> | undefined, peer: MoguriSdk | undefined;
  try {
    await fixture.configure(true); assert.equal((await fixture.refresh()).status, "completed");
    const configuration = (await fixture.sdk.projects.configuration(fixture.projectId)).configuration;
    await fixture.sdk.projects.organize(fixture.projectId, { folderId: configuration.folderId, color: "#3b82f6", order: configuration.order }, configuration.revision);
    const before = await fixture.sdk.issues.board(fixture.projectId), oldJobs = new Set(fixture.service.controller.snapshot().jobs.map((job) => job.id));
    fixture.sdk.disconnect(); await fixture.service.close();
    fixture.state.cards[0]!.draft = false;
    const values = new Map<string, string>(), vault = { read: async (id: string) => values.get(id) ?? null,
      write: async (id: string, value: string) => { values.set(id, value); }, remove: async (id: string) => { values.delete(id); } };
    restarted = await startService({ stateDir: fixture.stateDir, retentionKey,
      provider: { state: { status: "disconnected", models: [], login: null, diagnostic: null }, onChange() {},
        refresh: async () => {}, logout: async () => {}, cancel: async () => {},
        login() { throw new Error("Generated restart forbids personal authentication."); }, prepare: async () => { throw new Error("Generated restart forbids inference."); } },
      platform: { vault, integrations: { ...fixture.integrations, vault }, github: { runProgram: fixture.githubProgram } } });
    peer = await new MoguriSdk(restarted.connection).ready();
    assert.deepEqual((await peer.issues.board(fixture.projectId)).board.githubSource, before.board.githubSource);
    const next = await peer.issues.refresh(fixture.projectId);
    assert.equal(oldJobs.has(next.id!), false); assert.equal((await peer.jobs.wait(next.id!)).status, "completed");
    const after = await peer.issues.board(fixture.projectId);
    assert.equal(after.issues.length, 1); assert.equal(after.issues[0]?.id, before.issues[0]?.id); assert.equal(after.issues[0]?.phaseId, "review");
    assert.ok(fixture.calls.every((call) => call.method === "GET"));
  } finally { peer?.disconnect(); await restarted?.close(); await fixture.close(); }
});

test("full GitHub database identifiers beyond GraphQL Int32 retain their exact safe integer identity", async () => {
  const fixture = await githubBoardFixture();
  fixture.state.bigIdentifiers = true;
  try {
    await fixture.configure(true); assert.equal((await fixture.refresh()).status, "completed");
    const board = await fixture.sdk.issues.board(fixture.projectId);
    assert.equal(board.board.githubSource?.repositoryId, 3_000_000_041);
    assert.equal(board.issues[0]?.github?.databaseId, 3_000_000_007);
    assert.ok(fixture.reads.every((read) => read.query.includes("databaseId: fullDatabaseId")));
  } finally { await fixture.close(); }
});

test("an identifier beyond exact numeric representation cannot mint a rounded source binding", async () => {
  const fixture = await githubBoardFixture();
  fixture.state.responseOverride = { data: { viewer: { login: "generated-owner", databaseId: 42 },
    repository: { databaseId: "9007199254740993", nameWithOwner: "generated-owner/fixture", url: "https://github.com/generated-owner/fixture" } } };
  try {
    await assert.rejects(() => fixture.configure(true), { code: "github_sync_identity" });
    const board = await fixture.sdk.issues.board(fixture.projectId);
    assert.equal(board.board.githubSource, undefined); assert.equal(board.issues.length, 0);
    assert.equal(board.board.autoRefreshPrs, false);
  } finally { await fixture.close(); }
});
