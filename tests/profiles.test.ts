import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, readdir, symlink, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { DraftEditor, GLOBAL_PROFILE_ID, isRecord, MoguriSdk } from "../packages/sdk/src/index.ts";
import { startService } from "../apps/service/src/server.ts";
import { fixtureProvider, waitFor } from "./fixture.ts";
import type { PlatformOptions } from "../apps/service/src/platform.ts";
import { NEMOTRON_MODEL } from "../apps/service/src/voice.ts";
import { dependencyArchive, dependencyProject } from "./fixtures/dependencies.ts";

async function profileFixture(extra?: (profileId: string, directory: string) => PlatformOptions) {
  const directory = await mkdtemp(join(tmpdir(), "moguri-generated-profiles-")), stateDir = join(directory, "state"), key = Buffer.alloc(32, 0x6a);
  const providers = await Promise.all([fixtureProvider({ maxOutputTokens: 128 }), fixtureProvider({ maxOutputTokens: 128 }), fixtureProvider({ maxOutputTokens: 128 })]);
  const assigned = new Map<string, typeof providers[number]>([["default", providers[0]!]]), vaults = new Map<string, Map<string, string>>();
  const options = { stateDir, retentionKey: key, profiles: {
    provider: (id: string) => {
      let provider = assigned.get(id);
      if (!provider) { provider = providers[assigned.size]; if (!provider) throw new Error("Generated provider pool exhausted"); assigned.set(id, provider); }
      return provider.provider;
    },
    platform: (id: string) => {
      let values = vaults.get(id); if (!values) { values = new Map(); vaults.set(id, values); }
      const scoped = values;
      return { ...extra?.(id, directory), vault: { read: async (key: string) => scoped.get(key) ?? null, write: async (key: string, value: string) => { scoped.set(key, value); }, remove: async (key: string) => { scoped.delete(key); } } };
    },
  } };
  const service = await startService(options), sdk = await new MoguriSdk(service.connection).ready(), clients: MoguriSdk[] = [sdk];
  const create = async (name: string) => {
    const command = await sdk.profiles.create(name, "#557799");
    const profile = await sdk.profiles.wait(command.id!), client = await sdk.profiles.open(profile.id); clients.push(client);
    return { profile, client };
  };
  const session = (client: MoguriSdk, id: string) => {
    const value = client.getState().snapshot!.sessions.find((session) => session.id === id);
    if (!value) throw new Error("Generated scoped session is missing."); return value;
  };
  const send = async (client: MoguriSdk, id: string, text: string) => {
    await client.refresh(); const current = session(client, id);
    await client.command({ type: "draft.save", sessionId: id, expectedRevision: current.draft.revision, text, attachments: [] });
    await client.command({ type: "message.send", sessionId: id, expectedRevision: current.draft.revision + 1, delivery: "queue" });
  };
  return { directory, stateDir, key, options, providers, assigned, vaults, service, sdk, clients, create, session, send,
    close: async () => { for (const client of clients) client.disconnect(); await service.close(); for (const provider of providers) await provider.close(); await rm(directory, { recursive: true, force: true }); } };
}

