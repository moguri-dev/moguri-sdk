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
Local cards and explicitly loaded GitHub/Linear items share the project view.
Imported third-party text remains untrusted source data and imports stay
read-only. Work item selection may bind a retained card from the session's own
project.

Project preferences select Kanban, open GitHub issues or open GitHub PRs as the
continuation source. Kanban uses explicitly eligible non-final phases, with
in-progress work before backlog. A user action or an exact actual-user
`continue work` submission selects one unclaimed item. Quoted text, model
messages, held prompts and recovered queues cannot start this workflow.

The retained request binds the actual profile, source revision/digest, account,
repository, exact fetch/push URLs, canonical root, settings/policy, selected model
and budget ancestry.
Claim and owned worktree intent are committed before effects. The task gets a
fresh, visible, user-delegated child session on an isolated Local branch.
Its model and budget come from the originating session; ordinary Manual chats
and global defaults are not changed. The child explicitly uses automatic
Autopilot approvals, or the already selected qualified Max decision layer.
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
PR can move a card to review; only the existing verified merge observation can
move it to the configured merged phase.

## Navigation

Project secondary click, macOS two-finger click, the action button and
Shift+F10 open the same keyboard-accessible context menu. Menu Move up/Move down
actions are removed. Project dragging reorders complete structural siblings
inside a folder, with revision checks and no overwriting a newer arrangement.
Session dragging and keyboard reorder remain available. Show/Hide Kanban is a
shared project preference, not browser-local state.

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
- Google: <https://ai.google.dev/gemini-api/docs/pricing>

The initial reference snapshot is dated 2026-10-26. For example, Anthropic lists
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

Protocol/schema 62 extends 61 additively. Old boards and settings keep valid
defaults; migration preserves prior approvals, source provenance, retained
events and capacity. New independent workflow/source grants participate in the
event-store retention transaction. Browser-safe SDK, Node, React and MCP
entrypoints expose the same typed domain.

Acceptance covers source selection, competing claims, account/root changes,
failure/cancellation, restart without replay, reviewed publication, original
checkout/index preservation, cross-client board preferences, work item picking,
native context menus, project dragging, exact/ambiguous price aliases, cache and
long-context arithmetic, price expiry and unchanged hard-budget admission.
Generated fixtures must not use personal credentials, repositories or invoices.
