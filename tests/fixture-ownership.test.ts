import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { access } from "node:fs/promises";
import test from "node:test";
import { forkOwnedFixture } from "./fixtures/owned-child.ts";
import { setupFixture, waitFor } from "./fixture.ts";
import { EventStore } from "../apps/service/src/store.ts";
import { ciTime } from "./fixtures/time-scale.ts";

const childPath = fileURLToPath(new URL("./fixtures/owned-child-events.ts", import.meta.url));

test("fixture settlement observes committed completion when its final poll wakes at the deadline", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1000 });
  let completed = false;
  setTimeout(() => { completed = true; }, 5);
  const pending = waitFor(() => completed ? "original completed outcome" : null, 10);
  t.mock.timers.tick(15);
  assert.equal(await pending, "original completed outcome");
});

test("fixture settlement rejects an unchanged pending state after its bounded final poll", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1000 });
  const rejected = assert.rejects(waitFor(() => false, 10), /condition did not settle before the deadline/);
  t.mock.timers.tick(15);
  await rejected;
});

test("an unresponsive owned bootstrap reaches its deadline, kills only its child and observes actual exit", { timeout: ciTime(10000) }, async (t) => {
  const owned = forkOwnedFixture(childPath); t.after(owned.stop);
  await assert.rejects(() => owned.ready({ mode: "held" }, { timeoutMs: 750 }), /did not become ready/);
  await owned.exited; assert.equal(owned.child.signalCode, "SIGKILL");
});

test("test cancellation aborts an owned readiness wait and cannot leave the original child alive", { timeout: ciTime(10000) }, async (t) => {
  const owned = forkOwnedFixture(childPath); t.after(owned.stop);
  await assert.rejects(() => owned.ready({ mode: "held" }, { signal: AbortSignal.timeout(750) }), /startup was cancelled/);
  await owned.exited; assert.equal(owned.child.signalCode, "SIGKILL");
});

test("early child exit rejects readiness immediately with its actual outcome rather than waiting for an absent IPC frame", { timeout: ciTime(10000) }, async (t) => {
  const owned = forkOwnedFixture(childPath); t.after(owned.stop);
  await assert.rejects(() => owned.ready({ mode: "early-exit" }), /before readiness \(17\)/);
  assert.equal(owned.child.exitCode, 17);
});

test("an explicit bootstrap failure retains its diagnostic and still drains the owned child", { timeout: ciTime(10000) }, async (t) => {
  const owned = forkOwnedFixture(childPath); t.after(owned.stop);
  await assert.rejects(() => owned.ready({ mode: "failure" }), /bootstrap failed after acquiring an owned handle/);
  await owned.exited; assert.equal(owned.child.signalCode, "SIGKILL");
});

test("stderr is continuously drained while only its bounded tail is retained", { timeout: ciTime(10000) }, async (t) => {
  const owned = forkOwnedFixture(childPath); t.after(owned.stop);
  assert.deepEqual(await owned.ready({ mode: "stderr" }), { kind: "ready" });
  assert.equal(owned.diagnostic.length, 8192);
});

test("real Local readiness remains platform-bound outside the explicit generated Node-primitives fixture", async () => {
  const real = await setupFixture({ nodePrimitives: false }), primitive = await setupFixture({ nodePrimitives: true });
  try {
    const realLocal = real.service.controller.snapshot().capabilities.find((capability) => capability.env === "Local")!;
    const generated = primitive.service.controller.snapshot().capabilities.find((capability) => capability.env === "Local")!;
    assert.equal(realLocal.ready, process.platform === "darwin");
    if (process.platform === "linux") {
      await assert.rejects(real.configure, { code: "env_unavailable" });
      assert.equal(generated.ready, true); assert.match(generated.reason, /Generated Node-primitives.*not Linux release/);
    }
    await primitive.configure();
    assert.equal(real.requests.length, 0); assert.equal(primitive.requests.length, 0);
    assert.equal(real.service.controller.snapshot().capabilities.find((capability) => capability.env === "Local")?.ready, realLocal.ready);
  } finally { try { await real.close(); } finally { await primitive.close(); } }
});

test("a failed generated project admission closes already-acquired service/provider handles and removes only its own fixture", async (t) => {
  const before = process.getActiveResourcesInfo().filter((kind) => kind === "TCPServerWrap").length;
  const commit = EventStore.prototype.commit;
  let directory: string | undefined;
  t.mock.method(EventStore.prototype, "commit", function(this: EventStore, ...args: Parameters<EventStore["commit"]>) {
    if (args[0].some((event) => event.event_type === "project.added")) {
      directory = dirname(dirname(this.path));
      throw new Error("Generated project admission failed after acquiring the provider and service.");
    }
    return commit.apply(this, args);
  });
  await assert.rejects(() => setupFixture(), /project admission failed after acquiring/);
  assert.ok(directory); assert.match(directory, /moguri-generated-/);
  await assert.rejects(() => access(directory!), { code: "ENOENT" });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(process.getActiveResourcesInfo().filter((kind) => kind === "TCPServerWrap").length, before);
});

test("a failed owned stop preserves the original bootstrap failure and cleanup failure instead of claiming successful teardown", { timeout: ciTime(10000) }, async (t) => {
  const owned = forkOwnedFixture(childPath);
  const kill = t.mock.method(owned.child, "kill", () => { throw new Error("Generated exact child stop failed."); });
  t.after(async () => { kill.mock.restore(); await owned.stop(); });
  await assert.rejects(() => owned.ready({ mode: "held" }, { timeoutMs: 750 }), (error: unknown) => {
    assert.ok(error instanceof AggregateError);
    assert.equal(error.errors.length, 2);
    assert.match(String(error.errors[0]), /did not become ready/);
    assert.match(String(error.errors[1]), /exact child stop failed/);
    return true;
  });
  assert.equal(owned.child.exitCode, null); assert.equal(owned.child.signalCode, null);
});
