# Local skill admission and per-turn rewind

## Change contract

Baseline: merged main `b1612e12ef8881b619ce678404f2c073bddc9435`, genuine
protocol97. This work reuses the service, SDK, encrypted append-only store,
canonical file guards, root writer leases, complete-source script review,
all-role accounting and existing React/OpenTUI clients. Node26 filesystem and
crypto, TypeBox, React and the existing `yauzl` archive reader retain their
MIT licenses; YAML and semver retain ISC licenses, and system Git remains
GPL-2.0-only. No new dependency,
provider, authentication service, agent framework or model-owned approval is
introduced.

The guidance is **OWASP Agentic Skills Top 10**, revision
`d6f7d7d0de314f52a83a85d1828e06ab096e595c` (2026-08-12 16:27:33 UTC),
rechecked against the upstream repository on 2026-11-09. Its checklist and
universal-format proposal are guidance, not a certification or permission
schema that Moguri silently translates.

New versioned events retain exact skill reviews, actual-user admissions and
revocations, consumed-source provenance, before-turn checkpoints, terminal
boundaries and reviewed rewind intents/results. The additive migration must
preserve the actual95 My Work, actual96 background-service and actual97 OTLP
markers, original ciphertext, owners and accounting. Earlier turns have no
invented filesystem checkpoint.

## Prerequisites

Before feature integration, `npm ci` restored the missing native dependency;
the install audit reported zero vulnerabilities. The generated macOS arm64
Phase0 run passed provider/streaming (1,101.01 ms; cancellation 30.79 ms),
SQLite (62.46 ms; append p95 0.049 ms; rebuild 0.580 ms), PTY cancellation
(151.13 ms; zero known survivors), OpenTUI (17.40 ms/update), hidden Electron
(199.72 ms startup; 447.81 MiB; 8.05 ms scroll) and generated search/Git
(0.802/5.800 ms).

The separate retention/Ghostty spike passed 500 events and 250 independent
artifacts in 166.09 ms, and real hidden Ghostty WASM in 24.80 ms. The
model-control spike passed actual supported/ignored effort forwarding and
complete context sizing in 68.03 ms. These are generated primitives, not
personal authorization, live entitlement or physical native qualification.
The foundation script's static unavailable live/Rust/Linux/release/native
markers remain failed/unqualified; its exit status is not blanket acceptance.

## Required invariants

Skill discovery is not admission. A review names complete immutable source
bytes, version, supported dependencies, source identity and the exact
profile/session/workspace/policy. A repository label or hash is not publisher
identity. User-pinned signing keys and explicitly acknowledged unverified Local
sources must remain distinguishable. Required missing, changed, expired or
revoked evidence blocks use. Metadata, manifests, scanners and model verdicts
never grant tools, credentials, authentication, user answers or policy changes.
Unsupported authority-bearing and foreign compatibility declarations fail
explicitly. Complete inspection never means a prefix or omitted dependency.

Local skill restrictions intersect the current service policy; they cannot
broaden it. Revocation prevents future model consumption and future effects,
including races, but cannot retract instructions already delivered or undo
effects already running. A rewind does not recreate admission grants.
Reviewed script execution remains separately permissioned and Local-only.
**Sandbox reviewed-script execution is still unqualified.** Neither a general
native-worker receipt nor this change enables it; Remote remains unsupported.
Issue45 must remain open while those and other full-category gates remain.

Every newly admitted ordinary or control turn needs a versioned before-turn
checkpoint and its actual terminal boundary, including failed/stopped/partial
work. Capture failures retain explicit availability diagnostics. Checkpoints
bind exact event sequence, context, profile, session, turn and workspace.
No historical snapshot is reconstructed from today's files.

