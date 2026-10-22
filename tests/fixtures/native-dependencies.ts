import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const execute = promisify(execFile);
async function zip(path: string, entries: Record<string, string>): Promise<Buffer> {
  await execute("python3", ["-I", "-c", "import json,sys,zipfile\nwith zipfile.ZipFile(sys.argv[1], 'w', compression=zipfile.ZIP_DEFLATED) as archive:\n for name,body in json.loads(sys.argv[2]).items(): archive.writestr(name,body)\n", path, JSON.stringify(entries)]);
  return readFile(path);
}
export async function nativeDependencyFixtures(directory: string, variant = "generated-original") {
  await mkdir(directory, { recursive: true });
  const name = "generated-cache-wheel", version = "1.0.0";
  const wheelName = "generated_cache_wheel-1.0.0-py3-none-any.whl";
  const dist = "generated_cache_wheel-1.0.0.dist-info";
  const wheel = await zip(join(directory, wheelName), {
    "generated_cache_wheel/__init__.py": "raise RuntimeError('A cache operation must never import dependency code')\n",
    [`${dist}/WHEEL`]: "Wheel-Version: 1.0\nGenerator: generated-moguri-fixture\nRoot-Is-Purelib: true\nTag: py3-none-any\n",
    [`${dist}/METADATA`]: `Metadata-Version: 2.1\nName: ${name}\nVersion: ${version}\n`,
    [`${dist}/RECORD`]: "",
  });
  const wheelSha256 = createHash("sha256").update(wheel).digest("hex");
  const crateName = "generated-cache-crate";
  const crateRoot = join(directory, "crate-source", `${crateName}-${version}`);
  await mkdir(join(crateRoot, "src"), { recursive: true });
  await writeFile(join(crateRoot, "Cargo.toml"), `[package]\nname = "${crateName}"\nversion = "${version}"\nedition = "2021"\nbuild = "build.rs"\n`);
  await writeFile(join(crateRoot, "src/lib.rs"), "pub fn generated_fixture() -> bool { true }\n");
  await writeFile(join(crateRoot, "build.rs"), "fn main() { panic!(\"A cache operation must never execute build.rs\"); }\n");
  const cratePath = join(directory, `${crateName}-${version}.crate`);
  await execute("tar", ["--format", "ustar", "-czf", cratePath, "-C", join(directory, "crate-source"), `${crateName}-${version}`], { env: { ...process.env, COPYFILE_DISABLE: "1" } });
  const crate = await readFile(cratePath);
  const crateSha256 = createHash("sha256").update(crate).digest("hex");
  const moduleName = "generated.invalid/cache-module", moduleVersion = "v1.0.0";
  const goMod = `module ${moduleName}\n\ngo 1.20\n`;
  const moduleZip = await zip(join(directory, "module.zip"), {
    [`${moduleName}@${moduleVersion}/go.mod`]: goMod,
    [`${moduleName}@${moduleVersion}/generated.go`]: `package generated\nconst FixtureVariant = ${JSON.stringify(variant)}\nfunc init() { panic("A cache operation must never execute Go dependency code") }\n`,
  });
  return { python: { name, version, filename: wheelName, bytes: wheel, sha256: wheelSha256 },
    cargo: { name: crateName, version, bytes: crate, sha256: crateSha256 },
    go: { name: moduleName, version: moduleVersion, bytes: moduleZip, mod: goMod } };
}
