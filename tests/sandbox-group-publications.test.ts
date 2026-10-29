import assert from "node:assert/strict";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { nativeGroupPublicationFixture } from "./fixtures/native-publication.ts";
import { waitFor } from "./fixture.ts";

test("group publication requires one original member and separately publishes same-named files without changing Git intent", async () => {
  const fixture = await nativeGroupPublicationFixture(), { sdk, execution, roots, repositories, result, git } = fixture;
  try {
    await assert.rejects(() => sdk.sandbox.publicationPreview(execution.id, ["fixture.txt"]), { code: "sandbox_repository_required" });
    await assert.rejects(() => sdk.sandbox.publicationPreview(execution.id, ["fixture.txt"], "not-an-original-member"), { code: "sandbox_repository_required" });
    const indexes = await Promise.all(roots.map((root) => readFile(join(root, ".git", "index")))), heads = git.map((git) => git(["rev-parse", "HEAD"]));
    for (const [index, repository] of repositories.entries()) {
      const preview = (await sdk.sandbox.publicationPreview(execution.id, ["fixture.txt"], repository.projectId)).preview;
      assert.equal(preview.document.version, 2);
      if (preview.document.version !== 2) throw new Error("Expected exact group publication document.");
      assert.equal(preview.document.repositoryId, repository.projectId); assert.equal(preview.document.root, repository.root.root);
      assert.deepEqual(preview.document.repositories, repositories);
      const admitted = await sdk.sandbox.publish(execution.id, ["fixture.txt"], preview.digest, execution.revision, repository.projectId);
      const record = (await sdk.sandbox.waitPublication(admitted.id!)).publication;
      assert.equal(record.status, "completed", record.diagnostic ?? "Group publication did not complete.");
      assert.equal(record.version, 2); assert.equal(record.repositoryId, repository.projectId); assert.equal(record.acceptance.actor, "user");
      assert.equal(await readFile(join(repository.root.root, "fixture.txt"), "utf8"), result.files[index]!.text);
      if (!index) assert.equal(await readFile(join(repositories[1]!.root.root, "fixture.txt"), "utf8"), "generated original\n");
    }
    for (const [index, root] of roots.entries()) {
      assert.deepEqual(await readFile(join(root, ".git", "index")), indexes[index]); assert.equal(git[index]!(["rev-parse", "HEAD"]), heads[index]);
    }
    assert.equal(fixture.requests.length, 0);
  } finally { await fixture.close(); }
});

for (const drift of ["root", "bytes", "policy"] as const) test(`group publication rejects ${drift} drift in an unselected original member before effects`, async () => {
  const fixture = await nativeGroupPublicationFixture(), { sdk, execution, repositories } = fixture, selected = repositories[0]!, other = repositories[1]!;
  try {
    const preview = (await sdk.sandbox.publicationPreview(execution.id, ["fixture.txt"], selected.projectId)).preview;
    if (drift === "root") {
      await rename(other.root.root, `${other.root.root}-preserved`);
      await mkdir(other.root.root); await writeFile(join(other.root.root, "fixture.txt"), "generated original\n");
    } else if (drift === "bytes") await writeFile(join(other.root.root, "fixture.txt"), "Generated unreviewed newer source.\n");
    else {
      const configuration = sdk.getState().snapshot!.projectConfigurations.find((configuration) => configuration.projectId === other.projectId)!;
      await sdk.projects.configure(other.projectId, { ...configuration.values, deniedFolders: ["generated-restricted"] }, configuration.revision);
    }
    await assert.rejects(() => sdk.sandbox.publish(execution.id, ["fixture.txt"], preview.digest, execution.revision, selected.projectId), /changed|base|root|policy/i);
    assert.equal(await readFile(join(selected.root.root, "fixture.txt"), "utf8"), "generated original\n");
    assert.equal(fixture.service.controller.snapshot().sandboxPublications!.length, 0); assert.equal(fixture.requests.length, 0);
  } finally { await fixture.close(); }
});

test("exact native publication preserves a shared source mode even when the process creation mask differs", async () => {
  const fixture = await nativeGroupPublicationFixture(0o664), { sdk, execution, repositories } = fixture, repository = repositories[0]!;
  try {
    const preview = (await sdk.sandbox.publicationPreview(execution.id, ["fixture.txt"], repository.projectId)).preview;
    const admitted = await sdk.sandbox.publish(execution.id, ["fixture.txt"], preview.digest, execution.revision, repository.projectId);
    const record = (await sdk.sandbox.waitPublication(admitted.id!)).publication;
    assert.equal(record.status, "completed", record.diagnostic ?? "Source mode was not preserved.");
    assert.equal((await stat(join(repository.root.root, "fixture.txt"))).mode & 0o777, 0o664);
  } finally { await fixture.close(); }
});

