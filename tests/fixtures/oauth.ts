import { createServer } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

export async function generatedOAuthServer(options: { registration?: boolean } = {}) {
  let origin = "";
  const clients = new Map<string, { redirect_uris: string[]; secret?: string }>();
  const codes = new Map<string, { challenge: string; redirect: string; clientId: string }>();
  const accesses = new Set<string>();
  let exchanges = 0, refreshes = 0, mcpRequests = 0;
  let revoked = false;
  let tokenGate: Promise<void> | undefined;
  const http = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", origin);
      const json = (value: unknown, status = 200) => { response.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(value)); };
      if (url.pathname.startsWith("/.well-known/oauth-protected-resource")) return json({ resource: `${origin}/mcp`, authorization_servers: [origin], scopes_supported: ["tools"] });
      if (url.pathname.startsWith("/.well-known/oauth-authorization-server")) return json({ issuer: origin, authorization_endpoint: `${origin}/authorize`, token_endpoint: `${origin}/token`, ...(options.registration !== false ? { registration_endpoint: `${origin}/register` } : {}), response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"], token_endpoint_auth_methods_supported: ["client_secret_basic", "none"], code_challenge_methods_supported: ["S256"] });
      if (url.pathname === "/authorize") {
        const clientId = url.searchParams.get("client_id") ?? "";
        const redirect = url.searchParams.get("redirect_uri") ?? "";
        const client = clients.get(clientId);
        if (!client?.redirect_uris.includes(redirect) || url.searchParams.get("code_challenge_method") !== "S256") return json({ error: "invalid_client" }, 400);
        const code = randomUUID(); codes.set(code, { clientId, redirect, challenge: url.searchParams.get("code_challenge")! });
        const callback = new URL(redirect); callback.searchParams.set("code", code); callback.searchParams.set("state", url.searchParams.get("state")!);
        response.writeHead(302, { Location: callback.href }).end(); return;
      }
      if (url.pathname === "/mcp") {
        const value = request.headers.authorization?.replace(/^Bearer /i, "") ?? "";
        if (!accesses.has(value) || revoked) return json({ error: "unauthorized" }, 401);
        mcpRequests++;
        const server = new Server({ name: "generated-oauth-mcp", version: "1" }, { capabilities: { tools: {} } });
        server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: "oauth_echo", description: `Generated token echo ${value}`, inputSchema: { type: "object" as const } }] }));
        server.setRequestHandler(CallToolRequestSchema, async () => ({ content: [{ type: "text", text: `Generated OAuth tool response ${value}` }] }));
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
        response.on("close", () => { void transport.close(); void server.close(); });
        await server.connect(transport); await transport.handleRequest(request, response); return;
      }
      const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = Buffer.concat(chunks).toString("utf8");
      if (url.pathname === "/register") {
        const input: { redirect_uris: string[] } = JSON.parse(body);
        const clientId = `generated-client-${clients.size}`; clients.set(clientId, input);
        return json({ ...input, client_id: clientId, issuer: origin }, 201);
      }
      if (url.pathname === "/token") {
        await tokenGate;
        const input = new URLSearchParams(body);
        let clientId = input.get("client_id") ?? "";
        if (request.headers.authorization?.startsWith("Basic ")) {
          const [id, secret] = Buffer.from(request.headers.authorization.slice(6), "base64").toString().split(":");
          if (!id || clients.get(id)?.secret !== secret) return json({ error: "invalid_client" }, 401);
          clientId = id;
        } else if (clients.get(clientId)?.secret) return json({ error: "invalid_client" }, 401);
        if (input.get("resource") !== `${origin}/mcp`) return json({ error: "invalid_target" }, 400);
        if (input.get("grant_type") === "authorization_code") {
          const code = input.get("code") ?? "", stored = codes.get(code);
          if (!stored || stored.clientId !== clientId || stored.redirect !== input.get("redirect_uri") || createHash("sha256").update(input.get("code_verifier") ?? "").digest("base64url") !== stored.challenge) return json({ error: "invalid_grant" }, 400);
          codes.delete(code); exchanges++;
        } else if (input.get("grant_type") === "refresh_token" && input.get("refresh_token") === "generated-oauth-refresh" && !revoked) refreshes++;
        else return json({ error: "invalid_grant" }, 400);
        const access = `generated-oauth-access-${exchanges}-${refreshes}`; accesses.add(access);
        return json({ access_token: access, refresh_token: "generated-oauth-refresh", token_type: "Bearer", expires_in: 60 });
      }
      json({ error: "not_found" }, 404);
    })().catch(() => { if (!response.headersSent) response.writeHead(500); response.end("Generated OAuth fixture failed."); });
  });
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const address = http.address(); if (!address || typeof address === "string") throw new Error("Generated OAuth server did not bind.");
  origin = `http://127.0.0.1:${address.port}`;
  return {
    origin, url: `${origin}/mcp`, stats: () => ({ exchanges, refreshes, mcpRequests }),
    registerClient: (id: string, redirectUri: string, secret?: string) => { clients.set(id, { redirect_uris: [redirectUri], ...(secret ? { secret } : {}) }); },
    revoke: () => { revoked = true; }, holdTokens: (gate: Promise<void>) => { tokenGate = gate; },
    callback: async (url: string) => { const response = await fetch(url, { redirect: "manual" }); const location = response.headers.get("location"); if (!location) throw new Error("Generated authorization redirect is missing."); return new URL(location); },
    close: async () => { http.closeAllConnections(); await new Promise<void>((resolve) => http.close(() => resolve())); },
  };
}
