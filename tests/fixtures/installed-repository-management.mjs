import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { cloneRepositoryFixture } from "./clone-repository.ts";

const installed = process.argv[2];
if (!installed) throw new Error("Provide the independently installed Moguri package root.");
const { createRuntime, connectMoguri } = await import(pathToFileURL(join(installed, "dist/sdk/node.mjs")).href);
const { PROTOCOL_VERSION } = await import(pathToFileURL(join(installed, "dist/sdk/index.mjs")).href);
assert.ok(PROTOCOL_VERSION >= 91);
const directory = await realpath(await mkdtemp(join(tmpdir(), "moguri-installed-repositories-"))), stateDir = join(directory, "state"), home = join(directory, "home");
await mkdir(home);
const source = await cloneRepositoryFixture(["/generated-one/project.git", "/generated-two/project.git", "/generated-three/.github-private.git"]);
const provider = { state: { status: "disconnected", models: [], login: null, diagnostic: "Generated model-free repository fixture." },
  onChange() {}, async refresh() {}, async cancel() {}, async logout() {},
  login() { throw new Error("Generated repository fixture forbids personal authentication."); },
  async prepare() { throw new Error("Generated repository fixture forbids inference."); } };
const values = new Map(), vault = { read: async (id) => values.get(id) ?? null, write: async (id, value) => { values.set(id, value); }, remove: async (id) => { values.delete(id); } };
const options = { stateDir, retentionKey: Buffer.alloc(32, 0x69), provider,
  platform: { vault, terminal: { vault, defaultRoot: home }, sandbox: { setup: { automatic: false } } } };
let runtime, sdk;
try {
  runtime = await createRuntime(options); sdk = await connectMoguri({ stateDir, autoStart: false });
  const { preview } = await sdk.projects.imports.preview({ text: source.repositories.map((url) => `- ${url}`).join("\n"), parent: directory });
  const started = await sdk.projects.imports.start(preview, true, "generated-installed-original-import");
  const { batch } = await sdk.projects.imports.wait(started.id);
  assert.equal(batch.status, "completed"); assert.equal(batch.items.length, 3);
  for (const item of batch.items) assert.equal(await readFile(join(item.path, "generated.txt"), "utf8"), "Generated repository clone contents.\n");
  const first = batch.items[0], remote = (await sdk.projects.remotePreview(first.projectId, "origin", "git@github.com:generated-moved/project.git")).preview;
  const changed = await sdk.projects.setRemote(remote, remote.document.confirmations, true), result = await sdk.github.wait(changed.id);
  assert.equal(result.operation.status, "completed"); assert.equal(result.document.remoteChange.fetchUrl, first.repository);
  assert.equal((await sdk.projects.git(first.projectId)).repository, "https://github.com/generated-moved/project");
  await sdk.refresh(); assert.equal(sdk.projects.imports.list()[0].id, batch.id);
  const requests = source.requests();
  sdk.disconnect(); await runtime.close(); runtime = await createRuntime(options); sdk = await connectMoguri({ stateDir, autoStart: false });
  assert.deepEqual((await sdk.projects.imports.read(batch.id)).review, preview.document);
  assert.equal((await sdk.github.read(result.operation.id)).document.remoteChange.fetchUrl, first.repository);
  assert.equal(source.requests(), requests);
  console.log(`Installed protocol${PROTOCOL_VERSION} SDK/runtime: reviewed generated URL-list import, real remote config, retained originals and restart/no replay passed without authentication or inference.`);
} finally { sdk?.disconnect(); await runtime?.close(); await source.close(); await rm(directory, { recursive: true, force: true }); }
