import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { captureNativeTree, materializeNativeStage } from "../apps/service/src/native-staging.ts";

test("automatic project copies are complete beyond text-preview limits while private, ignored and linked sources stay out", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "moguri-native-tree-"))), source = join(root, "source"), stages = join(root, "stages");
  try {
    await mkdir(source, { mode: 0o700 }); await mkdir(stages, { mode: 0o700 });
    for (let index = 0; index < 205; index++) await writeFile(join(source, `generated-${index}.txt`), `Generated ${index}\n`);
    await writeFile(join(source, ".gitignore"), "ignored/\n");
    await mkdir(join(source, "ignored")); await writeFile(join(source, "ignored", "not-admitted.txt"), "Generated ignored.");
    await writeFile(join(source, ".env"), "GENERATED_PRIVATE=not-admitted");
    await writeFile(join(root, "outside.txt"), "Generated outside scope."); await symlink(join(root, "outside.txt"), join(source, "linked.txt"));
    await mkdir(join(source, "denied")); await writeFile(join(source, "denied", "not-admitted.txt"), "Generated denied.");
    const binary = Buffer.alloc(160 * 1024, 0x81), large = "Generated large source.\n".repeat(10_000);
    await writeFile(join(source, "generated.bin"), binary); await writeFile(join(source, "large.ts"), large);
    const captured = await captureNativeTree(source, { denied: ["denied"], readOnly: [] }, AbortSignal.timeout(10_000));
    assert.equal(captured.capture, "tree-v1"); assert.equal(captured.files.length, 208);
    assert.ok(captured.files.every((file) => file.text === null && !file.path.startsWith("denied/")));
    const stage = await materializeNativeStage(stages, { profileId: "generated", sessionId: randomUUID(), turnId: randomUUID() }, captured, AbortSignal.timeout(10_000));
    assert.notEqual(stage.workspace, source);
    assert.deepEqual(await readFile(join(stage.workspace, "generated.bin")), binary);
    assert.equal(await readFile(join(stage.workspace, "large.ts"), "utf8"), large);
    await writeFile(join(stage.workspace, "generated-1.txt"), "Generated private edit.");
    assert.equal(await readFile(join(source, "generated-1.txt"), "utf8"), "Generated 1\n");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("changed source and cancelled automatic copying cannot admit a stale or partial workspace", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "moguri-native-tree-race-"))), source = join(root, "source"), stages = join(root, "stages");
  try {
    await mkdir(source, { mode: 0o700 }); await mkdir(stages, { mode: 0o700 });
    await writeFile(join(source, "generated.txt"), "Generated original.");
    const captured = await captureNativeTree(source, { denied: [], readOnly: [] }, AbortSignal.timeout(5000));
    await writeFile(join(source, "generated.txt"), "Generated changed.");
    const owner = { profileId: "generated", sessionId: randomUUID(), turnId: randomUUID() };
    await assert.rejects(() => materializeNativeStage(stages, owner, captured, AbortSignal.timeout(5000)), /source changed/i);
    await assert.rejects(() => captureNativeTree(source, { denied: [], readOnly: [] }, AbortSignal.abort()), /abort/i);
  } finally { await rm(root, { recursive: true, force: true }); }
});
