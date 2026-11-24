import test from "node:test";
import assert from "node:assert/strict";
import { stopGroup } from "../apps/service/src/supervisor.ts";
import * as pty from "node-pty";
import { runProgram } from "../apps/service/src/program.ts";
import { ciTime } from "./fixtures/time-scale.ts";

const generatedPid = 987654;
const signalError = (code: string) => Object.assign(new Error(`Generated ${code}`), { code });

test("completed macOS PTYs release their owned allocator descriptors across more than the default host capacity", {
  skip: process.platform !== "darwin", timeout: ciTime(60000),
}, async () => {
  const completed = async () => {
    const terminal = pty.spawn("/usr/bin/true", [], { cwd: process.cwd(),
      env: { PATH: "/usr/bin:/bin", HOME: process.cwd(), TERM: "dumb" } });
    const data = terminal.onData(() => {});
    const outcome = await new Promise<{ exitCode: number }>((resolve) => {
      const exit = terminal.onExit((value) => { data.dispose(); exit.dispose(); resolve(value); });
    });
    assert.equal(outcome.exitCode, 0);
  };
  const descriptors = async () => (await runProgram("/usr/sbin/lsof", ["-nP", "-a", "-p", String(process.pid), "-F", "n"], {
    cwd: process.cwd(), signal: AbortSignal.timeout(5000), timeoutMs: 5000, label: "Owned completed PTY descriptor accounting",
  })).split("\n").filter((line) => line === "n/dev/ptmx").length;
  await completed();
  const before = await descriptors();
  for (let index = 1; index <= 600; index++) {
    await completed();
    if (index % 20 === 0) assert.equal(await descriptors(), before, "Completed PTYs must not retain allocator handles or consume the shared host limit.");
  }
});

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
