import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bytesDigest } from "../apps/service/src/files.ts";
import { sourceRoot } from "../apps/service/src/repository-source.ts";
import { executeReviewedScript } from "../apps/service/src/script-execution.ts";
import type { ScriptExecution } from "../packages/protocol/src/script-reviews.ts";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { groupExists, stopGroup } from "../apps/service/src/supervisor.ts";
import { waitFor } from "./fixture.ts";
import { existsSync } from "node:fs";

test("reviewed source executes immutable in-memory bytes without a temporary script or raw code in argv", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "moguri-generated-reviewed-execution-")));
  try {
    const rootDigest = bytesDigest(Buffer.from(JSON.stringify(await sourceRoot(root))));
    for (const [interpreter, path, text] of [
      ["sh", "generated.sh", "printf 'GENERATED_SHELL_RESULT\\n'"],
      ["node-module", "generated.mjs", "import {writeFileSync} from 'node:fs'; writeFileSync('generated-result.txt','GENERATED_MODULE_RESULT'); console.log(import.meta.url);"],
      ["node-commonjs", "generated.cjs", "console.log('GENERATED_COMMONJS_RESULT', __filename);"],
    ] as const) {
      const execution: ScriptExecution = { reviewId: "generated-review", path, rootDigest, interpreter, args: [], text, digest: bytesDigest(Buffer.from(text)) };
      let pid = 0;
      const result = await executeReviewedScript(root, execution, new AbortController().signal, (value) => { pid = value; });
      assert.equal(result.outcome, "completed", result.text); assert.equal(result.isError, false);
      assert.ok(pid > 1);
      assert.ok(result.rawText?.includes(interpreter === "sh" ? "GENERATED_SHELL_RESULT" : interpreter === "node-commonjs" ? "GENERATED_COMMONJS_RESULT" : "generated.mjs"));
    }
    assert.equal(await readFile(join(root, "generated-result.txt"), "utf8"), "GENERATED_MODULE_RESULT");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("reviewed script dispatch rejects changed source and root identities before starting a process", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "moguri-generated-reviewed-binding-")));
  try {
    const text = "printf GENERATED_MUST_NOT_START", rootDigest = bytesDigest(Buffer.from(JSON.stringify(await sourceRoot(root))));
    const execution: ScriptExecution = { reviewId: "generated-review", path: "generated.sh", rootDigest, interpreter: "sh", args: [], text, digest: bytesDigest(Buffer.from(text)) };
    for (const changed of [{ ...execution, text: text + "\n" }, { ...execution, rootDigest: "0".repeat(64) }]) {
      await assert.rejects(() => executeReviewedScript(root, changed, new AbortController().signal, () => assert.fail("Unbound script must not spawn.")), /source|root|digest/i);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("cancellation stops a busy untrusted script outside the sentinel event loop and remains partial", { timeout: 10_000 }, async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "moguri-generated-reviewed-stop-"))), abort = new AbortController();
  let group = 0;
  try {
    const text = "import {writeFileSync} from 'node:fs'; writeFileSync('generated-started.txt','Generated started'); while(true){}";
    const execution: ScriptExecution = { reviewId: "generated-busy-review", path: "generated.mjs", rootDigest: bytesDigest(Buffer.from(JSON.stringify(await sourceRoot(root)))),
      interpreter: "node-module", args: [], text, digest: bytesDigest(Buffer.from(text)) };
    const pending = executeReviewedScript(root, execution, abort.signal, (pid) => { group = pid; });
    await waitFor(() => existsSync(join(root, "generated-started.txt")));
    abort.abort();
    const result = await pending;
    assert.equal(result.outcome, "partial"); assert.equal(result.isError, true);
    assert.ok(group > 1); assert.equal(groupExists(group), false);
  } finally { abort.abort(); if (group > 1 && groupExists(group)) await stopGroup(group); await rm(root, { recursive: true, force: true }); }
});

test("actual parent SIGKILL closes the private control pipe and stops the generated busy script group without replay", { timeout: 12_000 }, async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "moguri-generated-script-parent-loss-")));
  let group = 0, parent: ReturnType<typeof spawn> | undefined;
  try {
    const text = "import {writeFileSync} from 'node:fs'; writeFileSync('generated-started.txt','Generated started'); while(true){}";
    const execution: ScriptExecution = { reviewId: "generated-parent-review", path: "generated.mjs", rootDigest: bytesDigest(Buffer.from(JSON.stringify(await sourceRoot(root)))),
      interpreter: "node-module", args: [], text, digest: bytesDigest(Buffer.from(text)) };
    const descriptor = join(root, "generated-execution.json"); await writeFile(descriptor, JSON.stringify(execution));
    parent = spawn(process.execPath, ["--import", "tsx", fileURLToPath(new URL("./fixtures/script-execution-parent.ts", import.meta.url)), root, descriptor],
      { stdio: ["ignore", "pipe", "pipe"] });
    let output = "", stderr = "";
    parent.stdout?.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); const match = output.match(/"generatedGroup":([0-9]+)/); if (match) group = Number(match[1]); });
    parent.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    await waitFor(() => group > 1);
    await waitFor(() => existsSync(join(root, "generated-started.txt")));
    const ended = new Promise((resolve) => parent!.once("exit", resolve));
    parent.kill("SIGKILL"); await ended;
    await waitFor(() => !groupExists(group), 5000);
    assert.equal(stderr, "");
  } finally { if (parent?.exitCode === null && parent.signalCode === null) parent.kill("SIGKILL"); if (group > 1 && groupExists(group)) await stopGroup(group); await rm(root, { recursive: true, force: true }); }
});
