import { createHash } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PROTOCOL_VERSION, type SandboxDistribution } from "../../packages/sdk/src/index.ts";
import { SENDBOX_024 } from "../../apps/service/src/sandbox-distribution.ts";

export async function generatedSandboxDistribution() {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "moguri-generated-sandbox-distribution-")));
  await mkdir(join(directory, "assets"), { mode: 0o700 });
  const image = Buffer.from("GENERATED_OCI_BYTES_NOT_AN_EXECUTABLE"), installer = Buffer.from("GENERATED_PACKAGE_NOT_AN_INSTALLER");
  const hash = (bytes: Buffer) => createHash("sha512").update(bytes).digest("hex");
  const distribution: SandboxDistribution = {
    format: "moguri-sandbox-distribution", version: 1, protocol: PROTOCOL_VERSION, nodeVersion: "26.12.0",
    vendor: { ...SENDBOX_024, installer: { path: "assets/generated.pkg", bytes: installer.length, sha512: hash(installer) } },
    worker: { image: `generated/worker@sha256:${"a".repeat(64)}`, workerDigest: "b".repeat(64), bridgeDigest: "c".repeat(64),
      mcpWorkerDigest: "d".repeat(64), payloadDigest: "e".repeat(64),
      archive: { path: "assets/generated.oci.tar", bytes: image.length, sha512: hash(image) } },
  };
  await writeFile(join(directory, distribution.vendor.installer.path), installer, { mode: 0o600 });
  await writeFile(join(directory, distribution.worker.archive.path), image, { mode: 0o600 });
  await writeFile(join(directory, "manifest.json"), JSON.stringify(distribution), { mode: 0o600 });
  return { directory, distribution, close: () => rm(directory, { recursive: true, force: true }) };
}
