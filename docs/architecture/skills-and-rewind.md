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
Reviewed script execution remains separately permissioned. The subsequent
[protocol103 native script path](content-review.md#reviewed-sandbox-script-change-contract)
requires its own current worker-image review and physical qualification.
Neither a general native-worker receipt nor this rewind change enables it;
Remote remains unsupported.
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

## Desktop control placement

The protocol99 placement correction reuses React/React DOM (MIT), the existing
SDK and native HTML dialog, without dependencies, new events, schema changes or
migrations. Skill source admission management exists only in **Settings /
Skills**, with the actual selected source chat. No selection means no admission
panel and no inferred root. Changing that selection/profile or committed source
settings discards the old inspection and confirmation; unsaved source edits
cannot be used for session admission. Discovery, complete inspection, actual-user
admission, explicit draft insertion and revocation keep their service-owned
profile/source/root/revision/provenance checks. Ordinary named skill-load
activity remains in the transcript.

The existing per-session prompt timeline sidebar owns **Checkpoints and rewind**.
Its action opens the original review controls in a keyboard-accessible native
dialog; Escape/Close restores focus to that action. Prompt/answer navigation is
unchanged. The read-only side-chat index does not expose a second restoration
owner. Empty sessions disclose unavailable checkpoints instead of reconstructing
history. Closing the dialog or changing session/profile discards previews and
conflict confirmations and cancels an owned pending preview read. Retained
checkpoint revisions invalidate old checkpoint inspections/previews; a review's
own current-workspace capture receipts do not invalidate or abort that review.
Starting a fresh review immediately discards the previous preview and file
decisions. Its old controls cannot accept a selection while the new exact
workspace response is pending, then lose that selection when it arrives.

Navigation alone starts no source load, model call, workspace write, stop,
approval or restoration. Inspection, conflict decisions, actual-user review
and explicit confirmation remain separate actions over the same SDK APIs in
desktop, CLI and TUI. A running restoration keeps its original durable owner
even if its UI closes; no cancellation or success is inferred from navigation.

### Placement correction qualification, 2026-11-10

The committed application/test cut is `ac15a9f83469ccbd0aa4b742c2105a034d733b36`,
based on merged main `2f6c4bc`, still protocol99 / `0.32.0-alpha.1`.
Subsequent roadmap/receipt edits are documentation-only. No API/event/schema,
dependency, permission, native pin or migration was changed.

| Verification | Actual result |
| --- | --- |
| Locked install and root audit | Missing `tsc` required `npm ci`; installation and the final `npm audit --audit-level=moderate` report zero vulnerabilities. |
| Typecheck/build | Passed shared SDK/types, CLI, service/workers, TUI and desktop. Existing Vite chunks above 500 kB still warn. |
| Focused service/SDK/CLI/TUI/authority/recovery set | 145 passed, zero failed/cancelled/skipped; 85,422.54 ms. Includes exact source/revocation, migration/restart, Local/SSH restoration and generated private-Sandbox contracts. |
| Hidden desktop regression set | 24 passed, zero failed, one explicit native skip; 46.5 s. Covers placement, source/session/profile switches, no session, stale/pruned evidence, keyboard focus, wide/narrow layouts, Local conflicts, SSH preview cancellation/restore, unchanged drafts/accounting and actual named skill loads. |
| Independent packed consumer | Full `npm run verify:sdk` passed in 218.78 s, with approved/audited install, browser-safe root/React, Node/MCP/types, actual installed CLI/TUI/workers and original-owner restart/no-replay. Consumer audit reports zero vulnerabilities. |
| Generated retention/Ghostty primitive | 500 events and 250 independent artifacts retained in 132.90 ms; real hidden Ghostty WASM in 24.70 ms. The first attempt lacked the `.moguri` output parent and failed before the primitive; creating that owned directory allowed the recorded run. |

The tested npm archive is 11,021,966 bytes, SHA-256
`051e76f53ea7c5779bb4ebee3eeb0e0086056b2415ae697919af542ce3a25c95`,
SHA-512
`d3316611ff20bd10da794b914b0d8f75acaf85128e5506ea10495987a8d4424ba2aa17fea2083b46e679b577e48851de0e08ce9402c1384495097999cdc728e2`.
It is the retained `ac15a9f` package, not a new DMG/native application receipt.
Its worker/bridge/MCP-worker SHA-256 values match the exact protocol99
[physical record](session-inbox.md#exact-retained-identities); changed desktop
and service presentation bytes do not inherit that packaged native UI receipt.

The first UI sweep exposed overbroad invalidation: including current-capture
receipt revisions cancelled the SSH preview that produced those receipts.
It failed with an unavailable current capture, not a completed rewind.
Invalidation now follows original checkpoint revisions instead; an explicit
hidden close-during-preview case proves cancellation reaches the original
service request, retains the failed read and starts no restoration or model.
The failing trace/error record is retained separately from the later pass.
Pre-fix navigation runs timed out looking for the requested Skills category
while the old category was still named Skill gateway; they are not passing
placement evidence. No deadline or assertion was weakened.

No low-signal tests were removed. The existing native desktop test remains
an explicit skip without this checkout's reviewed distribution; no physical
guest, personal service, app/browser, credentials, microphone or power settings
were used. These are targeted checks, not a new full source/desktop matrix,
DMG, hosted-CI or first-milestone acceptance claim.

The packed consumer still reports upstream `whatwg-encoding` /
`node-domexception` deprecations, its initially unapproved Moguri postinstall
(then explicitly approved before rebuild), and two unavailable SSH terminal
capture diagnostics in its retained lifecycle probes. The command exits zero;
those diagnostics are not new positive checkpoint/physical evidence.
Current hosted-CI account failure and runner notices are recorded in the
[refreshed acceptance audit](../remaining-milestone-gaps.md).

## Supported Local source contract

Core YAML follows the [Agent Skills specification](https://agentskills.io/specification)
(checked 2026-11-16): `name`, a description up to 1,024 characters, optional
`license`, free-text `compatibility` up to 500 characters and a `metadata` map.
`allowed-tools` and other harness fields such as `user-invocable` or
`disable-model-invocation` are accepted as informational text. None of these
fields grant tools, permissions, publisher identity or trust. Moguri semantics
come only from the optional strict `moguri` version 1 declaration:

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
YAML aliases/tags/duplicate keys and invisible metadata controls fail
explicitly. Foreign permission, scanner, signature, tool and compatibility
claims are kept as text and never translated into grants; admission still
records read-only access unless the `moguri` block declares otherwise. Local
discovery skips and logs an individual invalid `SKILL.md` instead of rejecting
the folder; archives and complete inspection still fail on any invalid source.
Nested supported `SKILL.md` sources receive the same validation. Informational authors, repositories, hashes and version strings are
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
or new chat is required, not an invented upgrade approval. Only an actual
`use_skill` load counts as a use: a successful `find` (even with stray load
fields) never creates an unadmitted reference.

### Built-in name clashes (protocol 110)

A skill named like a built-in slash command (shared or TUI-local, compared
case-insensitively) is never dispatched by `/name`; the built-in runs. The
gateway returns such skills with `shadowedBy: "<built-in>"`, `skill.import`
returns a `notice` asking the user to rename the skill (the `name` in its
SKILL.md), and desktop Settings / Skills, source search, chat skill reviews,
the slash menu and `/help` show the same notice. The skill can still be read,
reviewed, admitted and attached by its exact ID; only the slash name is taken.

### Trusted-folder admissions (schema 107)

The user enabling a Local skill source, or importing/enabling a registry skill,
is the trust decision for loading its skills as read-only instructions. When no
reviewed grant matches, a load records a `skill.admission_recorded` grant with
`basis: "trusted-source"`, `actor: "user"`, read-only access and `commandId` set
to the actual-user event that started the current trust period: the first
`settings.updated` in the latest uninterrupted run containing that exact source
configuration, or the `capability.saved` that enabled the registry entry.
Unrelated settings edits keep that basis; disabling, changing or re-enabling
starts a new period, so earlier trusted grants fail their context check and are
never revived. A revoked grant for the same chat and skill blocks automatic
re-admission until an explicit review. Remote archive sources are never
trusted this way.

Trusted loads capture the package in partial mode: `SKILL.md` is required,
other lossless UTF-8 files are included within the 128-file/512-KiB bound, and
binary or over-budget files are listed in an `omitted-skill-files` block
instead of failing the load. Trusted grants are re-checked against that trust
basis and revocation epoch, not against root, policy, file bytes or expiry,
because every later load re-reads and digest-checks the files, and they do
not narrow tools: each tool call still goes through the user's normal
permission policy. `use_skill` is an automatic native tool; it needs no tool
approval. Explicitly reviewed grants keep every restriction above.

Local sources follow symbolic links the way other agent harnesses do, so a
shared folder of linked skills (for example `~/.agents/skills` pointing into
another checkout) works. The source folder itself may be a link; its canonical
target is the bound root. Discovery, complete inspection and admission
re-verification share one walker that keeps logical paths relative to the
source and reads bytes from each link's real target with no-follow opens.
Targets may live outside the source but must be an existing regular file or
folder. Links into credential/control locations (`.ssh`, `.git`, key, `.env`
and credential names, checked relative to the home folder) are refused, as are
links back into an ancestor folder. Discovery skips a broken, cyclic or
protected link with a service log line instead of failing the whole catalog;
complete inspection and admission re-verification treat any such entry inside
the reviewed package as incomplete or changed. Followed link targets join the
inspection's identity digest, and every later use re-reads the admitted
logical files through their current targets, so a changed target file needs a
fresh review.

Discovery pages share one snapshot. The first page reads every enabled source;
continuation pages that present its `catalogDigest` are served from that
metadata-only snapshot, bound to the same profile, session, policy, source
configuration and source filter, for up to five minutes. A missing or
mismatched snapshot returns the fresh catalog from offset 0 with
`restarted: true` instead of failing. Loading never uses the snapshot: it
re-reads and digest-checks the actual file.

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
restart. Service shutdown aborts both before- and after-turn readers before
waiting for preparation cleanup; ordinary Stop retains eligible terminal
capture instead of cancelling its historical boundary. Actual capture/restore
SIGKILL tests prove transaction rollback,
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

## Frozen qualification: 2026-11-09 UTC

The final executable and test cut is
`ff05878e261edf8766a847aa7dcb8379eb2ab1d2`, version `0.32.0-alpha.1`,
protocol98, based on genuine97 main
`b1612e12ef8881b619ce678404f2c073bddc9435`. Its build and qualification started
with clean application, package, script and test sources. The subsequent
documentation-only record does not change those executable bytes.
The host used macOS arm64 and Node 26.13.0; packaged and guest Node are 26.12.0.
All model, credential, microphone, project and SSH fixtures are generated.
No personal Moguri profile, running service, terminal, authorization or power
configuration was used or changed.

| Verification | Final result |
| --- | --- |
| `npm run typecheck` and `npm run build` | Passed on the final source; shared SDK/types, CLI, service/workers, TUI and desktop built. |
| `npm test` | 10,820 tests: 10,788 passed, zero failed/cancelled, 32 explicit skips; 8,327,395.573291 ms. Includes the native TUI interaction test. |
| Complete Local/SSH source matrix | All 6,720 required source cells passed at clean `ff05878`; the broader 3,360 native milestone cells remain explicitly unqualified. |
| `npm run test:e2e` | 397 hidden desktop cases passed, six explicit skips, 14.3 minutes. Actual Sandbox desktop rewind is separately included in the physical qualification below. |
| `npm run verify:sdk` | Complete independently installed consumer passed, including root/React browser bundles, explicit Node/MCP entrypoints, types, installed CLI/TUI, actual workers and restart/no-replay. Its fresh install audit found zero vulnerabilities. |
| `npm audit --audit-level=moderate` | Zero vulnerabilities, rechecked after the complete final run. |
| Final packaged setup/service | Exact bundled worker/Apple-init archive and root-owned no-script installer passed. Actual packaged Node/service discovers Sandbox without model/network/keychain access; hidden packaged Electron and unmodified SDK/service preserve generated encrypted history and the exact authenticated user PTY across explicit restart. Ordinary shutdown closes owned resources. |
| Actual final packaged native qualification | All ten independent gates passed in 129,474.329125 ms, with exact artifacts, real provider/network checks and verified owned-guest teardown. |

The native retry/checkpoint gate executes six cases: five physical native
cases and one generated primitive, with zero skips. Per-turn rewind executes
three physical scopes: captured project, project-free private workspace and
captured multi-repository group. They verify signed terminal snapshots, fresh
private restoration, preserved Git HEAD/index and unrelated files, retained
old stages/backups, unchanged source checkouts and accounting, subsequent
turns on the restored stage, pruning and actual service restart. One further
hidden test exercises confirmation and restoration through the exact final
packaged desktop and a real guest.

These are feature-specific native receipts, not proof of every native
milestone cell, reviewed-script execution, live-model attack resistance,
production notarization or Linux release acceptance. Generated token/cost
accounting is not live billing or model quality.

### Exact artifacts and receipts

The final development app, unopened DMG and ZIP are under
`release/qualification-builds/skills-rewind-ff05878/`. They are ad-hoc signed,
not notarized. The app executable used by the physical desktop gate is
`builds.noindex/0.32.0-alpha.1/Moguri-darwin-arm64/Moguri.app/Contents/MacOS/Moguri`,
not the `.app` directory.

| Artifact | Exact identity |
| --- | --- |
| DMG | 897,859,868 bytes; SHA-512 `09790e9ac91d8f242184b2c607143c8e42cd774353d004cbe30f62c0e3e99d01a78e524c613fd2467c1a874dc20698561c454a4526e2997844124f9f1f92e1fd` |
| ZIP | 882,999,122 bytes; SHA-512 `0e4389e90aaadf414f3c36e80816a831ec4d7d39f926e77f554aa0c6151af506028d64e83321f48a5c2365a7963bb89cc1c06dc9950953c3906f67baea69b9b3` |
| App tree | SHA-512 `bef781504bfa1ac0ea37da70b9aefa0d49fa446b7f005fd6d8751a1cbcdec424b334030260bf1d2cdafd0b3dd701cb33e45c89bc83f39a6acba437eb3f322328` |
| Native image | `docker.io/library/moguri-worker@sha256:c96d1df7c311f49c7b395fd07535df87ad4ac946d12b76e3ea7f93a43fcd8ab0` |
| Worker | SHA-256 `717738e3656ca4c3c6100512735230decda1a56538b68ad89843ec224f075a64` |
| Bridge | SHA-256 `58a152292cdd9edbf51437d4f30f7ee35faea63a441d878a1b441a8de8b69326` |
| MCP worker | SHA-256 `cb0d7eb92fdc86fd47b54fd4f3a646bab2aae4d98ccc9deba01fd5525eebb138` |
| OCI archive, including pinned Apple init | 530,360,320 bytes; SHA-512 `fdcfea841312409e723df2d158ac341d404156ecd17d8c9b40a782c5c2494cafddb417057da2fd1ef6c2aad79a4f5d98a4fc7b55c5aeefd234cad260016e2936` |
| No-script installer | 16,589,224 bytes; SHA-512 `3ffffd46f8186510a8e414d84077e6fccfbe9c3edf044bd1657bdeffd703991baaa708708b4318f05a1324e63943c2ae79730baa6421be2b57adc1493028d82a` |
| Final native report | `.native/qualification/current-sendbox-r3SZCm/qualification.json`; SHA-256 `70af81fc2c6f0960af7607be47db0a94858be3fd9493d32ed26c6aa66eab3fb0` |
| Complete source-matrix report | `.test-output/milestone-combinations/source-report.json`; SHA-256 `9edbb7549f97df4fb25a7efc9aab94d0949de1fb7531dc85e4f328559a427fbf` |

The final native report records source `ff05878`, an empty source diff
(SHA-256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`)
and per-harness-file hashes. Its exact source/test identities are independent
of predecessor receipts. Final complete local, desktop and packed-consumer
logs respectively have SHA-256:

```text
9962300bf3875f2009fe4f38a2dd2c6c745cc9ed9200791b96c534cbedca61e4
b5b9f4ebbb5726032a3ad30845ff3deb1f5ae8caa0f184f2244d6631cf61ce3d
d998bd8a967fbd971781ec84ae3a1086a9dcc9c94b5c81711c0267ba551007f7
```

Qualification used `node scripts/package.mjs --qualifier
skills-rewind-ff05878` after building, followed by
`scripts/verify-sandbox-package.mjs`, the packaged
`tests/fixtures/installed-service-recovery.mjs`, and
`node --import tsx scripts/qualify-sandbox.mjs` with distribution
`.native/sandbox-distribution/build-XImhIn`, its exact `image.json`, the
then-pinned vendor archive and root-owned SendBox installation. `MOGURI_TEST_APP` selected the
exact executable above. A reproduction must prepare and verify its own
matching distribution and choose a new output qualifier; never overwrite or
relabel retained evidence.

### Preserved failures and residual gates

Earlier receipts remain failures or predecessor evidence:

- The first full desktop run had 390 passes, seven failures and six skips.
  Final-source complete desktop qualification above is a new run, not an
  edited result.
- Earlier full local runs were stopped after concrete failures. The complete
  frozen `a86b5e0` diagnostic ran 10,820 tests with 10,776 passes, nine failures,
  three cancellations and 32 skips in 8,511,075.251792 ms. It exposed a
  recovery identity probe, terminal-reader handoff races, invalid legacy
  fixture production, a queued model-availability assumption and shutdown
  waiting on after-turn readers. Those causes were fixed without relaxing
  deadlines, assertions, accounting or writer policy before the new complete
  green `ff05878` run.
- Packed-consumer failures exposed missing actual-user skill admissions in
  old smoke fixtures and the queued unsafe-force ownership handoff. The
  final consumer performs real inspect/admit/consume and checks the complete
  retained source bytes/digest; admission was not weakened.
- Prior native attempts retained unchanged 60-second readiness timeouts and
  partial outcomes. Another invocation incorrectly passed a `.app` directory
  as an executable and failed with `EACCES`. Those reports remain distinct.
  Public unauthenticated GitHub metadata was separately observed returning
  HTTP 403 with zero of 60 requests remaining. A later attempt waited for its
  real reset and required HTTP 200 before proceeding, without personal tokens,
  cached-success substitution, power changes or weaker freshness checks.
  That observation is not proof that every earlier timeout had that cause,
  and no failure is attributed to historical clamshell sleep.

Issue45 remains open. This cut does not implement or qualify reviewed-script
Sandbox execution, implicit Remote scripts, malware/semantic scanning,
publisher PKI/transparency/global revocation infrastructure, or blanket
AST01-AST10 certification. Local known-process supervision is not
whole-descendant isolation. The matrix in [file-access.md](file-access.md)
retains the per-category boundaries. Rewind cannot undo external pushes,
merges, deployments or MCP effects, restore deleted secret grants, revive a
revoked source, weaken current policy, replay paid work or refund spent/unknown
capacity.

Hosted CI is not green. The final target remains `b1612e1`; its
[main run 42610288497](https://github.com/mbianchidev/moguri/actions/runs/42610288497)
failed before either OS job ran a step because GitHub reported account
payment/spending-limit eligibility failure. Both jobs have empty step lists.
Additional notices disclose macOS arm64 runner capacity and the
`ubuntu-latest` migration to Ubuntu 26. Main-push-only CI is unchanged; no
working-branch/PR workflow was triggered, and absent branch checks are not a
pass.

Existing non-fatal build/package warnings remain visible: Vite chunks above
500 KiB, deprecated `whatwg-encoding`/`node-domexception`, the explicit
reviewed install-script approval warning, packager's optional modern `.icon`
format while the verified `.icns` works, and generated native Git template
warnings. None constitutes additional capability or release qualification.
