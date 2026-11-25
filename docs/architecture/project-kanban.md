# Project Kanban and provider-equivalent estimates

## Scope and prerequisites

This owner-requested slice extends the existing project tickets, owned worker,
managed Local worktrees, GitHub workflows and budget ledger. It does not add a
second agent loop or a client-owned board. The owner selected **one item per
request, stopping at its draft PR**, not an unattended backlog drain.

Reuse Node crypto/SQLite/process primitives, TypeBox (MIT), React/OpenTUI (MIT),
the existing Git and GitHub CLI adapters, and Cheerio (MIT) for bounded public
pricing documents. No new dependency or license is introduced.

Before implementation, the generated macOS arm64 Phase 0 run measured:

| Primitive | Result | Measurement |
| --- | --- | --- |
| Generated OAuth, discovery, streaming and cancellation | Pass | 1,088.54 ms; cancellation 31.86 ms; six intercepted requests |
| SQLite WAL, rollback and replay | Pass | 1,000 events; append p95 0.062 ms; rebuild 0.532 ms |
| Owned PTY cancellation | Pass | 151.85 ms; no known survivors |
| OpenTUI streaming | Pass | 60 updates; 16.88 ms average |
| Hidden Electron timeline | Pass | 166.83 ms cold start; 442.72 MiB; 8.24 ms scroll frame |
| Bounded filesystem/Git reads | Pass | 2,000 generated files; 1.08 ms search; 6.09 ms Git status |
| Native verified dependency reuse | Pass | 557-byte generated archive; 496.44 ms; tampering rejected; no lifecycle scripts |

`npm run spike` and `npm run spike:workspace` reproduce these prerequisites.
The spike also explicitly reports its unavailable release gates: personal live
inference, Rust/Linux supervision, notarization, physical SendBox, live
multi-model quality/decision evaluation and a user-owned Remote target. They
remain unavailable, not converted into passing product claims.

## Board and continuation contract

Every project has a service-owned board, including before its first card. A
project-scoped special chat exposes that board without starting inference.
Hiding Kanban changes navigation only; cards, its chat and ongoing work survive.
Visibility-only saves neither read GitHub nor recapture its source binding,
including when that original binding has become stale. They do not cancel
an already owned synchronization. Its commit still checks the exact effective
board observation policy, captured repository/account/root and current card
revisions. Visibility cannot restore stale GitHub authority: a later explicit
refresh still refuses a changed binding before replacement metadata is read.
The [observation follow-up](alerts-kanban-sync.md) distinguishes stable source
ownership from historical policy counters: presentation changes and a newly
permitted fresh read do not retarget the source. Real root/account/upstream
changes still fail, and each current read pins/rechecks its effective policy.
Local cards and explicitly loaded GitHub/Linear items share the project view.
Imported third-party text remains untrusted source data and imports stay
read-only. Work item selection may bind a retained card from the session's own
project.

Project preferences select Kanban, open GitHub issues or open GitHub PRs as the
continuation source. Kanban uses explicitly eligible non-final phases, with
in-progress work before backlog. A user action or an exact actual-user
`continue work` submission first asks whether to use Kanban or send the exact
prompt normally. Only the actual Kanban choice selects one unclaimed item.
The route is requested every time, never saved as a preference. Quoted text, model
messages, held prompts and recovered queues cannot start this workflow.

The retained request binds the actual profile, source revision/digest, account,
repository, exact fetch/push URLs, canonical root, settings/policy, selected model
and budget ancestry.
Claim and owned worktree intent are committed before effects. The task gets a
fresh, visible, user-delegated child session on an isolated Local branch.
Its model and budget come from the originating session; ordinary Manual chats
and global defaults are not changed. The child explicitly uses automatic
Autonomous approvals, or the already selected qualified Autopilot decision layer.
Hard denials, allowed environments, credential boundaries and caps still win.

