import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { MoguriSdk, projectSandboxPublication } from "../packages/sdk/src/index.ts";
import { nativePublicationFixture } from "./fixtures/native-publication.ts";
import { waitFor } from "./fixture.ts";

test("native publication rejects changed bases and concurrent clients before duplicate source writes", async () => {
  const fixture = await nativePublicationFixture(), peer = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const paths = ["fixture.txt"], review = (await fixture.sdk.sandbox.publicationPreview(fixture.execution.id, paths)).preview;
    await writeFile(join(fixture.root, "fixture.txt"), "Generated user's newer file.\n");
    await assert.rejects(() => fixture.sdk.sandbox.publish(fixture.execution.id, paths, review.digest, 0), /changed|base/i);
    assert.equal((fixture.service.controller.snapshot().sandboxPublications ?? []).length, 0);
    await writeFile(join(fixture.root, "fixture.txt"), "generated original\n");
    const outcomes = await Promise.allSettled([
      fixture.sdk.sandbox.publish(fixture.execution.id, paths, review.digest, 0),
      peer.sandbox.publish(fixture.execution.id, paths, review.digest, 0),
    ]);
    assert.equal(outcomes.filter((value) => value.status === "fulfilled").length, 1);
    const record = fixture.service.controller.snapshot().sandboxPublications![0]!;
    assert.equal((await fixture.sdk.sandbox.waitPublication(record.id)).publication.status, "completed");
    assert.equal(fixture.service.controller.snapshot().sandboxPublications!.length, 1);
    assert.equal(await readFile(join(fixture.root, "fixture.txt"), "utf8"), fixture.result.files[0]!.text);
    assert.equal(fixture.requests.length, 0);
  } finally { peer.disconnect(); await fixture.close(); }
});

test("native publication projection rejects invented acceptance, erased effects, root changes and terminal replay", async () => {
  const fixture = await nativePublicationFixture();
  try {
    const paths = ["fixture.txt"], preview = (await fixture.sdk.sandbox.publicationPreview(fixture.execution.id, paths)).preview;
    const admitted = await fixture.sdk.sandbox.publish(fixture.execution.id, paths, preview.digest, 0);
    const settled = (await fixture.sdk.sandbox.waitPublication(admitted.id!)).publication;
    const intent = fixture.service.controller.events(0).find((event) => event.event_type === "sandbox.publication_recorded" &&
      event.payload.publication.id === admitted.id && event.payload.publication.revision === 0);
    assert.ok(intent?.event_type === "sandbox.publication_recorded");
    const original = intent.payload.publication;
    for (const changed of [
      { ...original, version: 2 }, { ...original, status: "completed", operationDigest: "a".repeat(64) },
      { ...original, acceptance: { ...original.acceptance, actor: "model" } }, { ...original, publishedPaths: ["undeclared.txt"] },
      { ...original, paths: ["a.txt", "A.txt"] },
    ]) assert.throws(() => projectSandboxPublication(undefined, changed), /Native publication/);
    const progressed = projectSandboxPublication(original, { ...original, revision: 1, attemptedPaths: paths });
    assert.throws(() => projectSandboxPublication(progressed, { ...progressed, revision: 2, attemptedPaths: [] }), /effects|ownership/);
    assert.throws(() => projectSandboxPublication(progressed, { ...progressed, revision: 2, root: "/generated/other-root" }), /ownership|review/);
    assert.throws(() => projectSandboxPublication(settled, { ...settled, revision: settled.revision + 1 }), /terminal/);
  } finally { await fixture.close(); }
});

