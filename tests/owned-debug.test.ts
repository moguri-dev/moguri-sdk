import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OwnedDebugRuntime } from "../apps/service/src/owned-debug.ts";
import { ciTime } from "./fixtures/time-scale.ts";

test("cancelling a lost mutation reply stays partial without cancelling the independent disconnect acknowledgement", { timeout: ciTime(10000) }, async () => {
  const runtime = new OwnedDebugRuntime(), abort = new AbortController(), ended: string[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await runtime.execute(process.cwd(), { action: "start", adapter: process.execPath, args: [fileURLToPath(new URL("./fixtures/generated-dap-adapter.mjs", import.meta.url)), "attach"] },
      abort.signal, () => {}, async (_pid, outcome) => { ended.push(outcome); });
    await runtime.execute(process.cwd(), { action: "request", command: "attach", arguments: { generated: true } }, abort.signal, () => {}, async () => {});
    const request = runtime.execute(process.cwd(), { action: "request", command: "evaluate", arguments: { expression: "generated never reply" } }, abort.signal, () => {}, async () => {});
    timer = setTimeout(() => abort.abort(), 30);
    await assert.rejects(request, { code: "tool_partial" });
    assert.equal(await runtime.close(), true); assert.deepEqual(ended, ["stopped"]);
  } finally { clearTimeout(timer); await runtime.close(); }
});

test("owned DAP uses real framed requests, truthful quiescence and exact process cleanup", { timeout: ciTime(10000) }, async () => {
  const ended: number[] = [], runtime = new OwnedDebugRuntime();
  const signal = new AbortController().signal;
  let pid = 0;
  try {
    await runtime.execute(process.cwd(), { action: "start", adapter: process.execPath, args: [fileURLToPath(new URL("./fixtures/generated-dap-adapter.mjs", import.meta.url))] },
      signal, (value) => { pid = value; }, async (value) => { ended.push(value); });
    assert.ok(pid > 1); assert.equal(runtime.quiescent, false);
    const result = await runtime.execute(process.cwd(), { action: "request", command: "threads", arguments: {} }, signal, () => {}, async () => {});
    assert.match(result.text, /Generated worker/);
    await runtime.execute(process.cwd(), { action: "stop" }, signal, () => {}, async () => {});
    assert.equal(runtime.quiescent, true);
    assert.deepEqual(ended, [pid]);
    assert.equal(await runtime.close(), true);
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  } finally { await runtime.close(); }
});

test("DAP cleanup disconnects launched targets but never implicitly terminates an attached target", { timeout: ciTime(10000) }, async () => {
  const root = await mkdtemp(join(tmpdir(), "moguri-dap-disconnect-"));
  try {
  for (const target of ["launch", "attach"] as const) {
    const runtime = new OwnedDebugRuntime(), ended: string[] = [], signal = new AbortController().signal, record = join(root, `${target}.json`);
    try {
      await runtime.execute(root, { action: "start", adapter: process.execPath, args: [fileURLToPath(new URL("./fixtures/generated-dap-adapter.mjs", import.meta.url)), target, record] },
        signal, () => {}, async (_pid, outcome) => { ended.push(outcome); });
      await runtime.execute(process.cwd(), { action: "request", command: target, arguments: { generated: true } }, signal, () => {}, async () => {});
      assert.equal(await runtime.close(), true);
      assert.deepEqual(ended, ["stopped"]);
      assert.deepEqual(JSON.parse(await readFile(record, "utf8")), { terminateDebuggee: target === "launch", suspendDebuggee: false });
    } finally { await runtime.close(); }
  }
  } finally { await rm(root, { recursive: true, force: true }); }
});