The delegated endpoint is a draft PR, or an update to the exact existing PR.
Publication reuses the existing exact-input Git/GitHub pipeline and records
model provenance separately from the actual user's workflow delegation. It
cannot authorize merging, force-pushing, rebasing, deleting branches, changing
accounts or publishing outside the captured repository/branch. The original
checkout, unrelated index entries and independently retained artifacts survive.
Remote/Sandbox continuation never borrows controller execution or credentials.

Claims prevent concurrent clients from working the same source. Cancellation
propagates to actual owned work, preserving requested and acknowledged outcomes.
Interrupted preparation/publication is partial, never successful or replayed.
Restart does not resume a task, create another worktree or repeat a paid call.
Partial claims require exact actual-user inspection before release. A verified
PR updates the linked status; a synchronized draft belongs in progress and a
ready open PR belongs in review. An actual closed issue, completed or won't do,
belongs in done. Read-only observations never create, draft, close or merge
GitHub resources.

## Column interaction and read-only GitHub synchronization

The board has per-column creation instead of a global New button, and native
HTML drag/drop instead of a phase-only workflow. Card moves bind complete
structural source/destination intent and the actual source revision, commit
all changed orders atomically, and retain unrelated columns and text. Keyboard
Alt+Up/Down and Alt+Left/Right use the same SDK command. A failed append leaves
no moved prefix or receipt. Ordinary source signatures retain their original
encoding; presentation-only order never becomes task or approval authority.

The user explicitly selected **GitHub to Kanban only**. The Sync with GitHub
toggle retains shared read-only observation policy, and optional open-issue
import starts off. Imported cards retain exact repository/issue identifiers,
original source digests and the captured profile/root/upstream/account binding.
The current numeric account and binding are checked before replacement-repo
reads; GraphQL also verifies the actual viewer and repository identity within
each complete response. No credential, public-account or alternate-root
fallback is allowed. Disabling sync aborts the original owned read; an ignored
abort or late response cannot publish a card after revocation.
Original source/card digests remain unchanged when current policy epochs
advance. No failed job is rewritten as completed and strict write/source
reviews retain their full original revision checks.
Repository and issue IDs use `fullDatabaseId`, not the limited GraphQL Int32
field. Decimal BigInt responses retain their exact safely representable value;
larger values are rejected rather than rounded into another source identity.

The official public GraphQL schema at
<https://docs.github.com/public/fpt/schema.docs.graphql> confirms that
`Issue.closedByPullRequestsReferences` returns open links, including manually
linked PRs by default. Reads use that typed relationship and actual `isDraft`,
not body keyword heuristics, cross-reference mentions or inferred model advice.
The maintained `gh api graphql` adapter sends bounded literal queries only.
GraphQL HTTP POST is a read, not a mutation. Partial errors, foreign viewers,
incomplete linked-PR collections and duplicate paging identities fail explicitly.

Open issue/no active PR maps to backlog; an active draft maps to in progress,
a ready open PR maps to review, and closed issue maps to done regardless of
completed/not-planned reason. Issue closure takes precedence over PR state.
The four meanings map to explicitly configured columns. Synchronized cards keep
their GitHub-owned column and can still be reordered inside it. Sync off permits
local phase changes but never writes GitHub. Imported title/body fields follow
source changes only while their retained digests still match local text;
explicit local overrides and archive choices survive.

Imports page through complete staged collections and atomically publish within
the existing 500-retained-card alpha bound. Exceeding it publishes no partial
prefix. Automatic import scans are at most every five minutes; linked reads
remain periodic while the service runs. Failed reads leave retained facts
unchanged and show job diagnostics. Restart preserves source ownership and
uses new read-job identities, not replayed jobs or duplicate imported cards.
The Local CLI-account boundary remains disclosed; Remote/Sandbox execution
does not acquire controller credentials.