for (const action of ["stop", "policy"] as const) test(`native source publication retains actual partial paths and original acceptance after ${action}, without rollback or a new job`, async (t) => {
  const fixture = await nativePublicationFixture(), sdk = fixture.sdk;
  let release!: () => void, held = false;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const original = fixture.service.controller.platform.managed.assert.bind(fixture.service.controller.platform.managed);
  t.mock.method(fixture.service.controller.platform.managed, "assert", async (...args: Parameters<typeof original>) => {
    const record = fixture.service.controller.snapshot().sandboxPublications?.find((value) => value.status === "publishing" && value.publishedPaths.length === 1);
    if (record && !held) { held = true; await gate; }
    return original(...args);
  });
  try {
    const index = await readFile(join(fixture.root, ".git", "index")), head = fixture.git(["rev-parse", "HEAD"]);
    const paths = ["fixture.txt", "second.txt"], preview = (await sdk.sandbox.publicationPreview(fixture.execution.id, paths)).preview;
    const envelope = { id: `generated-original-${action}`, profileId: "default", command: { type: "sandbox.publish" as const, executionId: fixture.execution.id,
      paths, expectedDigest: preview.digest, expectedRevision: 0, confirm: true as const } };
    const admitted = await sdk.command(envelope.command, envelope.id);
    await waitFor(() => held);
    const active = (await sdk.sandbox.publication(admitted.id!)).publication;
    await assert.rejects(() => sdk.artifacts.delete(active.id, 0, true), /settle|writer/i);
    if (action === "stop") await sdk.jobs.cancel(active.jobId);
    else {
      const settings = structuredClone(sdk.settings.get()!);
      await sdk.settings.update({ ...settings.values, instructions: "Generated changed authority during source publication." }, settings.revision);
      const policy = sdk.getState().snapshot!.policy;
      await sdk.command({ type: "policy.set", allowedEnvs: policy.allowedEnvs.filter((env) => env !== "Local") });
    }
    release();
    const settled = await sdk.sandbox.waitPublication(active.id);
    assert.equal(settled.publication.status, "partial");
    assert.deepEqual(settled.publication.attemptedPaths, ["fixture.txt"]);
    assert.deepEqual(settled.publication.publishedPaths, ["fixture.txt"]);
    assert.equal(settled.publication.acceptance.actor, "user");
    assert.equal(await readFile(join(fixture.root, "fixture.txt"), "utf8"), fixture.result.files[0]!.text);
    assert.equal(await readFile(join(fixture.root, "second.txt"), "utf8"), "Generated second original.\n");
    assert.deepEqual(await readFile(join(fixture.root, ".git", "index")), index);
    assert.equal(fixture.git(["rev-parse", "HEAD"]), head);
    assert.ok(fixture.service.controller.snapshot().blockedProjects.includes(fixture.session().projectId));
    await sdk.command(envelope.command, envelope.id);
    assert.equal(fixture.service.controller.snapshot().sandboxPublications!.length, 1);
    assert.equal(fixture.requests.length, 0);
  } finally { release(); t.mock.restoreAll(); await fixture.close(); }
});

test("an admitted native source writer owns independent snapshots, not the originating session or execution report", async (t) => {
  const fixture = await nativePublicationFixture(), sdk = fixture.sdk;
  let release!: () => void, held = false;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const original = fixture.service.controller.platform.managed.assert.bind(fixture.service.controller.platform.managed);
  t.mock.method(fixture.service.controller.platform.managed, "assert", async (...args: Parameters<typeof original>) => {
    const record = fixture.service.controller.snapshot().sandboxPublications?.find((value) => value.status === "publishing" && value.publishedPaths.length === 1);
    if (record && !held) { held = true; await gate; }
    return original(...args);
  });
  try {
    const paths = ["fixture.txt", "second.txt"], preview = (await sdk.sandbox.publicationPreview(fixture.execution.id, paths)).preview;
    const admitted = await sdk.sandbox.publish(fixture.execution.id, paths, preview.digest, 0);
    await waitFor(() => held);
    await sdk.sessions.delete(fixture.sessionId, true);
    await sdk.artifacts.delete(fixture.execution.id, 0, true);
    release();
    const settled = await sdk.sandbox.waitPublication(admitted.id!);
    assert.equal(settled.publication.status, "completed");
    assert.equal(settled.document.patch.edits.length, 2);
    assert.equal(await readFile(join(fixture.root, "second.txt"), "utf8"), fixture.result.files[1]!.text);
    assert.ok((await sdk.artifacts.export(admitted.id!)).export.text.includes("Generated second native output"));
  } finally { release(); t.mock.restoreAll(); await fixture.close(); }
});
