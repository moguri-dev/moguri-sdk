import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MoguriSdk, type SkillSource, type Snapshot } from "../packages/sdk/src/index.ts";
import { createGlobalSkillFolder, globalSkillSources } from "../packages/sdk/src/node.ts";
import { listSlashCommands } from "../packages/sdk/src/slash-catalog.ts";
import { admitGeneratedSkill, setupFixture } from "./fixture.ts";
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

test("both global skill folder presets remain unread and disabled until explicitly saved as sources", async () => {
  const f = await setupFixture(), sdk = await new MoguriSdk(f.service.connection).ready();
  try {
    const presets = globalSkillSources(f.directory);
    for (const [index, source] of presets.entries()) {
      assert.equal(source.enabled, false);
      await mkdir(join(source.path, "generated", "nested"), { recursive: true });
      await writeFile(join(source.path, "generated", "nested", "SKILL.md"), skill(`Generated global folder ${index}.`));
    }
    assert.deepEqual((await sdk.skills.find()).skills, []);
    await sources(sdk, [{ ...presets[0]!, enabled: true }]);
    assert.equal((await sdk.skills.find()).skills.length, 1);
    await sources(sdk, presets.map((source) => ({ ...source, enabled: true })));
    const found = await sdk.skills.find();
    assert.equal(found.skills.length, 2);
    const selected = found.skills.find((entry) => entry.sourceId === presets[1]!.id)!;
    assert.match((await sdk.skills.read(selected.id, selected.digest)).body, /Generated global folder 1/);
    assert.equal(f.service.controller.snapshot().skillAdmissions.length, 0);
    assert.equal(f.service.controller.snapshot().registry.length, 0);
    assert.equal(f.requests.length, 0);
  } finally { sdk.disconnect(); await f.close(); }
});

test("a missing enabled folder offers no skills without hiding other sources, and confirmation creates only exact presets", async () => {
  const f = await setupFixture(), sdk = await new MoguriSdk(f.service.connection).ready();
  try {
    const [agents, moguri] = globalSkillSources(f.directory);
    await mkdir(join(agents!.path, "generated"), { recursive: true });
    await writeFile(join(agents!.path, "generated", "SKILL.md"), skill("Generated agents folder."));
    await sources(sdk, [{ ...agents!, enabled: true }, { ...moguri!, enabled: true }]);
    assert.deepEqual((await sdk.skills.find()).skills.map((entry) => entry.sourceId), [agents!.id]);
    await assert.rejects(() => createGlobalSkillFolder("generated-other", f.directory), /Unknown global skill folder/);
    assert.equal((await createGlobalSkillFolder(moguri!.id, f.directory)).path, moguri!.path);
    await createGlobalSkillFolder(moguri!.id, f.directory);
    await writeFile(join(moguri!.path, "SKILL.md"), skill("Generated Moguri folder."));
    assert.deepEqual(new Set((await sdk.skills.find()).skills.map((entry) => entry.sourceId)), new Set([agents!.id, moguri!.id]));
  } finally { sdk.disconnect(); await f.close(); }
});

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

