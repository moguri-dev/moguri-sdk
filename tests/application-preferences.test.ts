import assert from "node:assert/strict";
import test from "node:test";
import { GLOBAL_PROFILE_ID } from "../packages/sdk/src/index.ts";
import { profileFixture } from "./fixtures/profiles.ts";

test("application preferences have one revision-bound root owner across isolated profiles", async () => {
  const fixture = await profileFixture();
  try {
    const { client: beta } = await fixture.create("Generated application Beta");
    const initial = await fixture.sdk.application.status();
    assert.deepEqual(initial.configuration, { revision: 0, values: { menuBar: true, automaticUpdates: true } });
    const results = await Promise.allSettled([
      fixture.sdk.application.configure({ menuBar: false }, initial.configuration.revision),
      beta.application.configure({ automaticUpdates: false }, initial.configuration.revision),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.filter((result) => result.status === "rejected").length, 1);
    const actual = await fixture.sdk.application.status();
    assert.equal(actual.configuration.revision, 1);
    assert.deepEqual((await beta.application.status()).configuration, actual.configuration);
    assert.ok(fixture.service.store.view(GLOBAL_PROFILE_ID).events().some((event) => event.event_type === "application.configured"));
    assert.equal(Object.hasOwn(fixture.sdk.settings.get()!.values, "application"), false);
    assert.equal(Object.hasOwn(beta.settings.get()!.values, "application"), false);
    assert.ok(fixture.providers.every((provider) => provider.requests.length === 0));
  } finally { await fixture.close(); }
});
