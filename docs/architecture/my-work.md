# Unified My Work

## Change contract

Issue #9 extends My work with a profile-owned, cross-repository GitHub inbox.
The existing active-session dashboard and usage/cost/velocity views stay
available. This is explicit refresh, not a recurring scheduler or issue #6.

Reuse Node.js 26, TypeBox, React, Electron, OpenTUI and the GitHub CLI under
their existing MIT licenses, Git under GPL-2.0, and the existing SQLite/event
store, SDK, capability jobs, encrypted retention and notification preferences.
No dependency, authentication client, model call or permission authority is
added. Node GitHub execution remains explicit; SDK root/React stay browser-safe.

Protocol95 adds `my_work_inbox_schema=1`, `my_work.source_recorded` and
`my_work.refresh_recorded`, plus provider-state-bound My Work attribution on
the existing attention events. Genuine94 upgrades in one marker/version
transaction without rewriting ciphertext, receipts, budgets or retained
CI watches. Missing, corrupt, premature and relabelled lineage is refused.
Migration failure rolls back; recovery terminalizes original work, never
replays it. Downgrading a store with new history is not supported.

### Sources and identity

Sources start empty. The actual user explicitly reviews and configures each
project/workspace's canonical Local root, upstream and authenticated numeric
controller `gh` account. The boundary is visibly
`controller-gh-account-not-ssh`, not the session's SSH/Sandbox account.
Configuration never scans other repositories, authenticates, switches
accounts, borrows Copilot/updater tokens or falls back to another root/Env.
Multiple configured accounts remain separate; an unavailable or inactive
account is a failed source, never a substituted account or empty repository.
Changed roots, upstreams, policy or account require a new source review.

Canonical provider/repository/PR identity deduplicates categories and
project/session associations within the immutable profile view. Every
association retains its own account, root, observation time and original
head/state. Conflicting heads are displayed separately, not combined into
successful CI. Related sessions require an exact retained source/account/root
association, not title similarity or a first-session guess.

### Observations and refresh

