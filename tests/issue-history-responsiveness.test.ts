import assert from "node:assert/strict";
import test from "node:test";
import { projectEvents, type EventInput, type StoredEvent } from "../packages/protocol/src/index.ts";
import { stripMarkdownComments } from "../packages/protocol/src/markdown.ts";
import { generatedIssueRevisions } from "./fixtures/responsive-history.ts";

const retained = (inputs: EventInput[]): StoredEvent[] => inputs.map((input, index): StoredEvent => ({
  project_id: null, session_id: null, turn_id: null, step_id: null, correlation_id: null, work_item_id: null, parent_event_id: null, artifact_id: null,
  ...input, seq: index + 1, id: `generated-retained-event-${index}`, schema_version: 1, timestamp: "2026-01-01T00:00:00.000Z",
}));

test("issue reimports do not repeatedly normalize obsolete descriptions during the two projections of an ordinary commit", () => {
  const inputs = generatedIssueRevisions("generated-project"), history = retained(inputs);
  const began = performance.now();
  const first = projectEvents(history), next = projectEvents(history);
  const projectionMs = performance.now() - began;
  assert.equal(first.issues.length, 100);
  assert.deepEqual(next.issues, first.issues);
  assert.ok(first.issues.every((issue) => !issue.title.includes("GENERATED_HIDDEN") && !issue.body.includes("GENERATED_HIDDEN")));
  console.log(JSON.stringify({ primitive: "generated-issue-reimport-projection", revisions: history.length, currentIssues: first.issues.length, twoProjectionMs: projectionMs }));
  assert.ok(projectionMs < 450, `Two ordinary commit projections took ${projectionMs.toFixed(1)} ms instead of staying below the 450-ms cold admission component budget.`);
});

test("unchanged retained issue source validation stays fast across later commit projections", () => {
  const history = retained(generatedIssueRevisions("generated-project"));
  projectEvents(history);
  const began = performance.now();
  projectEvents(history); projectEvents(history);
  const projectionMs = performance.now() - began;
  console.log(JSON.stringify({ primitive: "generated-issue-reimport-warm-projection", revisions: history.length, twoProjectionMs: projectionMs }));
  assert.ok(projectionMs < 300, `Two unchanged commit projections took ${projectionMs.toFixed(1)} ms instead of staying below 300 ms.`);
});

test("latest issue projection preserves canonical order, original bytes and independent output copies", () => {
  const inputs = generatedIssueRevisions("generated-project", 12, 3), history = retained(inputs);
  const originals = structuredClone(history), reference = new Map<string, ReturnType<typeof projectEvents>["issues"][number]>();
  for (const event of history) if (event.event_type === "issue.saved") {
    const issue = event.payload.issue;
    reference.set(issue.id, { ...structuredClone(issue), title: stripMarkdownComments(issue.title), body: stripMarkdownComments(issue.body) });
  }
  const projected = projectEvents(history);
  assert.deepEqual(projected.issues, [...reference.values()]);
  assert.deepEqual(history, originals);
  projected.issues[0]!.body = "Generated changed view only.";
  projected.issues[0]!.github!.pullRequests.push({ url: "https://github.com/generated/responsiveness/pull/1",
    repo: "generated/responsiveness", number: 1, state: "open", checkedAt: null, diagnostic: null });
  assert.deepEqual(projectEvents(history).issues, [...reference.values()]);
  assert.deepEqual(history, originals);
});

test("overwritten historical issue sources are still checked after cached validation and mutation", async (t) => {
  for (const change of ["number", "timestamp", "url", "unknown-undefined", "nested-undefined", "body"] as const) await t.test(change, () => {
    const history = retained(generatedIssueRevisions("generated-project", 3, 1));
    const original = history[0];
    assert.ok(original?.event_type === "issue.saved" && original.payload.issue.github);
    original.payload.issue.github.pullRequests.push({ url: "https://github.com/generated/responsiveness/pull/1",
      repo: "generated/responsiveness", number: 1, state: "open", checkedAt: null, diagnostic: null });
    projectEvents(history); projectEvents(history);
    const issue = original.payload.issue, link = issue.github!;
    if (change === "number") link.number = 0;
    if (change === "timestamp") link.checkedAt = "Generated invalid time";
    if (change === "url") link.url = "https://github.com/generated/other/issues/1";
    if (change === "unknown-undefined") Reflect.set(link, "generatedUnknown", undefined);
    if (change === "nested-undefined") Reflect.set(link.pullRequests[0]!, "generatedUnknown", undefined);
    if (change === "body") Reflect.set(issue, "body", null);
    assert.throws(() => projectEvents(history), { code: "github_sync_corrupt" });
  });
});

test("cold issue-source revision reuse cannot bypass complete schema checks or change valid retained observations", async (t) => {
  for (const change of ["node", "database", "repo", "number", "url", "state", "reason", "updated", "checked", "source", "title", "body",
    "unknown-undefined", "nested-invalid", "valid-observation"] as const) await t.test(change, () => {
    const history = retained(generatedIssueRevisions("generated-project", 2, 1));
    const event = history[1];
    assert.ok(event?.event_type === "issue.saved" && event.payload.issue.github);
    const link = event.payload.issue.github;
    if (change === "node") link.nodeId = "Generated invalid node!";
    if (change === "database") link.databaseId = 0;
    if (change === "repo") link.repo = "Generated invalid repository";
    if (change === "number") link.number = 0;
    if (change === "url") link.url = "https://github.com/generated/other/issues/1";
    if (change === "state") Reflect.set(link, "state", "generated-invalid");
    if (change === "reason") Reflect.set(link, "stateReason", "generated-invalid");
    if (change === "updated") link.updatedAt = "Generated invalid time";
    if (change === "checked") link.checkedAt = "Generated invalid time";
    if (change === "source") link.sourceDigest = "generated-invalid-digest";
    if (change === "title") link.titleDigest = "generated-invalid-digest";
    if (change === "body") link.bodyDigest = "generated-invalid-digest";
    if (change === "unknown-undefined") Reflect.set(link, "generatedUnknown", undefined);
    if (change === "nested-invalid") link.pullRequests.push({ url: "https://github.com/generated/responsiveness/pull/1",
      repo: "generated/responsiveness", number: 0, state: "open", checkedAt: null, diagnostic: null });
    if (change === "valid-observation") {
      link.state = "closed"; link.stateReason = "completed"; link.diagnostic = "Generated new valid observation.";
      link.pullRequests.push({ url: "https://github.com/generated/responsiveness/pull/1", repo: "generated/responsiveness",
        number: 1, state: "open", checkedAt: null, diagnostic: null });
      assert.deepEqual(projectEvents(history).issues[0]?.github, link);
    } else assert.throws(() => projectEvents(history), { code: "github_sync_corrupt" });
  });
});

test("issue replay keeps profile and project-removal boundaries rather than reviving an obsolete source", () => {
  const inputs = generatedIssueRevisions("generated-project", 6, 2);
  const foreign = inputs.map((input): EventInput => ({ ...input, profile_id: "generated-other-profile" }));
  const removed: EventInput = { event_type: "project.removed", profile_id: "default", payload: { deletedProjectId: "generated-project", usage: [] } };
  assert.equal(projectEvents(retained([...inputs, ...foreign])).issues.length, 2);
  assert.equal(projectEvents(retained([...inputs, ...foreign, removed])).issues.length, 0);
  const recreated = generatedIssueRevisions("generated-project", 1, 1);
  assert.deepEqual(projectEvents(retained([...inputs, removed, ...recreated])).issues, projectEvents(retained(recreated)).issues);
});
