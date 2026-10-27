# Chat activity and compact usage

This owner-requested source slice renders icon-led chat operations, exact
retained arguments/results, hover/focus response actions and compact usage.
It reuses React (MIT), Electron (MIT, with its existing Chromium notices),
TypeBox (MIT), the SDK and the existing Node.js (MIT/component notices) and
SQLite (public domain) event authority. No dependency, provider metadata
request, model call or execution permission is added. Existing notices and
execution boundaries are unchanged.

## Prerequisites

Before feature changes, the 2026-10-24 macOS arm64 / Node 26 baseline passed
generated provider cancellation (32.07 ms), SQLite append p95 (0.045 ms),
PTY cancellation (152.02 ms, no observed survivor), OpenTUI updates (17.76 ms),
hidden Electron startup (260.08 ms / 445.20 MiB / 8.24 ms scroll frames) and
2,000-file filesystem/Git reads (1.02/6.29 ms). Unavailable live providers,
Linux/Rust, physical native/SSH, multi-model quality and release gates remain
the baseline's explicit FAIL/unavailable results, not newly qualified features.

## Authority and retention

Read-only `activity.list`, `activity.read` and `activity.turn` are SDK/service
views over the original session events, public messages, actual operation
metadata and owning-turn budget ledger. They never put arguments, paths, command
text, output or reasoning into the independently retained sanitized operation
ledger. Detail reads require the original current-profile session and exact
activity identity. UTF-8 byte pages preserve complete captured content without
unbounded responses or silent truncation. Session deletion cannot recover its
private contents from the surviving metadata.

The original `sequence` controls transcript position. `updatedSequence` plus
the exact activity ID controls recent-page cursors, so late results refresh
without reordering the conversation and operations sharing a cancellation event
are not skipped. Older page responses cannot replace newer observed metadata.
A separately bounded current-operation set/count keeps running calls visible
even when their start predates the recent history page.

Tool request/start/result identities include profile, session, turn, step and
call. Reused names/IDs, denial, cancellation, partial work, missing completion
and clock regression cannot become success or precise elapsed observations.
Output quantities describe retained UTF-8 response text, not total process or
network I/O. User-console buffers/input stay unavailable to this view.
Before a final result, bounded captured output is explicitly a tail, preserves
Unicode code-point boundaries and never overwrites an already retained final
response with a late stream chunk.

Explicit skill selection records `skill.used` with actual user provenance,
source digest, captured bytes and observed loading time in the same transaction
as its draft mutation. Its source grant belongs to the session. Merely reading
a skill or importing/enabling one does not fabricate a selection or grant tools.
GitHub/Linear actions retain their real reviewed operation provenance. Session
actions with no owning turn remain separately labeled, never guessed into the
nearest chat turn.

This slice originated on desktop protocol/schema 45 and is now included in
protocol 53's [lineage-aware convergence](../sdk.md#retained-state-upgrades).
The SQL layout is unchanged; original ciphertext, keys, receipts and operation
coverage stay intact. New skill events cannot be relabeled as older history or
main-line versions that did not contain them. Recovery and migration fixtures
use generated data only.

## Truthful presentation

Each operation has a category icon, explicit status, expandable original
arguments/result and observed start, duration and captured output quantity.
Unknown observations stay unavailable rather than zero. Live timers observe
elapsed wall time; approval/user waiting is not CPU or active model time.
Multiple running operations are not collapsed into one fictitious operation.

Thought expands only already-public provider-exposed reasoning from an ordinary
visible response. It never reads private model context, router/critic payloads,
owned-role continuations or hidden reasoning. Request duration is not a claimed
thinking duration. A provider exposing no reasoning does not get invented text.

Response actions remain keyboard/touch accessible even when visually quiet.
Copy includes public assistant response text only, not tools or private
reasoning. Turn info uses original model/step/context evidence and complete
owning-turn accounting. Unknown prices/token categories stay unknown; cached
input is a subset, not an extra token charge. Estimated, provider-reported and
billed costs are never relabeled.

The default budget popover shows estimated USD, plan, session calls, input/
output/cache observations and the estimated context window compactly. Detailed
usage and warned limits remain an explicit action. It never invents AI credits,
changes a hard policy, truncates history or spends budget to refresh.

Generated tests must cover category mapping, exact byte quantities/pages,
concurrency/reused IDs, failed/cancelled/unconfirmed states, reasoning privacy,
source/profile isolation, late/restart reads, schema-44 upgrade, stale async
views, copy/info actions, live timers and compact budget policy/price behavior.

