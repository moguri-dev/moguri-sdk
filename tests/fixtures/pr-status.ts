import { MoguriError } from "../../packages/protocol/src/index.ts";

/** Generated GitHub REST responses for one PR, served to the service's injected fetch. No network or account is used. */
export const GENERATED_PR_URL = "https://github.com/generated-owner/generated-repo/pull/7";
export const GENERATED_PR_BRANCH = "moguri/generated-pr";
export const GENERATED_PR_HEAD = "a".repeat(40);
export interface GeneratedPrState {
  state?: "open" | "closed"; mergeable: boolean | null; mergeableState: string | null;
  reviews: { id: number; state: string; author: string; submittedAt: string }[];
  checks: { name: string; status: string; conclusion: string | null }[];
  statuses?: { context: string; state: "pending" | "success" | "failure" | "error" }[];
}
export function generatedPrFetch(current: () => GeneratedPrState, reads: string[] = []): typeof fetch {
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  return (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input), state = current();
    reads.push(url);
    const base = "https://api.github.com/repos/generated-owner/generated-repo";
    if (url === `${base}/pulls/7`) return json({ number: 7, html_url: GENERATED_PR_URL, state: state.state ?? "open", merged: false, draft: false,
      head: { sha: GENERATED_PR_HEAD, ref: GENERATED_PR_BRANCH }, user: { login: "generated-author" }, mergeable: state.mergeable, mergeable_state: state.mergeableState });
    if (url.startsWith(`${base}/pulls/7/reviews`)) return json(state.reviews.map((review) => ({ id: review.id, state: review.state, user: { login: review.author }, submitted_at: review.submittedAt })));
    if (url.startsWith(`${base}/commits/${GENERATED_PR_HEAD}/check-runs`)) return json({ total_count: state.checks.length,
      check_runs: state.checks.map((check) => ({ ...check, head_sha: GENERATED_PR_HEAD })) });
    if (url.startsWith(`${base}/commits/${GENERATED_PR_HEAD}/status`)) return json({ state: "pending", total_count: state.statuses?.length ?? 0, statuses: state.statuses ?? [] });
    return new Response(JSON.stringify({ message: "Not Found" }), { status: 404, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
}

/** The same generated responses through the service's GitHub CLI read hook; a missing endpoint fails like an unreadable `gh api` call. */
export function generatedPrCliRead(current: () => GeneratedPrState, reads: string[] = []) {
  const read = generatedPrFetch(current, reads);
  return async (endpoint: string) => {
    const response = await read(`https://api.github.com/${endpoint}`);
    if (!response.ok) throw new MoguriError("github_cli_unavailable", "The generated GitHub CLI account could not read this reference.", 403);
    return response.json() as Promise<unknown>;
  };
}
