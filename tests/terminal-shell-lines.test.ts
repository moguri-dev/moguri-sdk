import { ciTime } from "./fixtures/time-scale.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { realpath } from "node:fs/promises";
import { basename } from "node:path";
import { MoguriSdk, parseAttachmentTrigger, parseShellCommand } from "../packages/sdk/src/index.ts";
import { setupFixture } from "./fixture.ts";

const native = { skip: process.platform !== "darwin", timeout: ciTime(30_000) };
const shell = { platform: { terminal: { executable: "/bin/sh", args: ["-c", "printf 'GENERATED_TERMINAL_READY\\n'; exec /bin/sh"] } } };
async function output(sdk: MoguriSdk, id: string, marker: string) {
  for (let index = 0; index < 300; index++) {
    const result = await sdk.terminal.read(id);
    if (result.data.includes(marker)) return result.data;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`The user console never printed ${marker}.`);
}

test("a leading ! is a shell line, not a session attachment trigger", () => {
  assert.equal(parseShellCommand("!gh auth login --web"), "gh auth login --web");
  assert.equal(parseShellCommand("  !not a shell line"), null);
  assert.equal(parseShellCommand("/help"), null);
  assert.equal(parseAttachmentTrigger("!abc"), null);
  assert.equal(parseAttachmentTrigger("!git log :abc"), null, "no context trigger inside a shell line");
  assert.equal(parseAttachmentTrigger("compare with !abc"), null, "! no longer attaches a session");
  assert.equal(parseAttachmentTrigger("compare with :abc")?.prefix, ":");
});

test("!command runs in the chat's project console without a message, queue item, model call or recorded input", native, async () => {
  const fixture = await setupFixture(shell), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.configure();
    const before = fixture.session();
    const first = await sdk.terminal.run(fixture.sessionId, "printf 'GENERATED_SHELL_%s\\n' \"$(basename \"$PWD\")\"");
    assert.equal(first.opened, true);
    assert.equal(first.root, await realpath(fixture.project));
    await output(sdk, first.terminalId, `GENERATED_SHELL_${basename(fixture.project)}`);
    const second = await sdk.terminal.run(fixture.sessionId, "printf 'GENERATED_SECOND_LINE\\n'");
    assert.equal(second.terminalId, first.terminalId); assert.equal(second.opened, false);
    await output(sdk, first.terminalId, "GENERATED_SECOND_LINE");
    const after = fixture.session();
    assert.equal(after.messages.length, before.messages.length); assert.equal(after.queue.length, 0); assert.equal(after.turnId, null);
    assert.equal(fixture.requests.length, 0);
    const history = JSON.stringify(fixture.service.controller.events(0));
    assert.equal(history.includes("GENERATED_SECOND_LINE"), false, "terminal input is never persisted");
    assert.equal(fixture.service.controller.events(0).some((event) => ["message.sent", "queue.enqueued", "turn.started", "steer.applied"].includes(event.event_type)), false);
    await assert.rejects(() => sdk.terminal.run(fixture.sessionId, "  "), /Type a command after !/);
    await assert.rejects(() => sdk.terminal.run(fixture.sessionId, "printf one\nprintf two"), /one line at a time/);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("!command in a project-free chat runs in its captured Home console", native, async () => {
  const fixture = await setupFixture(shell), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const created = await sdk.sessions.create(null, "Generated project-free shell line");
    const ran = await sdk.terminal.run(created.id!, "printf 'GENERATED_%s_%s\\n' HOME \"$(basename \"$PWD\")\"");
    assert.equal(ran.root, await realpath(fixture.home));
    await output(sdk, ran.terminalId, `GENERATED_HOME_${basename(fixture.home)}`);
    assert.equal(sdk.getState().snapshot!.sessions.find((session) => session.id === created.id)?.messages.length, 0);
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});