Rewind requires a target-bound preview and actual-user confirmation. Current
owned work must settle and the actual writer boundary must be available.
Conflicting external bytes require explicit per-file decisions. Preserve
unrelated files, current Git HEAD/index, protected paths, other sessions,
independent artifacts and later append-only history. Never use a destructive
reset, restore expired approvals, weaken current policy, replay tools/model
calls, erase costs, refund usage or release another owner's capacity.
Remote effects (push, merge, deployment, external MCP) are never undone.
Unsupported Env/root restoration must fail without a different-root fallback.

## Qualification requirements

Generated tests cover malformed/malicious metadata, exact source/version/key
bindings, dependencies, limits, stale/revoked evidence, authority races,
cancellation and restart. Rewind evidence must include all turn outcomes,
dirty/staged/untracked intent, external and concurrent writers, stale previews,
failed cancellation, capture/restore persistence failures, partial effects,
restart/no-replay, repeat requests, migration and encrypted retention/deletion.
Shared SDK, CLI/TUI and hidden desktop flows plus a separately packed consumer
must exercise the real authority, not client-only simulations.

Final executable behavior, supported scope, measurements and exact artifact
identities are recorded here as integration is qualified. Earlier receipts
remain predecessor evidence, never proof of changed payloads.

## Supported Local source contract

The supported compatibility declaration is `moguri-local-instructions-v1`.
Core YAML accepts `name`, `description`, optional informational `license`,
`metadata.author`/`metadata.version`, that exact `compatibility`, and optional
`moguri` version1 declarations:

```yaml
moguri:
  schemaVersion: 1
  version: 1.0.0
  minimumProtocol: 98
  maximumProtocol: 98
  access: read-only
  dependencies: []
```

Declared dependencies are unique relative `path`/SHA-256 pairs inside the
complete package. Supported access is `read-only` or `native-files`; omission
means read-only. Conflicting version declarations, unsupported protocol ranges,
aliases/tags/duplicates, invisible metadata controls and unknown fields fail
explicitly. Foreign permission, scanner, signature, tool and compatibility
claims are not translated. Nested supported `SKILL.md` sources receive the same
validation. Informational authors, repositories, hashes and version strings are
not publisher authentication.

An inspection binds the actual profile/session/store, canonical Local root,
current policy, source configuration, package version, file set and exact
bytes. Admission retains that inspection in the existing encrypted store.
Registry/plugin enablement/history is reused, not replaced. Local/registry
sources may use an explicit unverified-publisher acknowledgement. HTTPS ZIP
artifacts need an independently user-pinned Ed25519 key and a signature of
`skillSignaturePayload(origin)`, including the exact version, artifact and file
hashes. This is scoped artifact verification, not a PKI, publisher reputation
service or automatic trust in a user-entered label.

New consumption re-inspects the source; archive consumption refreshes its
original public transport without cached-success fallback. Consumed context
retains immutable artifact/source provenance. Later model/tool admission checks
current root/policy, source configuration and enablement, registry/plugin state,
Local file inventory/bytes, expiry and monotonic revocation. A signed archived
artifact remains the exact admitted immutable artifact, not proof that a
mutable upstream URL remains unchanged or that new downloads were reviewed.
Changing that URL/configuration requires new admission.

Each consumed grant intersects existing policy with native-file-only
restrictions and literal reviewed file paths. It cannot grant commands,
scripts, network, installers, credentials, authentication, delegation or a hard
policy exception. The original source owner follows inherited child/side
context; consumer permissions can only narrow it at the same actual Local
root. Current admission checks also run immediately before a `tool.started`
transaction, including an actual-user approval that waited through revocation.
Compaction and rewind cannot turn historical provenance into a fresh grant.
Historical pre-admission skill uses remain unadmitted; a clean reviewed branch
or new chat is required, not an invented upgrade approval.

