import assert from "node:assert/strict";
import { test } from "node:test";
import { DraftEditor } from "../packages/client/src/draft.ts";
import { MoguriClient } from "../packages/client/src/index.ts";
import { setupFixture, waitFor } from "./fixture.ts";

test("shared draft editors preserve conflicting local text until the user explicitly resolves it", async () => {
  const fixture = await setupFixture();
  const a = new MoguriClient(fixture.service.connection);
  const b = new MoguriClient(fixture.service.connection);
  let first: DraftEditor | undefined;
  let second: DraftEditor | undefined;
  try {
    await Promise.all([a.connect(), b.connect()]);
    await waitFor(() => a.getState().status === "connected" && b.getState().status === "connected");
    first = new DraftEditor(a, fixture.sessionId, fixture.session().draft);
    second = new DraftEditor(b, fixture.sessionId, fixture.session().draft);
    second.edit("generated unsent second-client text");
    first.edit("generated saved first-client text");
    await first.flush();
    second.receive(fixture.session().draft);
    assert.equal(second.getState().conflict, true);
    assert.equal(second.getState().text, "generated unsent second-client text");
    assert.equal(fixture.session().draft.text, "generated saved first-client text");
    await second.keepMine();
    assert.equal(fixture.session().draft.text, "generated unsent second-client text");
    assert.equal(second.getState().dirty, false);
    first.receive(fixture.session().draft);
    assert.equal(first.getState().text, "generated unsent second-client text");
  } finally { first?.dispose(); second?.dispose(); a.disconnect(); b.disconnect(); await fixture.close(); }
});
