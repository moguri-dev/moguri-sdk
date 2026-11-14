# Responsive startup and session navigation

## Simplified opening and classifier-owned Kupo thinking

The opening surface has no drafting controls. It displays the flight game,
actual startup progress and original-owner recovery only; ordinary saved chat
drafts remain service-owned and restore after authenticated readiness. The
removed opening composer was RAM-only, so there is no durable draft migration
or automatic transfer to perform. SDK, application and original-connection
loading run concurrently rather than serializing application loading behind
the SDK import. Last-view metadata remains presentation-only.

Balanced, Savings and Performance remain explicit **routing preferences**, not
effort levels. Kupo's existing classifier advice and qualified per-model
mapping choose actual thinking. New manual Kupo effort overrides are rejected
by the service without mutation or inference. Previously retained overrides
remain visible and blocked until the user clears that exact effort; context,
budget and permission policy are not silently changed. Fixed-model thinking
and its retained preference remain supported. Desktop and TUI use the same SDK
and service boundary.

Imported skills use native checkbox switches and an explicit **Enable all**
action scoped to the currently listed project skills. Each existing
`capability.toggle` command retains its exact revision check. The batch reports
acknowledged progress, stops on the first failure and never rolls back committed
changes or enables another scope. Enabling does not admit a source or grant
tools, network, execution or permissions. Imports still start disabled.

React, Electron, Node and TypeBox retain their existing MIT licenses and SQLite
its public-domain notice. No library, event or durable payload field is added.
Protocol 104 makes the classifier-only control contract require a matching
service; its additive metadata/index migration preserves existing events,
ciphertext, grants, queues and drafts. Existing protocol-103 native-image
receipts do not qualify changed protocol-104 executables.

Before feature edits, generated Phase 0 passed all six available primitives:
31.42-ms intercepted cancellation; SQLite append p95 0.060 ms/rebuild 0.535 ms;
151.48-ms known-group PTY cancellation with zero survivors; 60 OpenTUI updates
at 17.20 ms mean; hidden Electron ready in 191.37 ms, 451.44 MiB and 8.12-ms
scroll frames; generated filesystem search 0.96 ms/Git status 9.66 ms. The
model-option spike passed in 78.91 ms. Its existing live/provider, native/SSH
and release-qualification limitations remain unqualified, not silently passed.

The clean `21a89b2` hidden-desktop baseline measured a 316.08-ms first window,
1,911.90-ms ready state with 61 retained chats and 2,098.74-ms unpaused startup
with 25,000 retained issue revisions. The existing 1,500/3,000-ms startup
budgets remain unchanged. Focused checks cover absent startup drafting, saved
draft/cache/owner reconciliation, gameplay, Kupo rejection and actual wire
effort, fixed-model tuning, keyboard skill toggles, partial batch failure,
scope isolation and persisted reload.

### Measured startup bottleneck

The simplified bootstrap alone left complete retained-history startup near its
2.10-second baseline; it did not demonstrate a material readiness improvement.
A CPU profile of the generated cold runtime identified three store constructors
spending about 466 ms rescanning full event JSON for header metadata. Payload
decoding/authentication remained separate. This does not diagnose the earlier
unreproduced personal 90-second report.

Migration104 adds the SQLite-maintained `events_startup_headers` covering index
for exactly the existing sequence/header/payload-type expressions. Every open
still validates every original event header; fresh encrypted payloads, scope
keys, provenance and accounting are still authenticated and projected by the
original readers. No decrypted event, permission or budget result is memoized,
and connection/profile ownership or teardown is unchanged. SQLite's generated
query plan confirms an index-only scan with no JSON-function calls over the
encrypted body. A failed index migration rolls back atomically; malformed or
missing current index definitions fail visibly rather than rebuilding history.
Focused real-database checks cover unchanged ciphertext/grants/receipts,
restart, fresh corrupt-header rejection and existing peer/rollback/forgetting
boundaries.

With the same generated 61-chat/25,535-issue cold workload, Node26.12.0 and three
unprofiled samples per cut, median child-runtime readiness fell from 1,637.03 to
1,229.80 ms. Median fully rendered, authenticated desktop readiness fell from
1,808.48 to 1,399.60 ms (22.6% lower). The unpaused 25,000-issue desktop sample
fell from 2,098.74 to 1,807.90 ms. First-window time stayed near 0.32 seconds;
this is a retained-history readiness improvement, not a claimed launch-animation
speedup or a diagnosis of the old personal startup incident.

For generated-fixture diagnosis only, set `MOGURI_TEST_STARTUP_PROFILE_DIR` to
an existing private directory and select `real cold main/runtime opening 1`
in `tests/e2e/deferred-startup.spec.ts`. The bounded child writes a standard
Node CPU profile without opening a debugger port or using personal state.

One obsolete opening-draft-adoption unit in
`tests/desktop-startup-cache.test.ts` was retired with the removed feature.
The existing browser cases were rewritten, not removed: they still exercise
saved drafts, peer changes, deleted destinations, store identity and late
original-owner recovery, now with no startup composer. Cache compatibility
accepts old bounded draft hints but no longer writes or reacts to them.

Current pre-image software checks pass 111 shared/service/storage/actual-TUI
cases and 42 hidden-desktop cases, with five Sandbox client cases explicitly
unqualified in each runner until the new exact image is approved. A separate
27-case Local/SSH selection covers all routing patterns, manual-effort
rejections and mixed attachment/window paths. The independently installed
packed SDK, all entrypoints and actual CLI/runtime/worker recovery pass through
official npm; the consumer audit reports zero vulnerabilities. Existing
experimental FFI, large Vite chunks and transitive encoding/DOMException
deprecation warnings remain. Neither these results nor prior protocol103
native receipts imply a fresh complete milestone matrix.

## Protocol-96 original-owner readiness and background window close

### Confirmed failure, not an invented delay cause

