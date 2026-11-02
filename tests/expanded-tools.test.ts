import assert from "node:assert/strict";
import test from "node:test";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import sharp from "sharp";
import { arrayTool, ArrayCompareSchema, ArrayOrderSchema, MoguriSdk, parse } from "../packages/sdk/src/index.ts";
import { executeTool } from "../apps/service/src/tools.ts";
import { setupFixture } from "./fixture.ts";

test("typed array find/sort/compare is stable, exact and rejects mixed/missing values", () => {
  assert.deepEqual(arrayTool("order_desc", parse(ArrayOrderSchema, { items: [{ key: 2, name: "first" }, { key: 2, name: "second" }, { key: 1, name: "last" }], field: "key" })).originalIndices, [0, 1, 2]);
  assert.deepEqual(arrayTool("order_asc", parse(ArrayOrderSchema, { items: ["z", "a", "Z"] })).items, ["Z", "a", "z"]);
  assert.equal(arrayTool("find_bigger", parse(ArrayCompareSchema, { items: [1, 2, 3], threshold: 2 })).count, 1);
  assert.equal(arrayTool("find_smaller", parse(ArrayCompareSchema, { items: [1, 2, 3], threshold: 2 })).count, 1);
  assert.throws(() => arrayTool("order_asc", parse(ArrayOrderSchema, { items: [2, "1"] })), { code: "array_order" });
  assert.throws(() => arrayTool("order_asc", parse(ArrayOrderSchema, { items: [{ value: 2 }, {}], field: "value" })), { code: "array_field" });
  assert.throws(() => arrayTool("find_bigger", parse(ArrayCompareSchema, { items: [null], threshold: 0 })), { code: "array_compare" });
});

test("actual native compiler resolves definitions and aliases without matching unrelated text or shadowing", async () => {
  const f = await setupFixture();
  try {
    await writeFile(`${f.project}/a.ts`, "export function increase(value: number) { return value + 1; }\n");
    await writeFile(`${f.project}/b.ts`, 'import { increase as bump } from "./a";\nconst increase = "not a reference";\nbump(2);\n');
    await writeFile(`${f.project}/missing.py`, "value = 1\n");
    const run = (name: string, path: string, line: number, column: number) => executeTool(f.project, { id: `generated-${name}`, name, arguments: { path, line, column } },
      new AbortController().signal, () => {}, () => {}, undefined, { mode: "agent", env: "Local", folders: { denied: [], readOnly: [] } });
    const definition = JSON.parse((await run("goto_definition", "b.ts", 3, 1)).text);
    assert.equal(definition.symbol, "increase"); assert.equal(definition.locations[0].path, "a.ts");
    const references = JSON.parse((await run("find_references", "a.ts", 1, 17)).text);
    assert.equal(references.totalLocations, 4);
    assert.ok(references.locations.some((location: { path: string; line: number }) => location.path === "b.ts" && location.line === 3));
    assert.equal(references.locations.some((location: { path: string; line: number }) => location.path === "b.ts" && location.line === 2), false);
    assert.equal(JSON.parse((await run("goto_definition", "b.ts", 2, 7)).text).locations[0].path, "b.ts");
    await assert.rejects(() => run("goto_definition", "missing.py", 1, 1), { code: "language_unsupported" });
    assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});

test("HTML output retains exact user/tool provenance and encrypted complete source", async () => {
  const f = await setupFixture(), sdk = await new MoguriSdk(f.service.connection).ready();
  try {
    await sdk.sessions.autonomy(f.sessionId, "Autopilot");
    const html = '<button id="counter">0</button><script>document.querySelector("button").onclick=e=>e.target.textContent=Number(e.target.textContent)+1;</script>';
    const job = await sdk.jobs.wait((await sdk.chatOutputs.renderHtml(f.sessionId, "Generated counter", html)).id!);
    assert.equal(job.status, "completed");
    const output = f.session().messages.flatMap((message) => message.attachments ?? []).find((attachment) => attachment.kind === "html");
    assert.ok(output); assert.equal(output.source.kind, "user-tool-output");
    const read = await sdk.attachments.read(f.sessionId, output.id);
    assert.equal(read.content.kind, "html");
    if (read.content.kind === "html") assert.equal(read.content.html, html);
    assert.equal(f.requests.length, 0);
    assert.ok(f.service.store.db.prepare("SELECT count(*) AS count FROM blob_payloads WHERE digest=?").get(output.digest)?.count);
  } finally { sdk.disconnect(); await f.close(); }
});

test("real owned Playwright Electron actions produce actual retained screenshot bytes, not a desktop image or markup proxy", { skip: process.platform !== "darwin" }, async () => {
  const f = await setupFixture(), sdk = await new MoguriSdk(f.service.connection).ready();
  try {
    await writeFile(`${f.project}/generated-app.mjs`, await readFile(new URL("./fixtures/owned-playwright-app.mjs", import.meta.url), "utf8"));
    await sdk.sessions.autonomy(f.sessionId, "Autopilot");
    const created = await sdk.apps.run(f.sessionId, { launch: { kind: "electron", executable: createRequire(import.meta.url)("electron"), entry: "generated-app.mjs" },
      actions: [{ action: "type", selector: "#name", text: "Generated visitor" }, { action: "click", selector: "#go" },
        { action: "snapshot" }, { action: "take_screenshot", name: "Generated app screenshot" }] });
    const job = await sdk.jobs.wait(created.id!, { timeoutMs: 40000 });
    assert.equal(job.status, "completed", job.error ?? "The original owned app batch did not complete.");
    const output = f.session().messages.flatMap((message) => message.attachments ?? []).find((attachment) => attachment.kind === "image");
    assert.ok(output);
    const read = await sdk.attachments.read(f.sessionId, output.id);
    assert.equal(read.content.kind, "image");
    if (read.content.kind !== "image") assert.fail();
    const bytes = Buffer.from(read.content.data, "base64");
    assert.equal(bytes.subarray(1, 4).toString(), "PNG");
    const image = await sharp(bytes).metadata();
    assert.ok(image.width! > 200 && image.height! > 100);
    assert.equal(output.source.kind, "user-tool-output");
    const result = JSON.parse((await sdk.mcp.readResult(job.id, 0, 32768)).text);
    const metadata = JSON.parse(result.text);
    assert.equal(metadata.closedKnownTarget, true);
    assert.ok(metadata.observations.some((entry: { action: string; text?: string }) => entry.action === "snapshot" && entry.text?.includes("Hello Generated visitor")));
    assert.equal(f.requests.length, 0);
  } finally { sdk.disconnect(); await f.close(); }
});
