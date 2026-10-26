import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runProgram } from "../apps/service/src/program.ts";
import { waitFor } from "./fixture.ts";

test("generic program launch keeps its actual host PATH unchanged instead of discovering tools for a Remote peer", async () => {
  const directory = await mkdtemp(join(tmpdir(), "moguri-generated-peer-path-")), previous = process.env.PATH;
  try {
    process.env.PATH = "/generated/peer-only";
    const output = await runProgram(process.execPath, ["-p", "JSON.stringify(process.env.PATH)"], {
      cwd: directory, signal: AbortSignal.timeout(5000), label: "Generated peer PATH", timeoutMs: 5000,
    });
    assert.equal(JSON.parse(output), "/generated/peer-only");
  } finally {
    if (previous === undefined) delete process.env.PATH; else process.env.PATH = previous;
    await rm(directory, { recursive: true, force: true });
  }
});

test("owned programs retain an explicitly supplied PATH, including deliberate tool exclusion", async () => {
  const directory = await mkdtemp(join(tmpdir(), "moguri-generated-explicit-path-"));
  try {
    for (const path of ["/generated/only", ""]) {
      const output = await runProgram(process.execPath, ["-p", "JSON.stringify(process.env.PATH)"], {
        cwd: directory, signal: AbortSignal.timeout(5000), env: { PATH: path }, label: "Generated explicit PATH", timeoutMs: 5000,
      });
      assert.equal(JSON.parse(output), path);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("owned programs use the first exact PATH executable and never replace a missing absolute executable", { skip: process.platform === "win32" }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "moguri-generated-tool-selection-"));
  try {
    const paths = [join(directory, "preferred"), join(directory, "other")];
    for (const [index, path] of paths.entries()) {
      await mkdir(path);
      const executable = join(path, "gh");
      await writeFile(executable, `#!/bin/sh\nprintf 'generated-tool-${index}'\n`); await chmod(executable, 0o700);
    }
    const options = { cwd: directory, signal: AbortSignal.timeout(5000), env: { PATH: paths.join(":") }, label: "Generated exact tool", timeoutMs: 5000 };
    assert.equal(await runProgram("gh", [], options), "generated-tool-0");
    await assert.rejects(() => runProgram(join(directory, "missing", "gh"), [], options), { code: "program_unavailable" });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

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
