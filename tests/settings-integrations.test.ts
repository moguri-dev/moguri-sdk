import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { MoguriSdk, defaultSettings, sqlEndpoint } from "../packages/sdk/src/index.ts";
import { sqlConnection } from "../apps/service/src/sql-connection.ts";
import { validateSettings } from "../apps/service/src/permissions.ts";
import { setupFixture } from "./fixture.ts";

test("SQL connection is opt-in, origin-bound and health-only, never a daemon start or database scan", async () => {
  const paths: string[] = [];
  const server = createServer((request, response) => { paths.push(`${request.method} ${request.url}`); response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ status: "ok", version: "generated-fixture" })); });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Generated SQL health listener failed.");
  const settings = defaultSettings(), endpoint = `http://127.0.0.1:${address.port}`;
  settings.integrations = { sql: { enabled: false, endpoint } };
  try {
    assert.equal((await sqlConnection(settings)).healthy, false);
    assert.deepEqual(paths, []);
    settings.integrations.sql.enabled = true;
    assert.equal((await sqlConnection(settings)).version, "generated-fixture");
    assert.deepEqual(paths, ["GET /api/health"]);
    for (const endpoint of ["http://example.invalid:9147", "https://user:secret@example.invalid", "http://127.0.0.1:9147/api/scan", "https://example.invalid/?path=state.sqlite"]) {
      assert.throws(() => sqlEndpoint(endpoint));
      assert.throws(() => validateSettings({ ...settings, integrations: { sql: { enabled: true, endpoint } } }), /daemon origin/);
    }
    await assert.rejects(() => sqlConnection(settings, async () => Response.json({ status: "bad", version: "generated" })), /health\/version response/);
    await assert.rejects(() => sqlConnection(settings, async () => new Response("generated error", { status: 503 })), /HTTP 503/);
  } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
});

test("GitHub and Linear connections work without a project, remain separate from Copilot and never retain credentials", async () => {
  let token: string | null = null, reads = 0;
  const commands: { executable: string; args: string[]; cwd: string }[] = [];
  const fixture = await setupFixture({ platform: { integrations: {
    program: async (executable, args, options) => { commands.push({ executable, args, cwd: options.cwd }); return JSON.stringify({ login: "generated-cli", id: 42 }); },
    vault: { read: async () => token, write: async (_id, value) => { token = value; }, remove: async () => { token = null; } },
    fetch: async (url, init) => {
      assert.equal(String(url), "https://api.linear.app/graphql");
      assert.equal(new Headers(init?.headers).get("Authorization"), "generated-linear-key");
      reads++;
      return Response.json({ data: { viewer: { id: "generated-user", name: "Generated user" }, organization: { id: "generated-workspace", name: "Generated workspace" } } });
    },
  } } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const projectId = fixture.session().projectId;
    await sdk.sessions.delete(fixture.sessionId, true);
    await sdk.projects.remove(projectId, true, 0);
    const provider = structuredClone(sdk.getState().snapshot!.provider);
    assert.equal((await sdk.linear.connection()).connection.credential, "required");
    await sdk.linear.setToken("generated-linear-key");
    assert.equal((await sdk.linear.connection()).connection.account, null);
    assert.equal(reads, 0);
    assert.equal((await sdk.linear.connection(true)).connection.account?.workspaceId, "generated-workspace");
    assert.equal(reads, 1);
    const github = (await sdk.integrations.githubConnection()).connection;
    assert.deepEqual(github, { login: "generated-cli", id: 42, boundary: "control-plane-gh-cli" });
    assert.deepEqual(commands[0]?.args, ["api", "--hostname", "github.com", "--method", "GET", "user"]);
    assert.notEqual(commands[0]?.cwd, fixture.project);
    assert.deepEqual(sdk.getState().snapshot!.provider, provider);
    assert.equal(fixture.requests.length, 0);
    assert.equal(JSON.stringify(fixture.service.controller.events(0)).includes("generated-linear-key"), false);
    await sdk.linear.clearToken(); assert.equal((await sdk.linear.connection()).connection.credential, "required");
  } finally { sdk.disconnect(); await fixture.close(); }
});
