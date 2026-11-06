import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, realpath, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { MoguriSdk, type ModelReadinessTarget } from "../packages/sdk/src/index.ts";
import { executeModelReadinessQuery } from "../apps/service/src/model-readiness-bridge.ts";
import { captureModelReadinessBinding, modelReadinessRootDigest } from "../apps/service/src/model-readiness-binding.ts";
import { LOCAL_RUNTIME_PROBE_LOCATIONS } from "../apps/service/src/model-readiness.ts";
import { frameDigest } from "../apps/service/src/worker-wire.ts";
import { remoteFixture } from "./fixtures/remote-service.ts";

test("disk observations bind the exact configured storage directory, including replacement and missing-to-created transitions", async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "moguri-readiness-storage-")));
  const storage = join(directory, "generated-weights"), signal = new AbortController().signal;
  try {
    const missing = await captureModelReadinessBinding(directory, storage, signal);
    assert.equal(missing.storage, null);
    await mkdir(storage);
    const original = await captureModelReadinessBinding(directory, storage, signal);
    assert.equal(original.storage?.root, storage);
    assert.notEqual(modelReadinessRootDigest(missing), modelReadinessRootDigest(original));
    await rename(storage, join(directory, "original-generated-weights")); await mkdir(storage);
    const replaced = await captureModelReadinessBinding(directory, storage, signal);
    assert.deepEqual(replaced.root, original.root);
    assert.notEqual(replaced.storage?.inode, original.storage?.inode);
    assert.notEqual(modelReadinessRootDigest(replaced), modelReadinessRootDigest(original));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("the private readiness bridge rejects every foreign machine/root/build binding before observing hardware", async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "moguri-readiness-binding-")));
  const abort = new AbortController();
  try {
    const owner = { env: "Remote" as const, root: directory, stateDir: directory, peerDigest: "a".repeat(64), executingModule: import.meta.url };
    const result = await executeModelReadinessQuery({ type: "model.readiness.binding" }, owner, abort.signal);
    assert.equal(result.type, "model.readiness.binding");
    if (result.type !== "model.readiness.binding") throw new Error("Missing exact generated readiness binding.");
    const target: ModelReadinessTarget = {
      profileId: "generated-profile", sessionId: "generated-session", modelId: "generated-model", env: "Remote",
      rootDigest: modelReadinessRootDigest(result.binding), peerDigest: owner.peerDigest, buildDigest: result.binding.buildDigest,
      endpointBindingDigest: "b".repeat(64), modelBindingDigest: "c".repeat(64),
    };
    for (const changed of [
      { env: "Local" as const }, { env: "Sandbox" as const }, { peerDigest: "d".repeat(64) },
      { rootDigest: "e".repeat(64) }, { buildDigest: "f".repeat(64) },
    ]) await assert.rejects(() => executeModelReadinessQuery({
      type: "model.readiness", input: { target: { ...target, ...changed }, storagePath: result.binding.storagePath },
      binding: result.binding,
    }, owner, abort.signal), /exact executing peer, root and build|provenance/i);
    abort.abort();
    await assert.rejects(() => executeModelReadinessQuery({ type: "model.readiness.binding" }, owner, abort.signal), /abort|cancel/i);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("real pinned SSH readiness observes only generated remote-process facts and never calls the controller collector", {
  skip: process.platform !== "darwin", timeout: 30_000,
}, async () => {
  const fixture = await remoteFixture({ platform: { modelReadiness: {
    collect: async () => { throw new Error("Controller readiness is forbidden for the selected generated SSH owner."); },
  } } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const preload = join(fixture.directory, "generated-readiness-os.mjs");
    await writeFile(preload, [
      'import os from "node:os"; import fs from "node:fs/promises"; import { syncBuiltinESMExports } from "node:module";',
      'os.platform = () => "linux"; os.arch = () => "x64"; os.release = () => "6.18.5";',
      "os.totalmem = () => 112 * 1024 ** 3; os.freemem = () => 56 * 1024 ** 3; os.availableParallelism = () => 4;",
      "fs.statfs = async () => ({ type: 0n, bsize: 4096n, blocks: 2097152n, bfree: 1048576n, bavail: 1048576n, files: 1024n, ffree: 1000n });",
      `const blocked = new Set(${JSON.stringify([...LOCAL_RUNTIME_PROBE_LOCATIONS.map((entry) => entry.path), "/usr/bin/nvidia-smi", "/usr/sbin/system_profiler"])});`,
      'for (const name of ["lstat", "realpath"]) { const original = fs[name]; fs[name] = async (path, ...args) => { if (blocked.has(String(path))) throw Object.assign(new Error("Generated missing readiness fixture"), { code: "ENOENT" }); return original(path, ...args); }; }',
      "syncBuiltinESMExports();",
    ].join("\n"), { mode: 0o600 });
    const settings = sdk.settings.get()!, remote = settings.values.remote;
    assert.ok(remote);
    const bridge = remote.command.at(-1);
    assert.ok(bridge);
    await sdk.settings.update({ ...settings.values, remote: {
      ...remote, allowCopilot: false, command: [...remote.command.slice(0, -1), "--import", pathToFileURL(preload).href, bridge],
      models: [{ id: "generated-readiness", name: "Generated SSH readiness", baseUrl: `${fixture.baseUrl}/v1`, enabled: true, auth: "none",
        models: [{ id: fixture.modelId, name: "Generated SSH readiness model", contextWindow: 16384, maxTokens: 128, imageInput: false }] }],
    } }, settings.revision);
    await fixture.probe(); await sdk.refresh();
    await sdk.command({ type: "session.configure", sessionId: fixture.sessionId, expectedRevision: fixture.session().revision,
      controls: { ...fixture.session().controls, env: "Remote" } });
    const model = sdk.models.catalogue().models.flatMap((entry) => entry.offerings)
      .find((entry) => entry.model.source === "local" && entry.model.environments?.includes("Remote"))?.model;
    assert.ok(model);
    const { target } = await sdk.models.readinessTarget(fixture.sessionId, model.id);
    const { readiness } = await sdk.models.readiness(fixture.sessionId, model.id);
    assert.equal(target.env, "Remote");
    assert.equal(target.peerDigest, frameDigest({ hostKey: remote.hostKey }));
    assert.deepEqual(readiness.target, target);
    assert.equal(readiness.observations.host.operatingSystem.value, "linux");
    assert.equal(readiness.observations.host.architecture.value, "x64");
    assert.equal(readiness.observations.host.ramBytes.value, 112 * 1024 ** 3);
    assert.equal(readiness.observations.host.freeRamBytes.value, 56 * 1024 ** 3);
    assert.equal(readiness.observations.host.diskBytes.value, 8 * 1024 ** 3);
    assert.equal(readiness.observations.host.freeDiskBytes.value, 4 * 1024 ** 3);
    assert.equal(readiness.capacity.status, "unknown");
    assert.equal(fixture.session().controls.modelId, null);
    assert.equal(fixture.requests.length, 0);
    assert.equal(fixture.controller.snapshot().executions.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});
