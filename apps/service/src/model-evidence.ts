import { createHash } from "node:crypto";
import {
  isRecord, ModelEvidenceReportSchema, MoguriError, parse, type ModelEvidenceReport,
} from "../../../packages/protocol/src/index.ts";
import { boundedBody } from "./network.ts";

const hosts = new Set(["api.githubcopilot.com", "api.individual.githubcopilot.com", "api.business.githubcopilot.com", "api.enterprise.githubcopilot.com"]);
export function modelEvidenceEndpoint(baseUrl: string | undefined): string {
  let url: URL;
  try { url = new URL(baseUrl ?? ""); }
  catch (error) { if (error instanceof TypeError) throw new MoguriError("model_evidence_resource", "The scoped Copilot account did not provide a valid catalogue endpoint. No default host or fallback was used.", 409); throw error; }
  if (url.protocol !== "https:" || !hosts.has(url.hostname) || url.port && url.port !== "443" || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new MoguriError("model_evidence_resource", "Evidence is limited to the exact credential-free HTTPS Copilot account API root. No redirect, custom host or endpoint was substituted.", 403);
  }
  return new URL("models", url).href;
}
function declaration(value: unknown, field: string, secret: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !value.trim() || value.length > 256 || Buffer.byteLength(value) > 1024 ||
    !value.isWellFormed() || /[\u0000-\u001f\u007f]/.test(value)) throw new MoguriError("model_evidence_declaration", `Copilot's ${field} declaration is not bounded lossless text. No family or source was invented.`, 502);
  if (value.includes(secret)) throw new MoguriError("model_evidence_secret", "The catalogue echoed request access in model metadata. No evidence or raw response was exposed.", 502);
  return value;
}
export function declaredModelEvidence(raw: unknown, modelId: string, endpoint: string, secret: string): ModelEvidenceReport {
  if (!isRecord(raw) || !Array.isArray(raw.data) || raw.data.length > 512 ||
    !raw.data.every((item) => isRecord(item) && typeof item.id === "string" && item.id.length > 0 && item.id.length <= 128 && item.id.isWellFormed() && !/[\u0000-\u0020\u007f]/.test(item.id)) ||
    new Set(raw.data.map((item) => isRecord(item) ? item.id : undefined)).size !== raw.data.length) {
    throw new MoguriError("model_evidence_catalogue", "Copilot returned an invalid, duplicate or oversized model catalogue. No ambiguous family or alias was adopted.", 502);
  }
  const selected = raw.data.find((item) => isRecord(item) && item.id === modelId);
  if (!isRecord(selected)) throw new MoguriError("model_evidence_missing", "The fresh account catalogue does not advertise this exact model ID. Refresh available models; no alternative or name prefix was used.", 409);
  if (isRecord(selected.policy) && selected.policy.state === "disabled") throw new MoguriError("model_evidence_unavailable", "The fresh account catalogue explicitly disables this model. No availability or family permission was inferred.", 409);
  if (selected.id === secret || typeof selected.id === "string" && selected.id.includes(secret)) throw new MoguriError("model_evidence_secret", "The catalogue echoed request access. No evidence was exposed.", 502);
  if (selected.capabilities !== undefined && !isRecord(selected.capabilities)) throw new MoguriError("model_evidence_catalogue", "The selected model's capabilities are malformed. No family was inferred.", 502);
  const family = declaration(isRecord(selected.capabilities) ? selected.capabilities.family : undefined, "capabilities.family", secret);
  const content: Omit<ModelEvidenceReport, "digest"> = { format: "moguri-provider-model-evidence", version: 1, modelId, apiModelId: modelId, providerId: "github-copilot",
    status: family === null ? "unknown" : "declared", source: { kind: "authenticated-provider-catalogue", endpoint, familyField: "capabilities.family" },
    claimed: { family, vendor: declaration(selected.vendor, "vendor", secret), version: declaration(selected.version, "version", secret) },
    observedAt: new Date().toISOString(),
    warning: "Provider-declared metadata is not proof of model-family independence, weights, quality, permission or user acceptance. This explicit read sends no project content and makes no inference request." };
  return parse(ModelEvidenceReportSchema, { ...content, digest: createHash("sha256").update("moguri-model-evidence-v1\0").update(JSON.stringify(content)).digest("hex") });
}
export async function readCopilotModelEvidence(modelId: string, baseUrl: string | undefined, access: string | undefined, signal: AbortSignal): Promise<ModelEvidenceReport> {
  signal.throwIfAborted();
  if (!access || !access.isWellFormed() || /[\r\n\u0000]/.test(access)) throw new MoguriError("model_evidence_auth", "Explicit scoped Copilot request access is unavailable. No ambient or refresh credential was used.", 401);
  const endpoint = modelEvidenceEndpoint(baseUrl);
  const response = await fetch(endpoint, { headers: { Accept: "application/json", Authorization: `Bearer ${access}`,
    "User-Agent": "Moguri", "Copilot-Integration-Id": "vscode-chat", "X-GitHub-Api-Version": "2026-06-01" },
    redirect: "error", signal });
  if (!response.ok) {
    await response.body?.cancel();
    throw new MoguriError("model_evidence_http", `Copilot catalogue inspection returned HTTP ${response.status}. Check the current account/access; no raw diagnostics or fallback were exposed.`, 502);
  }
  if (!response.body) throw new MoguriError("model_evidence_format", "Copilot returned no catalogue body. No evidence was adopted.", 502);
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(await boundedBody(response, 256 * 1024, signal)); }
  catch (error) {
    if (error instanceof MoguriError && error.code === "remote_limit") throw new MoguriError("model_evidence_limit", "The Copilot catalogue exceeded 256 KiB. No response was truncated or retained.", 502);
    if (error instanceof TypeError) throw new MoguriError("model_evidence_format", "Copilot catalogue text is not complete valid UTF-8. No evidence was adopted.", 502);
    throw error;
  }
  signal.throwIfAborted();
  let raw: unknown;
  try { raw = JSON.parse(text); }
  catch (error) { if (error instanceof SyntaxError) throw new MoguriError("model_evidence_format", "Copilot returned invalid catalogue JSON. No model or family was invented.", 502); throw error; }
  return declaredModelEvidence(raw, modelId, endpoint, access);
}
