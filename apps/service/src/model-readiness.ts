import { createHash } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import { lstat, open, realpath, statfs } from "node:fs/promises";
import os from "node:os";
import { dirname, isAbsolute, normalize } from "node:path";
import { gte, valid } from "semver";
import { isRecord, parse } from "../../../packages/protocol/src/core.ts";
import {
  ModelReadinessObservationsSchema, ModelRequirementsSchema, LocalRuntimeConfigurationSchema,
  LocalRuntimeExecutableReviewSchema, ModelReadinessReportSchema, ModelReadinessTargetSchema,
  ModelReadinessCollectionInputSchema, ModelReadinessEvaluationInputSchema,
  ReadinessOperatingSystemSchema, ReadinessArchitectureSchema, modelReadinessTargetsMatch, isModelReadinessReportCurrent,
  type ModelReadinessObservations, type ModelReadinessEvaluation, type ModelReadinessMode,
  type ModelRequirements, type ModelReadinessCheck, type ReadinessEvidence,
  type ReadinessNumberFact, type ReadinessTextFact, type ReadinessAcceleratorObservation,
  type ModelReadinessReport, type ModelReadinessTarget, type LocalRuntimeConfiguration,
  type LocalRuntimeExecutableReview, type LocalRuntimeKind, type RuntimeReadinessObservation,
  type ReadinessOperatingSystem, type ReadinessArchitecture,
  type ModelReadinessCollectionInput,
} from "../../../packages/protocol/src/model-readiness.ts";
import { Value } from "typebox/value";
import { runProgram } from "./program.ts";

export type { ModelReadinessCollectionInput } from "../../../packages/protocol/src/model-readiness.ts";

const basis = (kind: ReadinessEvidence["kind"], source: ReadinessEvidence["source"], code: string, detail: string): ReadinessEvidence =>
  ({ kind, source, code, detail });
const undeclared = basis("unknown", "requirements", "requirement-not-supplied", "No requirement was supplied; no threshold was inferred.");
const unobserved = basis("unknown", "not-probed", "not-observed", "The required observation is unavailable; absence is not success.");
const versionMatches = (observed: string | null, minimum: string) =>
  observed !== null && valid(observed) && valid(minimum) ? gte(observed, minimum) : null;
function driverVersionMatches(observed: string | null, minimum: string): boolean | null {
  const parts = (value: string | null) => value && /^\d{1,8}(?:\.\d{1,8}){1,3}$/.test(value) ? value.split(".").map(Number) : null;
  const actual = parts(observed), expected = parts(minimum);
  if (!actual || !expected) return null;
  for (let index = 0; index < Math.max(actual.length, expected.length); index++) {
    if ((actual[index] ?? 0) !== (expected[index] ?? 0)) return (actual[index] ?? 0) > (expected[index] ?? 0);
  }
  return true;
}
const amountMatches = (fact: ReadinessNumberFact, minimum: number | undefined) =>
  minimum === undefined || fact.status === "observed" && fact.evidence.kind === "observed" && fact.value !== null && fact.value >= minimum;

