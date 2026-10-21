import { localEndpointUrl } from "./model-registry.ts";
import type { BridgeInit } from "./remote-protocol.ts";

export async function workerCatalog(catalog: NonNullable<BridgeInit["catalog"]>, signal: AbortSignal): Promise<{ type: "catalog"; status: number; body: string }> {
  const headers = new Headers();
  for (const [name, value] of Object.entries(catalog.headers ?? {})) if (value !== null) headers.set(name, value);
  if (catalog.key && catalog.headers?.Authorization !== null && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${catalog.key}`);
  const response = await fetch(new URL("models", localEndpointUrl(catalog.url)), { headers, redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]) });
  if (!response.body) throw new Error("The execution worker's model endpoint returned no catalog.");
  const chunks: Uint8Array[] = []; let size = 0; const reader = response.body.getReader();
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.length;
      if (size > 256 * 1024) { await reader.cancel(); throw new Error("The execution worker's model catalog exceeded 256 KiB."); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  signal.throwIfAborted();
  return { type: "catalog", status: response.status, body: Buffer.concat(chunks).toString("base64") };
}
