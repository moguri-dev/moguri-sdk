import { lstat, realpath } from "node:fs/promises";
import { dirname } from "node:path";
import { MoguriError, SandboxVersionSchema, parse } from "../../../packages/protocol/src/index.ts";
import { sandboxFileHash, sandboxInstallationRoot } from "./sandbox-distribution.ts";
import { runProgram } from "./program.ts";
import { sandboxHostEnvironment } from "./sandbox-runtime.ts";
import { readRegularFile } from "./files.ts";

export interface SandboxInstallRequest { id: string; packagePath: string; sha512: string; version: string; destination: string }
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
export function sandboxInstallerScript(request: SandboxInstallRequest): string {
  parse(SandboxVersionSchema, request.version);
  if (!/^[a-f0-9]{8}-[a-f0-9-]{27}$/.test(request.id) || !/^[a-f0-9]{128}$/.test(request.sha512) ||
    !request.packagePath.startsWith("/") || !request.packagePath.isWellFormed() || /[\0\r\n]/.test(request.packagePath) ||
    request.destination !== sandboxInstallationRoot(request.version)) throw new MoguriError("sandbox_install_scope", "Administrator installation needs the exact reviewed version, package digest and fixed side-by-side destination.", 409);
  const temporary = `/var/tmp/dev.moguri.sendbox-${request.id}`, source = quote(request.packagePath), pkg = quote(`${temporary}/runtime.pkg`);
  const receiptRoot = "/opt/moguri/sendbox-install-receipts", receipt = `${receiptRoot}/${request.id}.json`;
  const json = JSON.stringify({ version: 1, id: request.id, sha512: request.sha512, runtimeVersion: request.version, destination: request.destination, status: "installed" });
  return [
    "set -eu", "umask 077",
    ...["/opt", "/opt/moguri", "/opt/moguri/sendbox", receiptRoot].map((path) => `[ ! -L ${quote(path)} ]`),
    `[ ! -e ${quote(temporary)} ]`, `[ ! -e ${quote(request.destination)} ]`, `[ ! -L ${quote(request.destination)} ]`,
    `/bin/mkdir -m 700 ${quote(temporary)}`,
    `/bin/cp -P ${source} ${pkg}`,
    `[ -f ${pkg} ]`, `[ ! -L ${pkg} ]`,
    `actual=$(/usr/bin/shasum -a 512 ${pkg})`,
    `case "$actual" in ${quote(request.sha512)}" "*) ;; *) exit 74 ;; esac`,
    `/usr/sbin/installer -pkg ${pkg} -target /`,
    `/usr/bin/install -d -m 755 ${quote(receiptRoot)}`,
    `/usr/bin/printf '%s' ${quote(json)} > ${quote(`${receipt}.tmp`)}`,
    `/bin/chmod 644 ${quote(`${receipt}.tmp`)}`,
    `/bin/mv -n ${quote(`${receipt}.tmp`)} ${quote(receipt)}`,
    `/bin/rm -f ${pkg}`, `/bin/rmdir ${quote(temporary)}`,
  ].join("\n");
}
export async function installSandboxRuntime(request: SandboxInstallRequest, signal: AbortSignal): Promise<void> {
  if (process.platform !== "darwin" || process.arch !== "arm64") throw new MoguriError("sandbox_install_platform", "Managed SendBox installation is qualified only for macOS arm64.", 409);
  const metadata = await lstat(request.packagePath);
  if (!metadata.isFile() || metadata.isSymbolicLink() || await realpath(request.packagePath) !== request.packagePath ||
    metadata.mode & 0o022 || await sandboxFileHash(request.packagePath, "sha512", signal) !== request.sha512) {
    throw new MoguriError("sandbox_install_package", "The exact reviewed installer bytes or path changed before administrator authorization. Nothing was installed.", 409);
  }
  const script = sandboxInstallerScript(request);
  const apple = `do shell script "${script.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}" with administrator privileges`;
  await runProgram("/usr/bin/osascript", ["-e", apple], { cwd: dirname(request.packagePath), signal, env: sandboxHostEnvironment(),
    label: "Reviewed SendBox administrator installation", timeoutMs: 5 * 60_000, maxBytes: 64 * 1024 });
  const receipt = `/opt/moguri/sendbox-install-receipts/${request.id}.json`, info = await lstat(receipt);
  if (!info.isFile() || info.isSymbolicLink() || info.uid !== 0 || info.mode & 0o022 ||
    await realpath(receipt) !== receipt) throw new MoguriError("sandbox_install_unconfirmed", "The system installer did not retain its exact root-owned completion. No success or retry was inferred.", 409);
  const saved: unknown = JSON.parse((await readRegularFile(receipt, 16 * 1024)).toString("utf8"));
  if (JSON.stringify(saved) !== JSON.stringify({ version: 1, id: request.id, sha512: request.sha512,
    runtimeVersion: request.version, destination: request.destination, status: "installed" })) {
    throw new MoguriError("sandbox_install_unconfirmed", "The root-owned completion differs from its exact reviewed installer/operation. No alternate installation was accepted.", 409);
  }
}
