import assert from "node:assert/strict";
import test from "node:test";
import { defaultSettings, MoguriSdk, normalizeSettings } from "../packages/sdk/src/index.ts";
import { setupFixture, waitFor } from "./fixture.ts";

test("legacy interaction settings default to confirming session detachment", () => {
  assert.equal(defaultSettings().interactions.confirmSessionDetach, true);
  assert.deepEqual(normalizeSettings({ interactions: { confirmSessionAttachments: false, confirmTerminalClose: false } }).interactions,
    { confirmSessionAttachments: false, confirmTerminalClose: false, confirmSessionDetach: true });
});

test("service detach acknowledgement is explicit, revision-bound and never substitutes a new owner", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const child = await sdk.sessions.spawn(fixture.sessionId, "agent", "Generated reviewed child");
    const before = sdk.getState().snapshot!.sessions.find((session) => session.id === child.id)!;
    await assert.rejects(() => sdk.sessions.organize(child.id!, { parentSessionId: null }), /confirm.*detach|detach.*confirm/i);
    assert.equal(sdk.getState().snapshot!.sessions.find((session) => session.id === child.id)?.parentSessionId, fixture.sessionId);
    await sdk.sessions.organize(child.id!, { unread: true });
    await assert.rejects(() => sdk.sessions.organize(child.id!, { parentSessionId: null }, before.revision, true), { code: "revision_conflict" });
    await sdk.sessions.organize(child.id!, { parentSessionId: null }, undefined, true);
    const after = sdk.getState().snapshot!.sessions.find((session) => session.id === child.id)!;
    assert.equal(after.parentSessionId ?? null, null);
    assert.deepEqual([after.projectId, after.workspaceId, after.controls.env, after.coordinationParentId, after.kind],
      [before.projectId, before.workspaceId, before.controls.env, before.coordinationParentId, before.kind]);
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("remembered detach preferences remain profile-owned and resetting restores review", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const child = await sdk.sessions.spawn(fixture.sessionId, "agent", "Generated remembered child");
    const settings = sdk.settings.get()!;
    await sdk.settings.update({ ...settings.values, interactions: { ...settings.values.interactions, confirmSessionDetach: false } }, settings.revision);
    await sdk.sessions.organize(child.id!, { parentSessionId: null });
    assert.equal(sdk.getState().snapshot!.sessions.find((session) => session.id === child.id)?.parentSessionId ?? null, null);
    await sdk.settings.reset("interactions", sdk.settings.get()!.revision);
    await sdk.sessions.organize(child.id!, { parentSessionId: fixture.sessionId });
    await assert.rejects(() => sdk.sessions.organize(child.id!, { parentSessionId: null }), /confirm.*detach|detach.*confirm/i);
    assert.equal(sdk.settings.get()!.values.interactions.confirmSessionDetach, true);
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("global terminal slash creation is retired without creating a console or hidden session", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    for (const client of ["desktop", "tui"] as const) {
      await assert.rejects(() => sdk.slash(fixture.sessionId, "/terminal global", client), /removed|session terminal/i);
      await assert.rejects(() => sdk.slash(fixture.sessionId, "/terminals global", client), /removed|session terminal/i);
    }
    assert.equal(sdk.getState().snapshot!.terminals.length, 0);
    assert.equal(sdk.getState().snapshot!.sessions.length, 1);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("detach acknowledgement and opt-out cannot bypass active owned work", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const parent = await sdk.sessions.create(fixture.session().projectId, "Generated active-work parent");
    await sdk.sessions.organize(fixture.sessionId, { parentSessionId: parent.id! });
    const settings = sdk.settings.get()!;
    await sdk.settings.update({ ...settings.values, interactions: { ...settings.values.interactions, confirmSessionDetach: false } }, settings.revision);
    await fixture.configure(); await fixture.send("generated slow detach work");
    await waitFor(() => fixture.requests.length === 1);
    await assert.rejects(() => sdk.sessions.organize(fixture.sessionId, { parentSessionId: null }, fixture.session().revision, true), { code: "session_busy" });
    assert.equal(fixture.session().parentSessionId, parent.id);
    await sdk.command({ type: "session.stop", sessionId: fixture.sessionId });
    await fixture.terminal(); await sdk.refresh();
    await sdk.sessions.organize(fixture.sessionId, { parentSessionId: null });
    assert.equal(fixture.session().parentSessionId, undefined);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("neither detach confirmation nor a saved opt-out can promote model-owned subagents", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture({ responseMode: "text" }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.configure(); await sdk.refresh();
    const settings = sdk.settings.get()!;
    await sdk.settings.update({ ...settings.values, subagents: { ...settings.values.subagents, enabled: true },
      interactions: { ...settings.values.interactions, confirmSessionDetach: false } }, settings.revision);
    const created = await sdk.subagents.run(fixture.sessionId, "Generated bounded ownership check.");
    const child = await waitFor(() => fixture.service.controller.snapshot().sessions.find((session) => session.id === created.id && session.status === "completed"));
    assert.equal(child.kind, "subagent");
    await assert.rejects(() => sdk.sessions.organize(child.id, { parentSessionId: null }, child.revision, true), { code: "session_busy" });
    assert.equal(fixture.service.controller.snapshot().sessions.find((session) => session.id === child.id)?.parentSessionId, fixture.sessionId);
    assert.equal(fixture.requests.length, 1);
  } finally { sdk.disconnect(); await fixture.close(); }
});
