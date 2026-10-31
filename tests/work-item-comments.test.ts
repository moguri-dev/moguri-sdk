import assert from "node:assert/strict";
import test from "node:test";
import { stripMarkdownComments } from "../packages/protocol/src/markdown.ts";
import { MoguriSdk, projectEvents, type StoredEvent } from "../packages/sdk/src/index.ts";
import { setupFixture } from "./fixture.ts";
import { randomUUID } from "node:crypto";
import { githubBoardFixture } from "./fixtures/github-board.ts";
import { linearServiceFixture, linearFixtureIds } from "./fixtures/linear-workflows.ts";

test("work-item comment filtering removes hidden standard, malformed and unterminated blocks without removing visible text", () => {
  for (const [source, expected] of [
    ["Visible generated text.", "Visible generated text."],
    ["Before<!-- GENERATED_HIDDEN -->after", "Beforeafter"],
    ["Before<--- GENERATED_HIDDEN -->after", "Beforeafter"],
    ["Before\n<!--\nGENERATED_HIDDEN\n-->\nAfter", "Before\n\nAfter"],
    ["Before<!-- GENERATED_HIDDEN", "Before"],
    ["Before<--- GENERATED_HIDDEN", "Before"],
    ["<!--first--><!--second-->Visible", "Visible"],
    ["<!<!-- first -->-- GENERATED_HIDDEN -->Visible", "Visible"],
    ["A --> B", "A --> B"],
    ["```md\n<!-- GENERATED_HIDDEN -->\n```", "```md\n\n```"],
    ["Generated caf\u00e9 <!-- hidden --> source", "Generated caf\u00e9  source"],
  ] as const) {
    const filtered = stripMarkdownComments(source);
    assert.equal(filtered, expected, source);
    assert.equal(stripMarkdownComments(filtered), filtered, "Filtering must be idempotent, including comment delimiters joined across removed blocks.");
    assert.equal(filtered.includes("GENERATED_HIDDEN"), false);
  }
});

