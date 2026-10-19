import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { auth } from "@modelcontextprotocol/sdk/client/auth.js";

let origin;
let registration;
let challenge;
let client;
let tokens;
let verifier;
let discovery;
let authorization;
let refreshes = 0;
const server = createServer((request, response) => {
  void (async () => {
    const url = new URL(request.url, origin);
    response.setHeader("Content-Type", "application/json");
    const json = (value, status = 200) => { response.writeHead(status); response.end(JSON.stringify(value)); };
    if (url.pathname.startsWith("/.well-known/oauth-protected-resource")) return json({ resource: `${origin}/mcp`, authorization_servers: [origin], scopes_supported: ["tools"] });
    if (url.pathname.startsWith("/.well-known/oauth-authorization-server")) return json({
      issuer: origin, authorization_endpoint: `${origin}/authorize`, token_endpoint: `${origin}/token`, registration_endpoint: `${origin}/register`,
      response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"],
      token_endpoint_auth_methods_supported: ["none"], code_challenge_methods_supported: ["S256"],
    });
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString("utf8");
    if (url.pathname === "/register") { registration = JSON.parse(body); return json({ ...registration, client_id: "generated-client" }, 201); }
    if (url.pathname === "/token") {
      const input = new URLSearchParams(body);
      assert.equal(input.get("resource"), `${origin}/mcp`);
      if (input.get("grant_type") === "authorization_code") {
        assert.equal(input.get("code"), "generated-code");
        assert.equal(createHash("sha256").update(input.get("code_verifier")).digest("base64url"), challenge);
      } else { assert.equal(input.get("grant_type"), "refresh_token"); assert.equal(input.get("refresh_token"), "generated-refresh"); refreshes++; }
      return json({ access_token: `generated-access-${refreshes}`, refresh_token: "generated-refresh", token_type: "Bearer", expires_in: 60 });
    }
    json({ error: "generated_not_found" }, 404);
  })().catch((error) => { console.error(error); response.writeHead(400); response.end('{"error":"generated_probe_failed"}'); });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
origin = `http://127.0.0.1:${server.address().port}`;
const provider = {
  redirectUrl: "http://127.0.0.1:34567/oauth/callback",
  clientMetadata: { client_name: "Generated Moguri probe", redirect_uris: ["http://127.0.0.1:34567/oauth/callback"], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" },
  state: () => "generated-state",
  clientInformation: () => client,
  saveClientInformation: (value) => { client = value; },
  tokens: () => tokens,
  saveTokens: (value) => { tokens = value; },
  redirectToAuthorization: (value) => { authorization = value; },
  saveCodeVerifier: (value) => { verifier = value; },
  codeVerifier: () => verifier,
  saveDiscoveryState: (value) => { discovery = value; },
  discoveryState: () => discovery,
};
try {
  const started = performance.now();
  assert.equal(await auth(provider, { serverUrl: `${origin}/mcp` }), "REDIRECT");
  assert.equal(authorization.searchParams.get("state"), "generated-state");
  challenge = authorization.searchParams.get("code_challenge");
  assert.equal(authorization.searchParams.get("code_challenge_method"), "S256");
  assert.equal(createHash("sha256").update(verifier).digest("base64url"), challenge);
  assert.ok(registration.redirect_uris.includes(provider.redirectUrl));
  assert.equal(await auth(provider, { serverUrl: `${origin}/mcp`, authorizationCode: "generated-code" }), "AUTHORIZED");
  assert.equal(tokens.access_token, "generated-access-0");
  assert.equal(tokens.issuer, origin); assert.equal(client.issuer, origin);
  assert.equal(await auth(provider, { serverUrl: `${origin}/mcp` }), "AUTHORIZED");
  assert.equal(refreshes, 1);
  assert.equal(tokens.access_token, "generated-access-1");
  console.log(JSON.stringify({ status: "PASS", primitive: "Official MCP OAuth discovery/DCR/PKCE/issuer binding/refresh", refreshes, ms: performance.now() - started }, null, 2));
} finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
