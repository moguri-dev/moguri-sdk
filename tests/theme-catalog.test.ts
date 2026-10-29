import assert from "node:assert/strict";
import test from "node:test";
import { MoguriSdk, themePalettes } from "../packages/sdk/src/index.ts";
import { setupFixture } from "./fixture.ts";

test("shared theme slash commands preserve mode, custom colors and unrelated settings without inference", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const original = sdk.settings.get()!;
    await sdk.settings.update({ ...original.values, appearance: { theme: "light", palette: "ocean", custom: { dark: { text: "#fafafa" } } } }, original.revision);
    const listing = await sdk.slash(fixture.sessionId, "/theme", "cli");
    assert.equal(listing.kind, "text");
    if (listing.kind === "text") for (const palette of themePalettes) assert.ok(listing.text.includes(palette.id), palette.id);
    for (const client of ["tui", "desktop", "cli"] as const) {
      await sdk.slash(fixture.sessionId, "/theme light", client);
      await sdk.slash(fixture.sessionId, "/theme rose", client);
      assert.equal(sdk.settings.get()!.values.appearance.palette, "rose");
      assert.equal(sdk.settings.get()!.values.appearance.theme, "light");
      await sdk.slash(fixture.sessionId, "/theme crystal dark", client);
      assert.equal(sdk.settings.get()!.values.appearance.palette, "crystal");
      assert.equal(sdk.settings.get()!.values.appearance.theme, "dark");
      await sdk.slash(fixture.sessionId, "/theme system", client);
      assert.deepEqual(sdk.settings.get()!.values.appearance.custom, { dark: { text: "#fafafa" } });
    }
    const saved = sdk.settings.get()!;
    await assert.rejects(() => sdk.slash(fixture.sessionId, "/theme unknown", "tui"), /palette|theme/i);
    await assert.rejects(() => sdk.slash(fixture.sessionId, "/theme crystal surprise", "cli"), /theme/i);
    assert.deepEqual(sdk.settings.get(), saved);
    assert.deepEqual(saved.values.permissions, original.values.permissions);
    assert.equal(fixture.requests.length, 0);
    assert.equal(fixture.session().turnId, null);
  } finally { sdk.disconnect(); await fixture.close(); }
});