Resource bounds are not safety theorems. Discovery's `SKILL.md` limit remains
64 KiB. Complete supported package inspection permits 128 lossless UTF-8 files,
512 KiB aggregate, 16 directory levels and 10,000 inspected entries. Private
credential/control/history paths are excluded and disclosed; required excluded
dependencies prevent admission. Binary/oversized/missing dependencies fail,
not truncate. Up to 128 external HTTP references are disclosed but not fetched;
dynamic downloads and arbitrary transitive execution are not claimed inspected.
The complete escaped delivery envelope is bounded to 2 MiB. User-selected
inline drafts still have their ordinary 128 KiB limit and fail explicitly if
the package cannot fit.

Repository-script raw source now has a separate 512 KiB limit and the same
2 MiB complete escaped transport bound. Successful full script/skill source
results are not clipped to ordinary tool-output limits. The next actual model
call must still fit its qualified context window and all-role budget; no
history/source truncation, extra paid call or provider substitution is allowed.
Large-source generated owned-worker cases prove both complete delivery and
rejection before an undersized next inference.

## Capture and restoration scope

`turn.started`, `turn.control_started` and `turn.retry_started` share capture
admission. Ordinary/held-later/scheduled turns, manual and automatic recovery
batches, compaction, supported owned roles/generations, external tools and
public compound admission use the same authority. A checkpoint binds the
actual admission event ID/sequence, preceding context boundary, normalized
context, original turn and exact Env/root/profile/store.

Local captures are synchronous in the admission transaction. Failed Local
workspace capture can retain a genuine conversation checkpoint with explicit
workspace-unavailable diagnostics; it never creates a fictional partial tree.
Remote and Sandbox require a complete qualified pre-admission capture before
their turn can start. Retained capture intent, reader roots, current policy,
context/source digests and once-only admission consumption prevent a later
reader or retry from reusing stale acceptance. Recovery batches preserve
same-turn atomic accounting; a capture is not a second model reservation.

The actual terminal event always records completed, failed, stopped or partial
outcome. Non-Local terminal data is separately captured after the original
worker/guest boundary and records its actual `capturedAt`, not an invented
filesystem timestamp at the earlier event. Missing/unconfirmed cleanup or
interrupted capture stays unavailable. Recovered historical terminal events
never resolve today's workspace identity or snapshot its files, even when the
original source is missing. Same-session candidate handoff waits for its
bounded terminal reader and revalidates the original source instead of
discarding the reader lease.

Successful Remote plan-save replies and cancelled external-job replies also
settle their original bounded terminal reader before handing the root to a
later operation or another profile. A new same-session save rechecks the exact
source after that handoff. This does not bypass competing writers, release an
unconfirmed worker or rewrite an already-retained receipt: a changed handoff
still returns an explicit error and leaves the original outcome inspectable.

| Surface | Restored or preserved |
| --- | --- |
| Active conversation | Exact normalized before-turn context replaces only the active branch. Side parent/own boundaries are separate; the next side question refreshes its actual birth parent once. |
| Later history | Original messages, events, models, failures, provenance and receipts remain inspectable. `session.rewound` appends a branch notice. |
| Draft and queue | Current draft is preserved. Current undispatched work is held, never copied from the old snapshot or replayed. |
| Controls and approvals | Captured controls are informational. Current model/Env/autonomy/budget/policy survives; no old approval/question/authentication becomes live. |
| Artifacts and usage | Captured artifact descriptors are informational. Independent artifact retention, actual charges, unknown holds and another owner's capacity are unchanged. |
| Workspace | Only complete captured unprotected/non-ignored regular files are candidates, with exact binary bytes/modes. Current Git HEAD/index and unrelated dirty/untracked files remain. |
| Secrets and control data | Protected credential paths, private shell histories, application/configuration directories, Git internals and dependency caches are excluded from checkpoint file restoration. Path exclusions are not content-based secret scanning. |
| External effects | Pushes, merges, deployments, external MCP work and other already-executed effects cannot be undone. |

