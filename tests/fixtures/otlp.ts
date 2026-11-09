import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";

export async function otlpCollector() {
  const requests: Array<{ path: string; text: string; authorization: string | undefined }> = [];
  let mode: "ok" | "unavailable" | "partial" | "stall" | "wrong-signal" | "invalid-partial" | "wrong-content-type" = "ok";
  const server = createServer((request, response) => {
    void (async () => {
      const parts: Buffer[] = [];
      for await (const part of request) parts.push(Buffer.from(part));
      requests.push({ path: request.url!, text: Buffer.concat(parts).toString("utf8"), authorization: request.headers.authorization });
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
