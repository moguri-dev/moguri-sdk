import assert from "node:assert/strict";
import { homedir } from "node:os";
import { test } from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { loadBuffer } from "cheerio";
import { compareSessionOrder, MoguriError, MoguriSdk, parseAttachmentTrigger, projectIdentifier, PROTOCOL_VERSION } from "../packages/sdk/src/index.ts";
import { EventStore } from "../apps/service/src/store.ts";
import { startService } from "../apps/service/src/server.ts";
import { setupFixture } from "./fixture.ts";
import { retainedCiphertextRows, writeLegacyState } from "./fixtures/legacy-state.ts";

test("attachment shortcuts distinguish sessions, local paths, projects and qualified GitHub references", () => {
  assert.deepEqual(parseAttachmentTrigger("Attach :remove-component"), { prefix: ":", query: "remove-component", start: 7 });
  assert.deepEqual(parseAttachmentTrigger("^/generated/folder/"), { prefix: "^", query: "/generated/folder/", start: 0 });
  assert.deepEqual(parseAttachmentTrigger("@studio-duo/docs/README.md"), { prefix: "@", query: "studio-duo/docs/README.md", start: 0 });
  assert.deepEqual(parseAttachmentTrigger("generated/example#137"), { prefix: "#", query: "generated/example#137", start: 0 });
  assert.equal(parseAttachmentTrigger("https://example.test/path"), null);
  assert.equal(projectIdentifier("Generated project !", ["Generated-project"]), "Generated-project-2");
});
test("maintained encoding detection and native fetch preserve HTML, response and cancellation behavior", async () => {
  const html = Buffer.from('<meta charset="windows-1252"><title>Generated caf\xe9</title>', "latin1");
  assert.equal(loadBuffer(html)("title").text(), "Generated caf\u00e9");
  const require = createRequire(import.meta.url);
  const nativeFetch = createRequire(require.resolve("gaxios"))("node-fetch");
  const response = await nativeFetch("data:application/json,%7B%22generated%22%3Atrue%7D");
  assert.ok(response instanceof Response);
  assert.deepEqual(await response.json(), { generated: true });
  await assert.rejects(nativeFetch("data:text/plain,generated", { signal: AbortSignal.abort(new DOMException("Generated cancellation", "AbortError")) }), { name: "AbortError" });
});

