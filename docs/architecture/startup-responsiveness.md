# Responsive startup and session navigation

Protocol 89 keeps the local control plane authoritative and fixes the
service/read, desktop-startup and navigation paths together. It does not add
an agent framework, provider fallback, model call, runtime boundary or
client-owned durable state. Node, Electron, React, TypeBox and `ws` retain
their existing MIT notices; SQLite retains its public-domain terms. No
dependency or selected stack changes.

## Measured read bottleneck

The earlier 12-ms observation was one authenticated health request, not
startup or new-chat latency. Generated CPU profiling of a 62.8-MB retained
store attributed about 75% of samples to `EventStore.readEvents` and another
14% to garbage collection. Global profile/catalog reads parsed unrelated
encrypted payload rows repeatedly. The snapshot's global-budget sequence
query also scanned JSON for every profile snapshot.

The generated baseline measured service startup at 4,362 ms, SDK new-chat
acknowledgement at 1,079-1,317 ms, and a snapshot at 253 ms. That identifies
a real inefficiency; it is not a claim that the user's complete 15-20-second
delay was reproduced by that smaller fixture alone.

Schema 89 atomically adds `event_read_indexes_schema='1'` and two expression
indexes, `events_profile_sequence` and `events_type_sequence`. Scoped reads
filter by the immutable profile before materializing/decrypting payloads;
all-profile migration/audit reads remain explicit. SQLite uses the type index
for the global accounting sequence. Index creation does not rewrite events,
ciphertext, grants, receipts or keys. Header validation still rejects corrupt
stored metadata. Missing/corrupt/future markers or changed index definitions
fail explicitly rather than silently rebuilding provenance.

The protocol bump also prevents a new app from silently reusing the healthy
but slow protocol-88 writer. Upgrade retains the existing exact authenticated,
terminal-preserving restart review. A failed migration rolls back both indexes,
the marker and version together; reopening genuine 88 data remains supported.
Deleting personal state or manually downgrading its schema is not recovery.

After indexed reads, the same generated service starts in about 366-412 ms,
new-chat acknowledgements take 5-9 ms and snapshot reads about 1 ms. The
stronger desktop fixture retains 61 chats, 5,860 events and 67 MB of encrypted
history, including historical tool output. Actual click-to-acknowledged-visible
new chats take 131-145 ms. Its startup window appears in 319 ms while service
recovery is deliberately held. Tests enforce 1,500 ms for that window and
1,000 ms per new-chat interaction, not merely a fast health endpoint.
No history is truncated or model/tool effect replayed to meet those bounds.

The additional finite-global-policy case exposed another cost: unchanged
capacity repeatedly decrypted every profile's retained history, leaving new
chats at 2,372-2,413 ms even after indexing. Root-owned capacity reuse now keys
the exact catalog and indexed accounting sequences. It is not a client cache
or a permission grant. Active profile writers whose visible accounting head
differs must recompute; speculative transaction results are never published
into the cache because SQLite may reuse an aborted sequence. The same fixture's
finite-policy SDK acknowledgement now takes about 5-6 ms. Unknown holds and
unpriced USD remain unknown/held, never zero or refunded. Default/foreign
profile rollback, reused sequence/different amount, caller mutation, concurrent
finite admission and restart/deletion accounting are explicitly covered.

The earlier `f7a6ca0` artifact is a frozen intermediate cut, not final delivery:
its default-budget paths passed, but the incomplete full sweep was stopped when
finite-global-policy latency failed. Its native receipt qualifies only that
original source. The final host/service cut must rerun the complete checks and
physical accounting qualification even when its guest/bridge bytes are unchanged.

## Visible startup and truthful lifecycle

The native startup window is created before service discovery/recovery and
profile negotiation. Its renderer shows an explicit opening state; privileged
client initialization waits for the native-ready fence. No interactive chat
or mutation is enabled before authenticated readiness. A startup error stays
visible instead of leaving a background app with no diagnostic window.
Quitting during startup fences late admission and still waits for the exact
owned service; no late workspace window is created.

