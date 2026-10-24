import { createHash, createPublicKey, verify } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { Parser, Unpack } from "tar";
import {
  isRecord, MoguriError, parse, PROTOCOL_VERSION, SandboxDistributionSchema,
  type SandboxConfiguration, type SandboxDistribution, type SandboxVendor,
} from "../../../packages/protocol/src/index.ts";
import { runProgram } from "./program.ts";
import { sandboxHostEnvironment } from "./sandbox-runtime.ts";
import { readRegularFile } from "./files.ts";

export const SENDBOX_023 = {
  version: "0.2.3", repository: "mbianchidev/sendbox",
  archiveSha256: "ab9508dffa9f3299621248d6cff8efb8fd84b44556f630b6e343329ab1eafb3e",
  hostSha256: "2c0a6f0d01930037dc5b7d34f85dd9a58583ef2f93ac92dbf2f503691eee5484",
  keySha256: "998a6a606edb6afa7f8db6ea64949e39acfec30f70bbfdfc37c47391e5b85a88",
  manifestSha256: "4465bb324c4753ac621e82bd2ca30a7bb6e4e071c8521da4f10a1eb99b719030",
  trustRootId: "external-release-root", minimumReleaseSequence: 7,
} satisfies Omit<SandboxVendor, "installer">;
export async function sandboxFileHash(path: string, algorithm: "sha256" | "sha512", signal?: AbortSignal): Promise<string> {
  const stream = createReadStream(path, { signal }), hash = createHash(algorithm);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest("hex");
}
function relativeArtifact(path: string): void {
  if (!path.isWellFormed() || isAbsolute(path) || /[\\\u0000-\u001f\u007f]/.test(path) ||
    path.split("/").some((part) => !part || part === "." || part === "..")) throw new MoguriError("sandbox_distribution", "The distribution contains an invalid relative artifact path.", 409);
}
export async function distributionArtifact(root: string, artifact: { path: string; bytes: number; sha512: string }, signal: AbortSignal) {
  relativeArtifact(artifact.path);
  const path = join(root, artifact.path), metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || await realpath(path) !== path || metadata.mode & 0o022 ||
    metadata.size !== artifact.bytes || await sandboxFileHash(path, "sha512", signal) !== artifact.sha512) {
    throw new MoguriError("sandbox_distribution", "Actual bundled artifact size, canonical path or SHA-512 differs from its exact distribution. No installation or image import was started.", 409);
  }
  return path;
}
export async function readSandboxDistribution(root: string, signal: AbortSignal): Promise<{ root: string; digest: string; distribution: SandboxDistribution }> {
  signal.throwIfAborted();
  const directory = await lstat(root);
  if (!isAbsolute(root) || await realpath(root) !== root || !directory.isDirectory() || directory.isSymbolicLink() || directory.mode & 0o022) {
    throw new MoguriError("sandbox_distribution", "The bundled native distribution needs its actual canonical non-writable directory, not an inferred checkout or symlink.", 409);
  }
  const bytes = await readRegularFile(join(root, "manifest.json"), 64 * 1024);
  const distribution = parse(SandboxDistributionSchema, JSON.parse(bytes.toString("utf8")));
  if (distribution.protocol !== PROTOCOL_VERSION) throw new MoguriError("sandbox_protocol", "The bundled worker image does not match this Moguri protocol. Install a complete matching app; no mutable image or previous worker was substituted.", 409);
  await distributionArtifact(root, distribution.vendor.installer, signal);
  await distributionArtifact(root, distribution.worker.archive, signal);
  return { root, distribution, digest: createHash("sha256").update(bytes).digest("hex") };
}
export const sandboxInstallationRoot = (version: string) => `/opt/moguri/sendbox/${version}`;
export function distributionConfiguration(distribution: SandboxDistribution, root = sandboxInstallationRoot(distribution.vendor.version)): SandboxConfiguration {
  const vendor = distribution.vendor, worker = distribution.worker;
  return { executable: join(root, "sendbox"), configPath: null, image: worker.image, bundlePath: join(root, "guest/aarch64/bundle"),
    trustRootPath: join(root, "guest/aarch64/release-public.key"), qualification: {
      release: vendor.version, hostSha256: vendor.hostSha256, keySha256: vendor.keySha256, manifestSha256: vendor.manifestSha256,
      workerDigest: worker.workerDigest, bridgeDigest: worker.bridgeDigest, trustRootId: vendor.trustRootId,
      minimumReleaseSequence: vendor.minimumReleaseSequence, allowedDomains: ["github.com", "api.github.com", "api.githubcopilot.com"],
      allowCopilot: true, resources: { cpus: 2, memoryMb: 4096, diskMb: 8192 },
    } };
}
export async function installedSandboxRelease(config: SandboxConfiguration, vendor: SandboxVendor): Promise<boolean> {
  if (!config.bundlePath || !config.trustRootPath) return false;
  for (const [path, expected] of [[config.executable, vendor.hostSha256], [config.trustRootPath, vendor.keySha256], [join(config.bundlePath, "manifest.json"), vendor.manifestSha256]] as const) {
    let metadata;
    try { metadata = await lstat(path); }
    catch (error) { if (error instanceof Error && "code" in error && ["ENOENT", "ENOTDIR"].includes(String(error.code))) return false; throw error; }
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.uid !== 0 || metadata.mode & 0o022 || await realpath(path) !== path ||
      await sandboxFileHash(path, "sha256") !== expected) return false;
  }
  return true;
}
async function consumeArchive(archive: string, parser: Parser, signal: AbortSignal, completed: "end" | "close") {
  signal.throwIfAborted();
  const source = createReadStream(archive, { signal });
  const abort = () => parser.abort(signal.reason instanceof Error ? signal.reason : new MoguriError("sandbox_release_cancelled", "Original release processing was cancelled; private partial files remain retained.", 409));
  signal.addEventListener("abort", abort, { once: true });
  try {
    await new Promise<void>((resolve, reject) => {
      parser.once(completed, resolve);
      parser.once("error", (error: Error) => { source.destroy(); reject(error); });
      source.once("error", (error) => parser.abort(error));
      source.pipe(parser);
    });
    signal.throwIfAborted();
  } finally { signal.removeEventListener("abort", abort); source.destroy(); }
}
export async function extractSandboxRelease(archive: string, destination: string, version: string, expected: string, signal: AbortSignal): Promise<string> {
  if (await sandboxFileHash(archive, "sha256", signal) !== expected) throw new MoguriError("sandbox_release", "The public release archive failed its exact SHA-256 gate. No extraction or executable was started.", 409);
  const prefix = `sendbox-${version}-macos-arm64`, names = new Set<string>();
  let expanded = 0;
  const parser = new Parser({ strict: true });
  parser.on("entry", (entry) => {
    try {
      const path = entry.path.replace(/\/$/, ""); relativeArtifact(path);
      if (!(path === prefix || path.startsWith(`${prefix}/`)) || !["File", "Directory"].includes(entry.type) ||
        typeof entry.mode !== "number" || entry.mode & 0o7022 || entry.size > 64 * 1024 * 1024 || (expanded += entry.size) > 512 * 1024 * 1024 ||
        names.size >= 10_000 || names.has(path.normalize("NFC").toLowerCase())) {
        throw new MoguriError("sandbox_release", "The release archive contains unsupported paths, links, ownership modes, duplicate names or oversized entries. Nothing was extracted.", 409);
      }
      names.add(path.normalize("NFC").toLowerCase()); entry.resume();
    } catch (error) { parser.abort(error instanceof Error ? error : new Error("Unsupported native release archive metadata.")); }
  });
  await consumeArchive(archive, parser, signal, "end");
  signal.throwIfAborted(); await mkdir(destination, { mode: 0o700 });
  const unpack = new Unpack({ cwd: destination, strict: true, preserveOwner: false, noMtime: true,
    filter: (path) => names.has(path.replace(/\/$/, "").normalize("NFC").toLowerCase()) });
  await consumeArchive(archive, unpack, signal, "close");
  return realpath(join(destination, prefix));
}
export async function inspectSandboxRelease(root: string, version: string, trustedKeySha256: string, archiveSha256: string, signal: AbortSignal): Promise<Omit<SandboxVendor, "installer">> {
  if (!/^[a-f0-9]{64}$/.test(archiveSha256)) throw new MoguriError("sandbox_release", "The original public archive digest is missing. No package was built.", 409);
  const keyPath = join(root, "guest/aarch64/release-public.key"), manifestPath = join(root, "guest/aarch64/bundle/manifest.json");
  const key = await readRegularFile(keyPath, 4096), bytes = await readRegularFile(manifestPath, 1024 * 1024);
  if (key.length !== 32 || createHash("sha256").update(key).digest("hex") !== trustedKeySha256) {
    throw new MoguriError("sandbox_trust_root", "This release changes the actual trusted guest root. Review a new trust root explicitly; automatic update discovery cannot grant it.", 409);
  }
  const envelope: unknown = JSON.parse(bytes.toString("utf8"));
  if (!isRecord(envelope) || typeof envelope.payload !== "string" || typeof envelope.signature !== "string" ||
    !/^[a-f0-9]{128}$/.test(envelope.signature) || !verify(null, Buffer.from(envelope.payload),
      createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), key]), format: "der", type: "spki" }), Buffer.from(envelope.signature, "hex"))) {
    throw new MoguriError("sandbox_release_signature", "The actual guest manifest failed its Ed25519 trust-root signature. No package or executable was admitted.", 409);
  }
  const manifest: unknown = JSON.parse(envelope.payload);
  if (!isRecord(manifest) || manifest.schema_version !== 1 || manifest.domain !== "dev.sendbox.guest.artifact-manifest.v1" ||
    manifest.expected_host_version !== version || manifest.expected_guest_version !== version ||
    manifest.architecture !== "aarch64" || manifest.trust_root_id !== "external-release-root" || typeof manifest.release_sequence !== "number" ||
    !Number.isSafeInteger(manifest.release_sequence) || manifest.release_sequence < 7 || !Array.isArray(manifest.artifacts) ||
    manifest.artifacts.length < 1 || manifest.artifacts.length > 128 || !manifest.artifacts.some((artifact) => isRecord(artifact) && artifact.kind === "guest_binary")) {
    throw new MoguriError("sandbox_release_manifest", "Signed release version, architecture, trust root or rollback floor changed. No installation was authorized.", 409);
  }
  for (const value of manifest.artifacts) {
    signal.throwIfAborted();
    if (!isRecord(value) || typeof value.path !== "string" || typeof value.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.sha256) ||
      value.uid !== 0 || value.gid !== 0 || typeof value.mode !== "number") throw new MoguriError("sandbox_release_manifest", "The signed guest artifact metadata has an unsupported shape or owner.", 409);
    relativeArtifact(value.path);
    const file = join(root, "guest/aarch64/bundle", value.path), metadata = await lstat(file);
    if (!metadata.isFile() || metadata.isSymbolicLink() || await realpath(file) !== file || (metadata.mode & 0o777) !== value.mode ||
      await sandboxFileHash(file, "sha256", signal) !== value.sha256) throw new MoguriError("sandbox_release_manifest", "Actual guest artifact bytes or modes differ from the signed manifest.", 409);
  }
  return { version, repository: "mbianchidev/sendbox", archiveSha256,
    hostSha256: await sandboxFileHash(join(root, "sendbox"), "sha256", signal), keySha256: trustedKeySha256,
    manifestSha256: createHash("sha256").update(bytes).digest("hex"), trustRootId: "external-release-root", minimumReleaseSequence: manifest.release_sequence };
}
export async function buildSandboxInstaller(root: string, version: string, output: string, signal: AbortSignal): Promise<void> {
  await runProgram("/usr/bin/pkgbuild", ["--root", root, "--ownership", "recommended", "--install-location", sandboxInstallationRoot(version),
    "--identifier", `dev.moguri.sendbox.runtime.${version}`, "--version", version, output],
  { cwd: dirname(output), signal, env: sandboxHostEnvironment(), label: "Versioned no-script SendBox installer", timeoutMs: 120_000, maxBytes: 64 * 1024 });
}
