import assert from "node:assert/strict";
import test from "node:test";
import { CHAT_TITLE_PROMPT, CHAT_TITLE_REFRESH_PROMPT, followUpFacts, isRecord, lifecycleGuidance, MoguriSdk, topicDrift, type LifecycleFacts, type PrActivity } from "../packages/sdk/src/index.ts";
import { LifecycleFollowUps } from "../apps/service/src/session-wrap-up.ts";
import { setupFixture, waitFor, type GeneratedProviderOptions } from "./fixture.ts";
import { initializeGeneratedRepository } from "./fixtures/git-project.ts";
import { ciTime } from "./fixtures/time-scale.ts";

const facts = (values: Partial<LifecycleFacts> = {}): LifecycleFacts => ({ version: 1, trigger: "round", sourceTurnId: "generated-turn", workspace: "managed-worktree",
  edits: 2, pullRequests: "draft", pr: { url: "https://github.com/generated/repo/pull/7", number: 7, state: "open", headSha: null }, ci: null, reviews: null, skills: [], parent: false, ...values });
const activity = (values: Partial<PrActivity> = {}): PrActivity => ({ headSha: "a".repeat(40), headRef: "moguri/generated", state: "open", author: "generated-author", reviews: [], checks: [], ...values });
const FINISHED = Date.parse("2030-01-01T10:00:00.000Z"), LATER = "2030-01-01T10:05:00.000Z", EARLIER = "2030-01-01T09:55:00.000Z";

test("topic drift needs a substantial request that shares almost no vocabulary with the current topic", () => {
  const topic = ["Fix the login timeout in the auth service", "The login page times out after the auth token refresh fails on slow networks."];
  assert.equal(topicDrift(topic, "Also add tests for the login timeout and the token refresh path in the auth service"), false);
  assert.equal(topicDrift(topic, "Rename it"), false, "Short follow-ups never rename a chat.");
  assert.equal(topicDrift(topic, "Design a dark mode palette for the settings dashboard with accessible contrast ratios and chart colors"), true);
  assert.equal(topicDrift([], "Design a dark mode palette for the settings dashboard with accessible contrast ratios"), false);
});

test("wrap-up guidance follows the project's PR preference, and follow-ups stop to ask on repeated CI failures", () => {
  const draft = lifecycleGuidance(facts({ skills: ["generated-skill"], parent: true }));
  assert.match(draft, /resolve the conflicts first/); assert.match(draft, /commit every remaining uncommitted change/i);
  assert.match(draft, /push the branch to the existing PR/); assert.match(draft, /fix it once/); assert.match(draft, /ask the user with ask_user/);
  assert.match(draft, /propose_skill/); assert.match(draft, /session_message/); assert.match(draft, /Never merge/);
  const off = lifecycleGuidance(facts({ pullRequests: "off", pr: null }));
  assert.match(off, /opted out of automatic PRs/); assert.doesNotMatch(off, /CI:|propose_skill|session_message/);
  const repeated = lifecycleGuidance(facts({ trigger: "ci", ci: { headSha: "b".repeat(40), failing: ["lint"], repeated: true } }));
  assert.match(repeated, /Do not try another fix/); assert.match(repeated, /ask_user/);
  assert.match(lifecycleGuidance(facts({ trigger: "review", reviews: { ids: [1], authors: ["generated-reviewer"] } })), /Do not resolve threads/);
});

test("follow-ups count only new reviews by others and finished failing CI, once per head, then ask on the same failure", () => {
  const base = facts(), review = (id: number, author: string, state = "COMMENTED", submittedAt = LATER) => ({ id, state, author, submittedAt });
  assert.equal(followUpFacts({ base, earlier: [base], activity: activity({ reviews: [review(1, "generated-author"), review(2, "generated-reviewer", "APPROVED"), review(3, "generated-reviewer", "COMMENTED", EARLIER)] }), lastFinishedAt: FINISHED }), null);
  const reviewed = followUpFacts({ base, earlier: [base], activity: activity({ reviews: [review(4, "generated-reviewer", "CHANGES_REQUESTED")] }), lastFinishedAt: FINISHED });
  assert.deepEqual(reviewed?.reviews, { ids: [4], authors: ["generated-reviewer"] }); assert.equal(reviewed?.trigger, "review");
  assert.equal(followUpFacts({ base, earlier: [base, reviewed!], activity: activity({ reviews: [review(4, "generated-reviewer", "CHANGES_REQUESTED")] }), lastFinishedAt: FINISHED }), null);
  const running = [{ name: "test", status: "in_progress", conclusion: null }, { name: "lint", status: "completed", conclusion: "failure" }];
  assert.equal(followUpFacts({ base, earlier: [base], activity: activity({ checks: running }), lastFinishedAt: FINISHED }), null, "Unfinished CI is not a failure yet.");
  const failed = [{ name: "test", status: "completed", conclusion: "success" }, { name: "lint", status: "completed", conclusion: "failure" }];
  const first = followUpFacts({ base, earlier: [base], activity: activity({ checks: failed }), lastFinishedAt: FINISHED });
  assert.deepEqual(first?.ci, { headSha: "a".repeat(40), failing: ["lint"], repeated: false });
  assert.equal(followUpFacts({ base, earlier: [base, first!], activity: activity({ checks: failed }), lastFinishedAt: FINISHED }), null, "One follow-up per head.");
  const again = followUpFacts({ base, earlier: [base, first!], activity: activity({ headSha: "c".repeat(40), checks: failed }), lastFinishedAt: FINISHED });
  assert.equal(again?.ci?.repeated, true);
  assert.equal(followUpFacts({ base, earlier: [base, first!, again!], activity: activity({ headSha: "d".repeat(40), checks: failed }), lastFinishedAt: FINISHED }), null);
  assert.equal(followUpFacts({ base, earlier: [base], activity: activity({ state: "merged", checks: failed }), lastFinishedAt: FINISHED }), null);
});

