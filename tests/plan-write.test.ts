import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareProjectDirectory } from "../apps/service/src/project-directory.ts";
import { writeProjectFile } from "../apps/service/src/files.ts";
import { digest } from "../apps/service/src/store.ts";
import { executeUserPlan } from "../apps/service/src/user-plan.ts";

test("shared plan directory preparation records each actual creation and preserves exact atomic file bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "moguri-generated-plan-files-")), created: string[] = [];
  try {
    await prepareProjectDirectory(root, "docs/nested/plan.md", { created: (path) => created.push(path) });
    const text = "Generated exact plan bytes.\n";
    assert.equal(await writeProjectFile(root, "docs/nested/plan.md", text, "absent"), digest(text));
    assert.deepEqual(created, ["docs", "docs/nested"]);
    assert.equal(await readFile(join(root, "docs/nested/plan.md"), "utf8"), text);
    assert.deepEqual(await readdir(join(root, "docs/nested")), ["plan.md"]);
    await prepareProjectDirectory(root, "docs/nested/plan.md", { created: (path) => created.push(path) });
    assert.deepEqual(created, ["docs", "docs/nested"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a directory-creation stop retains its actual partial effect instead of claiming no mutation or rollback", async () => {
  const root = await mkdtemp(join(tmpdir(), "moguri-generated-plan-stop-")), created: string[] = [], abort = new AbortController();
  try {
    await assert.rejects(() => prepareProjectDirectory(root, "docs/nested/plan.md", { signal: abort.signal, created: (path) => { created.push(path); abort.abort(); } }), { name: "AbortError" });
    assert.deepEqual(created, ["docs"]);
    assert.ok((await stat(join(root, "docs"))).isDirectory());
    await assert.rejects(() => stat(join(root, "docs/nested")), { code: "ENOENT" });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("cancelled file admission cannot replace the original or leave a temporary write", async () => {
  const root = await mkdtemp(join(tmpdir(), "moguri-generated-plan-admission-")), abort = new AbortController();
  try {
    await writeFile(join(root, "plan.md"), "Generated original.");
    abort.abort();
    await assert.rejects(() => writeProjectFile(root, "plan.md", "Generated forbidden replacement.", digest("Generated original."), { signal: abort.signal }), { name: "AbortError" });
    assert.equal(await readFile(join(root, "plan.md"), "utf8"), "Generated original.");
    assert.deepEqual(await readdir(root), ["plan.md"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("the commit witness reports a real file replacement even if stop arrives after rename", async () => {
  const root = await mkdtemp(join(tmpdir(), "moguri-generated-plan-commit-")), abort = new AbortController();
  let committed = false;
  try {
    const text = "Generated known written bytes.";
    const hash = await writeProjectFile(root, "plan.md", text, "absent", { signal: abort.signal, committed: () => { committed = true; abort.abort(); } });
    assert.equal(hash, digest(text)); assert.equal(committed, true); assert.equal(abort.signal.aborted, true);
    assert.equal(await readFile(join(root, "plan.md"), "utf8"), text);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("protected/traversal paths and creation-observer failures are explicit and never swallowed", async () => {
  const root = await mkdtemp(join(tmpdir(), "moguri-generated-plan-policy-"));
  try {
    for (const path of [".git/generated/plan.md", "../generated/plan.md", "d/".repeat(257) + "plan.md"]) await assert.rejects(() => prepareProjectDirectory(root, path), /protected|relative|project|256/i);
    assert.deepEqual(await readdir(root), []);
    await assert.rejects(() => prepareProjectDirectory(root, "docs/plan.md", { created: () => { throw new Error("Generated creation observer failed"); } }), /Generated creation observer failed/);
    assert.ok((await stat(join(root, "docs"))).isDirectory());
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("invalid Unicode and UTF-8 byte overflows fail before any plan directory is created", async () => {
  const root = await mkdtemp(join(tmpdir(), "moguri-generated-plan-text-"));
  try {
    for (const text of ["Generated lone surrogate \ud800", "Generated binary \0 plan", "\u00e9".repeat(70_000)]) {
      const result = await executeUserPlan(root, { path: "docs/plan.md", text, expectedDigest: "absent" }, new AbortController().signal, { mode: "agent", folders: { denied: [], readOnly: [] } });
      assert.equal(result.outcome, "failed"); assert.equal(result.fileOutcome, "not-started");
      assert.deepEqual(result.createdDirectories, []); assert.equal(result.text, null);
      assert.deepEqual(await readdir(root), []);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("the deterministic plan executor preserves actual bytes, guards and no-effect cancellation without a model", async () => {
  const root = await mkdtemp(join(tmpdir(), "moguri-generated-user-plan-")), signal = new AbortController().signal;
  const safety = { mode: "agent" as const, folders: { denied: [], readOnly: [] } };
  try {
    const input = { path: "docs/plan.md", text: "Generated direct user plan.\n", expectedDigest: "absent" };
    const result = await executeUserPlan(root, input, signal, safety);
    assert.equal(result.outcome, "completed"); assert.equal(result.fileOutcome, "written");
    assert.equal(result.digest, digest(input.text)); assert.equal(result.readback, true);
    assert.deepEqual(result.createdDirectories, ["docs"]);
    const conflict = await executeUserPlan(root, { ...input, text: "Generated stale write." }, signal, safety);
    assert.equal(conflict.outcome, "failed"); assert.equal(conflict.fileOutcome, "not-started");
    const denied = await executeUserPlan(root, input, signal, { ...safety, mode: "read-only" });
    assert.equal(denied.outcome, "failed"); assert.equal(denied.fileOutcome, "not-started");
    const abort = new AbortController(); abort.abort();
    const stopped = await executeUserPlan(root, { ...input, path: "other/plan.md" }, abort.signal, safety);
    assert.equal(stopped.outcome, "stopped"); assert.deepEqual(stopped.createdDirectories, []);
    await assert.rejects(() => stat(join(root, "other")), { code: "ENOENT" });
    assert.equal(await readFile(join(root, "docs/plan.md"), "utf8"), input.text);
  } finally { await rm(root, { recursive: true, force: true }); }
});
