import { createProvider, type Provider } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";

export function localProvider(): Provider<"openai-completions"> {
  return createProvider<"openai-completions">({
    id: "moguri-local",
    name: "Configured local endpoints",
    auth: { apiKey: { name: "Explicit request-scoped local credentials", resolve: async ({ credential }) => credential?.key ? { auth: { apiKey: credential.key }, source: "scoped-worker" } : undefined } },
    models: [],
    api: openAICompletionsApi(),
  });
}