const wrapping = (request: Record<string, unknown>) => JSON.stringify(request.messages).includes("moguri-session-wrap-up");
const following = (request: Record<string, unknown>) => JSON.stringify(request.messages).includes("moguri-session-follow-up");
async function repositoryFixture(options: GeneratedProviderOptions = {}) {
  const f = await setupFixture(options);
  initializeGeneratedRepository(f.project);
  const sdk = await new MoguriSdk(f.service.connection).ready();
  const created = await sdk.sessions.create(f.session().projectId, "Generated lifecycle", { modelId: f.modelId });
  const id = created.id!, current = () => f.service.controller.snapshot().sessions.find((session) => session.id === id)!;
  await sdk.workspaces.wait(current().workspaceId!);
  const send = async (text: string) => {
    const saved = await sdk.command({ type: "draft.save", sessionId: id, expectedRevision: current().draft.revision, text, attachments: [] });
    await sdk.command({ type: "message.send", sessionId: id, expectedRevision: saved.revision!, delivery: "queue" });
  };
  const settled = () => waitFor(() => !current().turnId && !current().queue.length && current().status === "completed" && current(), 15_000);
  const lifecycle = () => f.service.controller.events(0).flatMap((event) => event.event_type === "queue.enqueued" && event.session_id === id && event.payload.item.lifecycle ? [event.payload.item.lifecycle] : []);
  return { f, sdk, id, current, send, settled, lifecycle, close: async () => { sdk.disconnect(); await f.close(); } };
}

test("an edited managed worktree gets one wrap-up turn after the round, shown as a notice; disabling it stops new ones", { skip: process.platform !== "darwin", timeout: ciTime(60_000) }, async () => {
  const o = await repositoryFixture();
  try {
    await o.send("generated write");
    await o.settled();
    const queued = o.lifecycle();
    assert.equal(queued.length, 1);
    assert.equal(queued[0]!.trigger, "round"); assert.equal(queued[0]!.edits, 1); assert.equal(queued[0]!.workspace, "managed-worktree");
    const notice = o.current().messages.find((message) => message.text.startsWith("Wrap-up:"));
    assert.equal(notice?.role, "notice");
    assert.equal(o.f.requests.filter(wrapping).length, 1);
    assert.equal(o.current().messages.filter((message) => message.role === "user").length, 1, "The wrap-up is not presented as user text.");

    const settings = structuredClone(o.sdk.getState().snapshot!.settings);
    await o.sdk.settings.update({ ...settings.values, wrapUp: { enabled: false, followUps: true } }, settings.revision);
    await o.send("generated write");
    await o.settled();
    assert.equal(o.lifecycle().length, 1);
  } finally { await o.close(); }
});

