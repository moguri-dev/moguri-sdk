import { MoguriError } from "../../../packages/protocol/src/index.ts";

export async function boundedBody(response: Response, maxBytes: number, signal: AbortSignal): Promise<Buffer> {
  if (!response.body) throw new MoguriError("remote_response", "The remote service returned no response body.");
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let bytes = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new MoguriError("remote_limit", "The remote response exceeded its bounded size limit.");
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
  } finally { await reader.cancel(); reader.releaseLock(); }
}
export async function fetchJson(fetcher: typeof fetch, url: string, init: RequestInit, signal: AbortSignal): Promise<unknown> {
  const response = await fetcher(url, { ...init, signal, redirect: "error" });
  if (!response.ok) {
    await response.body?.cancel();
    throw new MoguriError("remote_failed", `The configured service returned HTTP ${response.status}. Check access and rate limits; no result was applied.`, 502);
  }
  try { return JSON.parse((await boundedBody(response, 2 * 1024 * 1024, signal)).toString("utf8")); }
  catch (error) { if (error instanceof SyntaxError) throw new MoguriError("remote_format", "The configured service returned invalid JSON; no result was applied.", 502); throw error; }
}