test("real immutable SDK scopes isolate snapshots, drafts, same-ID receipts, artifacts, MCP grants and event replay", async () => {
  const fixture = await profileFixture();
  try {
    const a = await fixture.sdk.sessions.create(null, "Generated private Default");
    const editor = new DraftEditor(fixture.sdk, a.id!, fixture.session(fixture.sdk, a.id!).draft);
    editor.edit("Generated pending Default draft.");
    const { profile, client: beta } = await fixture.create("Generated Beta");
    try {
      assert.equal(fixture.sdk.profileId, "default"); assert.equal(beta.profileId, profile.id);
      assert.equal(beta.getState().snapshot!.sessions.length, 0);
      const b = await beta.sessions.create(null, "Generated private Beta");
      await editor.flush();
      assert.equal(fixture.session(fixture.sdk, a.id!).draft.text, "Generated pending Default draft.");
      assert.equal(fixture.session(beta, b.id!).draft.text, "");
      const common = "generated-common-profile-command";
      const first = await fixture.sdk.command({ type: "session.create", projectId: null }, common), second = await beta.command({ type: "session.create", projectId: null }, common);
      assert.notEqual(first.id, second.id);
      await assert.rejects(() => beta.artifacts.source(a.id!, "message", "generated-message"), /source session|existing source/);
      const artifact = await fixture.sdk.artifacts.create(a.id!, { kind: "decision", name: "Generated private artifact A", text: "Generated isolated retained text." });
      await assert.rejects(() => beta.artifacts.read(artifact.id!), /outside this profile/);
      for (const client of [fixture.sdk, beta]) {
        const settings = structuredClone(client.settings.get()!.values);
        settings.mcpServers = [{ id: "generated-same-server", name: "Generated scoped MCP", enabled: true, transport: { type: "http", url: "https://generated-profile.invalid/mcp", auth: "bearer" } }];
        await client.settings.update(settings, client.settings.get()!.revision);
      }
      await fixture.sdk.command({ type: "mcp.token.set", serverId: "generated-same-server", token: "generated-default-only-token" });
      assert.equal((await fixture.sdk.mcp.auth("generated-same-server")).state, "configured");
      assert.equal((await beta.mcp.auth("generated-same-server")).state, "required");
      const settings = structuredClone(beta.settings.get()!.values); settings.startup.global = { autonomy: "Guided" };
      await beta.settings.update(settings, beta.settings.get()!.revision);
      await fixture.sdk.refresh();
      assert.equal(fixture.sdk.settings.get()!.values.startup.global.autonomy, "Guided");
      assert.equal(fixture.session(fixture.sdk, a.id!).controls.autonomy, "Manual");
      const inherited = await fixture.sdk.sessions.create(null, "Generated global preferences");
      assert.equal(fixture.session(fixture.sdk, inherited.id!).controls.autonomy, "Guided");
      assert.equal(fixture.session(fixture.sdk, inherited.id!).defaults?.sources.autonomy, "global");
      await beta.settings.reset("all", beta.settings.get()!.revision);
      assert.equal(beta.settings.get()!.values.startup.global.autonomy, "Guided");
      const mismatch = await fetch(`${fixture.service.connection.baseUrl}/v1/commands`, { method: "POST", headers: { Authorization: `Bearer ${fixture.service.connection.token}`, "Content-Type": "application/json", "X-Moguri-Profile": profile.id }, body: JSON.stringify({ id: randomUUID(), profileId: "default", command: { type: "session.create", projectId: null } }) });
      assert.equal(mismatch.status, 403);
      await assert.rejects(() => fixture.sdk.profiles.open("generated-missing-profile"), /ready registered/);
      await beta.refresh(); await fixture.sdk.refresh();
      assert.ok(beta.getState().events.every((event) => event.profile_id === profile.id));
      assert.ok(fixture.sdk.getState().events.every((event) => event.profile_id === "default"));
      await fixture.sdk.profiles.update(profile.id, { name: "Generated Beta renamed" }, profile.revision);
      assert.equal(beta.profileId, profile.id);
    } finally { editor.dispose(); }
  } finally { await fixture.close(); }
});

test("global environment policy is atomic across profiles, lets only actual running Local work finish and has no new-profile permissive window", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await profileFixture();
  try {
    const { client: beta } = await fixture.create("Generated policy Beta");
    const a = await fixture.sdk.sessions.create(null, "Generated finishing Local", { modelId: fixture.providers[0]!.modelId });
    await fixture.send(fixture.sdk, a.id!, "generated delayed profile policy");
    await waitFor(() => fixture.providers[0]!.requests.length === 1);
    await beta.command({ type: "policy.set", allowedEnvs: ["Remote"] });
    await fixture.sdk.refresh();
    assert.equal(fixture.session(fixture.sdk, a.id!).localFinishing, true);
    assert.deepEqual(fixture.sdk.getState().snapshot!.policy.allowedEnvs, ["Remote"]);
    await waitFor(() => fixture.session(fixture.sdk, a.id!).status === "completed");
    const { client: gamma } = await fixture.create("Generated policy Gamma");
    assert.deepEqual(gamma.getState().snapshot!.policy.allowedEnvs, ["Remote"]);
    const blocked = await gamma.sessions.create(null, "Generated blocked Local");
    await assert.rejects(() => gamma.sessions.configure(blocked.id!, { ...fixture.session(gamma, blocked.id!).controls, modelId: fixture.providers[2]!.modelId }), /excluded/);
    assert.equal(fixture.providers[2]!.requests.length, 0);
  } finally { await fixture.close(); }
});

