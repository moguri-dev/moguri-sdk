import assert from "node:assert/strict";
import test from "node:test";
import { access, mkdir, readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { envelope } from "../apps/service/src/controller.ts";
import { cloneRepositoryFixture } from "./fixtures/clone-repository.ts";
import { setupFixture, waitFor } from "./fixture.ts";
import { profileFixture } from "./fixtures/profiles.ts";
import { startService } from "../apps/service/src/server.ts";

test("explicit clone uses generated Git data and registers the real project atomically with successful job completion", async () => {
  const source = await cloneRepositoryFixture(), fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const path = join(fixture.directory, "cloned"), started = await sdk.projects.clone(source.repository, path, true);
    const job = await sdk.jobs.wait(started.id!);
    assert.equal(job.status, "completed"); assert.equal(job.projectId, null); assert.equal(job.sessionId, null);
    const project = sdk.getState().snapshot!.projects.find((value) => value.id === job.projectClone?.projectId)!;
    assert.equal(project.path, await realpath(path));
    assert.equal(await readFile(join(path, "generated.txt"), "utf8"), "Generated repository clone contents.\n");
    assert.equal(fixture.requests.length, 0);
    const events = fixture.service.controller.events(0), added = events.findIndex((event) => event.event_type === "project.added" && event.project_id === project.id);
    assert.equal(events[added + 1]?.event_type, "job.finished");
    await assert.rejects(() => sdk.projects.clone(source.repository, path, true), /already exists/);
  } finally { sdk.disconnect(); await fixture.close(); await source.close(); }
});

test("a cancelled clone keeps partial files and original intent rather than registering, replaying or deleting a project", async () => {
  const source = await cloneRepositoryFixture(), fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    source.hold();
    const path = join(fixture.directory, "partial"), command = envelope({ type: "project.clone", repository: source.repository, path, confirm: true });
    const started = await fixture.service.controller.dispatch(command);
    await waitFor(source.held);
    await assert.rejects(() => sdk.projects.add(path), /original clone job/);
    if (process.platform === "darwin") await assert.rejects(() => sdk.terminal.openGlobal(path), /owned writer/);
    await sdk.jobs.cancel(started.id!);
    const job = await sdk.jobs.wait(started.id!);
    assert.equal(job.status, "partial"); assert.equal(job.resultDigest, null);
    await access(path);
    assert.equal(sdk.getState().snapshot!.projects.length, 1);
    const before = source.requests();
    fixture.service.store.db.prepare("DELETE FROM receipts WHERE profile_id=? AND id=?").run(sdk.profileId, command.id);
    await fixture.service.controller.dispatch(command);
    assert.equal(source.requests(), before);
    await assert.rejects(() => sdk.projects.clone(source.repository, path, true), /already exists|retained clone intent/);
  } finally { sdk.disconnect(); await fixture.close(); await source.close(); }
});

test("a clone cannot write inside a project root while its actual model turn owns that root", { skip: process.platform !== "darwin" }, async () => {
  const source = await cloneRepositoryFixture(), fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.configure(); await fixture.send("generated slow root-owning model");
    await waitFor(() => fixture.requests.length === 1);
    await assert.rejects(() => sdk.projects.clone(source.repository, join(fixture.project, "nested-clone"), true), /owned writer/);
    assert.equal(sdk.getState().snapshot!.jobs.length, 0);
    await sdk.command({ type: "session.stop", sessionId: fixture.sessionId }); await fixture.terminal();
  } finally { sdk.disconnect(); await fixture.close(); await source.close(); }
});

test("failed final clone publication preserves actual files without registering a project or replaying its original network work", async (context) => {
  const source = await cloneRepositoryFixture(), fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const commit = fixture.service.store.commit.bind(fixture.service.store);
    let failed = false;
    const mock = context.mock.method(fixture.service.store, "commit", (...args: Parameters<typeof commit>) => {
      if (!failed && args[0].some((event) => event.event_type === "project.added" && event.payload.project.name === "unpublished-clone")) {
        failed = true; throw new Error("Generated final clone publication failure");
      }
      return commit(...args);
    });
    const path = join(fixture.directory, "unpublished-clone"), command = envelope({ type: "project.clone", repository: source.repository, path, confirm: true });
    const opened = await fixture.service.controller.dispatch(command), job = await sdk.jobs.wait(opened.id!);
    mock.mock.restore();
    assert.equal(job.status, "partial"); assert.equal(sdk.getState().snapshot!.projects.length, 1);
    assert.equal(await readFile(join(path, "generated.txt"), "utf8"), "Generated repository clone contents.\n");
    const requests = source.requests();
    fixture.service.store.db.prepare("DELETE FROM receipts WHERE profile_id=? AND id=?").run(sdk.profileId, command.id);
    await fixture.service.controller.dispatch(command);
    assert.equal(source.requests(), requests); assert.equal(sdk.getState().snapshot!.jobs.length, 1);
  } finally { sdk.disconnect(); await fixture.close(); await source.close(); }
});

