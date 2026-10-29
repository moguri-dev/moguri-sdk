import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import test from "node:test";
import { isRecord } from "../packages/sdk/src/index.ts";
import { generatedSandboxDistribution } from "./fixtures/sandbox-distribution.ts";

test("failed current-artifact qualification retains explicit failed/skipped gates without contacting a release service or native runtime", {
  skip: process.platform === "win32",
}, async () => {
  const fixture = await generatedSandboxDistribution(), bin = join(fixture.directory, "bin");
  const marker = join(fixture.directory, "forbidden-execution.txt");
  let retained: string | undefined;
  try {
    await mkdir(bin, { mode: 0o700 });
    for (const command of ["container", "gh"]) await writeFile(join(bin, command),
      `#!/bin/sh\nprintf '%s\\n' '${command}' >> '${marker}'\nexit 70\n`, { mode: 0o700 });
    const workload = join(fixture.directory, "workload.json");
    await writeFile(workload, JSON.stringify({ status: "FAIL" }));
    const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/qualify-sandbox.mjs",
      "--distribution", fixture.directory, "--workload", workload, "--archive", join(fixture.directory, "not-a-release.tar.gz")], {
      cwd: process.cwd(), env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, encoding: "utf8", timeout: 20_000, maxBuffer: 128 * 1024,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 1, result.stderr);
    const receipt: unknown = JSON.parse(result.stdout);
    assert.ok(isRecord(receipt) && isRecord(receipt.gates));
    assert.equal(receipt.status, "FAIL");
    assert.equal(receipt.personalCredentials, false); assert.equal(receipt.paidInference, false);
    assert.equal(receipt.administratorDialogOpened, false); assert.equal(receipt.sourceCheckoutMounted, false);
    for (const [name, status] of Object.entries({ artifacts: "FAIL", installedRuntime: "SKIP", providerScope: "SKIP",
      coldNetwork: "SKIP", workerAccounting: "SKIP", teardown: "SKIP" })) {
      const observed: unknown = receipt.gates[name]; assert.ok(isRecord(observed)); assert.equal(observed.status, status);
    }
    assert.equal(typeof receipt.directory, "string");
    assert.ok(typeof receipt.directory === "string" && basename(receipt.directory).startsWith("current-sendbox-"));
    assert.equal(dirname(receipt.directory), await realpath(resolve(".native/qualification")));
    retained = receipt.directory;
    const saved: unknown = JSON.parse(await readFile(join(retained, "qualification.json"), "utf8"));
    assert.ok(isRecord(saved)); assert.equal(saved.status, "FAIL");
    await assert.rejects(() => readFile(marker), { code: "ENOENT" });
  } finally {
    if (retained) await rm(retained, { recursive: true, force: true });
    await fixture.close();
  }
});
