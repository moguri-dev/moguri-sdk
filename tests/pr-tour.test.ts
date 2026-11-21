import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_PR_TOUR_PROMPT, PR_TOUR_LIMITS, PR_TOUR_WORKFLOW_PROMPT_LIMIT, effectivePrTourPrompt, parsePrTour, prTourPromptSource, prTourRequestOf,
  prTourSnippet, prTourStatus, prTourWorkflowPrompt, type PrTour, type PrTourSessionView,
} from "../packages/protocol/src/index.ts";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { setupFixture } from "./fixture.ts";

const URL = "https://github.com/generated-owner/generated-repo/pull/7", HEAD = "a".repeat(40), OTHER = "b".repeat(40);
const tour = (values: Partial<PrTour> = {}): PrTour => ({
  version: 1, pr: 7, headSha: HEAD, risk: "medium", impact: "high", attention: "low", overview: "Adds `generatedHelper` to the generated module.",
  steps: [
    { title: "Generated schema", summary: "Declares the shape.", snippets: [{ path: "src/schema.ts", startLine: 3, endLine: 5 }] },
    { title: "Generated consumer", summary: "Uses the shape.", snippets: [{ path: "src/use.ts" }] },
  ],
  edges: [{ from: 1, to: 2, label: "consumed by" }], ...values,
});
const fenced = (value: unknown, fence = "```") => `${fence}moguri-tour\n${typeof value === "string" ? value : JSON.stringify(value, null, 2)}\n${fence}`;

test("the parser reads the last moguri-tour block and explains every rejection", () => {
  const parsed = parsePrTour(`Here is the tour.\n\n${fenced(tour())}\n`);
  assert.ok(parsed.ok); assert.equal(parsed.tour.steps.length, 2);
  const last = parsePrTour(`${fenced(tour({ risk: "low" }))}\nRevised:\n${fenced(tour({ risk: "high" }), "````")}`);
  assert.ok(last.ok); assert.equal(last.tour.risk, "high", "the last block wins");
  const missing = parsePrTour("```json\n{}\n```");
  assert.ok(!missing.ok); assert.match(missing.error, /no ```moguri-tour block/);
  const broken = parsePrTour(fenced("{ \"version\": 1,"));
  assert.ok(!broken.ok); assert.match(broken.error, /not valid JSON/);
  const shape = parsePrTour(fenced({ ...tour(), risk: "extreme" }));
  assert.ok(!shape.ok); assert.match(shape.error, /expected format at \/risk/);
  const extra = parsePrTour(fenced({ ...tour(), generated: true }));
  assert.ok(!extra.ok); assert.match(extra.error, /expected format/);
  const cut = parsePrTour(`${fenced(tour())}\n\`\`\`moguri-tour\n{"version":1`);
  assert.ok(!cut.ok); assert.match(cut.error, /not closed/);
  const edge = parsePrTour(fenced(tour({ edges: [{ from: 1, to: 3, label: "uses" }] })));
  assert.ok(!edge.ok); assert.match(edge.error, /Connection 1 must join two different steps between 1 and 2/);
  const range = parsePrTour(fenced(tour({ steps: [{ title: "Generated", summary: "Generated.", snippets: [{ path: "a.ts", startLine: 9, endLine: 2 }] }], edges: [] })));
  assert.ok(!range.ok); assert.match(range.error, /Step 1 snippet 1 ends before it starts/);
  assert.ok(!parsePrTour(fenced(tour({ steps: [] }))).ok, "a tour needs at least one step");
});

test("the tour prompt comes from the repository, then the global setting, then the default", () => {
  assert.equal(effectivePrTourPrompt({}, null), DEFAULT_PR_TOUR_PROMPT);
  assert.equal(prTourPromptSource({}, null), "default");
  const global = { prTour: { prompt: "Generated global tour prompt." } };
  assert.equal(effectivePrTourPrompt(global, { repo: {} }), "Generated global tour prompt.");
  assert.equal(effectivePrTourPrompt(global, { repo: { tourPrompt: "Generated repository prompt." } }), "Generated repository prompt.");
  assert.equal(prTourPromptSource(global, { repo: { tourPrompt: "Generated repository prompt." } }), "repository");
  assert.equal(effectivePrTourPrompt(global, { repo: { tourPrompt: "  " } }), "Generated global tour prompt.", "blank overrides inherit");
  assert.equal(effectivePrTourPrompt({ prTour: { prompt: "" } }, null), DEFAULT_PR_TOUR_PROMPT);
});