test("concurrent clone commands cannot share a destination and invalid transports/embedded credentials fail before creating jobs", async () => {
  const source = await cloneRepositoryFixture(), fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    for (const repository of ["ext::generated-bad-command", "https://user:generated-secret@example.invalid/repo.git", "file:///generated/repo", "--upload-pack=generated-command"]) {
      await assert.rejects(() => sdk.projects.clone(repository, join(fixture.directory, "invalid"), true), /repository|HTTPS|SSH|credentials/i);
    }
    assert.equal(sdk.getState().snapshot!.jobs.length, 0);
    source.hold();
    const path = join(fixture.directory, "concurrent");
    const results = await Promise.allSettled([sdk.projects.clone(source.repository, path, true), sdk.projects.clone(source.repository, path, true)]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const job = sdk.getState().snapshot!.jobs.find((job) => job.kind === "project.clone")!;
    await waitFor(source.held); await sdk.jobs.cancel(job.id); await sdk.jobs.wait(job.id);
    assert.equal(sdk.getState().snapshot!.jobs.filter((job) => job.kind === "project.clone").length, 1);
  } finally { sdk.disconnect(); await fixture.close(); await source.close(); }
});

test("clone destinations and containing writer roots remain exclusive across profiles without exposing their conversations", { skip: process.platform !== "darwin" }, async () => {
  const source = await cloneRepositoryFixture(), fixture = await profileFixture();
  try {
    const root = join(fixture.directory, "shared-project"); await mkdir(root);
    const project = await fixture.sdk.projects.add(root), created = await fixture.sdk.sessions.create(project.id!);
    const session = fixture.session(fixture.sdk, created.id!);
    await fixture.sdk.sessions.configure(session.id, { ...session.controls, modelId: fixture.providers[0]!.modelId });
    await fixture.send(fixture.sdk, session.id, "generated slow profile-owned task");
    await waitFor(() => fixture.providers[0]!.requests.length === 1);
    const other = await fixture.create("Generated clone profile");
    await assert.rejects(() => other.client.projects.clone(source.repository, join(root, "nested-clone"), true), /owned writer/);
    assert.equal(other.client.getState().snapshot!.sessions.length, 0);
    await fixture.sdk.command({ type: "session.stop", sessionId: session.id });
    await waitFor(() => fixture.session(fixture.sdk, session.id).status === "stopped");
    source.hold();
    const opened = await other.client.projects.clone(source.repository, join(root, "nested-clone"), true);
    await waitFor(source.held);
    await assert.rejects(() => fixture.sdk.terminal.open(session.id), /owned install|publication|root/i);
    await other.client.jobs.cancel(opened.id!); await other.client.jobs.wait(opened.id!);
    assert.equal(other.client.getState().snapshot!.sessions.length, 0);
  } finally { await fixture.close(); await source.close(); }
});

test("reopening the service retains an interrupted clone's partial result and original command without another network dispatch", async () => {
  const source = await cloneRepositoryFixture(), fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  let restarted: Awaited<ReturnType<typeof startService>> | undefined, peer: MoguriSdk | undefined;
  try {
    source.hold();
    const path = join(fixture.directory, "restart-clone"), command = envelope({ type: "project.clone", repository: source.repository, path, confirm: true });
    const opened = await fixture.service.controller.dispatch(command);
    await waitFor(source.held); sdk.disconnect(); await fixture.service.close();
    const requests = source.requests();
    restarted = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey });
    peer = await new MoguriSdk(restarted.connection).ready();
    assert.equal(peer.getState().snapshot!.jobs.find((job) => job.id === opened.id)?.status, "partial");
    restarted.store.db.prepare("DELETE FROM receipts WHERE profile_id=? AND id=?").run(peer.profileId, command.id);
    const inspected = await restarted.controller.dispatch(command);
    assert.equal(inspected.id, opened.id); assert.equal(source.requests(), requests);
    assert.equal(peer.getState().snapshot!.projects.length, 1); await access(path);
  } finally { sdk.disconnect(); peer?.disconnect(); await restarted?.close(); await fixture.close(); await source.close(); }
});
