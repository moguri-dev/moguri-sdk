import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { prepareAppleInitArchive } from "../scripts/prepare-apple-init.mjs";

const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
async function fixture(options: { badRange?: boolean; corrupt?: boolean; redirect?: string; platform?: string } = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "moguri-generated-init-")));
  const layer = Buffer.alloc(2 * 1024 * 1024 + 17, 0x67), config = Buffer.from('{"architecture":"arm64","os":"linux"}'), license = Buffer.from("Generated fixture license, no real runtime.");
  const descriptor = (bytes: Buffer, mediaType: string) => ({ digest: `sha256:${hash(bytes)}`, size: bytes.length, mediaType });
  const manifest = Buffer.from(JSON.stringify({ schemaVersion: 2, mediaType: "application/vnd.oci.image.manifest.v1+json",
    config: descriptor(config, "application/vnd.oci.image.config.v1+json"), layers: [descriptor(layer, "application/vnd.oci.image.layer.v1.tar")] }));
  const index = Buffer.from(JSON.stringify({ schemaVersion: 2, mediaType: "application/vnd.oci.image.index.v1+json",
    manifests: [{ ...descriptor(manifest, "application/vnd.oci.image.manifest.v1+json"), platform: { os: "linux", architecture: options.platform ?? "arm64" } }] }));
  const pin = { reference: "ghcr.io/apple/containerization/vminit:0.0.0", repository: "apple/containerization/vminit",
    indexDigest: `sha256:${hash(index)}`, licenseUrl: "https://raw.githubusercontent.com/apple/containerization/0.0.0/LICENSE", licenseSha256: hash(license) };
  const objects = new Map([[`sha256:${hash(index)}`, index], [`sha256:${hash(manifest)}`, manifest], [`sha256:${hash(config)}`, config], [`sha256:${hash(layer)}`, layer]]);
  const calls: { url: string; range: string | null; authorization: string | null }[] = [];
  const request: typeof fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input), headers = new Headers(init?.headers);
    calls.push({ url, range: headers.get("range"), authorization: headers.get("authorization") });
    if (url.startsWith("https://ghcr.io/token?")) return Response.json({ token: "generated-anonymous-only" });
    if (url === pin.licenseUrl) return new Response(Uint8Array.from(license));
    const digest = new URL(url).pathname.split("/").at(-1)!;
    const bytes = objects.get(digest);
    if (!bytes) throw new Error("Generated init fixture forbids real network or another resource.");
    if (options.redirect && bytes === layer && url.startsWith("https://ghcr.io/")) return new Response(null, { status: 302, headers: { location: options.redirect } });
    const range = headers.get("range");
    if (range) {
      const match = /^bytes=(\d+)-(\d+)$/.exec(range); assert.ok(match);
      const start = Number(match[1]), end = Number(match[2]), result = Buffer.from(bytes.subarray(start, end + 1));
      if (options.corrupt) result[0] = result[0]! ^ 0xff;
      return new Response(Uint8Array.from(result), { status: 206, headers: { "content-range": `bytes ${options.badRange ? start + 1 : start}-${end}/${bytes.length}` } });
    }
    return new Response(Uint8Array.from(bytes));
  };
  return { root, pin, calls, request, layer, cache: join(root, "cache"),
    prepare: (name: string, fetcher = request) => prepareAppleInitArchive({ directory: join(root, name), cacheDirectory: join(root, "cache"), fetch: fetcher, pin }),
    close: () => rm(root, { recursive: true, force: true }) };
}

test("the public init archive binds every ranged byte, platform, original index and license without credentials or runtime execution", async () => {
  const f = await fixture();
  try {
    const result = await f.prepare("first");
    assert.equal(result.reference, f.pin.reference); assert.equal(result.indexDigest, f.pin.indexDigest);
    const metadata = JSON.parse(execFileSync("tar", ["-xOf", result.archive, "index.json"], { encoding: "utf8" }));
    assert.equal(metadata.manifests[0].digest, f.pin.indexDigest);
    assert.equal(metadata.manifests[0].annotations["org.opencontainers.image.ref.name"], f.pin.reference);
    const actualLayer = execFileSync("tar", ["-xOf", result.archive, `blobs/sha256/${hash(f.layer)}`], { maxBuffer: 3 * 1024 * 1024 });
    assert.deepEqual(actualLayer, f.layer);
    assert.equal(hash(await readFile(result.licensePath)), f.pin.licenseSha256);
    assert.deepEqual(f.calls.filter((call) => call.range).map((call) => call.range).sort(),
      ["bytes=0-524287", "bytes=524288-1048575", "bytes=1048576-1572863", "bytes=1572864-2097151", "bytes=2097152-2097168"].sort());
    assert.equal(f.calls.find((call) => call.url === f.pin.licenseUrl)?.authorization, null);
    assert.ok(f.calls.filter((call) => call.url.startsWith("https://ghcr.io/v2/")).every((call) => call.authorization === "Bearer generated-anonymous-only"));
    const count = f.calls.length;
    const again = await f.prepare("second", async () => { throw new Error("Verified cached bytes need no network."); });
    assert.equal(again.indexDigest, result.indexDigest); assert.equal(f.calls.length, count);
  } finally { await f.close(); }
});

for (const options of [{ badRange: true }, { corrupt: true }, { platform: "amd64" }, { redirect: "http://127.0.0.1/private" }]) {
  test(`invalid public prerequisite input cannot publish an archive: ${JSON.stringify(options)}`, async () => {
    const f = await fixture(options);
    try {
      await assert.rejects(() => f.prepare("rejected"), /range|digest|platform|linux\/arm64|HTTPS|artifact hosts/i);
      await assert.rejects(() => readFile(join(f.root, "rejected", "apple-init.oci.tar")), { code: "ENOENT" });
      assert.equal(f.calls.some((call) => call.url.startsWith("http://127.0.0.1")), false);
    } finally { await f.close(); }
  });
}

test("modified cached init bytes fail explicitly instead of borrowing the filename or downloading a success-shaped replacement", async () => {
  const f = await fixture();
  try {
    await f.prepare("first");
    const path = join(f.cache, f.pin.indexDigest.replace(":", "-"));
    await writeFile(path, "Generated changed cached bytes.");
    let network = false;
    await assert.rejects(() => f.prepare("second", async () => { network = true; throw new Error("No replacement fetch."); }), /Cached.*digest changed/);
    assert.equal(network, false);
  } finally { await f.close(); }
});

test("the public CDN receives no anonymous registry authorization header", async () => {
  const options: { redirect?: string } = {}, f = await fixture(options);
  options.redirect = `https://pkg-containers.githubusercontent.com/generated/sha256:${hash(f.layer)}`;
  try {
    await f.prepare("redirected");
    const calls = f.calls.filter((call) => call.url.startsWith("https://pkg-containers.githubusercontent.com/"));
    assert.equal(calls.length, 5); assert.ok(calls.every((call) => call.authorization === null));
  } finally { await f.close(); }
});