Authenticated health reads retain their two-second per-attempt limit but may
retry only a timed-out **GET**, within the existing 60-second readiness or
30-second lifecycle operation window. Each attempt rechecks the exact private
connection and canonical root, and verifies the returned PID/protocol.
Authentication rejection, changed ownership or malformed data is not a retry
or fallback. Lifecycle POSTs are never replayed, and accepted shutdown is not
completed cleanup. The canonical review fingerprint names its fields explicitly,
so JavaScript property insertion order cannot invent an owner change.

Failed quit retains original cleanup state and blocks successful exit.
Choosing **Cancel quit** restores an accessible window and reconnects only
its captured owner/profile; it cannot start or adopt another service while
recovering that cancellation. Actual acknowledgement/cleanup failure still
requires inspection/retry. Ordinary quit closes known user terminal groups;
intentional restart preserves authenticated user terminals and never replays
input. Requested, acknowledged, partial and unconfirmed outcomes stay distinct.

## Chats and multi-selection

Chats has a plus button that reuses the ordinary new-chat path, including
draft flush, terminal-navigation review, policy and actual SDK acknowledgement.
Repeated clicks cannot create overlapping pending requests; no optimistic
session ID or selected-model fallback is invented.

Selection is a session context action. Select one row, then click or press
Space/Enter on more rows; Cmd/Ctrl-click also starts selection. Selected rows
are highlighted and expose native button `aria-pressed` state, not visible
row checkboxes. Shift+F10 opens actions and Escape leaves selection. Selection
is transient and profile-scoped, bounded to the existing homogeneous
project/Chats set and 100-session backend limit.

Context actions show their exact count, such as **Archive (4)**, and reuse the
existing reviewed bulk attach/detach/archive/delete SDK APIs. Unsupported
single-target actions are not silently applied to one row of a larger set.
Single-row actions keep their existing review; bulk actions retain complete
set/revision/root checks, child-tree choices, real cancellation and cleanup.
Archive keeps drafts/history; deletion cannot remove independent artifacts,
external code, worktrees or PRs. Confirmation checkboxes inside destructive
review dialogs remain; only navigation row checkboxes are removed.

## Prerequisites and qualification

Before feature edits, the generated Phase 0 baseline passed six available
primitives on macOS arm64: six intercepted provider requests (31.69-ms
cancellation), 1,000 SQLite events (0.065-ms append p95; 0.500-ms rebuild),
known-group PTY cancellation (151.41 ms, zero observed survivors), 60 OpenTUI
updates (17.13-ms mean), hidden Electron (169.07-ms ready; 440.78 MiB;
8.00-ms scroll frames), and 2,000-file search/Git (0.88/5.88 ms).
Unavailable live-provider, Rust/Linux, notarization, configured SSH and
broader roadmap gates in that baseline are not claimed as passed.

Migration rollback/reopen, equivalent profile/type ordering, exact SQL query
plans, concurrent append/rollback and refusal of missing/corrupt provenance
are covered with generated fixtures. Native checks exercise early window
visibility, real SDK/service/renderer new-chat acknowledgement, cancelled
failed quit, unchanged-owner recovery and keyboard-counted multi-selection.
Protocol 89 changes the bridge payload; old protocol-88 native/package
receipts must not be relabeled. Exact current package/native evidence and
remaining physical qualification limits are recorded with delivery artifacts.

## Delivery qualification

The corrected executable cut is `18bd457`, protocol 89,
Moguri `0.31.0-alpha.1`, pinned Node 26.12.0. All measurements below use
generated state and secret backends, not the user's installation, database,
keys, terminals, authorization or microphone.

