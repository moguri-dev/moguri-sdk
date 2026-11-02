import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { chromium } from "playwright-core";
import { WebSocketServer } from "ws";
import sharp from "sharp";
import { arrayTool, ArrayCompareSchema, ArrayOrderSchema, MoguriSdk, parse } from "../packages/sdk/src/index.ts";
import { executeTool } from "../apps/service/src/tools.ts";
import { runOwnedPlaywright } from "../apps/service/src/playwright-data.ts";
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
    const changedQuery = { path: "b.ts", line: 2, column: 7, snapshotDigest: definition.snapshotDigest, offset: 1 };
    await assert.rejects(() => executeTool(f.project, { id: "generated-stale-query", name: "goto_definition", arguments: changedQuery },
      new AbortController().signal, () => {}, () => {}, undefined, { mode: "agent", env: "Local", folders: { denied: [], readOnly: [] } }), { code: "language_stale" });
    await assert.rejects(() => run("goto_definition", "missing.py", 1, 1), { code: "language_unsupported" });
    assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});

test("Playwright refuses app path aliases before launching or typing into another root", async () => {
  const f = await setupFixture(), temporary = `${f.directory}/generated-app-profile`;
  try {
    await mkdir(temporary, { mode: 0o700 });
    await writeFile(`${f.home}/outside-app.mjs`, "throw new Error('A generated outside app must not execute.');");
    await symlink(`${f.home}/outside-app.mjs`, `${f.project}/alias-app.mjs`);
    const executable = createRequire(import.meta.url)("electron");
    await assert.rejects(() => runOwnedPlaywright(f.project, { launch: { kind: "electron", executable, entry: "alias-app.mjs" },
      actions: [{ action: "take_screenshot" }] }, temporary), { code: "path_denied" });
    await assert.rejects(() => runOwnedPlaywright(f.project, { launch: { kind: "electron", executable, entry: `${f.home}/outside-app.mjs` },
      actions: [{ action: "take_screenshot" }] }, temporary), { code: "playwright_entry" });
    assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});

test("actual owned Chromium acknowledges interaction and blocks unapproved HTTP and WebSocket endpoints", { skip: process.platform !== "darwin" }, async () => {
  let forbiddenRequests = 0, forbiddenSockets = 0;
  const forbidden = createServer((_request, response) => { forbiddenRequests++; response.end("Generated blocked endpoint"); });
  const sockets = new WebSocketServer({ server: forbidden });
  sockets.on("connection", () => { forbiddenSockets++; });
  await new Promise<void>((resolve) => forbidden.listen(0, "127.0.0.1", resolve));
  const foreign = forbidden.address();
  if (!foreign || typeof foreign === "string") throw new Error("Generated forbidden endpoint missing.");
  const server = createServer((_request, response) => {
    response.setHeader("Content-Type", "text/html");
    response.end(`<label>Name<input id="name"></label><button id="go" onclick="document.querySelector('output').textContent='Hello '+document.querySelector('#name').value">Apply</button><output>Not applied</output>
      <script>fetch("http://127.0.0.1:${foreign.port}/blocked").catch(()=>{});new WebSocket("ws://127.0.0.1:${foreign.port}/blocked");</script>`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Generated approved endpoint missing.");
  const origin = `http://127.0.0.1:${address.port}`, f = await setupFixture(), temporary = `${f.directory}/generated-browser-profile`;
  try {
    await mkdir(temporary, { mode: 0o700 });
    const result = await runOwnedPlaywright(f.project, { launch: { kind: "chromium", executable: chromium.executablePath(), url: origin },
      actions: [{ action: "type", selector: "#name", text: "Generated Chromium visitor" }, { action: "click", selector: "#go" },
        { action: "wait", milliseconds: 150 }, { action: "snapshot" }, { action: "take_screenshot" }] }, temporary,
    { version: 1, unrestricted: false, origins: [origin], sites: [] });
    assert.equal(result.outcome, "completed", result.diagnostic ?? "The exact owned Chromium batch failed.");
    assert.equal(result.closedKnownTarget, true);
    assert.ok(result.observations.some((entry) => typeof entry === "object" && entry !== null && "text" in entry && String(entry.text).includes("Hello Generated Chromium visitor")));
    assert.equal(forbiddenRequests, 0); assert.equal(forbiddenSockets, 0);
    const screenshot = result.deliveries[0];
    assert.ok(screenshot?.kind === "image");
    const bytes = Buffer.from(screenshot.data, "base64");
    assert.equal(bytes.subarray(1, 4).toString(), "PNG");
    assert.ok((await sharp(bytes).metadata()).width! >= 1280);
    assert.equal(f.requests.length, 0);
  } finally {
    await f.close();
    sockets.close();
    for (const target of [server, forbidden]) {
      target.closeAllConnections();
      await new Promise<void>((resolve) => target.close(() => resolve()));
    }
  }
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
