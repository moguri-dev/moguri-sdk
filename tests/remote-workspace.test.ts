import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import { execFileSync } from "node:child_process";
import { MAX_TEXT, MoguriSdk } from "../packages/sdk/src/index.ts";
import { envelope } from "../apps/service/src/controller.ts";
import { waitFor } from "./fixture.ts";
import { initializeGeneratedRepository } from "./fixtures/git-project.ts";
import { remoteFixture } from "./fixtures/remote-service.ts";
import type { WorkspaceReadRequest } from "../apps/service/src/remote-protocol.ts";

const native = { skip: process.platform !== "darwin", timeout: 30_000 };
const fileRequest = (): WorkspaceReadRequest => ({ query: { type: "session.file", path: "fixture.txt" }, policy: { deniedFolders: [], planPath: "docs/plan.md", upstream: "origin" } });

test("remote workspace views use actual SSH files, Git and plan without reading the local checkout or making model calls", native, async (t) => {
  const fixture = await remoteFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const git = initializeGeneratedRepository(fixture.workspace);
    await mkdir(join(fixture.workspace, "docs"));
    await writeFile(join(fixture.workspace, "docs/plan.md"), "Generated remote-only project plan.\n");
    await writeFile(join(fixture.workspace, "fixture.txt"), "Generated remote-only diff.\n");
    git(["remote", "add", "origin", "https://github.com/generated-fixtures/example.git"]);
    await fixture.probe(); await fixture.select();
    const original = fixture.controller.remote.query.bind(fixture.controller.remote), actions: string[] = [];
    t.mock.method(fixture.controller.remote, "query", async (...args: Parameters<typeof original>) => { actions.push(args[1].action); return original(...args); });
    assert.equal((await sdk.workspaces.file(fixture.sessionId, "fixture.txt")).text, "Generated remote-only diff.\n");
    assert.ok((await sdk.workspaces.files(fixture.sessionId)).entries.includes("docs/"));
    const changes = await sdk.workspaces.git(fixture.sessionId);
    assert.equal(changes.branch, "main"); assert.match(changes.diff, /Generated remote-only diff/);
    assert.equal(changes.repository, "https://github.com/generated-fixtures/example");
    assert.equal((await sdk.plans.read(fixture.sessionId)).text, "Generated remote-only project plan.\n");
    assert.deepEqual(actions, ["workspace", "workspace", "workspace", "workspace"]);
    const diff = await sdk.slash(fixture.sessionId, "/diff", "tui");
    assert.equal(diff.kind, "text"); if (diff.kind === "text") assert.match(diff.text, /Generated remote-only diff/);
    const plan = await sdk.slash(fixture.sessionId, "/plan", "tui");
    assert.deepEqual(plan, { kind: "text", text: "Generated remote-only project plan.\n" });
    await assert.rejects(() => sdk.plans.save(fixture.sessionId, "Generated unreviewed direct remote plan write.", "absent"), /binding|not supplied/i);
    assert.equal(await readFile(join(fixture.project, "fixture.txt"), "utf8"), "generated original\n");
    assert.equal(await readFile(join(fixture.workspace, "docs/plan.md"), "utf8"), "Generated remote-only project plan.\n");
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("remote workspace views preserve protected, denied, alias, null-root and unavailable-transport boundaries", native, async () => {
  const fixture = await remoteFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await mkdir(join(fixture.workspace, "denied"));
    await writeFile(join(fixture.workspace, "denied/generated.txt"), "Generated denied fixture.");
    await writeFile(join(fixture.workspace, ".env"), "GENERATED_PLACEHOLDER=not-a-credential");
    await symlink(join(fixture.project, "fixture.txt"), join(fixture.workspace, "alias.txt"));
    const settings = (await sdk.projects.configuration(fixture.session().projectId)).configuration;
    await sdk.projects.configure(settings.projectId, { ...settings.values, deniedFolders: ["denied"] }, settings.revision);
    await fixture.probe(); await fixture.select();
    const entries = (await sdk.workspaces.files(fixture.sessionId)).entries;
    assert.equal(entries.includes("denied/"), false); assert.equal(entries.includes(".env"), false); assert.equal(entries.includes("alias.txt"), false);
    for (const path of [".env", "denied/generated.txt", "../project/fixture.txt", "alias.txt"]) await assert.rejects(() => sdk.workspaces.file(fixture.sessionId, path));
    const { bindingDigest, boundary, ...plan } = await sdk.plans.read(fixture.sessionId), remote = (await sdk.remote.status()).remote;
    assert.deepEqual(plan, { type: "plan.read", path: "docs/plan.md", text: "", digest: "absent", exists: false });
    assert.match(bindingDigest!, /^[a-f0-9]{64}$/);
    assert.deepEqual(boundary, { env: "Remote", root: fixture.workspace, hostFingerprint: remote.hostFingerprint, workerDigest: remote.workerDigest });
    const general = await sdk.sessions.create(null, "Generated remote view without a root", { env: "Remote", modelId: fixture.modelId });
    await assert.rejects(() => sdk.workspaces.files(general.id!), /project|root|workspace/i);
    await fixture.ssh.close();
    await assert.rejects(() => sdk.workspaces.file(fixture.sessionId, "fixture.txt"), /SSH|remote|connection/i);
    assert.equal(fixture.requests.length, 0);
    assert.equal(await readFile(join(fixture.project, "fixture.txt"), "utf8"), "generated original\n");
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("remote read-only Git suppresses configured filters and excludes protected or denied changes", native, async () => {
  const fixture = await remoteFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await mkdir(join(fixture.workspace, "denied"));
    await writeFile(join(fixture.workspace, "denied/generated.txt"), "Generated denied baseline.");
    await writeFile(join(fixture.workspace, ".env"), "GENERATED_PLACEHOLDER=original");
    await writeFile(join(fixture.workspace, ".gitattributes"), "fixture.txt filter=generated\n");
    const git = initializeGeneratedRepository(fixture.workspace, ["fixture.txt", "AGENTS.md", "denied/generated.txt", ".env", ".gitattributes"]);
    const marker = join(fixture.directory, "generated-read-filter-marker");
    git(["config", "filter.generated.clean", `sh -c "printf generated > '${marker}'; cat"`]);
    git(["config", "filter.generated.required", "true"]);
    await writeFile(join(fixture.workspace, "fixture.txt"), "Generated allowed remote change.");
    await writeFile(join(fixture.workspace, "denied/generated.txt"), "Generated excluded remote change.");
    await writeFile(join(fixture.workspace, ".env"), "GENERATED_PLACEHOLDER=changed");
    await writeFile(join(fixture.workspace, "AGENTS.md"), "Generated SSH workspace instructions, never a local repository fallback.");
    const settings = (await sdk.projects.configuration(fixture.session().projectId)).configuration;
    await sdk.projects.configure(settings.projectId, { ...settings.values, deniedFolders: ["denied"] }, settings.revision);
    await fixture.probe(); await fixture.select();
    const index = await readFile(join(fixture.workspace, ".git/index")), result = await sdk.workspaces.git(fixture.sessionId);
    assert.match(result.diff, /Generated allowed remote change/); assert.equal(result.diff.includes("Generated excluded remote change"), false);
    assert.equal(result.status.includes(".env"), false); assert.equal(result.status.includes("denied/"), false);
    await assert.rejects(() => access(marker), { code: "ENOENT" });
    assert.deepEqual(await readFile(join(fixture.workspace, ".git/index")), index);
    const outside = join(fixture.directory, "generated-unapproved-git-tree"); await mkdir(outside);
    await writeFile(join(outside, "fixture.txt"), "Generated outside-tree data.");
    git(["config", "core.worktree", outside]);
    await assert.rejects(() => sdk.workspaces.git(fixture.sessionId), /working tree.*approved workspace/);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("an in-flight remote read cannot be relabeled after its target, workspace or folder policy changes", native, async (t) => {
  for (const change of ["target", "workspace", "policy", "env", "deleted"] as const) {
    const fixture = await remoteFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    try {
      await fixture.probe(); await fixture.select();
      const original = fixture.controller.remote.query.bind(fixture.controller.remote);
      let received = false;
      const mock = t.mock.method(fixture.controller.remote, "query", async (...args: Parameters<typeof original>) => {
        const result = await original(...args);
        if (args[1].action === "workspace") { received = true; await held; }
        return result;
      });
      const rejected = assert.rejects(sdk.workspaces.file(fixture.sessionId, "fixture.txt"), /changed|no longer|unready|removed|missing|not found/i);
      await waitFor(() => received);
      if (change === "target") {
        const settings = structuredClone(fixture.controller.snapshot().settings);
        settings.values.remote!.name = "Generated changed SSH label";
        await fixture.controller.dispatch(envelope({ type: "settings.update", settings: settings.values, expectedRevision: settings.revision, acknowledgePromptRisk: false }));
      } else if (change === "env") await sdk.sessions.env(fixture.sessionId, "Local");
      else if (change === "deleted") await sdk.sessions.delete(fixture.sessionId, true);
      else {
        const settings = (await sdk.projects.configuration(fixture.session().projectId)).configuration;
        await sdk.projects.configure(settings.projectId, { ...settings.values, ...(change === "workspace" ? { remotePath: join(fixture.workspace, "changed-root") } : { deniedFolders: ["fixture.txt"] }) }, settings.revision);
      }
      release(); await rejected; mock.mock.restore();
    } finally { release(); sdk.disconnect(); await fixture.close(); }
  }
});

test("remote file reads enforce exact UTF-8 byte limits and reject binary files and FIFOs without blocking", native, async () => {
  const fixture = await remoteFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await writeFile(join(fixture.workspace, "boundary.txt"), "g".repeat(MAX_TEXT));
    await writeFile(join(fixture.workspace, "oversized.txt"), "g".repeat(MAX_TEXT + 1));
    await writeFile(join(fixture.workspace, "binary.dat"), Buffer.from([0, 255]));
    execFileSync("mkfifo", [join(fixture.workspace, "generated.fifo")]);
    await fixture.probe(); await fixture.select();
    const accepted = await sdk.workspaces.file(fixture.sessionId, "boundary.txt");
    assert.equal(accepted.bytes, MAX_TEXT); assert.equal(Buffer.byteLength(accepted.text), MAX_TEXT);
    const started = performance.now();
    for (const path of ["oversized.txt", "binary.dat", "generated.fifo"]) await assert.rejects(() => sdk.workspaces.file(fixture.sessionId, path), /regular|binary|UTF-8|KiB|limit/i);
    assert.ok(performance.now() - started < 5000, "Unsupported filesystem entries must not consume the 15-second SSH deadline.");
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("remote workspace requests snapshot mutable arguments and reject foreign root, build or operation replies", native, async (t) => {
  const fixture = await remoteFixture();
  try {
    await fixture.probe(); await fixture.select();
    const request = fileRequest(), pending = fixture.controller.remote.readWorkspace(fixture.workspace, request, AbortSignal.timeout(5000));
    if (request.query.type === "session.file") request.query.path = ".env";
    request.policy.deniedFolders.push("fixture.txt");
    const result = await pending;
    assert.equal(result.type, "session.file"); if (result.type === "session.file") assert.equal(result.text, "generated actual remote source\n");
    const original = fixture.controller.remote.query.bind(fixture.controller.remote);
    for (const change of ["root", "build", "operation"] as const) {
      const mock = t.mock.method(fixture.controller.remote, "query", async (...args: Parameters<typeof original>) => {
        const reply = await original(...args);
        if (reply.kind !== "workspace") return reply;
        if (change === "operation") return { ...reply, result: { type: "plan.read" as const, path: "docs/plan.md", text: "", digest: "absent", exists: false } };
        return { ...reply, info: { ...reply.info, ...(change === "root" ? { root: join(fixture.workspace, "foreign-root") } : { workerDigest: "0".repeat(64) }) } };
      });
      await assert.rejects(() => fixture.controller.remote.readWorkspace(fixture.workspace, fileRequest(), AbortSignal.timeout(5000)), /did not match/);
      mock.mock.restore();
    }
  } finally { await fixture.close(); }
});

test("abort and runtime shutdown cancel actual in-flight SSH reads without waiting for the delayed worker or replaying work", native, async () => {
  const fixture = await remoteFixture();
  try {
    const wrapper = join(fixture.directory, "generated-delayed-bridge.mjs");
    await writeFile(wrapper, `import {setTimeout} from "node:timers/promises";\nawait setTimeout(2000);\nawait import(${JSON.stringify(pathToFileURL(resolve("apps/service/src/remote-bridge.ts")).href)});\n`);
    const settings = structuredClone(fixture.controller.snapshot().settings);
    settings.values.remote!.command = [...settings.values.remote!.command.slice(0, -1), wrapper];
    await fixture.controller.dispatch(envelope({ type: "settings.update", settings: settings.values, expectedRevision: settings.revision, acknowledgePromptRisk: false }));
    await fixture.probe(); await fixture.select();
    const abort = new AbortController(), started = performance.now();
    const pending = fixture.controller.remote.readWorkspace(fixture.workspace, fileRequest(), abort.signal);
    const cancelled = assert.rejects(pending, /SSH|abort|cancel|connection/i);
    await new Promise((resolve) => setTimeout(resolve, 80)); abort.abort(); await cancelled;
    assert.ok(performance.now() - started < 1500, "Cancelled SSH reads must not wait for the delayed worker.");
    const closing = assert.rejects(fixture.controller.remote.readWorkspace(fixture.workspace, fileRequest(), AbortSignal.timeout(5000)), /SSH|abort|cancel|connection|closing/i);
    await fixture.controller.remote.close(); await closing;
    assert.equal(fixture.controller.remote.readiness.ready, false); assert.equal(fixture.requests.length, 0);
  } finally { await fixture.close(); }
});