The [protocol-45 source qualification](../setup.md#protocol-45-source-qualification)
records the complete generated unit/native-TUI, hidden Electron and actual
packed-SDK/installed-worker results, with physical/release exclusions unchanged.

## Retained telemetry follow-up contract

The owner requires cached-input reporting and immediately available saved
turn/cost/context/token information, including while a turn is running and after
reopening a chat. Reuse the original append-only model/delta/budget events and
captured rates as authority; the desktop must not start `activity.turn`,
`budget.status` or `session.context` reads merely to open these displays.
Root/React/Node SDK clients, TUI and desktop receive one profile-scoped retained
telemetry view with their normal snapshot/event refresh.

Protocol/schema 66 requires `Snapshot.sessionTelemetry`; turn and compact usage
controls select it synchronously. No second telemetry journal or client-only
provider state is introduced. Session/turn indexes reuse all original ledger
groups, rather than a dashboard's first page, and unchanged snapshots reuse the
same derived view. Missing original accounting ownership is an explicit
diagnostic, not a reason to block every other chat's snapshot.

Cache repair requires the exact retained profile/session/step, normalized
provider model result, safe integer categories and matching original totals.
It appends existing `budget.recorded` metadata for the same settled call and
uses only that entry's original captured rate. Missing, mismatched, non-JSON or
older non-provider result formats are diagnosed and leave cache unknown, rather
than blocking otherwise valid chat recovery. Known categories are not replaced.

Stopped control planes retain their final accounting view. After owned shutdown
settles, the profile authority captures global capacity before closing stores;
subsequent read-only snapshots use that exact last value instead of reading a
closed database or substituting unlimited capacity. Failed cleanup does not
freeze or discard still-live authority, and stopped controllers cannot admit
new work. Restart reconstructs authority from retained events, not this cache.

Reuse React, TypeBox, Node and the maintained pi-ai estimation utilities under
their existing MIT/component notices and SQLite's public-domain terms. No new
dependency, provider metadata request, model call, credentials, tool permission
or budget admission path is added. Normalized positive provider cache counts
remain reported even when transport presence metadata is absent; zero requires
actual evidence, and missing usage is never fabricated as zero.

Original turn accounting must include actual owning roles and late results,
not unrelated sessions or private role content. Streaming output quantities and
USD based on captured rates are explicitly estimates until provider completion;
they never settle/refund a reservation or become a bill. Retained model input
and output estimates must not weaken fresh inference sizing. Context combines
the last visible model's captured input estimate and retained visible output,
not unsent draft text; original turn windows remain unchanged when the next
working window is selected. Protocol/schema
changes preserve ciphertext, receipts, known/unknown charges and original
identities through atomic migration and restart, with no paid or tool replay.

Before feature edits the generated platform spike passes OAuth/streaming in
1,090.15 ms (32.66 ms cancellation), SQLite in 70.61 ms, PTY in 159.96 ms
(152.52 ms cancellation, zero survivors), OpenTUI in 1,077.82 ms, hidden Electron
in 537.23 ms and filesystem/Git in 93.06 ms. Physical/live-provider, Rust/Linux,
SendBox, quality and release exclusions remain explicitly unavailable. Tests
must prove absent/zero/positive cache categories, live saved updates, immediate
popover data without those detail queries, cross-chat/profile isolation,
deletion, unknown cancellation, migration rollback and restart without replay.

## Protocol-66 qualification

This records the retained-telemetry checkpoint; the later SDK/desktop-only
turn-navigation qualification is recorded below.

The generated regression first reproduced a normalized 10-token cache report
being discarded when transport presence flags were false. Hidden desktop tests
reject `activity.turn`, `budget.status` and `session.context` detail queries:
original turn information, cached input, captured-rate cost and context still
open immediately, update while streaming and survive navigation/reload without
another model request. Actual service restarts preserve the same observations,
including unknown stopped-call holds and one-time exact-source cache repair.

Final qualification uses the same rebuilt source/runtime and generated fixtures:

| Surface | Result |
| --- | --- |
| Strict types and production build | Pass |
| Combined recovery, terminal, profile, legacy-evidence and deadline regressions | 98 passed |
| Complete source/service/worker/CLI/native-TUI suite | 1,651 passed, 14 existing skips, zero failures; 1,665 cases in 1,437,731.03 ms |
| Complete hidden desktop suite | 222 passed, three existing skips, zero failures; 225 flows in 7.4 minutes |
| Actual packaged-app turn/cache/streaming/navigation/settings flows | 13 passed in 24.2 seconds |
| Independently installed packed SDK | Browser-safe root/React, explicit Node/MCP, declarations, immutable profiles, saved telemetry and actual runtime/worker checks pass |
| Actual installed-worker continuation/accounting probes | 12 passed |
| Fresh source, independent consumer and native workload audits | Zero vulnerabilities |

Generated coverage also checks absent versus explicit-zero cache, partial known
cache totals, all 61 model groups beyond dashboard pagination, deletion/profile
isolation, atomic 65-to-66 rollback, unchanged ciphertext/receipts, final global
capacity after shutdown and unknown legacy result formats. An indexed
2,000-turn reconstruction took 12.78 ms in the focused recovery run; unchanged
snapshots reuse the same view.

Earlier failed runs are not counted as passing qualification. They exposed
stopped-store reads, an unqualified legacy prototype result, a sub-millisecond
timer-rounding assertion and a native settings teardown racing its renderer's
save acknowledgement. The repaired deadline test checks the actual 10,000 ms
configuration and real abort, without increasing the deadline or test timeout.
The settings test waits for the real **Saved** status before closing; its
three-repeat check and the complete final native suite pass.

The final no-cache Linux arm64 workload retains locked dependencies, compiled
native PTY and the exact protocol-66 payload. Its OCI digest is
`sha256:09e6f9062daed94bcbe7c5e858709018bfa50359046b5060f8d9784326c083f0`.
This is producer/image evidence, not physical SendBox or Linux-release proof.
The actual 779,784,410-byte ZIP passes the bounded production update consumer.
The canonical DMG passes native Finder geometry, icons/background and exact
signed-bundle verification; the distinctly labelled copy has identical bytes
and its own successful disk-image checksum verification:

```text
release/Moguri-0.30.0-alpha.1-telemetry-66-macos-arm64.dmg
793982118 bytes
SHA-512:
5c020a58b2fdae340653c4d27f006897e0e33d3059c3c4c82ec28119742fd492b2bb26c53d3f2a755728642453d9697c5bd46b480c4e60053edb57de7e1b9eaa
```

The installer is local, ad-hoc-signed development output, not a notarized or
uploaded release. No personal app, Finder, microphone, login or paid provider
was used. Known non-blocking notices remain experimental OpenTUI FFI, the lazy
Ghostty chunk, optional `.icon` format and transitive
`whatwg-encoding`/`node-domexception` deprecations. Other physical/live-provider,
Rust, public compound/family-quality and release exclusions remain unchanged.

## Conversation turn navigation contract

The compact desktop index navigates sent user prompts and model questions that
have an actual `answer.actor: "user"`. Tool permissions, queued drafts,
delegated notices, unanswered/cancelled questions and model/decision-provider
answers are not user turns. Labels retain the original question and the
user's exact chosen/custom answer; they grant no permission or further work.

Reuse React/Electron and the existing SDK under their MIT notices, with the
existing Node/component notices and SQLite public-domain authority. There is
no new dependency, event, service endpoint, durable schema or migration.
The browser-safe SDK selector derives ordered, profile/session-scoped anchors
only from canonical public messages and structured question records. Original
owning turn IDs remain unchanged; an answered question is a navigation point,
not a new model turn. Desktop main/side transcripts use the same selector;
other SDK clients can reuse it without introducing a second question model.

Navigation is local presentation only. It must reveal older retained messages,
scroll the exact originating prompt/answer in its own transcript and keep the
selected index item focused,
preserve drafts and a user's historical scroll position during new output,
and reset on session/profile changes. A narrow pane uses a compact rail with
expandable previews, keyboard focus stays visible, and jumps do not animate
or override reduced-motion preferences. Missing targets are explicit errors,
not permission/model actions or substitution of another session.

Before feature edits the generated macOS arm64/Node 26 baseline passes
OAuth/streaming in 1,096.05 ms (32.65 ms cancellation), SQLite in 60.37 ms
(append p95 0.053 ms), PTY in 158.43 ms (150.90 ms cancellation, zero survivors),
OpenTUI in 1,068.34 ms, hidden Electron in 564.96 ms (8.06 ms scroll frames),
and filesystem/Git in 87.62 ms. Live Copilot/ds4, Rust/Linux, signed/notarized
release, physical SendBox, Kupo quality, System One, configured physical SSH
and full-milestone attachment/default/budget gates remain explicitly
FAIL/unavailable in this primitive spike; it does not broaden qualification.

### Turn navigation qualification

The shared selector and desktop use the existing protocol-66 snapshot, with no
service implementation, durable schema, endpoint or dependency change.
Fresh focused source coverage passes 46 navigation/question/activity/telemetry
cases and 26 SDK-discovery/profile/interaction cases. It includes actual fixed
and automatically routed model questions, the original user choice, service
restart without another model call, 5,000 retained navigation points, repeated
call IDs, regressed clocks and explicit automated-answer/permission exclusions.

The complete final hidden desktop suite passes **225 flows, three existing
skips, zero failures** across 228 flows in **7.1 minutes**. New native coverage
checks keyboard focus/current location, saved drafts, reload, old history,
streamed output without scroll capture, independent main/side transcripts,
compact preview Escape handling and actual viewport/Send visibility at
840 by 620. Wide and compact generated screenshots were inspected.

The independently packed/audited SDK qualifies the exported selector and
declarations, exact user-choice provenance, owner-profile reopen and unchanged
model counts. Browser-safe root/React and explicit Node/MCP entrypoints pass,
as do all 12 actual installed-worker accounting/continuation probes.
Source and independent-consumer audits report zero vulnerabilities.

The actual packaged app passes **18 functional flows in 38.2 seconds**, plus
the separate **nine navigation/readability/composer flows in 24.8 seconds**.
The readability check retains its 85% threshold against the actual transcript
column, excluding the intentionally added navigation sidebar. Earlier failed
checks and the compact clipping regression are not passing evidence. No
deadlines were increased or new unsaved-draft guard bypasses introduced.

The 779,788,594-byte ZIP passes the actual bounded production update consumer.
The canonical styled DMG preserves its exact signed bundle, and the labelled
copy has identical bytes plus successful disk-image verification:

```text
release/Moguri-0.30.0-alpha.1-turn-navigation-66-macos-arm64.dmg
794037986 bytes
SHA-512:
a7401fdfc68ad29d6b1d68a8fabc5781b89ad5c5575dd8f02d1c3dd8a46dd767192c8bb4fb0530cdce721df5825e5ce7bd476a08402a6e1350ce288df1042d0e
```

The previously verified native worker payload remains byte-identical.
Ad-hoc development signing, known notices and all physical/live-provider,
Linux-release and notarization exclusions remain unchanged. No installed
personal application, Finder, real microphone, personal login or paid inference
was used.

## Compact turn and action controls

The user requests a number-free collapsed rail: plain turn blocks show prompt/
question previews on hover or keyboard focus. A little left chevron expands
the list and a right chevron collapses it. Clicking a block expands complete
original prompt/question/choice details, keeps the clicked item focused and
reveals its exact transcript position; clicking that same selected item again
collapses. Both long histories and long individual details scroll in the list,
not the page. Keyboard Enter/Space and Escape stay equivalent, and no new
model action, cross-session source, smooth scroll or reduced-motion exception
is introduced.

Reuse React/Electron (MIT), the browser-safe SDK, existing Tooltip/SettingsAction
helpers and shared theme/switch tokens. Node/component and SQLite public-domain
terms remain unchanged; no dependencies, domain events, endpoints, durable
schema or migration are added. CLI/TUI/service context, approval, source
retention, accounting and cancellation behavior are unchanged.

MCP/Linear credential and unavailable session-USD-limit removal use icon-only
Close controls with explicit accessible names/tooltips. Proposal-file and
text/image/document-preview removal use icon-only Trash controls, preserving
their exact disabled/error and user-only mutation behavior. PR draft creation,
GitHub issue import, Agent output following and all-project suggestion scope
use the shared switch appearance and native checkbox keyboard behavior.
All "Do not ask again" flags, multi-select lists and exact review/consent
acknowledgements remain checkboxes; no confirmation is weakened or inferred.

Before feature edits the generated macOS arm64/Node 26 baseline passes
OAuth/streaming in 1,077.86 ms (30.75 ms cancellation), SQLite in 63.71 ms
(append p95 0.058 ms), PTY in 159.92 ms (152.10 ms cancellation, zero survivors),
OpenTUI in 1,027.92 ms, hidden Electron in 584.28 ms (8.23 ms scroll frames),
and filesystem/Git in 89.18 ms. Live Copilot/ds4, Rust/Linux, signed/notarized
release, physical SendBox, Kupo quality, System One, configured physical SSH
and full-milestone gates remain explicitly FAIL/unavailable in this primitive.
Generated tests must prove exact block/arrow/preview/reclick/focus behavior,
bounded list scrolling, complete details, narrow main/side isolation, real
removal/toggle effects and unchanged acknowledgement semantics.