test("the queued request binds the exact PR head, keeps the fixed contract and fits the workflow limit", () => {
  const prompt = prTourWorkflowPrompt({ url: URL, number: 7, headSha: HEAD, changedFiles: 12, prompt: "Generated user prompt." });
  assert.ok(prompt.startsWith("Generated user prompt."));
  assert.deepEqual(prTourRequestOf(`/pr-tour ${prompt}`), { url: URL, number: 7, headSha: HEAD });
  assert.match(prompt, /12 changed files/);
  assert.match(prompt, /info string is moguri-tour/);
  assert.match(prompt, /"resource":"files","repository":"generated-owner\/generated-repo","number":7/);
  assert.ok(prompt.includes(`"headSha":"${HEAD}"`)); assert.match(prompt, /read-only/);
  const longest = prTourWorkflowPrompt({ url: `https://github.com/${"o".repeat(39)}/${"r".repeat(100)}/pull/999999`, number: 999999, headSha: HEAD,
    changedFiles: 3000, prompt: "x".repeat(PR_TOUR_LIMITS.prompt) });
  assert.ok(longest.length <= PR_TOUR_WORKFLOW_PROMPT_LIMIT, `${longest.length} characters`);
  assert.throws(() => prTourWorkflowPrompt({ url: URL, number: 7, headSha: HEAD, prompt: "x".repeat(PR_TOUR_LIMITS.prompt + 1) }), /longer than 8000/);
  assert.throws(() => prTourWorkflowPrompt({ url: URL, number: 7, headSha: "abc1234", prompt: "" }), /no verified head SHA/);
  assert.ok(prTourWorkflowPrompt({ url: URL, number: 7, headSha: HEAD, prompt: " " }).startsWith(DEFAULT_PR_TOUR_PROMPT));
});

