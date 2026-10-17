# Moguri foundation critique: Pi versus OpenCode

**Assessment date: 2026-10-17. Status: research and recommendation, not an adopted architecture.**

For a build that forks neither project, see the [from-zero complexity assessment](from-scratch-complexity.md). The chosen direction is recorded in the [architecture decisions](decisions.md).

## Verdict

**Pi can use GitHub Copilot login, can be forked under MIT, and can use your local DeepSeek model through `antirez/ds4`. None of those three capabilities requires abandoning OpenCode: OpenCode supports them too.**

Your suspicion is reasonable, but the distinction is not "good harness versus bad harness." It is **building Moguri out of libraries versus adapting an existing multi-client product**.

- **For Moguri's first release as currently specified, OpenCode is the stronger starting point.** You want a desktop app, TUI, shared service, worktrees, terminals, diffs, permissions, provider integrations, and session management immediately. Discarding working surfaces has a substantial opportunity cost.
- **For a deliberately new product with its own clients and domain model, Pi is a credible runtime foundation.** Prefer consuming selected Pi packages to forking its entire CLI. Its experimental `pi-durable` package is particularly relevant to your durability and orchestration requirements.
- **Do not replace OpenCode with "Pi plus extensions" on the assumption that extensions make the remaining work small.** Moguri's hardest requirements are persistence, ownership, concurrent mutations, cancellation, isolation, and recovery. Those are host-application responsibilities, not primarily prompt or tool features.
- **The sleek desktop requirement strengthens OpenCode for the first release.** Pi core ships no desktop. Its most relevant desktop is the community `pi-gui` app (Electron/React). That app is a good UX reference, but it owns agent execution inside Electron's main process. Moguri needs one local service with both clients attached to it. See [section 6](#6-desktop-uiux-the-requirement-that-changes-the-weighting).

My recommendation is to keep OpenCode as the baseline candidate for the brief as written, while making Phase 0 a comparison against a bounded Pi-library prototype. Switch only if that prototype proves the hard guarantees and you consciously accept building or substantially adapting both clients. This is a recommendation for the next decision, not permission to import code or change the implementation order.

## 1. What was compared

### Moguri requirements

I read all five tracked Markdown documents. The mapping below covers the first release, later work, research ideas, and the complete desktop-sidebar contract:

| Source | Role in this assessment |
| --- | --- |
| [Newest build brief][B] | Authoritative product scope and phase order. |
| [Expanded implementation draft][E] | Additional detail where it does not conflict with the newest brief. |
| [README feature inventory][I] | Earlier ideas, including features subsequently deferred or clarified. |
| [Desktop sidebar specification][S] | Detailed desktop behavior and turn/steer accounting. |
| [Contributor contract][A] | Repository state, migration, isolation, cancellation, and implementation constraints. |

The checkout contains specifications, not the OpenCode baseline or an executable Moguri application. Statements such as "Moguri began as a fork" and "use the repository's existing SQLite" are premature in this checkout. There is no implemented runtime to migrate yet. This makes reconsidering the foundation relatively cheap **now**, but does not make the alternative free to build.

Where the documents differ, this report follows the newest brief: local-runtime checks precede automatic model installation; Core is user-controlled; hidden reasoning is not promised; Side chat and Stainless integration are later work; automatic retention is off by default. Retention appears in both initial and later lists, so its initial contract is not silently removed.

### Upstream snapshots and limits