This follow-up reuses Node (MIT), TypeBox (MIT), React/OpenTUI (MIT), maintained
Git/GitHub CLI and native browser drag/drop; no new dependency is introduced.
Protocol/schema **64** adds a transactional metadata marker and required SDK
surfaces. Required current metadata is validated, older genuine histories
upgrade without ciphertext/key/receipt rewrites, and future choices, imports
and ordering cannot be relabelled as older consent. Native desktop, TUI,
CLI and external SDK consumers share route and ordering commands.

The repeated generated prerequisites measured OAuth/stream/cancellation
1,121.77 ms, SQLite crash/replay 60.33 ms, owned PTY cancellation 159.67 ms,
OpenTUI streaming 1,094.80 ms, hidden Electron 771.82 ms,
filesystem/Git baseline 91.25 ms and verified workspace artifact reuse
569.99 ms. No personal authentication, paid inference, real GitHub mutation,
model weights or user processes were used. The earlier unavailable native,
live-model, Linux-host and release gates remain unavailable.

## Navigation

Project secondary click, macOS two-finger click, the action button and
Shift+F10 open the same keyboard-accessible context menu. Menu Move up/Move down
actions are removed. Project dragging reorders complete structural siblings
inside a folder, with revision checks and no overwriting a newer arrangement.
Session dragging and keyboard reorder remain available. Show/Hide Kanban is a
shared project preference, not browser-local state. Kanban is hidden for every
project until that project explicitly opts in.

## Pricing contract

USD values based on originating-provider API rates are **API-equivalent
estimates**, even when the transport is GitHub Copilot or another reseller.
They are not the subscription price, provider-reported spend or an invoice.
Those accounting fields remain separate. Exact model/name aliases can resolve
to the originating provider; ambiguous or absent matches remain unpriced.
Model name matching grants no family, capability, routing or quality evidence.

Public official sources:

- Anthropic: <https://platform.claude.com/docs/en/about-claude/pricing>
- OpenAI: <https://developers.openai.com/api/docs/pricing>
- Google: <https://aistudio.google.com/docs/pricing> (formerly `ai.google.dev/gemini-api/docs/pricing`, D77)
- xAI: <https://docs.x.ai/developers/models>

The initial reference snapshot was dated 2026-10-26; protocol 123 rechecked all four providers on 2026-11-25 (D77). For example, Anthropic lists
Claude Opus 5.5 at USD 4 input and USD 20 output per million tokens. This same
reference may estimate a name-matched Copilot call; it is not a claim about
GitHub's bill. Long-context and available cache rates retain their assumptions.
Promotional expiry, stale prices and missing telemetry cannot become zero.
Explicit user rates take precedence and are not silently replaced when stale.

Provider refresh is explicit, public, bounded and credential-free. It does not
add metadata requests to ordinary Copilot login or inference. Failed parsing or
networking preserves the prior catalog and surfaces an error. Each new call
captures its actual rate and source; refreshing never rewrites historical
charges. Using provider-equivalent rates to admit finite USD caps requires
explicit estimate-based consent and does not clear hard profile/global policy.

The bounded real-document prerequisite successfully parsed 20 Anthropic rows
in 618.96 ms, 36 OpenAI rows in 191.47 ms, 10 Google text-model rows in
654.30 ms, and eight xAI rows in 207.20 ms. Google's explicit `hl=en` URL avoids
its locale redirect; xAI uses its canonical HTML rather than an absent Markdown
endpoint. These are public numerical-document measurements, not paid inference,
invoice verification or guarantees that a future page format stays unchanged.
Malformed/future formats fail explicitly and retain the prior catalog.

## Durability and acceptance

Protocol/schema 63 converges the original automatic-Kupo schema 61, the private
session/GitHub schema 61 and the Kanban/pricing schema 62 by their exact markers.
The earlier private approval-only schema 59 also has an explicit convergence
path. All required markers and version changes are transactional; interruption
retains a recognized, reopenable source lineage. Current missing/corrupt markers,
premature markers and new history relabelled without its original marker are
rejected, never silently repaired. No consent, original selected response,
encrypted event/blob, receipt, unknown usage hold or routing preference is
rewritten. Older bounded Autonomous remains bounded until explicit reselection.
Old boards and settings keep valid defaults. New independent workflow/source grants participate in the
event-store retention transaction. Browser-safe SDK, Node, React and MCP
entrypoints expose the same typed domain.

