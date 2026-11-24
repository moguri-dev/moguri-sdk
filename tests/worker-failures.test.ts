import assert from "node:assert/strict";
import test from "node:test";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { setupFixture } from "./fixture.ts";
import { ciTime } from "./fixtures/time-scale.ts";

test("a missing file is a Not Found tool failure, not an authorization denial", { skip: process.platform !== "darwin" }, async () => {
  const f = await setupFixture({ toolCall: { name: "read_file", args: { path: "generated-missing.txt" } } });
  const sdk = await new MoguriSdk(f.service.connection).ready();
  try {
    await f.configure(); await f.send("Generated missing file request."); await f.terminal();
    const completed = f.service.controller.events(0).find((event) => event.event_type === "tool.completed" && event.payload.call.name === "read_file");
    assert.ok(completed?.event_type === "tool.completed");
    assert.equal(completed.payload.outcome, "failed");
    assert.equal(completed.payload.errorCode, "not_found");
    assert.match(completed.payload.text, /Not Found.*generated-missing\.txt/i);
    assert.equal(completed.payload.text.includes(f.directory), false);
    const { activity } = await sdk.activity.list(f.sessionId);
    assert.equal(activity.entries.find((entry) => entry.toolName === "read_file")?.errorCode, "not_found");
    assert.equal(f.session().pendingApproval, null);
  } finally { sdk.disconnect(); await f.close(); }
});

for (const status of [401, 413, 429]) test(`provider ${status} retains its redacted actionable failure instead of a generic empty-response message`, { skip: process.platform !== "darwin" }, async () => {
  const detail = `Generated upstream ${status} failure`;
  const f = await setupFixture({ httpFailure: { status, message: `${detail} generated-test-only` }, responseMode: "text" });
  try {
    await f.configure(); await f.send("Generated provider diagnostic request.");
    assert.equal((await f.terminal()).status, "failed");
    const diagnostic = f.session().messages.filter((message) => message.role === "notice").map((message) => message.text).join("\n");
    assert.match(diagnostic, new RegExp(detail));
    assert.equal(diagnostic.includes("generated-test-only"), false);
    assert.match(diagnostic, /\[redacted\]/);
    assert.equal(diagnostic.includes("The provider request failed. Check the selected provider"), false);
    assert.equal(f.requests.length, 1, "Diagnostic reporting must not retry a paid request.");
  } finally { await f.close(); }
});

for (const reasoning of [false, true]) test(`an empty ${reasoning ? "reasoning-only" : "ordinary"} response cannot finish successfully`, { skip: process.platform !== "darwin" }, async () => {
  const f = await setupFixture({ responseMode: "text", replyText: "", reasoning, ...(reasoning ? { reasoningText: "Generated exposed reasoning without an answer." } : {}) });
  try {
    await f.configure(); await f.send("Generated empty model answer.");
    assert.equal((await f.terminal()).status, "failed");
    assert.match(f.session().messages.at(-1)!.text, /no (?:response )?text|empty response/i);
    assert.equal(f.requests.length, 1);
    assert.equal(f.session().pendingApproval, null);
    if (reasoning) assert.equal(f.session().messages.find((message) => message.role === "assistant")?.reasoning, "Generated exposed reasoning without an answer.");
    assert.equal(f.service.controller.snapshot().budgetEntries.length, 1);
  } finally { await f.close(); }
});

test("an ordinary turn keeps working past 32 model steps until the model answers (D72)", { skip: process.platform !== "darwin", timeout: ciTime(60_000) }, async () => {
  const steps = 40;
  const f = await setupFixture({ respond: (body) => {
    const results = Array.isArray(body.messages) ? body.messages.filter((message) => (message as { role?: string }).role === "tool").length : 0;
    return body.tools && results < steps ? { tool: { name: "read_file", args: { path: "generated-missing.txt" } } } : { text: "Generated answer after many steps." };
  } });
  try {
    await f.configure(); await f.send("Generated long investigation.");
    assert.equal((await f.terminal()).status, "completed");
    const events = f.service.controller.events(0);
    assert.equal(events.filter((event) => event.event_type === "tool.completed").length, steps);
    assert.ok(events.filter((event) => event.event_type === "model.started").length > 32);
    assert.equal(f.session().messages.some((message) => /step safety limit|continuation bound/.test(message.text)), false);
  } finally { await f.close(); }
});
