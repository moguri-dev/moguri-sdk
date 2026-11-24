import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { digest } from "../apps/service/src/store.ts";
import { remotePlanPrimitive } from "./fixtures/remote-plan-prototype.ts";
import { ciTime } from "./fixtures/time-scale.ts";

test("owned SSH plan primitive authorizes one exact write, retains its result before acknowledgement and makes no model call", { skip: process.platform !== "darwin", timeout: ciTime(20_000) }, async () => {
  const f = await remotePlanPrimitive();
  try {
    const result = await f.run();
    assert.ok(result.terminal);
    assert.equal(result.terminal.outcome, "completed");
    assert.equal(result.writes.length, 1);
    assert.equal(await readFile(join(f.workspace, "docs/plan.md"), "utf8"), f.text);
    assert.equal(await readFile(join(f.local, "docs/plan.md"), "utf8"), "Generated untouched Local plan.\n");
    assert.equal(result.writes[0]?.text, JSON.stringify({ path: "docs/plan.md", digest: digest(f.text), text: f.text, written: true }));
    assert.equal(result.modelRequests, 0);
    assert.ok(result.frames.every((frame) => f.store.events().some((event) => event.event_type === "execution.frame_recorded" && event.payload.sequence === frame.sequence && event.payload.digest === frame.digest)));
  } finally { await f.close(); }
});

test("owned SSH plan primitive rejects stale source and preserves the actual replacement without retry", { skip: process.platform !== "darwin", timeout: ciTime(20_000) }, async () => {
  const f = await remotePlanPrimitive();
  try {
    await writeFile(join(f.workspace, "docs/plan.md"), "Generated concurrent replacement.\n");
    const result = await f.run();
    assert.ok(result.terminal);
    assert.equal(result.terminal.outcome, "failed");
    assert.equal(await readFile(join(f.workspace, "docs/plan.md"), "utf8"), "Generated concurrent replacement.\n");
    assert.equal(result.writes[0]?.outcome, "failed");
    assert.match(result.writes[0]!.text, /changed since|conflict/i);
    assert.equal(result.modelRequests, 0);
  } finally { await f.close(); }
});

test("a stopped SSH plan primitive cannot mutate before exact user authorization", { skip: process.platform !== "darwin", timeout: ciTime(20_000) }, async () => {
  const f = await remotePlanPrimitive();
  try {
    const result = await f.run({ stopBeforeAuthorization: true });
    assert.ok(result.terminal);
    assert.equal(result.terminal.outcome, "stopped");
    assert.equal(await readFile(join(f.workspace, "docs/plan.md"), "utf8"), f.original);
    assert.equal(result.writes.length, 0);
    assert.equal(result.modelRequests, 0);
  } finally { await f.close(); }
});

test("stop after a written result remains partial and never claims rollback", { skip: process.platform !== "darwin", timeout: ciTime(20_000) }, async () => {
  const f = await remotePlanPrimitive();
  try {
    const result = await f.run({ stopAfterWrite: true });
    assert.ok(result.terminal);
    assert.equal(result.terminal.outcome, "partial");
    assert.equal(await readFile(join(f.workspace, "docs/plan.md"), "utf8"), f.text);
    assert.equal(result.writes[0]?.outcome, "completed");
    assert.match(result.terminal.diagnostic!, /written|effect|rollback/i);
  } finally { await f.close(); }
});

test("lost SSH result acknowledgement leaves an inspectable exact retained frame, not another write", { skip: process.platform !== "darwin", timeout: ciTime(20_000) }, async () => {
  const f = await remotePlanPrimitive();
  try {
    const result = await f.run({ loseResultAcknowledgement: true });
    assert.equal(await readFile(join(f.workspace, "docs/plan.md"), "utf8"), f.text);
    const inspection = await f.inspect(result.execution);
    assert.ok(inspection.frames.some((frame) => frame.sequence > inspection.status.acknowledged && frame.request.kind === "tool.complete" && frame.request.text.includes(digest(f.text))));
    assert.equal(inspection.status.status, "unconfirmed");
    assert.equal(inspection.status.cleanup, "owned-worker-stopped");
    assert.match(inspection.status.diagnostic!, /terminal result was not acknowledged|remain unconfirmed/);
    assert.equal(result.writes.length, 1);
    assert.equal(result.modelRequests, 0);
  } finally { await f.close(); }
});

test("the SSH mutation primitive cannot override a denied or read-only plan folder", { skip: process.platform !== "darwin", timeout: ciTime(20_000) }, async () => {
  const f = await remotePlanPrimitive();
  try {
    for (const folders of [{ denied: ["docs"], readOnly: [] }, { denied: [], readOnly: ["docs"] }]) {
      const result = await f.run({ folders });
      assert.ok(result.terminal);
      assert.equal(result.terminal.outcome, "failed");
      assert.equal(await readFile(join(f.workspace, "docs/plan.md"), "utf8"), f.original);
      assert.equal(result.writes.length, 0); assert.equal(result.modelRequests, 0);
    }
  } finally { await f.close(); }
});
