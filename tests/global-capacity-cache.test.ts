import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { EventInput } from "../packages/sdk/src/index.ts";
import { profileFixture } from "./fixtures/profiles.ts";

const hold = (profileId: string, id: string, tokens: number): EventInput => ({
  event_type: "budget.recorded", profile_id: profileId, payload: { entry: {
    id, sessionId: null, ownerSessionId: null, projectId: null, folderId: null, turnId: null,
    modelId: "generated-accounting-model", providerId: null, apiModelId: null, role: "unknown", env: "unknown",
    createdAt: new Date().toISOString(), imported: true, status: "reserved", inputEstimate: 10, outputLimit: tokens - 10,
    reservedTokens: tokens, reportedTokens: null, reservedUsdMicros: null, estimatedUsdMicros: null, rate: null,
    requestMs: 0, outcome: "unconfirmed", diagnostic: "Generated original unknown-capacity fixture.",
  } },
});

test("global capacity never caches a profile's uncommitted hold or reuses an aborted sequence for a different amount", async () => {
  const f = await profileFixture();
  try {
    const beta = await f.create("Generated capacity peer"), peer = await f.service.profiles.control(beta.profile.id);
    const catalog = await f.sdk.profiles.list();
    await f.sdk.profiles.globalBudget({ basis: "estimate", tokens: 100 }, catalog.catalog.globalBudget.revision, true);
    const capacity = () => f.service.profiles.hooks.globalBudget();
    assert.equal(capacity().chargedTokens, 0);
    const peerId = randomUUID();
    assert.throws(() => peer.store.commit([hold(beta.profile.id, peerId, 30)], undefined, undefined, () => {
      assert.equal(capacity().chargedTokens, 30);
      throw new Error("Generated peer transaction rollback.");
    }), /Generated peer transaction rollback/);
    assert.equal(capacity().chargedTokens, 0);
    peer.store.commit([hold(beta.profile.id, peerId, 45)]);
    assert.equal(capacity().chargedTokens, 45);
    assert.equal(capacity().chargedUsdMicros, null);
    const id = randomUUID();
    assert.throws(() => f.service.store.commit([hold("default", id, 20)], undefined, undefined, () => {
      assert.equal(capacity().chargedTokens, 65);
      throw new Error("Generated default transaction rollback.");
    }), /Generated default transaction rollback/);
    assert.equal(capacity().chargedTokens, 45);
    f.service.store.commit([hold("default", id, 40)]);
    assert.equal(capacity().chargedTokens, 85);
    const edited = capacity(); edited.limit = null; edited.chargedTokens = 0;
    assert.equal(capacity().limit?.tokens, 100); assert.equal(capacity().chargedTokens, 85);
    assert.equal(capacity().chargedUsdMicros, null);
    const changed = await f.sdk.profiles.list();
    await f.sdk.profiles.globalBudget({ basis: "estimate", tokens: 80 }, changed.catalog.globalBudget.revision, true);
    assert.equal(capacity().limit?.tokens, 80); assert.equal(capacity().chargedTokens, 85);
    assert.equal(capacity().chargedUsdMicros, null);
    assert.equal(f.providers.reduce((sum, provider) => sum + provider.requests.length, 0), 0);
  } finally { await f.close(); }
});
