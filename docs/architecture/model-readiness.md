# Bounded local-model runtime and hardware readiness

This is an informational, read-only service/SDK capability for the current macOS alpha.
It is not inference qualification or a claim that milestone 1 is complete.
Configured endpoint `/models` availability, installed runtime metadata, explicit
model requirements, hardware observations and capacity estimates are different
evidence. An otherwise usable endpoint is never disabled or replaced by these
primitives.

## Libraries and Phase 0

Reuse Node 26 built-ins and the existing `runProgram` supervision path (Node:
MIT), TypeBox (MIT), React (MIT) and `semver` (ISC). Tests additionally reuse
React DOM (MIT), esbuild (MIT) and the pinned TypeScript 7 API (Apache-2.0).
There is no new dependency, program supervisor, model transport, VT renderer,
installer or weights download. External runtime/driver executables are neither
bundled nor installed.

The coordinating task supplied this fresh generated-fixture Phase 0 run on
2026-11-05 after restoring missing dependencies with `npm ci`:

| Primitive | Result / measurement |
| --- | --- |
| Node | 26.12.0 |
| Provider cancellation | PASS fixtures; 31.72 ms |
| SQLite | PASS; 1,000 events, append p95 0.0716 ms, rebuild 0.765 ms |
| Owned PTY | PASS; 152.17 ms, zero known survivors |
| OpenTUI | PASS; 17.22 ms/update |
| Hidden Electron | PASS; startup 292.89 ms, RSS 450.02 MiB, frame 8.15 ms |

These measurements do not relabel historic generic-unavailable, live-provider,
Rust, Linux-release or native qualification rows. No personal credentials,
microphone, app, inference endpoint or model weights were used for this slice.

## Configuration, ownership and retention

`LocalRuntimeConfiguration` has optional `kind` (`ollama`, `llama-cpp`, `ds4`),
`executablePath` and `modelPath`. Paths must be exact absolute canonical
locations; neither PATH search nor normalized/symlink fallback is permitted.
The configured kind is a declaration, not proof of installation.

`ModelRequirements` requires provenance:
`{ kind: "user-supplied-model-requirements", actor: "user", sourceDigest,
recordedAt }`. Optional constraints are `runtimeKinds`,
`minimumRuntimeVersion`, `minimumRuntimeBuild`, `operatingSystems`, `architectures`, `accelerator`,
`minimumDriverVersion`, `minimumRamBytes`, `minimumFreeRamBytes`,
`minimumVramBytes`, `minimumFreeVramBytes`, `minimumDiskBytes`,
`minimumFreeDiskBytes`, `modelFormat` (`gguf` or `safetensors`),
`minimumModelBytes`, `maximumModelBytes` and `modelSha256`.
Absent constraints, unknown facts and estimates are never guessed as measured
capacity or quality.

The public observation query is
`{ type: "model.readiness", sessionId, modelId, mode?, runtimeReviewId? }`;
`model.readiness.target` resolves its original execution owner without hardware
programs. A runtime review ID refers only to the independently retained
actual-user command described below, never a caller-supplied review object.
The control plane must
capture the authenticated configuration, requirements and actual execution
owner independently. Its private collector input binds `profileId`,
`sessionId`, `modelId`, `env`, canonical `rootDigest`, nullable `peerDigest`,
`buildDigest`, `endpointBindingDigest` and `modelBindingDigest`. Binding digests
must cover the actual endpoint/model/configuration/requirements revision, not
an alias or a client-supplied owner claim. The binding includes hard-policy and
project revisions plus the captured SSH/native configuration. Storage identity
is captured independently from the execution root: replacing a configured
model directory, or creating a previously missing one, invalidates the target.

