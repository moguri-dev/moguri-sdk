import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";

const object = <T extends Record<string, TSchema>>(properties: T) => Type.Object(properties, { additionalProperties: false });
export const UserQuestionSchema = object({
  question: Type.String({ minLength: 1, maxLength: 16 * 1024 }),
  choices: Type.Array(Type.String({ minLength: 1, maxLength: 240 }), { maxItems: 8, uniqueItems: true }),
  allowFreeform: Type.Boolean(),
  recommendation: Type.Optional(object({ choiceIndex: Type.Integer({ minimum: 0, maximum: 7 }), reason: Type.String({ minLength: 1, maxLength: 1200 }) })),
});
export type UserQuestionInput = Static<typeof UserQuestionSchema>;
export interface ModelAdviceSource {
  actor: "model"; modelId: string; providerId: string | null; stepId: string; callId: string;
}
export interface QuestionRecommendation extends ModelAdviceSource { choice: string; reason: string }
export interface QuestionAnswer {
  text: string; actor: "user" | "model" | "decision-provider"; modelId: string | null; sourceCallId: string | null; answeredAt: string;
  decisionId?: string; providerId?: string;
}
export interface UserQuestion extends Omit<UserQuestionInput, "recommendation"> {
  id: string; sessionId: string; projectId: string | null; workspaceId: string | null; turnId: string; stepId: string; callId: string; modelId: string;
  sourceEventId: string | null; revision: number; createdAt: string; status: "open" | "answered" | "cancelled"; answer: QuestionAnswer | null; diagnostic: string | null;
  recommendation?: QuestionRecommendation | null;
}
export const QuestionCommandSchema = object({
  type: Type.Literal("question.answer"), questionId: Type.String({ minLength: 1, maxLength: 128 }),
  expectedRevision: Type.Integer({ minimum: 0 }), text: Type.String({ minLength: 1, maxLength: 32 * 1024 }),
  consumeDraft: Type.Optional(object({ sessionId: Type.String({ minLength: 1, maxLength: 128 }), expectedRevision: Type.Integer({ minimum: 0 }) })),
});
export type QuestionCommand = Static<typeof QuestionCommandSchema>;
export const isQuestionCommand = (value: unknown): value is QuestionCommand => Value.Check(QuestionCommandSchema, value);
