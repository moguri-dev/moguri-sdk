import { Value } from "typebox/value";
import { MoguriError } from "../../../packages/protocol/src/index.ts";
import { DecisionAdviceSchema, DecisionQuestionsSchema, type DecisionQuestions } from "../../../packages/protocol/src/decisions.ts";

const sameKeys = (first: object, second: object) => Object.keys(first).length === Object.keys(second).length && Object.keys(first).every((key) => Object.hasOwn(second, key));
export function decisionAdvice(text: string, questions: DecisionQuestions, minimumConfidence: number, minimumProbability: number) {
  if (!text.isWellFormed() || Buffer.byteLength(text) > 16384 || !Value.Check(DecisionQuestionsSchema, questions) ||
    ![minimumConfidence, minimumProbability].every((value) => Number.isFinite(value) && value >= 0 && value <= 1)) throw new MoguriError("decision_format", "Decision input/output exceeds the exact bounded typed contract. No approval or answer was supplied.", 409);
  let value: unknown;
  try { value = JSON.parse(text); } catch (error) { if (error instanceof SyntaxError) throw new MoguriError("decision_format", "Decision result is not the exact JSON contract. No repair, fallback or permission.", 409); throw error; }
  if (!Value.Check(DecisionAdviceSchema, value) || !sameKeys(value.answers, questions)) throw new MoguriError("decision_format", "Decision result violates the named answer schema/contract or adds authority fields. No approval or user answer.", 409);
  let eligible = true;
  for (const [name, question] of Object.entries(questions)) {
    const answer = value.answers[name];
    if (!answer || answer.type !== question.type) throw new MoguriError("decision_format", "Each original named question needs exactly its declared result type.", 409);
    if (question.type === "noul") { eligible = false; continue; }
    if (answer.type === "noul") throw new MoguriError("decision_format", "A predicate cannot replace a named choice or score.", 409);
    const expected = question.type === "choice" ? question.criteria : Object.fromEntries(question.criteria.map((label, index) => [String(index), label]));
    if (!sameKeys(answer.probabilities, expected) || Math.abs(Object.values(answer.probabilities).reduce((sum, value) => sum + value, 0) - 1) > 0.001) throw new MoguriError("decision_format", "Decision alternatives/probability distribution changed or does not sum to one.", 409);
    if (question.type === "choice" && answer.type === "choice") {
      const selected = answer.probabilities[answer.choice];
      if (selected === undefined || !Object.hasOwn(expected, answer.choice) || Object.values(answer.probabilities).some((value) => value > selected + 0.001)) throw new MoguriError("decision_format", "Decision selected a foreign/nonmatching original choice distribution.", 409);
      eligible &&= answer.confidence >= minimumConfidence && selected >= minimumProbability;
    } else if (question.type === "score" && answer.type === "score") {
      const mean = Object.entries(answer.probabilities).reduce((sum, [key, probability]) => sum + Number(key) * probability, 0);
      if (!sameKeys(answer.legend, expected) || question.criteria.some((label, index) => answer.legend[String(index)] !== label) ||
        answer.score > question.criteria.length - 1 || Math.abs(answer.score - mean) > 0.001) throw new MoguriError("decision_format", "Decision score/legend disagrees with the original zero-based weighted rubric.", 409);
      eligible = false;
    } else throw new MoguriError("decision_format", "Decision answer does not match its exact original question.", 409);
  }
  return { ...value, eligible, warning: "Values and confidence are untrusted model advice, not calibrated reliability, user facts, permission or source acceptance." };
}