test("deleted completed group receipts cannot authorize advanced source bases for another repository", async () => {
  const fixture = await nativeGroupPublicationFixture(), { sdk, execution, repositories } = fixture;
  try {
    const preview = (await sdk.sandbox.publicationPreview(execution.id, ["fixture.txt"], repositories[0]!.projectId)).preview;
    const admitted = await sdk.sandbox.publish(execution.id, ["fixture.txt"], preview.digest, execution.revision, repositories[0]!.projectId);
    assert.equal((await sdk.sandbox.waitPublication(admitted.id!)).publication.status, "completed");
    const artifact = sdk.getState().snapshot!.artifacts.find((artifact) => artifact.id === admitted.id)!;
    await sdk.artifacts.delete(artifact.id, artifact.revision, true);
    await assert.rejects(() => sdk.sandbox.publicationPreview(execution.id, ["fixture.txt"], repositories[1]!.projectId), /receipt|changed|base/i);
    assert.equal(await readFile(join(repositories[1]!.root.root, "fixture.txt"), "utf8"), "generated original\n");
  } finally { await fixture.close(); }
});

test("a group publication leases every original root, not just its selected copy destination", async (t) => {
  const fixture = await nativeGroupPublicationFixture(), { sdk, execution, repositories } = fixture;
  const gate = Promise.withResolvers<void>(); let held = false;
  const original = fixture.service.controller.platform.managed.assert.bind(fixture.service.controller.platform.managed);
  t.mock.method(fixture.service.controller.platform.managed, "assert", async (...args: Parameters<typeof original>) => {
    if (!held && fixture.service.controller.snapshot().sandboxPublications?.some((record) => record.status === "publishing")) {
      held = true; await gate.promise;
    }
    return original(...args);
  });
  try {
    const preview = (await sdk.sandbox.publicationPreview(execution.id, ["fixture.txt"], repositories[0]!.projectId)).preview;
    const admitted = await sdk.sandbox.publish(execution.id, ["fixture.txt"], preview.digest, execution.revision, repositories[0]!.projectId);
    await waitFor(() => held);
    const created = await sdk.sessions.create(repositories[1]!.projectId, "Generated competing source writer", { modelId: fixture.modelId });
    await sdk.command({ type: "draft.save", sessionId: created.id!, expectedRevision: 0, text: "Generated competing source task.", attachments: [] });
    await sdk.command({ type: "message.send", sessionId: created.id!, expectedRevision: 1, delivery: "queue" });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const pending = fixture.service.controller.snapshot().sessions.find((session) => session.id === created.id)!;
    assert.equal(pending.turnId, null); assert.equal(pending.queue.length, 1); assert.equal(fixture.requests.length, 0);
    gate.resolve();
    assert.equal((await sdk.sandbox.waitPublication(admitted.id!)).publication.status, "completed");
    await waitFor(() => fixture.requests.length === 1);
    await sdk.command({ type: "session.stop", sessionId: created.id! });
  } finally { gate.resolve(); t.mock.restoreAll(); await fixture.close(); }
});

for (const action of ["stop", "other-policy"] as const) test(`group publication keeps exact partial effects and original acceptance after ${action}`, async (t) => {
  const fixture = await nativeGroupPublicationFixture(), { sdk, execution, repositories } = fixture;
  const gate = Promise.withResolvers<void>(); let held = false;
  const original = fixture.service.controller.platform.managed.assert.bind(fixture.service.controller.platform.managed);
  t.mock.method(fixture.service.controller.platform.managed, "assert", async (...args: Parameters<typeof original>) => {
    if (!held && fixture.service.controller.snapshot().sandboxPublications?.some((record) => record.status === "publishing" && record.publishedPaths.length === 1)) {
      held = true; await gate.promise;
    }
    return original(...args);
  });
  try {
    const preview = (await sdk.sandbox.publicationPreview(execution.id, ["fixture.txt"], repositories[0]!.projectId)).preview;
    const command = { type: "sandbox.publish" as const, executionId: execution.id, paths: ["fixture.txt"], repository: repositories[0]!.projectId,
      expectedDigest: preview.digest, expectedRevision: execution.revision, confirm: true as const }, commandId = `generated-group-${action}`;
    const admitted = await sdk.command(command, commandId);
    await waitFor(() => held);
    if (action === "stop") await sdk.jobs.cancel((await sdk.sandbox.publication(admitted.id!)).publication.jobId);
    else {
      const configuration = sdk.getState().snapshot!.projectConfigurations.find((configuration) => configuration.projectId === repositories[1]!.projectId)!;
      await sdk.projects.configure(configuration.projectId, { ...configuration.values, deniedFolders: ["generated-restricted"] }, configuration.revision);
    }
    gate.resolve();
    const record = (await sdk.sandbox.waitPublication(admitted.id!)).publication;
    assert.equal(record.status, "partial"); assert.deepEqual(record.publishedPaths, ["fixture.txt"]); assert.deepEqual(record.attemptedPaths, ["fixture.txt"]);
    assert.equal(record.acceptance.actor, "user"); assert.equal(record.acceptance.reviewDigest, preview.digest);
    assert.equal(await readFile(join(repositories[0]!.root.root, "fixture.txt"), "utf8"), fixture.result.files[0]!.text);
    assert.equal(await readFile(join(repositories[1]!.root.root, "fixture.txt"), "utf8"), "generated original\n");
    await sdk.command(command, commandId);
    assert.equal(fixture.service.controller.snapshot().sandboxPublications!.length, 1); assert.equal(fixture.requests.length, 0);
  } finally { gate.resolve(); t.mock.restoreAll(); await fixture.close(); }
});