export function evaluateModelReadiness(
  observations: ModelReadinessObservations, requirements?: ModelRequirements, mode: ModelReadinessMode = "informational",
): ModelReadinessEvaluation {
  parse(ModelReadinessEvaluationInputSchema, { observations, ...(requirements ? { requirements } : {}), mode });
  parse(ModelReadinessObservationsSchema, observations);
  if (requirements) parse(ModelRequirementsSchema, requirements);
  const checks: ModelReadinessCheck[] = [];
  const add = (id: string, status: ModelReadinessCheck["status"], observed: string | null, expected: string | null,
    evidence: ReadinessEvidence, required = true) => checks.push({ id, status, required, observed, expected, evidence });
  const numberCheck = (id: string, fact: ReadinessNumberFact | undefined, minimum: number | undefined) => {
    if (minimum === undefined) { add(id, "not-requested", null, null, undeclared, false); return; }
    add(id, !fact || fact.status !== "observed" || fact.evidence.kind !== "observed" || fact.value === null ? "unknown" : fact.value >= minimum ? "pass" : "fail",
      fact?.value === undefined || fact.value === null ? null : String(fact.value), `at least ${minimum} bytes`, fact?.evidence ?? unobserved);
  };
  const textCheck = (id: string, fact: ReadinessTextFact, expected: readonly string[] | undefined) => {
    if (!expected) { add(id, "not-requested", null, null, undeclared, false); return; }
    add(id, fact.status !== "observed" || fact.evidence.kind !== "observed" || fact.value === null ? "unknown" : expected.includes(fact.value) ? "pass" : "fail",
      fact.value, expected.join(", "), fact.evidence);
  };
  const runtime = observations.runtime, model = observations.model;
  const fileCheck = (id: string, file: NonNullable<ModelReadinessObservations["model"]>["file"] | undefined) =>
    add(id, !file || file.status === "unknown" || file.status === "observed" &&
      (file.evidence.kind !== "observed" || !file.identityDigest || id === "runtime" && !file.sha256) ? "unknown" : file.status === "observed" ? "pass" : "fail",
      file?.status ?? null, "observed regular canonical file", file?.evidence ?? unobserved);
  fileCheck("runtime", runtime?.executable);
  if (runtime && requirements?.runtimeKinds && !requirements.runtimeKinds.includes(runtime.kind))
    add("runtime-kind", "fail", runtime.kind, requirements.runtimeKinds.join(", "), basis("declared", "requirements", "runtime-kind-mismatch", "The configured runtime kind does not match the user-supplied requirement."));
  const container = runtime?.binary.format, os = observations.host.operatingSystem.value;
  const expectedContainer = os === "darwin" ? "mach-o" : os === "linux" ? "elf" : os === "win32" ? "pe" : null;
  add("runtime-os", !container || container === "unknown" || !expectedContainer || runtime?.binary.evidence.kind !== "observed" ||
    observations.host.operatingSystem.status !== "observed" || observations.host.operatingSystem.evidence.kind !== "observed" ? "unknown" : container === expectedContainer ? "pass" : "fail",
    container ?? null, expectedContainer, runtime?.binary.evidence ?? unobserved);
  const architectures = runtime?.binary.architectures, arch = observations.host.architecture.value;
  add("runtime-architecture", !architectures?.length || !arch || runtime?.binary.evidence.kind !== "observed" ||
    observations.host.architecture.status !== "observed" || observations.host.architecture.evidence.kind !== "observed" ? "unknown" : architectures.some((value) => value === arch) ? "pass" : "fail",
    architectures?.join(", ") ?? null, arch, runtime?.binary.evidence ?? unobserved);
  const runtimeVersion = runtime?.version, minimumVersion = requirements?.minimumRuntimeVersion;
  const versionMatch = minimumVersion ? versionMatches(runtimeVersion?.value ?? null, minimumVersion) : true;
  add("runtime-version", runtimeVersion?.status !== "observed" || runtimeVersion.evidence.kind !== "observed" || runtimeVersion.value === null || versionMatch === null ? "unknown" : versionMatch ? "pass" : "fail",
    runtimeVersion?.value ?? null, minimumVersion ? `at least ${minimumVersion}` : "reviewed version observation", runtimeVersion?.evidence ?? unobserved);
  const minimumBuild = requirements?.minimumRuntimeBuild;
  const build = runtime?.kind === "llama-cpp" && runtimeVersion?.status === "observed" && runtimeVersion.evidence.kind === "observed" &&
    runtimeVersion.evidence.source === "reviewed-runtime-version" ? /^build:(\d{1,12})@[a-f0-9]{7,40}$/.exec(runtimeVersion.value ?? "") : null;
  add("runtime-build", minimumBuild === undefined ? "not-requested" : !build ? "unknown" : Number(build[1]) >= minimumBuild ? "pass" : "fail",
    build?.[1] ?? null, minimumBuild === undefined ? null : `at least llama.cpp build ${minimumBuild}`,
    runtimeVersion?.evidence ?? undeclared, minimumBuild !== undefined);
  fileCheck("model-file", model?.file);
  add("model-format", !model || model.format.status !== "observed" || model.format.evidence.kind !== "observed" || model.format.value === null || !requirements?.modelFormat ? "unknown" :
    model.format.value !== requirements.modelFormat ? "fail" : !runtime || runtime.kind === "ds4" ? "unknown" : "pass",
  model?.format.value ?? null, requirements?.modelFormat ?? null,
  runtime?.kind === "ds4" ? basis("unknown", "not-probed", "runtime-model-compatibility-unqualified", "DS4 model-format compatibility has no qualified read-only observation.") :
    model?.format.evidence ?? unobserved);
  const modelSize = model?.file.sizeBytes, minModel = requirements?.minimumModelBytes, maxModel = requirements?.maximumModelBytes;
  add("model-size", minModel === undefined && maxModel === undefined ? "not-requested" : model?.file.status !== "observed" || model.file.evidence.kind !== "observed" || modelSize === null || modelSize === undefined ? "unknown" :
    (minModel === undefined || modelSize >= minModel) && (maxModel === undefined || modelSize <= maxModel) ? "pass" : "fail",
  modelSize === undefined || modelSize === null ? null : String(modelSize),
  minModel === undefined && maxModel === undefined ? null : `${minModel ?? 0}..${maxModel ?? Number.MAX_SAFE_INTEGER} bytes`,
  model?.file.evidence ?? unobserved, minModel !== undefined || maxModel !== undefined);
  if (requirements?.modelSha256) {
    add("model-digest", model?.file.evidence.kind === "observed" && model.file.sha256 ? model.file.sha256 === requirements.modelSha256 ? "pass" : "fail" : "unknown",
      model?.file.sha256 ?? null, requirements.modelSha256, model?.file.evidence ?? unobserved);
  }
  add("requirements", requirements && Object.keys(requirements).length > 1 ? "pass" : "unknown", requirements ? "user-supplied" : null,
    "explicit provenance-bearing model requirements", requirements ? basis("declared", "requirements", "user-requirements", "Requirements are user-supplied declarations, not observed model performance.") : undeclared);
  textCheck("operating-system", observations.host.operatingSystem, requirements?.operatingSystems);
  textCheck("architecture", observations.host.architecture, requirements?.architectures);
  numberCheck("ram", observations.host.ramBytes, requirements?.minimumRamBytes);
  numberCheck("free-ram", observations.host.freeRamBytes, requirements?.minimumFreeRamBytes);
  numberCheck("disk", observations.host.diskBytes, requirements?.minimumDiskBytes);
  numberCheck("free-disk", observations.host.freeDiskBytes, requirements?.minimumFreeDiskBytes);
  const matches = observations.accelerators.filter((device) => device.kind === requirements?.accelerator);
  const satisfies = (device: ReadinessAcceleratorObservation) => device.support === "observed" && device.evidence.kind === "observed" &&
    amountMatches(device.vramBytes, requirements?.minimumVramBytes) && amountMatches(device.freeVramBytes, requirements?.minimumFreeVramBytes) &&
    (!requirements?.minimumDriverVersion || device.driverVersion.status === "observed" && device.driverVersion.evidence.kind === "observed" && driverVersionMatches(device.driverVersion.value, requirements.minimumDriverVersion) === true);
  const accelerator = matches.find(satisfies) ?? matches[0];
  add("accelerator", !requirements?.accelerator ? "not-requested" : !accelerator || accelerator.support === "unknown" || accelerator.evidence.kind !== "observed" ? "unknown" :
    accelerator.support === "observed" ? "pass" : "fail",
  accelerator ? `${accelerator.kind}; device ${accelerator.slot}` : null, requirements?.accelerator ?? null,
  accelerator?.evidence ?? observations.acceleratorEvidence, Boolean(requirements?.accelerator));
  const driverMinimum = requirements?.minimumDriverVersion, driver = accelerator?.driverVersion;
  const driverMatch = driverMinimum ? driverVersionMatches(driver?.value ?? null, driverMinimum) : null;
  add("driver", !driverMinimum ? "not-requested" : driver?.status !== "observed" || driver.evidence.kind !== "observed" || driverMatch === null ? "unknown" : driverMatch ? "pass" : "fail",
    driver?.value ?? null, driverMinimum ? `at least ${driverMinimum}` : null, driver?.evidence ?? undeclared, Boolean(driverMinimum));
  numberCheck("vram", accelerator?.vramBytes, requirements?.minimumVramBytes);
  numberCheck("free-vram", accelerator?.freeVramBytes, requirements?.minimumFreeVramBytes);
  const required = checks.filter((check) => check.required);
  const status = required.some((check) => check.status === "fail") ? "incompatible" :
    required.some((check) => check.status === "unknown") ? "unknown" : "satisfied";
  return { status, requiredSatisfied: mode === "required" ? status === "satisfied" : null, checks };
}

export type ModelReadinessErrorCode = "model_readiness_invalid" | "model_readiness_cancelled" | "model_readiness_timeout" |
  "model_readiness_output_limit" | "model_readiness_stale" | "model_readiness_probe_failed" | "model_readiness_provenance";
