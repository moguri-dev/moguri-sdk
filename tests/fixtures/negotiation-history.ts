import type { EventInput } from "../../packages/protocol/src/index.ts";

export function generatedNegotiationHistory(sessionId: string, projectId: string | null, finalText: string, profileId = "default"): EventInput[] {
  const text = "Generated retained handshake history. ".repeat(1650);
  return Array.from({ length: 1000 }, (_, index) => ({
    event_type: "draft.saved", profile_id: profileId, project_id: projectId, session_id: sessionId,
    payload: { text: index === 999 ? finalText : `${index} ${text}`, attachments: [] },
  }));
}
