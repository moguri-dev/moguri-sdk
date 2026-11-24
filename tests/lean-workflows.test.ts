import test from "node:test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MoguriSdk, isRecord, slashCommands } from "../packages/sdk/src/index.ts";
import { setupFixture } from "./fixture.ts";
import { ciTime } from "./fixtures/time-scale.ts";

test("the actual worker receives corrective argument feedback and completes a large README search", { timeout: ciTime(15_000) }, async () => {
  const f = await setupFixture({ respond: (request) => {
    const results = Array.isArray(request.messages) ? request.messages.filter((message) => isRecord(message) && message.role === "tool") : [];
    if (!results.length) return { tool: { name: "discover_tools", args: { query: "read_file" } } };
    if (results.length === 1) return { tool: { name: "read_file", args: { path: "README.md", search: "## Crates", limit: 32768 } } };
    const last = results.at(-1), content = isRecord(last) ? String(last.content) : "";
    if (results.length === 2 && /\/limit/.test(content) && /16384/.test(content))
      return { tool: { name: "read_file", args: { path: "README.md", mode: "full", search: "## Crates", limit: 512 } } };
    return { text: content.includes("Generated selected crate documentation") ? "Generated verified README search recovered." : "Generated corrective feedback or source is missing." };
  } });
  try {
    await writeFile(join(f.project, "README.md"), `${"Generated README source line.\n".repeat(6000)}## Crates\nGenerated selected crate documentation.\n`);
    await f.configure(); await f.send("Generated README search with corrective feedback."); await f.terminal();
    assert.equal(f.session().status, "completed"); assert.equal(f.session().pendingApproval, null);
    assert.equal(f.requests.length, 4); assert.ok(f.session().messages.some((message) => message.text === "Generated verified README search recovered."));
    const reads = f.service.controller.events(0).filter((event) => event.event_type === "tool.completed" && event.payload.call.name === "read_file");
    const completed = reads.find((event) => event.event_type === "tool.completed" && !event.payload.isError);
    assert.ok(completed, "The real worker must execute the corrected bounded search.");
    assert.equal(f.service.controller.events(0).some((event) => event.event_type === "tool.started" && event.payload.call.arguments.limit === 32768), false);
  } finally { await f.close(); }
});

test("lowercase shared workflows preserve an unrelated draft and retain the actual user command", { timeout: ciTime(15000) }, async () => {
  assert.ok(slashCommands.some((command) => command.name === "review"), "Shared review workflow is missing.");
  const f = await setupFixture({ responseMode: "text" });
  const sdk = await new MoguriSdk(f.service.connection).ready();
  try {
    await f.configure();
    await sdk.command({ type: "draft.save", sessionId: f.sessionId, expectedRevision: f.session().draft.revision, text: "Generated unrelated draft.", attachments: [] });
    const original = structuredClone(f.session().controls);
    await sdk.slash(f.sessionId, "/review Generated focused request.", "cli");
    await f.terminal();
    assert.equal(f.session().draft.text, "Generated unrelated draft.");
    assert.deepEqual(f.session().controls, original);
    assert.match(JSON.stringify(f.requests[0]?.messages), /Investigate and fix/);
    assert.match(JSON.stringify(f.requests[0]?.messages), /current changes/);
    assert.ok(f.session().messages.some((message) => message.role === "user" && message.text.startsWith("/review")));
    assert.equal(f.service.controller.snapshot().sessions.length, 1);
    for (const name of ["review", "security", "performance", "debug"]) assert.ok(slashCommands.some((command) => command.name === name));
  } finally { sdk.disconnect(); await f.close(); }
});