test("session ordering is atomic, optimistic, sibling-scoped and shared with every SDK client", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const second = (await sdk.sessions.create(fixture.session().projectId, "Generated second")).id!;
    const third = (await sdk.sessions.create(fixture.session().projectId, "Generated third")).id!;
    const stale = sdk.getState().snapshot!.sessions.map((session) => ({ sessionId: session.id, revision: session.revision }));
    await sdk.sessions.reorder([third, fixture.sessionId, second]);
    assert.deepEqual(sdk.getState().snapshot!.sessions.slice().sort(compareSessionOrder).map((session) => session.id), [third, fixture.sessionId, second]);
    await assert.rejects(() => sdk.command({ type: "session.reorder", sessions: stale }), /Another client/);
    await assert.rejects(async () => fixture.service.controller.dispatch({ id: randomUUID(), profileId: sdk.profileId, command: {
      type: "session.organize", sessionId: second, expectedRevision: sdk.getState().snapshot!.sessions.find((session) => session.id === second)!.revision, changes: { order: -1 },
    } }), { code: "invalid_request" });
    await sdk.sessions.organize(second, { order: 10 });
    assert.equal(sdk.getState().snapshot!.sessions.find((session) => session.id === second)!.order, 10);
    await assert.rejects(() => sdk.sessions.reorder([third, second]), /complete current sibling/);
    const unrelated = (await sdk.sessions.create(null)).id!;
    await assert.rejects(() => sdk.sessions.reorder([third, fixture.sessionId, second, unrelated]), /sibling/);
    await sdk.sessions.organize(second, { pinned: true });
    await assert.rejects(() => sdk.sessions.reorder([third, fixture.sessionId, second]), /sibling/);
    await sdk.sessions.reorder([fixture.sessionId, third]);
    assert.deepEqual(sdk.getState().snapshot!.sessions.filter((session) => session.projectId !== null).sort(compareSessionOrder).map((session) => session.id), [second, fixture.sessionId, third]);
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("project names are unique safe identifiers and project shortcuts keep exact local source policy", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const first = join(fixture.directory, "Generated project !"), second = join(fixture.directory, "Generated project ?");
    await mkdir(first); await mkdir(second);
    const a = (await sdk.projects.add(first)).id!, b = (await sdk.projects.add(second)).id!;
    assert.equal(sdk.getState().snapshot!.projects.find((project) => project.id === a)?.name, "Generated-project");
    assert.equal(sdk.getState().snapshot!.projects.find((project) => project.id === b)?.name, "Generated-project-2");
    await assert.rejects(() => sdk.projects.add(second, "not/allowed"), /Invalid|schema|pattern/);
    const selected = await sdk.attachments.projectPath(fixture.sessionId, fixture.session().projectId!, "fixture.txt");
    assert.equal(selected.path, await realpath(join(fixture.project, "fixture.txt"))); assert.equal(selected.kind, "file");
    const configuration = (await sdk.projects.configuration(fixture.session().projectId!)).configuration;
    await sdk.projects.configure(configuration.projectId, { ...configuration.values, deniedFolders: ["fixture.txt"] }, configuration.revision);
    await assert.rejects(() => sdk.attachments.projectPath(fixture.sessionId, configuration.projectId, "fixture.txt"), /denied/);
    await assert.rejects(() => sdk.attachments.projectPath(fixture.sessionId, configuration.projectId, "../outside"), /inside|relative|denied/);
    await assert.rejects(() => sdk.attachments.projectPath(fixture.sessionId, "outside-profile", "fixture.txt"), /profile|missing/);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("GitHub shortcuts resolve the current repository, detect PRs and verify immutable remote file bytes", async () => {
  let text = "Generated remote file.\n";
  const fixture = await setupFixture({ platform: { integrations: { fetch: async (url) => {
    const endpoint = String(url);
    if (endpoint.includes("/contents/")) {
      const data = Buffer.from(text);
      return Response.json({ type: "file", path: "README.md", encoding: "base64", size: data.length, content: data.toString("base64"),
        sha: createHash("sha1").update(`blob ${data.length}\0`).update(data).digest("hex"), html_url: "https://github.com/generated/example/blob/main/README.md" });
    }
    return Response.json({ number: 7, html_url: "https://github.com/generated/example/pull/7", title: "Generated reference", body: "Generated PR.", state: "open", updated_at: "2026-01-01T00:00:00Z", ...(endpoint.includes("/issues/") ? { pull_request: {} } : {}) });
  } } } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    execFileSync("git", ["-C", fixture.project, "init", "--quiet"]);
    execFileSync("git", ["-C", fixture.project, "remote", "add", "origin", "https://github.com/generated/example.git"]);
    assert.equal((await sdk.attachments.githubPreview(fixture.sessionId, "#7")).preview.kind, "github_pr");
    const source = "@generated/example/README.md", preview = (await sdk.attachments.githubPreview(fixture.sessionId, source)).preview;
    assert.equal(preview.kind, "github_file"); assert.equal(preview.text, text);
    text = "Generated changed remote file.\n";
    await assert.rejects(() => sdk.attachments.github(fixture.sessionId, source, "public", preview.digest, true), /changed after preview/);
    const fresh = (await sdk.attachments.githubPreview(fixture.sessionId, source)).preview;
    const attachment = await sdk.attachments.github(fixture.sessionId, source, "public", fresh.digest, true);
    assert.deepEqual((await sdk.attachments.read(fixture.sessionId, attachment.id!)).content, { kind: "text", text });
    const chat = (await sdk.sessions.create(null)).id!;
    await assert.rejects(() => sdk.attachments.githubPreview(chat, "#7"), /OWNER\/REPO/);
    assert.equal((await sdk.attachments.githubPreview(chat, "generated/example#7")).preview.kind, "github_pr");
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("automatic GitHub attachment access discloses public fallback without borrowing another identity", async () => {
  let cliAvailable = false;
  const reference = { number: 2, html_url: "https://github.com/generated/example/issues/2", title: "Generated public issue", body: "", updated_at: "2026-01-01T00:00:00Z" };
  const fixture = await setupFixture({ platform: { integrations: {
    githubCliRead: async () => { if (cliAvailable) return reference; throw new MoguriError("github_cli_unavailable", "Generated unavailable account.", 403); },
    fetch: async () => Response.json(reference),
  } } }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const preview = (await sdk.attachments.githubPreview(fixture.sessionId, "generated/example#2", "auto")).preview;
    assert.equal(preview.source.kind, "github-public");
    assert.match(preview.excluded[0]!.reason, /public GitHub API/);
    cliAvailable = true;
    await assert.rejects(() => sdk.attachments.github(fixture.sessionId, "generated/example#2", "auto", preview.digest, true), /changed after preview/);
    assert.equal(fixture.session().draft.attachments.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("global consoles are profile-owned Local HOME terminals, independent of project/session deletion and restart", { skip: process.platform !== "darwin" }, async () => {
  const program = { executable: process.execPath, args: ["-e", "process.stdout.write('GENERATED_GLOBAL_READY\\n'); process.stdin.resume();"], brokerPath: resolve("dist/terminal-broker.mjs") };
  const fixture = await setupFixture({ platform: { terminal: program } }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  let restarted: Awaited<ReturnType<typeof startService>> | undefined, peer: MoguriSdk | undefined;
  try {
    const opened = await sdk.terminal.openGlobal(), terminal = sdk.getState().snapshot!.terminals.find((terminal) => terminal.id === opened.id)!;
    assert.equal(terminal.sessionId, null); assert.equal(terminal.projectId, null);
    assert.equal(terminal.binding?.root, await realpath(homedir()));
    const settings = sdk.settings.get()!;
    await sdk.settings.update({ ...settings.values, interactions: { confirmSessionAttachments: false, confirmTerminalClose: false } }, settings.revision);
    await sdk.sessions.delete(fixture.sessionId, true);
    assert.equal(sdk.getState().snapshot!.terminals[0]?.id, terminal.id);
    await fixture.service.close({ preserveTerminals: true });
    restarted = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey, platform: { terminal: { ...program, vault: fixture.terminalVault } } });
    peer = await new MoguriSdk(restarted.connection).ready();
    assert.equal(peer.getState().snapshot!.terminals[0]?.pid, terminal.pid);
    assert.equal(peer.settings.get()!.values.interactions.confirmTerminalClose, false);
    await peer.command({ type: "policy.set", allowedEnvs: ["Sandbox", "Remote"] });
    await assert.rejects(() => peer!.terminal.input(terminal.id, "GENERATED_NEVER_SUBMIT"), /policy|Local/);
    await peer.terminal.close(terminal.id);
  } finally { sdk.disconnect(); peer?.disconnect(); await restarted?.close(); await fixture.close(); }
});

test("schema-43 upgrade is additive, rolls back failed markers and preserves ciphertext and attachment grants", async () => {
  const fixture = await setupFixture(); let reopened: EventStore | undefined;
  try {
    const sdk = await new MoguriSdk(fixture.service.connection).ready(), path = join(fixture.directory, "generated.txt");
    try { await writeFile(path, "Generated retained context."); await sdk.attachments.file(fixture.sessionId, path); } finally { sdk.disconnect(); }
    const before = retainedCiphertextRows(fixture.service.store.db), pathToStore = fixture.service.store.path;
    await writeLegacyState(fixture.service, 43);
    const raw = new DatabaseSync(pathToStore);
    try { raw.exec("CREATE TRIGGER generated_interaction_marker BEFORE INSERT ON retention_metadata WHEN NEW.id='desktop_interaction_schema' BEGIN SELECT RAISE(ABORT,'Generated interaction marker failure'); END;"); } finally { raw.close(); }
    assert.throws(() => new EventStore(pathToStore, fixture.retentionKey), /interaction marker failure/);
    const failed = new DatabaseSync(pathToStore);
    try { assert.equal(failed.prepare("PRAGMA user_version").get()?.user_version, 43); assert.deepEqual(retainedCiphertextRows(failed), before); failed.exec("DROP TRIGGER generated_interaction_marker"); } finally { failed.close(); }
    reopened = new EventStore(pathToStore, fixture.retentionKey);
    assert.equal(reopened.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
    assert.deepEqual(retainedCiphertextRows(reopened.db), before);
  } finally { reopened?.close(); await fixture.close(); }
});
