import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { startService } from "../apps/service/src/server.ts";
import { fixtureProvider, GENERATED_RETENTION_KEY, waitFor } from "./fixture.ts";
import { launchRuntimeChild } from "./fixtures/runtime-process.ts";
import { cloneRepositoryFixture } from "./fixtures/clone-repository.ts";

test("actual service SIGKILL preserves original batch uncertainty even when its destination is absent, without clone or receipt replay", { skip: process.platform !== "darwin", timeout: 30_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "moguri-generated-import-recovery-")), stateDir = join(directory, "state"), home = join(directory, "home");
  await mkdir(home);
  const provider = await fixtureProvider(), source = await cloneRepositoryFixture();
  const runtime = await launchRuntimeChild({ stateDir, homeRoot: home, vaultPath: join(directory, "generated-vault.json"),
    modelId: provider.modelId, baseUrl: provider.baseUrl, holdRepositoryImport: true });
  let sdk: MoguriSdk | undefined = await new MoguriSdk(runtime.connection).ready(), restarted: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    const { preview } = await sdk.projects.imports.preview({ text: source.repository, parent: directory }), commandId = "generated-original-crashed-import";
    const pending = sdk.projects.imports.start(preview, true, commandId).catch(() => undefined);
    const id = await waitFor(() => runtime.heldRepositoryImportId);
    runtime.child.kill("SIGKILL"); await runtime.exited; await pending; sdk.disconnect(); sdk = undefined;
    restarted = await startService({ stateDir, provider: provider.provider, retentionKey: GENERATED_RETENTION_KEY, platform: { terminal: { defaultRoot: home } } });
    sdk = await new MoguriSdk(restarted.connection).ready();
    const { batch, review } = await sdk.projects.imports.read(id), path = batch.items[0]!.path;
    assert.equal(batch.status, "partial"); assert.equal(batch.items[0]!.status, "partial");
    assert.equal(existsSync(path), false); assert.deepEqual(review, preview.document); assert.equal(source.requests(), 0);
    assert.ok(restarted.controller.ownedLocalRoots().includes(path));
    restarted.store.db.prepare("DELETE FROM receipts WHERE profile_id='default' AND id=?").run(commandId);
    assert.equal((await sdk.projects.imports.start(preview, true, commandId)).id, id);
    assert.equal((await sdk.projects.imports.preview(preview.document.input)).preview.document.entries[0]!.disposition, "blocked");
    assert.equal(source.requests(), 0); assert.equal(provider.requests.length, 0);
    await sdk.projects.imports.acknowledge(id, batch.items[0]!.line, batch.revision, true);
    assert.equal(restarted.controller.ownedLocalRoots().includes(path), false);
    assert.equal((await sdk.projects.imports.read(id)).batch.status, "partial");
  } finally { sdk?.disconnect(); await runtime.stop(); await restarted?.close(); await provider.close(); await source.close(); await rm(directory, { recursive: true, force: true }); }
});
