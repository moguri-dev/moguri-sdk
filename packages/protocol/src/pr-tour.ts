import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";

/**
 * Protocol 118 (D64): guided pull request tours. A tour is written by the chat's own agent in an ordinary read-only `pr-tour`
 * workflow turn and returned as JSON in a fenced `moguri-tour` block of its final reply. Nothing here is retained separately:
 * clients derive the tour from the session transcript and validate it with this schema. See docs/architecture/pr-tours.md.
 */
const object = <T extends Record<string, TSchema>>(properties: T) => Type.Object(properties, { additionalProperties: false });
export const PR_TOUR_LIMITS = { steps: 12, snippets: 6, edges: 24, overview: 4000, title: 120, summary: 2000, note: 500, label: 80, path: 1024, prompt: 8000 } as const;
/** The queued workflow prompt limit from `WorkflowCommandSchema`. */
export const PR_TOUR_WORKFLOW_PROMPT_LIMIT = 16384;
export const PrTourLevelSchema = Type.Union([Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")]);
export type PrTourLevel = Static<typeof PrTourLevelSchema>;
const line = Type.Integer({ minimum: 1, maximum: 10_000_000 });
const text = (maxLength: number) => Type.String({ minLength: 1, maxLength });
export const PrTourSnippetSchema = object({
  path: text(PR_TOUR_LIMITS.path), startLine: Type.Optional(line), endLine: Type.Optional(line), note: Type.Optional(Type.String({ maxLength: PR_TOUR_LIMITS.note })),
});
export const PrTourStepSchema = object({
  title: text(PR_TOUR_LIMITS.title), summary: text(PR_TOUR_LIMITS.summary),
  snippets: Type.Array(PrTourSnippetSchema, { maxItems: PR_TOUR_LIMITS.snippets }),
});
export const PrTourEdgeSchema = object({
  from: Type.Integer({ minimum: 1, maximum: PR_TOUR_LIMITS.steps }), to: Type.Integer({ minimum: 1, maximum: PR_TOUR_LIMITS.steps }), label: text(PR_TOUR_LIMITS.label),
});
export const PrTourSchema = object({
  version: Type.Literal(1), pr: Type.Integer({ minimum: 1 }), headSha: Type.String({ pattern: "^(?:[a-f0-9]{40}|[a-f0-9]{64})$" }),
  risk: PrTourLevelSchema, impact: PrTourLevelSchema, attention: PrTourLevelSchema, overview: text(PR_TOUR_LIMITS.overview),
  steps: Type.Array(PrTourStepSchema, { minItems: 1, maxItems: PR_TOUR_LIMITS.steps }),
  edges: Type.Array(PrTourEdgeSchema, { maxItems: PR_TOUR_LIMITS.edges }),
});
export type PrTour = Static<typeof PrTourSchema>;
export type PrTourSnippet = Static<typeof PrTourSnippetSchema>;
export type PrTourParse = { ok: true; tour: PrTour } | { ok: false; error: string };

/** The body of the last complete fenced block whose info string is exactly `moguri-tour`, or why there is none. */
function lastTourBlock(reply: string): { body: string } | { error: string } {
  const lines = reply.split(/\r?\n/);
  let found: { body: string } | { error: string } = { error: "The reply has no ```moguri-tour block. The agent may have answered in prose or stopped early." };
  for (let index = 0; index < lines.length; index++) {
    const open = /^ {0,3}(`{3,}|~{3,})[ \t]*moguri-tour[ \t]*$/.exec(lines[index]!);
    if (!open) continue;
    const fence = open[1]!, close = new RegExp(`^ {0,3}${fence[0] === "`" ? "`" : "~"}{${fence.length},}[ \\t]*$`);
    const end = lines.findIndex((value, position) => position > index && close.test(value));
    if (end < 0) { found = { error: "The last ```moguri-tour block is not closed, so the reply was probably cut off." }; break; }
    found = { body: lines.slice(index + 1, end).join("\n") };
    index = end;
  }
  return found;
}
/** Reads the tour from an assistant reply. It never throws: bad model output becomes a readable error. */
export function parsePrTour(reply: string): PrTourParse {
  const block = lastTourBlock(reply);
  if ("error" in block) return { ok: false, error: block.error };
  if (!block.body.trim()) return { ok: false, error: "The ```moguri-tour block is empty." };
  let value: unknown;
  try { value = JSON.parse(block.body); }
  catch (error) { return { ok: false, error: `The \`\`\`moguri-tour block is not valid JSON: ${error instanceof Error ? error.message : "parse error"}.` }; }
  if (!Value.Check(PrTourSchema, value)) {
    const issue = [...Value.Errors(PrTourSchema, value)][0];
    return { ok: false, error: `The tour doesn't match the expected format${issue ? ` at ${issue.instancePath || "/"}: ${issue.message}` : ""}.` };
  }
  const tour = value;
  const edge = tour.edges.findIndex((entry) => entry.from > tour.steps.length || entry.to > tour.steps.length || entry.from === entry.to);
  if (edge >= 0) return { ok: false, error: `Connection ${edge + 1} must join two different steps between 1 and ${tour.steps.length}.` };
  for (const [stepIndex, step] of tour.steps.entries()) for (const [snippetIndex, snippet] of step.snippets.entries()) {
    const at = `Step ${stepIndex + 1} snippet ${snippetIndex + 1}`;
    if (snippet.endLine !== undefined && snippet.startLine === undefined) return { ok: false, error: `${at} has endLine without startLine.` };
    if (snippet.startLine !== undefined && snippet.endLine !== undefined && snippet.endLine < snippet.startLine) return { ok: false, error: `${at} ends before it starts.` };
  }
  return { ok: true, tour };
}

export const DEFAULT_PR_TOUR_PROMPT = `Write a guided review tour of this pull request for a reviewer who hasn't seen it.
- Overview: say what the change does and why in two to four sentences.
- Rate risk (how likely it breaks something), impact (how much behavior or how many users it affects) and attention (how much careful human review it needs) as low, medium or high, judged from the actual diff.
- Order the steps so each builds on the previous one: foundations such as types, schemas and data first, then the logic that uses them, then the surfaces (UI, CLI, API), then tests. Use at most 8 steps and group related files.
- For each step, explain what changed and what to check, and pick the smallest snippets that show the important change.
- Call out security, data migrations, concurrency, error handling, public API changes and missing tests.
- Skip generated files, lockfiles, snapshots, binary assets and vendored code unless they are the point of the change.
- Use plain, concise language. Don't praise the change or restate the diff line by line.`;

type PromptSettings = { prTour?: { prompt: string } };
type PromptProject = { repo: { tourPrompt?: string } } | null | undefined;
const present = (value: string | undefined): value is string => Boolean(value?.trim());
/** Where the effective tour prompt comes from: this repository's override, the global setting or Moguri's default. */
export function prTourPromptSource(settings: PromptSettings, project: PromptProject): "repository" | "global" | "default" {
  return present(project?.repo.tourPrompt) ? "repository" : present(settings.prTour?.prompt) ? "global" : "default";
}
/** The tour prompt for a repository: its override when set, else the global setting, else the default. Blank text inherits. */
export function effectivePrTourPrompt(settings: PromptSettings, project: PromptProject): string {
  const source = prTourPromptSource(settings, project);
  return source === "repository" ? project!.repo.tourPrompt! : source === "global" ? settings.prTour!.prompt : DEFAULT_PR_TOUR_PROMPT;
}

export interface PrTourRequest { url: string; number: number; headSha: string }
const marker = /^Pull request: (\S+) \(#([1-9]\d*)\) at head ([a-f0-9]{40}|[a-f0-9]{64})/gm;
/** The PR binding of a queued or sent tour request: the last marker line, which Moguri writes after the user's prompt. */
export function prTourRequestOf(text: string): PrTourRequest | null {
  const match = [...text.matchAll(marker)].at(-1);
  return match ? { url: match[1]!, number: Number(match[2]), headSha: match[3]! } : null;
}
/**
 * The queued `pr-tour` workflow text: the user's prompt, the exact PR binding and a fixed output contract that the user can't edit.
 * Throws when the inputs can't be bound exactly, so a tour is never requested for a guessed head.
 */
export function prTourWorkflowPrompt(input: { url: string; number: number; headSha: string; changedFiles?: number; prompt: string }): string {
  if (!/^https:\/\/\S+$/.test(input.url)) throw new Error("This pull request has no canonical URL, so no tour was requested.");
  if (!Number.isSafeInteger(input.number) || input.number < 1) throw new Error("This pull request has no verified number, so no tour was requested.");
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(input.headSha)) throw new Error("This pull request has no verified head SHA. No SHA was guessed and no tour was requested.");
  if (input.prompt.length > PR_TOUR_LIMITS.prompt) throw new Error(`The tour prompt is longer than ${PR_TOUR_LIMITS.prompt} characters. Shorten it in Settings; nothing was queued.`);
  const repository = /^https:\/\/github\.com\/([^/\s]+\/[^/\s]+)\/pull\/\d+/.exec(input.url)?.[1];
  const files = input.changedFiles !== undefined ? `, ${input.changedFiles} changed file${input.changedFiles === 1 ? "" : "s"}` : "";
  const shape = { version: 1, pr: input.number, headSha: input.headSha, risk: "low", impact: "medium", attention: "high", overview: "...",
    steps: [{ title: "...", summary: "...", snippets: [{ path: "src/example.ts", startLine: 10, endLine: 24, note: "..." }] }],
    edges: [{ from: 1, to: 2, label: "consumed by" }] };
  const text = `${(input.prompt.trim() || DEFAULT_PR_TOUR_PROMPT)}

Pull request: ${input.url} (#${input.number}) at head ${input.headSha}${files}.

Tour contract (fixed by Moguri):
- This turn is read-only. Don't edit files, run commands, commit, push, comment, review or start other work.
- Read the diff at exactly this head with github_read: action project, then browse {"resource":"files",${repository ? `"repository":"${repository}",` : ""}"number":${input.number},"headSha":"${input.headSha}"} with the project's account, following nextPage. Read related code only with read-only tools. If you can't read this head, say so instead of guessing.
- End your final reply with one fenced block whose info string is moguri-tour, holding only JSON of this shape:
${JSON.stringify(shape)}
- Keep pr and headSha exactly as above. risk, impact and attention are each low, medium or high.
- 1 to ${PR_TOUR_LIMITS.steps} steps with up to ${PR_TOUR_LIMITS.snippets} snippets each, and up to ${PR_TOUR_LIMITS.edges} edges joining 1-based step numbers with a short label. Titles up to ${PR_TOUR_LIMITS.title} characters, summaries up to ${PR_TOUR_LIMITS.summary}, overview up to ${PR_TOUR_LIMITS.overview}.
- path is a changed file's repository path. startLine and endLine are new-file line numbers inside that file's diff hunks; omit both to show its first hunk.
- In overview and summaries, wrap file names and identifiers in backticks and use no other markdown.`;
  if (text.length > PR_TOUR_WORKFLOW_PROMPT_LIMIT) throw new Error("The tour request is too long for one workflow prompt. Shorten the tour prompt; nothing was queued.");
  return text;
}

interface TourMessage { id: string; turnId: string; role: string; text: string; timestamp: string; outcome?: string; toolCalls?: readonly unknown[] }
interface TourQueueItem { id: string; text: string; workflow?: { kind: string } }
/** The parts of a session a tour status reads. */
export interface PrTourSessionView {
  queue: readonly TourQueueItem[]; messages: readonly TourMessage[]; turnId: string | null; status: string;
  pendingApproval?: unknown; pendingQuestionId?: string | null;
}
export type PrTourResult =
  | { kind: "ready"; tour: PrTour; request: PrTourRequest; turnId: string; at: string }
  | { kind: "failed"; error: string; request: PrTourRequest; turnId: string; at: string };
export interface PrTourStatus {
  /** A queued request, or the running turn with whether it waits for the user and how many tool calls it made so far. */
  pending: { kind: "queued"; request: PrTourRequest } | { kind: "running"; request: PrTourRequest; turnId: string; waiting: boolean; toolCalls: number } | null;
  /** The newest finished request's outcome. */
  latest: PrTourResult | null;
  /** The newest valid tour, which can be older than a later failed request. */
  tour: Extract<PrTourResult, { kind: "ready" }> | null;
}
const isTourText = (text: string) => text === "/pr-tour" || text.startsWith("/pr-tour ");
function finished(session: PrTourSessionView, request: PrTourRequest, turnId: string, sent: string): PrTourResult {
  const turn = session.messages.filter((message) => message.turnId === turnId);
  const replies = turn.filter((message) => message.role === "assistant");
  const reply = replies.findLast((message) => message.text.includes("moguri-tour")) ?? replies.at(-1);
  const notice = turn.findLast((message) => message.role === "notice" && message.outcome);
  const ended = notice ? ` The turn ended ${notice.outcome}: ${notice.text}` : "";
  if (!reply) return { kind: "failed", error: `The tour turn ended without a reply.${ended}`, request, turnId, at: notice?.timestamp ?? sent };
  const parsed = parsePrTour(reply.text);
  const fail = (error: string): PrTourResult => ({ kind: "failed", error: `${error}${ended}`, request, turnId, at: reply.timestamp });
  if (!parsed.ok) return fail(parsed.error);
  if (parsed.tour.pr !== request.number) return fail(`The tour names PR #${parsed.tour.pr}, but #${request.number} was requested.`);
  if (parsed.tour.headSha !== request.headSha) return fail(`The tour names head ${parsed.tour.headSha.slice(0, 7)}, but ${request.headSha.slice(0, 7)} was requested.`);
  return { kind: "ready", tour: parsed.tour, request, turnId, at: reply.timestamp };
}
/** Derives one PR's tour state from the session's real queue and transcript; nothing is invented while a turn runs. */
export function prTourStatus(session: PrTourSessionView, url: string): PrTourStatus {
  const queued = session.queue.flatMap((item) => {
    const request = item.workflow?.kind === "pr-tour" ? prTourRequestOf(item.text) : null;
    return request?.url === url ? [request] : [];
  });
  const requests = session.messages.flatMap((message) => {
    const request = message.role === "user" && isTourText(message.text) ? prTourRequestOf(message.text) : null;
    return request?.url === url ? [{ request, message }] : [];
  });
  const running = session.turnId ? requests.findLast((entry) => entry.message.turnId === session.turnId) : undefined;
  const results = requests.filter((entry) => entry !== running).map((entry) => finished(session, entry.request, entry.message.turnId, entry.message.timestamp));
  const pending: PrTourStatus["pending"] = running ? {
    kind: "running", request: running.request, turnId: running.message.turnId,
    waiting: session.status === "waiting_input" || Boolean(session.pendingApproval || session.pendingQuestionId),
    toolCalls: session.messages.filter((message) => message.turnId === running.message.turnId && message.role === "assistant")
      .reduce((count, message) => count + (message.toolCalls?.length ?? 0), 0),
  } : queued.length ? { kind: "queued", request: queued.at(-1)! } : null;
  const tour = results.findLast((result): result is Extract<PrTourResult, { kind: "ready" }> => result.kind === "ready");
  return { pending, latest: results.at(-1) ?? null, tour: tour ?? null };
}

export interface PrTourSnippetLine { kind: "add" | "remove" | "context" | "gap"; oldLine?: number; newLine?: number; text: string }
export interface PrTourSnippetView { lines: PrTourSnippetLine[]; found: boolean; additions: number; deletions: number; omitted: number }
/**
 * The patch lines around new-file lines startLine..endLine with a little context, or the first hunk when no range is given.
 * Removed lines are kept where they sit between selected lines. `found` is false when the range isn't part of the diff.
 */
export function prTourSnippet(patch: string, startLine?: number, endLine?: number, context = 2, maxLines = 80): PrTourSnippetView {
  const parsed: (PrTourSnippetLine & { hunk: number; anchor: number })[] = [];
  let oldLine = 0, newLine = 0, hunk = -1;
  for (const raw of patch.replace(/\n$/, "").split("\n")) {
    const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (header) { oldLine = Number(header[1]); newLine = Number(header[2]); hunk++; continue; }
    if (hunk < 0 || raw.startsWith("\\")) continue;
    if (raw.startsWith("+")) { parsed.push({ kind: "add", newLine, text: raw.slice(1), hunk, anchor: newLine }); newLine++; }
    else if (raw.startsWith("-")) { parsed.push({ kind: "remove", oldLine, text: raw.slice(1), hunk, anchor: newLine }); oldLine++; }
    else { parsed.push({ kind: "context", oldLine, newLine, text: raw.slice(1), hunk, anchor: newLine }); oldLine++; newLine++; }
  }
  const start = startLine ?? 0, end = endLine ?? startLine ?? 0;
  const chosen = startLine === undefined ? parsed.filter((value) => value.hunk === 0) : parsed.filter((value) => value.anchor >= start - context && value.anchor <= end + context);
  const found = startLine === undefined ? chosen.length > 0 : chosen.some((value) => value.anchor >= start && value.anchor <= end);
  if (!found) return { lines: [], found: false, additions: 0, deletions: 0, omitted: 0 };
  const lines: PrTourSnippetLine[] = [];
  let previous = -1;
  for (const value of chosen) {
    const index = parsed.indexOf(value);
    if (previous >= 0 && (index !== previous + 1 || parsed[previous]!.hunk !== value.hunk)) lines.push({ kind: "gap", text: "" });
    const { hunk: _hunk, anchor: _anchor, ...line } = value;
    lines.push(line); previous = index;
  }
  return { lines: lines.slice(0, maxLines), found: true, omitted: lines.slice(maxLines).filter((line) => line.kind !== "gap").length,
    additions: chosen.filter((value) => value.kind === "add").length, deletions: chosen.filter((value) => value.kind === "remove").length };
}