test("GitHub work-item previews, imports and actual model context exclude hidden comments before use", { skip: process.platform !== "darwin" }, async () => {
  const marker = "GENERATED_HIDDEN_WORK_ITEM_INSTRUCTION", url = "https://github.com/generated/example/issues/4";
  const fixture = await setupFixture({ platform: { integrations: { fetch: async () => Response.json({
    number: 4, html_url: url, title: `Generated <!--${marker}-->visible task`,
    body: `Visible generated task.\n<!-- ${marker} -->\n<--- ${marker} -->Visible ending.`,
    state: "open", updated_at: "2026-01-01T00:00:00Z",
  }) } } }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.configure();
    const preview = (await sdk.attachments.githubPreview(fixture.sessionId, url)).preview;
    assert.equal(typeof preview.text, "string");
    if (preview.text === undefined) assert.fail("Generated work-item preview must retain its visible text.");
    assert.equal(preview.text.includes(marker), false);
    assert.match(preview.text, /Visible generated task/);
    await sdk.attachments.github(fixture.sessionId, url, "public", preview.digest, true);
    const attachment = fixture.session().draft.attachments[0]!;
    const read = await sdk.attachments.read(fixture.sessionId, attachment.id);
    assert.ok(read.content.kind === "text"); assert.equal(read.content.text.includes(marker), false);
    await fixture.send("Generated work-item context request."); await fixture.terminal();
    assert.equal(JSON.stringify(fixture.requests).includes(marker), false);
    assert.equal(JSON.stringify(fixture.requests).includes("Visible ending."), true);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("local work items and legacy projections expose comment-filtered text without rewriting original events", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  const marker = "GENERATED_HIDDEN_LOCAL_INSTRUCTION";
  try {
    const created = await sdk.issues.create(fixture.session().projectId, {
      title: `Generated <!--${marker}-->local task`, body: `Visible body.<!--${marker}-->Visible ending.`,
      kind: "misc", phaseId: "backlog", pullRequestUrl: null,
    });
    const { issues } = await sdk.issues.board(fixture.session().projectId), issue = issues.find((issue) => issue.id === created.id)!;
    assert.equal(issue.title, "Generated local task"); assert.equal(issue.body, "Visible body.Visible ending.");
    const history = fixture.service.controller.events(0), prototype = history.at(-1)!;
    const legacy: StoredEvent = { ...prototype, id: "generated-legacy-work-item", seq: prototype.seq + 1, event_type: "issue.saved",
      payload: { issue: { ...issue, body: `Visible legacy.<!--${marker}-->`, revision: issue.revision + 1 }, actor: "user" } };
    const projected = projectEvents([...history, legacy]).issues.find((value) => value.id === issue.id)!;
    assert.equal(projected.body, "Visible legacy.");
    assert.equal(legacy.payload.issue.body.includes(marker), true);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("legacy typed work-item attachments preserve originals but disclose filtered view digests before UI/model reads", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  const marker = "GENERATED_HIDDEN_LEGACY_ATTACHMENT";
  try {
    const raw = JSON.stringify({ title: "Generated legacy reference", body: `Visible legacy work.<!--${marker}-->Visible ending.` });
    const hash = fixture.service.store.putBlob(raw), id = randomUUID();
    fixture.service.store.commit([{ event_type: "draft.saved", profile_id: "default", project_id: fixture.session().projectId, session_id: fixture.sessionId,
      payload: { text: "", attachments: [{ id, kind: "github_issue", path: "generated/example#4", digest: hash, bytes: Buffer.byteLength(raw),
        source: { kind: "github-public", location: "https://github.com/generated/example/issues/4", revision: "2026-01-01T00:00:00Z" } }] } }]);
    fixture.service.controller.refreshProfile(); await sdk.refresh();
    const read = await sdk.attachments.read(fixture.sessionId, id);
    assert.ok(read.content.kind === "text");
    assert.equal(read.content.text.includes(marker), false);
    assert.equal(read.content.filter?.sourceDigest, hash);
    assert.notEqual(read.content.filter?.viewDigest, hash);
    assert.equal(fixture.service.store.blob(hash), raw, "The original source grant must not be rewritten into a different artifact.");
    await fixture.configure(); await fixture.send("Generated legacy attached work-item request."); await fixture.terminal();
    assert.equal(JSON.stringify(fixture.requests).includes(marker), false);
    assert.ok(JSON.stringify(fixture.requests).includes("work-item-comments-v1"));
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("GitHub Kanban and Linear reads/imports remove hidden work instructions before they reach stored cards", { skip: process.platform !== "darwin" }, async () => {
  const marker = "GENERATED_HIDDEN_IMPORTED_INSTRUCTION";
  const github = await githubBoardFixture();
  try {
    github.state.cards[0]!.body = `Visible GitHub issue.<!--${marker}-->`;
    await github.configure(true);
    assert.equal((await github.refresh()).status, "completed");
    const card = (await github.sdk.issues.board(github.projectId)).issues.find((issue) => issue.github?.number === 7)!;
    assert.equal(card.body, "Visible GitHub issue.");
    assert.equal(JSON.stringify(github.service.controller.snapshot().issues).includes(marker), false);
  } finally { await github.close(); }
  const linear = await linearServiceFixture();
  try {
    const issue = linear.provider.issues.get(linearFixtureIds.issue)!;
    issue.description = `Visible Linear issue.<---${marker}-->`;
    const comment = linear.provider.comments.get(linearFixtureIds.comment)!;
    comment.body = `Visible Linear comment.<!--${marker}-->`;
    await linear.enable();
    assert.equal((await linear.sdk.linear.issue(linear.projectId, linearFixtureIds.issue)).issue.description, "Visible Linear issue.");
    const comments = await linear.sdk.linear.catalog(linear.projectId, "comments", { issueId: linearFixtureIds.issue });
    assert.equal(JSON.stringify(comments).includes(marker), false);
    const imported = await linear.sdk.linear.import(linear.projectId);
    assert.equal((await linear.sdk.jobs.wait(imported.id!)).status, "completed");
    assert.equal(JSON.stringify((await linear.sdk.issues.board(linear.projectId)).issues).includes(marker), false);
  } finally { await linear.close(); }
});