test("the PR watcher queues one review follow-up, one CI fix, then a stop-and-ask turn, only for the session's own branch", { skip: process.platform !== "darwin", timeout: ciTime(60_000) }, async () => {
  const o = await repositoryFixture({ respond: (request) => {
    if (wrapping(request)) return { text: "Committed and opened https://github.com/generated/repo/pull/7 as a draft." };
    const messages = (request.messages as unknown[]).filter(isRecord), user = messages.findLastIndex((message) => message.role === "user");
    const tools = messages.slice(user + 1).filter((message) => message.role === "tool");
    if (following(request) || !String(messages[user]?.content).includes("generated write")) return { text: "Generated reply." };
    if (!tools.length) return { tool: { name: "read_file", args: { path: "fixture.txt" } } };
    const file: unknown = JSON.parse(String(tools[0]!.content));
    return tools.length === 1 && isRecord(file) ? { tool: { name: "write_file", args: { path: "fixture.txt", text: "generated replacement\n", expectedDigest: file.digest } } } : { text: "Generated write done." };
  } });
  try {
    await o.send("generated wrap-up candidate");
    await o.settled();
    assert.equal(o.lifecycle().length, 0, "A round without edits needs no wrap-up.");
    const saved = await o.sdk.command({ type: "draft.save", sessionId: o.id, expectedRevision: o.current().draft.revision, text: "generated write", attachments: [] });
    await o.sdk.command({ type: "message.send", sessionId: o.id, expectedRevision: saved.revision!, delivery: "queue" });
    await o.settled();
    assert.equal(o.lifecycle().length, 1);
    let state: PrActivity = activity({ reviews: [{ id: 41, state: "COMMENTED", author: "generated-reviewer", submittedAt: new Date(Date.now() + 1000).toISOString() }] });
    let clock = Date.now() + 2000;
    const reads: string[] = [];
    const watcher = new LifecycleFollowUps({
      snapshot: () => o.f.service.controller.snapshot(), events: () => o.f.service.controller.events(0), now: () => clock,
      activity: async (link) => { reads.push(link.url); return state; }, branch: async () => "moguri/generated",
      enqueue: (sessionId, value) => o.f.service.controller.lifecycleFollowUp(sessionId, value),
    }, 1000);
    const scan = async () => { clock += 1500; await Promise.all(watcher.scan()); await o.settled(); };
    await scan();
    assert.deepEqual(reads, ["https://github.com/generated/repo/pull/7"]);
    assert.equal(o.lifecycle().at(-1)?.trigger, "review");
    assert.ok(o.current().messages.some((message) => message.role === "notice" && message.text === "Follow-up: new review on PR #7 from @generated-reviewer."));
    assert.equal(o.f.requests.filter(following).length, 1);

    state = activity({ reviews: state.reviews, checks: [{ name: "lint", status: "completed", conclusion: "failure" }] });
    await scan();
    assert.deepEqual(o.lifecycle().at(-1)?.ci, { headSha: "a".repeat(40), failing: ["lint"], repeated: false });
    await scan();
    assert.equal(o.lifecycle().length, 3, "The same head is not followed up twice.");
    state = { ...state, headSha: "b".repeat(40) };
    await scan();
    assert.equal(o.lifecycle().at(-1)?.ci?.repeated, true);
    state = { ...state, headSha: "c".repeat(40) };
    await scan();
    assert.equal(o.lifecycle().length, 4, "After asking, the watcher stops for this round.");

    state = { ...state, headRef: "generated-other-branch", reviews: [{ id: 99, state: "COMMENTED", author: "generated-reviewer", submittedAt: new Date(clock + 60_000).toISOString() }] };
    await scan();
    assert.equal(o.lifecycle().length, 4, "A PR on another branch never drives this session.");
    watcher.close();
  } finally { await o.close(); }
});

test("a model-named chat is renamed once when a later request clearly changes topic; user titles and related follow-ups stay", { timeout: ciTime(30_000) }, async () => {
  const titles = ["Generated login timeout fix", "Generated dark palette design"];
  const f = await setupFixture({ respond: (request) => {
    const text = JSON.stringify(request.messages);
    if (text.includes(CHAT_TITLE_REFRESH_PROMPT.split("\n")[0]!)) return { text: JSON.stringify({ title: titles[1] }) };
    if (text.includes(CHAT_TITLE_PROMPT.split("\n")[0]!)) return { text: JSON.stringify({ title: titles[0] }) };
    return { text: "Generated reply." };
  } });
  const sdk = await new MoguriSdk(f.service.connection).ready();
  try {
    const created = await sdk.sessions.create(f.session().projectId), id = created.id!;
    const session = () => f.service.controller.snapshot().sessions.find((value) => value.id === id)!;
    const titleRecords = () => (f.service.controller.snapshot().chatTitles ?? []).filter((record) => record.sessionId === id);
    await sdk.command({ type: "session.configure", sessionId: id, expectedRevision: session().revision, controls: { ...session().controls, modelId: f.modelId } });
    const send = async (text: string) => {
      const saved = await sdk.command({ type: "draft.save", sessionId: id, expectedRevision: session().draft.revision, text, attachments: [] });
      await sdk.command({ type: "message.send", sessionId: id, expectedRevision: saved.revision!, delivery: "queue" });
      await waitFor(() => !session().turnId && session().status === "completed", 10_000);
    };
    await send("Fix the login timeout in the auth service when the token refresh fails on slow networks.");
    assert.equal(session().title, titles[0]);
    await send("Also add tests for the login timeout and the token refresh path in the auth service.");
    assert.equal(session().title, titles[0]); assert.equal(titleRecords().length, 1);
    await send("Design a dark mode palette for the settings dashboard with accessible contrast ratios and chart colors.");
    assert.equal(session().title, titles[1]); assert.equal(session().titleSource, "model");
    const records = titleRecords();
    assert.equal(records.length, 2); assert.equal(records[1]!.purpose, "refresh"); assert.equal(records[1]!.status, "completed");

    await sdk.command({ type: "session.organize", sessionId: id, expectedRevision: session().revision, changes: { title: "Generated user title" } });
    await send("Write a migration guide for the billing database schema with rollback steps and verification queries.");
    assert.equal(session().title, "Generated user title"); assert.equal(titleRecords().length, 2);
  } finally { sdk.disconnect(); await f.close(); }
});