export class ModelReadinessError extends Error {
  constructor(public readonly code: ModelReadinessErrorCode, message: string) { super(message); }
}
export class ReadinessProbeFailure extends Error {
  constructor(public readonly code: "unavailable" | "exited-nonzero") {
    super("The exact bounded read-only probe failed; raw process diagnostics are not report evidence.");
  }
}
const admittedNodeProbes = new WeakSet<ReadinessProbeRequest>();
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const safeInteger = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const hexadecimal = (value: string | null): boolean => value === null || typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export function modelReadinessConfigurationDigest(runtime?: LocalRuntimeConfiguration): string {
  if (runtime) parse(LocalRuntimeConfigurationSchema, runtime);
  return hash(JSON.stringify({ kind: runtime?.kind ?? null, executablePath: runtime?.executablePath ?? null, modelPath: runtime?.modelPath ?? null }));
}
export const READINESS_FILE_DIAGNOSTICS = [
  "file-observed", "file-missing", "file-access-denied", "file-alias-refused", "file-path-not-canonical",
  "file-not-regular", "file-size-unrepresentable", "executable-identity-size-limit", "file-changed",
] as const;
export type ReadinessFileDiagnostic = typeof READINESS_FILE_DIAGNOSTICS[number];
export const READINESS_STORAGE_DIAGNOSTICS = [
  "storage-observed", "storage-root-not-canonical", "storage-alias-refused", "storage-counters-inconsistent",
  "storage-counter-unrepresentable", "storage-missing", "storage-access-denied",
] as const;
export type ReadinessStorageDiagnostic = typeof READINESS_STORAGE_DIAGNOSTICS[number];
export interface ReadinessFileInspection {
  status: "observed" | "missing" | "unknown" | "refused"; code: ReadinessFileDiagnostic;
  sizeBytes: number | null; sha256: string | null; identityDigest: string | null;
  header: Uint8Array; executionSafe: boolean;
}
export interface ReadinessFileSystem {
  inspect(path: string, options: { signal: AbortSignal; hash: boolean; headerBytes: number; maxHashBytes: number }): Promise<ReadinessFileInspection>;
  storage(path: string, signal: AbortSignal): Promise<ReadinessStorageInspection>;
}
export interface ReadinessStorageInspection { totalBytes: number | null; availableBytes: number | null; code: ReadinessStorageDiagnostic }
export interface ReadinessHostFacts {
  operatingSystem: string; architecture: string; osRelease: string | null;
  ramBytes: number | null; freeRamBytes: number | null; cpuAvailable: boolean | null;
}
export type ReadinessProbeRequest = {
  executablePath: string; signal: AbortSignal; timeoutMs: number; maxOutputBytes: number;
} & (
  { id: "llama-cpp-version"; args: readonly ["--version"] } |
  { id: "macos-displays"; args: readonly ["-json", "SPDisplaysDataType", "-detailLevel", "mini"] } |
  { id: "nvidia-gpu"; args: readonly ["--query-gpu=driver_version,memory.total,memory.free", "--format=csv,noheader,nounits"] }
);
export interface ReadinessProbeSuite {
  target: ModelReadinessTarget; files: ReadinessFileSystem;
  hostFacts(signal: AbortSignal): Promise<ReadinessHostFacts>;
  run(request: ReadinessProbeRequest): Promise<string>;
}
export type ReadinessExecutingBoundary = {
  rootDigest: string; buildDigest: string; assertCurrent(): void;
} & (
  { kind: "pinned-ssh-bridge"; env: "Remote"; peerDigest: string } |
  { kind: "active-sealed-native"; env: "Sandbox"; peerDigest: string | null }
);
export interface ModelReadinessCollectionOptions {
  signal: AbortSignal; probes?: ReadinessProbeSuite; executableReview?: LocalRuntimeExecutableReview;
  now?: () => number; currentTarget?: () => ModelReadinessTarget;
  timeoutMs?: number; probeTimeoutMs?: number; maxOutputBytes?: number; maxExecutableBytes?: number; maxAgeMs?: number;
}
export const LOCAL_RUNTIME_PROBE_LOCATIONS: ReadonlyArray<{ operatingSystem: ReadinessOperatingSystem; kind: LocalRuntimeKind; path: string }> = [
  { operatingSystem: "darwin", kind: "ollama", path: "/Applications/Ollama.app/Contents/Resources/ollama" },
  { operatingSystem: "darwin", kind: "ollama", path: "/usr/local/bin/ollama" },
  { operatingSystem: "darwin", kind: "ollama", path: "/opt/homebrew/bin/ollama" },
  { operatingSystem: "darwin", kind: "llama-cpp", path: "/usr/local/bin/llama-cli" },
  { operatingSystem: "darwin", kind: "llama-cpp", path: "/opt/homebrew/bin/llama-cli" },
  { operatingSystem: "darwin", kind: "ds4", path: "/usr/local/bin/ds4-server" },
  { operatingSystem: "darwin", kind: "ds4", path: "/opt/homebrew/bin/ds4-server" },
  { operatingSystem: "linux", kind: "ollama", path: "/usr/bin/ollama" },
  { operatingSystem: "linux", kind: "ollama", path: "/usr/local/bin/ollama" },
  { operatingSystem: "linux", kind: "llama-cpp", path: "/usr/bin/llama-cli" },
  { operatingSystem: "linux", kind: "llama-cpp", path: "/usr/local/bin/llama-cli" },
  { operatingSystem: "linux", kind: "ds4", path: "/usr/bin/ds4-server" },
  { operatingSystem: "linux", kind: "ds4", path: "/usr/local/bin/ds4-server" },
  { operatingSystem: "win32", kind: "ollama", path: "C:\\Program Files\\Ollama\\ollama.exe" },
];
const numberFact = (value: number | null, source: ReadinessEvidence["source"], code: string, detail: string): ReadinessNumberFact =>
  ({ status: value === null ? "unknown" : "observed", value, evidence: basis(value === null ? "unknown" : "observed", source, code, detail) });
const textFact = (value: string | null, source: ReadinessEvidence["source"], code: string, detail: string): ReadinessTextFact =>
  ({ status: value === null ? "unknown" : "observed", value, evidence: basis(value === null ? "unknown" : "observed", source, code, detail) });