The reported 60-second dialog came from an installed protocol-94 desktop and
service, not the protocol-95 source merged in
[#58](https://github.com/mbianchidev/moguri/pull/58). The installed service SHA-256
was `d5828fc0ccb7f5e9d03981ec75fa5c0bce7e15c4e68e1f3cb5fe714d671a9886`;
its bundled Node was 26.12.0. The package version alone did not identify its
source commit. The historical missing-entrypoint message in the append-only
log preceded multiple successful startups and was not this failure.

Read-only private ownership/publication metadata and authenticated health
confirmed that the original service survived. Its connection appeared about
90 seconds after its writer lock. The retention-key and whole-store-lease
fences had already completed within about 160 ms; provider discovery began
about 79 seconds after the lock. No personal state, key, event payload or
conversation was copied into a fixture.

The demonstrated client failure was separate: the desktop treated an
**unconfirmed** readiness deadline as a fatal native-initialization rejection.
Its one-shot `nativeReady` promise remained rejected permanently. The original
service could subsequently authenticate, but the same opening window could
not reconnect. Its cached labels and unsent local text were correctly retained,
but the dialog offered no usable continuation.

Comparable generated history did not reproduce the 90-second initialization:
41,069 generated issue revisions started the source service in 1,543 ms;
the actual installed protocol-94 runtime started 46,929 generated events /
360 MB of cleartext history in 1,869 ms. An explicitly approved, same-installed-
runtime, terminal-preserving diagnostic restart authenticated in 4,445 ms,
including instrumentation. Payload-free measurements included 12 ms of secret
backend reads and 1,285 ms of header queries. These later observations do
**not** establish why the original startup took 90 seconds, prove a cold-cache
cause, or blame inbox migration. That initialization delay remains an
unreproduced limitation rather than a claimed repaired measurement.

### Exact-owner continuation

The shared Node SDK now distinguishes `ServiceStartupUnconfirmed` from a
fatal import, migration, authentication or cleanup error. Its transient
`ServiceStartupReview` binds the canonical private root/device/inode, exact
private writer-file identity and content, original PID, and any already
captured connection fingerprint. An originally observed stale publication
may be awaited, never authenticated as the new owner. A replacement root,
writer or captured connection fails explicitly.
The root/writer/connection review is captured before health inspection;
a lost health completion cannot mint a fresh review for a replacement root.

`reviewServiceStartup` is read-only. `waitForStartupService` authenticates
only the captured owner without enforcing a caller's wire version, so an
explicit lifecycle operation can inspect its original older service.
`ensureConnection({ startupReview })` additionally requires the matching
protocol and cannot create a directory, open a launch log, start a process
or select another installation. Protocol upgrades still require the existing
exact authenticated, terminal-preserving user review. No PID-only stop,
registry removal or replacement launch is introduced.

The existing **60-second readiness deadline**, two-second health attempts,
30-second lifecycle deadline and measured 700/1,000/1,500/3,000-ms regression
budgets are unchanged. A user reconnect is a separate explicit read operation,
not an automatically extended startup deadline. SDK discovery cancellation
ends that caller's wait; it does not stop another client's service, replay
work or authorize another launch.

The desktop keeps native initialization suspended after this unconfirmed
result. **Reconnect to original service** names the exact current startup
revision; stale or duplicate actions cannot release a different attempt.
Only original authenticated readiness releases the native-ready fence.
Fatal diagnostics still remain fatal. Startup quit can inspect and close
the same owner without admitting a late operational window; failed cleanup
keeps the original continuation and cancellation review available.

After operational admission, an established desktop may authenticate a
replacement from an explicit service restart only within the same captured
private root/device/inode and retained store identity. This is a read-only
reconnect; absence or failure cannot start another service. Its current
authenticated owner becomes the subsequent Quit target. Cancelled-quit
recovery still pins its exact original fingerprint and cannot follow a
replacement. The actual-package console/restart harness reproduced a broader
pin incorrectly blocking this established path; the fix preserves those
distinct ownership contracts instead of skipping restart coverage.

The cached last-view metadata, model labels, selection and text remain in
their existing RAM-only presentation/draft compartments. Reconnect does not
send or queue text, save to another profile, select a substitute model or
overwrite a peer draft. Exact live root/store/profile/session and draft-CAS
reconciliation remains required.

### Keep agents running on window close

The user explicitly selected this boundary: **closing the last window keeps
the agent working in the background; explicit Quit stops the service**.
General has a default-on **Keep agents running when the last window closes**
preference. It belongs to the authoritative encrypted application configuration,
shared across profiles and SDK clients, not a renderer-only flag.

Window close reads the actual root-owned preference and rechecks the original
connection before quitting Electron. With it enabled, the same service,
existing agent/tool work and authenticated user terminals continue. Reopening
attaches to that already-ready service instead of rehydrating retained history
on every ordinary window close. This neither dispatches a draft/held queue nor
widen permissions, environment policy or model budgets. Explicit Quit, or
window close with the opt-out saved, retains ordinary authenticated stop:
known user terminal groups close, actual cancellation outcomes remain truthful,
and unconfirmed cleanup blocks successful exit. Intentional restart continues
to preserve exact terminal owners without input replay.
The service retains attention while the desktop is closed; native desktop
notifications and side-panel views require reopening the desktop. No hidden
Electron window, microphone or renderer is kept alive to claim background work.
Cancelling an unsaved Quit clears that transient Quit intent; a later ordinary
window close must still keep the background agent running under the saved
preference. Preference tests wait for native application acknowledgement and
the Settings **Saved** state before teardown, not just an early backend value.

`background_service_schema='1'` and schema/protocol 96 migrate genuine
protocol-95 state, including its real `my_work_inbox_schema='1'` history.
The marker/version transaction does not rewrite ciphertext, grants, receipts,
inbox observations, drafts or accounting. Legacy application flags retain
their values; absence of the new field resolves to the new documented factory
preference. Missing/corrupt/premature markers and actual background-preference
history relabelled as 95 are rejected. This is not another independent
protocol-95 lineage. Node, Electron, React, TypeBox and SQLite are reused under
their existing MIT/public-domain notices; there is no new dependency or stack.

### Phase 0 and evidence scope

The pre-edit generated macOS arm64 Phase 0 run reported:

| Available primitive | Result and measurement |
| --- | --- |
| Intercepted Copilot requests/cancellation | PASS; six requests, 31.70-ms cancellation |
| SQLite WAL/rebuild | PASS; 1,000 events, 0.061-ms append p95, 0.520-ms rebuild |
| Known-group PTY cancellation | PASS; 153.44 ms, zero survivors |
| OpenTUI updates | PASS; 60 updates, 17.91-ms mean |
| Hidden Electron | PASS; 191.12-ms ready, 444.22 MiB, 7.92-ms scroll frames |
| Generated filesystem/Git | PASS; 2,000 files, 0.81-ms search, 6.29-ms Git status |

The same probe reported unavailable/unqualified live Copilot/DS4, Rust/Linux,
signing/notarization/Linux packaging, installed native SendBox, evaluated
multi-model/decision providers, configured SSH, and its broader initial-
checkpoint attachment/default/budget gate as FAIL. Those probe limitations
are not claims that all corresponding executable features are absent, and
they are not silently promoted to release acceptance.

Final source, independently installed SDK and hidden packaged-client
qualification must use matching frozen implementation/test/build bytes.
The original diagnostic restart and historical protocol-94/95 receipts are
not a receipt for the new implementation. No replacement app was installed
or opened, and no personal draft was discarded by this investigation.

### Frozen protocol-96 delivery qualification

The final executable source is `0875c37`. The subsequent `e71edb2` change
corrects two generated desktop-fixture assumptions only: help is located
through its actual control's row, and the generated Git observer's merge-base
cache is seeded before exact remote review. It changes no guard, global Git
setting or user editor configuration. The `323cda8` correction changes only
the native qualification reporter to use the actual retained completed setup
operation and acceptance, instead of undefined pre-refactor fixture locals.
All 459 frozen build entries, including 15 symbolic-link targets, remain
identical to the final source/desktop test cut. All application, SDK, service,
worker and executed Node-test inputs remain unchanged.

| Current evidence | Result |
| --- | --- |
| Build and final source/TUI type checks | PASS; final bundle bytes checked against the frozen build |
| Complete serial source suite | 10,637 passed, 29 skipped, zero failures/cancellations; 8,181.70 s |
| Complete corrected hidden desktop suite | 392 passed, five skipped, zero failures; 15.8 min |
| Actual unchanged packaged startup/background/reconnect cases | All 25 passed; 2.0 min, including the real 60-second readiness window |
| Actual signed-package verifier | PASS; bundled Node/CLI/TUI/service/worker, authenticated restart, original PTY reattachment, four consoles and ordinary shutdown |
| Independent packed SDK | PASS; approved/audited generated install, root/React/Node imports and declarations, actual CLI/TUI/runtime/worker, late original-owner startup and restart recovery |
| Genuine frozen protocol-95 SDK/runtime into 96 | PASS; actual original controller SIGKILL, 18 original ciphertext rows, keys/grants, inbox marker, saved draft, held queue and independent artifact preserved; zero read/model replay |
| Root and independent consumer audits | Zero vulnerabilities; existing transitive `whatwg-encoding` and `node-domexception` deprecation warnings remain |
| Fresh physical native qualification | All eight gates PASS on clean `323cda8`, 82.67 s; four worker role calls/168 reported tokens, exact setup acceptance, real network evidence and owned-guest teardown |
| Production ZIP/update consumer and private read-only DMG | PASS; ZIP staging 136.50 s, native geometry/icons/1x/2x pixels and exact signed bundle verified without opening Finder, executing the app or bypassing quarantine |

These are generated-fixture and exact-development-artifact receipts, not
live paid inference, model quality, billed spend, notarization or Linux
release qualification. Physical eight-gate acceptance does not qualify all
3,360 separate Sandbox combination cells. The repository's main-only CI was
not triggered on this working branch.

| Actual current packaged startup observation | Measurement |
| --- | --- |
| Warm background close/reopen | First window 322.41 ms; authenticated ready 440.27 ms; original agent and terminal retained |
| Real unconfirmed deadline | 60,374.86 ms; original-owner reconnect/local-draft save 150.60 ms after readiness, no dispatch/model call |
| Issue-heavy unpaused cold desktop | 25,000 retained revisions; authenticated ready 1,798.64 ms |
| Mixed-history visible new-chat acknowledgements | 129.78-144.60 ms |
| Ordinary first Send including unflushed local text | 340.05-372.84 ms |
| Electron shell with one/four consoles | 559.44/565.13 MiB, below the unchanged 600-MiB shell budget |

The service/broker-inclusive one/four-console totals are separately reported
as 1,057.38/1,064.47 MiB; they are not silently folded into the shell's scope.
The final complete source-desktop run also retained the draft across its
60,567.33-ms deadline and explicitly reconnected in 137.10 ms. Its unpaused
issue-heavy startup was 2,167.99 ms. The fresh independent SDK crossed its
actual deadline at 60,001.21 ms and authenticated only its original owner at
61,616.16 ms. The 700/1,000/1,500/3,000-ms regression budgets were not raised.

Exact ad-hoc, non-notarized development artifacts remain under
`release/qualification-builds/startup-readiness-0875c37/`:

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `Moguri-0.31.0-alpha.1-macos-arm64.zip` | 874,714,471 | `a2f4e6c0136e283b84f50785c2167eefa126e1764ef5a8e301901d5de8ea3564` |
| `Moguri-0.31.0-alpha.1-macos-arm64.dmg` | 890,752,340 | `1709d02113a3272eccaa04cf8b72f6fefacb0b5d930457c7feb11e9f6472143d` |
| `Moguri-0.31.0-alpha.1-macos-arm64.manifest.json` | 536 | `d8253c17d067e495546653692124a5390a4f481f6559cbde8d4b09790d460cb1` |

The manifest retains the verified ZIP SHA-512 and exact signed bundle-tree
SHA-512. The genuine frozen-95 SDK archive SHA-256 is
`b94048c2cc9a6511f9898e380a3143c5bfbe1a2b5e4bea8d02d51e9e51dfae75`.
SDK archive and complete source/test/build/log seals are retained separately
with the delivery receipts; documentation-only edits cannot relabel an older
archive or changed executable input as qualified.

The fresh no-cache Linux-arm64 worker producer is
`docker.io/library/moguri-worker@sha256:da7b07f5fcd4ea9de37880934b9e5420354ffbfc8ef2272044bde9b9a66743c0`,
with the exact protocol-96 payload, pinned Node 26.12.0, native PTY validation
and zero locked-consumer vulnerabilities. Producer time was 38,361.52 ms.
The actual physical report is
`.native/qualification/current-sendbox-OqtVQI/qualification.json`, SHA-256
`93eea6eefa37aeceb57be2bba7979f1cfe97473f6cb224ad7339f7b22ffc8f35`.
No historical protocol-95 native receipt was substituted.

The incomplete outdated-migration run, sleep-affected source sweep, first
desktop-fixture failures, broader established-reconnect package failure and
initial native reporter `ReferenceError` remain separate failed receipts.
The native failure report is
`.native/qualification/current-sendbox-RBRDfP/qualification.json`; its
other completed gates and teardown did not make that failed report pass.
Command-bound sleep prevention was explicitly approved for the final serial
runs, with no permanent power setting changes.

Temporary diagnostic preloaders/helpers, raw CPU profiles and the generated
frozen-95 consumer install were removed after their exact processes had ended.
An orphaned hidden Electron verifier from the failed `46c5b72` package was
stopped only after its original executable, helper parents and private generated
root were confirmed; all three bound PIDs are absent. Frozen archives, logs
and private generated failure/native evidence remain available. Owned guests
are confirmed absent, no shared image was removed, and the personal app,
service, terminals, state and RAM-only opening draft were not targeted by
qualification cleanup. The user's installed protocol-94 app was not replaced.

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
profile negotiation. Its background is black from native window creation.
The renderer shows the original mascot and an optional scored flight game,
not placeholder navigation or an incomplete chat. Space or clicking supplies
one flap; ordinary editable elements and controls keep their own keyboard
behavior.
The original SVG supplies both wing groups; there is no remote asset, image
generation, canvas engine or additional dependency.

Flight state is disposable renderer-only amusement, never a service/domain
event, prompt, permission or telemetry claim. The score sits in the window's
upper-left corner, below the native drag area. The first flap starts a round;
gravity can bring Moguri to the ground and lose. A cloud collision also ends
the round. Loss freezes the score and simulation; Space/click or Enter on
**Play again** starts afresh. Score rewards altitude and time aloft, with
50 additional points per collected gold star, consumed exactly once.

Randomly spaced, random-height clouds and stars approach from the right.
A round-local seed makes the model deterministic without introducing global
randomness inside React state updates. Spawn intervals and offscreen removal
bound the live objects. Shared arena dimensions drive both circle collisions
and responsive DOM/SVG positions; a ceiling keeps the mascot visible.
Frame-rate-independent gravity caps an elapsed frame at 50 ms, so a suspended
window cannot gain unplayed altitude or replay missed spawns.
Animation frames stop after loss and all frames/listeners are removed on
unmount. Reduced motion disables decorative wing animation, not essential
gameplay positions: a frozen avatar cannot truthfully show falling or collisions.
The optional game never holds the live-client readiness transition.

This follow-up reuses the original mascot, original small cloud/star SVG paths,
React and Electron (MIT). There is no dependency, SDK API, durable event/schema,
migration, TUI or service change. Focused model tests cover loss/restart,
frame timing, bounded seeded spawning, collisions/near misses and one-time bonus
accounting. Hidden desktop journeys exercise the corner HUD, keyboard play,
real falling/restart and reduced-motion behavior while preserving local drafts
and the authenticated-ready handoff.

Pre-change macOS arm64 Phase 0 on 2026-11-13 passed generated provider
streaming/cancellation in 1,093.49/31.66 ms; 1,000 SQLite events at 0.0655 ms
append p95 and 0.5133 ms rebuild; PTY cancellation in 151.92 ms with no survivors;
and 60 OpenTUI updates averaging 17.09 ms. The 10,000-row Electron shell passed
at 178.22 ms cold start, 449.09 MiB and 8.10 ms scrolling frames. Generated
2,000-file search/Git baselines passed at 0.864/5.980 ms. Session primitives
passed 500 events/250 retained artifacts in 104.87 ms and real strict-CSP hidden
Ghostty at 108x24 cells in 23.40 ms. The base spike's eight live inference,
Rust/Linux, signed packaging, native SendBox, Kupo quality, live decision,
remote SSH and full attachment/default/budget gates remain FAIL/unqualified;
these generated results do not qualify them.

**Draft while waiting** reveals the existing RAM-only local editor and
read-only cached model labels. Exact destination/draft reconciliation,
before-unload protection and explicit conflict review remain unchanged.
Current phase, startup errors and original-owner reconnect stay visible
outside that optional disclosure. Privileged
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

The immutable feedback/diagnostic cut is `37f674d`, protocol 89,
Moguri `0.31.0-alpha.1`. It is not a claim that the remaining live latency
has been resolved:

| Exact check | Result |
| --- | --- |
| Shared draft/queue/dictation, diagnostic bounds/privacy and native-input checks | 20 passed |
| Transport negotiation and all capability-client regression files | 28 passed |
| Complete native TUI/input suite | 42 passed, one skipped |
| Complete hidden desktop suite | 330 passed, four skipped, zero failures; 631.91 s |
| Independently installed packed SDK/types/runtime and audit | PASS; zero vulnerabilities |
| Actual complete application package verifier | PASS |
| Actual packaged pending input, diagnostic copy, startup/selection/shutdown | 11 passed |
| Actual packaged input visible before delayed acknowledgement | 19-25 ms; no service queue/message/model call yet |
| Actual ZIP/manifest consumer and read-only DMG/layout | PASS; no Finder/app opened by the layout check |
| Fresh clean-source physical SendBox qualification | All eight gates PASS in 44.01 s; owned guests confirmed absent |

Current artifacts are under
`release/qualification-builds/pending-input-37f674d/`:

| File | Bytes | SHA-256 |
| --- | --- | --- |
| `Moguri-0.31.0-alpha.1-macos-arm64.dmg` | 830090199 | `ec7855598d26f8f3bf0c588b1433adeb28da9a5ded1c24a5ab744d82fcd1caac` |
| `Moguri-0.31.0-alpha.1-macos-arm64.zip` | 814546579 | `d292c8b8cc0fd37a600a0c810d141625f8f9905400098b7e1755447e877b3c5e` |

The matching app is
`builds.noindex/0.31.0-alpha.1/Moguri-darwin-arm64/Moguri.app`.
It is ad-hoc-signed, not notarized, not uploaded or installed automatically.
The installer is too large for a chat attachment. The complete package uses
generated fixtures only; no personal inference, authorization or microphone.

Compiled service/desktop bytes changed. Worker, remote bridge, MCP/data
workers and private terminal-broker bytes were explicitly compared with the
qualified 89 cut and remained identical. The existing exact guest image
`sha256:8b3ecbfd342357a9032d98fae70c1e65006fad2b9b24f3304967e0619f9f4ed2`
was reused, while current host/control-plane accounting and teardown were
physically rerun. Clean-source receipt:
`.native/qualification/current-sendbox-qDdp5B/qualification.json`,
SHA-256 `4ad441fbf96bbe6ea700aeaa57d963592361ab6fa73ffd55cd517fa841311fd3`.

The source desktop startup fixture now deliberately waits for a diagnostic
phase before releasing recovery. Its complete-startup number includes that
controlled wait and must not be presented as a directly comparable live
startup benchmark. The current qualification proves the feedback, diagnostics
and preserved fences, not the unresolved user's acknowledgement latency.

## Protocol-90 interaction follow-up

The subsequent source cuts add the owner's retained-activity reuse, inline
rename, ordinary live input, bounded first-topic naming and dictation fixes.
They reuse the existing SDK, worker, encrypted store and MIT libraries with
no new dependency. `chat_titles_schema='1'` and `live_delivery_schema='1'`
commit together after the existing 89 indexes; genuine old ciphertext,
receipts, held input and unknown accounting are not rewritten.
See [session interactions](session-interactions.md),
[first-topic naming](chat-titles.md) and
[the voice/ownership contract](session-reliability.md).

### Established causes, separate from remaining latency

A generated held discovery promise proves authenticated service publication
was waiting for provider discovery unrelated to state/ownership recovery.
Publication and chat creation no longer wait for it; model availability remains
Connecting until the actual result. Source cold recovery authenticates without
waiting for the generated eleven-second provider delay, without changing the
existing launcher deadline or saved draft. A protected rotating OAuth refresh still
settles/persists its replacement token before shutdown; caller cancellation
is not permission to discard that credential.

One failed native Browser status poll previously stopped all future polls,
permanently stranding its host. The generated real hidden-window regression
fails with zero recovery reads. Exact-owner bounded status recovery now
revokes control, never replays an action, keeps the same native view and
requires explicit re-enable. Current actual-packaged coverage passes that
case in 2.7 s including the injected failure and real accessibility action.
This proves the reproduced recovery bug, not the cause of the user's original
uncorrelated Failed to fetch.

Default-on dictation also warmed an AudioContext when no speech model was
configured. The actual four-console package hit **601.13 MiB** against the
unchanged **600-MiB** Electron-shell budget, with an extra audio utility.
Exact current SDK/profile/backend/model readiness now gates that silent graph.
Three unconfigured chat switches construct no AudioContext, request no
microphone and start no recognition/model job. Configured cold-onset PCM and
live partial/final insertion remain covered with generated audio.

The corrected actual package has only its Browser/GPU/Network Service/Tab
processes at this checkpoint: **539.72 MiB** for one console and **546.67 MiB**
for four consoles under one authenticated broker. The service/broker combined
Moguri totals are separately reported as 1,030.16/1,038.19 MiB; user programs
are not hidden inside the shell budget. No threshold or sample scope changed.

The user's real 16.1-second service phase and 2.8/5.6/8.4-second before-header
waits remain distinct observed evidence. New numeric service/proxy/loop-window
spans can localize a naturally slow action without payloads or another model
call. These generated causes and fast interactions do not establish that
every live waiting path is eliminated, nor classify incomplete trace entries
as timeouts or assign them invented request/source correlations.

### Immutable current installer and actual forms

Current executable code is **`2ef8968`**, retaining the clean backend
**`55b50e4`**. The app, ZIP, DMG and manifest are under
`release/qualification-builds/interaction-2ef8968/`.

| File | Bytes | SHA-256 |
| --- | --- | --- |
| `Moguri-0.31.0-alpha.1-macos-arm64.dmg` | 830122878 | `e453ddc706d32992b47b1cee6308b1c621d610cfc531cfa7435b855006ccf78d` |
| `Moguri-0.31.0-alpha.1-macos-arm64.zip` | 814566653 | `9fe4d89616536039216aad040214fd0503d63bd2c2aa3a5c811acb98d430309f` |

It is **ad-hoc signed, not notarized**, not uploaded, installed or opened in
the user's application directory. Historical 88/89/37 and intermediate
`interaction-55b50e4` artifacts remain separate and byte-preserved.
The installer exceeds chat's attachment limit.

The external packed SDK installation/audit passes, as do the actual app's
unmodified bundled CLI/exec launcher, SDK/runtime/worker, cold startup,
shutdown/restart, retained replay negotiation, Home/Git/SSH/MCP, original user
console owner/PID reattachment and independent-artifact checks.
The production ZIP/update consumer and a private read-only DMG mount verify
layout and exact signed-tree identity without opening Finder or bypassing
quarantine. Native installer ownership/layout passes without administrator
installation. Actual bundled naming/live delivery also passes independently.

Thirteen selected actual-packaged hidden Electron cases pass in 19.9 s:
startup/cancelled quit, current cache and rename, original local Sending rows,
live steering, model title/user precedence, no unconfigured audio startup and
streaming PTT. Sending rows appear in **14.58-15.73 ms** while dispatch is
deliberately held. With 61 generated retained sessions, 5,860 events and
67,182,263 history bytes under a finite global policy, the opening window
appears in **344.98 ms**; acknowledged visible new chats take
**130.90, 143.49 and 140.12 ms**. Complete startup **2,039.89 ms** includes
the deliberately held actual recovery barrier, not a directly comparable
personal startup benchmark. There are no model calls in that admission test.

Actual frozen **88-to-90** and **89-to-90** application SDK/runtime/worker
upgrades each preserve 33 original ciphertext rows exactly, a saved draft,
held queue, independent artifact, original unknown charge and the exact
original authenticated generated user PTY/PID/output. There is one original
intercepted request per fixture, no input/model replay and no personal state.

The complete final `2ef8968` hidden desktop sweep passes **336 cases**, with
four explicit skips and zero failures in **10.2 minutes**. All seventeen
generated dictation cases pass, including the first 3,336 opening PCM samples,
release during delayed readiness and exactly-once final draft insertion.
The complete clean `55b50e4` backend/native-TUI sweep passes **2,242 tests**,
with 29 explicit skips, zero failures/cancellations and **1,813.14 seconds**
elapsed. The final UI-only cut does not change those backend bytes. Final type
checks, root audit and independent packed-consumer audit also pass with zero
vulnerabilities. Source tests, actual application-package checks and real native
boundary checks remain separate evidence scopes.

### Fresh native byte qualification

Unlike the earlier 89 diagnostic-only cut, protocol 90 changes actual guest
worker/bridge/MCP bytes. A new no-cache Linux arm64 producer takes 71.78 s:
`docker.io/library/moguri-worker@sha256:a84cdd12064aa8970f5991744028d0d49cf051c45dd49ee33ada4f3fd05da70e`.
Distribution manifest SHA-256:
`5725eca4bd1eaee9c20d14079c7ef42d7e90d283a0f029145a47b4b8c254ebd5`.

| Payload | SHA-256 |
| --- | --- |
| `worker.mjs` | `15a74c16c40a3b97aafa8480dd812c3e57e69954700ec408942af48b944f5332` |
| `remote-bridge.mjs` | `2ffd0a468c0bd688301c370ba0eefc68f0b2aca1556e6d2eaf9c719237694d25` |
| `mcp-worker.mjs` | `560910f3e4e1f0fab3381845c383d440f6cfdabded12eff04a3979bbc0e90c5c` |

All eight physical native gates pass in **42.82 s** from clean `55b50e4`:
`.native/qualification/current-sendbox-04usPz/qualification.json`,
SHA-256 `74e598f23289b7bc1cefbf8da232a3b4d6839cedd55b644fc50cc14754036c22`.
The generated actual Sandbox sequence has three solver calls and one
separately metered title call: 168 reported tokens, no unknown/held tokens,
0.000216 estimated USD and null provider/billed USD. The original source is
unchanged, private output is verified and all owned guests are absent.
The final UI-only cut's bundled runtime/service/SDK and all three payload
hashes are explicitly identical to this qualified backend; no 88/89 receipt
is inherited as proof of new bytes.

Initial failed full-suite, native naming-fixture and memory attempts remain
retained as failures. Repairs include explicit worker-start naming capability
instead of unsolicited private-compactor RPCs, a complete dynamic all-role
wind-down bound instead of thirteen roles, ancestor-first provenance errors,
known-invalid naming data remaining charged/rejected instead of becoming
unknown, and genuine recovery gates instead of unrelated discovery waits.
No arbitrary service deadline, durability policy, queue/answer permission,
CI trigger or memory budget was loosened to conceal them.

Base-main run `41602139750` is separately completed/cancelled: both Ubuntu and
macOS annotations explicitly report the existing 30-minute test-job maximum.
It is not a successful CI result, billing diagnosis or a branch run. CI remains
main-only. Runner notices retain Ubuntu 26 migration and macOS arm64 queue
capacity; local warnings retain OpenTUI experimental FFI, large renderer chunks,
the optional `.icon` companion, generated Sandbox failures in negative probes
and package deprecations. No trigger, timeout or rerun is changed.

## Microphone focus permission follow-up

The user additionally requires that focusing a chat never triggers microphone
authorization. Restored opt-in standby previously reached the same native
prompting path as actual capture/device discovery. The native gate now checks
existing OS access only for standby, returning an explicit no-grant result
when access is ungranted, denied, restricted or unknown. The renderer does
not call `getUserMedia` for that result or show a permission prompt. Only
explicit dictation/device discovery may request OS access. Already-authorized
standby stays opt-in, exact-owner/device-bound and closed on focus loss.
Native media callbacks recheck standby OS access rather than trusting a
previous grant after revocation. An aborted late native grant is released
under its original ID, not leaked or borrowed by another composer.

Executable cut **`20652da`** reuses the existing MIT Electron/React facilities.
The change is confined to desktop native permission policy and preload/renderer
IPC, with no SDK/service API, durable event/schema, new dependency or protocol
bump. Literal native-purpose validation rejects arrays, objects and unknown
actions before any grant; it never normalizes invalid input to device discovery.
The protocol-90 markers and original 88/89 retention proofs above remain separate
and unchanged. Intermediate `04970a6` remains frozen, not the current installer.

| File under `release/qualification-builds/microphone-focus-20652da/` | Bytes | SHA-256 |
| --- | --- | --- |
| `Moguri-0.31.0-alpha.1-macos-arm64.dmg` | 830120031 | `d7ffa0bb7c901bd6eccb7776066ecfcd366102d8e88f491420293c0d4c2a0d1b` |
| `Moguri-0.31.0-alpha.1-macos-arm64.zip` | 814566856 | `cd8f2b161391980481d5ca048b3c48fe6ce0080ab1e5d5f91c07954d0cb909a8` |

Build/types and root audit pass with zero vulnerabilities. The four permission
checks cover sixteen repeated ungranted focus checks with zero OS requests,
explicit grant/denial/error, fresh revocation and aborted late grant release
without opening media. Together with controller/shortcut and service
ownership/cancellation/streaming/WAV tests, **63 focused Node tests pass**.
The source voice/startup suite passes **22/22**; a later-launch run of the
final actual package also passes **22/22** in **34.2 s**. This is separate
from the first-launch startup failure below, not an unconditional performance
pass. It switches/refocuses three configured chats with zero microphones, then
opens exactly one generated microphone on an explicit click. All nineteen
voice cases remain covered, including malformed native-purpose rejection,
streaming PTT onset, exact standby transfer and cleanup.

The intermediate package's first run, concurrent with archive/update
verification, retains its **20-pass/one-failure** result and trace: opening
took **4,798.26 ms** against the unchanged 1,500-ms threshold. The final
`20652da` artifact's first launch also fails at **4,719.54 ms**, even without
competing archive work; its other 21 cases pass. Archive contention is
therefore not an established cause. These failures and traces are retained,
not relabeled passes or equated with the user's original service wait.
Nine intermediate startup/quit checks over three subsequent isolated
repetitions pass at **316.38-323.72 ms** opening. The final artifact's later
complete 22-case run opens in **322.96 ms** and acknowledges visible chats in
**134.48/144.53/132.86 ms**; its **1,987.76-ms** complete startup includes
the deliberate recovery barrier. No startup code or threshold was changed
between the final artifact's runs. First-launch startup remains an open
performance observation; later success does not erase it.

The complete actual-package verifier and production ZIP/private-readonly-DMG
consumer pass. Exact original user-terminal restart/ordinary-stop behaviour
remains covered. Shell totals are **538.39 MiB** for one console and
**545.64 MiB** for four under the unchanged 600-MiB gate; combined Moguri
totals are separately **1,000.50/1,008.80 MiB**, excluding user programs.
Compiled SDK/service/runtime/worker/bridge/MCP bytes remain exactly identical
to the earlier qualified backend. No new guest bytes inherit an old receipt.

This image is **ad-hoc signed, not notarized**, not uploaded, automatically
installed or opened in the user's application directory. No real microphone,
OS authorization, personal service/state, paid inference or model weights
were used. The coordinator's newer protocol-90 span question remains
independent; the earlier timing trace was already answered, and the complete
cause of its original clustered delay remains open.

## Issue-history service responsiveness

The subsequent extended user trace has a **192-ms window** but **25.17-second
service phase**. Create/draft service handling takes about 4.3 seconds,
ordinary Send about 8.6 seconds, and service loop windows reach 4.3-4.5 seconds
while proxy loop windows remain mostly 1-4 ms. Some snapshot bodies now also
wait 4.3-4.4 seconds; one snapshot returns 502. These observations must not be
rewritten as a painting-only problem, universally fast bodies, or request
replay permission.

Approved payload-free state metadata identified accumulated issue-import
revisions missing from the earlier generated tool-only history. Two explicitly
approved, redacted read-only stack samples did not capture a sustained
four-second stack, even though the user reported a slow action; they are not
proof of a CPU, filesystem or lock cause. Local endpoint/owner metadata matched,
and installed backend hashes matched the frozen protocol-90 package.
No personal event text, decryption key, draft, heap or database write was used.

### Generated reproduction and repair

A generated **25,000-revision / 100-current-issue** workload reproduces
**5,391 ms** for the two full projections made by an ordinary commit.
Every overwritten issue description was cloned and comment-normalized again.
After deferring only expensive canonicalization to surviving cards, unchanged
source-schema validation still took **841 ms** for those two projections.
The final mutation-safe witness path reduces warmed projection to about
**53-55 ms**; the first fully validated pass remains distinct.

The immutable pre-fix `2ef8968` application SDK/runtime, with generated state
and no personal authorization, reproduces actual acknowledgements at
**5,703 / 5,634 / 5,521 / 11,220 / 11,824 ms** for create, draft, held Send,
archive and delete. The initial fixture-seeding attempt disconnected an already
open client; the recorded baseline reconnects through a fresh original-owner
snapshot before measuring. This is separate from changing any live service.

All historical source checks remain, including overwritten revisions.
Validation reuse compares the current object to a private deep copy with
TypeBox's browser-safe structural equality. Mutation, unknown undefined
properties, invalid nested PR metadata, invalid order/date/source or malformed
text cannot borrow a previous validation. Final views remain deeply independent
and use the exact existing `work-item-comments-v1` filter; historical events
and source digests are not rewritten.

Retention rereads still authenticate current keys and every ciphertext.
Only freshly decoded, structurally identical issue-source metadata may retain
its validation witness. A prior view cannot hide changed content, key deletion,
foreign scope, concurrent append, rollback or corrupt encrypted bytes.
Delete initially still took **1,202 ms**, including about 599 ms of authenticating
history and 13 ms of checkpoint work. Reusing the exact authenticated metadata
removes the repeated schema pass, not decryption or durability.

### Startup and all-client admission

Generated startup profiling found four redundant full-profile reads, including
Sandbox setup recovery, global accounting and unconditional profile refresh.
Type-selective readers now use the existing exact type index, retain sequence
and profile scope and share the same authenticated decoder. The no-plan global
capacity path reads only accounting events; the planned-hold path keeps its
original complete projection/ledger validation. No hold, unknown charge,
policy limit or actor is weakened.

Profile refresh reuses a projection only when SQLite's external data version
and local total-change counter both match. Own commits advance the known
revision only when no external write intervened. Peer commits, local out-of-band
writes, rollback and retention changes force a fresh authenticated reload;
uncertain revisions never become an empty or successful fallback.

The issue-heavy SDK regression acknowledges create/draft/ordinary Send/archive
in about **76 / 85 / 171 / 91 ms**; deletion is about **706 ms** including its
retention reread. One original draft acknowledgement is deliberately lost
after commit: its exact receipt recovers the result with **one transmission**,
not replay. All original issue ciphertext remains byte-identical.

The original controlled 61-chat/67-MB startup test keeps its unchanged
1,500-ms opening, 3,000-ms total and 1,000-ms chat thresholds. Appending the
issue workload to its artificial pause initially produced 6,342 ms, then
4,022 ms after sparse recovery; those failures remain separate evidence.
A new **unpaused** issue-heavy desktop check, under finite global policy,
retains a real 3,000-ms startup limit: **2,545.51 ms** authenticated visible
readiness and **225.51 ms** click-to-acknowledged New chat, with zero inference.
The original controlled test separately passes at 1,869.35 ms total.
The artificial pause is not silently subtracted from a failing measurement.

No new dependency, required wire API, durable event/schema or protocol bump
is introduced. Node-only store readers remain explicit; SDK root/React stay
browser-safe. Compiled package/worker bytes require exact current comparison
and qualification, not an inherited old unchanged-byte assertion.

This is a service-code repair, not another Sending label or longer timeout.
Installing a new desktop while a healthy same-protocol service remains running
does not replace that service. After manual installation, use an **explicit
matching-build terminal-preserving restart** to load the repair. Active agent
work may be interrupted; drafts, held work, artifacts, original receipts,
unknown charges and exact authenticated user terminals retain their contracts.
No personal restart or state mutation is implied by read-only diagnostic
approval; never delete registry, database, keys or cleanup to force replacement.

### Qualified issue-history delivery

The immutable executable cut is **`e772707`**, packaged under
`release/qualification-builds/service-responsiveness-e772707/`. The matching
app is `builds.noindex/0.31.0-alpha.1/Moguri-darwin-arm64/Moguri.app`.
Documentation-only delivery commits do not change these qualified bytes.

| File | Bytes | SHA-256 |
| --- | --- | --- |
| `Moguri-0.31.0-alpha.1-macos-arm64.dmg` | 830150036 | `ea378416998ec917700b0a2c5d312fbd334393b2a8438483251dbf63a453b41b` |
| `Moguri-0.31.0-alpha.1-macos-arm64.zip` | 814577419 | `0483151b0a91d5477a0c29205aaee6e881b341540b0481c5b0c09b2f9db717d0` |

| Exact verification scope | Result |
| --- | --- |
| Complete local Node/native-TUI suite | **2,262 passed**, 29 explicit skips, zero failures/cancellations; 2,322.82 s |
| Complete hidden desktop suite | **339 passed**, four explicit skips, zero failures; 12.1 min |
| Typecheck/build, root audit and independent packed-consumer install/audit | PASS; zero vulnerabilities |
| All packed SDK entrypoints, declarations and actual installed runtime/worker | PASS, including the new issue-heavy lifecycle |
| Complete actual application-package verifier | PASS, including original exact PTY restart/ordinary-stop and retained artifact/accounting paths |
| Actual packaged startup/voice suite | **23 passed** in 45.9 s |
| Production ZIP/update consumer and private read-only DMG identity/layout | PASS; no Finder opening, installation or quarantine bypass |
| Actual frozen 88/89 SDK/runtime/worker to current package | PASS separately for both original versions |
| Fresh no-cache native image and exact physical qualification | All eight gates PASS on clean source, 45.99 s |

The independently installed packed SDK acknowledges create/draft/held
Send/archive/delete in **93.47 / 120.16 / 101.23 / 191.12 / 862.65 ms**,
and reopens/authenticates the same issue-heavy store in **1,877.36 ms** without
replaying inference. The actual app-bundled SDK/runtime gives
**87.71 / 110.40 / 97.26 / 189.87 / 886.09 ms** and **2,383.12 ms** reopen.
These installed-fixture Sends are explicitly held; the separate ordinary
generated solver Send/receipt regression above remains about 171 ms.

In the actual hidden app, the original controlled fixture keeps its thresholds:
471.88-ms opening, 1,941.23-ms complete startup including its artificial pause.
The new unpaused issue-heavy case, also with 61 chats, retained tool history
and finite global policy, reaches visible readiness in **2,612.70 ms** and an
acknowledged visible New chat in **187.99 ms**, with no inference. These are
generated reproducible workloads, not a claim that the user's still-running
old service has already loaded the repair.

Actual frozen 88-to-current and 89-to-current upgrades each preserve 33 original
ciphertext rows byte-for-byte, saved draft, held input, independent artifact,
original unknown charge and exact authenticated original user PTY/PID/output.
Each fixture retains its one original intercepted model request, with no
input/model replay. No user database or keys are copied into those fixtures.

The current app shell measures **547.13 MiB** with one console and
**556.45 MiB** with four under the unchanged 600-MiB gate. Combined Moguri
totals are separately **1,005.14/1,015.48 MiB**, with user programs disclosed
outside that shell budget. No unnecessary default audio utility is started.

The changed guest worker/bridge require a new image, not the old native receipt:
`docker.io/library/moguri-worker@sha256:53cc29658de3acbc12736e55a969bfaf2f1961f3f441078439dd27f4fcc889da`.
The no-cache producer takes **87.83 s**. Distribution manifest SHA-256:
`fac173ca84fc3e1cb79c3b69a0e240f6612842b70b035a95621cbf8fd561a050`.

| Exact payload | SHA-256 |
| --- | --- |
| Service | `42bd968a7b227239f10ebd8b16da4e86abeaf1ddd2011430f2c83ec7ebd9c1e9` |
| Node runtime | `86b009b6d795e560f85979b1123929287a8bb8c0e673b2bdc48a2b6d220952e6` |
| Worker | `cf427b224ee04cd4deff4d38448903339741e955f0d381117aaa17c530c79acb` |
| Remote bridge | `fc3a10cc3326d0a1a5d1ba525d258a94e7a3369efd85f94d4542c1900cdc8594` |
| MCP worker, unchanged | `560910f3e4e1f0fab3381845c383d440f6cfdabded12eff04a3979bbc0e90c5c` |

Clean-source receipt:
`.native/qualification/current-sendbox-sVX2BQ/qualification.json`,
SHA-256 `567deb9f003a3f620becc86a9e05122c3bbed38a9530b089f51b8fadbcfcf2be`.
It verifies original source/output and absence of every owned guest. Actual
native accounting has three generated solver calls plus one separately
metered title call, 168 reported tokens, no unknown/held tokens and null
provider/billed USD. The package's exact worker/bridge/runtime hashes were
compared to these qualified bytes. Data worker and private terminal
broker/bridge remain byte-identical to their prior qualified versions.

This image is **ad-hoc signed, not notarized**, not uploaded, automatically
installed or opened in the user's application directory. Historical failed
projection, deletion, paused-startup and old-package attempts remain failures,
not relabeled passes. Main-only CI retains its separately reported 30-minute
base-job limit; no trigger, timeout or rerun is changed. Existing FFI, chunk,
optional icon, package-deprecation and disclosed generated Sandbox negative
diagnostics remain warnings, not personal setup activity.

### Per-operation latency regression budgets

The shared test fixture `tests/fixtures/latency-budgets.ts` defines explicit
limits instead of a single one-second allowance for every action:

| Measured operation | Maximum |
| --- | ---: |
| Create, draft save, ordinary/held Send, inline rename, idle archive | 700 ms each |
| Settled-session deletion with full retained ciphertext authentication | 1,000 ms |
| Initial opening window | 1,500 ms |
| Authenticated cold startup/reopen, including issue-heavy state | 3,000 ms |

These are regression budgets for the generated qualified workloads, not a
universal real-time guarantee under arbitrary machine load. Deletion retains
its separate ceiling because it must authenticate retained encrypted history;
startup is distinct from a normal interactive acknowledgement. Deliberately
blocked transports, OS/user approvals and unsettled owned work keep their
existing truthful cancellation/cleanup contracts, never premature success or
weakened retention to meet a stopwatch.

Both source SDK and independently installed/package-bundled SDK fixtures
measure three separate create/rename/draft/send/archive/delete cycles over
25,000 retained issue revisions. Every individual acknowledgement is asserted
immediately against its own budget; an average, later fast result or retry
cannot hide a slow sample. Exact receipt checks, lost-ack single-transmission
recovery and unchanged issue ciphertext remain required.

Hidden desktop tests separately enforce 700 ms from New chat click to
authoritative visible acknowledgement, including three issue-heavy samples.
Inline rename includes the actual saved name after keyboard submission and
peer-conflict recovery, not just displaying an editing field. Boundary tests
accept exactly the configured limit, reject even 0.001 ms above it, and reject
unknown operations or invalid clock observations instead of using a fallback.

This tests-only follow-up leaves all production service/runtime/SDK/worker
bytes identical to the qualified `e772707` installer. Three-cycle source SDK
checks pass below 120 ms for routine acknowledgements and 508 ms for deletion;
the independently installed packed SDK stays below 138/626 ms respectively.
The actual app-bundled SDK stays below 143/653 ms. Source and actual packaged
visible startup/rename selections each pass all six cases, including all
700-ms New chat/rename samples. Boundary/invalid-clock checks pass, as do
build/types and the complete packed-consumer verification with zero
vulnerabilities. Installed fixture Sends are held; source Sends exercise the
ordinary generated solver path and original lost-ack receipt recovery.

The first packed-consumer attempt failed before the latency fixture when the
unchanged service-recovery stop check rejected private connection metadata.
That attempt is retained as a failure, not a passing budget sample. The same
recovery fixture in isolation and a fresh complete packed-consumer run pass
without changing production code, ownership checks or deadlines. No operation
budget was relaxed to hide that result.

## Cache-first desktop opening

The user confirmed that the matching service repair made ordinary session
and message operations fast; the remaining observed delay was opening,
about five seconds instead of twenty-five. This follow-up targets that path,
not another unobserved Send defect.

The renderer first mounts the real desktop layout and a temporary local
composer. SDK and full application modules load asynchronously after that
shell, while the existing native/service readiness fences remain intact.
The early view is explicitly connecting, never an authenticated snapshot or
successful backend readiness placeholder. Provider discovery was already
asynchronous and is not claimed as a new deferral.

### Presentation metadata, not domain authority

The versioned `moguri.startup.v1` browser preference contains only model IDs,
opaque provider IDs for display attribution, names, declared effort names, the last selected session ID, and
its draft revision/empty flag. It never contains transcripts, saved draft
text, attachments, filesystem roots, provider payloads, credentials,
permissions, budget figures, or approval decisions. Records are bounded to
256 KiB and reject unknown versions, extra fields, invalid types and changed
root/profile bindings with an explicit diagnostic.

Native startup derives an opaque scope from the captured canonical data root
and its device/inode identity. The live connection's retained store ID and
actual immutable profile must match before the last session is restored.
An explicit `MOGURI_PROFILE_ID` wins over the view preference. A remembered
profile that is missing or unready is not silently replaced by Default.
First-launch cache misses do not create a synthetic project/session. After
authentication, an initially absent root is checked again before saving a
new presentation preference.

Cached model labels and effort lists remain informational. They never enter
`Snapshot.provider.models`, provider preparation, routing, model evidence,
native qualification or tool policy. While discovery is still connecting,
the model control may display a marked cached label and read-only list;
actual model/effort choices and Send still require current qualified data.
Current disconnect/error observations clear that provider's cached labels;
other providers still actively connecting keep only their informational names.

### Local opening drafts

The user explicitly selected local typing while the backend reconnects.
That text exists only in this window's RAM, with the original presentation
binding captured when typing starts. Enter/hold shortcuts cannot dispatch
anything during opening. Closing with unsaved text retains the existing
keep-saving/discard confirmation. Focus alone never starts microphone
authorization, recording, a terminal, a model request or a queued prompt.

Automatic draft adoption requires a live authenticated client, the exact
root/store/profile/session, the same saved draft revision, and an actually
empty live draft without attachments. The normal `DraftEditor` then saves
through its original CAS/receipt path immediately, not after an unnecessary
new autosave debounce. No message is sent. The opening buffer is cleared
only by its matching ID after save acknowledgement, and caret restoration
binds the actual owning client and session.

Missing/deleted/archived sessions, changed stores/profiles, peer edits,
oversized inline text or unconfirmed saves retain the original local text
for review. The live saved draft is not overwritten. The user can explicitly
copy/discard it, or use an empty current draft through the existing SDK
path. Large text uses the existing captured-paste flow, not truncation.
Unknown mutation outcomes retain their original receipt and are never
replayed by this opening feature.

### Cold retained-read work

The strengthened fixture starts a new compiled runtime process and a new
Electron main process over 25,535 generated issue revisions plus retained
61-chat/tool/draft history. It measures the early editable shell separately
from an actual rendered live editor, enabled fresh-model Send, and the
acknowledged original saved draft. A DOM observer and active hidden frame
delivery measure the real completion frame, not an extra Playwright polling
interval. Warm/reused-owner reloads remain a different observation.

This exposed remaining cold work, not permission to increase a deadline.
Authenticated reads now decode SQLite iterators rather than first retaining
hundreds of megabytes of encrypted JSON strings alongside the complete
plaintext history. The returned event arrays, profile/type/sequence order,
header and per-row GCM authentication remain unchanged. Every read refreshes
its scope-key memo: a peer's recorded deletion or corrupted replacement key
cannot borrow a prior valid key. Error paths release their read cursor and
publish no partial view; transaction rollback, real 88 migration/reopen,
peer appends and indexed forgetting remain covered.

Cold source validation also keeps a private per-replay template for a
previously validated issue identity. Every changed revision field still
passes the original picked schema, exact private-template comparison,
canonical URL and real date checks. A different static or nested field
falls back to the complete original schema. Mutable inputs, extra undefined
fields and malformed historical revisions cannot borrow validation.
Templates/witnesses never authorize an operation or replace current
ciphertext, and no evaluator/compiler is introduced into the browser.
Generated cold two-projection work fell from about 599 to 218 ms; the new
450-ms component gate is stricter than its previous 1,500-ms allowance.

The pure work-item-comments-v1 scanner skips an unchanged prefix while
retaining enough visible suffix to recognize delimiters joined by removal.
Its exact legacy output is checked against 20,000 generated UTF-16 cases,
including malformed, nested/joined and unterminated blocks. It retains no
plaintext cache. Generated 100-card plain/sparse-comment catalogues took
about 1 ms instead of 109/129 ms, under a separate 50-ms component ceiling.

No dependency, selected stack, domain event, database schema or protocol
marker changes. The additional desktop bridge is matched to its packaged
preload; the shared service remains protocol 90. Node, Electron, React and
TypeBox retain their existing licenses. All routine 700-ms, deletion
1,000-ms and live-startup 3,000-ms limits remain unchanged.

### Prerequisite evidence and failed attempts

The generated Phase 0 rerun passed the six available primitives: six
intercepted provider requests with 31.81-ms cancellation; 1,000 SQLite events
with 0.070-ms append p95 and 0.726-ms rebuild; known-group PTY cancellation
in 152.17 ms with zero observed survivors; 60 OpenTUI updates averaging
16.82 ms; hidden Electron opening in 258.86 ms at 445.91 MiB with 8.15-ms
scroll frames; and 2,000-file search/Git in 1.37/8.03 ms. That baseline's
unavailable live/SSH/Linux/Rust/signing/quality/native-image checks remain
unqualified; earlier exact physical receipts are separate evidence.

The initial missing-cache test and original focus-selector failure remain
failed attempts. Early full-cold attempts also exceeded the unchanged
three-second limit at about 3,098, 3,106, 3,124 and 3,016 ms. Neither a later
fast sample nor a cached shell relabels them as successful backend readiness.
Current source types and the focused 57-case validation/read/cache/SDK set
pass. The three fresh-process mixed-history samples rendered the editable
cached shell in 449/435/422 ms from desktop launch. Complete live editor,
enabled fresh-model Send and the acknowledged original saved draft rendered
in 2,640/2,608/2,589 ms from the generated cold service-process start, each
under the unchanged 3,000-ms gate, with zero inference calls. The service
had to claim its real lock before Electron was started to prevent a test-only
second launcher; process-start-to-shell time is separately 805/1,291/777 ms.
This is not a claim about a completely cold OS filesystem cache.

The 18-case core desktop selection initially passed 17 cases and found one
obsolete `.startup-error` selector after the error UI moved into the retained
opening shell. Its actual changed-owner refusal heading was visible. The test
now checks the real alert text instead; isolated owner-refusal/proxy inspection
passes without changing the product guard. Actual package qualification and
the complete sweeps remain separate gates.
No new personal installation, restart, sampling, model prompt or app control
is authorized or performed by these generated checks.

### First ad-hoc execution remains a separate limitation

The first execution of the actual frozen `3ee905f` development package took
7,350.49 ms to its opening UI and failed the unchanged 1,500-ms window gate,
with backend recovery deliberately held. That failure is not replaced by
the faster source-process or subsequent-launch figures.

An owned full-resource diagnostic copy with no Moguri modules or service
entered Node after about 6.87 seconds. Its initial diagnostic then deadlocked
because that fixture incorrectly awaited `app.whenReady()` at ESM top level;
that fixture error is not a Moguri deadlock. The corrected `.then()` fixture
entered Node after 2.01 seconds on its new signature, versus 116 ms on an
unchanged-path control. A read-only sample of that exact owned child observed
1,249 main-thread samples in dyld's `mapSegments` / `CodeSignatureInFile` /
`fcntl` path before Node startup; debugger notification added its own overhead.
This identifies a pre-JavaScript loader/signature-path lead, not a diagnosis
of every second of the user's original opening delay.

A documented inside-out signing diagnostic without process entitlements
on the library still took about 1.65 seconds before Node and passed strict
signature verification. The previous and current frozen Electron frameworks
have the same CDHash. Neither that probe, a warm launch, nor an unsupported
claim about notarization is a first-execution fix. No trust setting, quarantine
attribute, signature check or operating-system guard was disabled.

The user explicitly authorized a read-only signing-identity availability
check, which found zero valid signing identities and zero Developer ID
Application identities. No identity names or private keys were exported;
no certificate signing, Apple submission or personal app/service action
followed. The user then explicitly chose to deliver an ad-hoc alpha with
this first-launch caveat. Proper signing/notarization and its startup
qualification remain separate release work, not an accepted production gate.

The complete default-concurrency Node/native-TUI run at `3ee905f` exercised
2,320 tests: 2,290 passed, 29 skipped and one failed. That failure caught the
new opening error banner bypassing the repository's shared dismissible
`Alert`. The correction reuses that component without changing cache
authority, ownership or runtime bytes; all five focused alert/cache cases
and type checks pass. The original complete run remains a failed attempt
until an explicitly recorded complete rerun, not a relabeled green run.

### Qualified cache-first alpha

The corrected code cut is
`becc99d9a66992ca405ec3cfde0ff71413cb33f7`, including the shared opening
alert. Its complete default-concurrency Node/native-TUI rerun passed
**2,291 tests, with 29 skipped and zero failures or cancellations** out of
2,320, in 1,810.66 seconds. The subsequent complete hidden source desktop
suite passed **349 tests, with four skipped and zero failures**, in
10.4 minutes. These explicitly supersede the failed `3ee905f` full run,
not its first-execution limitation.

Build/types, fresh independently installed packed SDK entrypoints,
declarations, runtime/worker and the actual application-package verifier
pass. Both the root and independent consumer audits report **zero
vulnerabilities**. The production ZIP/update consumer and a private
read-only, no-browse DMG mount verify the exact signed application,
Finder geometry and icons without opening Finder, installing, executing
the mounted app or bypassing quarantine.

The actual frozen app's separate 45-case desktop selection passes. It
covers cached and missing presentations, peer/deleted/store-mismatched
destinations, read-only model labels, all three new service/main-process
cold openings, exact-owner quit/cancel, profiles, microphone preparation
and generated user-terminal startup. Every latency sample keeps its
original individual gate.

| Measured completion, milliseconds | Source samples | Actual packaged samples |
| --- | --- | --- |
| Editable cached shell from desktop launch | 301.17 / 302.62 / 306.74 | 342.09 / 347.82 / 337.42 |
| Service-process start to editable shell | 655.59 / 655.97 / 661.10 | 697.55 / 702.68 / 692.53 |
| Full live rendered frame and original draft save acknowledgement | 1,782.71 / 1,796.34 / 1,785.46 | 1,948.88 / 1,930.30 / 1,929.66 |
| Ordinary first Send, including unsaved draft and canonical rendered acknowledgement | 300.34 / 289.75 / 284.86 | 348.50 / 352.04 / 344.60 |

The cold rows use 25,535 generated issue revisions and retained 61-chat
history; ordinary first Send uses 25,000 revisions and 61 chats. These are
fresh-process observations, not a completely cold OS filesystem cache or a
new personal measurement. The early shell is measured while the real
runtime remains unready. Full completion additionally requires the
actual connected SDK, restored session, fresh-model-enabled Send and
**Draft saved**, after a real rendered frame, with zero inference calls.
The separate unpaused 25,000-revision startup measures 1,740.74 ms in
source and 1,833.15 ms in the actual app. Its three visible New chat
acknowledgements are 181.47 / 186.33 / 193.17 ms and
197.02 / 216.20 / 203.09 ms respectively.

The first actual execution of this corrected frozen app also passed:
391.04 ms to the initial opening window and 1,726.83 ms to authenticated
completion, with backend recovery initially held. This is a new bounded
observation, not a fix or replacement for the earlier 7,350.49-ms first
execution. Signing behavior was not changed; the user-accepted ad-hoc
first-launch caveat and unqualified notarization/production gates remain.

Both actual frozen protocol-88 and protocol-89 app SDK/runtime/worker
upgrades to this cut pass using the new app's bundled Node. Each preserves
33 original ciphertext rows, saved draft, held input, independent artifact,
unknown original charge and the exact authenticated original user
PTY/PID/output, with one original intercepted call and no input/model
replay. Old-bundle `sandbox_protocol` warnings are retained; those
migration fixtures do not claim legacy Sandbox compatibility.

Fresh physical native qualification on the clean corrected source passes
all eight gates with the unchanged qualified guest image. The new receipt is
`.native/qualification/current-sendbox-xZD5bR/qualification.json`, SHA-256
`13d578c712ee9859f820fdd804b5604b8b49e77d6741638a4fa2a338a7c9420c`.
Worker, bridges and guest dependency payload remain byte-identical to the
previously qualified image; no new guest image is claimed. Actual host-side
accounting, provider scope, cold networking, grouped work, snapshot retries,
accepted-work checkpoints and exact-owned teardown were exercised again.

The first native qualification remains a separate failure: one checkpoint
preparation's exact retained diagnostic reports a CNAME lookup `ETIMEOUT`
for `api.githubcopilot.com`. No empty scope, extra host or Local fallback
was used, and the undispatched finishing envelope remained unused. Four
other cases passed and owned-guest absence was confirmed. Its original
closed generated database was opened read-only and remained byte-identical;
diagnostics were read from an independent backup. The passing complete qualification
used wholly new generated roots/identities, not a replay of that original
work. This DNS result is not a diagnosis of the user's opening delay.
An initial anchored test selector selected no tests, and an update-verifier
invocation omitted its TypeScript loader; neither executed its intended
probe. Their corrected executions and original invocation errors remain
separate evidence.

The immutable local installer is
`release/qualification-builds/deferred-opening-becc99d/Moguri-0.31.0-alpha.1-macos-arm64.dmg`,
**830,230,511 bytes**, SHA-256
`bcd9fa163018ff00b53050a3a5efdf8e73fb8ecb456d65dc45a1821f0215d87c`.
Its sibling ZIP is **814,633,309 bytes**, SHA-256
`edb906b18fd1e4ff4cbba749df24d3c7dabb0506c08e3298fd6d279356a91ea9`;
the manifest SHA-256 is
`037bbc6c80e1ac7b5c2b1b96f1cfa7919ef9282014c8d91355eed0a4eabb2159`.
Every bundled compiled ESM SDK/service/runtime/worker entrypoint was
compared with the clean built cut. No personal installation, app opening,
restart, model call, profiling or mutation test followed this qualification.
The earlier explicitly authorized `e772707` service restart is a completed
separate action; its authorization is consumed. A healthy same-protocol
owner may still be reused by the new UI. Updated backend bytes require a
normal matching installation's owned launch/restart, never an automatic
replacement or an inferred new permission.
