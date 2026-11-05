import assert from "node:assert/strict";
import test from "node:test";
import { access, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { envelope } from "../apps/service/src/controller.ts";
import { startService } from "../apps/service/src/server.ts";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { cloneRepositoryFixture } from "./fixtures/clone-repository.ts";
import { setupFixture, waitFor } from "./fixture.ts";
import { profileFixture } from "./fixtures/profiles.ts";

test("a reviewed generated 38-item pasted list imports every real checkout and retains per-repository results without inference", async () => {
  const paths = Array.from({ length: 38 }, (_, index) => `/generated-owner-${index}/project.git`);
  const source = await cloneRepositoryFixture(paths), f = await setupFixture(), sdk = await new MoguriSdk(f.service.connection).ready();
  try {
    const chosen = join(f.directory, "imports"); await mkdir(chosen); const parent = await realpath(chosen);
    const text = source.repositories.map((url, index) => `${["- ", "* ", "+ ", "", "1. "][index % 5]}${url}`).join("\n");
    const { preview } = await sdk.projects.imports.preview({ text, parent });
    assert.equal(preview.document.entries.length, 38);
    assert.equal(new Set(preview.document.entries.map((entry) => entry.path)).size, 38);
    assert.ok(preview.document.entries.every((entry) => entry.disposition === "clone" && entry.path?.startsWith(`${parent}/`)));
    const started = await sdk.projects.imports.start(preview, true), result = await sdk.projects.imports.wait(started.id!, { timeoutMs: 120_000 });
    assert.equal(result.batch.status, "completed");
    assert.ok(result.batch.items.every((item) => item.status === "imported"));
    assert.equal(sdk.getState().snapshot!.projects.length, 39);
    for (const item of result.batch.items) assert.equal(await readFile(join(item.path, "generated.txt"), "utf8"), "Generated repository clone contents.\n");
    assert.deepEqual(result.review.input, { text, parent });
    assert.equal(f.requests.length, 0);
    const events = f.service.controller.events(0);
    for (const item of result.batch.items) {
      const index = events.findIndex((event) => event.event_type === "project.added" && event.project_id === item.projectId);
      assert.equal(events[index + 1]?.event_type, "repository.import_recorded");
    }
    const repeat = await sdk.projects.imports.preview({ text, parent });
    assert.ok(repeat.preview.document.entries.every((entry) => entry.disposition === "registered"));
  } finally { sdk.disconnect(); await f.close(); await source.close(); }
});

test("bulk preview normalizes bullets, identifies scheme aliases and preserves distinct owner destinations; invalid transports/credentials never admit a batch", async () => {
  const f = await setupFixture(), sdk = await new MoguriSdk(f.service.connection).ready();
  try {
    const text = "- https://github.com/generated-one/shared\n* git@github.com:generated-one/shared.git\n+ https://github.com/generated-two/shared.git\nhttps://github.com/generated-three/.github-private\next::invalid-command\nhttps://generated-user:generated-password@example.invalid/project.git";
    const { preview } = await sdk.projects.imports.preview({ text, parent: f.directory });
    assert.deepEqual(preview.document.entries.map((entry) => entry.disposition), ["clone", "duplicate", "clone", "clone", "invalid", "invalid"]);
    assert.notEqual(preview.document.entries[0]!.path, preview.document.entries[2]!.path);
    assert.ok(preview.document.entries[3]!.path?.includes(".github-private"));
    assert.equal(preview.document.entries[5]!.source, "[invalid repository URL]");
    await assert.rejects(() => sdk.projects.imports.start(preview, true), /invalid|conflicting/);
    assert.equal(f.service.controller.snapshot().repositoryImports.length, 0);
    assert.equal(JSON.stringify(f.service.controller.events(0)).includes("generated-password"), false);
    await assert.rejects(() => sdk.projects.imports.preview({ text: Array(101).fill("https://example.invalid/generated/project").join("\n"), parent: f.directory }), /100/);
  } finally { sdk.disconnect(); await f.close(); }
});

test("destination conflicts and stale registration reviews fail before effects rather than choosing an undocumented fallback", async () => {
  const source = await cloneRepositoryFixture(), f = await setupFixture(), sdk = await new MoguriSdk(f.service.connection).ready();
  try {
    const input = { text: source.repository, parent: f.directory }, { preview } = await sdk.projects.imports.preview(input), path = preview.document.entries[0]!.path!;
    await mkdir(path); await writeFile(join(path, "preserved.txt"), "Generated existing file.\n");
    await assert.rejects(() => sdk.projects.imports.start(preview, true), /changed|Preview again/);
    const conflict = (await sdk.projects.imports.preview(input)).preview;
    assert.equal(conflict.document.entries[0]!.disposition, "blocked");
    await assert.rejects(() => sdk.projects.imports.start(conflict, true), /conflicting/);
    assert.equal(await readFile(join(path, "preserved.txt"), "utf8"), "Generated existing file.\n");
    const parent = join(f.directory, "fresh"); await mkdir(parent);
    const fresh = (await sdk.projects.imports.preview({ ...input, parent })).preview;
    const other = join(f.directory, "other-registration"); await mkdir(other); await sdk.projects.add(other);
    await assert.rejects(() => sdk.projects.imports.start(fresh, true), /changed|Preview again/);
    assert.equal(source.requests(), 0);
  } finally { sdk.disconnect(); await f.close(); await source.close(); }
});

test("one reviewed batch continues past private/unavailable and moved URLs but never calls a partial batch successful", async () => {
  const paths = ["/one/project.git", "/private/project.git", "/moved/project.git", "/last/project.git"];
  const source = await cloneRepositoryFixture(paths), f = await setupFixture(), sdk = await new MoguriSdk(f.service.connection).ready();
  try {
    source.unavailable(paths[1]!); source.redirect(paths[2]!, paths[3]!);
    const { preview } = await sdk.projects.imports.preview({ text: source.repositories.join("\n"), parent: f.directory });
    const started = await sdk.projects.imports.start(preview, true), { batch } = await sdk.projects.imports.wait(started.id!);
    assert.equal(batch.status, "partial");
    assert.deepEqual(batch.items.map((item) => item.status), ["imported", "partial", "partial", "imported"]);
    assert.match(batch.items[1]!.diagnostic!, /private\/unavailable|authentication/);
    assert.match(batch.items[2]!.diagnostic!, /moved URL/);
    assert.equal(sdk.getState().snapshot!.jobs.find((job) => job.id === batch.jobId)?.status, "partial");
    assert.equal(sdk.getState().snapshot!.projects.length, 3);
    for (const item of batch.items) await access(item.path);
    assert.equal(f.requests.length, 0);
  } finally { sdk.disconnect(); await f.close(); await source.close(); }
});

test("cancellation preserves earlier registrations and partial files, never dispatches later items and never replays a lost receipt", async () => {
  const paths = ["/one/project.git", "/held/project.git", "/undispatched/project.git"];
  const source = await cloneRepositoryFixture(paths), f = await setupFixture(), sdk = await new MoguriSdk(f.service.connection).ready();
  try {
    source.hold(paths[1]);
    const { preview } = await sdk.projects.imports.preview({ text: source.repositories.join("\n"), parent: f.directory });
    const command = envelope({ type: "projects.import.start", input: preview.document.input, expectedDigest: preview.digest, confirm: true });
    const started = await f.service.controller.dispatch(command);
    await waitFor(source.held); await sdk.projects.imports.cancel(started.id!);
    const { batch } = await sdk.projects.imports.wait(started.id!);
    assert.equal(batch.status, "partial"); assert.equal(batch.cancelRequested, true);
    assert.deepEqual(batch.items.map((item) => item.status), ["imported", "partial", "cancelled"]);
    assert.equal(source.requestsFor(paths[2]!), 0); await access(batch.items[1]!.path);
    const requests = source.requests();
    f.service.store.db.prepare("DELETE FROM receipts WHERE profile_id=? AND id=?").run(sdk.profileId, command.id);
    assert.equal((await f.service.controller.dispatch(command)).id, started.id);
    assert.equal(source.requests(), requests);
    await assert.rejects(() => f.service.controller.dispatch({ ...command, command: { ...command.command, expectedDigest: "0".repeat(64) } }), /different|conflict/);
    const inspected = await sdk.projects.imports.preview(preview.document.input);
    assert.equal(inspected.preview.document.entries[1]!.disposition, "blocked");
  } finally { sdk.disconnect(); await f.close(); await source.close(); }
});

test("concurrent clients cannot import the same reviewed destination twice", async () => {
  const source = await cloneRepositoryFixture(), f = await setupFixture();
  const sdk = await new MoguriSdk(f.service.connection).ready(), peer = await new MoguriSdk(f.service.connection).ready();
  try {
    source.hold();
    const { preview } = await sdk.projects.imports.preview({ text: source.repository, parent: f.directory });
    const results = await Promise.allSettled([sdk.projects.imports.start(preview, true), peer.projects.imports.start(preview, true)]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    await waitFor(source.held);
    const batch = f.service.controller.snapshot().repositoryImports[0]!;
    assert.equal(f.service.controller.snapshot().repositoryImports.length, 1);
    await assert.rejects(() => sdk.projects.add(batch.items[0]!.path), /original import batch/);
    await sdk.projects.imports.cancel(batch.id); await sdk.projects.imports.wait(batch.id);
  } finally { sdk.disconnect(); peer.disconnect(); await f.close(); await source.close(); }
});

test("failed item publication preserves its real checkout, while successful registrations survive restart with original encrypted review and no network replay", async (context) => {
  const source = await cloneRepositoryFixture(), f = await setupFixture(), sdk = await new MoguriSdk(f.service.connection).ready();
  let restarted: Awaited<ReturnType<typeof startService>> | undefined, peer: MoguriSdk | undefined;
  try {
    const { preview } = await sdk.projects.imports.preview({ text: source.repository, parent: f.directory });
    const command = envelope({ type: "projects.import.start", input: preview.document.input, expectedDigest: preview.digest, confirm: true });
    const commit = f.service.store.commit.bind(f.service.store);
    let injected = false;
    const mock = context.mock.method(f.service.store, "commit", (...args: Parameters<typeof commit>) => {
      if (!injected && args[0].some((event) => event.event_type === "project.added" && event.payload.project.path === preview.document.entries[0]!.path)) {
        injected = true; throw new Error("Generated import publication failure.");
      }
      return commit(...args);
    });

    const started = await f.service.controller.dispatch(command), { batch } = await sdk.projects.imports.wait(started.id!);
    mock.mock.restore();
    assert.equal(batch.status, "partial"); assert.equal(f.service.controller.snapshot().projects.length, 1);
    assert.equal(await readFile(join(batch.items[0]!.path, "generated.txt"), "utf8"), "Generated repository clone contents.\n");
    const requests = source.requests();
    sdk.disconnect(); await f.service.close();
    restarted = await startService({ stateDir: join(f.directory, "state"), provider: f.provider, retentionKey: f.retentionKey });
    peer = await new MoguriSdk(restarted.connection).ready();
    assert.deepEqual((await peer.projects.imports.read(batch.id)).review, preview.document);
    restarted.store.db.prepare("DELETE FROM receipts WHERE profile_id=? AND id=?").run(peer.profileId, command.id);
    assert.equal((await restarted.controller.dispatch(command)).id, batch.id);
    assert.equal(source.requests(), requests);
  } finally { sdk.disconnect(); peer?.disconnect(); await restarted?.close(); await f.close(); await source.close(); }
});

test("matching existing checkouts are explicitly registered without another network request, and batch reviews survive project removal", async () => {
  const source = await cloneRepositoryFixture(), f = await setupFixture(), sdk = await new MoguriSdk(f.service.connection).ready();
  try {
    const input = { text: source.repository, parent: f.directory }, review = (await sdk.projects.imports.preview(input)).preview;
    const path = review.document.entries[0]!.path!, clone = await sdk.projects.clone(source.repository, path, true), job = await sdk.jobs.wait(clone.id!);
    await sdk.projects.remove(job.projectClone!.projectId, true, 0);
    const requests = source.requests(), existing = (await sdk.projects.imports.preview(input)).preview;
    assert.equal(existing.document.entries[0]!.disposition, "register");
    const opened = await sdk.projects.imports.start(existing, true), result = await sdk.projects.imports.wait(opened.id!);
    assert.equal(result.batch.status, "completed"); assert.equal(result.batch.items[0]!.status, "registered");
    assert.equal(source.requests(), requests);
    await sdk.projects.remove(result.batch.items[0]!.projectId!, true, 0);
    assert.deepEqual((await sdk.projects.imports.read(result.batch.id)).review, existing.document);
    assert.equal(await readFile(join(path, "generated.txt"), "utf8"), "Generated repository clone contents.\n");
  } finally { sdk.disconnect(); await f.close(); await source.close(); }
});

test("partial import holds require exact actual-user inspection and cannot leak across profile boundaries", async () => {
  const source = await cloneRepositoryFixture(), f = await profileFixture();
  try {
    source.hold();
    const { preview } = await f.sdk.projects.imports.preview({ text: source.repository, parent: f.directory });
    const opened = await f.sdk.projects.imports.start(preview, true);
    await waitFor(source.held); await f.sdk.projects.imports.cancel(opened.id!);
    const { batch } = await f.sdk.projects.imports.wait(opened.id!), item = batch.items[0]!;
    assert.equal(batch.status, "partial"); assert.ok(f.service.controller.ownedLocalRoots().includes(item.path));
    const other = await f.create("Generated independent import profile");
    await assert.rejects(() => other.client.projects.imports.read(batch.id), /outside.*profile/);
    await assert.rejects(() => f.sdk.projects.imports.acknowledge(batch.id, item.line, batch.revision + 1, true), /exact terminal partial/);
    await assert.rejects(() => f.sdk.projects.add(item.path), /uninspected partial intent/);
    const requests = source.requests(), ack = await f.sdk.projects.imports.acknowledge(batch.id, item.line, batch.revision, true);
    const inspected = (await f.sdk.projects.imports.read(batch.id)).batch;
    assert.equal(inspected.status, "partial"); assert.equal(inspected.items[0]?.inspection?.actor, "user");
    assert.equal(inspected.revision, ack.revision); assert.equal(f.service.controller.ownedLocalRoots().includes(item.path), false);
    assert.equal(source.requests(), requests);
    assert.equal(f.providers.every((provider) => provider.requests.length === 0), true);
  } finally { await f.close(); await source.close(); }
});

test("multiple existing registrations need an exact destination match instead of silently choosing a checkout", async () => {
  const source = await cloneRepositoryFixture(), f = await setupFixture(), sdk = await new MoguriSdk(f.service.connection).ready();
  try {
    const input = { text: source.repository, parent: f.directory }, initial = (await sdk.projects.imports.preview(input)).preview;
    for (const name of ["generated-copy-a", "generated-copy-b"]) await sdk.jobs.wait((await sdk.projects.clone(source.repository, join(f.directory, name), true)).id!);
    const ambiguous = (await sdk.projects.imports.preview(input)).preview;
    assert.equal(ambiguous.document.entries[0]!.disposition, "blocked");
    assert.match(ambiguous.document.entries[0]!.diagnostic!, /2 registered checkouts/);
    const exact = await sdk.projects.clone(source.repository, initial.document.entries[0]!.path!, true); await sdk.jobs.wait(exact.id!);
    const matched = (await sdk.projects.imports.preview(input)).preview;
    assert.equal(matched.document.entries[0]!.disposition, "registered");
    assert.equal(matched.document.entries[0]!.path, initial.document.entries[0]!.path);
  } finally { sdk.disconnect(); await f.close(); await source.close(); }
});

test("hard import denials cannot be turned into authority by copying a previously reviewed list", async () => {
  const source = await cloneRepositoryFixture(), f = await setupFixture(), sdk = await new MoguriSdk(f.service.connection).ready();
  try {
    const { preview } = await sdk.projects.imports.preview({ text: source.repository, parent: f.directory }), settings = sdk.settings.get()!;
    await sdk.settings.update({ ...settings.values, permissions: { ...settings.values.permissions,
      tools: [{ id: "generated-deny-import", tool: "git_write", decision: "deny", pathPrefix: "" }] } }, settings.revision);
    await assert.rejects(() => sdk.projects.imports.start(preview, true), /hard.*denial/i);
    await assert.rejects(() => sdk.projects.clone(source.repository, preview.document.entries[0]!.path!, true), /hard.*denial/i);
    assert.equal(f.service.controller.snapshot().repositoryImports.length, 0); assert.equal(source.requests(), 0);
  } finally { sdk.disconnect(); await f.close(); await source.close(); }
});
