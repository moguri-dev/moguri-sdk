import assert from "node:assert/strict";
import test from "node:test";
import { Value } from "typebox/value";
import {
  LocalRuntimeConfigurationSchema, ModelRequirementsSchema, ModelReadinessQuerySchema,
  ModelReadinessCollectionInputSchema, ModelReadinessEvaluationInputSchema, ModelReadinessProbeLimitsSchema,
  type ModelReadinessObservations, type ModelRequirements, type ReadinessEvidence,
} from "../packages/protocol/src/model-readiness.ts";
import { evaluateModelReadiness } from "../apps/service/src/model-readiness.ts";

const digest = "a".repeat(64);
const provenance = {
  kind: "user-supplied-model-requirements" as const, actor: "user" as const,
  sourceDigest: digest, recordedAt: "2026-11-05T18:00:00.000Z",
};
const GiB = 1024 ** 3;
const evidence = (source: ReadinessEvidence["source"], code = "generated-observation"): ReadinessEvidence => ({
  kind: "observed", source, code, detail: "Generated fixture observation; not live hardware or inference.",
});

test("transport-safe readiness inputs encode bounded observations without client-controlled shell or Node handles", () => {
  const target = {
    profileId: "generated-profile", sessionId: "generated-session", modelId: "generated-model", env: "Remote",
    rootDigest: digest, peerDigest: digest, buildDigest: digest, endpointBindingDigest: digest, modelBindingDigest: digest,
  };
  assert.equal(Value.Check(ModelReadinessCollectionInputSchema, {
    target, storagePath: "/generated/captured-root", runtime: { kind: "llama-cpp", executablePath: "/generated/llama-cli" },
    requirements: requirements(), mode: "informational",
  }), true);
  assert.equal(Value.Check(ModelReadinessEvaluationInputSchema, {
    observations: observations(), requirements: requirements(), mode: "required",
  }), true);
  assert.equal(Value.Check(ModelReadinessProbeLimitsSchema, {
    timeoutMs: 10_000, probeTimeoutMs: 3000, maxOutputBytes: 128 * 1024, maxExecutableBytes: 128 * 1024 ** 2, maxAgeMs: 300_000,
  }), true);
  for (const limits of [{ timeoutMs: 10_001 }, { probeTimeoutMs: 3001 }, { maxOutputBytes: 128 * 1024 + 1 },
    { maxExecutableBytes: 128 * 1024 ** 2 + 1 }, { maxAgeMs: 300_001 }, { signal: {} }, { command: "serve" }])
    assert.equal(Value.Check(ModelReadinessProbeLimitsSchema, limits), false);
});
function observations(): ModelReadinessObservations {
  const number = (value: number, source: ReadinessEvidence["source"] = "node-os") => ({
    status: "observed" as const, value, evidence: evidence(source),
  });
  const text = (value: string) => ({ status: "observed" as const, value, evidence: evidence("node-os") });
  const file = {
    status: "observed" as const, sizeBytes: 32, sha256: digest, identityDigest: "b".repeat(64),
    evidence: evidence("fixed-file-metadata"),
  };
  return {
    host: {
      operatingSystem: text("darwin"), architecture: text("arm64"), osRelease: text("25.0.0"),
      ramBytes: number(32 * GiB), freeRamBytes: number(16 * GiB),
      diskBytes: number(512 * GiB, "node-statfs"), freeDiskBytes: number(256 * GiB, "node-statfs"),
    },
    runtime: {
      kind: "ollama", source: "configured", locationDigest: digest, executable: file,
      version: { ...text("0.12.3"), evidence: evidence("reviewed-runtime-version") },
      binary: { format: "mach-o", architectures: ["arm64"], evidence: evidence("executable-header") },
    },
    discovered: [],
    model: {
      file: { ...file, sizeBytes: 8 * GiB, sha256: null },
      format: { ...text("gguf"), evidence: evidence("model-header") }, formatVersion: 3,
    },
    accelerators: [{
      kind: "metal", slot: 0, support: "observed", memoryKind: "dedicated",
      driverVersion: { ...text("3.1.0"), evidence: evidence("macos-displays") },
      vramBytes: number(12 * GiB, "macos-displays"), freeVramBytes: number(10 * GiB, "macos-displays"),
      evidence: evidence("macos-displays"),
    }],
    acceleratorEvidence: evidence("macos-displays"),
  };
}
function requirements(): ModelRequirements {
  return {
    provenance, runtimeKinds: ["ollama"], minimumRuntimeVersion: "0.12.0",
    operatingSystems: ["darwin"], architectures: ["arm64"], accelerator: "metal",
    minimumDriverVersion: "3.0.0", minimumRamBytes: 16 * GiB, minimumFreeRamBytes: 8 * GiB,
    minimumVramBytes: 8 * GiB, minimumFreeVramBytes: 8 * GiB,
    minimumDiskBytes: 256 * GiB, minimumFreeDiskBytes: 32 * GiB,
    modelFormat: "gguf", minimumModelBytes: GiB, maximumModelBytes: 10 * GiB,
  };
}

