import { createHash } from "node:crypto";
import { factoryControls, type EventInput, type LocalIssue } from "../../packages/protocol/src/index.ts";
import { generatedNegotiationHistory } from "./negotiation-history.ts";

export function generatedResponsiveHistory(sessionId: string, projectId: string): EventInput[] {
  const events = generatedNegotiationHistory(sessionId, projectId, "Generated retained responsive draft.");
  for (let index = 0; index < 60; index++) {
    const id = `generated-history-session-${index}`;
    events.push({ event_type: "session.created", profile_id: "default", session_id: id,
      payload: { title: `Generated retained chat ${index}`, controls: factoryControls() } });
    for (let tool = 0; tool < 40; tool++) {
      const call = { id: `${id}-tool-${tool}`, name: "read_file", arguments: { path: "generated.txt" } };
      events.push({ event_type: "tool.started", profile_id: "default", session_id: id, payload: { call } },
        { event_type: "tool.completed", profile_id: "default", session_id: id, payload: { call, outcome: "completed", isError: false,
          text: "Generated retained tool output, never a personal file. ".repeat(24) } });
    }
  }
  return events;
}

export function generatedIssueRevisions(projectId: string, revisions = 25_000, issueCount = 100): EventInput[] {
  const hash = (text: string) => createHash("sha256").update(text).digest("hex");
  const description = "Generated retained issue description with bounded code and prose.\n".repeat(90);
  return Array.from({ length: revisions }, (_, index): EventInput => {
    const number = index % issueCount + 1, revision = Math.floor(index / issueCount);
    const timestamp = new Date(Date.UTC(2026, 0, 1) + index * 1000).toISOString();
    const title = `Generated issue <!-- GENERATED_HIDDEN_TITLE -->${number}`;
    const body = `${description}<!-- GENERATED_HIDDEN_BODY -->\nGenerated revision ${revision}.`;
    const issue: LocalIssue = { id: `generated-imported-issue-${number}`, projectId, number, title, body, kind: "feature",
      phaseId: "backlog", revision, archived: false, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: timestamp,
      pullRequest: null, linear: null, github: {
        nodeId: `GENERATED_ISSUE_${number}`, databaseId: number, repo: "generated/responsiveness", number,
        url: `https://github.com/generated/responsiveness/issues/${number}`, state: "open", stateReason: null,
        updatedAt: timestamp, checkedAt: timestamp, diagnostic: null, sourceDigest: hash(JSON.stringify({ title, body })),
        titleDigest: hash(title), bodyDigest: hash(body), pullRequests: [],
      } };
    return { event_type: "issue.saved", profile_id: "default", project_id: projectId, payload: { issue, actor: "github" } };
  });
}
