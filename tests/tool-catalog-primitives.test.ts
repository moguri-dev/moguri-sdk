import test from "node:test";
import assert from "node:assert/strict";
import { tools } from "../apps/service/src/tools.ts";
import { catalogForModel, discoverTools, toolSchemaDigest } from "../apps/service/src/tool-catalog.ts";

test("discovery keeps a small typed bootstrap and loads only selected available schemas", () => {
  const bootstrap = catalogForModel(tools, []);
  assert.deepEqual(bootstrap.map((tool) => tool.name), ["discover_tools", "ask_user", "task_progress"]);
  const selected = catalogForModel(tools, ["read_file", "write_file", "read_file"]);
  assert.deepEqual(selected.map((tool) => tool.name), ["discover_tools", "ask_user", "task_progress", "read_file", "write_file"]);
  assert.deepEqual(selected.find((tool) => tool.name === "write_file")?.parameters, tools.find((tool) => tool.name === "write_file")?.parameters);
  assert.ok(Buffer.byteLength(JSON.stringify(bootstrap)) < Buffer.byteLength(JSON.stringify(tools)) / 2);
  assert.throws(() => catalogForModel(tools, ["not_authorized"]), { code: "tool_unavailable" });
});

test("catalogue search has exact-name recovery, bounded deterministic pages and schema digests", () => {
  const found = discoverTools(tools, "read_file");
  assert.equal(found.tools[0]?.name, "read_file");
  assert.equal(found.tools[0]?.schemaDigest, toolSchemaDigest(tools.find((tool) => tool.name === "read_file")!));
  assert.ok(found.tools.length <= 5);
  assert.deepEqual(discoverTools(tools, "read_file"), found);
  const first = discoverTools(tools, "");
  assert.equal(first.nextOffset, 5);
  const second = discoverTools(tools, "", first.nextOffset!);
  assert.equal(second.offset, 5);
  assert.equal(new Set([...first.tools, ...second.tools].map((tool) => tool.name)).size, 10);
  assert.equal(discoverTools(tools, "zznonexistentcapabilityzz").tools.length, 0);
  assert.ok(Buffer.byteLength(JSON.stringify(first)) <= 16 * 1024);
  assert.throws(() => discoverTools(tools, "", -1), { code: "tool_catalog" });
});