function binaryHeader(header: Uint8Array): RuntimeReadinessObservation["binary"] {
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  let format: RuntimeReadinessObservation["binary"]["format"] = "unknown", architectures: ReadinessArchitecture[] = [];
  const machine = (value: number, kind: "elf" | "mach-o" | "pe"): ReadinessArchitecture | undefined =>
    kind === "elf" ? value === 62 ? "x64" : value === 183 ? "arm64" : value === 3 ? "ia32" : value === 40 ? "arm" : undefined :
      kind === "mach-o" ? value === 0x1000007 ? "x64" : value === 0x100000c ? "arm64" : value === 7 ? "ia32" : value === 12 ? "arm" : undefined :
        value === 0x8664 ? "x64" : value === 0xaa64 ? "arm64" : value === 0x14c ? "ia32" : undefined;
  if (header.length >= 20 && header[0] === 0x7f && header[1] === 0x45 && header[2] === 0x4c && header[3] === 0x46 &&
    (header[4] === 1 || header[4] === 2) && (header[5] === 1 || header[5] === 2)) {
    format = "elf"; const architecture = machine(view.getUint16(18, header[5] === 1), "elf"); if (architecture) architectures = [architecture];
  } else if (header.length >= 8 && [0xfeedface, 0xfeedfacf].includes(view.getUint32(0, true))) {
    format = "mach-o"; const architecture = machine(view.getUint32(4, true), "mach-o"); if (architecture) architectures = [architecture];
  } else if (header.length >= 8 && [0xcafebabe, 0xcafebabf].includes(view.getUint32(0))) {
    const count = view.getUint32(4), stride = view.getUint32(0) === 0xcafebabf ? 32 : 20;
    if (count > 0 && count <= 8 && header.length >= 8 + count * stride) {
      format = "mach-o";
      for (let index = 0; index < count; index++) {
        const architecture = machine(view.getUint32(8 + index * stride), "mach-o");
        if (architecture && !architectures.includes(architecture)) architectures.push(architecture);
      }
    }
  } else if (header.length >= 64 && header[0] === 0x4d && header[1] === 0x5a) {
    const offset = view.getUint32(60, true);
    if (offset <= header.length - 6 && view.getUint32(offset, true) === 0x4550) {
      format = "pe"; const architecture = machine(view.getUint16(offset + 4, true), "pe"); if (architecture) architectures = [architecture];
    }
  }
  return { format, architectures, evidence: basis(format === "unknown" || !architectures.length ? "unknown" : "observed", "executable-header",
    format === "unknown" ? "executable-header-unqualified" : "executable-header-observed", "Bounded executable-container/header observation only; ABI, libraries and inference remain untested.") };
}
const fileFact = (file: ReadinessFileInspection) => ({
  status: file.status, sizeBytes: file.sizeBytes, sha256: file.sha256, identityDigest: file.identityDigest,
  evidence: basis(file.status === "observed" ? "observed" : "unknown", "fixed-file-metadata", file.code,
    file.status === "observed" ? "Exact canonical regular-file metadata was observed; file identity is not model quality." :
      "The exact file is missing, inaccessible, aliased or changed; no implicit executable was substituted."),
});
function runtimeObservation(kind: LocalRuntimeKind, path: string, source: RuntimeReadinessObservation["source"], file: ReadinessFileInspection): RuntimeReadinessObservation {
  return { kind, source, locationDigest: hash(path), executable: fileFact(file), binary: binaryHeader(file.header),
    version: textFact(null, "reviewed-runtime-version", "runtime-version-not-reviewed", "No qualified actual-user-reviewed offline runtime version probe was dispatched.") };
}
async function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  const stopped = () => signal.reason instanceof ModelReadinessError ? signal.reason :
    new ModelReadinessError("model_readiness_cancelled", "Readiness collection was cancelled; no fresh report was published.");
  if (signal.aborted) throw stopped();
  let cancel: () => void = () => {};
  const interruption = new Promise<never>((_resolve, reject) => { cancel = () => reject(stopped()); signal.addEventListener("abort", cancel, { once: true }); });
  try { return await Promise.race([operation, interruption]); }
  finally { signal.removeEventListener("abort", cancel); }
}
function bounded(value: number | undefined, fallback: number, maximum: number, label: string): number {
  const actual = value ?? fallback;
  if (!Number.isSafeInteger(actual) || actual < 1 || actual > maximum)
    throw new ModelReadinessError("model_readiness_invalid", `${label} exceeds the qualified readiness bound.`);
  return actual;
}
const exactPath = (path: string) => isAbsolute(path) && normalize(path) === path && path.length <= 4096 && !/[\u0000-\u001f\u007f]/.test(path);
const metadataKey = (metadata: BigIntStats) => JSON.stringify({
  device: String(metadata.dev), inode: String(metadata.ino), mode: String(metadata.mode), uid: String(metadata.uid),
  size: String(metadata.size), modified: String(metadata.mtimeNs), changed: String(metadata.ctimeNs),
});
const unavailableFile = (code: ReadinessFileDiagnostic, status: ReadinessFileInspection["status"] = "unknown"): ReadinessFileInspection =>
  ({ status, code, sizeBytes: null, sha256: null, identityDigest: null, header: new Uint8Array(), executionSafe: false });
