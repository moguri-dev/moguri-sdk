import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PROTOCOL_VERSION } from "../packages/sdk/src/index.ts";
import { nativeConfiguration } from "./fixtures/native-target.ts";

test("native fixtures preserve the explicitly selected release instead of relabeling current artifacts as historical 0.2.3", {
  skip: process.platform !== "darwin" || process.arch !== "arm64",
}, async () => {
  const directory = await mkdtemp(join(tmpdir(), "moguri-native-receipts-"));
  const original = { installation: process.env.MOGURI_NATIVE_INSTALLATION, workload: process.env.MOGURI_NATIVE_WORKLOAD };
  const hash = "1".repeat(64);
  const candidate = {
    version: "0.2.4", executable: "/generated/sendbox", bundle: "/generated/bundle", key: "/generated/public.key",
    hostSha256: hash, keySha256: hash, manifestSha256: hash, trustRootId: "generated-root", minimumReleaseSequence: 8,
  };
  try {
    process.env.MOGURI_NATIVE_INSTALLATION = join(directory, "installation.json");
    process.env.MOGURI_NATIVE_WORKLOAD = join(directory, "workload.json");
    await writeFile(process.env.MOGURI_NATIVE_INSTALLATION, JSON.stringify(candidate));
    await writeFile(process.env.MOGURI_NATIVE_WORKLOAD, JSON.stringify({
      status: "PASS", image: `generated/worker@sha256:${hash}`,
      payload: { protocol: PROTOCOL_VERSION, files: { "dist/worker.mjs": hash, "dist/remote-bridge.mjs": hash } },
    }));
    assert.equal((await nativeConfiguration())?.qualification?.release, "0.2.4");
    await writeFile(process.env.MOGURI_NATIVE_INSTALLATION, JSON.stringify({ ...candidate, version: undefined, minimumReleaseSequence: 7 }));
    assert.equal((await nativeConfiguration())?.qualification?.release, "0.2.3", "Versionless historical descriptors retain their original release.");
  } finally {
    for (const [name, value] of [["MOGURI_NATIVE_INSTALLATION", original.installation], ["MOGURI_NATIVE_WORKLOAD", original.workload]] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await rm(directory, { recursive: true, force: true });
  }
});
