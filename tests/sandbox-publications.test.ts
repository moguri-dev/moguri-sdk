import assert from "node:assert/strict";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { MoguriSdk, projectSandboxPublication } from "../packages/sdk/src/index.ts";
import { nativePublicationFixture } from "./fixtures/native-publication.ts";
import { waitFor } from "./fixture.ts";
import { digest } from "../apps/service/src/store.ts";
import { candidateFileBase } from "../apps/service/src/candidate-files.ts";
import { randomUUID } from "node:crypto";
import { captureNativeTree } from "../apps/service/src/native-staging.ts";
import { nativeWorkspaceDocument } from "../apps/service/src/sandbox-workspaces.ts";

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

test("a fresh signed-result publication keeps original Local bases distinct from a checkpoint's current working tree and original stage provenance", async () => {
  const f = await nativePublicationFixture();
  try {
    const original = nativeWorkspaceDocument(f.service.store.blob(f.execution.inputDigest));
    assert.equal(original.version, 1); if (original.version !== 1) assert.fail();
    const text = "Generated independently accepted private candidate.\n";
    await writeFile(join(f.execution.stage.workspace, "fixture.txt"), text, { mode: 0o600 });
    const workingSource = await captureNativeTree(f.execution.stage.workspace, { denied: [], readOnly: [] }, AbortSignal.timeout(5000));
    assert.notEqual(workingSource.digest, f.execution.stage.sourceDigest);
    let acceptedId = "";
    for (const binding of [undefined, { version: 1, sourceDigest: "0".repeat(64) }, { version: 1, sourceDigest: f.execution.stage.sourceDigest }]) {
      const id = randomUUID(), inputDigest = f.service.store.putBlob(JSON.stringify({ ...original, version: 2, workingSource,
        previousExecutionId: null, ...(binding ? { stageBinding: binding } : {}) }));
      const result = { ...f.result, executionId: id, inputDigest,
        files: [{ path: "fixture.txt", text, digest: digest(text), bytes: Buffer.byteLength(text), mode: 0o600 }] };
      const execution = { ...f.execution, id, inputDigest, resultDigest: f.service.store.putBlob(JSON.stringify(result)) };
      const artifact = f.service.controller.platform.artifacts.nativeExecution(f.session(), id, inputDigest);
      f.service.store.commit([{ event_type: "artifact.revised", profile_id: "default", project_id: execution.projectId, payload: { artifact } },
        { event_type: "sandbox.execution_recorded", profile_id: "default", project_id: execution.projectId, payload: { execution } }]);
      f.service.controller.refreshProfile(); await f.sdk.refresh();
      if (!binding || binding.sourceDigest !== f.execution.stage.sourceDigest) {
        await assert.rejects(() => f.sdk.sandbox.publicationPreview(id, ["fixture.txt"]), { code: "sandbox_publication" });
      } else {
        const preview = (await f.sdk.sandbox.publicationPreview(id, ["fixture.txt"])).preview;
        assert.equal(preview.document.patch.edits[0]!.baseDigest, original.source?.files[0]!.digest);
        assert.equal(preview.document.patch.edits[0]!.text, text);
        const published = await f.sdk.sandbox.waitPublication((await f.sdk.sandbox.publish(id, ["fixture.txt"], preview.digest, execution.revision)).id!);
        assert.equal(published.publication.status, "completed"); acceptedId = published.publication.id;
      }
    }
    assert.ok(acceptedId); assert.equal(await readFile(join(f.root, "fixture.txt"), "utf8"), text);
    assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
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

test("native publication discloses its shared patch limit separately from its complete review-document limit", async () => {
  const fixture = await nativePublicationFixture();
  try {
    const preview = (await fixture.sdk.sandbox.publicationPreview(fixture.execution.id, ["fixture.txt"])).preview;
    assert.deepEqual(preview.limits, { files: 20, patchBytes: 32 * 1024, documentBytes: 64 * 1024 });
  } finally { await fixture.close(); }
});

test("native output publication accepts exactly the shared patch-byte cap and rejects the next byte without a source job", async () => {
  const fixture = await nativePublicationFixture();
  try {
    const first = (await fixture.sdk.sandbox.publicationPreview(fixture.execution.id, ["fixture.txt"])).preview;
    const patch = first.document.patch, edit = patch.edits[0]!;
    const overhead = Buffer.byteLength(JSON.stringify({ ...patch, edits: [{ ...edit, text: "" }] }));
    for (const extra of [0, 1]) {
      const text = "x".repeat(first.limits.patchBytes - overhead + extra);
      const result = { ...fixture.result, files: [{ ...fixture.result.files[0]!, text, bytes: Buffer.byteLength(text), digest: digest(text) }] };
      const before = fixture.service.controller.snapshot().sandboxExecutions![0]!;
      fixture.service.store.commit([{ event_type: "sandbox.execution_recorded", profile_id: "default", project_id: before.projectId,
        payload: { execution: { ...before, revision: before.revision + 1, resultDigest: fixture.service.store.putBlob(JSON.stringify(result)) } } }]);
      fixture.service.controller.refreshProfile(); await fixture.sdk.refresh();
      if (extra) await assert.rejects(() => fixture.sdk.sandbox.publicationPreview(before.id, ["fixture.txt"]), { code: "candidate_patch" });
      else {
        const preview = (await fixture.sdk.sandbox.publicationPreview(before.id, ["fixture.txt"])).preview;
        assert.equal(Buffer.byteLength(JSON.stringify(preview.document.patch)), first.limits.patchBytes);
      }
    }
    assert.equal(fixture.service.controller.snapshot().sandboxPublications!.length, 0);
    assert.equal(await readFile(join(fixture.root, "fixture.txt"), "utf8"), "generated original\n");
  } finally { await fixture.close(); }
});

test("a separately reviewed native new file creates only its approved missing parents and preserves source Git intent", async () => {
  const fixture = await nativePublicationFixture();
  try {
    const text = "Generated native nested source output.\n", path = "generated/reviewed/new.ts";
    const result = { ...fixture.result, files: [{ path, text, mode: 0o600, bytes: Buffer.byteLength(text), digest: digest(text) }] };
    fixture.service.store.commit([{ event_type: "sandbox.execution_recorded", profile_id: "default", project_id: fixture.execution.projectId,
      payload: { execution: { ...fixture.execution, revision: 1, resultDigest: fixture.service.store.putBlob(JSON.stringify(result)) } } }]);
    fixture.service.controller.refreshProfile(); await fixture.sdk.refresh();
    const index = await readFile(join(fixture.root, ".git", "index")), head = fixture.git(["rev-parse", "HEAD"]);
    const preview = (await fixture.sdk.sandbox.publicationPreview(fixture.execution.id, [path])).preview;
    assert.equal(preview.document.patch.edits[0]?.baseDigest, "absent");
    const started = await fixture.sdk.sandbox.publish(fixture.execution.id, [path], preview.digest, 1);
    const published = (await fixture.sdk.sandbox.waitPublication(started.id!)).publication;
    assert.equal(published.status, "completed");
    assert.deepEqual(published.createdDirectories, ["generated", "generated/reviewed"]);
    assert.equal(await readFile(join(fixture.root, path), "utf8"), text);
    assert.deepEqual(await readFile(join(fixture.root, ".git", "index")), index);
    assert.equal(fixture.git(["rev-parse", "HEAD"]), head);
  } finally { await fixture.close(); }
});

test("missing-parent base review rejects absent roots, protected directories and aliases instead of reporting them as absent files", async () => {
  const fixture = await nativePublicationFixture();
  try {
    const outside = join(fixture.directory, "generated-outside-review"); await mkdir(outside);
    await symlink(outside, join(fixture.root, "generated-alias"));
    await assert.rejects(() => candidateFileBase(join(fixture.root, "missing-root"), "new.ts"));
    await assert.rejects(() => candidateFileBase(fixture.root, ".ssh/missing/new.ts"), /protected|denied/i);
    await assert.rejects(() => candidateFileBase(fixture.root, "generated-alias/missing/new.ts"), /symlink|denied/i);
    assert.equal(await candidateFileBase(fixture.root, "generated/new/reviewed.ts"), "absent");
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