| Exact check | Result |
| --- | --- |
| Typecheck/build and root audit | PASS; zero vulnerabilities |
| Complete unit/integration suite, default concurrency | PASS; 2,209 passed, 29 skipped, zero failures/cancellations in 1,738.67 s |
| Complete hidden desktop suite after readiness-test repair | PASS; 327 passed, four skipped, zero failures in 591.44 s |
| Actual frozen-88 ciphertext migration | PASS; no event/key/grant/receipt byte change; saved draft, held queue and independent artifact recover |
| Actual frozen-88 authenticated restart into current SDK | PASS in 914 ms; one explicit generated upgrade review, original PTY/PID/output with no input replay, retained unknown model hold and saved input/artifact; no second model call |
| Independent packed SDK/all four entrypoints | PASS in 118.42 s; declarations, actual runtime/worker/bridge probes and zero consumer vulnerabilities |
| Complete actual-package verifier | PASS in 60.46 s |
| Untouched actual packaged Electron | PASS; 13 cases in 24.7 s, one unpackaged-only skip |
| Additional actual-package clipboard, clone, menu and update-link interactions | PASS; all seven repaired cases in 13.5 s, using the same frozen app |
| Packaged finite-policy 67-MB / 61-chat fixture | PASS; first window 344 ms, full startup to enabled chat creation 1,280 ms; acknowledged visible new chats 126-242 ms |
| Exact current physical SendBox qualification | PASS in 40.57 s; all eight gates, including real service/worker accounting, groups, five native retry/checkpoint cases and verified owned-guest teardown |
| Production ZIP/manifest consumer | PASS; 814,542,934 bytes in 111.71 s |
| Read-only actual DMG/layout | PASS; exact signed app bytes, Applications shortcut and native geometry/background; Finder/app were not opened by that check |

Artifacts are frozen under
`release/qualification-builds/responsive-startup-18bd457/`:

| File | Bytes | SHA-256 |
| --- | --- | --- |
| `Moguri-0.31.0-alpha.1-macos-arm64.dmg` | 830095894 | `71b223d2da5f3f87ccc4094addb3dd634e05d5400242bc11c2b36b1d72960299` |
| `Moguri-0.31.0-alpha.1-macos-arm64.zip` | 814542934 | `d5c7dd05c65d0dc9de6ea5b80a5ae21ff80cd82f1a05dab80149d7080aa2e332` |

The actual app is
`builds.noindex/0.31.0-alpha.1/Moguri-darwin-arm64/Moguri.app`.
Its matching integrity manifest has the same archive stem and
`.manifest.json` suffix. These are **ad-hoc-signed, not notarized**, not
published or installed automatically. The image exceeds chat's attachment
limit and remains a local artifact. Intermediate `f7a6ca0` and earlier
protocol-88 artifacts remain byte-identical and are not the current repair.

The current guest image is
`docker.io/library/moguri-worker@sha256:8b3ecbfd342357a9032d98fae70c1e65006fad2b9b24f3304967e0619f9f4ed2`.
Its new no-cache producer took 82.24 s. The exact 466,206,720-byte OCI archive
has SHA-512
`f4fc46170642a52b1f871adf62119f963d5aff0a7e70001132f40738c1f18e7ac9310cfe10aabf406ff5f805059d9331c0a0b0fd72f2d8f1f501ad4d7a960567`.
Distribution manifest SHA-256 is
`32ad3ad0dfdb5266cb4e0ad87d3894cb4910c6f6ceef96d71e00c9fc952ae779`;
bridge SHA-256 is
`43a9fcd5dd7ff8c7459b6cfc73dd99e1d77caf928fa1520aab8ad1462635e0e2`.
Worker/MCP/data bytes are unchanged from 88, but the changed bridge/protocol
and host accounting were physically requalified, not inherited.

Clean-source `18bd457` evidence is retained at
`.native/qualification/current-sendbox-gNzfJh/qualification.json`,
SHA-256 `0449217da7c234f27db9163b47f77fb0901924bb7e1395b32fa7b95a18443134`.
The original intermediate-cut receipt remains separately at
`current-sendbox-BxhMjh/qualification.json`. No shared images or unrelated
guests were removed. Generated model calls are not paid inference or live
provider/quality/billing qualification.

