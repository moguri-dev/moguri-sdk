import assert from "node:assert/strict";
import test from "node:test";
import { MoguriSdk, type LocalIssue } from "../packages/sdk/src/index.ts";
import { setupFixture } from "./fixture.ts";

const positions = (issues: LocalIssue[]) => issues.map((issue) => ({ issueId: issue.id, phaseId: issue.phaseId, order: issue.order ?? issue.number }));
const ordered = (issues: LocalIssue[]) => [...issues].sort((a, b) => (a.order ?? a.number) - (b.order ?? b.number) || a.number - b.number);

test("card reorder moves exact siblings atomically and preserves their local fields and other columns", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const projectId = fixture.session().projectId!, { board } = await sdk.issues.board(projectId);
    await sdk.issues.configure(projectId, { ...board, autoRefreshPrs: false }, board.revision);
    const ids: string[] = [];
    for (const title of ["Generated A", "Generated B", "Generated C"]) ids.push((await sdk.issues.create(projectId, {
      title, body: "Generated retained original card text.", kind: "feature", phaseId: "backlog", pullRequestUrl: null,
    })).id!);
    const other = await sdk.issues.create(projectId, { title: "Generated other column", body: "", kind: "bug", phaseId: "done", pullRequestUrl: null });
    let issues = (await sdk.issues.board(projectId)).issues;
    await sdk.command({ type: "issue.reorder", issueId: ids[2]!, expectedRevision: 0, phaseId: "backlog", beforeIssueId: ids[0]!,
      expectedOrder: positions(issues.filter((issue) => issue.phaseId === "backlog")) });
    issues = (await sdk.issues.board(projectId)).issues;
    assert.deepEqual(ordered(issues.filter((issue) => issue.phaseId === "backlog")).map((issue) => issue.id), [ids[2], ids[0], ids[1]]);
    const source = issues.find((issue) => issue.id === ids[0])!;
    await sdk.command({ type: "issue.reorder", issueId: source.id, expectedRevision: source.revision, phaseId: "review", beforeIssueId: null,
      expectedOrder: positions(issues.filter((issue) => ["backlog", "review"].includes(issue.phaseId))) });
    issues = (await sdk.issues.board(projectId)).issues;
    const moved = issues.find((issue) => issue.id === source.id)!;
    assert.equal(moved.phaseId, "review"); assert.equal(moved.title, source.title); assert.equal(moved.body, source.body);
    assert.equal(issues.find((issue) => issue.id === other.id)?.revision, 0);
    assert.deepEqual(ordered(issues.filter((issue) => issue.phaseId === "backlog")).map((issue) => issue.id), [ids[2], ids[1]]);
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("a concurrent card creation or phase change refuses stale structural drag intent without a partial update", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const projectId = fixture.session().projectId!;
    const created = await sdk.issues.create(projectId, { title: "Generated original", body: "", kind: "feature", phaseId: "backlog", pullRequestUrl: null });
    const captured = (await sdk.issues.board(projectId)).issues;
    await sdk.issues.create(projectId, { title: "Generated concurrent", body: "", kind: "bug", phaseId: "review", pullRequestUrl: null });
    const before = fixture.service.controller.events(0);
    await assert.rejects(() => sdk.command({ type: "issue.reorder", issueId: created.id!, expectedRevision: 0, phaseId: "review",
      beforeIssueId: null, expectedOrder: positions(captured) }), { code: "issue_order_conflict" });
    assert.deepEqual(fixture.service.controller.events(0), before);
    assert.equal((await sdk.issues.board(projectId)).issues.find((issue) => issue.id === created.id)?.phaseId, "backlog");
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("failed ordering persistence rolls back every moved card and receipt", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const projectId = fixture.session().projectId!;
    for (const title of ["Generated one", "Generated two", "Generated three"]) await sdk.issues.create(projectId, {
      title, body: "", kind: "feature", phaseId: "backlog", pullRequestUrl: null,
    });
    const issues = (await sdk.issues.board(projectId)).issues, source = issues[2]!, before = fixture.service.controller.events(0);
    const seq = before.at(-1)!.seq;
    fixture.service.store.db.exec(`CREATE TRIGGER generated_card_order_failure BEFORE INSERT ON events WHEN (SELECT COALESCE(MAX(seq),0) FROM events) >= ${seq + 1} AND json_extract(NEW.data,'$.event_type')='issue.saved' BEGIN SELECT RAISE(ABORT,'Generated card ordering interruption'); END;`);
    try {
      await assert.rejects(() => sdk.command({ type: "issue.reorder", issueId: source.id, expectedRevision: source.revision, phaseId: "backlog",
        beforeIssueId: issues[0]!.id, expectedOrder: positions(issues) }, "generated-exact-ordering-command"), { code: "internal_error" });
      assert.deepEqual(fixture.service.controller.events(0), before);
      assert.deepEqual((await sdk.issues.board(projectId)).issues, issues);
    } finally { fixture.service.store.db.exec("DROP TRIGGER generated_card_order_failure"); }
  } finally { sdk.disconnect(); await fixture.close(); }
});
