import assert from "node:assert/strict";
import test from "node:test";
import { basename, join } from "node:path";
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { authorizeTool, validateSettings } from "../apps/service/src/permissions.ts";
import { defaultSettings, MoguriSdk } from "../packages/sdk/src/index.ts";
import { listProjectFiles, readProjectFile, writeProjectFile } from "../apps/service/src/files.ts";
import { setupFixture, waitFor } from "./fixture.ts";
import { startService } from "../apps/service/src/server.ts";

test("path-prefix denials cover normalized request and rule aliases before native or automatic approval", () => {
  const root = "/generated-project", settings = defaultSettings();
  for (const prefix of ["restricted", "./restricted", "other/../restricted", "restricted//"]) {
    settings.permissions.tools = [{ id: "generated-denial", tool: "*", pathPrefix: prefix, decision: "deny" }];
    validateSettings(settings);
    for (const path of ["restricted/file.txt", "./restricted/file.txt", "other/../restricted/file.txt", "restricted//file.txt", join(root, "restricted/file.txt")]) {
      for (const name of ["read_file", "write_file", "edit_file", "query_data", "sqlite_query", "write_document", "list_files", "search_files"]) {
        for (const autonomy of ["Manual", "Autopilot"] as const) {
          const decision = authorizeTool(settings, { id: "generated-alias", name, arguments: { path } }, root, {
            sessionId: "generated-session", projectId: "generated-project", env: "Local", autonomy, automaticApprovals: autonomy === "Autopilot",
          });

          assert.equal(decision.decision, "deny", `${autonomy} ${name} ${prefix}: ${path}`);
          assert.equal(decision.ruleId, "generated-denial");
        }
      }
    }
    assert.equal(authorizeTool(settings, { id: "generated-public", name: "read_file", arguments: { path: "restricted-sibling/file.txt" } }, root).decision, "allow");
  }
});

test("macOS case and Unicode aliases cannot skip a denial or required review, but case folding never broadens an allow rule", { skip: process.platform !== "darwin" }, () => {
  const settings = defaultSettings(), root = "/generated-project";
  for (const decision of ["deny", "ask"] as const) {
    settings.permissions.tools = [{ id: "generated-case-rule", tool: "read_file", pathPrefix: "./Restricted/caf\u00e9", decision }];
    for (const path of ["Restricted/caf\u00e9/file.txt", "RESTRICTED/CAF\u00c9/file.txt", "restricted/cafe\u0301/file.txt"]) {
      const actual = authorizeTool(settings, { id: "generated-case", name: "read_file", arguments: { path } }, root);
      assert.equal(actual.decision, decision, `${decision}: ${path}`);
      assert.equal(actual.ruleId, "generated-case-rule");
    }
  }
  settings.permissions.defaultDecision = "deny";
  settings.permissions.tools = [{ id: "generated-case-grant", tool: "read_file", pathPrefix: "Reviewed", decision: "allow" }];
  assert.equal(authorizeTool(settings, { id: "generated-exact-case", name: "read_file", arguments: { path: "./Reviewed/file.txt" } }, root).decision, "allow");
  assert.equal(authorizeTool(settings, { id: "generated-foreign-case", name: "read_file", arguments: { path: "reviewed/file.txt" } }, root).decision, "deny");
});

test("root re-entry cannot evade a prefix and outside or aliased absolute roots fail closed", () => {
  const root = "/generated-project", settings = defaultSettings();
  settings.permissions.tools = [{ id: "generated-root-denial", tool: "*", pathPrefix: "restricted", decision: "deny" }];
  for (const path of ["../generated-project/restricted/file.txt", "../GENERATED-PROJECT/restricted/file.txt", "/GENERATED-PROJECT/restricted/file.txt",
    "../generated-outside/file.txt", "/generated-project-other/file.txt"]) {
    assert.equal(authorizeTool(settings, { id: "generated-root-alias", name: "read_file", arguments: { path } }, root).decision, "deny", path);
  }
  assert.equal(authorizeTool(settings, { id: "generated-inside", name: "read_file", arguments: { path: "other/../public.txt" } }, root).decision, "allow");
});

