import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { startService } from "../apps/service/src/server.ts";
import { nativePublicationFixture } from "./fixtures/native-publication.ts";
import { launchRuntimeChild } from "./fixtures/runtime-process.ts";
import { waitFor } from "./fixture.ts";

for (const position of ["before", "after-first"] as const) test(`actual controller SIGKILL ${position} native source publication retains original intent and cannot replay after a lost receipt`, { timeout: 30_000 }, async () => {
  const fixture = await nativePublicationFixture(), stateDir = join(fixture.directory, "state");
  fixture.sdk.disconnect(); await fixture.service.close();
  const runtime = await launchRuntimeChild({ stateDir, vaultPath: join(fixture.directory, "generated-vault.json"), modelId: fixture.modelId, baseUrl: fixture.baseUrl,
    holdNativePublication: position });
  let sdk = await new MoguriSdk(runtime.connection).ready(), restarted: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    const paths = ["fixture.txt", "second.txt"], review = (await sdk.sandbox.publicationPreview(fixture.execution.id, paths)).preview;
    const command = { type: "sandbox.publish" as const, executionId: fixture.execution.id, paths, expectedDigest: review.digest, expectedRevision: 0, confirm: true as const };
    const commandId = randomUUID(), admitted = await sdk.command(command, commandId);
    await waitFor(() => runtime.heldNativePublicationId === admitted.id);
    const raw = new DatabaseSync(join(stateDir, "state.sqlite"));
    try { raw.prepare("DELETE FROM receipts WHERE profile_id='default' AND id=?").run(commandId); } finally { raw.close(); }
    runtime.child.kill("SIGKILL"); await runtime.exited; sdk.disconnect();
    restarted = await startService({ stateDir, provider: fixture.provider, retentionKey: fixture.retentionKey });
    sdk = await new MoguriSdk(restarted.connection).ready();
    const record = await sdk.sandbox.publication(admitted.id!);
    assert.equal(record.publication.status, "partial");
    assert.equal(record.job?.status, "partial");
    assert.equal(record.publication.acceptance.actor, "user");
    assert.equal(record.publication.commandId, commandId);
    assert.deepEqual(record.publication.publishedPaths, position === "after-first" ? ["fixture.txt"] : []);
    assert.equal(await readFile(join(fixture.root, "fixture.txt"), "utf8"), position === "after-first" ? fixture.result.files[0]!.text : "generated original\n");
    assert.equal(await readFile(join(fixture.root, "second.txt"), "utf8"), "Generated second original.\n");
    const replay = await sdk.command(command, commandId);
    assert.equal(replay.id, admitted.id);
    assert.equal(sdk.getState().snapshot!.sandboxPublications!.length, 1);
    assert.equal(sdk.getState().snapshot!.jobs.filter((job) => job.sandboxPublicationId === admitted.id).length, 1);
    assert.equal((await sdk.sandbox.publication(admitted.id!)).publication.status, "partial");
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await runtime.stop(); await restarted?.close(); await fixture.close(); }
});