Acceptance covers source selection, competing claims, account/root changes,
failure/cancellation, restart without replay, reviewed publication, original
checkout/index preservation, cross-client board preferences, work item picking,
native context menus, project dragging, exact/ambiguous price aliases, cache and
long-context arithmetic, price expiry and unchanged hard-budget admission.
Generated fixtures must not use personal credentials, repositories or invoices.

## Pre-integration local qualification, 2026-10-26

Type checks and the production build pass. The complete Node/service/worker/
CLI/native-TUI run has **1,504 passes and 14 platform/native skips**, zero
failures, across 1,518 cases in **1,220,495.93 ms**. This includes actual
controller SIGKILL, competing source claims, acknowledged stop with unknown
charges held, source-independent retention, both GitHub source modes,
read-only board schemas, exact fetch/push destination changes and publication
that denies remaining same-response tools without another paid step.

The complete hidden Electron run has **199 passes and three packaged/physical
native skips**, zero failures, across 202 flows in **6.4 minutes**. It exercises
secondary-click/keyboard project menus, durable project dragging, shared
visibility, Kanban work-item selection, actual composer `continue work` through
the generated PR endpoint, full PR body display and explicit API-price consent.

The independently packed external consumer installs with explicit local-package
script approval and audits cleanly. Root, Node, React and MCP imports/types,
protocol-62 board/preferences/work-item/pricing calls, existing installed
runtime/CLI/SSH scenarios and all **12 actual installed-worker continuation
probes** pass. Both source and external-consumer audits report **zero
vulnerabilities**. No root-only dependency override is needed.

The broad runs exposed older fixture assumptions, not accepted false positives:
legacy schema encoders now remove the future Kanban marker while preserving
strict corrupt-lineage refusal; native menu checks use actual menuitem roles;
ordinary-session assertions exclude the reserved board row and target a real
lower-half drop rather than its rounding-sensitive boundary. The updater check
waits for its hidden-launch suppression acknowledgement, not the preceding
intermediate `installed` journal entry. The final complete runs include these
corrections; failed-run logs remain separate qualification evidence.

Known notices remain the experimental OpenTUI FFI warning, the existing lazy
Ghostty chunk-size warning, and deprecated transitive `whatwg-encoding`/
`node-domexception` packages. Tests use generated roots, credentials, provider
responses, loopback Git and hidden windows. Public pricing-page reads are not
personal authentication or live inference. No real GitHub/Linear task mutation,
personal shell/microphone, model-weight download, physical SendBox, fork-head
publication, Remote/Sandbox continuation or notarized/Linux release
qualification is claimed. CI remains restricted to `main` pushes.

These measurements precede integration of automatic Kupo and contextual project
colors from `main`; they are not qualification of that integrated tree.

## Integrated qualification, 2026-10-26

The protocol-63 integration preserves automatic Kupo, its private-role model
boundaries, contextual rainbow/custom colors and the Kanban/approval/GitHub
features. Type checks and the production build pass. Exact original schema-61
lineages, Kanban schema 62, private approval schema 59 and interrupted
intermediate migrations retain their markers, ciphertext, receipts, original
responses and existing consent through failure and reopen.

The complete Node/service/worker/CLI/native-TUI run passes **1,552 cases with
14 platform/native skips**, zero failures, across 1,566 cases in
**1,292,019.42 ms**. A generated Cascade task exercises the real selected draft
through commit and PR publication: five actual router/draft/critic calls remain
charged to the origin, only the selected original response can publish, and
remaining same-response tools are denied without another model call.

