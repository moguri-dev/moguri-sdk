import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, readFile, realpath, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { isRecord } from "../packages/protocol/src/index.ts";
import { RemoteRuntime } from "../apps/service/src/remote.ts";
import { createSshTarget } from "./fixtures/ssh-target.ts";
import { generatedRemoteGithub } from "./fixtures/remote-github.ts";
import { waitFor } from "./fixture.ts";

test("actual pinned SSH repository reads use only the generated host account and transfer a bounded validated whitelist", { skip: process.platform !== "darwin", timeout: 30_000 }, async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "moguri-remote-gh-"))), start = performance.now();
  await mkdir(join(directory, "ssh")); await mkdir(join(directory, "root"));
  const ssh = await createSshTarget(join(directory, "ssh")), github = await generatedRemoteGithub(directory, ssh.target);
  const target = { ...github.target, command: [...github.target.command, "--repository-probe"] };
  const runtime = new RemoteRuntime(directory, () => target, resolve("dist/worker.mjs"));
  const request = async (repository = "https://github.com/generated/example") => {
    const connection = await runtime.connect(target, AbortSignal.timeout(12_000));
    try {
      return await new Promise<unknown>((resolve, reject) => {
        connection.wire.on("message", resolve); connection.wire.on("error", reject);
        connection.child.once("exit", () => reject(new Error("Generated probe ended before its reply")));
        connection.wire.send({ root: join(directory, "root"), repository });
      });
    } finally { connection.wire.end(); connection.child.kill("SIGTERM"); }
  };
  try {
    const result = await request();
    assert.ok(isRecord(result) && result.kind === "repository" && isRecord(result.repository));
    assert.equal(result.repository.visibility, "private");
    assert.equal(JSON.stringify(result).includes("GENERATED_PRIVATE_METADATA_SENTINEL"), false);
    assert.equal(JSON.stringify(result).includes("generated-private-credential"), false);
    const records = await github.records();
    assert.equal(records.length, 1); assert.equal(records[0]!.home, github.home); assert.equal(records[0]!.cwd, join(directory, "root"));
    assert.deepEqual(records[0]!.args, ["api", "--hostname", "github.com", "--method", "GET", "repos/generated/example"]);
    const denied = await request("https://generated-secret@github.com/generated/example");
    assert.ok(isRecord(denied) && denied.kind === "error"); assert.equal((await github.records()).length, 1);
    await github.configure("error"); const error = await request();
    assert.ok(isRecord(error) && error.kind === "error" && error.code === "repository_cli_failed");
    assert.equal(JSON.stringify(error).includes("GENERATED_GH_PRIVATE_DIAGNOSTIC"), false);
    await github.configure("malformed"); const malformed = await request();
    assert.ok(isRecord(malformed) && malformed.kind === "error" && malformed.code === "repository_cli_response");
    await github.configure("oversize"); const oversized = await request();
    assert.ok(isRecord(oversized) && oversized.kind === "error" && oversized.code === "program_partial");
    await rename(join(github.bin, "gh"), join(github.bin, "gh-disabled"));
    const missing = await request(); assert.ok(isRecord(missing) && missing.kind === "error" && missing.code === "repository_cli_unavailable");
    await rename(join(github.bin, "gh-disabled"), join(github.bin, "gh"));
    await github.configure("hold");
    const connection = await runtime.connect(target, AbortSignal.timeout(12_000));
    connection.wire.send({ root: join(directory, "root"), repository: "https://github.com/generated/example" });
    const pid = await waitFor(() => {
      try { return Number(readFileSync(github.ready, "utf8")); }
      catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") return false; throw error; }
    });
    assert.equal((await github.records()).length, 5); assert.equal(Number(await readFile(github.witness, "utf8")), pid);
    process.kill(pid, "SIGTERM"); await new Promise((resolve) => setTimeout(resolve, 50)); process.kill(pid, 0);
    connection.child.kill("SIGKILL"); connection.wire.end();
    await waitFor(() => { try { process.kill(pid, 0); return false; } catch (error) { return error instanceof Error && "code" in error && error.code === "ESRCH"; } }, 8000);
    console.log(JSON.stringify({ primitive: "remote-github-account-whitelist-cancel", ms: performance.now() - start, actualSsh: true, modelCalls: 0, personalCredentials: false }));
  } finally { await runtime.close(); await ssh.close(); await rm(directory, { recursive: true, force: true }); }
});