test("global reservations cannot be escaped by another profile, source deletion or a fresh profile", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await profileFixture();
  try {
    const { client: beta } = await fixture.create("Generated budget Beta");
    const first = await fixture.sdk.sessions.create(null, "Generated global A", { modelId: fixture.providers[0]!.modelId });
    const second = await beta.sessions.create(null, "Generated global B", { modelId: fixture.providers[1]!.modelId });
    for (const [client, id] of [[fixture.sdk, first.id!], [beta, second.id!]] as const) await client.command({ type: "draft.save", sessionId: id, expectedRevision: 0, text: "generated slow global profile budget", attachments: [] });
    const input = (await fixture.sdk.sessions.context(first.id!)).context.estimatedTokens;
    await fixture.sdk.profiles.globalBudget({ basis: "estimate", tokens: Math.ceil(input) + 128 }, 0, true);
    await Promise.all(([[fixture.sdk, first.id!], [beta, second.id!]] as const).map(async ([client, id]) => {
      await client.command({ type: "message.send", sessionId: id, expectedRevision: 1, delivery: "queue" });
    }));
    await waitFor(() => fixture.providers[0]!.requests.length + fixture.providers[1]!.requests.length === 1);
    await waitFor(() => [fixture.session(fixture.sdk, first.id!), fixture.session(beta, second.id!)].some((session) => session.status === "partial"));
    for (const [client, id] of [[fixture.sdk, first.id!], [beta, second.id!]] as const) await client.command({ type: "session.stop", sessionId: id });
    await waitFor(() => !fixture.session(fixture.sdk, first.id!).turnId && !fixture.session(beta, second.id!).turnId);
    await fixture.sdk.sessions.delete(first.id!, true); await beta.sessions.delete(second.id!, true);
    const { client: gamma } = await fixture.create("Generated budget Gamma");
    const third = await gamma.sessions.create(null, "Generated no refund", { modelId: fixture.providers[2]!.modelId });
    const status = (await gamma.budgets.status(third.id!)).status;
    assert.equal(status.remainingTokens, 0); assert.ok(status.limits.some((limit) => limit.scope === "global"));
    await fixture.send(gamma, third.id!, "Generated no free global capacity.");
    await waitFor(() => fixture.session(gamma, third.id!).status === "partial");
    assert.equal(fixture.providers[2]!.requests.length, 0);
    assert.equal((await gamma.budgets.dashboard()).totals.calls, 0);
  } finally { await fixture.close(); }
});

test("unsafe profile directories remain partial without adoption, and only an explicit retry initializes the owned root", async () => {
  const fixture = await profileFixture();
  try {
    const outside = join(fixture.directory, "generated-outside"); await mkdir(outside);
    const parent = join(fixture.stateDir, "profiles"); await symlink(outside, parent);
    const created = await fixture.sdk.profiles.create("Generated guarded setup");
    await assert.rejects(() => fixture.sdk.profiles.wait(created.id!), /canonical|private|adopt/);
    const profile = (await fixture.sdk.profiles.list()).catalog.profiles.find((profile) => profile.id === created.id)!;
    assert.equal(profile.status, "partial"); assert.deepEqual(await readdir(outside), []);
    await unlink(parent);
    await fixture.sdk.profiles.retry(profile.id, profile.revision, true); await fixture.sdk.profiles.wait(profile.id);
    const client = await fixture.sdk.profiles.open(profile.id); fixture.clients.push(client);
    assert.equal(client.getState().snapshot!.projects.length, 0);
    assert.equal(client.getState().snapshot!.sessions.length, 0);
  } finally { await fixture.close(); }
});

test("interrupted profile creation is retained as partial on restart and never creates resources by replay", async () => {
  const fixture = await profileFixture();
  let restarted: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    const id = randomUUID(), global = fixture.service.store.view(GLOBAL_PROFILE_ID);
    global.commit([{ event_type: "profile.saved", profile_id: GLOBAL_PROFILE_ID, payload: { profile: { id, name: "Generated interrupted setup", color: null, revision: 0, createdAt: "2026-01-01T00:00:00Z", status: "creating", diagnostic: null } } }]); global.close();
    for (const client of fixture.clients) client.disconnect(); await fixture.service.close();
    restarted = await startService(fixture.options);
    const client = await new MoguriSdk(restarted.connection).ready();
    try {
      const profile = (await client.profiles.list()).catalog.profiles.find((profile) => profile.id === id)!;
      assert.equal(profile.status, "partial"); assert.match(profile.diagnostic!, /No .*replayed/);
      assert.equal((await readdir(fixture.stateDir)).includes("profiles"), false);
    } finally { client.disconnect(); }
  } finally { await restarted?.close(); await fixture.close(); }
});