| Project | Inspected development snapshot | Release cross-check |
| --- | --- | --- |
| Pi | [`c268154ca1171c2f9eefe75d3d7372a68aada2d5`][P0], `earendil-works/pi`, `main` | Latest release endpoint returned [v1.3.0][PR], commit `71023aec1546d6d677a65669c5665c0927ce0dd0`. Its tree includes MCP, Chord, telemetry, and `pi-durable`; the [release's durable README][P6R] still marks that API experimental. |
| OpenCode | [`8c173a8f3805d8e749d44311054b07e37a1b2ce1`][O0], `anomalyco/opencode`, `dev` | Latest release endpoint returned [v1.19.3][OR], commit `e3c4eb242585dcd77be1a867391b7c25fd47ce52`. The inspected development desktop package reports `2.0.32`; development APIs must not be presented as v1.19.3 guarantees. |
| ds4 / DwarfStar | [`fc80bd695da76ee14bcb86820bf900a5cdfda806`][D0], `antirez/ds4`, `main` | Pinned repository documentation, not an assumed installed version. GitHub's latest-release endpoint returned no release. |
| pi-gui (community Pi desktop) | [`572c0c6de8ffd3a245c224b912bb8752ca200780`][Q0], `minghinmatthewlam/pi-gui`, `main` | Latest release v1.0.1, published 2026-09-26. Third-party, MIT, not part of the Pi project. Inspected because it is the strongest Pi-side desktop evidence. |

Pi's historical `badlogic/pi-mono` repository resolves to `earendil-works/pi`. Current packages use the `@earendil-works` scope. Old articles saying Pi has no MCP, only JSONL persistence, or only a tiny agent loop are incomplete descriptions of this snapshot.

OpenCode has also evolved: current development code separates Core, Schema, Protocol, Server, Client, TUI, desktop, and GUI extensions. Its inspected desktop is **Electron/Solid**, not a presumed Tauri application. The [release desktop manifest][O3R] also uses Electron. [P0], [O1], [O2], [O3]

**Evidence standard:** implementation and primary documentation were inspected; neither upstream nor `pi-gui` was installed, built, or run. No Copilot login was performed, and your machine or running ds4 instance was not accessed. Your statement that the model runs fine is accepted. This report evaluates integration and architecture, not whether your hardware can load the model or whether a desktop *looks* sleek to you; that judgement requires the hands-on desktop gate in section 9. Feature availability on your exact installed revisions still needs the compatibility checks in section 9.

`R` below means a reusable upstream implementation, not that Moguri's full requirement passes. `P` means useful primitives with adaptation required. `N` means Moguri must supply the product contract; no complete implementation was established in the inspected evidence. `D` specifically marks OpenCode development-branch evidence, not a release promise. These are qualitative judgments, not measured effort estimates.

## 2. Direct answers

### Can Pi work with GitHub Copilot login?

**Yes, there is an actual provider and OAuth/device-login implementation, not merely a catalog entry.** Use Pi's `/login`, select GitHub Copilot, and complete the GitHub device flow. The source exchanges the credential for Copilot access, refreshes it, discovers account-available models, and derives the appropriate endpoint. The provider filters its model list using the credential's available-model metadata. [P1], [P2], [P3]

Important distinctions:

- This is **Copilot-backed model access through Pi's agent loop**. It is not running the Copilot coding agent inside Pi.
- Copilot login does **not** install an authorized GitHub issues/PR integration. Model access and repository operations need separate capabilities, credentials, and approval scopes.
- Catalog inclusion does not guarantee that your account, plan, organization policy, or geographic/provider availability permits every listed model.
- The inspected implementation uses Copilot-specific headers and an internal token endpoint. That establishes technical support, not a permanent public-API contract or blanket approval for every redistribution scenario. Keep the adapter replaceable and verify the applicable account terms and organization policies before shipping.
- The inspected login code may attempt to enable models whose policy is unconfigured. Moguri should review this behavior against its visible-policy requirement instead of inheriting it without disclosure.
- Pi ordinarily saves credentials in `auth.json`. API-key lookup through a secret-manager command is supported, but it does not by itself move the entire OAuth token lifecycle into an isolated OS keychain. Moguri still needs an explicit credential backend. [P1], [P2]

OpenCode also has a GitHub Copilot device-login provider. **Copilot compatibility is not a reason by itself to switch.** [O4]

Do not promise unlimited or accurately invoiced usage from model-catalog prices. GitHub documents plan-dependent AI-credit allowances and policies. Preserve estimated model cost, provider-reported usage/charges, and billed amounts independently. [G1]

If a formally supported GitHub integration surface becomes a hard requirement, evaluate the [Copilot SDK][G2] separately. It embeds Copilot's agent engine, so it is not a drop-in Pi model-provider replacement. It introduces a different runtime decision.

### Can Pi be easily forked?

**Legally: yes. Operationally: easy to start, not necessarily cheap to maintain.**

Pi's MIT license permits modification, distribution, sublicensing, and commercial use while retaining the required copyright and license notices. OpenCode is also MIT. Neither license grants ownership of the upstream name or branding, nor cancels dependencies' separate notice obligations. [P4], [O5]

Pi is unusually suitable for **composition**:

| Layer | What it supplies | What it does not settle |
| --- | --- | --- |
| `pi-ai` | Normalized model/provider access, streaming, usage, authentication machinery. | Moguri policy, profiles, account isolation, or its domain model. |
| `pi-agent-core` | Agent-loop and tool-execution primitives. | A complete durable application or desktop. |
| `pi-coding-agent` SDK | CLI-equivalent sessions, compaction, resources, tools, extensions, and events. | A ready-made multi-client Moguri service. |
| `pi-durable` | Durable conversations, atomic commits, submissions, task ownership, resume, and document storage. | Stable APIs, complete Moguri semantics, UI parity, or OS-enforced isolation. |
| Chord | Typed contracts, process links, observable state, migrations and host primitives. | Your authorization policy or an automatically durable business-event ledger. |
| `pi-tui` | Terminal rendering primitives. | Moguri navigation, work items, dashboard, queue UX, or service-backed TUI. |
| `pi-telemetry` | Vendor-neutral instrumentation contracts and conformance utilities. | A durable analytics database, billing system, or ready dashboard. |

These are **alternative and complementary layers**, not a recommendation to run both agent loops or two session authorities. In particular, `pi-durable` and the coding-agent `SessionManager` are different integration paths. [P0], [P5], [P6], [P7], [P8]

Prefer pinned dependencies with a narrow Moguri-owned adapter. Keep a small patch set only where a public API genuinely blocks an invariant. A full divergent fork makes provider fixes, security fixes, packaging, migrations, tests, release signing, update channels, and upstream rebases your responsibility.

Pi's contribution process also gates new contributors; do not schedule your product around an assumption that upstream will accept your architectural changes quickly. Its explicit extensibility is a better reason to choose it than a hoped-for upstream merge. [P0]

### Can Pi use local models through antirez/ds4?

**Yes. More strongly, ds4's own client guide contains configurations for both Pi and OpenCode.** This is direct integration evidence, although not a live test of your installed versions. [D1]

The intended boundary is:

```text
Moguri-owned session runtime
  -> Pi model provider OR OpenCode model provider
  -> local HTTP /v1/chat/completions
  -> ds4-server
  -> your already-working DeepSeek model
```

Use `ds4-server`, not a nested `ds4-agent`. The latter is another coding-agent loop with its own session state; nesting it would obscure tools, cancellation, usage, and ownership. ds4's guide explicitly directs external coding agents to the server. [D0], [D1]

The pinned ds4 guide specifies these Pi settings:

| Setting | Documented value / reason |
| --- | --- |
| Provider/base URL | `ds4`, `http://127.0.0.1:8000/v1`. |
| API | `openai-completions`, Pi's name for the compatible chat-completions interface. |
| Model ID | `deepseek-v4-flash` in the example; verify against the server you actually run. |
| Compatibility | `supportsStore: false`, `supportsDeveloperRole: false`, `supportsStrictMode: false`, `maxTokensField: "max_tokens"`. |
| Reasoning and streaming | `thinkingFormat: "deepseek"`, `supportsReasoningEffort: true`, `supportsUsageInStreaming: true`, `requiresReasoningContentOnAssistantMessages: true`. |
| Context/output example | Server and client configured for 100,000 context tokens, client output limit 16,384. These are example settings, not inferred capacity on your machine. |
| Credential placeholder | `dsv4-local` is not server authentication. |
| Input modality | The example is text-only. Images require a suitable loaded model, encoder, and client declarations. |
| Cost | Zero configured API-token prices mean no metered API charge in that estimate, not zero electricity, hardware, or opportunity cost. |

See the [full upstream Pi and OpenCode configurations][D1] rather than maintaining a second copied configuration here. Pi documents the compatibility fields in its generated model reference. [P9]

The meaningful risks are protocol and scheduling details:

1. **Context is a joint budget.** Input, tool schemas/history, reasoning where applicable, and output must fit the server allocation. A generous catalog limit cannot enlarge ds4's configured context.
2. **Tool history matters.** ds4 preserves native DSML tool representations and uses tool IDs for replay/cache reuse. Test a multi-round tool conversation, not just "hello." Compaction or provider switching can invalidate cached prefixes.
3. **Reasoning levels are not universal.** The pinned ds4 server guide says `xhigh` maps to normal thinking, while `max` needs sufficient context. Do not show misleading provider-independent labels.
4. **One model working well does not prove swarm throughput.** ds4 defaults to one resident session; explicit batching preallocates multiple KV states, with backend-dependent execution. More agents can add latency or memory pressure rather than speed. Start with bounded scheduling and measure contention; do not infer that your working model is unsuitable.
5. **Cancellation must be verified at both ends.** Aborting HTTP consumption is not proof that inference stopped or a server slot was released. Record an unknown/partial outcome if the server cannot acknowledge it.
6. **Attach is not own.** Connecting to your existing ds4 server must not make Moguri kill the whole server when one session stops. Only a server Moguri explicitly launched and owns may be lifecycle-managed by it.
7. **Local is not automatically isolated.** ds4's guide recommends authentication/TLS in front of nonlocal deployments; its cache and traces contain prompts/model state. Separate or explicitly govern cache sharing across profiles. [D2]

## 3. The architectural trap in each choice

### Pi trap: confusing the CLI with the new durable runtime

The ordinary coding-agent SDK has `steer()`, `followUp()`, `abort()`, a session tree, and streamed events. These are useful. But the inspected `AgentSession` keeps pending steering/follow-up queues in memory and persists regular conversation messages on `message_end`. The queueing methods are not a crash-safe admission ledger. The JSONL session format has migrations, but is not Moguri's project/work-item/artifact database. [P5], [P10], [P11]

RPC is JSONL over a child process's stdin/stdout. A successful prompt response means accepted, queued, or handled, not completed. `agent_end` can precede retries or continuation; `agent_settled` is the relevant final boundary. Neither record alone proves that external effects succeeded. RPC is an adapter boundary, **not** your public multi-client API. [P12]

`pi-durable` changes the comparison substantially. It has:

- stored admission and deduplication by `requestId`;
- SQLite/JSONL backends and atomic commits;
- committed inboxes, steer/follow-up submissions, checkpointed tasks;
- replay-safe versus interrupted-tool handling;
- owned child tasks/conversations and cancellation propagation;
- typed application documents and usage including failed/aborted attempts. [P6]

However, it explicitly says its API can change without notice. Its detailed semantics also need adaptation:

| Pi-durable fact | Consequence for Moguri |
| --- | --- |
| One process owns a storage; no cross-process locking. | One service must own writes. TUI/desktop cannot each open the same storage as an agent authority. Enforce service-instance ownership. |
| SQLite uses WAL with `synchronous=NORMAL`. | Process-crash survival is not the same as guaranteed power-loss durability. Define the promise and choose/configure the storage accordingly. |
| Watch reconnects start at current state, not historical replay; slow consumers receive a replacement snapshot. | Useful UI synchronization, but not sufficient for the required auditable, cursor-based event history. |
| `abort()` withdraws queued input submissions; queued writes remain. | Cannot map blindly to Moguri's "stop current turn, preserve unrelated queued work" behavior. |
| Background-owned tasks survive ordinary parent abort. | Moguri must explicitly model stop scope and include background descendants when its ownership policy requires it. |
| Cancelling a wait cancels the wait, not the work. | UI timeout, operation cancellation, and completed cleanup need separate states. |
| Code that ignores abort can delay close. | A separate process supervisor and escalation/reporting remain necessary. |
| Unsafe interrupted tools do not simply replay. | Good starting point; still reconcile external effects and never promise exactly-once execution without idempotency support. |
| Pi calls one model response plus tools a "turn"; Moguri calls that a "step." | Map Pi run/turn to Moguri turn/step explicitly or metrics and lifecycle boundaries will be wrong. |

These are not reasons to reject Pi. They are reasons to prototype the **actual library** rather than approve a foundation from the CLI's feature list.

### OpenCode trap: assuming more features means the invariants are already solved

OpenCode already has the architectural shape you want: a server-backed TUI, desktop, programmatic API, providers, MCP, permissions, and worktree machinery. Its current development branch also contains a durable event bus, transactional projections, a persisted inbox, execution claims/recovery accounting, and session-aware GUI extensions. Ignoring those would exaggerate Pi's advantage. [O1], [O2], [O6], [O7], [O8], [O9]

But reuse still needs a compatibility map:

- The event bus distinguishes live subscription from replayable log access. Its configurable `persist` option defaults to false in the inspected factory. **Do not infer the chosen application assembly's retention behavior from the existence of `Bus.log()`**; verify the wiring, enable the required persistence, and exercise restart replay.
- The bus also supports deleting an aggregate's event rows. Moguri's tombstone/trash/artifact retention rules must govern deletion rather than inheriting session-oriented cleanup unmodified.
- The development inbox has queue/steer/cancel operations and serialized admission, but that is not evidence of the complete reorder/edit/claim contract across both clients.
- Desktop draft/blob persistence is a reusable implementation, not proof that drafts are authoritative in the shared local service or synchronized with TUI.
- Current usage normalization/calculation is not the desired billing ledger: `session/usage.ts` has a TODO for a dedicated Copilot billed-amount runtime contract.
- GUI extensions have their own main/window stores and lifecycle. Reuse rendering and capability mechanisms without allowing a second authority for permissions or business state. [O6], [O7], [O9], [O10], [O11]

The public server guide and current development APIs are not interchangeable. Nor are all files present in a release archive necessarily the active path of its shipped CLI. Select a baseline and trace the entrypoints before estimating reuse.

**A reasonable third option is composition around OpenCode's service/client boundary, rather than immediately maintaining a deep fork.** It retains more UI value. But if required atomic operations or lifecycle hooks are unavailable, an external wrapper will not magically provide them; make targeted upstream changes instead of shadowing state in another database.

## 4. Complete first-release feature map

Sections 4 and 5 contain 112 requirement groups. Rows group related acceptance obligations; every named behavior in a grouped row remains in scope. References to the newest brief also cover expanded-draft detail unless a sidebar reference is given.

### Foundations, clients, sessions, and work

Evidence: Pi [SDK][P5], [durable runtime][P6], [Chord][P7], [session format][P11], [RPC][P12]; OpenCode [server][O1], [typed client][O2], [event bus][O6], [inbox][O7], [session store][O8], [worktrees][O12].

| ID / Moguri requirement | Pi starting point | OpenCode starting point | Remaining work / critique |
| --- | --- | --- | --- |
| F01. Local-first core; no required Moguri cloud; exportability [B] | R local CLI and embeddable libraries. | R local server and clients. | Neither provider access nor optional update/catalog traffic is automatically offline. Define offline behavior explicitly. |
| F02. Profile > Folder > Project > Work item, with Change sets, Sessions and independent Artifacts [B] | P conversations/docs; N complete domain hierarchy. | P projects/workspaces/sessions; N complete Moguri hierarchy. | Build the work-item/change-set/artifact ownership model in either choice. This is a real differentiator. |
| F03. Session > Turn > Step; typed IDs, schema versions, timestamps, parent/correlation IDs and scoped events [B] | P durable entries/tasks, different turn terminology. | P/D event schemas and aggregate sequencing. | Map identifiers and semantics; not every upstream event carries Moguri's required envelope. |
| F04. One typed API/event stream; clients never own authoritative state [B] | P SDK/RPC, Chord links and durable views; N complete service. | R server/client architecture; P/D newer generated typed client. | OpenCode leads. Pi TUI must become a service client, not another `AgentSession` over the same files. |
| F05. Append-only durable changes, projections, atomic transitions and crash-safe writes [B] | P `pi-durable`; ordinary CLI is insufficient. | P/D event transactions and projections. | Audit complete persistence wiring, admission acknowledgement, and transaction boundaries. SQLite alone is not event sourcing. |
| F06. Migrations, restart reconciliation, diagnostic failures; never require deleting state [B], [A] | P JSONL migrations and durable storage/migration facilities. | P SQLite migrations; D execution claims/recovery accounting. | Own Moguri schema evolution and test upgrades at the application boundary. Do not expose experimental storage as a permanent format without a plan. |
| F07. Content-addressed logs/attachments/snapshots; export, backup and restore [B] | P session export and storage APIs. | P exports and D draft/blob machinery. | Build consistent backup/restore and blob reachability/GC; avoid restoring a database without its attachments. |
| F08. Trash/tombstones, explicit purge, retention by days and/or GB, default off; pinned artifacts excluded [B] | P session trees/storage; N full retention policy. | P session/archive primitives; N verified full retention policy. | Retention is a domain operation, not `rm` over session files. |
| F09. TUI and desktop as first-class clients; navigation, split panels, command palette [B] | R terminal UI; N desktop in Pi core; P third-party `pi-gui` desktop with runtime owned by Electron main. | R existing TUI/desktop UI surfaces, both server clients. | Strong OpenCode advantage. Pi's terminal extension widgets are not desktop components. See section 6 for the sleek-desktop analysis. |
| F10. Active/idle/blocked/failed/completed/archived views, session detail and event log [B] | P runtime lifecycle/tree. | P existing session views and statuses. | Normalize all Moguri states, including stopping/stopped and restored, in one service. |
| F11. Compact/detailed messages, tools, MCP, steers, subagents; visible prompts and provider-returned reasoning [B] | R/P renderers, prompt entries and events. | R/P existing transcript surfaces. | Show only returned reasoning; retained raw diagnostics need redaction and access policy. |
| F12. Persistent prompt drafts, attachments and queued messages after app closure [B] | N shared drafts; P durable inbox, not CLI queue. | P desktop drafts; D persisted inbox. | No client-local-only authority. Decide how two composers edit the same draft. |
| F13. Reorder, edit or delete only unclaimed messages; atomic claim versus mutation [B] | P durable transactions; N complete API/UX. | P/D admission and pending-input mutations. | Stable message IDs and revision checks; mutating a string-array queue is not enough. |
| F14. Queue, Steer and Interrupt as separate behaviors [B] | R steer/follow-up/abort primitives; P full semantics. | P/D queue/steer/cancel and session controls. | Interrupt needs durable cancellation outcome before admission; preserve other queue entries deliberately. |
| F15. Idempotent lifecycle transitions and accepted-message survival [B] | P durable request IDs and task states. | P/D serialized inbox/events and recovery claims. | Persist admission before acknowledging it, and distinguish accepted work from finished work. |
| F16. Workflow -> session -> subagent -> tool/MCP/provider/terminal/process cancellation [B] | P durable ownership and abort; CLI tools alone do not meet full contract. | P session, tool, subagent, PTY controls. | Neither proves all external cleanup. Build a supervisor with requested/acknowledged/completed/failed/partial outcomes. |
| F17. Every owned running command/background process visible and manually stoppable in both clients [B] | P tool events; N complete process inventory. | P terminal and command surfaces. | Track process identity/ownership beyond PID alone; unrelated and attached external services must survive. |
| F18. Project/worktree create, discover, attach, open, remove; dirty/external-change detection [B] | P tool/shell substrate; N managed-worktree product. | R worktree machinery; D pluggable strategies. | OpenCode leads. Preserve worktrees independently of session archive/delete. |
| F19. Prevent incompatible active sessions sharing a worktree; track branch/commits/diff/PR [B] | N service-level leases and change-set model. | P workspaces/worktrees/diffs. | A worktree is isolation infrastructure, not a concurrency lock. Define intentional sharing versus incompatible mutation. |
| F20. User/policy-gated push, merge, rebase and branch deletion [B] | P hooks; no built-in permission boundary. | P built-in allow/ask/deny rules. | Gate typed actions and subprocess/network capabilities; instructions alone cannot enforce this. |
| F21. Start from GitHub issue/PR or Linear/Jira item only through authorized connector [B] | R MCP transport, P connector/session glue. | R MCP/provider ecosystem, P work-item/session glue. | Copilot model authentication is unrelated to repository/tracker authorization. |
| F22. Decisions, plans, answers, research notes and reports with revisions, status, scope and provenance [B] | P typed durable docs or external storage. | P storage/events; N full artifact product. | Neither session export nor a custom chat message satisfies independent artifact ownership. |
| F23. Persist structured questions/answers; policy-controlled promotion to artifacts [B] | P extension dialogs/RPC UI and durable writes. | P question/permission surfaces. | Store the actual question, answer, choice schema and source events, not only an agent summary. |
| F24. Artifacts survive session deletion; project deletion previews keep/export/repo materialization/commit/delete [B] | N full lifecycle. | N full lifecycle. | Implement transactions and explicit choices; never make session GC own artifact GC. |
| F25. Archived sessions visible, searchable, restorable, individually deletable [B] | P tree/resume/search primitives; N Moguri archive policy. | P session UI/storage. | Restore is not undelete. Preserve provenance when the original worktree no longer exists. |
| F26. Unit/integration/migration/restart/cross-client contracts; races, failed cancellation, outages, corrupt state, full disks, incompatible plugins [B], [A] | P upstream tests/conformance suites. | P upstream tests and contracts. | Neither upstream test suite proves Moguri. Use synthetic fixtures; keep all acceptance checks. |

### Analytics and budgets

Evidence: [Moguri dashboard requirements][B], [sidebar accounting definitions][S], Pi [durable usage][P6] and [telemetry][P8], OpenCode [usage normalization][O11].

| ID / Moguri requirement | Pi starting point | OpenCode starting point | Remaining work / critique |
| --- | --- | --- | --- |
| M01. Model/provider and input/output/cache token usage | R/P provider usage and durable totals. | R/P usage normalization. | Preserve unavailable versus zero and provider-specific meanings. |
| M02. System-prompt/message/tool-schema/tool-call/MCP/compaction token categories | P prompt/tool metadata. | P prompt/tool metadata. | Categories can overlap. Define one additive partition and separate attribution views; label derived splits estimated. |
| M03. Tool/MCP calls, failures, retries, cancellation counts and rates | P events/instrumentation. | P events/usage surfaces. | Store denominators and retry attempts, not just final successful calls. |
| M04. Script/command/subsession/subagent/group/session elapsed time | P task/agent events. | P task/session/process events. | Parallel child durations must not be summed and labeled wall time. |
| M05. Wall time versus active model/tool/MCP/terminal time | P instrumentable boundaries. | P instrumentable boundaries. | Define clocks, overlaps, restart gaps and unknown intervals. |
| M06. Per-turn and per-steer tokens/time | P upstream events; N canonical Moguri attribution. | P upstream events; N canonical Moguri attribution. | Pi's turn terminology differs. Carry Moguri IDs into every request/usage record. |
| M07. Generation throughput; weighted turn/session aggregation | P token counts and streaming boundaries. | P token counts and streaming boundaries. | Use measured active-generation intervals; do not divide by whole-session duration or average request rates unweighted. |
| M08. Estimated price, unit price/source/currency/effective date | P model catalog costs. | P model catalog costs. | Snapshot pricing provenance with the request; changing today's price must not rewrite historical estimates. |
| M09. Separate estimated, provider-reported and billed amounts | N complete ledger; P raw usage. | N complete ledger; D source explicitly notes billed-contract work. | Copilot credits, API cost and local operating cost are different measures. Missing invoice data stays unknown. |
| M10. Remaining budgets; profile/session warning and hard stop | P request/tool hooks. | P runtime permission/request seams. | Add atomic budget reservations across concurrent agents and compactions; a post-hoc dashboard cannot enforce a shared limit. |
| M11. 7/30/60/90/365 days, selected year, custom range, all time; day/week/month grouping | N Moguri dashboard. | P session stats; N this complete dashboard. | Query stored events with explicit timezone/boundary semantics. No backend choice removes this work. |
| M12. Folder/project/repo/GitHub org/visibility/profile/provider/model/session filters | N full domain-backed filters. | P project/provider metadata. | "Open source" is not synonymous with "public"; retain explicit classification and time-sensitive repository metadata. |
| M13. Session price/tokens/compactions/metadata/timers/archive/storage/delete page | P raw runtime data. | P existing UI and data. | Include profile, repo, worktree, branch, work item, orchestrator, tags, timestamps and duration; reuse UI where possible. |
| M14. Trace every total to immutable events; local analytics and opt-in telemetry | P durable commits and optional telemetry adapter. | P/D event architecture. | Pi telemetry is diagnostic, not business state; its reference adapter is process-local and records no timestamps. Build an auditable ledger. |
| M15. Experimental velocity: time to green, completed work items, interventions, review cycles, rework | N product metric model. | N product metric model. | Good direction, but definitions need human outcomes. Tokens, commits and changed lines are not productivity evidence. |

### Profiles, providers, plugins, and privacy

Evidence: Pi [providers][P1], [extensions][P13], [MCP][P14], [models][P9], [Chord][P7]; OpenCode [permissions][O13], [providers][O14], [GUI extensions][O9].

| ID / Moguri requirement | Pi starting point | OpenCode starting point | Remaining work / critique |
| --- | --- | --- | --- |
| P01. Work/Open Source profiles; bound projects/folders, accounts, keys, routing, budgets, policy and integrations | P configurable auth/resources and per-conversation settings. | P provider/config/workspace machinery. | Neither separate config directories nor separate accounts prove complete profile isolation. |
| P02. Isolated artifacts/memory; explicit credential sharing only | N complete domain isolation. | N verified complete domain isolation. | Include caches, logs, search, attachments, subprocess environment, MCP credentials and browser state. |
| P03. Secret references into keychain/explicit backend; no secrets in prompts/events/logs | P command-based API-key resolution; file-backed auth defaults. | P provider credentials; public docs describe file-backed auth. | Verify the chosen runtime's credential path. Mediate OAuth refresh as well as API-key reads. |
| P04. Profile language, accent, voice and presentation | P configuration hooks/themes. | P UI/settings. | Store preferences separately from security policy. Voice synthesis/dictation is additional work. |
| P05. Plugin capability/settings/permission/hook/version manifests; no silent permission expansion on updates | P packages and extension APIs, but executable full-trust code. | P plugin and D GUI manifest/lifecycle machinery. | A manifest is not enforcement. Diff grants during update and require explicit approval. |
| P06. Normalized provider capabilities plus diagnostic raw metadata | R `pi-ai` and custom providers. | R provider abstraction. | Retain redacted raw data selectively; do not make provider payloads your application schema. |
| P07. Optional `llm` model adapter, not exclusive provider interface | P custom-provider seam. | P custom-provider seam. | Preserve streaming/tools/usage/cancel semantics; avoid redundant retries and opaque nested CLIs. |
| P08. Discover local runtimes; OS/architecture/drivers/accelerators/RAM/VRAM/disk/model checks; health/actions | P configurable local endpoints. | P configurable local endpoints. | Neither proves a full hardware/runtime health product. Your ds4 configuration can be a focused first backend. |
| P09. Every remote destination disclosed with purpose; local data stays local unless shared | N complete network inventory/policy. | N complete network inventory/policy. | Include catalogs, updates, package installs, auth, MCP, provider traffic, telemetry, browser tools and plugins. Pi documents runtime catalog refresh from pi.dev. |

### Desktop sidebar: every panel and its cross-client contract

The [sidebar specification][S] is substantially more than "add a right panel." Current OpenCode development has session-aware GUI-extension panels for existing features including terminal, review, files and browser. That is valuable prior art, **not** proof of Stainless support, MCP Apps support, or your exact permissions. Pi extensions primarily render terminal UI; its RPC forwards selected dialogs, not custom TUI components as web UI. [O9], [P13]

| ID / Moguri requirement | Pi starting point | OpenCode starting point | Remaining work / critique |
| --- | --- | --- | --- |
| S01. Persistent desktop-only sidebar; seven entries; one panel at a time, collapse/resize/badges/splits | N shell in Pi core; P `pi-gui` thread sidebar and per-task workbench as reference; P runtime data. | R/P/D panel/extension shell. | Keep layout local if desired. TUI does not inherit this desktop layout. |
| S02. Main-session rebinding of every panel; keyboard/focus/labels/status accessibility | N complete implementation. | P/D routed-session contracts. | Test rapid session/profile switches and stale asynchronous responses; no previous-session leakage. |
| S03. Changes: staged/unstaged/untracked/conflicted/external files; diffs, branch/commit/work-item/PR links; explicit Git actions | P tools; N panel. | R/P diffs/review/Git surfaces. | Service owns status and mutation. Cached diffs are not an authorization or freshness check. |
| S04. Terminal: owned trees, output/input/open/stop; closing view does not kill process | P tools/tasks; N PTY product. | R/P terminal/PTY surface. | Rebind output safely, preserve ownership and all cancellation outcomes. |
| S05. Files: scoped tree/search/open-with/text/binary preview; service edits with external-conflict detection | P coding tools; N panel. | R/P files/search UI. | Enforce boundaries, exclusions, protected/ignored paths, permissions and size limits in service. |
| S06. Browser: optional Stainless, previews/pages/console/network/screenshots/Playwright; visible connection/permission/health | P MCP; N integration and panel. | P/D browser surface; N verified Stainless adapter. | Later work. Explicit context admission; absent integration shows unavailable/setup guidance. |
| S07. Side chat: linked conversation, selected source-referenced main-session/tool/file/browser/artifact context | P multiple conversations; N product. | P sessions/panels; N this companion contract. | Later work. Separate usage/tools/cancel; proposals do not silently control the main session. |
| S08. Insights: live identity/state, times/tokens/costs/calls/retries/failures/compactions/storage/artifacts/interventions/diagnostics | P runtime data; N panel. | P UI/runtime data. | Use the same queries/metrics as TUI and dashboard, not a second accounting implementation. |
| S09. Steer requested/applied timestamps; nonoverlapping windows; wait, response and total time; failed/cancelled/superseded windows retained | N canonical contract; P events. | N canonical contract; P events. | Window runs from application to next applied steer or turn terminal state. Keep actual outcomes and originating client/side-chat identity. |
| S10. Generation tokens/sec, weighted turn/session totals; unavailable or explicitly estimated states | P counters/hooks. | P counters/hooks. | Exclude tools, MCP and queue time. Keep provider counts and timing quality. |
| S11. Optional inline turn footer; global preference and session override; each steer separate; provisional then settled | N client presentation. | P transcript/UI hooks. | Visibility cannot affect capture. Total steer time is request to window end, with wait/response breakdown. |
| S12. Extensions panel: canvas extensions and MCP Apps, install/enable/configure/update/remove/open, source/version/grants/profile/health | P packages/MCP, N desktop host. | P/D GUI extensions, N verified complete MCP Apps contract. | MCP tool transport does not imply MCP Apps rendering. Record app lifecycle separately from tool calls. |
| S13. Shared queries/events/permissions; reconnect replay before mutation; stale writes rejected | P Chord/views plus host work. | P server/client/event machinery. | Pi durable snapshots alone do not fulfill replay. Add revision/cursor validation. |
| S14. Loading/empty/unavailable/disconnected/denied/failed/cancelled/partial states; dependent-operation failures only | N product-wide state contract. | P/D extension failure/blocked lifecycle. | Missing data is not zero or success; plugin/browser loss should not kill unrelated main-session work. |
| S15. Separate main/side-chat cancellation unless workflow ownership says otherwise; durable measurements/context/terminal promises | P task ownership. | P session/process controls. | Encode links separately from ownership; visual companionship is not a cancellation parent edge. |

## 5. Later-work and research feature map

These rows remain mapped, **not promoted into the first release**. Unless noted, both upstreams provide extensibility rather than the complete requested workflow. Pi's toolkit flexibility is useful here; OpenCode's existing integrations reduce some UI and tool work. Neither turns an ambitious persona name into a reliable autonomous system.

### Interaction, orchestration, and execution

| ID / requested feature [B], [E], [I] | Pi fit | OpenCode fit | Critique / implementation ownership |
| --- | --- | --- | --- |
| L01. Configurable shortcuts | R shortcut/keybinding APIs. | R/P keybindings and commands. | Low-risk later enhancement; keep actions shared and presentation-specific keys local. |
| L02. Option/Ctrl+Space dictation; evaluate NVIDIA Nemotron speech | P extension/input seam. | P desktop/TUI input seams. | Both need speech integration, microphone permission, offline/privacy choices and platform key-conflict handling. |
| L03. Detect repeated prompts and propose `/fix-rebase`-style commands | R templates/commands, N detection/promotion. | R commands, N detection/promotion. | Propose a parameterized command; repetition must not auto-authorize push/rebase. |
| L04. Inspectable/collapsible prompts, reasoning, tools, steering and subagent activity; timers/token counts | P existing renderers and events. | P existing transcript UI/events. | Extend the first-release observability model; do not introduce a different later transcript. |
| L05. Session groups with/without orchestrator; attach/replace orchestrator; safe detach | P durable ownership/conversations. | P sessions/subagents/workspaces. | Group membership, control authority and cancellation ownership must be separate relations. |
| L06. Stable `@` handles; group tasks/times/tokens/stop | P extensible tools/commands. | P named agents and subagents. | Add profile/project-scoped resolution and explicit permissions, not textual mention parsing alone. |
| L07. Multi-repo folders/work streams; ordered PR delivery and policy-gated merging | N domain/workflow, P tasks. | P projects/worktrees, N complete coordinator. | Neither provides distributed transactionality across repositories. Model partial completion and recovery. |
| L08. GitHub stacked PRs | P connector/tool seam. | P Git/tool seam. | Model dependencies, retargeting, stale bases, restacking and merge permissions explicitly. |
| L09. Optional remote/hosted sessions, groups and workflows | P RPC/SDK and durable backends. | P server/client and remote execution surfaces. | Remote transport does not preserve local process control automatically. Keep budgets, artifacts, identity and stop outcomes identical. |

### Skills, policies, tools, and integrations

Evidence: Pi [extensions][P13], [MCP][P14], [packages][P15]; OpenCode [permissions][O13], [plugins][O15], [GUI extensions][O9]. Named first-party integrations below are requirements, not claims that their repositories were tested in this assessment.

| ID / requested feature [B], [E], [I] | Pi fit | OpenCode fit | Critique / implementation ownership |
| --- | --- | --- | --- |
| L10. Gallery for plugins, skills, hooks, workflows, personas and policy packs | P Pi package ecosystem. | P plugin ecosystem. | Build provenance, compatibility, grant review and trusted distribution; discovery is the easy part. |
| L11. Structured/inspectable manifests for plugins/instructions/hooks/skills; skills directly invocable, slash commands where useful | R/P skills/templates/extensions. | R/P skills/commands/plugins. | Standardize discoverability across both clients and disabled/unavailable states. |
| L12. Self-evolving skills/hooks/tools with proposal, evaluation, approval, versions and rollback | P extensibility; live reload exists. | P extensibility. | Never equate live reload with safe self-modification. Freeze active execution to an approved version. |
| L13. GitHub/vulnerability/conflict/logging/observability/commit-frequency/style/tech-stack/coding/documentation policy packs | P hook/tool enforcement seams. | P permission and plugin seams. | Separate advisory prose from machine-enforced action policy and repository constraints. |
| L14. Linted commit messages; secure SSH signing; suppress tool co-author trailers | P custom Git tools. | P Git tooling/hooks. | Use an explicit signer interface and user identity; do not give the model raw signing keys. |
| L15. Standard `--silent`, bounded/truncated output, terse "caveman" replies | P built-in bounded output and hooks. | P tool-output/UI hooks. | Preserve complete diagnostic output separately; never suppress errors to save tokens. |
| L16. Durable docs under `docs/`; no scattered generated summaries | P instructions/resource loader. | P instructions/config. | Enforce file-writing policy where appropriate; not a foundation discriminator. |
| L17. Import/synchronize policies from authorized `copilot-instructions.md` sources | P resource loader. | P instruction/config machinery. | Preserve origin, scope and precedence. Remote text cannot silently grant privileges. |
| L18. Built-in reusable Python diff/parse/split/find/structured-data utilities | P custom tools. | P custom tools. | First reuse native tools; add deterministic utilities where they demonstrably save cost/errors. Avoid building another tool standard library preemptively. |
| L19. GitHub issue/PR create/edit/close/query; CI checks/Actions logs; review read/write/resolve | R MCP/CLI access substrate, P typed integration. | R MCP/CLI access substrate, P typed integration. | Build idempotent operations, scoped auth, pagination, rate-limit handling and review-thread identity. |
| L20. Dependabot/Renovate/bot PR handling; ecosystem-specific vulnerability fixes | P tools/tasks. | P tools/agents. | Verification and bounded policy matter more than runtime brand. Never auto-merge merely because the author is a bot. |
| L21. Merge-versus-rebase policies for main/master/other targets/stacked PRs | P tools/hooks. | P Git and permissions. | Preserve features; conflicts needing intent require human input. |
| L22. `sendbox` profile-selectable sandbox | P replaceable tool environment. | P tool/workspace integration. | Verify containment of files, processes, network and credentials; do not mistake a working directory for a sandbox. |
| L23. `porto` local dev-server/container-stack CLI | P custom tool. | P custom tool. | Track ownership and health. Attaching to an existing stack must not imply permission to stop it. |
| L24. `sql-not-so-lite` database CLI | P custom tool. | P custom tool. | Separate read-only access from migrations/destructive queries and redact sensitive results. |
| L25. `stainless` private browser/Playwright via MCP and open-with | R MCP transport, N desktop integration. | P browser UI/MCP, N verified adapter. | See S06. Browser accessibility to an agent is not consent to include all page data in context. |
| L26. Optional `vslocal` VSX thin client | P RPC/host API. | P server/client SDK. | Both feasible; OpenCode already has the broader client architecture. Never create an IDE-only state authority. |
| L27. Guided Hugging Face install after preflight: size/RAM/VRAM/disk/runtime/license/trust disclosure | P provider seam. | P provider seam. | Both need downloader/runtime management, checksums, interruption/recovery and explicit execution trust. ds4 uses its supported model artifacts, not arbitrary GGUF compatibility. |

### Workflows, personas, metachat, and memory

| ID / requested feature [B], [E], [I] | Pi fit | OpenCode fit | Critique / implementation ownership |
| --- | --- | --- | --- |
| L28. Metachat changes settings, inspects state and diagnoses Moguri | P custom tools/conversation. | P tools/config/session APIs. | Make settings changes typed proposals and transactions. Never let troubleshooting expose other profiles' secrets. |
| L29. Scheduled CI watches | P durable tasks, N complete scheduler. | P integrations, N complete Moguri scheduler. | Prefer event-driven wakeups; define deduplication, missed triggers, retry/backoff and stop conditions. |
| L30. Dependency roundups | P task/template. | P task/template. | Summaries need a cursor and bounded repository scope, not perpetual polling. |
| L31. My work: open PRs, pending reviews, failing CI, unresolved comments | P connector plus queries, N UI. | P connector/UI substrates. | Materialized view over authorized sources; display freshness and partial fetches. |
| L32. Run prompt now/on schedule; readable prompt-plus-named-script workflows; optional server delegation | P durable tasks/SDK. | P API/agents/tools. | Build durable trigger/admission semantics, budgets and approval expiry. A timer is not a scheduler. |
| L33. User-defined continuous personas with stable handles, prompts/tools/models/policies/schedules/budgets/memory | P configurable conversations/extensions. | P configurable agents/subagents. | Personas should be workflow configurations, not additional agent loops. |
| L34. Product Manager: PostHog setup, usage/market research, assumptions/issues, measurement and reports | P tools/templates. | P tools/templates. | Consent to product telemetry must be explicit. Correlation after an agent's change is not proof the change improved the product. |
| L35. Per-repo Maintenance: dependency/security PRs, breaking fixes, policy-permitted merge and custom actions | P durable tasks. | P agents/Git surfaces. | Require bounded repository scope and merge policy; "continuous" must include an idle/stopped state. |
| L36. Per-repo Docs, targeted or continuous | P instructions/tasks. | P instructions/tasks. | Trigger on meaningful code changes and avoid documentation churn/self-trigger loops. |
| L37. Deep Search, source-driven/scientific question resolution | P tools and durable context. | P research/tool substrate. | Source provenance, evidence quality and a bounded unanswered outcome are the product. |
| L38. SRE from error + read-only infrastructure MCPs/diagrams/telemetry/code | P MCP/tools. | P MCP/tools. | Enforce read-only permissions outside the prompt; a proposed remediation is not permission to execute it. |
| L39. Autopilot through implementation/tests/review/delivery | P continuation and task runtime. | P agent loop and existing coding surfaces. | Define "done" externally with acceptance evidence, not the model's final message. |
| L40. Long-running Autopilot for giant greenfield projects or language rewrites | P experimental durable tasks/checkpoints. | P sessions/recovery primitives. | Broad vision, weak product promise: requires decomposition, checkpoints, independent evaluation and resource limits. |
| L41. Stabilize: pending PRs/security/Dependabot/Actions hardening/issue triage | P policy-governed templates. | P integrations/templates. | Split read-only assessment from independently approved mutations; "stabilize" is not blanket merge permission. |
| L42. Swarm: all issues -> roadmap/target state -> approval -> coordinated implementation | P child-task graph. | P subagents/projects. | "All issues" may be contradictory or stale. Require triage and a capacity budget before spawning work. |
| L43. Team, councils, Squad/Paperclip-style personas | P extensible agent/task composition. | P named agents/subagents. | Start with one worker plus reviewer; measure benefit before adding a permanent coordination hierarchy. |
| L44. Core/Sky/Terra/Glacier with source/confidence/scope/expiry/profile ownership and approved promotion | P custom docs/context hooks. | P instructions/storage/hooks. | Tier names do not define retrieval quality. Make Core immutable to agents; test contamination, stale knowledge and deletion propagation. |
| L45. Virtualized worktrees using copy-on-write B-trees/HAMTs/Delta DB ideas | N research. | P existing Git worktree baseline; N proposed virtualization. | Benchmark ordinary worktrees and filesystem snapshots first. Preserve tool/filesystem/Git compatibility. |
| L46. CRDT worktrees for concurrent edits | N research. | N research. | Text convergence does not resolve semantic conflicts, tests, generated files or competing designs. Do not put this on the critical path. |
| L47. Model blame/provenance: proposed/applied/modified/reviewed/verified patches or lines, without forced Git authorship | P events/tool records. | P events/diffs. | Prefer patch provenance with confidence over exact line ownership; rebases, formatters and human edits erase simple attribution. |

## 6. Desktop UI/UX: the requirement that changes the weighting

Moguri is not a CLI with an optional GUI. It needs a CLI/TUI **and** a sleek desktop app, and both must be first-class clients. That raises three questions the feature map only partly answers:

- How much proven desktop product already exists?
- Does that desktop fit Moguri's rule of one local service with every client attached to it?
- Can it become recognizably Moguri, not a reskinned upstream?

### What desktop exists for each foundation

| Candidate | Desktop stack | Reusable UX assets | Fit with Moguri's one-service model | Main risks |
| --- | --- | --- | --- | --- |
| Pi core | None. [Packages][P16] are agent, ai, chord, codemode, coding-agent, durable, env, evals, mcp, telemetry and tui. [`pi-tui`][P17] is a terminal renderer. | TUI components and themes. Desktop integration would go through the SDK, RPC and Chord. | A good engine boundary, but no graphical client. | The entire desktop product is new work. |
| [`pi-gui`][Q1] (community, [MIT][Q4]) | [Electron 37, React 19, Vite 6, xterm][Q2], built on the Pi coding-agent SDK and Chord. | Thread sidebar, local or worktree threads, Review tab with per-turn checkpoints, terminal and file workbench, ⌘K palette, queue and steer, themes, sandboxed extension views, virtualized streaming timeline and Playwright-driven Electron tests. | Weak as-is. [Electron main owns][Q3] session supervision, drafts, queues, worktrees, terminals and scheduled tasks. Pi's JSONL session files are the shared source of truth with the Pi CLI. | Third-party project (13 contributors at inspection). Electron 37 is outside Electron's [support policy][X1] of the latest three stable majors ([latest is 44.9.0][X2]). Its architecture document says verification covered only the documented macOS scope, and Windows builds are not code-signed. It keeps compatibility seams for private Pi APIs. |
| OpenCode | Desktop is [Electron 44 (dev)][O3] or [42 (v1.19.3)][O3R]. [App][O16] and [UI][O17] are Solid, Vite 8, Tailwind 4 and Kobalte, with a ghostty-web terminal, `@pierre` diffs and trees, and Shiki highlighting. | Separate `app`, `ui`, `session-ui`, `theme` and [`storybook`][O18] packages; 83 stories with the a11y addon; a [desktop theme schema][O19]; keybinding settings and a command palette; [Playwright regression and performance suites][O20] covering command-palette, timeline-accessibility, side-panel, terminal-input, review and queue regressions, plus startup, palette, terminal and timeline benchmarks; and an [Electron window layer][O21] with recovery, unresponsive-window handling and deep links. | Strong. Desktop and TUI are both clients of the OpenCode server through `@opencode/client`. | The UI is Solid, not React, and imports OpenCode's client and schema packages directly. Changing identity or information architecture means owning a fork of `app`/`ui`. Closed issues show the relevant failure classes: [cross-project data shown or used after a project switch][O22] and [unbounded SQLite WAL growth from multiple long-lived desktop connections][O23]. |

The Pi-side desktop comparison is therefore **`pi-gui` versus OpenCode, not Pi core versus OpenCode**. Pi core alone is the weakest starting point for a sleek desktop.

### Critique

**"Sleek" is mostly invisible engineering.** Colors, spacing and typography are cheap compared with a timeline that never jumps while streaming. The same applies to fast startup, low input latency, long virtualized sessions, large diffs, terminal throughput, reconnect behavior and honest stop states. Both OpenCode and `pi-gui` have invested in this layer, as their benchmark and timeline-viewport work shows. A Pi-core-only desktop starts from zero here.

**The desktop must not own the agent runtime.** `pi-gui` is carefully engineered, but it puts runtime ownership in Electron main and shares session files with the CLI. Moguri requires the TUI and desktop to be clients of one service. Starting from `pi-gui` therefore begins with moving its conversation, workspace, orchestration, scheduled-task and checkpoint owners into the Moguri service. That is a substantial extraction, not a reskin. Without it, Moguri would have two runtimes writing the same JSONL.

**Your stack preference changes the cost.** You prefer Vite with React, and Electron or Tauri. OpenCode matches Electron and Vite but uses Solid. Rewriting OpenCode's `app`, `ui` and `session-ui` in React discards the main reason to pick OpenCode for desktop. If you choose OpenCode, accept Solid for the first release. Its JSX looks familiar, but fine-grained signals are a different mental model from React rendering. If React is non-negotiable, the desktop comparison moves toward `pi-gui` or a new React client, with OpenCode used as a UX reference.

**Electron versus Tauri.** Both serious candidates use Electron. OpenCode itself moved from a [Tauri 2 desktop in v1.2.0][O24] to Electron by v1.19.3. The inspected PRs and issues did not state a rationale, so do not infer one. Tauri uses [system WebViews][X3]: WebView2 (Chromium) on Windows, WKWebView on macOS and WebKitGTK on Linux. Moguri's UI will be dominated by a terminal emulator, diffs and a streaming Markdown/code timeline, so rendering and performance must be verified on each engine. Moguri's service will be TypeScript in either foundation, so Tauri would still ship that runtime as a [sidecar][X4], shrinking its size advantage. Prefer Electron for the first release unless a measured Tauri prototype meets the same UX budgets on all three engines. Keep the service in a separate process so the shell can change later, and stay within Electron's supported majors.

**Information architecture is the hard design problem.** Work items, change sets, artifacts, many agents, Queue/Steer/Interrupt, budgets, profiles, a seven-entry sidebar and a dashboard can easily become a cockpit. Sleekness comes from subtraction:

- Make the work item the primary object.
- Present sessions and agents as its execution history.
- Present artifacts as its durable outputs.

The sidebar spec shows Side chat and Browser as unavailable in the first release. That is honest, but two disabled entries out of seven read as unfinished. Consider hiding later-work entries until they exist while keeping the same contract. That is a specification decision for you, not something this report changes.

**Truthful state is part of the visual design.** Stop requested, acknowledged, completed, failed and partial; unknown versus zero cost; provisional versus settled steer metrics; service down; reconnecting; stale data. These need deliberate components and design tokens, not ad hoc toasts. This is where an agent desktop earns trust.

**Accessibility, keyboard flow and theming belong in v1.** The sidebar spec already requires keyboard navigation, focus order and status announcements. Profile accents (P04) and status colors should come from one token set shared by desktop and TUI. OpenCode keeps TUI themes in its `theme` package and desktop tokens in `ui`; `pi-gui` ships desktop theme presets. Whichever path you take, define one Moguri token set before polishing individual screens.

### Shapes worth comparing

| Shape | When it wins | Main cost |
| --- | --- | --- |
| A. OpenCode server, desktop and TUI, restyled and extended in Solid | Fastest route to a polished cross-client first release. The one-service architecture already exists. | Accept Solid. Own a fork of the UI packages. Adapt OpenCode's invariants to Moguri's. |
| B. Pi engine with a Moguri service, a React/Electron desktop derived from `pi-gui`, and a Pi-based TUI as a service client | You want Pi and React, and accept extracting runtime ownership from Electron main. | Refactor `pi-gui` into a pure client; upgrade Electron; validate Windows and Linux; build the TUI as a service client. |
| C. Pi engine with a new React desktop built from scratch | You want full design control and treat existing apps purely as references. | Largest cost: timeline, diffs, terminal, palette, updater, signing, accessibility and performance harness. |

"OpenCode UI over a Pi engine" is possible only if Moguri's protocol replaces OpenCode's client contract. You would then own a UI fork and a runtime adapter at the same time. Do not pursue it unless Phase 0 shows the UI is far less coupled to `@opencode/client` and `@opencode/schema` than its package dependencies suggest.

## 7. Criticism of the idea itself

### The strongest idea is durable work, not more agent modes

The work item/change set/artifact distinction is good. "Deleting a conversation must not delete the decision or plan" addresses a concrete failure of chat-centered tools. Reliable cross-client control and honest stopping are similarly valuable.

The weaker pitch is the enormous list of modes, integrations, memory tiers and marketplace features. It spans an agent harness, lightweight IDE, Git workbench, automation service, analytics product, local model manager, browser host and team orchestrator. **Changing the base cannot remove the cost of being all of those products.**

A useful positioning sentence is: **"Moguri makes local agent work durable, inspectable and controllable across terminal and desktop."** Every feature should earn its place against that promise.

### "Minimal upstream" does not imply minimal total complexity

Pi removes assumptions from your starting point. It also removes completed product work. A smaller dependency can result in a larger application you own.

OpenCode's broader implementation is a liability only where its assumptions conflict with your invariants or slow changes. Existing desktop diff viewers, terminals, file trees, key handling, packaging and accessible interactions are assets until shown otherwise.

Conversely, OpenCode is not a free shell: its Effect/Solid/runtime structure, evolving APIs and release packaging become part of your maintenance surface. A preference for React/Vite or another backend should be costed explicitly (section 6) rather than used to justify rewriting working clients by habit.

### Your first release is still several milestones of product work

The phase order is sensible, but "first release" includes cross-client concurrency, artifacts, budgets, profile isolation, plugin grants and local-runtime health across several platforms. That is a large release boundary.

Keep the formal acceptance checks unless you deliberately revise them. Within them, prioritize one end-to-end proof: two clients, one work item/worktree, persistent draft/queue, steer/interrupt/stop, one durable answer artifact, and traceable usage. Other sidebar entries may honestly show unavailable. Do not pull the deferred browser, side chat, swarm or model downloader into that path.

### Some security boundaries are ordered too late

Profiles and extensions arrive in Phase 5, but Phase 2 already runs processes and provider requests; Phase 3 already attaches durable knowledge.

Define the profile identifier, credential boundary, tool capability boundary and process owner in Phase 1 even if only one profile is initially exposed. Then Phase 5 adds management UX and more capabilities rather than retrofitting isolation around unscoped state. This respects the phase sequence while avoiding a costly redesign.

Pi's full-trust executable extensions are especially important here. A hook can block a model-issued tool while another extension directly accesses Node filesystem/network APIs. OpenCode's allow/ask/deny rules are useful, but they also are not a general OS sandbox. Capability restrictions need an actual process/environment boundary. [P0], [P13], [O13]

### "Everything is an event" needs a precise durability boundary

Do persist accepted commands, transitions, external-effect intent/results, usage and artifact provenance. Do not necessarily write a durable database transaction for every token paint or panel resize.

Separate committed domain events, replaceable progress snapshots and local presentation preferences. If the UI acknowledges "saved," define whether that means process-crash durability or power-loss durability. Both Pi and OpenCode expose patterns you can reuse, but the product promise is yours.

Never claim exactly-once external execution after a crash. A process may have pushed a branch, created an issue or charged a request before its result was stored. Use operation IDs, idempotent APIs where available, reconciliation and explicit uncertain outcomes.

### Append-only history and privacy need reconciliation

Your brief wants raw diagnostics, durable memory, independent artifacts and deletion. Those goals conflict unless retention and redaction are designed deliberately.

Keep secrets out before persistence. Store sensitive payloads behind governed references when possible. Decide what a purge removes from blobs, backups, search indexes and model caches, and what minimal tombstone remains. "Append-only" should not accidentally become "private content can never be erased."

### Stop buttons are the most important difficult feature

The right ambition is "if Moguri starts it, the user can see it and request a stop." The dangerous shortcut is displaying success when an abort signal was merely sent.

Distinguish model request cancellation, local tool termination, subprocess-tree cleanup, background work, external jobs, and a shared ds4 service. A cancelled waiter or disconnected client is not a stopped computation. Interrupted changes may be valid partial work and must remain inspectable.

### Be more skeptical of the dashboard

Cost and intervention visibility are valuable. Exact "tokens per steer" often describes an attribution window, not causality. A later answer may rely on earlier instructions. Tool-schema, cached-input and message breakdowns are not always independent additive buckets.

Your sidebar spec handles weighted throughput and unavailable data well. Apply that same honesty everywhere. Also reserve shared budget before concurrent requests; otherwise ten agents can each observe the same remaining balance and all spend it.

### Local agents are constrained by useful work per resource, not model count

Your working DeepSeek setup is an advantage, not a feasibility debate. But eight simultaneous personas can compete for the same KV cache, prefill time and memory bandwidth. More tool schemas and changing system prompts can reduce prefix reuse.

Start by comparing completed representative tasks, intervention count, time to green and resource contention with one versus a small bounded number of workers. Do not optimize for agent count or tokens/sec alone.

### Self-evolution, memory and autonomous product management need falsifiable claims

"Self-evolving" is attractive language for something that can also make the tool less predictable. Require an evaluation set, recorded proposals, user-controlled Core, approved versions and rollback. Never let a tool change the policies that authorize that change.

Sky/Terra/Glacier are retention categories, not evidence of useful memory. Prove retrieval improves a repeated task without leaking profiles or reviving obsolete decisions.

A Product Manager persona can gather evidence and propose work. It cannot infer business causality or create permission to instrument users merely because its prompt says "improve metrics."

## 8. Foundation decision and ownership boundary

| Criterion | Better starting point | Why |
| --- | --- | --- |
| Copilot-backed model access | Tie | Both have provider/login implementations; entitlement and API-contract caveats remain. |
| Your existing ds4/DeepSeek setup | Tie | ds4 documents both clients. |
| Ability to fork commercially | Tie | Both MIT; preserve notices and separate branding. |
| Embed a replaceable model/agent library | Pi | Explicit library/SDK layering and small application-facing integration surface. |
| Deliver both polished clients early | OpenCode | Existing desktop/TUI, service, terminals, files, diffs and packaging. |
| Sleek desktop as a pure client of one service | OpenCode | Desktop and TUI already talk to one server; desktop UX has accessibility, regression and performance suites. |
| React desktop matching your stack preference | Pi side, via `pi-gui` as a starting point or reference | React/Electron and strong desktop UX work, but runtime ownership must move out of Electron main and Electron must be upgraded. |
| Durable custom orchestration | Pi-durable is a serious candidate; no automatic winner | Strong primitives but experimental API and semantic mismatches; OpenCode development also has relevant durable machinery. |
| Existing tool permissions and worktrees | OpenCode | More product-level implementation to adapt. |
| Complete Moguri profiles, artifacts, budgets, cancellation and analytics | Neither | These must be specified, wired and proven as Moguri contracts. |
| Lowest maintenance burden | Depends on divergence | A narrow Pi dependency can be cheap; rebuilding its surrounding product is not. A deep OpenCode fork can be costly; reusing its boundaries can be cheaper. |

If Pi wins the prototype, use this ownership shape:

```text
Moguri TUI       Moguri desktop       optional VSX
        \             |              /
          Moguri commands + durable event API
                         |
        Moguri service: identity, policy, admission,
        work items, artifacts, budgets, process ownership
                         |
             one chosen execution adapter
          Pi-durable OR Pi coding-agent/agent-core
                         |
          pi-ai -> Copilot / ds4 / other providers
```

There must be **one authority for each state transition**. If Pi-durable owns the committed execution/task state, map it through the service and use compatible atomic storage operations for related domain changes; do not separately acknowledge the same message in two ledgers without a recovery protocol. If Moguri owns the execution ledger, the Pi runtime must be a worker whose messages/state can be reconstructed from that authority. The latter requires more work.

Chord is optional infrastructure, not a mandatory second framework. Do not introduce Chord, a separate event framework, two agent runtimes and two databases merely because each is individually interesting.

If OpenCode wins, keep the same domain boundary but reuse its actual server, client and UI components. Adapt the smallest set of incompatible semantics. Avoid a permanent arrangement where OpenCode and Moguri both believe they own the queue or session lifecycle.

**Fork policy:** begin with reproducibly pinned upstream source/packages and documented patches. Rename/repackage only as required. Preserve license notices, use Moguri-controlled storage/update identities, and do not point a fork's auto-updater at upstream binaries.

## 9. A bounded decision gate, not another roadmap

This is a proposed evaluation, not something executed by this report. It belongs in Phase 0 before importing a baseline or committing to a runtime. Use generated repositories, synthetic messages and no personal/customer data.

| Gate | Required evidence |
| --- | --- |
| 1. Copilot and ds4 round trip | On exact pinned candidates, authenticate interactively to Copilot with an authorized account; on ds4, stream text/reasoning, run at least two dependent tool rounds, resume, compact, and record usage. Test unavailable model, expired credential and server outage. Never log credentials. |
| 2. One service, two clients | Create from TUI, observe and control from desktop, then reverse. Disconnect one client, continue work, reconnect and reconcile before further mutation. Demonstrate that neither client writes authoritative runtime storage. |
| 3. Durable queue | Race edit/reorder/cancel against admission/claim from both clients; retry the same request ID. Crash after acceptance and before execution. Every accepted message survives once; stale edits fail explicitly. |
| 4. Exact delivery semantics | Queue waits for the current Moguri turn; Steer applies at the documented safe boundary; Interrupt records cancellation outcome before admitting replacement. Other queued messages survive unless explicitly cancelled. |
| 5. Cancellation and ownership | Stop a fixture command with descendants, a blocked tool, an MCP call, a local model request and a background child. Verify actual survivors and outcomes. An externally owned ds4 server remains running. |
| 6. Recovery and migration | Restart during a model request, tool effect and database write; upgrade stored state; inject disk-full/corrupt-state cases. Never silently repeat a destructive external effect or report false completion. |
| 7. Artifacts and profile boundary | Delete/archive a source session and retain its answer artifact. Switch profiles and verify no credential, draft, artifact, cache or context leakage. |
| 8. Accounting | Reconstruct dashboard totals from persisted records, including failed/cancelled attempts and compaction. Assert distinct cost fields, nonoverlapping steer windows and weighted throughput; unknown values remain unknown. |
| 9. Reuse and maintenance | Inventory what was reused versus replaced, number of required upstream patches, public versus internal APIs, release pinning and migration ownership. Record actual implementation effort rather than invented percentage-complete scores. |
| 10. Desktop UX baseline | On your target machines, use generated fixtures to measure each candidate desktop. Measure cold start to interactive, send to first visible token, typing latency while streaming, long-timeline scroll stability, large-diff rendering, terminal flood output and palette latency. Complete create work item, run, steer, stop, review and keep the artifact using only the keyboard. Check screen-reader labels, reduced motion, high contrast, and service-down/reconnect states. Set numeric budgets from the best measured baseline rather than inventing them. Then judge sleekness yourself on the same three flows with screenshots. |

A candidate is not preferred merely for passing a basic chat test. For the full brief, it must show that the remaining client/product work is acceptable and the hard guarantees are achievable without two sources of truth.

**Switch to Pi if:** its chosen runtime meets these contracts with a narrow maintained adapter, its experimental API risk is acceptable, custom client development is an intentional investment, and the chosen desktop path (extracted `pi-gui` or new React client) meets gate 10 as a pure service client.

**Stay with OpenCode if:** its service/UI reuse materially shortens the vertical slice, the necessary invariant changes remain localized, and you accept Solid for the desktop.

**Reject both prototype shapes if:** they depend on terminal scraping, client-owned queues, a desktop process that owns agent execution, session-bound artifacts, blind replay of external effects, ungoverned plugins, or cancellation presented as success before cleanup is known.

The resulting import/inventory should still produce the required `docs/architecture/upstream-capability-map.md`, naming the selected revision and actual reuse. This assessment is not that completed import map.

## 10. Bottom line

**Pi is a good candidate for the engine of Moguri. It is not evidence that OpenCode is the wrong base for the whole product.**

Your Copilot and local-DeepSeek requirements do not decide the choice. The decisive question is whether you want to preserve an existing multi-client product or invest in a new one around a reusable runtime. For the complete current brief, I would not throw away OpenCode's product surfaces before Pi proves the service/durability boundary. I would also not deeply fork either project before measuring the divergence.

The sleek desktop requirement pushes further toward OpenCode for the first release, unless React is non-negotiable. In that case, compare OpenCode against Pi plus a `pi-gui`-derived client only after that client has been reshaped into a pure service client. A beautiful desktop that owns the runtime would break the cross-client promise that makes Moguri distinctive.

The highest-value work is the same either way: durable work items and artifacts, reliable cross-client admission, truthful cancellation, isolated credentials and traceable accounting. Deliver that before the marketplace, swarms, CRDTs or self-evolving organization.

## Sources

Repository requirements are relative links. Implementation citations are pinned to the inspected commits; web documentation is dated by this assessment and may change. Development-branch evidence is not a promise about an installed release.

- **P0:** Pi root README/package architecture and project identity.
- **P1-P3:** Pi provider setup, Copilot OAuth implementation and provider registration.
- **P4-P8:** Pi license, coding-agent SDK, experimental durable runtime, Chord and telemetry.
- **P9-P15:** Pi model configuration, queue implementation, session format, RPC, extensions, MCP and package distribution.
- **O0-O5:** OpenCode project snapshot, server/client architecture, desktop manifest, Copilot implementation and license.
- **O6-O15:** OpenCode development event bus, inbox, recovery store, GUI extensions, draft storage, accounting, worktrees, permissions, providers and plugins.
- **O16-O24:** OpenCode desktop UI packages, Storybook, theme schema, end-to-end and performance suites, Electron window layer, relevant desktop issues and the earlier Tauri desktop manifest.
- **P16-P17:** Pi package inventory and terminal UI library.
- **Q0-Q4:** Third-party `pi-gui` snapshot, README, desktop manifest, architecture and license.
- **X1-X4:** Electron support policy and latest release; Tauri WebView engines and sidecar packaging.
- **PR / OR:** Release metadata and trees used to avoid conflating development branches with shipped packages.
- **D0-D2:** ds4 README, explicit client configurations and server protocol/runtime guidance.
- **G1-G2:** GitHub plan/entitlement documentation and official Copilot SDK architecture.

[B]: ../../0-implementation-draft-unslopped.md
[E]: ../../0-implementation-draft.md
[I]: ../../README.md
[S]: ../specs/desktop-sidebar.md
[A]: ../../AGENTS.md
[P0]: https://github.com/earendil-works/pi/blob/c268154ca1171c2f9eefe75d3d7372a68aada2d5/README.md
[P1]: https://github.com/earendil-works/pi/blob/c268154ca1171c2f9eefe75d3d7372a68aada2d5/packages/coding-agent/docs/providers.md
[P2]: https://github.com/earendil-works/pi/blob/c268154ca1171c2f9eefe75d3d7372a68aada2d5/packages/ai/src/auth/oauth/github-copilot.ts
[P3]: https://github.com/earendil-works/pi/blob/c268154ca1171c2f9eefe75d3d7372a68aada2d5/packages/ai/src/providers/github-copilot.ts
[P4]: https://github.com/earendil-works/pi/blob/c268154ca1171c2f9eefe75d3d7372a68aada2d5/LICENSE
[P5]: https://github.com/earendil-works/pi/blob/c268154ca1171c2f9eefe75d3d7372a68aada2d5/packages/coding-agent/docs/sdk.md
[P6]: https://github.com/earendil-works/pi/blob/c268154ca1171c2f9eefe75d3d7372a68aada2d5/packages/durable/README.md
[P6R]: https://github.com/earendil-works/pi/blob/71023aec1546d6d677a65669c5665c0927ce0dd0/packages/durable/README.md
[P7]: https://github.com/earendil-works/pi/blob/c268154ca1171c2f9eefe75d3d7372a68aada2d5/packages/chord/README.md
[P8]: https://github.com/earendil-works/pi/blob/c268154ca1171c2f9eefe75d3d7372a68aada2d5/packages/telemetry/README.md
[P9]: https://github.com/earendil-works/pi/blob/c268154ca1171c2f9eefe75d3d7372a68aada2d5/packages/coding-agent/docs/models-configuration.md
[P10]: https://github.com/earendil-works/pi/blob/c268154ca1171c2f9eefe75d3d7372a68aada2d5/packages/coding-agent/src/core/agent-session.ts#L2203-L2294
[P11]: https://github.com/earendil-works/pi/blob/c268154ca1171c2f9eefe75d3d7372a68aada2d5/packages/coding-agent/docs/session-format.md
[P12]: https://github.com/earendil-works/pi/blob/c268154ca1171c2f9eefe75d3d7372a68aada2d5/packages/coding-agent/docs/rpc.md
[P13]: https://github.com/earendil-works/pi/blob/c268154ca1171c2f9eefe75d3d7372a68aada2d5/packages/coding-agent/docs/extensions.md
[P14]: https://github.com/earendil-works/pi/blob/c268154ca1171c2f9eefe75d3d7372a68aada2d5/packages/coding-agent/docs/mcp.md
[P15]: https://github.com/earendil-works/pi/blob/c268154ca1171c2f9eefe75d3d7372a68aada2d5/packages/coding-agent/docs/packages.md
[P16]: https://github.com/earendil-works/pi/tree/c268154ca1171c2f9eefe75d3d7372a68aada2d5/packages
[P17]: https://github.com/earendil-works/pi/blob/c268154ca1171c2f9eefe75d3d7372a68aada2d5/packages/tui/README.md
[PR]: https://github.com/earendil-works/pi/releases/tag/v1.3.0
[O0]: https://github.com/anomalyco/opencode/tree/8c173a8f3805d8e749d44311054b07e37a1b2ce1
[O1]: https://opencode.ai/docs/server/
[O2]: https://github.com/anomalyco/opencode/blob/8c173a8f3805d8e749d44311054b07e37a1b2ce1/packages/client/README.md
[O3]: https://github.com/anomalyco/opencode/blob/8c173a8f3805d8e749d44311054b07e37a1b2ce1/packages/desktop/package.json
[O3R]: https://github.com/anomalyco/opencode/blob/e3c4eb242585dcd77be1a867391b7c25fd47ce52/packages/desktop/package.json
[O4]: https://github.com/anomalyco/opencode/blob/8c173a8f3805d8e749d44311054b07e37a1b2ce1/packages/core/src/plugin/provider/github-copilot.ts
[O5]: https://github.com/anomalyco/opencode/blob/8c173a8f3805d8e749d44311054b07e37a1b2ce1/LICENSE
[O6]: https://github.com/anomalyco/opencode/blob/8c173a8f3805d8e749d44311054b07e37a1b2ce1/packages/core/src/bus.ts
[O7]: https://github.com/anomalyco/opencode/blob/8c173a8f3805d8e749d44311054b07e37a1b2ce1/packages/core/src/session/inbox.ts
[O8]: https://github.com/anomalyco/opencode/blob/8c173a8f3805d8e749d44311054b07e37a1b2ce1/packages/core/src/session/store.ts
[O9]: https://github.com/anomalyco/opencode/blob/8c173a8f3805d8e749d44311054b07e37a1b2ce1/packages/gui-extensions/README.md
[O10]: https://github.com/anomalyco/opencode/blob/8c173a8f3805d8e749d44311054b07e37a1b2ce1/packages/app/src/runtime/persistence/drafts.ts
[O11]: https://github.com/anomalyco/opencode/blob/8c173a8f3805d8e749d44311054b07e37a1b2ce1/packages/core/src/session/usage.ts
[O12]: https://github.com/anomalyco/opencode/blob/8c173a8f3805d8e749d44311054b07e37a1b2ce1/packages/core/src/worktree.ts
[O13]: https://opencode.ai/docs/permissions/
[O14]: https://opencode.ai/docs/providers/
[O15]: https://opencode.ai/docs/plugins/
[O16]: https://github.com/anomalyco/opencode/blob/8c173a8f3805d8e749d44311054b07e37a1b2ce1/packages/app/package.json
[O17]: https://github.com/anomalyco/opencode/blob/8c173a8f3805d8e749d44311054b07e37a1b2ce1/packages/ui/package.json
[O18]: https://github.com/anomalyco/opencode/blob/8c173a8f3805d8e749d44311054b07e37a1b2ce1/packages/storybook/package.json
[O19]: https://github.com/anomalyco/opencode/blob/8c173a8f3805d8e749d44311054b07e37a1b2ce1/packages/ui/src/theme/desktop-theme.schema.json
[O20]: https://github.com/anomalyco/opencode/tree/8c173a8f3805d8e749d44311054b07e37a1b2ce1/packages/app/e2e
[O21]: https://github.com/anomalyco/opencode/tree/8c173a8f3805d8e749d44311054b07e37a1b2ce1/packages/desktop/src/main/windows
[O22]: https://github.com/anomalyco/opencode/issues/35890
[O23]: https://github.com/anomalyco/opencode/issues/37495
[O24]: https://github.com/anomalyco/opencode/blob/ffc000de8e446c63d41a2e352d119d9ff43530d0/packages/desktop/package.json
[OR]: https://github.com/anomalyco/opencode/releases/tag/v1.19.3
[Q0]: https://github.com/minghinmatthewlam/pi-gui/tree/572c0c6de8ffd3a245c224b912bb8752ca200780
[Q1]: https://github.com/minghinmatthewlam/pi-gui/blob/572c0c6de8ffd3a245c224b912bb8752ca200780/README.md
[Q2]: https://github.com/minghinmatthewlam/pi-gui/blob/572c0c6de8ffd3a245c224b912bb8752ca200780/apps/desktop/package.json
[Q3]: https://github.com/minghinmatthewlam/pi-gui/blob/572c0c6de8ffd3a245c224b912bb8752ca200780/docs/architecture.md
[Q4]: https://github.com/minghinmatthewlam/pi-gui/blob/572c0c6de8ffd3a245c224b912bb8752ca200780/LICENSE
[X1]: https://www.electronjs.org/docs/latest/tutorial/electron-timelines
[X2]: https://github.com/electron/electron/releases/tag/v44.9.0
[X3]: https://v2.tauri.app/reference/webview-versions/
[X4]: https://v2.tauri.app/develop/sidecar/
[D0]: https://github.com/antirez/ds4/blob/fc80bd695da76ee14bcb86820bf900a5cdfda806/README.md
[D1]: https://github.com/antirez/ds4/blob/fc80bd695da76ee14bcb86820bf900a5cdfda806/docs/CLIENTS.md
[D2]: https://github.com/antirez/ds4/blob/fc80bd695da76ee14bcb86820bf900a5cdfda806/docs/SERVER.md
[G1]: https://docs.github.com/en/copilot/get-started/plans
[G2]: https://github.com/github/copilot-sdk
