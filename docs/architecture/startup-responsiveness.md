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
acknowledgement at 1,079–1,317 ms, and a snapshot at 253 ms. That identifies
a real inefficiency; it is not a claim that the user's complete 15–20-second
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

After the repair, the same generated service starts in about 366–412 ms,
new-chat acknowledgements take 5–9 ms and snapshot reads about 1 ms. The
stronger desktop fixture retains 61 chats, 5,860 events and 67 MB of encrypted
history, including historical tool output. Actual click-to-acknowledged-visible
new chats take 131–145 ms. Its startup window appears in 319 ms while service
recovery is deliberately held. Tests enforce 1,500 ms for that window and
1,000 ms per new-chat interaction, not merely a fast health endpoint.
No history is truncated or model/tool effect replayed to meet those bounds.

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