Reports are ephemeral observations, not stored hardware-health badges. Protocol92
adds `model_runtime_readiness_schema = 1` atomically with the pooled-controls
and candidate-transport markers during the genuine91 upgrade. Optional endpoint
runtime/model requirements use `settings.updated`; old fields retain their
meaning. Canonical `model.runtime_executable_reviewed` and
`model.runtime_review_consumed` events retain the exact one-use user review
and its consumption before I/O, not raw diagnostic output or RAM/GPU reports.
Missing/corrupt/premature markers fail closed, and newer settings or review
history cannot be relabelled91. Migration failure/reopen preserves original
ciphertext, identities, receipts, grants and unknown accounting. Restarting does
not reuse a prior report as current hardware evidence or replay a consumed grant.

Local collection has a Node default. Remote or Sandbox collection requires a
complete injected probe suite whose target matches the exact pinned SSH or
active sealed-native owner; controller host facts are never substituted.
`currentTarget()` must revalidate the authoritative owner before/after awaited
work. Canonical review, authentication, hard allowed-env policy and actual
peer/root/build provenance remain control-plane responsibilities.

`createExecutingNodeReadinessProbeSuite(target, boundary)` is the separate
caller-verified factory for the actual executing process. `boundary` is either
`{ kind: "pinned-ssh-bridge", env: "Remote", rootDigest, buildDigest, peerDigest,
assertCurrent }` or `{ kind: "active-sealed-native", env: "Sandbox", rootDigest,
buildDigest, peerDigest, assertCurrent }`. SSH peer digest is required; the
primitive permits a null native peer digest; the public service binds its
actual execution ID and qualified bridge digest. The independent Env/root/peer/build must match
the exact target. `assertCurrent(): void` synchronously checks live authenticated
ownership around every read/probe; it cannot be a boolean/model decision.

The boundary must come from real pinned BridgeInfo or active sealed-native
ownership on that executing process, never from `target.env`, endpoint names,
client JSON or a controller's alleged proof. Structural equality alone is not
authentication. This factory does not relabel Remote/native targets Local.
Default collection without an injected suite remains Local-only. Its Node
runner accepts only fresh, immutable collector-admitted requests, consumes
admission once and rejects direct/replayed calls that bypass runtime review,
metadata validation or fixed-argv admission.

## Probe scope and non-mutation boundary

`LOCAL_RUNTIME_PROBE_LOCATIONS` is a fixed metadata-only inventory:

| Platform | Known locations |
| --- | --- |
| macOS | Ollama application executable plus `/usr/local/bin/ollama` and `/opt/homebrew/bin/ollama`; `llama-cli` and `ds4-server` in the two named bin directories |
| Linux | `ollama`, `llama-cli`, `ds4-server` in `/usr/bin` and `/usr/local/bin` |
| Windows | `C:\Program Files\Ollama\ollama.exe` |

No home-directory enumeration, filesystem recursion, PATH lookup, network/host
scan, server health request, model listing, server start or inference is
dispatched. Discovering a file never selects it as the configured runtime.

Only these fixed commands are supported:

| Probe | Exact executable / argv |
| --- | --- |
| Reviewed llama.cpp build | Exact configured executable, `["--version"]` |
| macOS displays/Metal | `/usr/sbin/system_profiler`, `["-json", "SPDisplaysDataType", "-detailLevel", "mini"]` |
| Linux NVIDIA inventory | `/usr/bin/nvidia-smi`, `["--query-gpu=driver_version,memory.total,memory.free", "--format=csv,noheader,nounits"]` |

Runtime version execution additionally requires an independently retained
actual-user review binding the target, runtime kind, configuration digest,
exact location digest, SHA-256, filesystem identity and review digest/time.
The public query cannot supply or manufacture that review. A typed
`actor: "user"` value is not itself canonical user consent.

Executables must be canonical regular files with a recognized bounded
container/architecture header. Version/system execution also requires observed
root ownership, executable permissions and non-writable root-owned ancestors.
User-writable executables remain metadata-only even after review: this Node
checkpoint does not provide race-free arbitrary user-file execution.
Executable bytes/identity are checked before and after dispatch. Changed,
symlinked, missing, mutable or incompatible binaries do not cause fallback.
The remaining privileged-root replacement threat is not claimed solved.

