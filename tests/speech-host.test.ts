import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";

test("the private speech host reaps only its exact child when its controller pipe closes", { timeout: 10_000 }, async () => {
  const host = spawn(process.execPath, [resolve("apps/service/src/speech-host.ts"), process.execPath, "-e",
    "console.log(process.pid); setInterval(()=>{},1000)"], { stdio: ["pipe", "pipe", "pipe"] });
  let output = "", pid: number | undefined;
  const exited = new Promise<number | null>((done) => host.once("close", done));
  host.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); });
  try {
    const deadline = Date.now() + 3000;
    while (!output.includes("\n") && host.exitCode === null && Date.now() < deadline) await new Promise((done) => setTimeout(done, 10));
    assert.match(output.trim(), /^\d+$/, "The owned host must launch its exact generated child.");
    pid = Number(output.trim()); host.stdin.end();
    assert.equal(await exited, 0);
    assert.throws(() => process.kill(pid!, 0), { code: "ESRCH" });
    pid = undefined;
  } finally {
    if (host.exitCode === null) host.kill("SIGTERM");
    if (pid) { try { process.kill(pid, "SIGKILL"); } catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error; } }
    await exited;
  }
});