The historical-upgrade harness initially failed its generated wrapper launch;
isolated module-format and canonical-root bindings were corrected before the
successful result above. Failed attempts were not counted as passes. Generated
fixture cleanup used exact private-root/parent/owner identity; no personal
process or data was modified.

The first complete current desktop sweep found seven obsolete test assumptions:
six installed generated IPC overrides immediately after `firstWindow()`, before
native registration, and one expected Rename to precede the new Select action.
The native-hook race was reproduced with its actual duplicate-handler startup
error. Those tests now wait for the operational workspace before overriding
native handlers and check the new keyboard order. Early-window responsiveness
tests still measure opening before backend readiness; no product deadline,
readiness fence or packaged byte was changed to conceal the failed run.
All seven corrected cases pass twice in one 23.7-s runner invocation;
the complete 331-case desktop rerun and additional actual-package check are
separate passes, not extrapolated from that targeted result. Subsequent
commits change documentation and those test assumptions only; executable
source, immutable app/archive bytes and clean-source native evidence remain
the qualified `18bd457` cut.

Main-only CI run `41602139750` on base `60197e5` separately exceeded both
jobs' 30-minute cap during `npm test`. No branch/PR trigger, timeout or rerun
was changed to conceal it. All complete checks above ran locally; an empty
working-branch check list is not a claim that the earlier main run passed.

Existing warnings remain: experimental OpenTUI FFI, renderer chunks over
500 kB, missing optional Apple `.icon` companion while `.icns` exists, and
generated Sandbox-feed diagnostics. This is not notarization, external-Linux
release readiness, personal-provider validation or wider milestone acceptance.

## Submitted input feedback and remaining latency

The generated `18bd457` timings above did not establish that the user's full
startup/new-chat/first-send delays were fixed. Subsequent read-only diagnostics
and generated job-heavy fixtures did not capture/reproduce the slow UI action;
fast idle health/snapshot responses are not proof of responsive admission.
The remaining acknowledgement/startup performance issue stays open.

One separate visible gap is established: the composer cleared its original
draft before acknowledgement, while the transcript could render only the
later service snapshot. The shared SDK now retains an owner-local
`DraftState.pendingInput` during that existing request. Desktop main/side
transcripts and the TUI display its exact captured text and attachments with
an explicit Sending/Holding/Steer/Interrupt acknowledgement label. It has no
canonical message ID and never enters history, model context, billing,
permissions or question answers. Newer typing remains separate. Settlement
clears only that transient row; rejected/unknown outcomes retain existing
draft/conflict and no-replay behaviour.

No dependency, stack, service API, durable event, schema marker or migration
is added by this feedback/diagnostic change. Existing React/OpenTUI and SDK
draft mechanisms are reused. It does not shorten or conceal an unmeasured
backend acknowledgement.

Native startup now exposes a read-only, main-renderer-only phase snapshot
before the native-ready fence. The opening screen shows the actual waiting
phase and elapsed time without enabling any early mutation. Completed phase
durations remain available for the user's diagnostic copy. The native-ready,
shutdown, owner/profile and cancellation fences are unchanged.

Each immutable SDK client also retains at most 50 payload-free request timing
observations. The getter returns clones and never emits a state-change loop.
Only fixed operation categories, connection generation, status, completion
and monotonic transport durations are collected; no source text, identifiers,
paths, endpoints, credentials or provider/model data are retained. Desktop
Insights can copy these alongside startup phases; TUI `/trace` exposes its
client timings. They are not server CPU, model latency or permission evidence.

Generated tests hold the original send before effects, require immediate
visible feedback while the service still has no message/queue/model call,
then verify actual acknowledgement or exact refusal recovery. Shared tests
cover newer typing, held delivery and unknown acknowledgements without replay;
native TUI and hidden desktop cover the same transient state. Diagnostic tests
cover bounds, caller mutation, failed status and payload/credential exclusion.