Local/Remote checkpoint trees allow 2,000 files, 2 MiB/file and 16 MiB raw
aggregate; Local traversal additionally limits 10,000 entries and 32 directory
levels. Complete conversation/state is bounded to 32 MiB. A session retains at
most 64 ordinary checkpoints and 512 MiB of conservatively serialized logical
snapshot data, including abandoned retained captures. No exact physical disk or
billed-storage telemetry is implied. Snapshot pruning is explicit. No expired
grant, secret backend, terminal input/output or paid-work replay is part of
restoration. Ordinary existing message context can include already-approved
attachments; the checkpoint does not discover new credentials or silently
drop unsupported context.

Private native cloning additionally preserves the complete current stage,
including Git/ignored/dependency data, under its distinct 20,000-file/256-MiB,
32-MiB/file and 16-MiB metadata bounds. Those are copy-preservation limits, not
permission to inject protected bytes into a checkpoint or model context.

## Exact effects, failure and retention

Preview identifies the exact target, current semantic file set, excluded paths,
current policy/context and revisions. It compares all later complete
before/terminal boundaries. Inter-turn external changes and writes without a
complete matching native compare-and-swap chain require explicit file
decisions, even if a later owned write ends at known bytes. A missing/pruned
later workspace boundary blocks complete workspace rewind. Unrelated paths
are not selected merely because the checkpoint lacks them.

Local restoration durably records intent before moving each original inode
into a private `.moguri/rewinds/<operation>` backup. Target bytes publish through
an exclusive hard link; a concurrently recreated destination is never
overwritten. Later writes through an already-open displaced handle stay in the
retained inode. Final file and current Git verification precedes the single
context/completion transaction. No destructive Git reset/clean/index restore
is used.

Remote effects use the existing authenticated pinned worker/journal as an
independently retained model-free actual-user operation. Exact intents,
per-file boundaries, result frames and acknowledgements persist before
advancement. Peer/root/account/build changes, late frames and lost receipts
never choose a controller path or replay an effect. Inspection reads the
original operation journal plus current peer files/backups and actual worker
cleanup.
Root-less project-free SSH sessions have no filesystem workspace and support
conversation-only rewind. They cannot inherit a controller/Home/previous peer
root. This does not substitute for the independently qualified restoration at
actual configured SSH workspaces.

Sandbox captures actual signed terminal before/after evidence, not SendBox's
rolled-back host tree. Current private external edits are reconciled
conservatively with that original evidence. An exact reviewed rewind retains
its preparation intent, original stage, full private backup and a fresh stage.
Ready stage/binding, completed record and conversation branch append
atomically. Captured logical repository keys survive legitimate private-stage
replacement without using a historical directory/inode alias or first-root
fallback. Grouped and project-free private workspaces have explicit roots.
Nothing publishes to the Local source checkout or acquires its separate
publication/acceptance permission.

`checkpoint.capture_recorded`, `checkpoint.recorded`, `rewind.recorded` and
`session.rewound` are versioned append-only records. Capturing/captured sources
and running restores recover as partial/unreplayed original owners after
restart. Actual capture/restore SIGKILL tests prove transaction rollback,
retained displaced files, unknown command outcomes, writer quarantine and
original budgets. An exact repeat with a lost command receipt cannot authorize
another restore.

`checkpoint.forgotten` and `checkpoint.capture_forgotten` preserve historical
witnesses while erasing their encrypted per-checkpoint grants. Checkpoint
compartments are subordinate to their actual session/project, unlike ordinary
independent artifacts. Pruning never deletes filesystem backups/private
stages or removes independent active-context grants. Active/unconfirmed work
blocks deletion; inspecting and acknowledging a terminal partial result
releases only its root quarantine and leaves the outcome partial.

The atomic98 migration adds `local_skill_admission_schema=1` and
`turn_checkpoints_schema=1`. Failed second-marker insertion rolls back both.
Genuine95/96/97 markers and original ciphertext/keys/receipts/owners/accounting
are unchanged. Future admission/capture history cannot be relabelled as older
state, including after snapshot pruning. Older uncaptured turns report honest
availability gaps.