The complete hidden Electron run passes **207 flows with three
packaged/physical-native skips**, zero failures, across 210 flows in
**6.6 minutes**. This includes both project-color and Kanban menus, toggle/focus
behavior, stale-revision refusal, project/session dragging, Kupo, native
approvals, repository sources and full PR/issue bodies.

The independently packed external SDK installs and audits cleanly. All public,
Node, React and MCP imports/declarations, actual installed runtime/CLI/SSH flows,
automatic Kupo and Kanban/pricing surfaces pass, along with all **12 installed
worker continuation probes**. Root and external-consumer audits report **zero
vulnerabilities**. The package's native preparation script is explicitly
approved in the generated consumer, not silently enabled for other packages.

An initial full run exposed a fixture acknowledgement race: provider dispatch
could be visible before that test's SDK event stream had received the retained
reservation. The SIGKILL fixture now waits for the exact session/model
reservation, then verifies that same immutable entry after recovery instead of
indexing an unacknowledged client array. All four current/original-main
Kanban/Kupo recovery cases pass in five consecutive repetitions, and the final
complete runs include this correction. No production authorization or
accounting assertion was weakened. Initial failure evidence remains separate.

The known notices and unavailable real-service/native/release boundaries above
remain unchanged. All execution uses generated roots and credentials, owned
loopback services and hidden windows. This does not qualify real model quality,
physical SendBox, fork-head updates, Remote/Sandbox continuation or billed spend.

## Kanban interaction qualification, 2026-10-27

The protocol-64 executable checkpoint `ac9eb78` passes type checks and the
production build. The complete Node/service/worker/CLI/native-TUI suite passes
**1,590 cases with 14 existing platform/native skips**, zero failures or
cancellations, across 1,604 cases in **1,313,408.72 ms**. This includes atomic
ordering, competing structural intent, actual continuation choices and saved
draft ownership, schema-marker rollback, revocation during pending imports,
ignored cancellation, concurrent local text edits and actual service restart
without duplicate imports or replay. Full-width GitHub IDs above Int32 retain
their exact value; values outside safe numeric representation cannot mint a
rounded source binding.

The complete hidden Electron suite passes **211 flows with three existing
packaged/physical-native skips**, zero failures, across 214 flows in
**6.7 minutes**. All **seven related flows also pass against the actual packaged
app** in **18.4 seconds**, including native card drags, per-column creation,
every-request plain/slash route choice, cancellation preserving the draft,
read-only issue import, real draft/ready status, synchronized-column locks and
one-item draft-PR publication without changing the parent.

The final independently packed SDK consumer installs and audits cleanly.
Browser-safe root/React, explicit Node/MCP entrypoints and declarations,
protocol-64 ordering/typed route reviews, installed runtime/CLI/SSH scenarios
and all **12 installed-worker continuation probes** pass. Fresh source and
external-consumer audits report **zero vulnerabilities**.

Native packaging rebuilds the exact protocol-64 Linux arm64 worker payload
without cache and verifies the bundled Node runtime and application identity.
The actual ZIP/manifest passes the bounded production update consumer; the
canonical DMG and distinct
`Moguri-0.30.0-alpha.1-kanban-64-macos-arm64.dmg` preserve the exact signed
bundle bytes and pass native Finder layout/background verification. The
distinct image also passes its native checksum. Qualification mounts only
private read-only verification volumes and opens no Finder window or personal
application. The installer remains local ad-hoc-signed development output,
not an uploaded or notarized release. Updating the previously installed app
requires the user's separate quit/replace/reopen action.

The initial broad run was intentionally stopped before correcting the official
GitHub identifier-width contract; it is not counted as a passing qualification.
The complete runs above use the final stable executable tree. Existing
experimental FFI, lazy Ghostty chunk, optional packager `.icon` and transitive
deprecation notices remain. CI is still restricted to `main` pushes. Physical
SendBox containment, live model quality, personal authentication, Remote/Sandbox
continuation and Linux/notarized release readiness are not broadened.
