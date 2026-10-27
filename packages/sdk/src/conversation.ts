import { ClientError } from "../../client/src/index.ts";
import type { PublicMessage, QuestionAnswer, Session, UserQuestion } from "../../protocol/src/index.ts";

interface ConversationSnapshot {
  profileId: string;
  sessions: readonly Pick<Session, "id" | "messages">[];
  questions: readonly UserQuestion[];
}
interface ConversationPoint {
  id: string; profileId: string; sessionId: string; turnId: string;
  messageId: string; messageIndex: number; timestamp: string; text: string;
}
export type ConversationNavigationEntry =
  | ConversationPoint & { kind: "prompt" }
  | ConversationPoint & { kind: "answer"; questionId: string; answer: string };

export function conversationNavigation(snapshot: ConversationSnapshot, sessionId: string): ConversationNavigationEntry[] {
  const session = snapshot.sessions.find((session) => session.id === sessionId);
  if (!session) throw new ClientError("session_missing", "Choose an existing session in this profile to navigate its conversation.");
  const answered = new Map<string, Array<{ question: UserQuestion; answer: QuestionAnswer }>>();
  const key = (turnId: string, stepId: string) => JSON.stringify([turnId, stepId]);
  for (const question of snapshot.questions) {
    const answer = question.answer;
    if (question.sessionId !== sessionId || question.status !== "answered" || answer?.actor !== "user") continue;
    const id = key(question.turnId, question.stepId), values = answered.get(id) ?? [];
    values.push({ question, answer }); answered.set(id, values);
  }
  const point = (kind: ConversationNavigationEntry["kind"], id: string, message: PublicMessage, messageIndex: number): ConversationPoint => ({
    id: JSON.stringify([snapshot.profileId, sessionId, kind, id]), profileId: snapshot.profileId, sessionId, turnId: message.turnId,
    messageId: message.id, messageIndex, timestamp: message.timestamp, text: message.text,
  });
  const entries: ConversationNavigationEntry[] = [];
  session.messages.forEach((message, index) => {
    if (message.role === "user") entries.push({ ...point("prompt", message.id, message, index), kind: "prompt", text: message.text.trim() ? message.text : "Attached context" });
    if (message.role !== "assistant" && message.role !== "notice") return;
    for (const { question, answer } of answered.get(key(message.turnId, message.id)) ?? []) {
      entries.push({ ...point("answer", question.id, message, index), kind: "answer", questionId: question.id,
        timestamp: answer.answeredAt, text: question.question, answer: answer.text });
    }
  });
  return entries;
}