test("native reads, writes and listings reject protected filename case variants without exposing placeholder bytes", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "moguri-generated-protected-case-")));
  const text = "Generated protected placeholder, never a credential.";
  try {
    for (const name of [".git", ".npmrc", ".pypirc", ".netrc", ".git-credentials", ".moguri", "Moguri"]) {
      await writeFile(join(root, name.toUpperCase()), text);
      await assert.rejects(() => readProjectFile(root, name.toUpperCase()), { code: "path_denied" }, name);
      await assert.rejects(() => writeProjectFile(root, name.toUpperCase(), "Generated forbidden replacement.", "absent"), { code: "path_denied" }, name);
      assert.equal(await readFile(join(root, name.toUpperCase()), "utf8"), text);
    }
    await writeFile(join(root, "visible.txt"), "Generated visible file.");
    assert.deepEqual(await listProjectFiles(root), ["visible.txt"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("native file guards reject internal parent symlinks as well as symlink leaves, without changing their real targets", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "moguri-generated-parent-alias-")));
  const text = "Generated denied-directory placeholder.";
  try {
    await mkdir(join(root, "restricted"));
    await writeFile(join(root, "restricted/generated.txt"), text);
    await symlink(join(root, "restricted"), join(root, "public-alias"));
    await symlink(join(root, "restricted/generated.txt"), join(root, "public-leaf.txt"));
    for (const path of ["public-alias/generated.txt", "public-leaf.txt"]) {
      await assert.rejects(() => readProjectFile(root, path), { code: "path_denied" }, path);
      await assert.rejects(() => writeProjectFile(root, path, "Generated forbidden replacement.", "absent"), { code: "path_denied" }, path);
    }
    assert.equal((await readProjectFile(root, "restricted/generated.txt")).text, text);
    assert.equal(await readFile(join(root, "restricted/generated.txt"), "utf8"), text);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("an allowed macOS case alias returns the actual canonical file identity rather than inventing a second source", { skip: process.platform !== "darwin" }, async (t) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "moguri-generated-canonical-case-")));
  try {
    await writeFile(join(root, "Generated.txt"), "Generated canonical source.");
    const canonical = await realpath(join(root, "generated.TXT")).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (!canonical) { t.skip("The generated filesystem is case-sensitive; no case alias exists."); return; }
    assert.equal((await readProjectFile(root, "generated.TXT")).path, "Generated.txt");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("SDK file jobs enforce normalized denials in the actual project and captured Home, including after restart", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  let restarted: Awaited<ReturnType<typeof startService>> | undefined, peer: MoguriSdk | undefined;
  try {
    const home = (await sdk.sessions.create(null, "Generated file-policy Home")).id!;
    const roots = [{ id: fixture.sessionId, root: fixture.project }, { id: home, root: fixture.home }];
    for (const { root } of roots) {
      await mkdir(join(root, "restricted"));
      await writeFile(join(root, "restricted/generated.txt"), "GENERATED_RESTRICTED_BYTES");
      await writeFile(join(root, ".NPMRC"), "GENERATED_PROTECTED_PLACEHOLDER");
      await writeFile(join(root, "public.txt"), "Generated allowed source.");
      await symlink(join(root, "restricted"), join(root, "public-alias"));
    }
    const current = sdk.settings.get()!;
    const permissions = { ...current.values.permissions, tools: [{ id: "generated-sdk-path-denial", tool: "*", pathPrefix: "./restricted//", decision: "deny" as const }] };
    await sdk.settings.update({ ...current.values, permissions }, current.revision);
    const check = async (client: MoguriSdk) => {
      for (const { id, root } of roots) {
        const tools = (await client.tools.catalog(id, "file")).tools;
        const read = tools.find((tool) => tool.name === "read_file"), write = tools.find((tool) => tool.name === "write_file");
        assert.ok(read); assert.ok(write);
        const controller = restarted?.controller ?? fixture.service.controller, before = controller.snapshot().jobs.length;
        for (const path of ["./restricted/generated.txt", "other/../restricted/generated.txt", "restricted//generated.txt", `../${basename(root)}/restricted/generated.txt`, "RESTRICTED/generated.txt"]) {
          await assert.rejects(() => client.tools.execute(id, read.name, { path }, read.schemaDigest), { code: "tool_denied" }, path);
          await assert.rejects(() => client.tools.execute(id, write.name, { path, text: "Generated forbidden replacement.", expectedDigest: "absent" }, write.schemaDigest), { code: "tool_denied" }, path);
        }
        for (const path of [".NPMRC", "public-alias/generated.txt"]) {
          await assert.rejects(() => client.tools.execute(id, read.name, { path }, read.schemaDigest), { code: "path_denied" }, path);
        }
        assert.equal(controller.snapshot().jobs.length, before);
        assert.equal(controller.snapshot().sessions.find((session) => session.id === id)?.pendingApproval, null);
        assert.equal(await readFile(join(root, "restricted/generated.txt"), "utf8"), "GENERATED_RESTRICTED_BYTES");
        const allowed = await client.tools.execute(id, read.name, { path: "other/../public.txt" }, read.schemaDigest);
        assert.equal((await client.jobs.wait(allowed.id!)).status, "completed");
        const result = JSON.parse((await client.mcp.readResult(allowed.id!)).text);
        assert.equal(result.isError, false);
        assert.equal(JSON.parse(result.text).text, "Generated allowed source.");
      }
    };
    await check(sdk);
    sdk.disconnect(); await fixture.service.close();
    restarted = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey,
      platform: { terminal: { defaultRoot: fixture.home, vault: fixture.terminalVault } } });
    peer = await new MoguriSdk(restarted.connection).ready();
    assert.deepEqual(peer.settings.get()!.values.permissions, permissions);
    await check(peer);
    assert.equal(fixture.requests.length, 0);
    assert.equal(JSON.stringify(restarted.controller.events(0)).includes("GENERATED_RESTRICTED_BYTES"), false);
    assert.equal(JSON.stringify(restarted.controller.events(0)).includes("GENERATED_PROTECTED_PLACEHOLDER"), false);
  } finally { peer?.disconnect(); sdk.disconnect(); await restarted?.close(); await fixture.close(); }
});

