import type { ModelInfo } from "./index.ts";

/**
 * The AI lab that trained a model (D56), derived from its exact ID, API ID, display name or direct provider. It groups
 * model lists and is the lab identity Kupo's Critique and Council use. It is a name-based label the user can review,
 * not proof of independent training lineage. Unrecognized network models are `unknown` and never count as a distinct lab.
 */
export interface ModelLab { id: string; name: string; known: boolean }
export const MODEL_LABS: Record<string, string> = {
  anthropic: "Anthropic", openai: "OpenAI", google: "Google", xai: "xAI", meta: "Meta", mistral: "Mistral AI", deepseek: "DeepSeek",
  qwen: "Qwen", zhipu: "Z.ai (GLM)", moonshot: "Moonshot AI", minimax: "MiniMax", microsoft: "Microsoft", cohere: "Cohere",
  amazon: "Amazon", nvidia: "NVIDIA", ibm: "IBM", ai21: "AI21 Labs", perplexity: "Perplexity", baidu: "Baidu", tencent: "Tencent",
  bytedance: "ByteDance", allenai: "Ai2", nous: "Nous Research", xiaomi: "Xiaomi", inception: "Inception", liquid: "Liquid AI",
  stepfun: "StepFun", local: "Local (unidentified)", unknown: "Other",
};
const vendors: Record<string, string> = {
  anthropic: "anthropic", openai: "openai", google: "google", "google-ai": "google", "x-ai": "xai", xai: "xai", "meta-llama": "meta", meta: "meta",
  mistralai: "mistral", mistral: "mistral", deepseek: "deepseek", "deepseek-ai": "deepseek", qwen: "qwen", alibaba: "qwen", "z-ai": "zhipu", zai: "zhipu",
  "z.ai": "zhipu", zhipu: "zhipu", zhipuai: "zhipu", thudm: "zhipu", moonshotai: "moonshot", moonshot: "moonshot", minimax: "minimax",
  microsoft: "microsoft", cohere: "cohere", amazon: "amazon", nvidia: "nvidia", "ibm-granite": "ibm", ibm: "ibm", ai21: "ai21",
  perplexity: "perplexity", baidu: "baidu", tencent: "tencent", bytedance: "bytedance", "bytedance-seed": "bytedance", allenai: "allenai",
  ai2: "allenai", nousresearch: "nous", nous: "nous", xiaomi: "xiaomi", inception: "inception", liquid: "liquid", stepfun: "stepfun", "stepfun-ai": "stepfun",
};
const patterns: Array<[RegExp, string]> = [
  [/claude/, "anthropic"], [/(^|[^a-z])(gpt|chatgpt|codex)([^a-z]|$)|(^|[^a-z0-9])o[1-9]([^a-z0-9]|$)/, "openai"], [/gemini|gemma/, "google"],
  [/grok/, "xai"], [/llama/, "meta"], [/mistral|mixtral|codestral|devstral|magistral|ministral|pixtral/, "mistral"], [/deepseek/, "deepseek"],
  [/qwen|qwq/, "qwen"], [/(^|[^a-z])(chat)?glm/, "zhipu"], [/kimi|moonshot/, "moonshot"], [/minimax|abab/, "minimax"],
  [/(^|[^a-z])(phi|mai)-/, "microsoft"], [/command-[ra]|(^|[^a-z])aya/, "cohere"], [/(^|[^a-z])nova-/, "amazon"], [/nemotron/, "nvidia"],
  [/granite/, "ibm"], [/jamba/, "ai21"], [/sonar/, "perplexity"], [/ernie/, "baidu"], [/hunyuan/, "tencent"], [/doubao|(^|[^a-z])seed-/, "bytedance"],
  [/olmo/, "allenai"], [/hermes/, "nous"], [/mimo/, "xiaomi"], [/(^|[^a-z])lfm/, "liquid"], [/(^|[^a-z])step-/, "stepfun"],
];
const lab = (id: string): ModelLab => ({ id, name: MODEL_LABS[id] ?? id, known: id !== "unknown" });
export function modelLab(model: Pick<ModelInfo, "id" | "name"> & Partial<Pick<ModelInfo, "apiModelId" | "providerId" | "source">>): ModelLab {
  if (model.source === "claude-agent") return lab("anthropic");
  if (model.source === "codex-agent") return lab("openai");
  if (model.source === "gemini-agent") return lab("google");
  const api = (model.apiModelId ?? model.id).toLowerCase().trim();
  const slug = /^([a-z0-9][a-z0-9.-]*)\/[^/]/.exec(api)?.[1];
  if (slug && vendors[slug]) return lab(vendors[slug]!);
  // Amazon Bedrock IDs name the vendor after an optional cross-Region prefix, e.g. `us.anthropic.claude-...` or `meta.llama3-...`.
  const bedrock = /^(?:(?:us-gov|us|eu|apac|jp|au|ca|global)\.)?([a-z0-9-]+)\.[a-z0-9]/.exec(api)?.[1];
  if (bedrock && vendors[bedrock] && model.providerId === "bedrock") return lab(vendors[bedrock]!);
  const prefix = /^([^:]{2,40}):\s/.exec(model.name)?.[1]?.toLowerCase().replace(/\s+/g, "");
  if (prefix && vendors[prefix]) return lab(vendors[prefix]!);
  const text = `${api} ${model.id.toLowerCase()} ${model.name.toLowerCase()}`;
  for (const [pattern, id] of patterns) if (pattern.test(text)) return lab(id);
  const provider = model.providerId?.replace(/^hosted\./, "");
  const direct: Record<string, string> = { anthropic: "anthropic", openai: "openai", chatgpt: "openai", gemini: "google", vertex: "google", xai: "xai", mistral: "mistral", deepseek: "deepseek" };
  if (model.source === "hosted" && provider && direct[provider]) return lab(direct[provider]!);
  // Antigravity can also offer other labs' models, so only a model its name does not identify falls back to Google.
  if (model.source === "antigravity-agent") return lab("google");
  return lab(model.source === "local" ? "local" : "unknown");
}
