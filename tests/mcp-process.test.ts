import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runMcpConnector } from "../apps/service/src/mcp-process.ts";
import type { McpOperation } from "../apps/service/src/mcp-worker.ts";

for (const mode of ["already-aborted", "owner-publication-failed", "stopped-before-dispatch"] as const) {
  test(`owned MCP process ${mode} cannot dispatch a connector or leave its exact child running`, async () => {
    const root = await mkdtemp(join(tmpdir(), "moguri-mcp-process-")), marker = join(root, "connector-started"), abort = new AbortController();
    let pid: number | undefined;
    try {
      const operation: McpOperation = { action: "tools", root, server: { id: "generated-process-proof", name: "Generated MCP process proof", enabled: true,
        transport: { type: "stdio", command: process.execPath, args: [resolve("tests/fixtures/mcp-echo.mjs"), "--started-marker", marker] } } };
      if (mode === "already-aborted") abort.abort();
      await assert.rejects(() => runMcpConnector(operation, resolve("apps/service/src/mcp-worker.ts"), abort.signal, (owned) => {
        pid = owned;
        if (mode === "owner-publication-failed") throw new Error("Generated process publication failed.");
        abort.abort();
      }), mode === "already-aborted" ? { name: "AbortError" } : { code: mode === "owner-publication-failed" ? "mcp_process_observer" : "mcp_cancelled" });
      assert.equal(existsSync(marker), false);
      if (mode === "already-aborted") assert.equal(pid, undefined);
      else { const owned = pid; assert.ok(owned); assert.throws(() => process.kill(owned, 0), { code: "ESRCH" }); }
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}