test("actual Manual/read-only and Autopilot workers cannot place denied, protected or symlinked bytes into subsequent model context", { skip: process.platform !== "darwin" }, async () => {
  for (const scenario of [
    { path: "./restricted/generated.txt", autonomy: "Manual", mode: "read-only", home: false },
    { path: ".NPMRC", autonomy: "Manual", mode: "agent", home: false },
    { path: "other/../restricted/generated.txt", autonomy: "Autopilot", mode: "agent", home: true },
    { path: "public-alias/generated.txt", autonomy: "Autopilot", mode: "read-only", home: false },
  ] as const) {
    const fixture = await setupFixture({ toolCall: { name: "read_file", args: { path: scenario.path } } });
    const sdk = await new MoguriSdk(fixture.service.connection).ready();
    try {
      const id = scenario.home ? (await sdk.sessions.create(null, "Generated worker Home", { modelId: fixture.modelId })).id! : fixture.sessionId;
      const root = scenario.home ? fixture.home : fixture.project;
      await mkdir(join(root, "restricted")); await writeFile(join(root, "restricted/generated.txt"), "GENERATED_FORBIDDEN_MODEL_BYTES");
      await writeFile(join(root, ".NPMRC"), "GENERATED_PROTECTED_MODEL_PLACEHOLDER");
      await symlink(join(root, "restricted"), join(root, "public-alias"));
      const current = sdk.settings.get()!;
      await sdk.settings.update({ ...current.values, permissions: { ...current.values.permissions,
        tools: [{ id: "generated-worker-path-denial", tool: "*", pathPrefix: "restricted", decision: "deny" }] } }, current.revision);
      if (!scenario.home) await fixture.configure();
      const autonomy = await sdk.sessions.autonomy(id, scenario.autonomy, fixture.service.controller.snapshot().sessions.find((session) => session.id === id)!.revision);
      assert.equal(typeof autonomy.revision, "number");
      if (scenario.mode === "read-only") await sdk.sessions.mode(id, "read-only", autonomy.revision!);
      const saved = await sdk.command({ type: "draft.save", sessionId: id, text: "Generated file-policy regression request.", expectedRevision: 0, attachments: [] });
      await sdk.command({ type: "message.send", sessionId: id, expectedRevision: saved.revision!, delivery: "queue" });
      await waitFor(() => {
        const session = fixture.service.controller.snapshot().sessions.find((session) => session.id === id);
        return session && !session.turnId && ["completed", "failed", "partial", "stopped"].includes(session.status);
      });
      assert.equal(fixture.service.controller.events(0).some((event) => event.session_id === id && event.event_type === "tool.started"), false, scenario.path);
      assert.equal(fixture.requests.length, 2, scenario.path);
      assert.equal(JSON.stringify(fixture.requests).includes("GENERATED_FORBIDDEN_MODEL_BYTES"), false);
      assert.equal(JSON.stringify(fixture.requests).includes("GENERATED_PROTECTED_MODEL_PLACEHOLDER"), false);
      assert.equal(await readFile(join(root, "restricted/generated.txt"), "utf8"), "GENERATED_FORBIDDEN_MODEL_BYTES");
    } finally { sdk.disconnect(); await fixture.close(); }
  }
});
