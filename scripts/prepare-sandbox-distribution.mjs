import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { SENDBOX_024 as pinnedRelease, sandboxDistributionCacheKey, sandboxFileHash, extractSandboxRelease, inspectSandboxRelease, buildSandboxInstaller, readSandboxDistribution } from "../dist/sandbox-tools.mjs";
import { PROTOCOL_VERSION } from "../dist/sdk/index.mjs";
import { cacheRuntimeFiles } from "./build-cache.mjs";

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const inputs = ["package.json", "package-lock.json", "dist/worker.mjs", "dist/remote-bridge.mjs", "dist/mcp-worker.mjs", "dist/data-worker.mjs", ...cacheRuntimeFiles, "scripts/worker-image/Containerfile"];
const hashes = {};
for (const path of inputs) hashes[path] = sha(await readFile(path));
const payloadDigest = sha(JSON.stringify(hashes));
const cacheKey = sandboxDistributionCacheKey(payloadDigest, pinnedRelease);
const archiveName = `sendbox-${pinnedRelease.version}-macos-arm64.tar.gz`, archiveBytes = 16_582_697;
const root = resolve(".native/sandbox-distribution"); await mkdir(root, { recursive: true, mode: 0o700 });
const pointer = join(root, "current.json");

async function fetchPinnedArchive(path) {
  let url = `https://github.com/${pinnedRelease.repository}/releases/download/v${pinnedRelease.version}/${archiveName}`;
  for (let index = 0; index < 4; index++) {
    const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(120_000) });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("Location"); await response.body?.cancel();
      if (!location) throw new Error("The pinned public release redirect is missing.");
      const next = new URL(location, url);
      if (next.protocol !== "https:" || next.username || next.password || next.port ||
        !["release-assets.githubusercontent.com", "objects.githubusercontent.com"].includes(next.hostname)) throw new Error("Pinned release left the qualified GitHub HTTPS asset hosts.");
      url = next.href; continue;
    }
    if (!response.ok || !response.body) throw new Error(`Pinned public SendBox archive returned HTTP ${response.status}.`);
    const chunks = []; let bytes = 0;
    for await (const chunk of response.body) { bytes += chunk.length; if (bytes > archiveBytes) throw new Error("Pinned release exceeded its exact public byte count."); chunks.push(chunk); }
    if (bytes !== archiveBytes) throw new Error("Pinned release ended before its exact public byte count.");
    await writeFile(path, Buffer.concat(chunks), { flag: "wx", mode: 0o600 }); return;
  }
  throw new Error("Pinned release exceeded its redirect bound.");
}
export async function prepareSandboxDistribution() {
  if (process.platform !== "darwin" || process.arch !== "arm64") throw new Error("The bundled native distribution is qualified for macOS arm64 only.");
  let cached;
  try { cached = JSON.parse(await readFile(pointer, "utf8")); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  if (cached?.cacheKey === cacheKey && cached.payloadDigest === payloadDigest && cached.protocol === PROTOCOL_VERSION) {
    const verified = await readSandboxDistribution(cached.directory, AbortSignal.timeout(30_000));
    assert.equal(verified.distribution.worker.payloadDigest, payloadDigest);
    const { installer, ...vendor } = verified.distribution.vendor;
    assert.deepEqual(vendor, pinnedRelease, "Cached vendor identity differs from the pinned reviewed release.");
    return verified;
  }
  const directory = await realpath(await mkdtemp(join(root, "build-"))), imageReceipt = join(directory, "image.json");
  execFileSync(process.execPath, ["scripts/prepare-worker-image.mjs", "--build", "--receipt", imageReceipt], { stdio: "inherit", timeout: 10 * 60_000 });
  const image = JSON.parse(await readFile(imageReceipt, "utf8"));
  assert.equal(image.status, "PASS"); assert.equal(image.payload.protocol, PROTOCOL_VERSION);
  for (const path of inputs.filter((path) => path !== "scripts/worker-image/Containerfile")) assert.equal(image.payload.files[path], hashes[path]);
  const vendorCache = resolve(".native/sendbox-distribution", pinnedRelease.version); await mkdir(vendorCache, { recursive: true, mode: 0o700 });
  const archive = join(vendorCache, archiveName);
  try { await stat(archive); }
  catch (error) { if (error.code !== "ENOENT") throw error; await fetchPinnedArchive(archive); }
  assert.equal(await sandboxFileHash(archive, "sha256"), pinnedRelease.archiveSha256);
  const signal = AbortSignal.timeout(5 * 60_000);
  const runtime = await extractSandboxRelease(archive, join(directory, "vendor"), pinnedRelease.version, pinnedRelease.archiveSha256, signal);
  const vendor = await inspectSandboxRelease(runtime, pinnedRelease.version, pinnedRelease.keySha256, pinnedRelease.archiveSha256, signal);
  assert.deepEqual(vendor, pinnedRelease, "The bundled vendor identity differs from the pinned reviewed release.");
  const installerName = `sendbox-${pinnedRelease.version}.pkg`, installer = join(directory, installerName);
  await buildSandboxInstaller(runtime, pinnedRelease.version, installer, signal);
  const imageArchive = join(directory, "worker.oci.tar");
  execFileSync("container", ["image", "save", "--output", imageArchive, image.image], { stdio: "inherit", timeout: 180_000 });
  const distribution = {
    format: "moguri-sandbox-distribution", version: 1, protocol: PROTOCOL_VERSION, nodeVersion: "26.12.0",
    vendor: { ...vendor, installer: { path: installerName, bytes: (await stat(installer)).size, sha512: await sandboxFileHash(installer, "sha512", signal) } },
    worker: { image: image.image, workerDigest: image.payload.files["dist/worker.mjs"], bridgeDigest: image.payload.files["dist/remote-bridge.mjs"],
      mcpWorkerDigest: image.payload.files["dist/mcp-worker.mjs"], payloadDigest,
      archive: { path: "worker.oci.tar", bytes: (await stat(imageArchive)).size, sha512: await sandboxFileHash(imageArchive, "sha512", signal) } },
  };
  await copyFile(join(runtime, "LICENSE"), join(directory, "SendBox.LICENSE"));
  await writeFile(join(directory, "manifest.json"), JSON.stringify(distribution, null, 2), { flag: "wx", mode: 0o600 });
  const verified = await readSandboxDistribution(directory, signal);
  await writeFile(pointer, JSON.stringify({ directory, payloadDigest, protocol: PROTOCOL_VERSION, cacheKey }), { mode: 0o600 });
  return verified;
}
if (import.meta.main) {
  const verified = await prepareSandboxDistribution();
  console.log(JSON.stringify({ status: "PASS", directory: verified.root, digest: verified.digest, distribution: verified.distribution,
    qualification: "Pinned producer bytes and no-script installer only; runtime admission, administrator approval and actual VM qualification remain separate." }, null, 2));
}
