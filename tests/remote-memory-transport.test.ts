import test from "node:test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { remoteFixture } from "./fixtures/remote-service.ts";

test("the production owned SSH carrier captures only its actual root and validates current Remote source policy with no model", { skip: process.platform !== "darwin", timeout: 20_000 }, async () => {
  const f = await remoteFixture({ exposeModels: false });
  try {
    await writeFile(join(f.project, "host-only.ts"), "GENERATED_HOST_MEMORY_FORBIDDEN");
    await writeFile(join(f.workspace, "source.ts"), "export const generatedRemoteKnowledge = true;\n");
    await f.probe();
    const result = await f.controller.remote.captureMemory(f.workspace, 100, [], AbortSignal.timeout(10_000), () => {});
    assert.equal(result.binding.root, f.workspace); assert.ok(result.records.some((record) => record.path === "source.ts"));
    assert.equal(JSON.stringify(result).includes("GENERATED_HOST_MEMORY_FORBIDDEN"), false);
    const files = result.records.map(({ text: _, ...metadata }) => metadata);
    const current = await f.controller.remote.validateMemory({ binding: result.binding, files, denied: ["source.ts"] }, AbortSignal.timeout(10_000));
    assert.equal(current.files.find((file) => file.path === "source.ts")?.stale, true);
    await writeFile(join(f.workspace, ".gitignore"), "fixture.txt\n");
    const ignored = await f.controller.remote.validateMemory({ binding: result.binding, files, denied: [] }, AbortSignal.timeout(10_000));
    assert.equal(ignored.files.find((file) => file.path === "fixture.txt")?.stale, true);
    assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});

test("pre-aborted memory capture starts no work and an admitted cancelled production stream cannot become an empty completed index", { skip: process.platform !== "darwin", timeout: 20_000 }, async () => {
  const f = await remoteFixture({ exposeModels: false });
  try {
    await f.probe();
    const stopped = new AbortController(); stopped.abort(new Error("Generated pre-admission memory stop"));
    await assert.rejects(() => f.controller.remote.captureMemory(f.workspace, 100, [], stopped.signal, () => {}), /pre-admission/);
    const text = "Generated bounded memory source.\n".repeat(2000);
    for (let index = 0; index < 100; index++) await writeFile(join(f.workspace, `source-${index}.txt`), text);
    const abort = new AbortController(); let progress = 0;
    await assert.rejects(() => f.controller.remote.captureMemory(f.workspace, 1000, [], abort.signal, (files) => { progress = files; abort.abort(); }), /stream|completion|aborted|partial|control/i);
    assert.ok(progress >= 25); assert.equal(f.controller.snapshot().jobs.length, 0); assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});
