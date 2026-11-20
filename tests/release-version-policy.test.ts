import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { checkRelease, gapWarnings, normalizeVersion, VersionPolicyError } from "../scripts/release/version-policy.mjs";

const cli = resolve("scripts/release/version-policy.mjs");

test("release versions accept one lowercase v prefix and strict SemVer prereleases, rejecting ambiguous input", () => {
  for (const [input, version, prerelease] of [["v1.0.0", "1.0.0", false], ["2.1.3", "2.1.3", false], ["0.0.3-alpha", "0.0.3-alpha", true],
    ["0.1.0-beta", "0.1.0-beta", true], ["v1.2.4-rc", "1.2.4-rc", true], ["1.2.4-rc.2", "1.2.4-rc.2", true], ["1.0.0-0a.1", "1.0.0-0a.1", true]] as const) {
    assert.deepEqual(normalizeVersion(input), { version, tag: `v${version}`, prerelease }, input);
  }
  for (const input of ["V1.0.0", "vv1.0.0", "=1.0.0", "1.0", "1", "01.0.0", "1.00.0", "1.0.0-rc.01", "1.0.0-", "1.0.0-rc..1", " 1.0.0", "1.0.0 ",
    "1.0.0-rc_1", "1.0.0-é", "1.0.0\n", ""]) {
    assert.throws(() => normalizeVersion(input), VersionPolicyError, JSON.stringify(input));
  }
  assert.throws(() => normalizeVersion("1.2.4-rc.2+build.007"), /build metadata/);
});

test("skipped versions warn only for the first changed component or a same-channel prerelease counter", () => {
  assert.equal(gapWarnings("0.1.0", "0.3.0").length, 1);
  assert.match(gapWarnings("0.1.0", "0.3.0")[0]!, /skips minor/);
  assert.deepEqual(gapWarnings("0.1.0", "1.0.0"), []);
  assert.deepEqual(gapWarnings("0.1.9", "0.2.0"), []);
  assert.match(gapWarnings("1.0.0", "1.0.3")[0]!, /skips patch/);
  assert.match(gapWarnings("1.0.0-rc.1", "1.0.0-rc.3")[0]!, /skips prerelease rc/);
  assert.deepEqual(gapWarnings("1.0.0-rc.1", "1.0.0-rc.2"), []);
  assert.deepEqual(gapWarnings("0.32.0-alpha.1", "0.32.0-beta.3"), []);
  assert.deepEqual(gapWarnings("1.0.0-rc.1", "1.0.0"), []);
});

test("published releases set the baseline, reject backwards versions and treat v-prefixed equals as the same release", async () => {
  assert.throws(() => checkRelease("1.0.0", { published: ["v1.0.0"] }), (error: VersionPolicyError) => error.code === 3);
  assert.throws(() => checkRelease("0.9.0", { published: ["1.0.0", "0.8.0"] }), (error: VersionPolicyError) => error.code === 2 && /backwards/.test(error.message));
  assert.deepEqual(checkRelease("1.2.0", { published: ["1.0.0", "1.1.0-rc.1", "v0.9.0"] }).warnings, []);
  assert.equal(checkRelease("1.2.0", { published: ["1.0.0"] }).previous, "1.0.0");
  const first = checkRelease("0.34.0", { current: "0.32.0-alpha.1" });
  assert.equal(first.firstRelease, true);
  assert.match(first.warnings[0]!, /skips minor versions after 0\.32\.0-alpha\.1/);

  const run = promisify(execFile);
  const checked = await run(process.execPath, [cli, "check", "v0.33.0", "--published", "0.32.0", "--current", "0.32.0"]);
  assert.equal(checked.stdout, "0.33.0\tv0.33.0\tfalse\t0.32.0\t0.32.0\n");
  await assert.rejects(run(process.execPath, [cli, "check", "0.32.0", "--published", "v0.32.0"]), (error: { code: number; stderr: string }) => error.code === 3 && /already a published release/.test(error.stderr));
  await assert.rejects(run(process.execPath, [cli, "normalize", "1.0"]), (error: { code: number }) => error.code === 2);
});
