import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { readProjectFile, writeProjectFile } from "../apps/service/src/files.ts";

test("file writes reject a stale base instead of overwriting external changes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "moguri-file-"));
  try {
    await writeFile(join(directory, "generated.txt"), "generated v1");
    const snapshot = await readProjectFile(directory, "generated.txt");
    await writeFile(join(directory, "generated.txt"), "generated external v2");
    await assert.rejects(() => writeProjectFile(directory, "generated.txt", "generated model v2", snapshot.digest), /changed/);
    assert.equal(await readFile(join(directory, "generated.txt"), "utf8"), "generated external v2");
    await writeProjectFile(directory, "new.txt", "generated new", "absent");
    await assert.rejects(() => writeProjectFile(directory, "new.txt", "overwrite", "absent"), /changed/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("regular-file reads reject a named pipe without blocking the filesystem worker", { skip: process.platform === "win32", timeout: 2000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "moguri-file-kind-"));
  try {
    execFileSync("mkfifo", [join(directory, "generated.fifo")]);
    await assert.rejects(() => readProjectFile(directory, "generated.fifo"), /regular files/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
