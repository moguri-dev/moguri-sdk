import { createModels, type Message, type Tool } from "@earendil-works/pi-ai";
import { githubCopilotProvider } from "@earendil-works/pi-ai/providers/github-copilot";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import { performance } from "node:perf_hooks";
import type { BoundaryReply } from "./worker-protocol.ts";
import { assistantMessage, usagePresent } from "./worker-protocol.ts";
import { localProvider, localModelFetch } from "./local-provider.ts";
import { redactSecrets, SecretStreamRedactor } from "./secret-redactor.ts";
import { streamMetrics } from "./stream-metrics.ts";

export async function streamWorkerModel(boundary: BoundaryReply, context: Message[], tools: Tool[], env: "Local" | "Remote" | "Sandbox" | undefined,
  signal: AbortSignal, output?: (text: string) => void) {
  signal.throwIfAborted();
  const models = createModels({ authContext: { env: async () => undefined, fileExists: async () => false } });
  models.setProvider(githubCopilotProvider()); models.setProvider(localProvider());
  // Hosted providers resolve only the request credential the control plane prepared; there is no ambient key lookup.
  models.setProvider(openrouterProvider()); models.setProvider(anthropicProvider()); models.setProvider(openaiProvider());
  const secrets = [...new Set([
    ...(boundary.auth.apiKey && boundary.auth.apiKey !== "moguri-keyless" ? [boundary.auth.apiKey] : []),
    ...Object.entries(boundary.auth.headers ?? {}).filter(([name, value]) => value && /authorization|api[-_]?key|auth[-_]?token/i.test(name))
      .flatMap(([, value]) => value ? [value, value.replace(/^Bearer\s+/i, "")] : []),
  ])];
  const redactor = new SecretStreamRedactor(secrets), model = { ...boundary.model, baseUrl: boundary.auth.baseUrl ?? boundary.model.baseUrl };
  const started = performance.now(), metrics = streamMetrics(started);
  let reported = false, buffered = "";
  const flush = () => {
    if (!buffered) return;
    const text = redactor.push(buffered); buffered = ""; if (text) output?.(text);
  };
  const timer = setInterval(flush, 50);
  try {
    const stream = models.streamSimple(model, { systemPrompt: boundary.systemPrompt, messages: context, tools }, {
      apiKey: boundary.auth.apiKey, headers: boundary.auth.headers, signal, maxTokens: boundary.maxTokens, maxRetries: 0, timeoutMs: 120_000,
      ...(model.provider === "moguri-local" || env === "Sandbox" ? { fetch: localModelFetch } : {}),
      ...(boundary.thinkingEffort && boundary.thinkingEffort !== "off" ? { reasoning: boundary.thinkingEffort } : {}),
      sessionId: process.env.MOGURI_TURN_ID,
      onProviderStreamEvent: (event) => { reported ||= usagePresent(event); metrics.provider(event); },
    });
    for await (const event of stream) {
      metrics.output(event);
      if (event.type === "text_delta") { buffered += event.delta; if (buffered.length > 16_384) flush(); }
    }
    flush(); const tail = redactor.finish(); if (tail) output?.(tail);
    const message = assistantMessage(redactSecrets(await stream.result(), secrets));
    return { message, usageReported: reported && !["error", "aborted", "pending", "deferred"].includes(message.stopReason),
      generationMs: performance.now() - started, stream: metrics.snapshot() };
  } finally { clearInterval(timer); flush(); }
}