Ollama and DS4 version switches are deliberately unqualified: an apparently
innocent switch may contact a server or start work. Their metadata discovery
does not execute those programs, and executable version remains unknown.
llama.cpp retains only a recognized exact build/version line from bounded
stdout. Empty, duplicate or unrecognized output, including a build available
only on stderr, stays unknown. No raw stdout/stderr is returned or persisted.
`minimumRuntimeBuild` compares the numeric part of an exact observed
`build:NUMBER@COMMIT` llama.cpp field. It does not convert build IDs into
semantic versions. `minimumRuntimeVersion` needs an actual observed semantic
version; unsupported runtime/version comparisons remain unknown.

## Observations, evaluation and bounds

Node supplies actual OS and process architecture, a conservative numeric
OS/kernel release, system/free memory and `statfs` counters for the exact
captured root. Architecture is the executing process ABI, not proof of physical
CPU/translation compatibility. Custom release labels, names, serials, usernames,
paths, credentials and other machine identifiers are omitted. Paths and
filesystem identities are represented by digests.

These are execution-host observations, not model-server capacity evidence.
Network/proxied endpoints must retain an explicit endpoint-host-unknown check
in the owning service wrapper. Even a loopback URL does not by itself prove
where inference runs. Observed host RAM/GPU fields cannot establish remote or
proxied model-server capacity; the capacity estimate remains unknown.

ELF, thin/universal Mach-O and bounded PE headers identify supported container
architectures, not ABI dependencies or working inference kernels. Model reads
are limited to the eight-byte GGUF v2/v3 header and regular-file size/identity.
Filename extensions never prove format. Safetensors, model architecture,
tensor metadata and requested whole-model SHA-256 remain unqualified/unknown;
no tensors or weight payloads are read or hashed.

Metal support requires an explicit observed display field. A Metal API level is
not a driver version. Shared/unified RAM is not dedicated VRAM; ambiguous GB/MB
strings and free Metal VRAM remain unknown. Only explicit binary-unit dedicated
VRAM is accepted. NVIDIA retains exact driver fields and per-device total/free
memory in the tool's documented MiB units. GPUs are never pooled, and one
device must satisfy the combined accelerator/driver/memory constraints.
Driver inventory does not qualify CUDA toolkit/runtime kernels.

Each fact/check has an explicit source, evidence kind, diagnostic code and
basis. Filesystem/storage adapters use the exported closed diagnostic
vocabularies, not raw exception messages. Contradictory counters, unsolicited
weight digests, oversized identities and malformed observer output cannot be
published as success. Unexpected errors fail explicitly; known unavailable or
nonzero probes produce an explanatory unknown, not a cached healthy result.

| Bound | Default / maximum |
| --- | --- |
| Total collection | 10 seconds / 10 seconds |
| Individual program | 3 seconds / 3 seconds, also bounded by total deadline |
| Program output | 64 KiB / 128 KiB per program, stdout and stderr bounded by `runProgram` |
| Executable identity read | 128 MiB per read / 128 MiB; repeated exact identity rechecks stay within the total deadline |
| Executable/model header | 4 KiB / 8 bytes |
| Accelerator records | At most 15 GPU/display entries plus the CPU record |
| Freshness | 60 seconds / 5 minutes |

Cancellation and deadline signals propagate to the existing supervisor and
injected observers. A timed-out/cancelled read returns no fresh report, even if
an observer later completes. Native filesystem operations may settle late, but
opened descriptors are closed rather than abandoned. This does not claim
complete detached/reparented descendant cleanup beyond the existing Node
supervisor. Unconfirmed cleanup and partial execution are never success.

`evaluateModelReadiness` is pure. It compares explicit requirements with actual
observations, keeps declared/estimated facts distinct, and returns
`status: "satisfied" | "incompatible" | "unknown"` plus per-check results.
Informational mode has `requiredSatisfied: null`. Explicit required mode returns
`false` for missing, incompatible or unknown required evidence, including
missing runtime identity/version/model format or absent requirements.
Unrequested optional constraints are labeled `not-requested`, not inferred.
`satisfied` is not loaded-model readiness, quality, budget admission, permission
or an allocation reservation. Capacity/performance estimates remain explicitly
unknown.

