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
  { id: "gemini", name: "Google Gemini API", methods: ["api_key"], subscription: false,
    description: "Gemini API key from Google AI Studio, billed by the Gemini API." },
  { id: "vertex", name: "Vertex AI", methods: ["api_key"], subscription: false,
    description: "Google Cloud API key for Vertex AI, billed to its Google Cloud project. Application Default Credentials and service-account files are not read." },
  { id: "bedrock", name: "Amazon Bedrock", methods: ["api_key"], subscription: false,
    description: "Amazon Bedrock API key and its AWS Region, billed to its AWS account. AWS profiles and the ambient credential chain are not read." },
  { id: "azure", name: "Azure OpenAI", methods: ["api_key"], subscription: false,
    description: "Azure OpenAI or Foundry API key with its resource endpoint and your deployment names, billed to its Azure subscription." },
  { id: "xai", name: "xAI API", methods: ["api_key"], subscription: false,
    description: "xAI API key billed by the xAI API. SuperGrok and X Premium sign-in is not offered." },
  { id: "mistral", name: "Mistral API", methods: ["api_key"], subscription: false,
    description: "Mistral API key from La Plateforme, billed by Mistral AI." },
  { id: "groq", name: "Groq", methods: ["api_key"], subscription: false,
    description: "GroqCloud API key, billed by Groq." },
  { id: "deepseek", name: "DeepSeek API", methods: ["api_key"], subscription: false,
    description: "DeepSeek API key, billed by the DeepSeek API platform." },
] as const;
export type HostedProviderId = typeof HOSTED_PROVIDERS[number]["id"];
export type HostedAuthMethod = "api_key" | "oauth";
export const HOSTED_PROVIDER_IDS = HOSTED_PROVIDERS.map((provider) => provider.id) as HostedProviderId[];
export const HostedKeyProviderIdSchema = Type.Union([Type.Literal("openrouter"), Type.Literal("anthropic"), Type.Literal("openai"), Type.Literal("gemini"), Type.Literal("vertex"),
  Type.Literal("bedrock"), Type.Literal("azure"), Type.Literal("xai"), Type.Literal("mistral"), Type.Literal("groq"), Type.Literal("deepseek")]);
const HostedSignInProviderIdSchema = Type.Union([Type.Literal("openrouter"), Type.Literal("chatgpt")]);
export const HostedProviderIdSchema = Type.Union([...HostedKeyProviderIdSchema.anyOf, Type.Literal("chatgpt")]);
/** Providers the user connects with an API key in the secret backend. */
export const HOSTED_KEY_PROVIDERS = HostedKeyProviderIdSchema.anyOf.map((entry) => entry.const) as HostedKeyProviderId[];
export type HostedKeyProviderId = Static<typeof HostedKeyProviderIdSchema>;
export const HOSTED_SIGN_IN_PROVIDERS = ["openrouter", "chatgpt"] as const;
export type HostedSignInProviderId = typeof HOSTED_SIGN_IN_PROVIDERS[number];
export const hostedProvider = (id: string) => HOSTED_PROVIDERS.find((provider) => provider.id === id);
export const HostedProvidersSettingSchema = Type.Array(HostedProviderIdSchema, { maxItems: HOSTED_PROVIDERS.length, uniqueItems: true });
/** Protocol 124 (D79). Non-secret connection details some providers need besides their key; the key itself stays in the secret backend. */
export const BedrockOptionsSchema = Type.Object({
  region: Type.String({ minLength: 9, maxLength: 32, pattern: "^[a-z]{2}(-gov)?-[a-z]+-[0-9]{1,2}$" }),
}, { additionalProperties: false });
export const AzureDeploymentSchema = Type.Object({
  /** The deployment name Azure routes the request to. */
  name: Type.String({ minLength: 1, maxLength: 64, pattern: "^[A-Za-z0-9][A-Za-z0-9._-]*$" }),
  /** The catalogue model the deployment serves; it supplies limits, prices and the AI lab. */
  model: Type.String({ minLength: 1, maxLength: 128 }),
}, { additionalProperties: false });
export const AzureOptionsSchema = Type.Object({
  endpoint: Type.String({ minLength: 12, maxLength: 512, pattern: "^https://[a-z0-9][a-z0-9-]{0,62}\\.(openai\\.azure\\.com|cognitiveservices\\.azure\\.com|services\\.ai\\.azure\\.com)(/openai(/v1)?)?/?$" }),
  deployments: Type.Array(AzureDeploymentSchema, { minItems: 1, maxItems: 32 }),
}, { additionalProperties: false });
export type BedrockOptions = Static<typeof BedrockOptionsSchema>;
export type AzureOptions = Static<typeof AzureOptionsSchema>;
export const HostedProviderOptionsSchema = Type.Object({
  bedrock: Type.Optional(BedrockOptionsSchema),
  azure: Type.Optional(AzureOptionsSchema),
}, { additionalProperties: false });
export type HostedProviderOptions = Static<typeof HostedProviderOptionsSchema>;
/** The providers whose connection needs non-secret options with the key. */
export const hostedOptionsRequired = (id: HostedProviderId): id is "bedrock" | "azure" => id === "bedrock" || id === "azure";
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
// Short-term Amazon Bedrock API keys are signed URLs of several kilobytes.
const key = Type.String({ minLength: 8, maxLength: 8192, pattern: "^\\S+$" });
const revision = Type.Integer({ minimum: 0 });
export const HostedAccountCommandSchema = Type.Union([
  Type.Object({ type: Type.Literal("models.hosted.key.set"), providerId: HostedKeyProviderIdSchema, key, expectedRevision: revision,
    /** Required for Amazon Bedrock (region) and Azure OpenAI (endpoint and deployments); refused for every other provider. */
    options: Type.Optional(Type.Union([BedrockOptionsSchema, AzureOptionsSchema])) }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("models.hosted.login"), providerId: HostedSignInProviderIdSchema, expectedRevision: revision }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("models.hosted.code"), providerId: HostedSignInProviderIdSchema, code: Type.String({ minLength: 1, maxLength: 8192 }) }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("models.hosted.cancel"), providerId: HostedProviderIdSchema }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("models.hosted.remove"), providerId: HostedProviderIdSchema, expectedRevision: revision }, { additionalProperties: false }),
]);
export type HostedAccountCommand = Static<typeof HostedAccountCommandSchema>;
/** Hosted model IDs carry the provider so identical upstream IDs from different accounts stay distinct sources. */
export const hostedProviderOfModel = (modelId: string | null | undefined): HostedProviderId | null => {
  const match = /^hosted\.([a-z]+)\./.exec(modelId ?? "");
  return match && hostedProvider(match[1]!) ? match[1] as HostedProviderId : null;
};
