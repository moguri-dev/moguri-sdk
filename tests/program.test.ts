import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runProgram } from "../apps/service/src/program.ts";
import { waitFor } from "./fixture.ts";

test("owned program cancellation escalates TERM-resistant work and never returns successful output", { timeout: 10_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "moguri-generated-program-"));
  const marker = join(directory, "pid");
  const abort = new AbortController();
  try {
    const result = runProgram(process.execPath, [resolve("tests/fixtures/owned-program.mjs"), marker], { cwd: directory, signal: abort.signal, label: "Generated owned process" });
    const stopped = assert.rejects(result, (error: unknown) => error instanceof Error && "code" in error && error.code === "program_partial");
    await waitFor(() => existsSync(marker)); abort.abort();
    await stopped;
    const pid = Number(await readFile(marker, "utf8"));
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
