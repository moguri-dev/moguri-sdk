import test from "node:test";
import assert from "node:assert/strict";
import { ownedRoleWorker } from "./fixtures/owned-role-worker.ts";
import { waitFor } from "./fixture.ts";
import { assistantMessage } from "../apps/service/src/worker-protocol.ts";

test("one actual root-less read-only worker performs three explicitly acknowledged tool-less roles without promoting earlier output", { timeout: 15_000 }, async () => {
  const f = await ownedRoleWorker();
  try {
    const terminal = await f.settled(); assert.equal(terminal.kind === "finished" && terminal.outcome, "completed");
    assert.equal(f.completions.length, 3); assert.equal(new Set(f.boundaries).size, 3);
    for (const [index, provider] of f.providers.entries()) {
      assert.equal(provider.requests.length, 1); assert.equal(provider.requests[0]?.tools, undefined);
      assert.equal(provider.requests[0]?.max_tokens ?? provider.requests[0]?.max_completion_tokens, 64);
      assert.match(JSON.stringify(provider.requests[0]?.messages), new RegExp(`GENERATED_HOST_CANONICAL_ROLE_${index}`));
      assert.equal(JSON.stringify(provider.requests[0]?.messages).includes("_RESULT_NOT_CONTEXT"), false);
      assert.equal(f.completions[index]?.usageReported, true); assert.equal(assistantMessage(f.completions[index]!.message).usage.totalTokens, 42);
    }
    assert.equal(f.requests.some((request) => request.kind === "approval" || request.kind === "process"), false);
  } finally { await f.close(); }
});

test("a retained but unacknowledged role cannot dispatch the next model until its exact completion is acknowledged", { timeout: 15_000 }, async () => {
  const f = await ownedRoleWorker({ holdAt: 0 });
  try {
    await waitFor(() => f.held); await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(f.providers[0]?.requests.length, 1); assert.equal(f.providers[1]?.requests.length, 0); assert.equal(f.boundaries.length, 1);
    f.release(); assert.equal((await f.settled()).kind, "finished"); assert.equal(f.providers[1]?.requests.length, 1);
  } finally { await f.close(); }
});

test("failed completion persistence halts the actual owned sequence without another request", { timeout: 15_000 }, async () => {
  const f = await ownedRoleWorker({ rejectAt: 0 });
  try {
    const terminal = await f.settled(); assert.equal(terminal.kind === "finished" && terminal.outcome, "partial");
    assert.equal(f.completions.length, 1); assert.equal(f.providers[1]?.requests.length, 0);
  } finally { await f.close(); }
});

test("candidate continuation requires actual acceptance and a root-less read-only owner rather than a bare continue flag", { timeout: 15_000 }, async () => {
  for (const options of [{ accepted: false }, { readOnly: false }, { root: "/generated-not-an-authorized-root" }, { phase: "solver" as const }, { phase: "router" as const, accepted: false }]) {
    const f = await ownedRoleWorker(options);
    try {
      const terminal = await f.settled(); assert.equal(terminal.kind === "finished" && terminal.outcome, "failed");
      assert.equal(f.providers[0]?.requests.length, 1); assert.equal(f.providers[1]?.requests.length, 0);
    } finally { await f.close(); }
  }
});

test("unreported, over-limit or tool-calling candidate output cannot continue even when a malformed host approves", { timeout: 15_000 }, async () => {
  for (const options of [{ first: { omitUsage: true } }, { first: { finishReason: "length" as const } }, { outputLimit: 8 }, { toolDraft: true }]) {
    const f = await ownedRoleWorker(options);
    try {
      const terminal = await f.settled(); assert.equal(terminal.kind === "finished" && terminal.outcome, "failed");
      assert.equal(f.providers[1]?.requests.length, 0); assert.equal(f.requests.some((request) => request.kind === "approval" || request.kind === "process"), false);
    } finally { await f.close(); }
  }
});

test("stop during an actual owned critic request acknowledges cancellation and never dispatches revision or reports complete success", { timeout: 15_000 }, async () => {
  const f = await ownedRoleWorker({ slowCritic: true });
  try {
    await waitFor(() => f.providers[1]!.requests.length === 1); f.worker.send({ kind: "stop" });
    const terminal = await f.settled(); assert.equal(terminal.kind === "finished" && terminal.outcome, "stopped");
    assert.equal(f.providers[2]?.requests.length, 0); assert.equal(f.requests.some((request) => request.kind === "ack"), true);
    assert.equal(f.completions.at(-1)?.usageReported, false);
  } finally { await f.close(); }
});

test("the existing 32-step bound covers explicitly continued candidate roles without another worker or infinite loop", { timeout: 15_000 }, async () => {
  const f = await ownedRoleWorker({ steps: 33 });
  try {
    const terminal = await f.settled(); assert.equal(terminal.kind === "finished" && terminal.outcome, "partial");
    assert.equal(f.boundaries.length, 32); assert.equal(f.completions.length, 32);
    assert.match(terminal.kind === "finished" ? terminal.diagnostic ?? "" : "", /32-step/);
  } finally { await f.close(); }
});

test("ordinary one-call generation still finishes without an explicit paid continuation", { timeout: 15_000 }, async () => {
  const f = await ownedRoleWorker({ steps: 1 });
  try {
    const terminal = await f.settled(); assert.equal(terminal.kind === "finished" && terminal.outcome, "completed");
    assert.equal(f.boundaries.length, 1); assert.equal(f.completions.length, 1); assert.equal(f.providers[1]?.requests.length, 0);
  } finally { await f.close(); }
});

test("a missing or explicitly rejected single-call acknowledgement cannot be reported as completed", { timeout: 15_000 }, async () => {
  for (const options of [{ accepted: false }, { unacknowledged: true }]) {
    const f = await ownedRoleWorker({ steps: 1, ...options });
    try {
      const terminal = await f.settled(); assert.equal(terminal.kind === "finished" && terminal.outcome, "failed");
      assert.equal(f.boundaries.length, 1); assert.equal(f.providers[1]?.requests.length, 0);
    } finally { await f.close(); }
  }
});

test("stop while a complete model result awaits acknowledgement cannot authorize another paid role", { timeout: 15_000 }, async () => {
  const f = await ownedRoleWorker({ holdAt: 0 });
  try {
    await waitFor(() => f.held); assert.equal(f.completions[0]?.usageReported, true);
    f.worker.send({ kind: "stop" }); await waitFor(() => f.requests.some((request) => request.kind === "ack")); f.release();
    const terminal = await f.settled(); assert.equal(terminal.kind === "finished" && terminal.outcome, "stopped");
    assert.equal(f.providers[1]?.requests.length, 0);
  } finally { await f.close(); }
});

test("losing control while an actual result awaits acknowledgement preserves a partial outcome and no next role", { timeout: 15_000 }, async () => {
  const f = await ownedRoleWorker({ holdAt: 0 });
  try {
    await waitFor(() => f.held); f.worker.send({ kind: "control-lost" });
    const terminal = await f.settled(); assert.equal(terminal.kind === "finished" && terminal.outcome, "partial");
    assert.equal(f.providers[1]?.requests.length, 0);
  } finally { await f.close(); }
});
