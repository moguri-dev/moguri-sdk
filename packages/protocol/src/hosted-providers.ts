import { Type, type Static } from "typebox";

/**
 * Named hosted model providers reached through pi-ai with the user's own credentials.
 * API keys and OAuth credentials live only in the profile's secret backend; settings keep
 * only which providers the user connected. See docs/architecture/hosted-providers.md.
 */
export const HOSTED_PROVIDERS = [
  { id: "openrouter", name: "OpenRouter", methods: ["api_key", "oauth"], subscription: false,
    description: "OpenRouter API key, or Sign in with OpenRouter, which mints a user-controlled API key." },
  { id: "anthropic", name: "Anthropic API", methods: ["api_key"], subscription: false,
    description: "Anthropic API key billed by the Anthropic API. Claude.ai subscription sign-in is not offered." },
  { id: "openai", name: "OpenAI API", methods: ["api_key"], subscription: false,
    description: "OpenAI API key billed by the OpenAI API platform." },
  { id: "chatgpt", name: "ChatGPT account", methods: ["oauth"], subscription: true,
    description: "Sign in with ChatGPT: OpenAI's supported sign-in for open-source, locally hosted apps. Eligible Responses API requests use your ChatGPT plan instead of API billing." },
] as const;
export type HostedProviderId = typeof HOSTED_PROVIDERS[number]["id"];
export type HostedAuthMethod = "api_key" | "oauth";
export const HostedProviderIdSchema = Type.Union([Type.Literal("openrouter"), Type.Literal("anthropic"), Type.Literal("openai"), Type.Literal("chatgpt")]);
export const hostedProvider = (id: string) => HOSTED_PROVIDERS.find((provider) => provider.id === id);
export const HostedProvidersSettingSchema = Type.Array(HostedProviderIdSchema, { maxItems: 4, uniqueItems: true });
/** Stable installation ID OpenAI receives as the agent host for Sign in with ChatGPT. Not a secret. */
export const HostedDeviceIdSchema = Type.String({ pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" });
/** Account state published on a hosted provider. Credentials themselves never leave the service. */
export interface HostedAccountState {
  methods: readonly HostedAuthMethod[];
  credential: HostedAuthMethod | null;
  subscription: boolean;
  /** An in-progress OAuth sign-in: open the URL yourself, or paste the final redirect URL when the browser cannot reach this machine. */
  login: { url: string; instructions: string | null; expiresAt: number } | null;
}
const key = Type.String({ minLength: 8, maxLength: 4096, pattern: "^\\S+$" });
const revision = Type.Integer({ minimum: 0 });
export const HostedAccountCommandSchema = Type.Union([
  Type.Object({ type: Type.Literal("models.hosted.key.set"), providerId: Type.Union([Type.Literal("openrouter"), Type.Literal("anthropic"), Type.Literal("openai")]), key, expectedRevision: revision }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("models.hosted.login"), providerId: Type.Union([Type.Literal("openrouter"), Type.Literal("chatgpt")]), expectedRevision: revision }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("models.hosted.code"), providerId: Type.Union([Type.Literal("openrouter"), Type.Literal("chatgpt")]), code: Type.String({ minLength: 1, maxLength: 8192 }) }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("models.hosted.cancel"), providerId: HostedProviderIdSchema }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("models.hosted.remove"), providerId: HostedProviderIdSchema, expectedRevision: revision }, { additionalProperties: false }),
]);
export type HostedAccountCommand = Static<typeof HostedAccountCommandSchema>;
/** Hosted model IDs carry the provider so identical upstream IDs from different accounts stay distinct sources. */
export const hostedProviderOfModel = (modelId: string | null | undefined): HostedProviderId | null => {
  const match = /^hosted\.([a-z]+)\./.exec(modelId ?? "");
  return match && hostedProvider(match[1]!) ? match[1] as HostedProviderId : null;
};