test("shared physical roots serialize writers across profiles and keep another profile's unconfirmed quarantine authoritative", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await profileFixture();
  try {
    const root = join(fixture.directory, "generated-shared-root"); await mkdir(root);
    const { client: beta } = await fixture.create("Generated shared-root Beta");
    const firstProject = await fixture.sdk.command({ type: "project.add", path: root }), secondProject = await beta.command({ type: "project.add", path: root });
    const first = await fixture.sdk.sessions.create(firstProject.id!, "Generated writer A", { modelId: fixture.providers[0]!.modelId });
    const second = await beta.sessions.create(secondProject.id!, "Generated writer B", { modelId: fixture.providers[1]!.modelId });
    await fixture.send(fixture.sdk, first.id!, "generated slow first profile writer");
    await waitFor(() => fixture.providers[0]!.requests.length === 1);
    await fixture.send(beta, second.id!, "Generated waiting second profile writer.");
    assert.equal(fixture.session(beta, second.id!).status, "queued"); assert.equal(fixture.providers[1]!.requests.length, 0);
    await fixture.sdk.command({ type: "session.stop", sessionId: first.id! });
    await waitFor(() => fixture.session(beta, second.id!).status === "completed");
    assert.equal(fixture.providers[1]!.requests.length, 1);
    await fixture.send(fixture.sdk, first.id!, "generated provider failure");
    await waitFor(() => fixture.session(fixture.sdk, first.id!).status === "failed");
    await fixture.send(beta, second.id!, "Generated globally quarantined root.");
    assert.equal(fixture.session(beta, second.id!).status, "queued");
    assert.equal(fixture.providers[1]!.requests.length, 1);
    await fixture.sdk.command({ type: "session.resume", sessionId: first.id! });
    await waitFor(() => fixture.session(beta, second.id!).status === "completed");
    assert.equal(fixture.providers[1]!.requests.length, 2);
  } finally { await fixture.close(); }
});

test("a failed global policy write rolls back every profile projection and its initiating receipt", async () => {
  const fixture = await profileFixture();
  try {
    const { client: beta } = await fixture.create("Generated atomic policy Beta");
    fixture.service.store.db.exec(`CREATE TRIGGER generated_global_policy_failure BEFORE INSERT ON events
      WHEN json_extract(NEW.data,'$.event_type')='global.policy_changed'
      BEGIN SELECT RAISE(ABORT,'Generated global policy failure'); END;`);
    await assert.rejects(() => fixture.sdk.command({ type: "policy.set", allowedEnvs: ["Remote"] }, "generated-atomic-policy-command"), /operation failed/);
    await beta.refresh();
    assert.deepEqual(fixture.sdk.getState().snapshot!.policy.allowedEnvs, ["Local", "Sandbox", "Remote"]);
    assert.deepEqual(beta.getState().snapshot!.policy.allowedEnvs, ["Local", "Sandbox", "Remote"]);
    assert.deepEqual((await fixture.sdk.profiles.list()).catalog.environmentPolicy.allowedEnvs, ["Local", "Sandbox", "Remote"]);
    assert.equal(fixture.service.store.db.prepare("SELECT count(*) AS count FROM receipts WHERE id=?").get("generated-atomic-policy-command")?.count, 0);
  } finally { fixture.service.store.db.exec("DROP TRIGGER IF EXISTS generated_global_policy_failure"); await fixture.close(); }
});

