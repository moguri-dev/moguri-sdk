import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { MOGURI_RELEASE_REPOSITORIES } from "../packages/protocol/src/application-updates.ts";
import { assetNames, fileDigest, RELEASE_REPOSITORIES, releaseRepository, REPOSITORY, stageAssets, verifyAssets } from "../scripts/release/assets.mjs";

const version = "0.33.0-alpha.1", identity = { version, tag: `v${version}`, prerelease: true, commit: "a".repeat(40), tree: "b".repeat(40) };

async function generatedBuild(root: string) {
  const source = join(root, "build"), names = assetNames(version), zip = randomBytes(4096);
  await mkdir(source, { recursive: true });
  await writeFile(join(source, names.dmg), randomBytes(8192));
  await writeFile(join(source, names.zip), zip);
  await writeFile(join(source, names.manifest), JSON.stringify({ schemaVersion: 1, repository: REPOSITORY, version, arch: "arm64", bundleId: "dev.moguri.app",
    archive: { name: names.zip, bytes: zip.length, sha512: createHash("sha512").update(zip).digest("hex") }, bundleSha512: "c".repeat(128) }));
  return source;
}

test("staged release assets carry provenance and checksums that verify against GitHub digests", async () => {
  const root = await mkdtemp(join(tmpdir(), "moguri-release-assets-"));
  try {
    const dir = join(root, "assets");
    await stageAssets({ ...identity, source: await generatedBuild(root), out: dir });
    const names = assetNames(version);
    assert.deepEqual((await readdir(dir)).sort(), Object.values(names).sort());
    const digests: Record<string, string> = {};
    for (const name of Object.values(names)) digests[name] = `sha256:${await fileDigest(join(dir, name))}`;
    await verifyAssets({ ...identity, dir, digests });
    await assert.rejects(stageAssets({ ...identity, source: join(root, "build"), out: dir }), /must be empty/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("verification refuses extra, missing, altered or misattributed release assets", async () => {
  const root = await mkdtemp(join(tmpdir(), "moguri-release-assets-"));
  try {
    const staged = join(root, "staged"), names = assetNames(version);
    await stageAssets({ ...identity, source: await generatedBuild(root), out: staged });
    const variant = async (label: string, change: (dir: string) => Promise<void>) => {
      const dir = join(root, label); await cp(staged, dir, { recursive: true }); await change(dir); return dir;
    };
    const cases: [string, (dir: string) => Promise<void>, RegExp, Partial<typeof identity>?, Record<string, string>?][] = [
      ["extra", (dir) => writeFile(join(dir, "notes.txt"), "generated"), /must be exactly/],
      ["missing", (dir) => rm(join(dir, names.provenance)), /must be exactly/],
      ["altered", (dir) => writeFile(join(dir, names.dmg), randomBytes(8192)), /SHA256SUMS/],
      ["commit", async () => {}, /sourceCommit/, { commit: "d".repeat(40) }],
      ["prerelease", async () => {}, /prerelease/, { prerelease: false }],
      ["digest", async () => {}, /digest GitHub reports/, {}, { [names.dmg]: `sha256:${"0".repeat(64)}` }],
    ];
    for (const [label, change, expected, override, digests] of cases) {
      const dir = await variant(label, change);
      await assert.rejects(verifyAssets({ ...identity, ...override, dir, digests }), expected, label);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("release helpers publish to the repository release.sh verified and refuse any other", () => {
  assert.deepEqual([...RELEASE_REPOSITORIES], [...MOGURI_RELEASE_REPOSITORIES]);
  assert.equal(releaseRepository({}), "mbianchidev/moguri");
  assert.equal(releaseRepository({ MOGURI_RELEASE_REPOSITORY: "moguri-dev/moguri-desktop", GITHUB_REPOSITORY: "mbianchidev/moguri" }), "moguri-dev/moguri-desktop");
  assert.equal(releaseRepository({ GITHUB_REPOSITORY: "moguri-dev/moguri-desktop" }), "moguri-dev/moguri-desktop");
  assert.throws(() => releaseRepository({ GITHUB_REPOSITORY: "generated-owner/moguri-fork" }), /not a Moguri release repository/);
});
