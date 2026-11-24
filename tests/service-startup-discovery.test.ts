import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { startService } from "../apps/service/src/server.ts";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { setupFixture } from "./fixture.ts";
import { assertLatencyBudget } from "./fixtures/latency-budgets.ts";

test("original state recovery and chat admission do not wait for unrelated provider discovery", async (t) => {
  const f = await setupFixture();
  await f.service.close();
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const refresh = f.provider.refresh.bind(f.provider);
  f.provider.state = { status: "connecting", models: [], login: null, diagnostic: "Generated discovery is pending." };
  t.mock.method(f.provider, "refresh", async () => { entered.resolve(); await release.promise; await refresh(); });
  let service: Awaited<ReturnType<typeof startService>> | undefined, sdk: MoguriSdk | undefined;
  const began = performance.now(), starting = startService({ stateDir: join(f.directory, "state"), provider: f.provider, retentionKey: f.retentionKey });
  try {
    await entered.promise;
    const ready = await Promise.race([starting.then((value) => { service = value; return true; }), new Promise<false>((resolve) => setTimeout(() => resolve(false), 750))]);
    if (!ready) release.resolve();
    service ??= await starting;
    assert.equal(ready, true, "service publication was blocked on provider discovery instead of original state/ownership recovery");
    assertLatencyBudget("Generated service recovery", performance.now() - began, 1000);
    sdk = await new MoguriSdk(service.connection).ready();
    assert.equal(sdk.getState().snapshot?.provider.status, "connecting");
    assert.deepEqual(sdk.getState().snapshot?.provider.models.filter((model) => !model.synthetic), []);
    const created = await sdk.sessions.create(null, "Generated provider-independent chat");
    assert.ok(created.id);
    assert.equal(f.requests.length, 0, "chat creation must not authorize model inference");
    release.resolve();
  } finally { release.resolve(); await starting; sdk?.disconnect(); t.mock.restoreAll(); await service?.close(); await f.close(); }
});
