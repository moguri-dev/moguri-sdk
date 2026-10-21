import test from "node:test";
import assert from "node:assert/strict";
import { stopGroup } from "../apps/service/src/supervisor.ts";

const generatedPid = 987654;
const signalError = (code: string) => Object.assign(new Error(`Generated ${code}`), { code });

test("an inaccessible exiting PTY group is polled until absence is actually confirmed", async (t) => {
  let probes = 0;
  const signals: (string | number | undefined)[] = [];
  t.mock.method(process, "kill", (pid: number, signal?: NodeJS.Signals | number) => {
    assert.equal(pid, -generatedPid); signals.push(signal);
    if (signal === 0) throw signalError(++probes === 1 ? "EPERM" : "ESRCH");
    return true;
  });
  assert.equal(await stopGroup(generatedPid), true);
  assert.ok(probes >= 2);
  assert.equal(signals.includes("SIGKILL"), false);
});

test("persistent signal denial never becomes confirmed process cleanup", async (t) => {
  t.mock.method(process, "kill", (pid: number) => {
    assert.equal(pid, -generatedPid);
    throw signalError("EPERM");
  });
  assert.equal(await stopGroup(generatedPid), false);
});

test("group supervision rejects invalid ownership and preserves unexpected OS errors", async (t) => {
  const signal = t.mock.method(process, "kill", () => { throw signalError("EINVAL"); });
  await assert.rejects(() => stopGroup(0), /owned.*process group/i);
  assert.equal(signal.mock.callCount(), 0);
  await assert.rejects(() => stopGroup(generatedPid), /Generated EINVAL/);
});
