import { MoguriError } from "../../../packages/protocol/src/index.ts";
import { localEndpointUrl } from "./model-registry.ts";
import type { BridgeInit } from "./remote-protocol.ts";

export async function workerCatalog(catalog: NonNullable<BridgeInit["catalog"]>, signal: AbortSignal): Promise<{ type: "catalog"; status: number; body: string }> {
  const headers = new Headers();
  for (const [name, value] of Object.entries(catalog.headers ?? {})) if (value !== null) headers.set(name, value);
  if (catalog.key && catalog.headers?.Authorization !== null && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${catalog.key}`);
  const url = new URL("models", localEndpointUrl(catalog.url));
  let response: Response;
  try { response = await fetch(url, { headers, redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]) }); }
  catch (error) {
    signal.throwIfAborted();
    if (!(error instanceof TypeError || error instanceof DOMException && error.name === "TimeoutError")) throw error;
    let proxyStatus: string | undefined;
    for (let cause: unknown = error, depth = 0; cause instanceof Error && depth < 5; cause = cause.cause, depth++) {
      proxyStatus = /Proxy response \((\d{3})\)/.exec(cause.message)?.[1];
      if (proxyStatus) break;
    }
    throw new MoguriError("worker_catalog_network", `The execution host could not read the provider catalogue at ${url.hostname}.${proxyStatus ? ` The enforced proxy CONNECT returned HTTP ${proxyStatus}.` : ""} Check the reviewed hostnames, DNS aliases and proxy policy. No host, credential or provider was substituted.`, 502);
  }
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
