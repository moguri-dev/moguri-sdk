import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MoguriSdk, type SkillSource, type Snapshot } from "../packages/sdk/src/index.ts";
import { setupFixture } from "./fixture.ts";
import { generatedZip } from "./fixtures/documents.ts";
import { SkillGateway } from "../apps/service/src/skill-gateway.ts";
import { startService } from "../apps/service/src/server.ts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createGatewayMcpServer } from "../packages/sdk/src/mcp-server.ts";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";

const skill = (body: string) => `---\nname: generated-review\ndescription: Review generated changes with exact evidence\n---\n${body}\n`;
const remote: SkillSource = { id: "generated-remote", name: "Generated remote skills", enabled: true, kind: "remote", url: "https://generated.invalid/skills.zip" };
async function sources(sdk: MoguriSdk, skillSources: SkillSource[]) {
  const settings = sdk.settings.get()!;
  await sdk.settings.update({ ...settings.values, skillSources }, settings.revision);
}

test("a configured local folder discovers nested standard skills and rejects a changed body before loading", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const root = join(fixture.directory, "generated-skills");
    await mkdir(join(root, "review"), { recursive: true });
    await writeFile(join(root, "review", "SKILL.md"), skill("Use generated fixtures."));
    const settings = sdk.settings.get()!;
    await sdk.settings.update({ ...settings.values, skillSources: [{ id: "generated-local", name: "Generated skills", kind: "local", path: root, enabled: true }] }, settings.revision);
    const found = await sdk.skills.find("review", { sessionId: fixture.sessionId });
    assert.equal(found.skills.length, 1);
    assert.equal(found.skills[0]!.name, "generated-review");
    const selected = found.skills[0]!;
    assert.match((await sdk.skills.read(selected.id, selected.digest, fixture.sessionId)).body, /Use generated fixtures/);
    await writeFile(join(root, "review", "SKILL.md"), skill("Changed generated instructions."));
    await assert.rejects(() => sdk.skills.read(selected.id, selected.digest, fixture.sessionId), /changed|digest|fresh/i);
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("remote archives download and check exact bytes on every find/read, without a stale failure fallback", async () => {
  let archive = generatedZip([{ name: "generated/review/SKILL.md", text: skill("Generated remote body.") }]), calls = 0, fail = false;
  const fixture = await setupFixture({ platform: { skillGateway: { fetch: async (_url, options) => {
    calls++; assert.equal(options?.redirect, "error"); assert.equal(options?.cache, "no-store");
    return fail ? new Response("Generated unavailable archive.", { status: 503 }) : new Response(Uint8Array.from(archive));
  } } } }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await sources(sdk, [remote]);
    const found = (await sdk.skills.find("review", { sessionId: fixture.sessionId })).skills[0]!;
    assert.match((await sdk.skills.read(found.id, found.digest, fixture.sessionId)).body, /Generated remote body/);
    assert.equal(calls, 2);
    archive = generatedZip([{ name: "generated/review/SKILL.md", text: skill("Changed remote body.") }]);
    await assert.rejects(() => sdk.skills.read(found.id, found.digest, fixture.sessionId), /changed/);
    fail = true;
    await assert.rejects(() => sdk.skills.find("review", { sessionId: fixture.sessionId }), /download failed.*503/i);
    assert.equal(calls, 4); assert.equal(fixture.requests.length, 0);
    assert.equal(fixture.service.controller.snapshot().registry.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("archives reject traversal, links, duplicate paths, encryption, bad CRC, binary skills and oversized bodies", async () => {
  const fixtures = [
    generatedZip([{ name: "../outside/SKILL.md", text: skill("Generated traversal.") }]),
    generatedZip([{ name: "generated/SKILL.md", text: skill("Generated symlink."), mode: 0o120777 }]),
    generatedZip([{ name: "generated/SKILL.md", text: skill("Generated first.") }, { name: "generated/SKILL.md", text: skill("Generated duplicate.") }]),
    generatedZip([{ name: "generated/SKILL.md", text: skill("Generated encrypted."), flags: 1 }]),
    generatedZip([{ name: "generated/SKILL.md", text: skill("Generated corrupt."), crc: 0 }]),
    generatedZip([{ name: "generated/SKILL.md", bytes: Buffer.from([0xff, 0xfe, 0x00]) }]),
    generatedZip([{ name: "generated/SKILL.md", text: skill("generated ".repeat(8000)) }]),
    generatedZip([{ name: "generated/SKILL.md", text: "---\nname: invalid name\n---\nGenerated malformed skill." }]),
  ];
  let archive = fixtures[0]!;
  const fixture = await setupFixture({ platform: { skillGateway: { fetch: async () => new Response(Uint8Array.from(archive)) } } }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await sources(sdk, [remote]);
    for (archive of fixtures) await assert.rejects(() => sdk.skills.find(), /archive|skill|entry|file|UTF-8/i);
    assert.equal(fixture.service.controller.snapshot().registry.length, 0);
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("local links are rejected and exact source configuration validates before any network lookup", async () => {
  let calls = 0;
  const fixture = await setupFixture({ platform: { skillGateway: { fetch: async () => { calls++; throw new Error("Generated unexpected fetch."); } } } }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const root = join(fixture.directory, "generated-linked-skills"), target = join(fixture.directory, "generated-outside-skill");
    await mkdir(root); await writeFile(target, skill("Generated outside content.")); await symlink(target, join(root, "SKILL.md"));
    await sources(sdk, [{ id: "generated-local", name: "Generated linked folder", kind: "local", enabled: true, path: root }]);
    await assert.rejects(() => sdk.skills.find(), /symlink/i);
    for (const url of ["file:///generated/skills.zip", "https://user:generated@example.invalid/skills.zip", "https://generated.invalid/skills.zip?token=generated", "https://github.com/generated/skills/tree/main"]) {
      await assert.rejects(() => sources(sdk, [{ ...remote, url }]), /HTTPS|credentials|root|ZIP/i);
    }
    await assert.rejects(() => sources(sdk, [remote, remote]), /unique/);
    assert.equal(calls, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("revoking a source during download rejects the result and cannot return an older catalog", async () => {
  const started = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const fixture = await setupFixture({ platform: { skillGateway: { fetch: async () => {
    started.resolve(); await release.promise;
    return new Response(Uint8Array.from(generatedZip([{ name: "generated/SKILL.md", text: skill("Generated delayed body.") }])));
  } } } }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await sources(sdk, [remote]);
    const pending = sdk.skills.find("", { sessionId: fixture.sessionId });
    await started.promise; await sources(sdk, []); release.resolve();
    await assert.rejects(() => pending, /authority changed|sources.*changed/i);
    assert.deepEqual((await sdk.skills.find()).skills, []);
  } finally { release.resolve(); sdk.disconnect(); await fixture.close(); }
});

test("cancellation aborts a source download and does not publish partial skills", async () => {
  const fixture = await setupFixture();
  const snapshot: Snapshot = structuredClone(fixture.service.controller.snapshot());
  snapshot.settings.values.skillSources = [remote];
  const started = Promise.withResolvers<void>();
  const gateway = new SkillGateway(fixture.service.store, { snapshot: () => snapshot, skill: () => ({ name: "generated-review", description: "Generated cancellation fixture." }), compatible: () => {} }, {
    fetch: async (_url, options) => {
      started.resolve();
      return new Promise<Response>((_resolve, reject) => {
        options!.signal!.throwIfAborted();
        options!.signal!.addEventListener("abort", () => reject(options!.signal!.reason), { once: true });
      });
    },
  });
  try {
    const abort = new AbortController(), pending = gateway.query({ type: "skills.find", query: "", offset: 0 }, abort.signal);
    await started.promise; abort.abort(new Error("Generated cancelled source lookup."));
    await assert.rejects(() => pending, /cancelled/);
    assert.equal(snapshot.registry.length, 0);
  } finally { gateway.close(); await fixture.close(); }
});

test("SDK cancellation reaches the actual service-owned download across the authenticated HTTP request", { timeout: 5000 }, async () => {
  const started = Promise.withResolvers<void>(), stopped = Promise.withResolvers<void>();
  const fixture = await setupFixture({ platform: { skillGateway: { fetch: async (_url, options) => {
    started.resolve();
    return new Promise<Response>((_resolve, reject) => {
      options!.signal!.throwIfAborted();
      options!.signal!.addEventListener("abort", () => { stopped.resolve(); reject(options!.signal!.reason); }, { once: true });
    });
  } } } }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  const abort = new AbortController();
  try {
    await sources(sdk, [remote]);
    const pending = sdk.skills.find("", { sessionId: fixture.sessionId, signal: abort.signal });
    const rejected = assert.rejects(pending, /Generated client cancellation/);
    await started.promise; abort.abort(new Error("Generated client cancellation."));
    await rejected; await stopped.promise;
    assert.equal(fixture.service.controller.snapshot().registry.length, 0); assert.equal(fixture.requests.length, 0);
  } finally { abort.abort(); sdk.disconnect(); await fixture.close(); }
});

test("outward MCP finds and reads skills without a model call, installation or self-approval", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  const server = createGatewayMcpServer(sdk, fixture.sessionId), caller = new Client({ name: "generated-skill-consumer", version: "1" });
  const [local, peer] = InMemoryTransport.createLinkedPair();
  try {
    const root = join(fixture.directory, "generated-mcp-skills");
    await mkdir(root); await writeFile(join(root, "SKILL.md"), skill("Generated outward gateway body."));
    await sources(sdk, [{ id: "generated-local", name: "Generated MCP skills", kind: "local", path: root, enabled: true }]);
    await server.connect(peer); await caller.connect(local);
    const found = await caller.callTool({ name: "moguri_find_skills", arguments: { query: "generated review" } });
    assert.equal(found.isError, undefined);
    const content = CallToolResultSchema.parse(found).content.find((value) => value.type === "text");
    assert.ok(content?.type === "text");
    const data = JSON.parse(content.text);
    const loaded = await caller.callTool({ name: "moguri_read_skill", arguments: { skillId: data.skills[0].id, expectedDigest: data.skills[0].digest } });
    assert.match(JSON.stringify(loaded), /Generated outward gateway body/);
    assert.match(JSON.stringify(loaded), /never permission/);
    const invalid = await caller.callTool({ name: "moguri_find_skills", arguments: { query: "", sessionId: "generated-foreign-session" } });
    assert.equal(invalid.isError, true);
    assert.equal(fixture.session().pendingApproval, null);
    assert.equal(fixture.service.controller.snapshot().registry.length, 0);
    assert.equal(fixture.requests.length, 0);
  } finally { await caller.close(); await server.close(); sdk.disconnect(); await fixture.close(); }
});

test("skill catalogs are bounded, bind page freshness and stay isolated from other profiles", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  let other: MoguriSdk | undefined;
  try {
    const root = join(fixture.directory, "generated-paged-skills");
    for (let index = 0; index < 9; index++) {
      const directory = join(root, String(index)); await mkdir(directory, { recursive: true }); await writeFile(join(directory, "SKILL.md"), skill(`Generated page ${index}.`));
    }
    await sources(sdk, [{ id: "generated-local", name: "Generated paged skills", kind: "local", path: root, enabled: true }]);
    const first = await sdk.skills.find("", { sessionId: fixture.sessionId });
    assert.equal(first.skills.length, 8); assert.equal(first.nextOffset, 8); assert.equal(first.total, 9);
    const last = await sdk.skills.find("", { sessionId: fixture.sessionId, offset: 8, expectedCatalogDigest: first.catalogDigest });
    assert.equal(last.skills.length, 1); assert.equal(last.nextOffset, null);
    await writeFile(join(root, "0", "SKILL.md"), skill("Generated changed page."));
    await assert.rejects(() => sdk.skills.find("", { sessionId: fixture.sessionId, offset: 8, expectedCatalogDigest: first.catalogDigest }), /changed between pages/);
    const created = await sdk.profiles.create("Generated isolated skills"); await sdk.profiles.wait(created.id!);
    other = await sdk.profiles.open(created.id!);
    assert.deepEqual((await other.skills.find()).skills, []);
    await assert.rejects(() => other!.skills.read(first.skills[0]!.id, first.skills[0]!.digest), /removed|disabled|changed/);
    await assert.rejects(() => other!.skills.find("", { sessionId: fixture.sessionId }), /outside.*profile/);
    assert.equal(fixture.requests.length, 0);
  } finally { other?.disconnect(); sdk.disconnect(); await fixture.close(); }
});

test("configured skill sources never become an implicit Local fallback for a Remote or Sandbox agent", async () => {
  const fixture = await setupFixture();
  const snapshot: Snapshot = structuredClone(fixture.service.controller.snapshot());
  snapshot.settings.values.skillSources = [remote];
  let downloads = 0;
  const gateway = new SkillGateway(fixture.service.store, { snapshot: () => snapshot, skill: () => ({ name: "generated-review", description: "Generated transport fixture." }), compatible: () => {} },
    { fetch: async () => { downloads++; throw new Error("Generated Local fallback must not run."); } });
  try {
    for (const env of ["Remote", "Sandbox"] as const) {
      snapshot.sessions[0]!.controls.env = env;
      await assert.rejects(() => gateway.query({ type: "skills.find", sessionId: fixture.sessionId, query: "", offset: 0 }), /not qualified.*no Local fallback/i);
    }
    assert.equal(downloads, 0);
  } finally { gateway.close(); await fixture.close(); }
});

test("saved skill sources survive restart but their bodies are always re-read instead of recovered from cache", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  let restarted: Awaited<ReturnType<typeof startService>> | undefined, peer: MoguriSdk | undefined;
  try {
    const root = join(fixture.directory, "generated-restart-skills"); await mkdir(root);
    await writeFile(join(root, "SKILL.md"), skill("Generated original restart body."));
    const source: SkillSource = { id: "generated-retained-source", name: "Generated retained skills", kind: "local", path: root, enabled: true };
    await sources(sdk, [source]);
    const original = (await sdk.skills.find("", { sessionId: fixture.sessionId })).skills[0]!;
    sdk.disconnect(); await fixture.service.close();
    await writeFile(join(root, "SKILL.md"), skill("Generated fresh restart body."));
    restarted = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey });
    peer = await new MoguriSdk(restarted.connection).ready();
    assert.deepEqual(peer.settings.get()!.values.skillSources, [source]);
    await assert.rejects(() => peer!.skills.read(original.id, original.digest, fixture.sessionId), /changed/);
    const fresh = (await peer.skills.find("", { sessionId: fixture.sessionId })).skills[0]!;
    assert.notEqual(fresh.digest, original.digest);
    assert.match((await peer.skills.read(fresh.id, fresh.digest, fixture.sessionId)).body, /Generated fresh restart body/);
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); peer?.disconnect(); await restarted?.close(); await fixture.close(); }
});