Freshness requires exact owner/binding equality, canonical timestamps, no
future observation, and a still-live expiration interval. Expiry or ownership
change during collection rejects publication. Clients and admission consumers
must recheck current authoritative ownership/freshness and use actual saved
requirements, not echoed client settings or a report as a permission grant.

## Actual-user workflow and transport

The shared SDK exposes `models.readinessTarget(sessionId, modelId, signal?)`
and `models.readiness(sessionId, modelId, mode?, signal?)`. Neither chooses a
model, enables an endpoint, starts a guest/server or calls inference.
`configuredReadinessModels(catalogue, env)` lists explicit enabled-endpoint
inventory, including unavailable or unselected models, without treating that
list as readiness.

Local observations use the exact managed root, captured Home or explicit
private model-only state. SSH binding and collection execute through the
original pinned worker/root, not the controller. Sandbox observations require
the original active qualified sealed guest; idle inspection never launches a
replacement guest. The current released native DNS/qualification gate remains
real. A native query cancellation names only its pending query ID and never
stops the parent model/guest. Late replies cannot become fresh evidence.

Version observation is a separate three-step workflow:

1. `models.runtimePreview(sessionId, modelId, signal?)` reads exact runtime
   metadata and returns the fixed command, SHA-256, filesystem identity,
   target and digest. Only configured compatible llama.cpp is eligible.
2. After actual-user source/byte review,
   `models.reviewRuntime(sessionId, modelId, expectedDigest)` recomputes that
   preview and atomically retains its canonical review with the user-command
   receipt. Client `actor` or executable/argv payloads are not accepted.
3. `models.readinessWithRuntimeReview(sessionId, modelId, reviewId, mode?,
   signal?)` validates the original review and consumes it before I/O. Both
   concurrent use and use after cancellation/restart fail without replay.
   Changed profile/session/root/build/configuration/policy or executable bytes
   need a fresh exact user review.

Script/plugin delegates cannot issue or consume these user reviews. The
user-only controller route, rather than a generic delegated query, owns the
attempt. Ordinary metadata refresh never reuses a saved approval or infers one
from autonomy, model advice or a previous successful report. An interrupted
approval may retain its original unused receipt; it does not dispatch a late
automatic program after the client abandons that scope.

Desktop exposes **Model / Model details and setup / Inspect configured model
without selecting it**. **Refresh readiness** is informational by default;
required mode rejects incomplete evidence. The exact version fieldset requires
**Approve once and read version**. A later ordinary refresh does not rerun it.
TUI **Ctrl+M** offers read-only inspection and a separate exact runtime review;
Tab switches the scrollable preview and choices, with cancellation selected
first. Esc/Ctrl+C inside that review cancels only its probe. Shared
`/model-readiness`, `/model-runtime-preview`, `/model-runtime-review` and
`/model-runtime-probe` commands use the same SDK. Ordered slash commands do not
borrow an ended native parent; the direct inspector handles an active one.

CLI equivalents are `moguri models readiness MODEL_ID [required]`,
`readiness-target MODEL_ID`, `runtime-preview MODEL_ID`,
`runtime-review MODEL_ID DIGEST --confirm-review` and
`runtime-probe MODEL_ID REVIEW_ID [required]`, each with `--session ID`.
No command installs a runtime/weight or starts a model.

## Integration API and cross-client contract

Protocol schemas/types are browser-safe and directly export:

- `ModelReadinessQuery`, `ModelReadinessTarget`,
  `LocalRuntimeExecutableReview`, `ModelReadinessCollectionInput`,
  `ModelReadinessEvaluationInput`, `ModelReadinessProbeLimits`;
