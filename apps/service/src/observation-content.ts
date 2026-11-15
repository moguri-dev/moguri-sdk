import { isDeepStrictEqual } from "node:util";
import type { LocalIssue, PullRequestLink } from "../../../packages/protocol/src/index.ts";

// Observation times and revision counters are scheduling metadata, not retained card history.
const link = (value: PullRequestLink) => ({ ...value, checkedAt: null });
export const issueContent = (issue: LocalIssue): unknown => JSON.parse(JSON.stringify({
  ...issue, revision: 0, updatedAt: "", pullRequest: issue.pullRequest && link(issue.pullRequest),
  github: issue.github && { ...issue.github, checkedAt: "", pullRequests: issue.github.pullRequests.map(link) },
}));
export const sameIssueContent = (left: LocalIssue, right: LocalIssue): boolean => isDeepStrictEqual(issueContent(left), issueContent(right));
export const samePullRequestContent = (left: PullRequestLink, right: PullRequestLink): boolean =>
  isDeepStrictEqual(JSON.parse(JSON.stringify(link(left))), JSON.parse(JSON.stringify(link(right))));