test("readiness schemas separate explicit requirements from runtime configuration and forbid executable arguments", () => {
  assert.equal(Value.Check(LocalRuntimeConfigurationSchema, {
    kind: "ollama", executablePath: "/usr/local/bin/ollama", modelPath: "/generated/model.gguf",
  }), true);
  assert.equal(Value.Check(ModelRequirementsSchema, {
    provenance, operatingSystems: ["darwin"], architectures: ["arm64"], accelerator: "metal",
    minimumRamBytes: 8 * 1024 ** 3, minimumFreeDiskBytes: 4 * 1024 ** 3, modelFormat: "gguf",
  }), true);
  assert.equal(Value.Check(ModelReadinessQuerySchema, {
    type: "model.readiness", sessionId: "generated-session", modelId: "generated-model",
  }), true);
  for (const configuration of [
    { kind: "ollama", executablePath: "ollama" },
    { kind: "ollama", executablePath: "/generated/ollama", args: ["serve"] },
    { kind: "other", executablePath: "/generated/runtime" },
    { modelPath: "/generated/model\n.gguf" },
  ]) assert.equal(Value.Check(LocalRuntimeConfigurationSchema, configuration), false);
  assert.equal(Value.Check(ModelRequirementsSchema, { minimumRamBytes: 1 }), false);
  assert.equal(Value.Check(ModelRequirementsSchema, { provenance: { ...provenance, actor: "model" } }), false);
  assert.equal(Value.Check(ModelReadinessQuerySchema, {
    type: "model.readiness", sessionId: "generated-session", modelId: "generated-model", mode: "automatic",
  }), false);
});

test("pure evaluation compares explicit OS, architecture, runtime, driver and same-device capacity requirements", () => {
  const observed = observations(), declared = requirements();
  const evaluation = evaluateModelReadiness(observed, declared, "required");
  assert.equal(evaluation.status, "satisfied");
  assert.equal(evaluation.requiredSatisfied, true);
  for (const id of ["runtime", "runtime-os", "runtime-architecture", "runtime-version", "model-file", "model-format",
    "model-size", "operating-system", "architecture", "accelerator", "driver", "ram", "free-ram", "vram",
    "free-vram", "disk", "free-disk"]) assert.equal(evaluation.checks.find((check) => check.id === id)?.status, "pass", id);
  assert.equal(evaluateModelReadiness(observed, declared).requiredSatisfied, null);
  assert.equal("executionPermission" in evaluation, false);
});

test("reviewed llama build thresholds are explicit bounded requirements, never invented semantic versions", () => {
  const { minimumRuntimeVersion: _version, ...base } = requirements();
  const declared = { ...base, runtimeKinds: ["llama-cpp" as const], minimumRuntimeBuild: 9911 };
  assert.equal(Value.Check(ModelRequirementsSchema, declared), true);
  const observed = observations();
  observed.runtime!.kind = "llama-cpp";
  observed.runtime!.version.value = "build:9911@abcdef01234567";
  assert.equal(evaluateModelReadiness(observed, declared, "required").requiredSatisfied, true);
  const below = evaluateModelReadiness(observed, { ...declared, minimumRuntimeBuild: 9912 }, "required");
  assert.equal(below.checks.find((check) => check.id === "runtime-build")?.status, "fail");
  assert.equal(below.requiredSatisfied, false);
  for (const value of ["9911.0.0", "build:9911", "build:9911@UNKNOWN", null]) {
    observed.runtime!.version.value = value;
    const result = evaluateModelReadiness(observed, declared, "required");
    assert.equal(result.checks.find((check) => check.id === "runtime-build")?.status, "unknown");
    assert.equal(result.requiredSatisfied, false);
  }
  for (const minimumRuntimeBuild of [-1, 0.1, 1_000_000_000_000])
    assert.equal(Value.Check(ModelRequirementsSchema, { ...declared, minimumRuntimeBuild }), false);
});

