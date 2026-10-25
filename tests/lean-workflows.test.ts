import test from "node:test";
import assert from "node:assert/strict";
import { MoguriSdk, slashCommands } from "../packages/sdk/src/index.ts";
import { setupFixture } from "./fixture.ts";

test("lowercase shared workflows preserve an unrelated draft and retain the actual user command", { timeout: 15000 }, async () => {
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