test("tour status follows the real queue and transcript, including failures and newer heads", () => {
  const request = (head: string) => `/pr-tour ${prTourWorkflowPrompt({ url: URL, number: 7, headSha: head, prompt: "Generated." })}`;
  const session = (values: Partial<PrTourSessionView>): PrTourSessionView => ({ queue: [], messages: [], turnId: null, status: "idle", ...values });
  assert.deepEqual(prTourStatus(session({}), URL), { pending: null, latest: null, tour: null });
  const queued = prTourStatus(session({ queue: [{ id: "q1", text: request(HEAD), workflow: { kind: "pr-tour" } }] }), URL);
  assert.equal(queued.pending?.kind, "queued");
  assert.equal(prTourStatus(session({ queue: [{ id: "q1", text: request(HEAD), workflow: { kind: "pr-tour" } }] }), "https://github.com/generated-owner/generated-repo/pull/8").pending, null);
  const at = "2026-11-21T10:00:00.000Z";
  const sent = (turnId: string, head: string) => ({ id: `u-${turnId}`, turnId, role: "user", text: request(head), timestamp: at });
  const running = prTourStatus(session({ turnId: "t1", status: "waiting_input", messages: [sent("t1", HEAD),
    { id: "a0", turnId: "t1", role: "assistant", text: "", timestamp: at, toolCalls: [{}, {}] }] }), URL);
  assert.deepEqual(running.pending, { kind: "running", request: { url: URL, number: 7, headSha: HEAD }, turnId: "t1", waiting: true, toolCalls: 2 });
  assert.equal(running.latest, null);
  const ready = prTourStatus(session({ status: "completed", messages: [sent("t1", HEAD), { id: "a1", turnId: "t1", role: "assistant", text: fenced(tour()), timestamp: at }] }), URL);
  assert.equal(ready.latest?.kind, "ready"); assert.equal(ready.tour?.tour.headSha, HEAD);
  const failed = prTourStatus(session({ status: "failed", messages: [sent("t1", HEAD), { id: "a1", turnId: "t1", role: "assistant", text: fenced(tour()), timestamp: at },
    sent("t2", OTHER), { id: "a2", turnId: "t2", role: "assistant", text: "I couldn't read the diff.", timestamp: at },
    { id: "n2", turnId: "t2", role: "notice", text: "Generated provider failure.", timestamp: at, outcome: "failed" }] }), URL);
  assert.equal(failed.latest?.kind, "failed");
  assert.ok(failed.latest?.kind === "failed" && /no ```moguri-tour block.*ended failed: Generated provider failure/.test(failed.latest.error));
  assert.equal(failed.tour?.turnId, "t1", "the older valid tour stays available");
  const mismatch = prTourStatus(session({ messages: [sent("t3", OTHER), { id: "a3", turnId: "t3", role: "assistant", text: fenced(tour()), timestamp: at }] }), URL);
  assert.ok(mismatch.latest?.kind === "failed" && /names head aaaaaaa, but bbbbbbb was requested/.test(mismatch.latest.error));
});

test("snippets show the new-file range with context, removed lines in place and gaps between hunks", () => {
  const patch = "@@ -1,4 +1,5 @@\n one\n-two\n+TWO\n+two-b\n three\n four\n@@ -20,2 +21,3 @@\n twenty\n+added\n twenty-one\n\\ No newline at end of file";
  const view = prTourSnippet(patch, 2, 3, 1);
  assert.equal(view.found, true);
  assert.deepEqual(view.lines.map((line) => [line.kind, line.oldLine ?? null, line.newLine ?? null, line.text]), [
    ["context", 1, 1, "one"], ["remove", 2, null, "two"], ["add", null, 2, "TWO"], ["add", null, 3, "two-b"], ["context", 3, 4, "three"]]);
  assert.deepEqual([view.additions, view.deletions], [2, 1]);
  const across = prTourSnippet(patch, 5, 22, 0);
  assert.ok(across.lines.some((line) => line.kind === "gap"), "non-adjacent hunks are separated");
  assert.deepEqual(prTourSnippet(patch).lines.filter((line) => line.kind !== "gap").length, 6, "no range shows the first hunk");
  assert.equal(prTourSnippet(patch, 10, 12, 0).found, false, "unchanged lines outside every hunk are reported, not invented");
  assert.equal(prTourSnippet(patch, 1, 30, 0, 3).omitted, 6);
});

test("the service keeps the global tour prompt and a repository override, and resets them without touching other settings", { skip: process.platform !== "darwin" }, async () => {
  const f = await setupFixture(), sdk = await new MoguriSdk(f.service.connection).ready();
  try {
    const values = sdk.settings.get()!.values;
    await assert.rejects(sdk.settings.update({ ...values, prTour: { prompt: "x".repeat(PR_TOUR_LIMITS.prompt + 1) } }, sdk.settings.get()!.revision));
    await sdk.settings.update({ ...values, prTour: { prompt: "Generated global tour prompt." } }, sdk.settings.get()!.revision);
    const projectId = f.session().projectId!, { configuration } = await sdk.projects.configuration(projectId);
    await sdk.projects.configure(projectId, { ...configuration.values, repo: { ...configuration.values.repo, tourPrompt: "Generated repository tour prompt." } }, configuration.revision);
    const saved = (await sdk.projects.configuration(projectId)).configuration.values;
    assert.equal(effectivePrTourPrompt(sdk.settings.get()!.values, saved), "Generated repository tour prompt.");
    await sdk.settings.reset("prTour", sdk.settings.get()!.revision);
    assert.equal(sdk.settings.get()!.values.prTour, undefined);
    assert.deepEqual(sdk.settings.get()!.values.git, values.git);
    assert.equal(effectivePrTourPrompt(sdk.settings.get()!.values, { repo: {} }), DEFAULT_PR_TOUR_PROMPT);
  } finally { sdk.disconnect(); await f.close(); }
});
