import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { EventStore } from "../apps/service/src/store.ts";
import { PROTOCOL_VERSION, MoguriSdk } from "../packages/sdk/src/index.ts";
import { startService } from "../apps/service/src/server.ts";
import { setupFixture, waitFor } from "./fixture.ts";
import { generatedRepository, generatedGit as git } from "./fixtures/git.ts";
import { generatedRepositoryMetadata } from "./fixtures/repository-info.ts";

test("schema-22 marker failure leaves exact schema-21 ciphertext and recovers without a data reset", async () => {
  const root = await mkdtemp(join(tmpdir(), "moguri-repository-migration-")), path = join(root, "state.sqlite"), key = randomBytes(32);
  let store: EventStore | undefined = new EventStore(path, key, "generated-repository-key");
  try {
    store.commit([{ event_type: "job.progress", profile_id: "default", payload: { jobId: "generated-source", progress: "Generated encrypted source." } }]);
    const before = store.db.prepare("SELECT seq,id,payload FROM events ORDER BY seq").all();
    store.db.exec(`BEGIN IMMEDIATE; DELETE FROM retention_metadata WHERE id IN ('repository_attribution_schema','terminal_ownership_schema'); PRAGMA user_version=21;
      CREATE TRIGGER generated_repository_marker BEFORE INSERT ON retention_metadata WHEN NEW.id='repository_attribution_schema'
      BEGIN SELECT RAISE(ABORT,'Generated repository marker failure'); END; COMMIT;`);
    store.close(); store = undefined;
    assert.throws(() => new EventStore(path, key, "generated-repository-key"), /Generated repository marker failure/);
    const raw = new DatabaseSync(path);
    try {
      assert.equal(raw.prepare("PRAGMA user_version").get()?.user_version, 21);
      assert.deepEqual(raw.prepare("SELECT seq,id,payload FROM events ORDER BY seq").all(), before);
      raw.exec("DROP TRIGGER generated_repository_marker");
    } finally { raw.close(); }
    store = new EventStore(path, key, "generated-repository-key");
    assert.equal(store.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
    assert.deepEqual(store.db.prepare("SELECT seq,id,payload FROM events ORDER BY seq").all(), before);
  } finally { store?.close(); await rm(root, { recursive: true, force: true }); }
});

test("failed observation retention publishes no success and a pending refresh recovers partial without another lookup", async (t) => {
  let lookups = 0;
  const fixture = await setupFixture({ platform: { integrations: { fetch: async () => { lookups++; return Response.json(generatedRepositoryMetadata()); } } } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  let restarted: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    await generatedRepository(fixture.project); await git(fixture.project, "remote", "add", "origin", "https://github.com/generated/example.git");
    const commit = fixture.service.store.commit.bind(fixture.service.store);
    const mock = t.mock.method(fixture.service.store, "commit", (...args: Parameters<typeof commit>) => {
      if (args[0].some((event) => event.event_type === "repository.recorded")) throw new Error("Generated repository retention failure");
      return commit(...args);
    });
    const preview = (await sdk.repositories.preview(fixture.sessionId)).preview;
    const refresh = await sdk.repositories.refresh(fixture.sessionId, preview.bindingDigest, preview.revision, true);
    assert.equal((await sdk.jobs.wait(refresh.id!)).status, "failed");
    assert.equal((await sdk.repositories.state(fixture.sessionId)).observation, null); mock.mock.restore();
    fixture.service.store.commit([{ event_type: "job.started", profile_id: "default", project_id: fixture.session().projectId, session_id: fixture.sessionId, payload: { job: {
      id: "generated-interrupted-repository", kind: "repository.refresh", sessionId: fixture.sessionId, projectId: fixture.session().projectId,
      workspaceId: null, parentTurnId: null, status: "running", progress: "Generated interrupted lookup", resultDigest: null, error: null,
    } } }]);
    sdk.disconnect(); await fixture.service.close();
    restarted = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey,
      platform: { integrations: { fetch: async () => { lookups++; return Response.json(generatedRepositoryMetadata()); } } } });
    assert.equal(restarted.controller.snapshot().jobs.find((job) => job.id === "generated-interrupted-repository")?.status, "partial");
    assert.equal(restarted.controller.snapshot().repositoryObservations.length, 0); assert.equal(lookups, 1); assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await restarted?.close(); await fixture.close(); }
});

test("a real scope change while per-call Git attribution is held cannot admit stale model work or a charge", { skip: process.platform !== "darwin" }, async (t) => {
  const fixture = await setupFixture({ platform: { integrations: { fetch: async () => Response.json(generatedRepositoryMetadata()) } } }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  let release = () => {}, held = false;
  const barrier = new Promise<void>((resolve) => { release = resolve; });
  try {
    await generatedRepository(fixture.project); await git(fixture.project, "remote", "add", "origin", "https://github.com/generated/example.git");
    const preview = (await sdk.repositories.preview(fixture.sessionId)).preview;
    const refresh = await sdk.repositories.refresh(fixture.sessionId, preview.bindingDigest, preview.revision, true);
    assert.equal((await sdk.jobs.wait(refresh.id!)).status, "completed"); await fixture.configure();
    const projects = fixture.service.controller.platform.sessions.projects, read = projects.gitView.bind(projects);
    t.mock.method(projects, "gitView", async (...args: Parameters<typeof read>) => { const result = await read(...args); held = true; await barrier; return result; });
    await fixture.send("Generated held repository admission."); await waitFor(() => held);
    const configuration = (await sdk.projects.configuration(fixture.session().projectId)).configuration;
    await sdk.projects.configure(configuration.projectId, { ...configuration.values, repo: { ...configuration.values.repo, upstream: "generated-new-upstream" } }, configuration.revision);
    release(); await fixture.terminal();
    assert.equal(fixture.requests.length, 0); assert.equal((await sdk.budgets.dashboard()).totals.calls, 0);
    assert.notEqual(fixture.session().status, "completed");
  } finally { release(); sdk.disconnect(); await fixture.close(); }
});

test("an unconfigured external MCP admission cannot move to a different binding across the new asynchronous capture boundary", { skip: process.platform !== "darwin" }, async (t) => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  let release = () => {}, held = false;
  const barrier = new Promise<void>((resolve) => { release = resolve; });
  try {
    const repositories = fixture.service.controller.platform.repositories, capture = repositories.capture.bind(repositories);
    t.mock.method(repositories, "capture", async (...args: Parameters<typeof capture>) => { const result = await capture(...args); held = true; await barrier; return result; });
    const tool = (await sdk.mcp.tools("builtin", "grep", 0, fixture.sessionId)).tools.find((tool) => tool.name === "grep_logs")!;
    const pending = sdk.mcp.call(fixture.sessionId, "builtin", tool.name, { path: "fixture.txt", query: "generated" }, tool.digest);
    await waitFor(() => held);
    const configuration = (await sdk.projects.configuration(fixture.session().projectId)).configuration;
    await sdk.projects.configure(configuration.projectId, { ...configuration.values, repo: { ...configuration.values.repo, upstream: "generated-new-upstream" } }, configuration.revision);
    release();
    await assert.rejects(() => pending, { code: "mcp_scope_changed" });
    assert.equal((await sdk.telemetry.operations()).totals.attempts, 0);
    assert.equal(fixture.requests.length, 0);
  } finally { release(); sdk.disconnect(); await fixture.close(); }
});
