import assert from "node:assert/strict";
import { test } from "node:test";
import { executeSlash, MoguriSdk, resolveSessionReference, sessionReferences, sessionShortId } from "../packages/sdk/src/index.ts";
import { setupFixture } from "./fixture.ts";

test("short session IDs resolve only unique prefixes and prompt mentions keep full IDs exact", () => {
  const sessions = [{ id: "f85ac32b-1111-4111-8111-111111111111" }, { id: "f85ac32c-2222-4222-8222-222222222222" }, { id: "0621f228-3333-4333-8333-333333333333" }];
  assert.equal(sessionShortId(sessions[0]!.id), "f85ac32b");
  assert.deepEqual(resolveSessionReference(sessions, ":F85AC32B"), [sessions[0]]);
  assert.deepEqual(resolveSessionReference(sessions, sessions[2]!.id), [sessions[2]]);
  assert.equal(resolveSessionReference([...sessions, { id: "f85ac32b-9999-4999-8999-999999999999" }], ":f85ac32b").length, 2);
  for (const reference of [":f85ac3", "not-a-session", ":f85ac32x"]) assert.deepEqual(resolveSessionReference(sessions, reference), []);
  assert.deepEqual(sessionReferences(`Compare :f85ac32b, ${sessions[2]!.id} and commit 0621f228 or a:0621f228.`), [":f85ac32b", sessions[2]!.id]);
});

test("slash commands report and accept the short session ID without attaching an ambiguous match", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const source = (await sdk.sessions.create(fixture.session().projectId, "Generated short-ID source")).id!;
    const shown = await executeSlash(sdk, source, "/session-id", "tui");
    assert.equal(shown.kind, "text");
    assert.match(shown.kind === "text" ? shown.text : "", new RegExp(`"shortId": "${sessionShortId(source)}"[\\s\\S]*"mention": ":${sessionShortId(source)}"`));
    const preview = await executeSlash(sdk, fixture.sessionId, `/attach-session ${sessionShortId(source)}`, "tui");
    assert.match(preview.kind === "text" ? preview.text : "", new RegExp(`/attach-session [a-f0-9]{64} ${source}`));
    assert.equal(fixture.session().draft.attachments.length, 0);
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});
