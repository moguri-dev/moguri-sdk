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
