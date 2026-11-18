/** Generated GitHub REST responses for one PR, served to the service's injected fetch. No network or account is used. */
export const GENERATED_PR_URL = "https://github.com/generated-owner/generated-repo/pull/7";
export const GENERATED_PR_BRANCH = "moguri/generated-pr";
export const GENERATED_PR_HEAD = "a".repeat(40);
export interface GeneratedPrState {
  state?: "open" | "closed"; mergeable: boolean | null; mergeableState: string | null;
  reviews: { id: number; state: string; author: string; submittedAt: string }[];
  checks: { name: string; status: string; conclusion: string | null }[];
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
    return new Response(JSON.stringify({ message: "Not Found" }), { status: 404, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
}
