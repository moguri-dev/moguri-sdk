import assert from "node:assert/strict";
import { mkdtemp, readFile, readlink, realpath, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pinnedInstalledApplication, verifyBundleIdentity } from "../apps/service/src/bundle-tree.ts";
import { stageUpdateArchive } from "../apps/service/src/update-archive.ts";
import { generatedZip } from "./fixtures/documents.ts";
import { generatedApplication } from "./fixtures/updates.ts";

test("update extraction rejects traversal, collisions, links to outside bytes and symlink parents before writing application code", async () => {
  for (const entries of [
    [{ name: "Moguri.app/../generated-escape", text: "Generated outside bytes" }],
    [{ name: "Moguri.app/Contents/entry", text: "one" }, { name: "Moguri.app/Contents/ENTRY", text: "two" }],
    [{ name: "Moguri.app/Contents/Framework", text: "../../../generated-outside", mode: 0o120777 }],
    [{ name: "Moguri.app/Contents/Link", text: "Target", mode: 0o120777 }, { name: "Moguri.app/Contents/Link/entry", text: "Generated through link" }],
  ]) {
    const directory = await mkdtemp(join(tmpdir(), "moguri-generated-update-"));
    try {
      const archive = join(directory, "generated.zip"), bytes = generatedZip(entries); await writeFile(archive, bytes);
      await assert.rejects(() => stageUpdateArchive(archive, join(directory, "stage"), {
        schemaVersion: 1, repository: "mbianchidev/moguri", version: "0.31.0-alpha.1", arch: "arm64", bundleId: "dev.moguri.app",
        archive: { name: "Moguri-0.31.0-alpha.1-macos-arm64.zip", bytes: bytes.length, sha512: createHash("sha512").update(bytes).digest("hex") }, bundleSha512: "b".repeat(128),
      }, new AbortController().signal), /path|collis|link|escape|travers/i);
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
});

test("verified bundle staging preserves actual internal framework links without running downloaded code", { skip: process.platform !== "darwin" }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "moguri-generated-update-"));
  try {
    const generated = await generatedApplication(join(directory, "source")), archive = join(directory, "generated.zip"); await writeFile(archive, generated.archive);
    const root = await stageUpdateArchive(archive, join(directory, "staged"), generated.manifest, new AbortController().signal);
    assert.equal(await readlink(join(root, "Contents/Frameworks/Generated.framework/Versions/Current")), "A");
    assert.equal(await readFile(join(root, "Contents/Frameworks/Generated.framework/Generated"), "utf8"), "Generated framework bytes.");
    await assert.rejects(() => stageUpdateArchive(archive, join(directory, "wrong-digest"), { ...generated.manifest, archive: { ...generated.manifest.archive, sha512: "a".repeat(128) } }, new AbortController().signal), /SHA-512/i);
    const metadata = generatedZip([{ name: "__MACOSX/", mode: 0o040775 }, { name: "__MACOSX/._Moguri.app", text: "Generated AppleDouble metadata.", mode: 0o100664 },
      ...generated.files.map((file) => ({ ...file, name: `Moguri.app/${file.name}` }))]);
    const metadataPath = join(directory, "with-metadata.zip"); await writeFile(metadataPath, metadata);
    await stageUpdateArchive(metadataPath, join(directory, "metadata-stage"), { ...generated.manifest,
      archive: { ...generated.manifest.archive, bytes: metadata.length, sha512: createHash("sha512").update(metadata).digest("hex") } }, new AbortController().signal);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("bundle identity accepts the embedded and installed-SDK service layouts and pins the app's own version", { skip: process.platform !== "darwin" }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "moguri-generated-layout-"));
  try {
    const arch = process.arch === "x64" ? "x64" : "arm64";
    for (const layout of ["dist", "sdk"] as const) {
      const generated = await generatedApplication(join(directory, layout), "0.33.0-alpha.7", arch, layout);
      await verifyBundleIdentity(generated.root, "0.33.0-alpha.7", arch);
      assert.deepEqual(await pinnedInstalledApplication(join(generated.root, "Contents/Resources/app/node_modules/node/bin/node")),
        { root: await realpath(generated.root), version: "0.33.0-alpha.7" });
    }
    const partial = await generatedApplication(join(directory, "partial"), "0.33.0-alpha.7", arch, "partial");
    await assert.rejects(() => verifyBundleIdentity(partial.root, "0.33.0-alpha.7", arch), /missing an actual required runtime file/);
    await assert.rejects(() => verifyBundleIdentity(partial.root, "0.32.0-alpha.1", arch), /exact reviewed Moguri version/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
