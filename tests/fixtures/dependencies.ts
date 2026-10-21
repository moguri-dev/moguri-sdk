import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function dependencyArchive(directory: string, name = "generated-shared-package") {
  const packageRoot = join(directory, "generated-package", "package");
  await mkdir(packageRoot, { recursive: true });
  const version = "1.0.0";
  await writeFile(join(packageRoot, "package.json"), JSON.stringify({ name, version,
    scripts: { postinstall: "node -e \"require('node:fs').writeFileSync('UNSAFE_SCRIPT_RAN','generated')\"" } }));
  await writeFile(join(packageRoot, "index.js"), "module.exports = 'generated shared dependency';\n");
  const file = join(directory, "generated-package.tgz");
  await promisify(execFile)("tar", ["-czf", file, "-C", join(directory, "generated-package"), "package"]);
  const bytes = await readFile(file);
  return { name, version, bytes, integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
    url: `https://registry.npmjs.org/${name}/-/${name.split("/").at(-1)}-${version}.tgz` };
}
export async function dependencyProject(root: string, artifact: Awaited<ReturnType<typeof dependencyArchive>>, manager: "npm" | "pnpm" = "npm") {
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "generated-consumer", version: "1.0.0", dependencies: { [artifact.name]: artifact.version },
    scripts: { preinstall: "node -e \"require('node:fs').writeFileSync('UNSAFE_ROOT_SCRIPT_RAN','generated')\"" } }));
  if (manager === "npm") await writeFile(join(root, "package-lock.json"), JSON.stringify({
    name: "generated-consumer", version: "1.0.0", lockfileVersion: 3, packages: {
      "": { name: "generated-consumer", version: "1.0.0", dependencies: { [artifact.name]: artifact.version } },
      [`node_modules/${artifact.name}`]: { version: artifact.version, resolved: artifact.url, integrity: artifact.integrity, hasInstallScript: true },
    },
  }));
  else await writeFile(join(root, "pnpm-lock.yaml"), `lockfileVersion: '9.0'\nsettings:\n  autoInstallPeers: true\n  excludeLinksFromLockfile: false\nimporters:\n  .:\n    dependencies:\n      ${JSON.stringify(artifact.name)}:\n        specifier: ${artifact.version}\n        version: ${artifact.version}\npackages:\n  ${JSON.stringify(`${artifact.name}@${artifact.version}`)}:\n    resolution: {integrity: ${artifact.integrity}}\nsnapshots:\n  ${JSON.stringify(`${artifact.name}@${artifact.version}`)}: {}\n`);
}
