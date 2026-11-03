import { factoryControls, type EventInput } from "../../packages/protocol/src/index.ts";
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