Reads cover all authorized open PRs in configured repositories, plus explicit
detail reads of previously observed PRs to distinguish closed/merged/reopened
items from missing access. Pending reviews are actual outstanding
User/Team/Bot/Mannequin/EnterpriseTeam requests; a team request does not guess
the viewer's membership. The current fields/union were checked against GitHub's
[public GraphQL schema](https://docs.github.com/public/fpt/schema.docs.graphql).
EnterpriseTeam provides a node ID/combined slug, not an invented team URL.
Unresolved/outdated threads and review decisions come from provider state.
REST collections and GraphQL cursors are fully paginated within disclosed
bounds. Missing totals, repeated identities/cursors, changing heads, incomplete
pages and provider failures never become a clean inbox.

Exact-head CI collection and diagnostic parsing are shared with retained PR
watches. No checks, unknown conclusions, queued/running work, cancellation,
timeout, startup/billing/runner failure and diagnostics-read failure remain
distinct. A matching retained watch may add a separately timed observation;
opening an inbox/pane never creates, resumes or cancels a watch.

The original source set, input digest, refresh record, job and command receipt
commit atomically before reads. Identical overlapping refreshes return their
actual original identity; conflicting overlapping work is refused. Source
changes and late results cannot retarget that intent. Intermediate observations
and terminal record/job commit through the existing event authority, with every
blob digest granted in the same retention transaction. Cancellation stops only
the inbox's readers. Failed cleanup/lost acknowledgement stays partial and
unconfirmed. Restart preserves reports and cancels/terminalizes ownership
without another HTTP request.

An unconfirmed original reader blocks an overlapping new refresh until the
actual user separately inspects its exact revision/input digest. That immutable
inspection remains on the original partial record and does not certify process
cleanup, erase observations, grant permission or replay work. It only permits
a new independent read, like the existing retained CI-watch inspection boundary.
Missing original receipts cannot authorize a second reader.

Querying uses retained observations only. Freshness, incomplete refreshes,
disabled/unavailable sources and failed latest attempts remain explicit.
Older positive evidence is preserved with its original time and failure/stale
label rather than replaced by an empty response.
Client observation updates preserve the existing same-scope DOM/TUI items and
keyboard focus while a new retained query is pending, with an explicit
previous-observation label. Changing profile, source/policy binding, filters or
page invalidates that view; old data cannot appear under a replacement scope.
Head-checked provider pages are observed over an interval, not an atomic global
GitHub snapshot. Per-source reads track at most 1,000 PRs and 1,000 requests or
threads per PR; the existing 1,000-per-CI-collection bounds apply. Retained query/
source-report envelopes are capped at 8 MiB and fail explicitly rather than
truncate. Refining a query/source/page size never implies successful CI.

### Clients and permissions

The service and SDK own source review/configuration, query/filter/status,
explicit refresh/cancellation, original-report inspection and exact navigation.
CLI/TUI and desktop use those same APIs and events. Filters include category,
repository/account/project, PR state, freshness and text. The desktop presents
one PR card with all reasons and an inspectable original observation, canonical
links and exact related sessions.

Viewing/opening an item is read-only. Starting follow-up is a separate user
action with a fresh exact source review, reusing `session.from-work` to create
an idle source-bound session under ordinary controls/permissions. It does not
send a prompt, approve a tool, post a comment, resolve a thread, request
changes, push or merge.

Attention uses actual retained refresh/provider state and existing notification
preferences. Read acknowledgement is only read, never resolution, an answer,
approval, scheduling or permission. Session navigation does not implicitly
acknowledge CI or inbox attention. OS previews retain the existing privacy
defaults and navigate to the actual owning profile/item.

## Phase 0, 2026-11-07

Pinned Node26.12.0/macOS arm64 generated prerequisites preceded implementation.
The first attempt failed because the fresh worktree lacked `node-pty`; the
subsequent `npm ci` restored the lockfile (zero vulnerabilities), not a new
dependency. All HTTP/inference/authentication fixtures are generated.

| Primitive | Result and measurement |
| --- | --- |
| Generated streaming/cancellation | PASS; six intercepted requests, cancellation 31.58 ms |
| WAL/crash/rebuild | PASS; 1,000 events, append p95 0.069 ms, rebuild 0.764 ms |
| Known macOS PTY groups | PASS; cancellation 152.10 ms, zero observed known survivors |
| Actual OpenTUI | PASS; 60 updates, mean 17.21 ms |
| Hidden Electron | PASS; cold start 261.63 ms, 444.48 MiB, scroll 7.92 ms/frame |
| Generated filesystem/Git | PASS; 2,000 files, search 1.18 ms, status 8.18 ms |
| Verified package archive reuse | PASS; 560 bytes, 1,202.72 ms; tampering rejected, scripts not run |
| Independent encrypted retention | PASS; 500 events, 250 artifacts, 153.08 ms |
| Hidden Ghostty | PASS; 423,045-byte WASM, real generated input, 108x24 grid, 34.10 ms |

The spike's legacy declared failures are not new physical native probes or
proof that later features disappeared. Live account entitlement, hosted CI,
signing/notarization, Linux release and changed native workload qualification
remain separate. No personal login/browser, live PR mutation or CI dispatch
was used. Node's experimental FFI warning remains disclosed.

## Required qualification

Generated tests must cover multi-repository/account/profile isolation,
pagination/deduplication, actual reviews/threads, stale heads and state changes,
CI edge/diagnostic outcomes, retained watch reuse, source/account revocation,
concurrent clients, cancellation failure, late results, migration and restart
without replay. Actual compiled CLI/native TUI and hidden Electron flows,
build/types/full tests/audit and an independently installed packed SDK must
exercise the shared surface. Qualification results are recorded here after
those checks, not inferred from an earlier milestone or hosted account.

## Qualification and remaining environment gates

The implementation/retention cut starts at `27dacc5`; `a611342` repairs a genuine
legacy fixture, `bb98e64` preserves same-scope focus, and `ac9868b` retains one
exact inspection timestamp and complete bounded pagination fixtures. No hard
runtime limits, latency budgets, main-only CI triggers or native policy were
relaxed to obtain these results.

| Gate | Observed result |
| --- | --- |
| Pinned install, moderate audit, source types and build | PASS; zero root vulnerabilities; no added dependency |
| Complete feature service/CLI/native-TUI/migration/restart cases | 45 passed, zero failures/cancellations/skips after the deterministic clock repair |
| Native TUI/navigation/presentation regression sweep | 30 passed, zero failures/skips |
| Targeted hidden inbox/dashboard flows | 10 passed, zero failures/skips, including original DOM identity/focus through another refresh |
| Fresh complete hidden desktop | 386 passed, five explicit skips, zero failures; 391 flows in 12.7 minutes |
| Earlier complete packed consumer | All root/Node/React/MCP imports, declarations and audited install passed; zero consumer vulnerabilities. Actual installed My Work and CI SIGKILL recovery preserved original grants without replay |
| Current installed My Work recovery | PASS before the later existing consumer gates; exact original partial record, one user inspection and a separately admitted read, without inference or replay |

Failed attempts remain failed evidence. The first full source run has 10,617
passes, 29 explicit skips and one failure in the preexisting protocol93 upgrade
fixture: it retained the new future inbox marker while relabelling its generated
store. The fixture now removes only that validated future marker and compares
the actual new metadata separately, leaving original ciphertext/keys/grants/
receipts/source untouched; the combined 13-case upgrade regression passes.

The first whole desktop run has 385 passes, five skips and one failure: an
observation query replaced the focused inbox DOM during a new update. Both
clients now preserve only same-scope previous observations while the next
retained query is pending, explicitly label them and invalidate changed
profile/source/policy/filter/page scope. The fresh complete run above passes.

The second full source run has 10,605 passes, 29 skips and eight failed test
records. Three existing Remote critique matrix cells exceeded their generated
settlement deadline (Guided/both: half/minimal/document, half/low/document,
maximum/high/text), producing three parent failures and the matrix incompleteness
failure. Those cells passed the first whole run; separate exact-window and
mixed image/document Remote critique probes pass on this host. The remaining
failure exposed a genuine My Work inspection clock boundary: two `now()` calls
could disagree by one millisecond. The record and inspection now use the same
captured time; an advancing-clock test and real SIGKILL recovery pass.

One later feature sweep reached its original 60-second fixture timeout while
repeating full CI reads for 101 identical PRs on the loaded shared host. Complete
pagination is now proved with two actual short provider pages, both retained
query pages, 101 requests/checks and 201 threads. No product bound or fixture
deadline changed; the complete 45-case run passes.

Current full packed-consumer qualification remains blocked in existing
service probes: one fresh attempt failed the service-recovery probe during a
changing private `connection.json` read; another failed the existing live-chat
delete latency at 1,079.93 ms against its unchanged 1,000-ms budget. Earlier
complete consumer runs passed. These latest failures are not relabelled green,
not skipped and do not justify accepting an unowned file or raising a deadline.
A complete source/consumer rerun remains required for an entirely green latest
qualification sweep. An existing test name or apparent host load alone does not
establish that a failure predates the inbox.

### Pristine-base comparison

Only the failing recovery/live-chat/Remote settlement probes were compared
against pristine main `11523238432aacd7880e71c375fed7a6ec0aa6bf` and head
`ac9868b8830292e8bb6dfa677db32c00b768a6f0`. The baseline was materialized from
that exact Git tree inside the owned qualification directory, built with the
same pinned lockfile (`7fc2eef7b31efe14ca52e1c9358da65e4bb6f52effcedf318b8ce0841ec7fa11`)
and unchanged probe source. No other processes, guards, runtime policies or
deadlines were changed.

Commands use `npm exec -- node --import tsx`. The unchanged
`tests/fixtures/installed-service-recovery.mjs PACKAGE_ROOT` and
`tests/fixtures/installed-live-chat.mjs PACKAGE_ROOT` were each run once against
base and then head. Both recovery processes exit zero. Both live-chat processes
exit zero against their unchanged 1,000-ms deletion budget; final retained
delete samples are 945.93 ms at base and 932.56 ms at head, with authenticated
readiness 1,743.37/1,743.14 ms. This comparison detects no current regression but
does not reproduce or prove the cause of the earlier file/latency failures.

The three failed Remote cells were re-executed using the unchanged routed
fixture, routing configuration, generated document/input, send and 30,000-ms
settlement assertion. This is a selected-probe comparison, not a replacement
full Cartesian-matrix qualification:

| Remote/critique/Guided/both cell | Base outcome/time | Head outcome/time |
| --- | --- | --- |
| half/minimal/document | PASS; 14,615.92 ms | PASS; 14,197.07 ms |
| half/low/document | PASS; 14,401.88 ms | PASS; 13,862.08 ms |
| maximum/high/text | PASS; 8,924.75 ms | PASS; 8,565.94 ms |

Each process ran with cwd and dependency resolution bound to its actual
package root. Two setup attempts are explicitly invalid comparisons: the first
baseline run used head cwd and failed SSH bootstrap; the second used an
out-of-root dependency symlink and restricted document workers rejected it.
After copying the identical dependency tree into the clean baseline root,
all six base/head cells pass. Those setup failures are not evidence of a
preexisting product defect. No inbox-introduced regression is demonstrated by
the corrected comparison; the latest whole-run failures remain unresolved
qualification evidence, with causal attribution unknown.

Node experimental FFI, Vite large chunks and consumer deprecations
(`whatwg-encoding`, `node-domexception`) remain disclosed. Generated negative
cases retain their explicit partial/failed/cleanup diagnostics. Live GitHub
account/hosted-CI spending eligibility, physical changed SendBox payloads and
signed/notarized release acceptance remain separate existing gates. This change
does not dispatch CI, authenticate a personal account or qualify those gates.
