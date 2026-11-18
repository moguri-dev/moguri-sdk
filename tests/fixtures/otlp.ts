import assert from "node:assert/strict";
import { isRecord } from "../../packages/sdk/src/index.ts";
import { createServer } from "node:http";
import { once } from "node:events";

/** Generated in-memory secret backend; tests never touch the real keychain. */
export function memoryVault(values = new Map<string, string>()) {
  return { values, read: async (id: string) => values.get(id) ?? null, write: async (id: string, value: string) => { values.set(id, value); },
    remove: async (id: string) => { values.delete(id); } };
}
export async function otlpCollector() {
  const requests: Array<{ path: string; text: string; authorization: string | undefined; headers: Record<string, string | string[] | undefined> }> = [];
  let mode: "ok" | "unavailable" | "partial" | "stall" | "wrong-signal" | "invalid-partial" | "wrong-content-type" = "ok";
  const server = createServer((request, response) => {
    void (async () => {
      const parts: Buffer[] = [];
      for await (const part of request) parts.push(Buffer.from(part));
      requests.push({ path: request.url!, text: Buffer.concat(parts).toString("utf8"), authorization: request.headers.authorization, headers: { ...request.headers } });
      if (mode === "stall") return;
      if (mode === "unavailable") { response.writeHead(503, { "content-type": "application/json" }).end('{"error":"GENERATED_PRIVATE_RECEIVER_ERROR"}'); return; }
      if (mode === "partial") { response.writeHead(200, { "content-type": "application/json" }).end('{"partialSuccess":{"rejectedSpans":"1","errorMessage":"GENERATED_PRIVATE_RECEIVER_ERROR"}}'); return; }
      if (mode === "wrong-signal") { response.writeHead(200, { "content-type": "application/json" }).end('{"partialSuccess":{"rejectedDataPoints":"1"}}'); return; }
      if (mode === "invalid-partial") { response.writeHead(200, { "content-type": "application/json" }).end('{"partialSuccess":{"rejectedSpans":false,"errorMessage":0}}'); return; }
      if (mode === "wrong-content-type") { response.writeHead(200, { "content-type": "text/plain" }).end("{}"); return; }
      response.writeHead(200, { "content-type": "application/json" }).end("{}");
    })().catch((error: unknown) => { console.error("Generated collector failed:", error); response.destroy(); });
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address === "object");
  return { requests, endpoint: `http://127.0.0.1:${address.port}`, get mode() { return mode; }, set mode(value: typeof mode) { mode = value; }, close: async () => {
    server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  } };
}

const signalKeys = { traces: ["resourceSpans", "scopeSpans", "spans"], metrics: ["resourceMetrics", "scopeMetrics", "metrics"], logs: ["resourceLogs", "scopeLogs", "logRecords"] } as const;
/** Decodes every record of one OTLP/HTTP JSON signal the generated collector received. */
export function signalRecords(requests: Awaited<ReturnType<typeof otlpCollector>>["requests"], signal: "traces" | "metrics" | "logs") {
  const [resourceKey, scopeKey, recordKey] = signalKeys[signal];
  return requests.filter((request) => request.path === `/v1/${signal}`).flatMap((request) => {
    const body: unknown = JSON.parse(request.text); assert.ok(isRecord(body));
    const resources = body[resourceKey]; assert.ok(Array.isArray(resources));
    return resources.flatMap((resource: unknown) => {
      assert.ok(isRecord(resource));
      const scopes = resource[scopeKey]; assert.ok(Array.isArray(scopes));
      return scopes.flatMap((scope: unknown) => {
        assert.ok(isRecord(scope)); const records = scope[recordKey]; assert.ok(Array.isArray(records));
        return records.map((record: unknown) => { assert.ok(isRecord(record)); return record; });
      });
    });
  });
}
/** Flattens OTLP JSON key/value attributes into a plain object. */
export function attributesOf(record: Record<string, unknown>): Record<string, unknown> {
  const attributes = Array.isArray(record.attributes) ? record.attributes : [];
  return Object.fromEntries(attributes.filter(isRecord).map((attribute) => {
    const value = isRecord(attribute.value) ? Object.values(attribute.value)[0] : undefined;
    return [String(attribute.key), value];
  }));
}
