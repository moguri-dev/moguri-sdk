import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";
import type { DecisionEvidence } from "./decisions.ts";

const object = <T extends Record<string, TSchema>>(properties: T) => Type.Object(properties, { additionalProperties: false });
const questionFields = {
  question: Type.String({ minLength: 1, maxLength: 16 * 1024 }),
  choices: Type.Array(Type.String({ minLength: 1, maxLength: 240 }), { maxItems: 8, uniqueItems: true }),
  allowFreeform: Type.Boolean(),
  recommendation: Type.Optional(object({ choiceIndex: Type.Integer({ minimum: 0, maximum: 7 }), reason: Type.String({ minLength: 1, maxLength: 1200 }) })),
};
export const UserQuestionSchema = object(questionFields);
export type UserQuestionInput = Static<typeof UserQuestionSchema>;
/** Most related questions one ask_user call may batch; a safety bound, not a target. */
export const MAX_QUESTION_BATCH = 16;
/** One ask_user call: a single question, or `questions` the user answers together after reviewing them. */
export const AskUserSchema = object({
  question: Type.Optional(questionFields.question), choices: Type.Optional(questionFields.choices),
  allowFreeform: Type.Optional(questionFields.allowFreeform), recommendation: questionFields.recommendation,
  questions: Type.Optional(Type.Array(UserQuestionSchema, { minItems: 1, maxItems: MAX_QUESTION_BATCH })),
});
export type AskUserInput = Static<typeof AskUserSchema>;
/** The questions of one ask_user call, or null when it mixes the single and batched forms or omits both. */
export function askUserQuestions(input: AskUserInput): UserQuestionInput[] | null {
  const { questions, ...single } = input;
  if (questions) return Object.keys(single).length ? null : questions;
  if (single.question === undefined || single.choices === undefined || single.allowFreeform === undefined) return null;
  return [{ question: single.question, choices: single.choices, allowFreeform: single.allowFreeform, ...(single.recommendation ? { recommendation: single.recommendation } : {}) }];
}
export interface ModelAdviceSource {
  actor: "model"; modelId: string; providerId: string | null; stepId: string; callId: string;
}
export const ModelAdviceSourceSchema = object({
  actor: Type.Literal("model"), modelId: Type.String({ minLength: 1, maxLength: 512 }),
  providerId: Type.Union([Type.String({ minLength: 1, maxLength: 128 }), Type.Null()]),
  stepId: Type.String({ minLength: 1, maxLength: 128 }), callId: Type.String({ minLength: 1, maxLength: 256 }),
});
export interface QuestionRecommendation extends ModelAdviceSource { choice: string; reason: string }
export interface QuestionAnswer {
  text: string; actor: "user" | "model" | "decision-provider"; modelId: string | null; sourceCallId: string | null; answeredAt: string;
  other?: true;
  /** The actual user explicitly skipped the question; `text` is the fixed SKIPPED_ANSWER label, never an answer. */
  skipped?: true;
  decisionId?: string; providerId?: string;
  decisionOrigin?: DecisionEvidence;
}
/** Where a question sits among the related questions of one ask_user call. */
export interface QuestionBatch { id: string; index: number; size: number }
/** The actual user's saved, unsent choice for an open batched question. */
export type QuestionDraft = { text: string; other?: true } | { skipped: true };
export interface UserQuestion extends Omit<UserQuestionInput, "recommendation"> {
  id: string; sessionId: string; projectId: string | null; workspaceId: string | null; turnId: string; stepId: string; callId: string; modelId: string;
  sourceEventId: string | null; revision: number; createdAt: string; status: "open" | "answered" | "cancelled"; answer: QuestionAnswer | null; diagnostic: string | null;
  recommendation?: QuestionRecommendation | null;
  /** Present when the model asked related questions together; the user sends their answers together. */
  batch?: QuestionBatch;
  /** Saved unsent choice; cleared once the question is answered or cancelled. `draftRevision` guards concurrent clients. */
  draft?: QuestionDraft | null; draftRevision?: number;
}
export const SKIPPED_ANSWER = "Skipped";
const questionTarget = {
  type: Type.Literal("question.answer"), questionId: Type.String({ minLength: 1, maxLength: 128 }), expectedRevision: Type.Integer({ minimum: 0 }),
};
const answerText = Type.String({ minLength: 1, maxLength: 32 * 1024 }), questionId = Type.String({ minLength: 1, maxLength: 128 });
const batchAnswer = Type.Union([
  object({ questionId, expectedRevision: Type.Integer({ minimum: 0 }), text: answerText, other: Type.Optional(Type.Literal(true)) }),
  object({ questionId, expectedRevision: Type.Integer({ minimum: 0 }), skip: Type.Literal(true) }),
]);
export const QuestionCommandSchema = Type.Union([
  object({ ...questionTarget, text: answerText,
    other: Type.Optional(Type.Literal(true)),
    consumeDraft: Type.Optional(object({ sessionId: Type.String({ minLength: 1, maxLength: 128 }), expectedRevision: Type.Integer({ minimum: 0 }) })) }),
  object({ ...questionTarget, skip: Type.Literal(true) }),
  /** Answers every open question of one batch atomically; a question may be skipped individually. */
  object({ type: Type.Literal("question.answer_batch"), batchId: Type.String({ minLength: 1, maxLength: 128 }),
    answers: Type.Array(batchAnswer, { minItems: 1, maxItems: MAX_QUESTION_BATCH }) }),
  /** Saves (or clears with null) the actual user's unsent choice for one open batched question. */
  object({ type: Type.Literal("question.draft"), questionId, expectedDraftRevision: Type.Integer({ minimum: 0 }),
    draft: Type.Union([object({ text: answerText, other: Type.Optional(Type.Literal(true)) }), object({ skipped: Type.Literal(true) }), Type.Null()]) }),
]);
export type QuestionCommand = Static<typeof QuestionCommandSchema>;
export const isQuestionCommand = (value: unknown): value is QuestionCommand => Value.Check(QuestionCommandSchema, value);