const errorCode = (error: unknown) => error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : null;
function fileError(error: unknown): ReadinessFileInspection {
  if (error instanceof ModelReadinessError) throw error;
  const code = errorCode(error);
  if (code === "ENOENT" || code === "ENOTDIR") return unavailableFile("file-missing", "missing");
  if (code === "EACCES" || code === "EPERM") return unavailableFile("file-access-denied");
  if (code === "ELOOP") return unavailableFile("file-alias-refused", "refused");
  throw new ModelReadinessError("model_readiness_probe_failed", "Canonical file metadata could not be collected; raw filesystem diagnostics were discarded.");
}
function assertSignal(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason instanceof ModelReadinessError ? signal.reason :
    new ModelReadinessError("model_readiness_cancelled", "Readiness collection was cancelled; no fresh report was published.");
}
async function immutableExecutable(path: string, metadata: BigIntStats, signal: AbortSignal): Promise<boolean> {
  if (process.platform === "win32" || metadata.uid !== 0n || metadata.mode & 0o022n || !(metadata.mode & 0o111n)) return false;
  let parent = dirname(path);
  for (let depth = 0; depth < 32; depth++) {
    assertSignal(signal);
    const directory = await abortable(lstat(parent, { bigint: true }), signal);
    if (!directory.isDirectory() || directory.isSymbolicLink() || directory.uid !== 0n || directory.mode & 0o022n) return false;
    const next = dirname(parent); if (next === parent) return true; parent = next;
  }
  return false;
}
export function createNodeReadinessFileSystem(): ReadinessFileSystem {
  return {
    async inspect(path, options) {
      assertSignal(options.signal);
      bounded(options.headerBytes, 8, 4096, "File header");
      bounded(options.maxHashBytes, 128 * 1024 * 1024, 128 * 1024 * 1024, "Executable identity read");
      if (!exactPath(path)) return unavailableFile("file-path-not-canonical", "refused");
      try {
        const metadata = await abortable(lstat(path, { bigint: true }), options.signal);
        if (metadata.isSymbolicLink()) return unavailableFile("file-alias-refused", "refused");
        if (!metadata.isFile()) return unavailableFile("file-not-regular", "refused");
        if (await abortable(realpath(path), options.signal) !== path) return unavailableFile("file-alias-refused", "refused");
        if (metadata.size > BigInt(Number.MAX_SAFE_INTEGER)) return unavailableFile("file-size-unrepresentable");
        if (options.hash && metadata.size > BigInt(options.maxHashBytes)) return unavailableFile("executable-identity-size-limit");
        assertSignal(options.signal);
        const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        try {
          assertSignal(options.signal);
          const initial = await abortable(file.stat({ bigint: true }), options.signal), original = metadataKey(metadata);
          if (!initial.isFile() || metadataKey(initial) !== original) return unavailableFile("file-changed", "refused");
          const header = Buffer.alloc(Math.min(Number(initial.size), options.headerBytes));
          if (header.length) {
            const read = await abortable(file.read(header, 0, header.length, 0), options.signal);
            if (read.bytesRead !== header.length) return unavailableFile("file-changed", "refused");
          }
          let sha256: string | null = null;
          if (options.hash) {
            const digest = createHash("sha256"), buffer = Buffer.alloc(64 * 1024);
            let position = 0;
            while (position < Number(initial.size)) {
              assertSignal(options.signal);
              const wanted = Math.min(buffer.length, Number(initial.size) - position);
              const read = await abortable(file.read(buffer, 0, wanted, position), options.signal);
              if (read.bytesRead !== wanted) return unavailableFile("file-changed", "refused");
              digest.update(buffer.subarray(0, read.bytesRead)); position += read.bytesRead;
            }
            sha256 = digest.digest("hex");
          }
          const final = await abortable(file.stat({ bigint: true }), options.signal);
          const current = await abortable(lstat(path, { bigint: true }), options.signal);
          if (metadataKey(final) !== original || metadataKey(current) !== original || current.isSymbolicLink() ||
            await abortable(realpath(path), options.signal) !== path) return unavailableFile("file-changed", "refused");
          const executionSafe = await immutableExecutable(path, final, options.signal);
          return { status: "observed", code: "file-observed", sizeBytes: Number(final.size), sha256,
            identityDigest: hash(original), header, executionSafe };
        } finally {
          try { await file.close(); }
          catch { throw new ModelReadinessError("model_readiness_probe_failed", "The read-only file descriptor did not close cleanly; no report was published."); }
        }
      } catch (error) { return fileError(error); }
    },
    async storage(path, signal) {
      assertSignal(signal);
      if (!exactPath(path)) return { totalBytes: null, availableBytes: null, code: "storage-root-not-canonical" };
      try {
        const directory = await abortable(lstat(path, { bigint: true }), signal);
        if (!directory.isDirectory() || directory.isSymbolicLink() || await abortable(realpath(path), signal) !== path)
          return { totalBytes: null, availableBytes: null, code: "storage-alias-refused" };
        const value = await abortable(statfs(path, { bigint: true }), signal);
        const total = value.blocks * value.bsize, available = value.bavail * value.bsize;
        const safe = (bytes: bigint) => bytes >= 0n && bytes <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(bytes) : null;
        return available > total ? { totalBytes: null, availableBytes: null, code: "storage-counters-inconsistent" } :
          { totalBytes: safe(total), availableBytes: safe(available), code: safe(total) === null || safe(available) === null ? "storage-counter-unrepresentable" : "storage-observed" };
      } catch (error) {
        if (error instanceof ModelReadinessError) throw error;
        const code = errorCode(error);
        if (code === "ENOENT" || code === "ENOTDIR") return { totalBytes: null, availableBytes: null, code: "storage-missing" };
        if (code === "EACCES" || code === "EPERM") return { totalBytes: null, availableBytes: null, code: "storage-access-denied" };
        if (code === "ELOOP") return { totalBytes: null, availableBytes: null, code: "storage-alias-refused" };
        throw new ModelReadinessError("model_readiness_probe_failed", "The exact captured filesystem counters could not be read; no fallback root or raw diagnostic was used.");
      }
    },
  };
}
function nodeProcessProbes(target: ModelReadinessTarget): ReadinessProbeSuite {
  return {
    target, files: createNodeReadinessFileSystem(),
    async hostFacts(signal) {
      assertSignal(signal);
      const parallelism = os.availableParallelism();
      return {
        operatingSystem: os.platform(), architecture: os.arch(), osRelease: os.release(),
        ramBytes: os.totalmem(), freeRamBytes: os.freemem(),
        cpuAvailable: Number.isSafeInteger(parallelism) && parallelism > 0 ? true : null,
      };
    },
    async run(request) {
      assertSignal(request.signal);
      if (!admittedNodeProbes.delete(request)) throw new ModelReadinessError("model_readiness_provenance",
        "Node readiness execution requires a fresh collector-admitted exact probe; direct or replayed runner calls are not authorized.");
      try {
        return await runProgram(request.executablePath, [...request.args], {
          cwd: "/", signal: request.signal, timeoutMs: request.timeoutMs, maxBytes: request.maxOutputBytes,
          label: "Model readiness fixed read-only probe", env: { PATH: "/usr/bin:/bin", HOME: "/", LANG: "C", LC_ALL: "C", NO_COLOR: "1" },
        });
      } catch (error) {
        assertSignal(request.signal);
        const code = errorCode(error);
        if (code === "program_unavailable") throw new ReadinessProbeFailure("unavailable");
        if (code === "program_failed") throw new ReadinessProbeFailure("exited-nonzero");
        if (code === "program_partial" && error instanceof Error && error.message.includes("Output limit exceeded"))
          throw new ModelReadinessError("model_readiness_output_limit", "The read-only probe exceeded its output bound; truncated or partial work is not a report.");
        if (code === "program_partial" && error instanceof Error && error.message.includes("Deadline exceeded"))
          throw new ModelReadinessError("model_readiness_timeout", "The read-only probe exceeded its deadline; cleanup or late work is not a successful report.");
        throw new ModelReadinessError("model_readiness_probe_failed", "The read-only probe failed or cleanup was unconfirmed; raw process diagnostics were discarded.");
      }
    },
  };
}
function nodeProbeSuite(target: ModelReadinessTarget): ReadinessProbeSuite {
  if (target.env !== "Local") throw new ModelReadinessError("model_readiness_provenance",
    "Remote/Sandbox readiness requires an injected pinned peer/native probe suite; controller facts are never substituted.");
  return nodeProcessProbes(target);
}
export function createExecutingNodeReadinessProbeSuite(target: ModelReadinessTarget, boundary: ReadinessExecutingBoundary): ReadinessProbeSuite {
  const captured = Object.freeze(structuredClone(parse(ModelReadinessTargetSchema, target)));
  const verify = () => {
    const actualEnv = boundary.kind === "pinned-ssh-bridge" ? "Remote" : boundary.kind === "active-sealed-native" ? "Sandbox" : null;
    if (!actualEnv || boundary.env !== actualEnv || captured.env !== actualEnv ||
      typeof boundary.rootDigest !== "string" || !hexadecimal(boundary.rootDigest) || boundary.rootDigest !== captured.rootDigest ||
      typeof boundary.buildDigest !== "string" || !hexadecimal(boundary.buildDigest) || boundary.buildDigest !== captured.buildDigest ||
      !hexadecimal(boundary.peerDigest) || boundary.peerDigest !== captured.peerDigest ||
      actualEnv === "Remote" && boundary.peerDigest === null || typeof boundary.assertCurrent !== "function")
      throw new ModelReadinessError("model_readiness_provenance", "The independently verified executing Env/root/peer/build does not own this exact target; no Local relabel or fallback was used.");
    try {
      const asserted: unknown = boundary.assertCurrent();
      if (asserted !== undefined) throw new ModelReadinessError("model_readiness_provenance", "Executing ownership must be synchronously revalidated, not supplied as a boolean or model decision.");
    } catch {
      throw new ModelReadinessError("model_readiness_provenance", "Actual pinned SSH or active sealed-native ownership is no longer confirmed; no raw diagnostic or fresh report was published.");
    }
  };
  const observe = async <T>(operation: () => Promise<T>): Promise<T> => {
    verify();
    try { return await operation(); }
    finally { verify(); }
  };
  verify();
  const node = nodeProcessProbes(captured);
  return {
    target: captured,
    files: {
      inspect: (path, options) => observe(() => node.files.inspect(path, options)),
      storage: (path, signal) => observe(() => node.files.storage(path, signal)),
    },
    hostFacts: (signal) => observe(() => node.hostFacts(signal)),
    run: (request) => observe(() => node.run(request)),
  };
}
function nvidiaDevices(output: string): { devices: ReadinessAcceleratorObservation[]; evidence: ReadinessEvidence } {
  const unknown = (code: string) => ({ devices: [], evidence: basis("unknown", "nvidia-smi", code, "The bounded local NVIDIA output did not provide a complete recognized device inventory; no driver or memory was inferred.") });
  const lines = output.trim().split(/\r?\n/);
  if (!output.trim() || lines.length > 15) return unknown("nvidia-device-inventory-unqualified");
  const devices: ReadinessAcceleratorObservation[] = [];
  for (const [slot, line] of lines.entries()) {
    const fields = /^\s*(\d{1,8}(?:\.\d{1,8}){1,3})\s*,\s*(\d{1,12}|N\/A)\s*,\s*(\d{1,12}|N\/A)\s*$/.exec(line);
    if (!fields) return unknown("nvidia-output-unrecognized");
    const memory = (field: string) => { const value = Number(field) * 1024 ** 2; return /^\d+$/.test(field) && safeInteger(value) ? value : null; };
    let total = memory(fields[2]!), free = memory(fields[3]!);
    const inconsistent = total !== null && free !== null && free > total;
    if (inconsistent) { total = null; free = null; }
    devices.push({
      kind: "cuda", slot, support: "observed", memoryKind: "dedicated",
      driverVersion: textFact(fields[1]!, "nvidia-smi", "nvidia-driver-observed", "Exact local NVIDIA driver version field; CUDA kernels, toolkit and runtime integration remain untested."),
      vramBytes: numberFact(total, "nvidia-smi", inconsistent ? "gpu-memory-inconsistent" : "nvidia-vram-observation", "Per-device NVIDIA memory.total in documented MiB; GPU capacities are never pooled."),
      freeVramBytes: numberFact(free, "nvidia-smi", inconsistent ? "gpu-memory-inconsistent" : "nvidia-free-vram-observation", "Per-device point-in-time memory.free in MiB, not reserved or guaranteed allocatable memory."),
      evidence: basis("observed", "nvidia-smi", "nvidia-device-observed", "Local driver/device inventory only; no server, model, network or inference probe ran."),
    });
  }
  return { devices, evidence: basis("observed", "nvidia-smi", "nvidia-inventory-observed", "Bounded local NVIDIA driver/device fields were observed and all raw output was discarded.") };
}
function metalDevices(output: string): { devices: ReadinessAcceleratorObservation[]; evidence: ReadinessEvidence } {
  const unknown = (code: string) => ({ devices: [], evidence: basis("unknown", "macos-displays", code, "No recognized bounded Metal inventory was available; macOS alone does not prove accelerator support.") });
  let decoded: unknown;
  try { decoded = JSON.parse(output); }
  catch (error) { if (error instanceof SyntaxError) return unknown("macos-display-json-invalid"); throw error; }
  if (!isRecord(decoded) || !Array.isArray(decoded.SPDisplaysDataType) || decoded.SPDisplaysDataType.length > 15)
    return unknown("macos-display-inventory-unqualified");
  const devices: ReadinessAcceleratorObservation[] = [];
  for (const [slot, value] of decoded.SPDisplaysDataType.entries()) {
    if (!isRecord(value)) return unknown("macos-display-inventory-unqualified");
    const shared = Object.hasOwn(value, "spdisplays_vram_shared");
    const supported = typeof value.spdisplays_metal === "string" && /^(?:spdisplays_metal(?:\d+|_supported)|Metal [1-9]\d*|Supported)$/.test(value.spdisplays_metal);
    const memory = typeof value.spdisplays_vram === "string" ? /^(\d{1,12})\s*(bytes|KiB|MiB|GiB|TiB)$/.exec(value.spdisplays_vram) : null;
    const units: Record<string, number> = { bytes: 1, KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3, TiB: 1024 ** 4 };
    const amount = memory ? Number(memory[1]) * units[memory[2]!]! : null;
    const total = !shared && safeInteger(amount) ? amount : null;
    devices.push({
      kind: "metal", slot, support: supported ? "observed" : "unknown",
      memoryKind: shared ? "unified" : total !== null ? "dedicated" : "unknown",
      driverVersion: textFact(null, "macos-displays", "metal-driver-version-unavailable", "Metal API capability is not an OS driver version; no driver version was guessed."),
      vramBytes: numberFact(total, "macos-displays", shared ? "unified-memory-not-vram" : total !== null ? "metal-vram-observed" : "metal-vram-units-unknown",
        "Only explicit binary-unit dedicated VRAM is accepted. Shared RAM and ambiguous GB/MB labels are not dedicated VRAM."),
      freeVramBytes: numberFact(null, "macos-displays", "metal-free-vram-unavailable", "This read-only display probe does not expose free VRAM; no estimate was invented."),
      evidence: basis(supported ? "observed" : "unknown", "macos-displays", supported ? "metal-support-observed" : "metal-support-unknown",
        "Only the explicit local Metal support field is used; chip names, serials, displays and other raw metadata are discarded."),
    });
  }
  return { devices, evidence: basis("observed", "macos-displays", "macos-display-inventory-observed", "Only bounded local display/Metal fields were observed; no GPU kernel or model was executed.") };
}
export async function collectModelReadiness(input: ModelReadinessCollectionInput, options: ModelReadinessCollectionOptions): Promise<ModelReadinessReport> {
  const captured = structuredClone(parse(ModelReadinessCollectionInputSchema, input));
  const target = captured.target, runtime = captured.runtime, requirements = captured.requirements, mode = captured.mode ?? "informational";
  if (!exactPath(captured.storagePath))
    throw new ModelReadinessError("model_readiness_invalid", "Readiness storage observation requires the exact captured canonical root.");
  if (runtime?.executablePath && !exactPath(runtime.executablePath) || runtime?.modelPath && !exactPath(runtime.modelPath))
    throw new ModelReadinessError("model_readiness_invalid", "Runtime and model observations require exact canonical locations; no alias or normalized fallback was used.");
  const probes = options.probes ?? nodeProbeSuite(target);
  if (!modelReadinessTargetsMatch(probes.target, target))
    throw new ModelReadinessError("model_readiness_provenance", "The read-only probe suite must belong to the exact owning target; no Local fallback was used.");
  const timeoutMs = bounded(options.timeoutMs, 10_000, 10_000, "Total deadline");
  const probeTimeoutMs = bounded(options.probeTimeoutMs, Math.min(3000, timeoutMs), Math.min(3000, timeoutMs), "Probe deadline");
  const maxOutputBytes = bounded(options.maxOutputBytes, 64 * 1024, 128 * 1024, "Probe output");
  const maxExecutableBytes = bounded(options.maxExecutableBytes, 128 * 1024 * 1024, 128 * 1024 * 1024, "Executable identity read");
  const maxAgeMs = bounded(options.maxAgeMs, 60_000, 300_000, "Report freshness");
  const now = options.now ?? Date.now, observedAt = now(), deadline = new AbortController();
  if (!safeInteger(observedAt)) throw new ModelReadinessError("model_readiness_invalid", "The observation clock is invalid.");
  const timer = setTimeout(() => deadline.abort(new ModelReadinessError("model_readiness_timeout", "Readiness collection exceeded its total deadline; cleanup or late work is not a successful report.")), timeoutMs);
  const signal = AbortSignal.any([options.signal, deadline.signal]);
  const assertCurrent = () => {
    if (signal.aborted) throw signal.reason instanceof ModelReadinessError ? signal.reason :
      new ModelReadinessError("model_readiness_cancelled", "Readiness collection was cancelled; no fresh report was published.");
    if (!modelReadinessTargetsMatch(probes.target, target) || options.currentTarget && !modelReadinessTargetsMatch(options.currentTarget(), target))
      throw new ModelReadinessError("model_readiness_stale", "Readiness ownership changed; no old-target report was published.");
  };
  const inspect = async (path: string, shouldHash: boolean, headerBytes: number) => {
    assertCurrent();
    const file = await abortable(probes.files.inspect(path, { signal, hash: shouldHash, headerBytes, maxHashBytes: maxExecutableBytes }), signal);
    assertCurrent();
    if (!(file.header instanceof Uint8Array) || file.header.byteLength > headerBytes || typeof file.executionSafe !== "boolean" ||
      !["observed", "missing", "unknown", "refused"].includes(file.status) || !READINESS_FILE_DIAGNOSTICS.includes(file.code) ||
      file.sizeBytes !== null && !safeInteger(file.sizeBytes) || !hexadecimal(file.sha256) || !hexadecimal(file.identityDigest) ||
      file.status === "observed" && (file.sizeBytes === null || file.identityDigest === null ||
        shouldHash && (file.sha256 === null || file.sizeBytes > maxExecutableBytes) || !shouldHash && file.sha256 !== null) ||
      file.status !== "observed" && (file.sizeBytes !== null || file.sha256 !== null || file.identityDigest !== null || file.header.byteLength !== 0 || file.executionSafe))
      throw new ModelReadinessError("model_readiness_probe_failed", "The file observer returned invalid or unbounded metadata; no report was published.");
    return file;
  };
  const runProbe = async (request: ReadinessProbeRequest, file: ReadinessFileInspection): Promise<{ output: string | null; failureCode: string | null }> => {
    const before = await inspect(request.executablePath, true, 4096);
    if (!before.executionSafe || before.sha256 !== file.sha256 || before.identityDigest !== file.identityDigest)
      throw new ModelReadinessError("model_readiness_stale", "The exact read-only probe executable changed before dispatch; no fallback was used.");
    const deadline = new AbortController(), probeSignal = AbortSignal.any([signal, deadline.signal]);
    const timer = setTimeout(() => deadline.abort(new ModelReadinessError("model_readiness_timeout", "The read-only probe deadline expired; late or unconfirmed cleanup is not a successful report.")), probeTimeoutMs);
    const admitted: ReadinessProbeRequest = Object.freeze({ ...request, signal: probeSignal });
    Object.freeze(admitted.args); admittedNodeProbes.add(admitted);
    try {
      let output: string | null = null, failureCode: string | null = null;
      try { output = await abortable(probes.run(admitted), probeSignal); }
      catch (error) {
        if (!(error instanceof ReadinessProbeFailure)) throw error;
        failureCode = error.code === "unavailable" ? "probe-unavailable" : "probe-exit-failed";
      }
      assertCurrent();
      if (output !== null && (typeof output !== "string" || Buffer.byteLength(output) > maxOutputBytes))
        throw new ModelReadinessError("model_readiness_output_limit", "Readiness probe output exceeded its bound; no truncated success was published.");
      const after = await inspect(request.executablePath, true, 4096);
      if (!after.executionSafe || after.sha256 !== file.sha256 || after.identityDigest !== file.identityDigest)
        throw new ModelReadinessError("model_readiness_stale", "The exact probe executable changed during observation; no report was published.");
      return { output, failureCode };
    } finally { admittedNodeProbes.delete(admitted); clearTimeout(timer); }
  };
  try {
    assertCurrent();
    const facts = await abortable(probes.hostFacts(signal), signal); assertCurrent();
    const os = Value.Check(ReadinessOperatingSystemSchema, facts.operatingSystem) ? facts.operatingSystem : null;
    const architecture = Value.Check(ReadinessArchitectureSchema, facts.architecture) ? facts.architecture : null;
    const storage = await abortable(probes.files.storage(captured.storagePath, signal), signal); assertCurrent();
    if (!READINESS_STORAGE_DIAGNOSTICS.includes(storage.code) || storage.totalBytes !== null && !safeInteger(storage.totalBytes) ||
      storage.availableBytes !== null && !safeInteger(storage.availableBytes))
      throw new ModelReadinessError("model_readiness_probe_failed", "The storage observer returned invalid counters or a diagnostic outside the supported vocabulary; no report was published.");
    const inconsistentMemory = safeInteger(facts.ramBytes) && safeInteger(facts.freeRamBytes) && facts.freeRamBytes > facts.ramBytes;
    const inconsistentStorage = safeInteger(storage.totalBytes) && safeInteger(storage.availableBytes) && storage.availableBytes > storage.totalBytes;
    const observations: ModelReadinessObservations = {
      host: {
        operatingSystem: textFact(os, "node-os", os ? "os-observed" : "os-unsupported", "Actual execution-host OS; no host name or machine identifier was collected."),
        architecture: textFact(architecture, "node-os", architecture ? "architecture-observed" : "architecture-unsupported", "Actual execution-host process architecture; translation and model ABI remain untested."),
        osRelease: textFact(facts.osRelease && /^\d+(?:\.\d+){1,3}(?:-\d+)?$/.test(facts.osRelease) ? facts.osRelease : null, "node-os", "os-release-observation", "Only a non-identifying numeric OS/kernel release is retained; custom labels and driver versions are not inferred."),
        ramBytes: numberFact(safeInteger(facts.ramBytes) ? facts.ramBytes : null, "node-os", "system-memory-observation", "Observed system memory, not an allocatable/model-capacity guarantee."),
        freeRamBytes: numberFact(safeInteger(facts.freeRamBytes) && !inconsistentMemory ? facts.freeRamBytes : null, "node-os", inconsistentMemory ? "free-memory-inconsistent" : "free-memory-observation", "Point-in-time OS free memory, not a reserved allocation; inconsistent counters remain unknown."),
        diskBytes: numberFact(safeInteger(storage.totalBytes) && !inconsistentStorage ? storage.totalBytes : null, "node-statfs", inconsistentStorage ? "storage-counters-inconsistent" : storage.code, "Observed capacity of the exact captured root's filesystem; the path is omitted."),
        freeDiskBytes: numberFact(safeInteger(storage.availableBytes) && !inconsistentStorage ? storage.availableBytes : null, "node-statfs", inconsistentStorage ? "storage-counters-inconsistent" : storage.code, "Point-in-time filesystem bytes available to the caller, not a disk reservation."),
      },
      runtime: null, discovered: [], model: null, accelerators: [],
      acceleratorEvidence: basis("unknown", "not-probed", "accelerator-probe-unqualified", "No supported accelerator/driver observation was available; platform names never prove GPU support."),
    };
    if (facts.cpuAvailable !== null) observations.accelerators.push({
      kind: "cpu", slot: 0, support: facts.cpuAvailable ? "observed" : "missing", memoryKind: "unknown",
      driverVersion: textFact(null, "node-os", "cpu-driver-not-applicable", "CPU presence does not imply a GPU driver."),
      vramBytes: numberFact(null, "node-os", "cpu-vram-not-applicable", "CPU/system RAM is not dedicated VRAM."),
      freeVramBytes: numberFact(null, "node-os", "cpu-vram-not-applicable", "CPU/system RAM is not dedicated free VRAM."),
      evidence: basis("observed", "node-os", "cpu-presence-observed", "Host CPU scheduling availability only; runtime kernels and inference were not tested."),
    });
    if (os === "darwin" || os === "linux") {
      const executablePath = os === "darwin" ? "/usr/sbin/system_profiler" : "/usr/bin/nvidia-smi";
      const file = await inspect(executablePath, true, 4096), binary = binaryHeader(file.header);
      if (file.status === "observed" && file.executionSafe && file.sha256 && file.identityDigest &&
        binary.format === (os === "darwin" ? "mach-o" : "elf") && binary.architectures.some((value) => value === architecture)) {
        const result = await runProbe(os === "darwin" ? { id: "macos-displays", executablePath, signal, timeoutMs: probeTimeoutMs,
          maxOutputBytes, args: ["-json", "SPDisplaysDataType", "-detailLevel", "mini"] } :
          { id: "nvidia-gpu", executablePath, signal, timeoutMs: probeTimeoutMs, maxOutputBytes,
            args: ["--query-gpu=driver_version,memory.total,memory.free", "--format=csv,noheader,nounits"] }, file);
        if (result.output !== null) {
          const hardware = os === "darwin" ? metalDevices(result.output) : nvidiaDevices(result.output);
          observations.accelerators.push(...hardware.devices); observations.acceleratorEvidence = hardware.evidence;
        } else observations.acceleratorEvidence = basis("unknown", os === "darwin" ? "macos-displays" : "nvidia-smi",
          result.failureCode ?? "probe-failed", "The exact read-only hardware probe failed; absence of valid output is unknown, not unsupported hardware or success.");
      } else observations.acceleratorEvidence = basis("unknown", os === "darwin" ? "macos-displays" : "nvidia-smi",
        "accelerator-executable-unavailable", "The exact supported system probe is missing, aliased, mutable or incompatible; no PATH lookup or alternative executable ran.");
    }
    for (const location of LOCAL_RUNTIME_PROBE_LOCATIONS.filter((location) => location.operatingSystem === os)) {
      const file = await inspect(location.path, false, 4096);
      observations.discovered.push(runtimeObservation(location.kind, location.path, "known-location", file));
    }
    const configurationDigest = modelReadinessConfigurationDigest(runtime);
    if (runtime?.kind && runtime.executablePath) {
      const file = await inspect(runtime.executablePath, true, 4096);
      observations.runtime = runtimeObservation(runtime.kind, runtime.executablePath, "configured", file);
      const review = options.executableReview;
      const reviewed = review && Value.Check(LocalRuntimeExecutableReviewSchema, review) && review.configurationDigest === configurationDigest &&
        modelReadinessTargetsMatch(review.target, target) && review.runtimeKind === runtime.kind &&
        review.executableLocationDigest === hash(runtime.executablePath) && review.executableSha256 === file.sha256 &&
        review.executableIdentityDigest === file.identityDigest && Date.parse(review.reviewedAt) <= observedAt;
      if (runtime.kind !== "llama-cpp") observations.runtime.version = textFact(null, "reviewed-runtime-version",
        runtime.kind === "ollama" ? "ollama-offline-version-unqualified" : "ds4-offline-version-unqualified",
        "This runtime's version switch is not qualified as offline/non-starting; metadata-only discovery never contacts a server.");
      else if (reviewed && file.status === "observed" && file.executionSafe && (os === "linux" || os === "darwin") &&
        observations.runtime.binary.format === (os === "linux" ? "elf" : "mach-o") &&
        observations.runtime.binary.architectures.some((value) => value === architecture)) {
        const result = await runProbe({ id: "llama-cpp-version", executablePath: runtime.executablePath,
          args: ["--version"], signal, timeoutMs: probeTimeoutMs, maxOutputBytes }, file);
        const versions = (result.output ?? "").split(/\r?\n/).map((line) => /^version:\s*(\d{1,12})\s*\(([a-f0-9]{7,40})\)$/.exec(line.trim())).filter((value) => value !== null);
        const version = versions.length === 1 ? `build:${versions[0]![1]}@${versions[0]![2]}` : null;
        observations.runtime.version = textFact(version, "reviewed-runtime-version", result.failureCode ?? (version ? "runtime-build-observed" : "runtime-version-output-unrecognized"),
          "Only an exact bounded version/build field is retained; raw output, environment and machine/user identifiers are discarded.");
      } else if (reviewed && !file.executionSafe) observations.runtime.version = textFact(null, "reviewed-runtime-version", "runtime-executable-mutable",
        "Executable/ancestor immutability is unconfirmed; even a reviewed user-writable file is metadata-only without a race-free executor.");
    }
    if (runtime?.modelPath) {
      const file = await inspect(runtime.modelPath, false, 8), view = new DataView(file.header.buffer, file.header.byteOffset, file.header.byteLength);
      const magic = file.header.length >= 8 && view.getUint32(0, true) === 0x46554747;
      const version = magic ? view.getUint32(4, true) : null, supported = version === 2 || version === 3;
      observations.model = { file: fileFact(file), formatVersion: version,
        format: textFact(file.status === "observed" && supported ? "gguf" : null, "model-header",
          supported ? "gguf-header-observed" : "model-header-unqualified",
          "Only the eight-byte GGUF v2/v3 header is observed; no tensors/weights are read, hashed, downloaded or loaded.") };
    }
    assertCurrent();
    const report: ModelReadinessReport = {
      format: "moguri-model-readiness", version: 1, readOnly: true, target, mode, configurationDigest,
      configuration: { kind: runtime?.kind ?? null, executableLocationDigest: runtime?.executablePath ? hash(runtime.executablePath) : null,
        modelLocationDigest: runtime?.modelPath ? hash(runtime.modelPath) : null },
      requirements: requirements ?? null, observations, evaluation: evaluateModelReadiness(observations, requirements, mode),
      freshness: { observedAt: new Date(observedAt).toISOString(), expiresAt: new Date(observedAt + maxAgeMs).toISOString(), maxAgeMs },
      capacity: { status: "unknown", estimatedMaxParameters: null, evidence: basis("unknown", "not-probed", "capacity-estimator-unqualified",
        "No qualified capacity/performance estimator ran. Declared byte thresholds, actual observations and estimates are different.") },
      warnings: [
        "Informational by default. This report never changes model availability, substitutes a provider or grants execution/provider permissions.",
        "Only explicit required-mode constraints are evaluated. Satisfaction is not inference, loaded-model health, quality or an allocation guarantee.",
      ],
    };
    parse(ModelReadinessReportSchema, report);
    if (!isModelReadinessReportCurrent(report, target, now()))
      throw new ModelReadinessError("model_readiness_stale", "Readiness evidence expired or the observation clock changed before publication; no fresh report was published.");
    return report;
  } catch (error) {
    if (error instanceof ModelReadinessError) throw error;
    throw new ModelReadinessError("model_readiness_probe_failed", "A read-only readiness observer failed; raw diagnostics were discarded and no report was published.");
  } finally { clearTimeout(timer); }
}