test("local skill links resolve like other harnesses, skip cycles, broken and secret targets, and stay bound through admission", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const real = join(fixture.directory, "generated-real-skills"), shared = join(fixture.directory, "generated-shared"), linked = join(shared, "generated-linked");
    await mkdir(join(linked, "references"), { recursive: true }); await mkdir(join(real, "file-skill"), { recursive: true }); await mkdir(join(fixture.directory, ".ssh", "secret"), { recursive: true });
    await writeFile(join(linked, "SKILL.md"), skill("Generated linked folder skill."));
    await writeFile(join(linked, "references", "guide.md"), "Generated reference.\n");
    await writeFile(join(shared, "notes.md"), "Generated linked note.\n"); await symlink(join(shared, "notes.md"), join(linked, "notes.md"));
    await writeFile(join(shared, "standalone.md"), skill("Generated linked file skill.")); await symlink(join(shared, "standalone.md"), join(real, "file-skill", "SKILL.md"));
    await writeFile(join(fixture.directory, ".ssh", "secret", "SKILL.md"), skill("Generated secret-location skill."));
    await symlink(linked, join(real, "generated-linked")); await symlink(real, join(real, "loop"));
    await symlink(join(fixture.directory, "generated-missing"), join(real, "broken")); await symlink(join(fixture.directory, ".ssh", "secret"), join(real, "secret"));
    const alias = join(fixture.directory, "generated-skills-alias"); await symlink(real, alias);
    await sources(sdk, [{ id: "generated-local", name: "Generated linked folder", kind: "local", enabled: true, path: alias }]);
    const found = await sdk.skills.find("", { sessionId: fixture.sessionId });
    assert.deepEqual(found.skills.map((entry) => entry.path).sort(), ["file-skill/SKILL.md", "generated-linked/SKILL.md"]);
    const selected = found.skills.find((entry) => entry.path === "generated-linked/SKILL.md")!;
    assert.match((await sdk.skills.read(selected.id, selected.digest)).body, /Generated linked folder skill/);
    const { inspection } = await admitGeneratedSkill(sdk, fixture.sessionId, selected.id, selected.digest);
    assert.deepEqual(inspection.origin.files.map((file) => file.path).sort(), ["generated-linked/SKILL.md", "generated-linked/notes.md", "generated-linked/references/guide.md"].sort());
    await sdk.skills.use(fixture.sessionId, selected.id, selected.digest, fixture.session().draft.revision);
    await sdk.skills.use(fixture.sessionId, selected.id, selected.digest, fixture.session().draft.revision);
    await writeFile(join(linked, "references", "guide.md"), "Generated changed reference.\n");
    await sdk.skills.use(fixture.sessionId, selected.id, selected.digest, fixture.session().draft.revision);
    assert.match(fixture.service.store.blob(fixture.session().draft.attachments.find((attachment) => attachment.kind === "skill")!.digest), /Generated changed reference/);
    assert.equal(fixture.session().draft.attachments.filter((attachment) => attachment.kind === "skill").length, 1);
    assert.equal((await sdk.skills.audit(fixture.sessionId)).admissions.at(-1)?.basis, "trusted-source");
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("one invalid SKILL.md in a Local folder is skipped while the rest of the catalog loads", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const root = join(fixture.directory, "generated-mixed-skills");
    await mkdir(join(root, "valid"), { recursive: true }); await mkdir(join(root, "broken-yaml")); await mkdir(join(root, "harness"));
    await writeFile(join(root, "valid", "SKILL.md"), skill("Generated valid skill."));
    await writeFile(join(root, "broken-yaml", "SKILL.md"), "---\nname: generated-broken\nname: duplicate\ndescription: Generated duplicate key\n---\nGenerated body.\n");
    await writeFile(join(root, "harness", "SKILL.md"), "---\nname: generated-harness\nuser-invocable: true\ndisable-model-invocation: false\ndescription: >-\n  Generated harness metadata skill.\n---\nGenerated body.\n");
    await sources(sdk, [{ id: "generated-local", name: "Generated mixed folder", kind: "local", enabled: true, path: root }]);
    assert.deepEqual((await sdk.skills.find()).skills.map((entry) => entry.path).sort(), ["harness/SKILL.md", "valid/SKILL.md"]);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("catalog pages continue from their first page's snapshot, and an unknown continuation restarts instead of failing", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const root = join(fixture.directory, "generated-paged-skills");
    for (let index = 0; index < 12; index++) {
      await mkdir(join(root, `skill-${String(index).padStart(2, "0")}`), { recursive: true });
      await writeFile(join(root, `skill-${String(index).padStart(2, "0")}`, "SKILL.md"), skill(`Generated paged skill ${index}.`));
    }
    await sources(sdk, [{ id: "generated-local", name: "Generated paged folder", kind: "local", enabled: true, path: root }]);
    const first = await sdk.skills.find("", { sessionId: fixture.sessionId });
    assert.deepEqual([first.skills.length, first.total, first.nextOffset, first.restarted], [8, 12, 8, undefined]);
    await writeFile(join(root, "skill-11", "SKILL.md"), skill("Generated edited skill between pages."));
    const second = await sdk.skills.find("", { sessionId: fixture.sessionId, offset: 8, expectedCatalogDigest: first.catalogDigest });
    assert.deepEqual([second.skills.length, second.nextOffset, second.catalogDigest, second.restarted], [4, null, first.catalogDigest, undefined]);
    const fresh = await sdk.skills.find("", { sessionId: fixture.sessionId });
    assert.notEqual(fresh.catalogDigest, first.catalogDigest);
    const stale = [...first.skills, ...second.skills].find((entry) => entry.path === "skill-11/SKILL.md")!;
    await assert.rejects(() => sdk.skills.read(stale.id, stale.digest, fixture.sessionId), /changed since discovery/);
    const restarted = await sdk.skills.find("", { sessionId: fixture.sessionId, offset: 8, expectedCatalogDigest: "a".repeat(64) });
    assert.deepEqual([restarted.restarted, restarted.skills.length, restarted.nextOffset, restarted.catalogDigest], [true, 8, 8, fresh.catalogDigest]);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("the slash catalog resets on a restarted page and gives up after repeated changes", async () => {
  const page = (names: string[], extra: Record<string, unknown> = {}) => ({ skills: names.map((name) => ({ id: name, name, description: name, digest: "a".repeat(64), bytes: 1, sourceId: null, sourceName: "Generated", path: null })),
    total: 2, nextOffset: null as number | null, catalogDigest: "b".repeat(64), ...extra });
  let calls = 0;
  const flaky = { skills: { find: async () => ++calls === 1 ? { ...page(["generated-old"]), nextOffset: 1 } : page(["generated-a", "generated-b"], { restarted: true }) } };
  const listed = await listSlashCommands(flaky as never, "generated-session");
  assert.deepEqual(listed.filter((entry) => entry.kind === "skill").map((entry) => entry.name), ["generated-a", "generated-b"]);
  const unstable = { skills: { find: async () => ({ ...page(["generated-x"], { restarted: true }), nextOffset: 1 }) } };
  await assert.rejects(() => listSlashCommands(unstable as never, "generated-session"), /kept changing/);
});

test("exact remote source configuration validates before any network lookup", async () => {
  let calls = 0;
  const fixture = await setupFixture({ platform: { skillGateway: { fetch: async () => { calls++; throw new Error("Generated unexpected fetch."); } } } }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
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

test("outward MCP loads skills from an enabled folder, honors revocation and never self-approves", async () => {
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
    const args = { skillId: data.skills[0].id, expectedDigest: data.skills[0].digest };
    const loaded = await caller.callTool({ name: "moguri_read_skill", arguments: args });
    const admitted = (await sdk.skills.audit(fixture.sessionId)).admissions[0]!;
    assert.equal(admitted.basis, "trusted-source");
    assert.match(JSON.stringify(loaded), /Generated outward gateway body/);
    assert.match(JSON.stringify(loaded), /never a permission/);
    assert.equal(fixture.service.controller.platform.skillAdmissions.consumptions(fixture.sessionId)[0]?.actor, "model");
    await sdk.skills.revoke(fixture.sessionId, admitted.id, 0, "Generated outward-source revocation.");
    assert.equal((await caller.callTool({ name: "moguri_read_skill", arguments: args })).isError, true);
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
    const continued = await sdk.skills.find("", { sessionId: fixture.sessionId, offset: 8, expectedCatalogDigest: first.catalogDigest });
    assert.deepEqual([continued.catalogDigest, continued.restarted], [first.catalogDigest, undefined]);
    const changed = [...first.skills, ...last.skills].find((entry) => entry.path === "0/SKILL.md")!;
    await assert.rejects(() => sdk.skills.read(changed.id, changed.digest, fixture.sessionId), /changed since discovery/);
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

test("a cancelled query ID prevents late admission before any source bytes are read", async () => {
  let downloads = 0;
  const fixture = await setupFixture({ platform: { skillGateway: { fetch: async () => { downloads++; throw new Error("A cancelled read cannot start."); } } } }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await sources(sdk, [remote]);
    const requestId = crypto.randomUUID(), headers = { Authorization: `Bearer ${fixture.service.connection.token}`, "Content-Type": "application/json", "X-Moguri-Profile": sdk.profileId };
    const cancelled = await fetch(`${fixture.service.connection.baseUrl}/v1/query-cancel`, { method: "POST", headers, body: JSON.stringify({ requestId }) });
    assert.equal(cancelled.status, 200);
    const late = await fetch(`${fixture.service.connection.baseUrl}/v1/query`, { method: "POST", headers: { ...headers, "X-Moguri-Query-Id": requestId },
      body: JSON.stringify({ type: "skills.find", query: "", offset: 0, sessionId: fixture.sessionId }) });
    assert.equal(late.status, 409); assert.equal((await late.json()).error.code, "query_cancelled"); assert.equal(downloads, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("an explicit read cancellation binds its exact profile even when another profile uses the same request ID", async () => {
  let stopped = false;
  const started = Promise.withResolvers<void>();
  const fixture = await setupFixture({ platform: { skillGateway: { fetch: async (_url, options) => new Promise<Response>((_resolve, reject) => {
    started.resolve(); options!.signal!.addEventListener("abort", () => { stopped = true; reject(options!.signal!.reason); }, { once: true });
  }) } } }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const other = await sdk.profiles.create("Generated cancellation isolation"); await sdk.profiles.wait(other.id!);
    await sources(sdk, [remote]);
    const requestId = crypto.randomUUID(), headers = { Authorization: `Bearer ${fixture.service.connection.token}`, "Content-Type": "application/json", "X-Moguri-Profile": sdk.profileId };
    const pending = fetch(`${fixture.service.connection.baseUrl}/v1/query`, { method: "POST", headers: { ...headers, "X-Moguri-Query-Id": requestId },
      body: JSON.stringify({ type: "skills.find", query: "", offset: 0, sessionId: fixture.sessionId }) });
    await started.promise;
    const wrong = await fetch(`${fixture.service.connection.baseUrl}/v1/query-cancel`, { method: "POST", headers: { ...headers, "X-Moguri-Profile": other.id! }, body: JSON.stringify({ requestId }) });
    assert.equal(wrong.status, 200); assert.equal(stopped, false);
    const own = await fetch(`${fixture.service.connection.baseUrl}/v1/query-cancel`, { method: "POST", headers, body: JSON.stringify({ requestId }) });
    assert.equal(own.status, 200); assert.equal(stopped, true);
    assert.equal((await pending).status, 409); assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("built-in commands take precedence over same-named skills, which are flagged for renaming at import, discovery and dispatch", async () => {
  const f = await setupFixture(), sdk = await new MoguriSdk(f.service.connection).ready();
  try {
    const [agents] = globalSkillSources(f.directory);
    for (const name of ["review", "exit", "generated-unique"]) {
      await mkdir(join(agents!.path, name), { recursive: true });
      await writeFile(join(agents!.path, name, "SKILL.md"), `---\nname: ${name}\ndescription: Generated ${name} instructions\n---\nGenerated body.\n`);
    }
    await sources(sdk, [{ ...agents!, enabled: true }]);
    const found = await sdk.skills.find();
    assert.equal(found.skills.find((entry) => entry.name === "review")?.shadowedBy, "review");
    assert.equal(found.skills.find((entry) => entry.name === "exit")?.shadowedBy, "exit", "TUI-local commands shadow skills too");
    assert.equal(found.skills.find((entry) => entry.name === "generated-unique")?.shadowedBy, undefined);
    const catalog = await listSlashCommands(sdk, f.sessionId);
    assert.deepEqual(catalog.filter((entry) => entry.name === "review").map((entry) => entry.kind), ["builtin", "shadowed"]);
    const shadowed = catalog.find((entry) => entry.kind === "shadowed" && entry.name === "review");
    assert.match(shadowed!.description, /built-in \/review command.*Rename the skill/);
    assert.ok(catalog.some((entry) => entry.kind === "skill" && entry.name === "generated-unique"));
    assert.ok(!catalog.some((entry) => entry.kind === "skill" && ["review", "exit"].includes(entry.name)));
    await assert.rejects(() => sdk.slash(f.sessionId, "/exit generated prompt"), /same name as the built-in \/exit command/);
    const help = await sdk.slash(f.sessionId, "/help");
    assert.equal(help.kind, "text"); assert.match(help.kind === "text" ? help.text : "", /Skills to rename[\s\S]*(review|exit)[\s\S]*(review|exit)/);
    const imported = join(f.directory, "imported", "SKILL.md");
    await mkdir(join(f.directory, "imported"), { recursive: true });
    await writeFile(imported, "---\nname: details\ndescription: Generated TUI-local clash\n---\nGenerated body.\n");
    const result = await sdk.capabilities.importSkill(f.session().projectId, imported);
    assert.match(result.notice ?? "", /built-in \/details command/);
    assert.equal(f.requests.length, 0, "precedence checks never start a model request");
  } finally { sdk.disconnect(); await f.close(); }
});