test("unknown executable identity and undeclared model compatibility cannot become required readiness", () => {
  const observed = observations();
  observed.runtime!.executable.sha256 = null;
  const identity = evaluateModelReadiness(observed, requirements(), "required");
  assert.equal(identity.checks.find((check) => check.id === "runtime")?.status, "unknown");
  assert.equal(identity.requiredSatisfied, false);
  const { modelFormat: _format, ...noFormat } = requirements();
  const unspecified = evaluateModelReadiness(observations(), noFormat, "required");
  assert.equal(unspecified.checks.find((check) => check.id === "model-format")?.status, "unknown");
  const unqualified = observations(); unqualified.runtime!.kind = "ds4";
  const ds4 = evaluateModelReadiness(unqualified, { ...requirements(), runtimeKinds: ["ds4"] }, "required");
  assert.equal(ds4.checks.find((check) => check.id === "model-format")?.status, "unknown");
  assert.equal(ds4.requiredSatisfied, false);
});

test("missing/incompatible observations and explicit RAM, VRAM, storage and driver shortages never pass", () => {
  const changes: Array<{ id: string; change: (value: ModelReadinessObservations) => void }> = [
    { id: "runtime", change: (value) => { value.runtime!.executable.status = "missing"; } },
    { id: "runtime-os", change: (value) => { value.runtime!.binary.format = "elf"; } },
    { id: "runtime-architecture", change: (value) => { value.runtime!.binary.architectures = ["x64"]; } },
    { id: "runtime-version", change: (value) => { value.runtime!.version.value = "0.1.0"; } },
    { id: "operating-system", change: (value) => { value.host.operatingSystem.value = "linux"; } },
    { id: "architecture", change: (value) => { value.host.architecture.value = "x64"; } },
    { id: "driver", change: (value) => { value.accelerators[0]!.driverVersion.value = "2.0.0"; } },
    { id: "ram", change: (value) => { value.host.ramBytes.value = 4 * GiB; } },
    { id: "free-ram", change: (value) => { value.host.freeRamBytes.value = GiB; } },
    { id: "vram", change: (value) => { value.accelerators[0]!.vramBytes.value = 4 * GiB; } },
    { id: "free-vram", change: (value) => { value.accelerators[0]!.freeVramBytes.value = GiB; } },
    { id: "disk", change: (value) => { value.host.diskBytes.value = 64 * GiB; } },
    { id: "free-disk", change: (value) => { value.host.freeDiskBytes.value = GiB; } },
    { id: "model-size", change: (value) => { value.model!.file.sizeBytes = 12 * GiB; } },
  ];
  for (const { id, change } of changes) {
    const observed = observations(); change(observed);
    const result = evaluateModelReadiness(observed, requirements(), "required");
    assert.equal(result.checks.find((check) => check.id === id)?.status, "fail", id);
    assert.equal(result.status, "incompatible", id);
    assert.equal(result.requiredSatisfied, false, id);
  }
  const observed = observations(), first = observed.accelerators[0]!;
  observed.accelerators = [
    { ...first, vramBytes: { ...first.vramBytes, value: 12 * GiB }, freeVramBytes: { ...first.freeVramBytes, value: GiB } },
    { ...first, slot: 1, vramBytes: { ...first.vramBytes, value: 4 * GiB }, freeVramBytes: { ...first.freeVramBytes, value: 4 * GiB } },
  ];
  assert.equal(evaluateModelReadiness(observed, requirements(), "required").requiredSatisfied, false);
});

test("estimated or declared hardware/version facts cannot satisfy required readiness as observations", () => {
  for (const change of [
    (value: ModelReadinessObservations) => { value.host.ramBytes.evidence.kind = "estimated"; },
    (value: ModelReadinessObservations) => { value.runtime!.version.evidence.kind = "declared"; },
    (value: ModelReadinessObservations) => { value.runtime!.binary.evidence.kind = "declared"; },
    (value: ModelReadinessObservations) => { value.accelerators[0]!.evidence.kind = "declared"; },
    (value: ModelReadinessObservations) => { value.accelerators[0]!.vramBytes.evidence.kind = "estimated"; },
  ]) {
    const observed = observations(); change(observed);
    assert.equal(evaluateModelReadiness(observed, requirements(), "required").requiredSatisfied, false);
  }
  assert.equal(evaluateModelReadiness(observations(), undefined, "required").requiredSatisfied, false);
  assert.equal(evaluateModelReadiness(observations(), { provenance }, "required").requiredSatisfied, false);
});

test("explicit unsupported model-format requirements are representable rather than inferred from filenames", () => {
  const declared = { ...requirements(), modelFormat: "safetensors" as const };
  assert.equal(Value.Check(ModelRequirementsSchema, declared), true);
  assert.equal(evaluateModelReadiness(observations(), declared, "required").checks.find((check) => check.id === "model-format")?.status, "fail");
});