test("a profile initializing across a global policy change refreshes authority before exposing its snapshot", async (t) => {
  const fixture = await profileFixture();
  let release!: () => void;
  try {
    const created = await fixture.sdk.profiles.create("Generated delayed initialization"); await fixture.sdk.profiles.wait(created.id!);
    const gate = new Promise<void>((resolve) => { release = resolve; }), original = fixture.providers[1]!.provider.refresh.bind(fixture.providers[1]!.provider);
    let entered = false;
    t.mock.method(fixture.providers[1]!.provider, "refresh", async () => { entered = true; await gate; await original(); });
    const opening = fixture.sdk.profiles.open(created.id!);
    await waitFor(() => entered);
    await fixture.sdk.command({ type: "policy.set", allowedEnvs: ["Sandbox"] });
    release();
    const beta = await opening; fixture.clients.push(beta);
    assert.deepEqual(beta.getState().snapshot!.policy.allowedEnvs, ["Sandbox"]);
    assert.equal(fixture.providers[1]!.requests.length, 0);
  } finally { release?.(); await fixture.close(); }
});

test("public dependency archives share one verified cache across profiles without sharing mutable installs or provider state", async () => {
  let artifact: Awaited<ReturnType<typeof dependencyArchive>> | undefined, downloads = 0;
  const fixture = await profileFixture(() => ({ cache: { fetch: async (input) => {
    const url = String(input);
    if (url.startsWith("https://api.osv.dev/")) return Response.json({ results: artifact ? [{ vulns: [] }] : [] });
    if (!artifact || url !== artifact.url) throw new Error("Unexpected generated cache URL");
    downloads++; return new Response(artifact.bytes);
  } } }));
  try {
    artifact = await dependencyArchive(fixture.directory);
    const { client: beta } = await fixture.create("Generated public-cache Beta");
    const roots = [join(fixture.directory, "generated-cache-a"), join(fixture.directory, "generated-cache-b")];
    for (const [index, client] of [fixture.sdk, beta].entries()) {
      await dependencyProject(roots[index]!, artifact);
      const project = await client.command({ type: "project.add", path: roots[index]! }), plan = (await client.cache.inspect(project.id!, "npm")).plan;
      const prepared = await client.cache.prepare(project.id!, "npm", plan.digest, true);
      assert.equal((await client.jobs.wait(prepared.id!)).status, "completed");
      const receipt: unknown = JSON.parse((await client.mcp.readResult(prepared.id!)).text);
      assert.ok(isRecord(receipt));
      assert.equal(receipt.downloadedBytes, index === 0 ? artifact.bytes.length : 0);
      assert.equal(receipt.reused, index === 0 ? 0 : 1);
    }
    assert.equal(downloads, 1);
    assert.equal(fixture.sdk.getState().snapshot!.projects.length, 1); assert.equal(beta.getState().snapshot!.projects.length, 1);
  } finally { await fixture.close(); }
});

test("verified public speech weights download once while voice preferences and capture state remain profile-scoped", async () => {
  const weights = Buffer.from("Generated shared public model weights."); let downloads = 0;
  const fixture = await profileFixture((_id, directory) => ({ speech: {
    executable: process.execPath, prefixArgs: [resolve("tests/fixtures/fake-speech.mjs")], modelDirectory: join(directory, "generated-public-models"),
    model: { ...NEMOTRON_MODEL, filename: "generated-shared.gguf", bytes: weights.length, sha256: createHash("sha256").update(weights).digest("hex") },
    fetch: async () => { downloads++; return new Response(weights); },
  } }));
  try {
    const download = await fixture.sdk.voice.download(true); assert.equal((await fixture.sdk.jobs.wait(download.id!)).status, "completed");
    const { client: beta } = await fixture.create("Generated speech Beta");
    assert.equal((await beta.voice.status()).voice.modelReady, true);
    const repeated = await beta.voice.download(true); assert.equal((await beta.jobs.wait(repeated.id!)).status, "completed");
    assert.equal(downloads, 1);
    const settings = structuredClone(beta.settings.get()!.values); settings.voice.language = "es-ES";
    await beta.settings.update(settings, beta.settings.get()!.revision); await fixture.sdk.refresh();
    assert.equal(beta.settings.get()!.values.voice.language, "es-ES"); assert.equal(fixture.sdk.settings.get()!.values.voice.language, "auto");
    assert.equal(beta.getState().snapshot!.jobs.filter((job) => job.kind === "voice.record").length, 0);
    assert.equal(fixture.providers[0]!.requests.length, 0); assert.equal(fixture.providers[1]!.requests.length, 0);
  } finally { await fixture.close(); }
});
