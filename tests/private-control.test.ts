import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";
import { PrivateControl } from "../apps/service/src/private-control.ts";

test("native TTY control encrypts credentials and binds exact owner, direction and monotonic delivery", () => {
  const key = randomBytes(32), id = randomUUID(), controller = new PrivateControl(id, key, "controller"), worker = new PrivateControl(id, key, "worker");
  const value = { kind: "parent", message: { kind: "reply", requestId: "generated", value: { apiKey: "generated-private-access" } } };
  const frame = controller.encode(value);
  assert.equal(JSON.stringify(frame).includes("generated-private-access"), false);
  assert.deepEqual(worker.decode(frame), value);
  assert.throws(() => worker.decode(frame), /cursor|sequence|replay/i);
  assert.throws(() => controller.decode(frame), /direction|identity/i);
  assert.throws(() => new PrivateControl(randomUUID(), key, "worker").decode(frame), /identity|owner/i);
  const corrupt = Buffer.from(frame.data, "base64"); corrupt[0] = corrupt[0]! ^ 1;
  assert.throws(() => new PrivateControl(id, key, "worker").decode({ ...frame, data: corrupt.toString("base64") }), /auth|decrypt|control/i);
  assert.throws(() => new PrivateControl(id, key, "worker").decode({ ...frame, sequence: 2 }), /cursor|sequence/i);
  assert.throws(() => new PrivateControl(id, key, "worker").decode(value), /identity|owner/i);
  const next = controller.encode({ kind: "parent", message: { kind: "stop" } });
  assert.throws(() => new PrivateControl(id, randomBytes(32), "worker").decode(frame), /auth|decrypt|control/i);
  assert.deepEqual(worker.decode(next), { kind: "parent", message: { kind: "stop" } });
  const reply = worker.encode({ kind: "status", value: "Generated actual result" });
  assert.deepEqual(controller.decode(reply), { kind: "status", value: "Generated actual result" });
});
