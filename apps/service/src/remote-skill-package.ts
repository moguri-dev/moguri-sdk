import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, posix } from "node:path";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import { MoguriError } from "../../../packages/protocol/src/index.ts";
import { SKILL_INSPECTION_BYTES } from "../../../packages/protocol/src/skill-admission.ts";

const hash = Type.String({ pattern: "^[a-f0-9]{64}$" }), path = Type.String({ minLength: 1, maxLength: 4096 });
/**
 * One exact admitted skill package for a Remote session. `manifest` is the admission's original `origin.files` and `digest` its
 * artifact digest, so the SSH host can verify identity without trusting the controller's file list. `base` is the skill folder
 * inside the source, stripped from each path when writing.
 */
export const SkillPackageRequestSchema = Type.Object({
  digest: hash, base: Type.String({ maxLength: 4096 }),
  manifest: Type.Array(Type.Object({ path, digest: hash, bytes: Type.Integer({ minimum: 0, maximum: SKILL_INSPECTION_BYTES }) }, { additionalProperties: false }), { minItems: 1, maxItems: 128 }),
  files: Type.Array(Type.Object({ path, text: Type.String({ maxLength: SKILL_INSPECTION_BYTES }) }, { additionalProperties: false }), { minItems: 1, maxItems: 128 }),
}, { additionalProperties: false });
export type SkillPackageRequest = Static<typeof SkillPackageRequestSchema>;
export interface SkillPackageResult { path: string; files: string[]; reused: boolean }
const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const MANIFEST = ".moguri-skill-package.json";

/** Relative file path inside the skill folder; anything absolute, traversing or hidden-control fails before any write. */
function relativePath(base: string, path: string): string {
  const prefix = base ? `${base}/` : "";
  if (!path.startsWith(prefix)) throw new MoguriError("skill_package_path", "A skill package file is outside its skill folder. Nothing was written.", 400);
  const relative = path.slice(prefix.length);
  if (!relative || relative === MANIFEST || isAbsolute(relative) || /[\\\0]/.test(relative) || posix.normalize(relative) !== relative ||
    relative.split("/").some((part) => !part || part === "." || part === "..")) throw new MoguriError("skill_package_path", "A skill package path is not a plain relative path. Nothing was written.", 400);
  return relative;
}
async function matches(directory: string, request: SkillPackageRequest, paths: string[]): Promise<boolean> {
  try {
    const metadata = await lstat(directory);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) return false;
    if (JSON.parse(await readFile(join(directory, MANIFEST), "utf8")).digest !== request.digest) return false;
    for (const [index, relative] of paths.entries()) {
      const file = join(directory, relative), entry = await lstat(file);
      if (!entry.isFile() || entry.isSymbolicLink() || sha256(await readFile(file)) !== request.manifest[index]!.digest) return false;
    }
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) return false;
    throw error;
  }
}

/**
 * Writes the exact package into `<stateDir>/skills/<artifact digest>` on the executing host. Files are verified against the admitted
 * manifest, written to a private temporary folder, read back and then renamed into place, so a reader never sees a partial package.
 * An existing matching package is reused; a changed one is replaced, since the folder is a Moguri-owned content-addressed cache.
 */
export async function materializeSkillPackage(stateDir: string, input: unknown, signal: AbortSignal): Promise<SkillPackageResult> {
  if (!Value.Check(SkillPackageRequestSchema, input)) throw new MoguriError("skill_package", "The skill package request is malformed. Nothing was written.", 400);
  const request = input;
  if (sha256(JSON.stringify(request.manifest)) !== request.digest || request.files.length !== request.manifest.length ||
    request.files.some((file, index) => file.path !== request.manifest[index]!.path || sha256(file.text) !== request.manifest[index]!.digest ||
      Buffer.byteLength(file.text) !== request.manifest[index]!.bytes) || request.manifest.reduce((bytes, file) => bytes + file.bytes, 0) > SKILL_INSPECTION_BYTES) {
    throw new MoguriError("skill_package_digest", "The skill package doesn't match its admitted artifact digest. Nothing was written.", 409);
  }
  const paths = request.files.map((file) => relativePath(request.base, file.path));
  if (new Set(paths).size !== paths.length) throw new MoguriError("skill_package_path", "A skill package has duplicate paths. Nothing was written.", 400);
  const root = join(stateDir, "skills"), target = join(root, request.digest);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const parent = await lstat(root);
  if (!parent.isDirectory() || parent.isSymbolicLink() || parent.uid !== process.getuid?.() || parent.mode & 0o077) {
    throw new MoguriError("skill_package_permissions", "The remote skill cache must be a user-owned, non-symlink folder with mode 0700. Nothing was written.", 409);
  }
  signal.throwIfAborted();
  if (await matches(target, request, paths)) return { path: target, files: paths, reused: true };
  const incoming = await mkdtemp(join(root, ".incoming-"));
  try {
    for (const [index, relative] of paths.entries()) {
      signal.throwIfAborted();
      const file = join(incoming, relative), text = request.files[index]!.text;
      await mkdir(dirname(file), { recursive: true, mode: 0o700 });
      await writeFile(file, text, { flag: "wx", mode: text.startsWith("#!") ? 0o700 : 0o600 });
      if (sha256(await readFile(file)) !== request.manifest[index]!.digest) throw new MoguriError("skill_package_write", "A written skill file did not read back exactly. The package was discarded.", 409);
    }
    await writeFile(join(incoming, MANIFEST), JSON.stringify({ digest: request.digest, manifest: request.manifest }), { flag: "wx", mode: 0o600 });
    signal.throwIfAborted();
    const stale = await readdir(root).then((entries) => entries.includes(request.digest));
    if (stale) await rm(target, { recursive: true, force: true });
    await rename(incoming, target);
    return { path: target, files: paths, reused: false };
  } catch (error) {
    await rm(incoming, { recursive: true, force: true });
    if (["ENOTEMPTY", "EEXIST"].includes((error as NodeJS.ErrnoException).code ?? "") && await matches(target, request, paths)) return { path: target, files: paths, reused: true };
    throw error;
  }
}
