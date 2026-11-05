import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createSshTarget } from "./ssh-target.ts";
import { initializeGeneratedRepository } from "./git-project.ts";

const installed = await realpath(process.argv[2]);
const { createRuntime, connectMoguri } = await import(pathToFileURL(join(installed, "dist/sdk/node.mjs")).href);
const { PROTOCOL_VERSION } = await import(pathToFileURL(join(installed, "dist/sdk/index.mjs")).href);
assert.ok(PROTOCOL_VERSION >= 92);
const directory = await realpath(await mkdtemp(join(tmpdir(), "moguri-installed-candidate-envs-")));
const project = join(directory, "local-project"), peer = join(directory, "peer-project"), home = join(directory, "home"), stateDir = join(directory, "state");
for (const path of [project, peer, home, join(directory, "ssh")]) await mkdir(path);
await writeFile(join(project, "fixture.txt"), "Generated installed Local source stays unchanged.\n");
await writeFile(join(peer, "fixture.txt"), "Generated installed peer original.\n");
const git = initializeGeneratedRepository(peer);
await writeFile(join(peer, "unrelated.txt"), "Generated installed user's staged intent.\n"); git(["add", "--", "unrelated.txt"]);
const index = await readFile(join(peer, ".git/index")), head = git(["rev-parse", "HEAD"]);
const ssh = await createSshTarget(join(directory, "ssh"));
ssh.target.command = [process.execPath, join(installed, "bin/moguri.mjs"), "worker", "--stdio"];
ssh.target.allowCopilot = false;
const provider = { state: { status: "disconnected", models: [], login: null, diagnostic: "Generated model-free candidate fixture." },
  onChange() {}, async refresh() {}, async cancel() {}, async logout() {},
  login() { throw new Error("Personal authentication is forbidden."); }, async prepare() { throw new Error("This candidate fixture cannot spend a model."); } };
const values = new Map(), vault = { read: async (id) => values.get(id) ?? null,
  write: async (id, value) => { values.set(id, value); }, remove: async (id) => { values.delete(id); } };
const options = { stateDir, retentionKey: Buffer.alloc(32, 0x63), provider, platform: { vault,
  terminal: { vault, defaultRoot: home, executable: process.execPath, args: ["-e", "process.stdin.resume()"] },
  remote: { vault, modelsVault: vault }, sandbox: { setup: { automatic: false } } } };
let runtime, sdk;
try {
  runtime = await createRuntime(options); sdk = await connectMoguri({ stateDir, autoStart: false });
  const settings = sdk.settings.get();
  await sdk.settings.update({ ...settings.values, remote: ssh.target }, settings.revision);
  await sdk.remote.probe();
  const added = await sdk.projects.add(project), configuration = (await sdk.projects.configuration(added.id)).configuration;
  await sdk.projects.configure(added.id, { ...configuration.values, remotePath: peer }, configuration.revision);
  const created = await sdk.sessions.create(added.id, "Generated installed peer candidate", { env: "Remote" });
  const workspacePreview = (await sdk.candidates.workspacePreview(created.id, "Generated installed owned peer stage")).preview;
  const workspace = await sdk.candidates.waitWorkspace((await sdk.candidates.createWorkspace(created.id, workspacePreview.name, workspacePreview.digest, true)).id);
  assert.equal(workspace.status, "ready"); assert.equal(workspace.stage.env, "Remote");
  const source = await sdk.candidates.source(created.id, ["fixture.txt"]);
  const patch = { kind: "patch", summary: "Generated installed peer proposal",
    edits: [{ path: "fixture.txt", baseDigest: source.files[0].baseDigest, text: "Generated installed accepted peer replacement.\n" }] };
  const preview = (await sdk.candidates.preview(created.id, workspace.id, patch)).preview;
  const staged = await sdk.candidates.wait((await sdk.candidates.stage(created.id, workspace.id, patch, preview.digest)).id);
  assert.equal(staged.candidate.version, 2); assert.equal(staged.candidate.acceptance, null);
  assert.equal(await readFile(join(peer, "fixture.txt"), "utf8"), "Generated installed peer original.\n");
  const exported = JSON.parse((await sdk.artifacts.export(staged.candidate.id)).export.text);
  assert.equal(exported.schemaVersion, 11);
  assert.ok(exported.documents[0].candidate.events.some((event) => event.event_type === "candidate.transport_recorded"));
  const application = (await sdk.candidates.applyPreview(staged.candidate.id, created.id)).preview;
  await sdk.candidates.apply(staged.candidate.id, created.id, application.revision, application.digest);
  assert.equal((await sdk.candidates.wait(staged.candidate.id)).candidate.acceptance.actor, "user");
  assert.equal(await readFile(join(peer, "fixture.txt"), "utf8"), patch.edits[0].text);
  assert.deepEqual(await readFile(join(peer, ".git/index")), index); assert.equal(git(["rev-parse", "HEAD"]), head);
  assert.equal(await readFile(join(project, "fixture.txt"), "utf8"), "Generated installed Local source stays unchanged.\n");
  sdk.disconnect(); await runtime.close(); runtime = await createRuntime(options); sdk = await connectMoguri({ stateDir, autoStart: false });
  assert.equal((await sdk.candidates.workspace(workspace.id)).workspace.stage.root, workspace.stage.root);
  assert.equal((await sdk.candidates.read(staged.candidate.id)).candidate.acceptance.actor, "user");
  await sdk.sessions.delete(created.id, true);
  assert.equal((await sdk.candidates.workspace(workspace.id)).workspace.status, "ready");
  assert.equal(await readFile(join(workspace.stage.root, "fixture.txt"), "utf8"), patch.edits[0].text);
  assert.equal(await readFile(join(peer, "fixture.txt"), "utf8"), patch.edits[0].text);
  assert.deepEqual(await readFile(join(peer, ".git/index")), index);
  console.log(`Installed protocol${PROTOCOL_VERSION} SDK/runtime/pinned SSH worker: exact v2 resource/source/stage/apply, original index/Local preservation, version11 receipt export, restart and independent-resource retention passed without inference.`);
} finally {
  sdk?.disconnect(); await runtime?.close(); await ssh.close(); await rm(directory, { recursive: true, force: true });
}
