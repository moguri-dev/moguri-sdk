import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { envelope } from "../apps/service/src/controller.ts";
import { remotePlanFixture as setupPlan } from "./fixtures/remote-plan-service.ts";
import { holdRemoteFrame } from "./fixtures/remote-frame-gate.ts";
import { waitFor } from "./fixture.ts";

test("Remote saves require the reviewed binding even when both old and new plan files are absent", { skip: process.platform !== "darwin", timeout: 20_000 }, async () => {
  const f = await setupPlan();
  try {
    await assert.rejects(() => f.sdk.plans.save(f.sessionId, "Generated missing binding.", "absent"), /binding|not supplied/i);
    const other = join(f.workspace, "..", "generated-new-empty-binding-root"); await mkdir(other);
    const configuration = (await f.sdk.projects.configuration(f.session().projectId)).configuration;
    await f.sdk.projects.configure(configuration.projectId, { ...configuration.values, remotePath: other }, configuration.revision);
    await assert.rejects(() => f.sdk.plans.save(f.sessionId, "Generated stale reviewed binding.", "absent", f.bindingDigest), /binding|changed/i);
    assert.equal((await f.sdk.plans.saves(f.sessionId)).saves.length, 0);
    assert.equal(f.controller.snapshot().executions.length, 0);
    await assert.rejects(() => readFile(join(f.workspace, "docs/plan.md")), { code: "ENOENT" });
    await assert.rejects(() => readFile(join(other, "docs/plan.md")), { code: "ENOENT" });
    assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});

test("changing a Remote mapping before write authorization preserves both old and new roots", { skip: process.platform !== "darwin", timeout: 20_000 }, async (t) => {
  const f = await setupPlan();
  try {
    const gate = holdRemoteFrame(t, f.controller.remote, "approval");
    const pending = f.sdk.plans.save(f.sessionId, "Generated stale-root plan.", "absent", f.bindingDigest);
    await waitFor(() => gate.held);
    const other = join(f.workspace, "..", "generated-new-remote-root"); await mkdir(other);
    const configuration = (await f.sdk.projects.configuration(f.session().projectId)).configuration;
    await f.sdk.projects.configure(configuration.projectId, { ...configuration.values, remotePath: other }, configuration.revision);
    gate.release();
    await assert.rejects(() => pending, /changed|another workspace/i);
    await assert.rejects(() => readFile(join(f.workspace, "docs/plan.md")), { code: "ENOENT" });
    await assert.rejects(() => readFile(join(other, "docs/plan.md")), { code: "ENOENT" });
    const save = (await f.sdk.plans.saves(f.sessionId)).saves[0]!;
    assert.equal(save.status, "failed"); assert.equal(save.fileOutcome, "not-started"); assert.equal(save.artifactId, null);
    assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});

test("read-only restriction before authorization cannot leave a plan effect or a synthetic steer in the queue", { skip: process.platform !== "darwin", timeout: 20_000 }, async (t) => {
  const f = await setupPlan();
  try {
    const gate = holdRemoteFrame(t, f.controller.remote, "approval");
    const pending = f.sdk.plans.save(f.sessionId, "Generated forbidden mode transition.", "absent", f.bindingDigest);
    await waitFor(() => gate.held);
    await f.sdk.sessions.mode(f.sessionId, "read-only");
    gate.release();
    await assert.rejects(() => pending, /cannot edit|read.only/i);
    assert.equal(f.session().mode, "read-only"); assert.equal(f.session().queue.length, 0);
    await assert.rejects(() => readFile(join(f.workspace, "docs/plan.md")), { code: "ENOENT" });
    assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});

test("exact Remote save stop before authorization is stopped without a file effect", { skip: process.platform !== "darwin", timeout: 20_000 }, async (t) => {
  const f = await setupPlan();
  try {
    const gate = holdRemoteFrame(t, f.controller.remote, "approval");
    const pending = f.sdk.plans.save(f.sessionId, "Generated stopped user plan.", "absent", f.bindingDigest);
    await waitFor(() => gate.held);
    const save = (await f.sdk.plans.saves(f.sessionId)).saves[0]!;
    await f.sdk.plans.stopSave(f.sessionId, save.id); gate.release();
    await assert.rejects(() => pending, /stopped/i);
    const actual = (await f.sdk.plans.saveInfo(f.sessionId, save.id)).save;
    assert.equal(actual.status, "stopped"); assert.equal(actual.fileOutcome, "not-started");
    await assert.rejects(() => readFile(join(f.workspace, "docs/plan.md")), { code: "ENOENT" });
    assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});

test("stop after actual Remote bytes were written is partial and retains the original-boundary artifact", { skip: process.platform !== "darwin", timeout: 20_000 }, async (t) => {
  const f = await setupPlan();
  try {
    const gate = holdRemoteFrame(t, f.controller.remote, "user-plan.complete");
    const text = "Generated actual written plan before stop.\n", pending = f.sdk.plans.save(f.sessionId, text, "absent", f.bindingDigest);
    await waitFor(() => gate.held);
    assert.equal(await readFile(join(f.workspace, "docs/plan.md"), "utf8"), text);
    const save = (await f.sdk.plans.saves(f.sessionId)).saves[0]!;
    await f.sdk.plans.stopSave(f.sessionId, save.id); gate.release();
    await assert.rejects(() => pending, /after|filesystem|effects|rollback/i);
    const actual = (await f.sdk.plans.saveInfo(f.sessionId, save.id)).save;
    assert.equal(actual.status, "partial"); assert.equal(actual.fileOutcome, "written"); assert.ok(actual.artifactId);
    const artifact = await f.sdk.artifacts.read(actual.artifactId!);
    assert.equal(artifact.text, text); assert.equal(artifact.artifact.sources[0]?.boundary?.root, f.workspace);
    assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});

test("a failed exact result acknowledgement is reconciled without another write or a successful save claim", { skip: process.platform !== "darwin", timeout: 20_000 }, async (t) => {
  const f = await setupPlan();
  try {
    const commit = f.service.store.commit.bind(f.service.store);
    let failed = false;
    const mock = t.mock.method(f.service.store, "commit", (...args: Parameters<typeof commit>) => {
      if (!failed && args[0].some((event) => event.event_type === "plan.save_recorded" && event.payload.save.phase === "result")) { failed = true; throw new Error("Generated Remote result acknowledgement failure"); }
      return commit(...args);
    });
    const text = "Generated retained late file result.\n";
    await assert.rejects(() => f.sdk.plans.save(f.sessionId, text, "absent", f.bindingDigest), /unconfirmed|protocol|partial|cleanup/i);
    mock.mock.restore();
    assert.equal(await readFile(join(f.workspace, "docs/plan.md"), "utf8"), text);
    const save = (await f.sdk.plans.saves(f.sessionId)).saves[0]!;
    const execution = f.controller.snapshot().executions.find((value) => value.id === save.executionId)!;
    await waitFor(() => !f.controller.remote.owns(execution.id));
    await f.sdk.remote.reconcile(execution.id);
    const actual = (await f.sdk.plans.saveInfo(f.sessionId, save.id)).save;
    assert.equal(actual.status, "partial"); assert.equal(actual.fileOutcome, "written"); assert.ok(actual.artifactId);
    assert.equal((await f.sdk.artifacts.read(actual.artifactId!)).text, text);
    const artifacts = f.controller.snapshot().artifacts.length;
    await f.sdk.remote.reconcile(execution.id);
    assert.equal(f.controller.snapshot().artifacts.length, artifacts);
    assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});

test("an old completed save stop cannot cancel a newer exact Remote plan operation", { skip: process.platform !== "darwin", timeout: 20_000 }, async (t) => {
  const f = await setupPlan();
  try {
    await f.sdk.plans.save(f.sessionId, "Generated first complete save.\n", "absent", f.bindingDigest);
    const old = (await f.sdk.plans.saves(f.sessionId)).saves[0]!, current = await f.sdk.plans.read(f.sessionId);
    const gate = holdRemoteFrame(t, f.controller.remote, "approval");
    const pending = f.sdk.plans.save(f.sessionId, "Generated newer exact save.\n", current.digest, current.bindingDigest);
    await waitFor(() => gate.held);
    const id = f.session().turnId;
    await assert.rejects(() => f.sdk.plans.stopSave(f.sessionId, old.id), /settled|newer|ownership/i);
    assert.equal(f.session().turnId, id); assert.equal(f.session().status, "running");
    gate.release(); await pending;
    assert.equal((await f.sdk.plans.read(f.sessionId)).text, "Generated newer exact save.\n");
    assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});

test("the shared plan save creates exact Remote bytes and an independent boundary-bound artifact without a model or Local fallback", { skip: process.platform !== "darwin", timeout: 20_000 }, async () => {
  const f = await setupPlan();
  try {
    const before = await f.sdk.plans.read(f.sessionId), text = "Generated explicit Remote user plan.\n";
    assert.equal(before.exists, false);
    const result = await f.sdk.plans.save(f.sessionId, text, before.digest, before.bindingDigest);
    assert.equal(await readFile(join(f.workspace, "docs/plan.md"), "utf8"), text);
    await assert.rejects(() => readFile(join(f.project, "docs/plan.md"), "utf8"), { code: "ENOENT" });
    const artifact = await f.sdk.artifacts.read(result.id!);
    assert.equal(artifact.text, text); assert.equal(artifact.artifact.kind, "plan");
    assert.equal(artifact.artifact.sources[0]?.actor, "user");
    assert.equal(artifact.artifact.sources[0]?.boundary?.env, "Remote");
    assert.equal(artifact.artifact.sources[0]?.boundary?.root, f.workspace);
    assert.equal(f.requests.length, 0); assert.equal(f.session().usage.length, 0);
    assert.equal(f.session().messages.filter((message) => message.role === "user").length, 0);
    const saves = (await f.sdk.plans.saves(f.sessionId)).saves;
    assert.equal(saves.length, 1); assert.equal(saves[0]?.status, "completed");
    assert.equal(saves[0]?.fileOutcome, "written"); assert.equal(saves[0]?.artifactId, result.id);
    assert.ok(saves[0]?.executionId);
    await f.sdk.sessions.delete(f.sessionId, true);
    assert.equal((await f.sdk.artifacts.read(result.id!)).text, text);
    assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});

test("a stale Remote plan digest preserves actual changed bytes and never reports a saved artifact", { skip: process.platform !== "darwin", timeout: 20_000 }, async () => {
  const f = await setupPlan();
  try {
    const base = await f.sdk.plans.read(f.sessionId);
    await f.sdk.plans.save(f.sessionId, "Generated first plan.\n", base.digest, base.bindingDigest);
    const current = await f.sdk.plans.read(f.sessionId);
    await writeFile(join(f.workspace, "docs/plan.md"), "Generated concurrent Remote plan.\n");
    await assert.rejects(() => f.sdk.plans.save(f.sessionId, "Generated stale overwrite.\n", current.digest, current.bindingDigest), /changed|conflict/i);
    assert.equal(await readFile(join(f.workspace, "docs/plan.md"), "utf8"), "Generated concurrent Remote plan.\n");
    const saves = (await f.sdk.plans.saves(f.sessionId)).saves;
    assert.equal(saves.at(-1)?.status, "failed");
    assert.equal(saves.at(-1)?.fileOutcome, "not-started");
    assert.equal(saves.at(-1)?.artifactId, null);
    assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});

test("question-only mode and denied/read-only Remote plan folders cannot be bypassed by manual saves", { skip: process.platform !== "darwin", timeout: 20_000 }, async () => {
  const f = await setupPlan();
  try {
    await f.sdk.sessions.mode(f.sessionId, "read-only");
    await assert.rejects(() => f.sdk.plans.save(f.sessionId, "Generated forbidden plan.", "absent", f.bindingDigest), /read.only|cannot edit/i);
    await f.sdk.sessions.mode(f.sessionId, "agent");
    const projectId = f.session().projectId;
    for (const key of ["readOnlyFolders", "deniedFolders"] as const) {
      const configuration = (await f.sdk.projects.configuration(projectId)).configuration;
      await f.sdk.projects.configure(projectId, { ...configuration.values, readOnlyFolders: [], deniedFolders: [], [key]: ["docs"] }, configuration.revision);
      await assert.rejects(() => f.sdk.plans.save(f.sessionId, "Generated forbidden folder write.", "absent", f.bindingDigest), /denied|read.only/i);
    }
    await assert.rejects(() => readFile(join(f.workspace, "docs/plan.md")), { code: "ENOENT" });
    assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});

test("identical Remote plan command IDs return the same artifact and cannot launch a second write", { skip: process.platform !== "darwin", timeout: 20_000 }, async () => {
  const f = await setupPlan();
  try {
    const command = envelope({ type: "plan.save", sessionId: f.sessionId, text: "Generated idempotent Remote plan.\n", expectedDigest: "absent", expectedBinding: f.bindingDigest });
    const [first, second] = await Promise.all([f.controller.dispatch(command), f.controller.dispatch(command)]);
    assert.equal(first.id, second.id);
    assert.deepEqual(await f.controller.dispatch(command), first);
    assert.equal((await f.sdk.plans.saves(f.sessionId)).saves.length, 1);
    assert.equal(f.controller.snapshot().executions.length, 1);
    assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});

test("shared plan slash saves preserve exact spaces, tabs and newlines rather than normalizing JSON content", { skip: process.platform !== "darwin", timeout: 20_000 }, async () => {
  const f = await setupPlan();
  try {
    const text = "Generated  two spaces.\n\tGenerated indented line.\n";
    const result = await f.sdk.slash(f.sessionId, `/plan save ${JSON.stringify({ text, expectedDigest: "absent", expectedBinding: f.bindingDigest })} confirm-write`, "tui");
    assert.equal(result.kind, "ok");
    assert.equal(await readFile(join(f.workspace, "docs/plan.md"), "utf8"), text);
    assert.equal((await f.sdk.plans.read(f.sessionId)).text, text);
    assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});

test("the exact 128-KiB plan byte bound survives JSON escaping in the typed Remote result", { skip: process.platform !== "darwin", timeout: 20_000 }, async () => {
  const f = await setupPlan();
  try {
    const text = "\n".repeat(128 * 1024);
    const saved = await f.sdk.plans.save(f.sessionId, text, "absent", f.bindingDigest);
    assert.equal((await f.sdk.artifacts.read(saved.id!)).text, text);
    assert.equal((await readFile(join(f.workspace, "docs/plan.md"))).byteLength, 128 * 1024);
    const metadata = (await f.sdk.plans.saves(f.sessionId)).saves[0]!;
    const result = (await f.sdk.plans.saveInfo(f.sessionId, metadata.id)).result;
    assert.equal(result?.bytes, 128 * 1024); assert.equal(result?.text, text);
    assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});

test("a retained-artifact commit failure after Remote bytes were written stays partial and cannot replay its command", { skip: process.platform !== "darwin", timeout: 20_000 }, async (t) => {
  const f = await setupPlan();
  try {
    const commit = f.service.store.commit.bind(f.service.store);
    let rejected = false;
    const mock = t.mock.method(f.service.store, "commit", (...args: Parameters<typeof commit>) => {
      if (!rejected && args[0].some((event) => event.event_type === "artifact.revised")) { rejected = true; throw new Error("Generated Remote artifact receipt failure"); }
      return commit(...args);
    });

    const command = envelope({ type: "plan.save", sessionId: f.sessionId, text: "Generated written plan with failed retained receipt.\n", expectedDigest: "absent", expectedBinding: f.bindingDigest });
    await assert.rejects(() => f.controller.dispatch(command), /partial|retained|receipt|unconfirmed/i);
    mock.mock.restore();
    assert.equal(await readFile(join(f.workspace, "docs/plan.md"), "utf8"), command.command.type === "plan.save" ? command.command.text : "");
    const save = (await f.sdk.plans.saves(f.sessionId)).saves[0]!;
    assert.equal(save.status, "partial"); assert.equal(save.fileOutcome, "written"); assert.equal(save.artifactId, null);
    await assert.rejects(() => f.controller.dispatch(command), /partial|unconfirmed|replay|recorded/i);
    assert.equal((await f.sdk.plans.saves(f.sessionId)).saves.length, 1);
    assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});
