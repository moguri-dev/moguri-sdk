import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeTool } from "../apps/service/src/tools.ts";
import { digest } from "../apps/service/src/store.ts";
import type { ToolCall } from "../packages/protocol/src/index.ts";
import { setupFixture } from "./fixture.ts";

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "moguri-owned-file-tool-"))), abort = new AbortController();
  const original = "Generated original file.\n", proposed = "Generated approved file.\n";
  await writeFile(join(root, "generated.txt"), original);
  const call: ToolCall = { id: "generated-write", name: "write_file", arguments: { path: "generated.txt", text: proposed, expectedDigest: digest(original) } };
  return { root, abort, original, proposed, call,
    run: () => executeTool(root, call, abort.signal, () => assert.fail("A file tool cannot emit command output."), () => assert.fail("A file tool cannot spawn a program."),
      undefined, { mode: "agent", folders: { denied: [], readOnly: [] } }),
    close: () => rm(root, { recursive: true, force: true }) };
}

test("the file tool propagates an owned stop during preparation and cannot rename the uncommitted candidate", async (t) => {
  const f = await fixture(), originalOpen = fs.promises.open;
  t.mock.method(fs.promises, "open", async (...args: Parameters<typeof originalOpen>) => {
    const file = await originalOpen(...args);
    if (String(args[0]).includes(".moguri-write-")) f.abort.abort();
    return file;
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(() => f.run(), { name: "AbortError" });
    assert.equal(await readFile(join(f.root, "generated.txt"), "utf8"), f.original);
    assert.deepEqual(await readdir(f.root), ["generated.txt"]);
  } finally { t.mock.restoreAll(); syncBuiltinESMExports(); await f.close(); }
});

test("a stop after the actual file rename is partial, not a completed or effect-free stopped tool", async (t) => {
  const f = await fixture(), originalRename = fs.promises.rename;
  t.mock.method(fs.promises, "rename", async (...args: Parameters<typeof originalRename>) => {
    await originalRename(...args); if (String(args[1]) === join(f.root, "generated.txt")) f.abort.abort();
  });
  syncBuiltinESMExports();
  try {
    const result = await f.run();
    assert.equal(result.outcome, "partial"); assert.equal(result.isError, true);
    assert.match(result.text, /publish|writ/i);
    assert.equal(await readFile(join(f.root, "generated.txt"), "utf8"), f.proposed);
  } finally { t.mock.restoreAll(); syncBuiltinESMExports(); await f.close(); }
});

test("a directory-sync failure after publication retains a truthful partial file-tool result", async (t) => {
  const f = await fixture(), originalOpen = fs.promises.open;
  t.mock.method(fs.promises, "open", async (...args: Parameters<typeof originalOpen>) => {
    if (String(args[0]) === f.root && args[1] === "r") throw Object.assign(new Error("Generated directory sync unavailable."), { code: "EIO" });
    return originalOpen(...args);
  });
  syncBuiltinESMExports();
  try {
    const result = await f.run();
    assert.equal(result.outcome, "partial"); assert.equal(result.isError, true);
    assert.equal(await readFile(join(f.root, "generated.txt"), "utf8"), f.proposed);
  } finally { t.mock.restoreAll(); syncBuiltinESMExports(); await f.close(); }
});

test("an unacknowledged rename remains explicitly possible while an early base conflict stays effect-free", async (t) => {
  const f = await fixture();
  try {
    f.call.arguments.expectedDigest = "0".repeat(64);
    await assert.rejects(() => f.run(), { code: "file_conflict" });
    f.call.arguments.expectedDigest = digest(f.original);
    t.mock.method(fs.promises, "rename", async () => { throw Object.assign(new Error("Generated unacknowledged rename."), { code: "EIO" }); });
    syncBuiltinESMExports();
    const result = await f.run();
    assert.equal(result.outcome, "partial"); assert.equal(result.isError, true);
    assert.match(result.text, /unconfirmed|possible|may/i);
    assert.equal(await readFile(join(f.root, "generated.txt"), "utf8"), f.original);
  } finally { t.mock.restoreAll(); syncBuiltinESMExports(); await f.close(); }
});

test("the actual owned worker retains a partial file result and cannot spend on another model leg or claim a completed turn", { skip: process.platform !== "darwin", timeout: 20_000 }, async () => {
  const f = await setupFixture({ workerPath: fileURLToPath(new URL("./fixtures/file-tool-worker.ts", import.meta.url)) });
  try {
    await f.configure(); await f.send("generated write");
    const terminal = await f.terminal();
    assert.equal(terminal.status, "partial"); assert.equal(f.requests.length, 2);
    assert.equal(await readFile(join(f.project, "fixture.txt"), "utf8"), "generated replacement\n");
    const result = f.service.controller.events(0).find((event) => event.event_type === "tool.completed" && event.payload.call.name === "write_file");
    assert.ok(result?.event_type === "tool.completed"); assert.equal(result.payload.outcome, "partial"); assert.equal(result.payload.isError, true);
    assert.match(terminal.lastError ?? "", /side effects|cleanup/i);
    assert.ok(f.service.controller.snapshot().blockedProjects.includes(f.session().projectId));
    assert.equal(terminal.usage.length, 2);
    const budget = f.service.controller.platform.budgets.status(f.sessionId);
    assert.equal(budget.totals.calls, 2); assert.equal(budget.totals.reportedTokens, 84);
  } finally { await f.close(); }
});
