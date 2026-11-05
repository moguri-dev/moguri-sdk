import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";

export const APPLE_INIT = Object.freeze({
  reference: "ghcr.io/apple/containerization/vminit:0.26.3",
  repository: "apple/containerization/vminit",
  indexDigest: "sha256:5160897d2af14d8a510beb740df16c2264f6319b3e028f092f50fa6f8f5aa21f",
  licenseUrl: "https://raw.githubusercontent.com/apple/containerization/0.26.3/LICENSE",
  licenseSha256: "58d1e17ffe5109a7ae296caafcadfdbe6a7d176f0bc4ab01e12a689b0499d8bd",
});
const chunkBytes = 512 * 1024, maximumBytes = 256 * 1024 * 1024;
const digest = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
async function bytes(response, maximum) {
  if (!response.body) throw new Error("The pinned runtime prerequisite returned no body.");
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > maximum) throw new Error("The pinned runtime prerequisite exceeded its byte bound.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
async function regular(path) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.mode & 0o022 || info.size > maximumBytes || await realpath(path) !== path) throw new Error("The public prerequisite cache is not a bounded canonical private regular file.");
  return readFile(path);
}
/** @param {{ directory: string, cacheDirectory?: string, fetch?: typeof globalThis.fetch, pin?: { reference: string, repository: string, indexDigest: string, licenseUrl: string, licenseSha256: string } }} options */
export async function prepareAppleInitArchive({ directory, cacheDirectory = ".native/apple-init", fetch: request = fetch, pin = APPLE_INIT } = {}) {
  if (!directory) throw new Error("The pinned init archive needs its exact output directory.");
  assert.match(pin.repository, /^apple\/containerization\/vminit$/);
  assert.match(pin.reference, /^ghcr\.io\/apple\/containerization\/vminit:\d+\.\d+\.\d+$/);
  assert.match(pin.indexDigest, /^sha256:[a-f0-9]{64}$/); assert.match(pin.licenseSha256, /^[a-f0-9]{64}$/);
  const output = resolve(directory), cache = resolve(cacheDirectory), layout = join(output, "layout");
  await mkdir(output, { mode: 0o700 });
  await mkdir(cache, { recursive: true, mode: 0o700 });
  for (const path of [output, cache]) {
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink() || info.mode & 0o022 || await realpath(path) !== path) throw new Error("The public prerequisite output/cache root changed.");
  }
  await mkdir(join(layout, "blobs", "sha256"), { recursive: true, mode: 0o700 });
  const abort = new AbortController(), signal = AbortSignal.any([abort.signal, AbortSignal.timeout(15 * 60_000)]);
  let token, tokenTime = 0, total = 0;
  const saved = new Set();
  async function anonymous() {
    if (token && Date.now() - tokenTime < 120_000) return token;
    const response = await request(`https://ghcr.io/token?service=ghcr.io&scope=repository:${pin.repository}:pull`,
      { redirect: "error", credentials: "omit", signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]) });
    if (response.status !== 200) throw new Error("Anonymous public runtime access failed. No personal registry credential was used.");
    const value = JSON.parse((await bytes(response, 64 * 1024)).toString("utf8"));
    if (typeof value.token !== "string" || !/^[A-Za-z0-9._=-]+$/.test(value.token)) throw new Error("Anonymous runtime access returned an invalid token.");
    token = value.token; tokenTime = Date.now(); return token;
  }
  async function get(url, maximum, range) {
    let target = new URL(url);
    for (let hop = 0; hop < 4; hop++) {
      if (target.protocol !== "https:" || target.username || target.password || target.port ||
        !["ghcr.io", "pkg-containers.githubusercontent.com", "raw.githubusercontent.com"].includes(target.hostname)) throw new Error("Public runtime prerequisite left its qualified HTTPS artifact hosts.");
      const headers = { Accept: "application/vnd.oci.image.index.v1+json, application/vnd.oci.image.manifest.v1+json, application/octet-stream",
        ...(target.hostname === "ghcr.io" ? { Authorization: `Bearer ${await anonymous()}` } : {}),
        ...(range ? { Range: `bytes=${range.start}-${range.end}` } : {}) };
      const response = await request(target.href, { headers, credentials: "omit", redirect: "manual", signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]) });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location"); await response.body?.cancel();
        if (!location) throw new Error("Public runtime prerequisite redirect is missing.");
        target = new URL(location, target); continue;
      }
      if (range) {
        if (response.status !== 206 || response.headers.get("content-range") !== `bytes ${range.start}-${range.end}/${range.total}`) throw new Error("Public runtime prerequisite did not return the exact requested byte range.");
      } else if (response.status !== 200) throw new Error(`Pinned public runtime prerequisite returned HTTP ${response.status}.`);
      return bytes(response, maximum);
    }
    throw new Error("Pinned public runtime prerequisite exceeded its redirect bound.");
  }
  async function cached(expected, download) {
    const path = join(cache, expected.replace(":", "-"));
    let value;
    try { value = await regular(path); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    if (value) {
      if (digest(value) !== expected) throw new Error("Cached public runtime prerequisite digest changed. No replacement was silently downloaded.");
      return value;
    }
    value = await download();
    if (digest(value) !== expected) throw new Error("Downloaded public runtime prerequisite digest differs from its pin.");
    const pending = `${path}.${process.pid}.pending`;
    await writeFile(pending, value, { flag: "wx", mode: 0o600 }); await rename(pending, path);
    if (digest(await regular(path)) !== expected) throw new Error("Public runtime prerequisite cache publication changed.");
    return value;
  }
  async function store(expected, value) {
    if (saved.has(expected)) return;
    total += value.length;
    if (total > maximumBytes) throw new Error("Complete public init image exceeded its archive input bound.");
    await writeFile(join(layout, "blobs", "sha256", expected.slice(7)), value, { flag: "wx", mode: 0o600 }); saved.add(expected);
  }
  async function blob(descriptor, manifest = false) {
    assert.match(descriptor.digest, /^sha256:[a-f0-9]{64}$/);
    if (!Number.isSafeInteger(descriptor.size) || descriptor.size < 1 || descriptor.size > maximumBytes) throw new Error("Pinned init descriptor has an invalid byte count.");
    const value = await cached(descriptor.digest, async () => {
      const url = `https://ghcr.io/v2/${pin.repository}/${manifest ? "manifests" : "blobs"}/${descriptor.digest}`;
      if (descriptor.size <= chunkBytes) return get(url, descriptor.size);
      const ranges = Array.from({ length: Math.ceil(descriptor.size / chunkBytes) }, (_, index) => ({
        start: index * chunkBytes, end: Math.min(descriptor.size - 1, (index + 1) * chunkBytes - 1), total: descriptor.size,
      }));
      const parts = new Array(ranges.length); let next = 0;
      const rangeRoot = join(cache, `ranges-${descriptor.digest.slice(7)}`);
      await mkdir(rangeRoot, { recursive: true, mode: 0o700 });
      const rangeInfo = await lstat(rangeRoot);
      if (!rangeInfo.isDirectory() || rangeInfo.isSymbolicLink() || rangeInfo.mode & 0o022 || await realpath(rangeRoot) !== rangeRoot) throw new Error("The bounded range cache root changed.");
      const results = await Promise.allSettled(Array.from({ length: Math.min(4, ranges.length) }, async () => {
        try {
          while (next < ranges.length) {
            signal.throwIfAborted();
            const index = next++, range = ranges[index], path = join(rangeRoot, `${range.start}-${range.end}`);
            try { parts[index] = await regular(path); }
            catch (error) {
              if (error.code !== "ENOENT") throw error;
              parts[index] = await get(url, range.end - range.start + 1, range);
              if (parts[index].length !== range.end - range.start + 1) throw new Error("Public runtime prerequisite byte range ended early.");
              const pending = `${path}.${process.pid}.pending`;
              await writeFile(pending, parts[index], { flag: "wx", mode: 0o600 }); await rename(pending, path);
            }
            if (parts[index].length !== range.end - range.start + 1) throw new Error("Cached public runtime byte range has a different size.");
          }
        } catch (error) { abort.abort(error); throw error; }
      }));
      const failed = results.find((result) => result.status === "rejected");
      if (failed) throw failed.reason;
      return Buffer.concat(parts);
    });
    if (value.length !== descriptor.size) throw new Error("Pinned init object has a different byte count.");
    await store(descriptor.digest, value); return value;
  }
  const indexBytes = await cached(pin.indexDigest, () => get(`https://ghcr.io/v2/${pin.repository}/manifests/${pin.indexDigest}`, 1024 * 1024));
  await store(pin.indexDigest, indexBytes);
  const index = JSON.parse(indexBytes.toString("utf8"));
  if (index.mediaType !== "application/vnd.oci.image.index.v1+json" || !Array.isArray(index.manifests) || index.manifests.length !== 1 ||
    index.manifests[0].platform?.os !== "linux" || index.manifests[0].platform.architecture !== "arm64") throw new Error("Pinned init image is not the qualified single linux/arm64 index.");
  const manifest = JSON.parse((await blob(index.manifests[0], true)).toString("utf8"));
  if (manifest.mediaType !== "application/vnd.oci.image.manifest.v1+json" || !Array.isArray(manifest.layers) || manifest.layers.length > 8) throw new Error("Pinned init image manifest has an unsupported graph.");
  await blob(manifest.config);
  for (const layer of manifest.layers) await blob(layer);
  const license = await cached(`sha256:${pin.licenseSha256}`, () => get(pin.licenseUrl, 64 * 1024));
  const licensePath = join(output, "AppleContainerization.LICENSE");
  await writeFile(licensePath, license, { flag: "wx", mode: 0o600 });
  await writeFile(join(layout, "oci-layout"), JSON.stringify({ imageLayoutVersion: "1.0.0" }), { flag: "wx", mode: 0o600 });
  await writeFile(join(layout, "index.json"), JSON.stringify({ schemaVersion: 2, mediaType: index.mediaType,
    manifests: [{ mediaType: index.mediaType, digest: pin.indexDigest, size: indexBytes.length, annotations: { "org.opencontainers.image.ref.name": pin.reference } }] }), { flag: "wx", mode: 0o600 });
  const archive = join(output, "apple-init.oci.tar");
  execFileSync("tar", ["-cf", archive, "-C", layout, "oci-layout", "index.json", ...[...saved].map((value) => `blobs/sha256/${value.slice(7)}`)], { timeout: 30_000 });
  const hash = createHash("sha512");
  for await (const part of createReadStream(archive)) hash.update(part);
  return { reference: pin.reference, indexDigest: pin.indexDigest, archive, sha512: hash.digest("hex"), licensePath, licenseSha256: pin.licenseSha256, inputBytes: total };
}