- text/number/file facts, runtime/accelerator observations,
  `ModelReadinessObservations`, `ModelReadinessCheck`,
  `ModelReadinessEvaluation`, `ModelReadinessReport`;
- `ModelReadinessResponse = { type: "model.readiness", readiness: report }`,
  `ModelRuntimePreview`, canonical runtime-review record/consumption schemas,
  query/report guards, `modelReadinessTargetsMatch` and
  `isModelReadinessReportCurrent`.

Every listed schema-backed type has the corresponding `...Schema` export.
The Node-only service module exposes:

```ts
collectModelReadiness(input, options): Promise<ModelReadinessReport>;
evaluateModelReadiness(observations, requirements?, mode?): ModelReadinessEvaluation;
modelReadinessConfigurationDigest(runtime?): string;
createNodeReadinessFileSystem(): ReadinessFileSystem;
createExecutingNodeReadinessProbeSuite(target, boundary): ReadinessProbeSuite;
```

`input` is `{ target, storagePath, runtime?, requirements?, mode? }`.
`options` requires `signal`, with optional `probes`, `executableReview`, `now`,
`currentTarget` and the bounded deadline/output/identity/freshness controls.
Injected `probes` contain `{ target, files, hostFacts(signal), run(request) }`.
`files.inspect(path, { signal, hash, headerBytes, maxHashBytes })` returns
`ReadinessFileInspection`; `files.storage(path, signal)` returns
`{ totalBytes, availableBytes, code }`. `ReadinessHostFacts` contains
`operatingSystem`, `architecture`, `osRelease`, `ramBytes`, `freeRamBytes`,
`cpuAvailable`. `ReadinessProbeRequest` is a discriminated fixed-argv union, not
an arbitrary shell command. Reuse `runProgram` on the actual owning worker for
injected execution, with the same bounds and no ambient secrets.

The desktop component accepts
`{ target, onProbe, mode?, initialReport?, now? }`, where
`onProbe({ target, mode, signal }): Promise<ModelReadinessReport>`. Supply a
stable callback wrapping the owning SDK query; do not cast the SDK root or
build another client health authority. There is no automatic probe on mount.
Native refresh/cancel controls, evidence tables, live status, explicit unknowns
and owner/expiry suppression consume only the shared report. Callback/scope
change, cancellation, unmount or a late stale response cannot display old
owner evidence. CLI/TUI, desktop and optional VSX consume the same shared
service/SDK query. Public routing, SSH/native provenance, configuration
migration and the packed external consumer exercise the owning integration,
not another client-side health authority.

## Generated qualification

The owned-file command passes **29 tests**:

```sh
PATH="$PWD/node_modules/.bin:$PATH" node --import tsx --test tests/model-readiness.test.ts tests/model-readiness-probes.test.ts
```

Coverage includes supported/missing/incompatible runtimes, OS/architecture,
driver/accelerator presence, RAM/VRAM/disk/model constraints, same-device
selection, unknown requirements, declared/estimated evidence, cancellation,
probe/total deadlines, oversized UTF-8 output, symlinks/mutable/replaced
binaries, malformed/unsolicited metadata, canonical paths, every ownership
binding, expiration and captured-input stability. Generated runners assert
exact offline argv and never start servers, perform inference, download weights
or scan networks. Executing-boundary tests separately cover Env/root/peer/build
mismatch, revocation and direct runner refusal. Their generated ownership/host
fixtures are not genuine SSH/native qualification.

Fixtures are in memory, with bounded read-only checks of the owned test source
and checkout filesystem. Strict TypeScript diagnostics are requested only for
the five owned code/test files through the pinned compiler's stdio API with an
in-memory configuration; no temporary file or full repository typecheck is
created. Protocol and panel browser bundles are built in memory with no Node
service imports. Static React markup proves native controls, evidence tables
and stale suppression; integrated hidden-Electron interaction and actual
SSH/native execution qualification remain integration responsibilities.
The explicit file selector avoids running independently owned API/transport
tests that may subsequently share the broader `model-readiness*.test.ts` glob.
