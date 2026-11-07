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
