import type { Message } from "@earendil-works/pi-ai";
import { CHAT_TITLE_PROMPT, chatTitleText, successfulRoleEntry, type BudgetEntry, type BudgetRate, type ChatTitleRecord, type ModelInfo, type Session, type StoredEvent } from "../../../packages/protocol/src/index.ts";
import { estimateModelContext } from "./model-controls.ts";
import { assistantMessage, toolCalls } from "./worker-protocol.ts";
import { digest, type EventStore } from "./store.ts";

export const TITLE_OUTPUT_LIMIT = 128;
export function titleContext(input: string): Message[] {
  return [{ role: "user", content: input, timestamp: 0 }];
}
export function newChatTitle(store: EventStore, session: Session, event: Extract<StoredEvent, { event_type: "turn.started" }>): ChatTitleRecord {
  const input = JSON.stringify({ source: "first-user-prompt", messageId: event.payload.item.id, text: event.payload.item.text });
  return { version: 1, id: event.turn_id!, profileId: store.profileId, sessionId: session.id, turnId: event.turn_id!, sourceMessageId: event.payload.item.id,
    sourceDigest: digest(event.payload.item.text), inputDigest: store.putBlob(input), actualInputDigest: null, resultDigest: null,
    baseTitle: session.title, baseTitleRevision: session.titleRevision!, env: session.controls.env,
    modelId: null, providerId: null, apiModelId: null, stepId: null, modelJson: null, bindingDigest: null, selection: null,
    revision: 0, createdAt: event.timestamp, updatedAt: event.timestamp, status: "pending", title: null, diagnostic: null };
}
export function titleModel(models: ModelInfo[], session: Session, input: string, selectedId: string | null, preferredId: string | null, rate: (id: string) => BudgetRate | null) {
  const estimate = estimateModelContext({ systemPrompt: CHAT_TITLE_PROMPT, messages: titleContext(input), tools: [] });
  const candidates = models.filter((model) => !model.synthetic && model.environments?.includes(session.controls.env) &&
    model.maxTokens && model.maxTokens >= TITLE_OUTPUT_LIMIT && model.contextWindow > estimate + TITLE_OUTPUT_LIMIT + 4096);
  if (preferredId) {
    const model = candidates.find((model) => model.id === preferredId);
    return model ? { model, selection: "Explicitly configured naming model in the original Env." } : null;
  }
  const local = candidates.filter((model) => model.source === "local" && model.endpointBoundary === "loopback").sort((a, b) => a.id.localeCompare(b.id))[0];
  if (local) return { model: local, selection: "Configured, available loopback naming model in the original Env; no weights were downloaded." };
  const priced = candidates.flatMap((model) => {
    const price = rate(model.id);
    return price ? [{ model, cost: price.inputUsdPerMillion * estimate + price.outputUsdPerMillion * TITLE_OUTPUT_LIMIT }] : [];
  }).sort((a, b) => a.cost - b.cost || a.model.id.localeCompare(b.model.id));
  if (priced[0]) return { model: priced[0].model, selection: "Lowest current configured token-price estimate for this bounded naming input/output; not billed cost or a model-quality ranking." };
  const model = candidates.find((model) => model.id === selectedId);
  return model ? { model, selection: "The actual selected solver model; no qualified local or priced lower-cost model was available. Naming is one separately charged bounded call." } : null;
}
export function completedChatTitle(record: ChatTitleRecord, event: Extract<StoredEvent, { event_type: "model.completed" }>, entry: BudgetEntry | undefined, read: (digest: string) => string): ChatTitleRecord {
  let status: ChatTitleRecord["status"] = "partial", title: string | null = null;
  let diagnostic: string | null = "Naming has incomplete or unknown accounting. Its original result/charge remains retained; no title, retry or refund was inferred.";
  if (entry && entry.role === "title" && successfulRoleEntry(entry)) {
    try {
      const message = assistantMessage(JSON.parse(read(event.payload.contextDigest)));
      if (message.stopReason !== "stop" || toolCalls(message).length || message.model !== record.apiModelId) {
        throw new Error("The naming model did not return a complete tool-less result for its exact API identity.");
      }
      title = chatTitleText(message.content.filter((block) => block.type === "text").map((block) => block.text).join(""));
      status = "completed"; diagnostic = null;
    } catch (error) {
      status = "rejected";
      diagnostic = error instanceof SyntaxError ? "The naming model returned invalid JSON. Its result and charge were retained; no title was applied." :
        error instanceof Error ? error.message : "Naming output validation failed. No title was applied.";
    }
  }
  return { ...record, revision: record.revision + 1, updatedAt: event.timestamp, status, title,
    resultDigest: event.payload.contextDigest, diagnostic };
}
