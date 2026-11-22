# Moguri architecture decisions

**Decided 2026-10-17 by the project owner. Status: accepted, pending the Phase 0 validation spikes below.**

**Initial executable checkpoint, 2026-10-18.** The [Phase 0 results](phase-zero.md)
authorize a deliberately smaller development checkpoint: macOS Local execution,
fixed GitHub Copilot models, Manual approvals, and Unlimited budget through both
clients. This is not completion of the first milestone. Unsupported environments,
routing, delegation, attachment types and finite budgets were initially
unavailable. Later qualified slices below do not silently approximate guarantees
or fall back to Local. External-service and
release-packaging failures remain release blockers.

The [D14 SDK platform slice](#d14-one-importable-sdk-and-user-controlled-capability-platform)
also supports explicit exact tool/command grants, Guided human confirmation
and bounded Autopilot, while Manual remains the factory default. It does not
enable Autopilot Max, qualified SendBox or Remote execution.

These decisions define the implementation stack and constraints for the [implementation specification][B]. Moguri is built from zero and does not fork OpenCode or Pi. The [README][I] and [`AGENTS.md`][A] follow these decisions.

## Summary

| ID | Decision | Revisit if |
| --- | --- | --- |
| D01 | Build from zero and borrow libraries for commodity parts. | Phase 0 shows the event model or either client is not feasible within the project constraints. |
| D02 | Node.js 26 runs the service and the TUI. | OpenTUI drops Node support, or native modules cannot be packaged reliably. |
| D03 | The desktop app uses Electron, React and Vite. | Measured memory or startup budgets still fail after optimization. |
| D04 | The TUI uses OpenTUI with React. | OpenTUI churn or Node incompatibility blocks the TUI. Fall back to Ink. |
| D05 | Moguri owns a thin agent loop and uses `pi-ai` for providers and authentication. | `pi-ai` stops supporting a required provider, or its API churn costs more than an own adapter. |
| D06 | Rust helpers handle process control, PTYs, file search and Git reads. | A spike shows Node equivalents meet the budgets with less complexity. |
| D07 | The local client API is HTTP on loopback plus WebSocket events, protected by a token; Remote workers use a separate scoped SSH channel. | Non-SSH network clients require a different authenticated transport. |
| D08 | macOS ships first, Linux next, Windows later. | Windows users become a priority. |
| D09 | The VS Code and `vslocal` extension follows a stable TUI and desktop protocol. | The protocol stays unstable after the first release. |
| D10 | Env defaults to Local; Sandbox uses native SendBox. User-only allowed-env policy may permit only Sandbox or Remote for new turns. | Phase 0 cannot prove the worker boundary, transport, or required containment on a supported host. |
| D11 | Users choose a fixed model or `kupo`, a synthetic router/orchestrator spanning approved local and hosted models with single, cascade, and critique/revision workflows. | Evaluation cannot meet the chosen quality, cost, latency, or isolation budgets. |
| D12 | Autonomy level defaults to Manual. Guided, Autopilot, and System One-backed Autopilot Max (shown as Autonomous and Autopilot since D60) are independent of model, Env, and Budget; Jev is an optional decision adapter. | A decision provider cannot satisfy the typed contract, privacy requirements, or evaluated decision thresholds. |
| D13 | Remote SSH runs the agent task and model calls on a user-configured reachable machine; the local control plane retains durable authority. | Phase 0 cannot prove secure transport, remote model access, cancellation, and reconnect recovery. |
| D14 | One importable SDK powers both clients, default-dark branding and user-controlled memory, extensions, MCP and local dictation. | SDK packaging, policy, recovery or physical runtime qualification fails. |
| D15 | Verified dependency archives and local project Kanban extend the SDK, with read-only linked-PR observation and optional Linear imports. | Integrity/advisory admission, lifecycle isolation, branch/restart safety or integration revocation fails. |
| D16 | Ghostty embeds the desktop terminal; shared held queues, read-only/side sessions and retained project artifacts extend the same SDK/event authority. | Native input/resize/cancellation, retention-key migration, multi-client policy or packaged-client acceptance fails. |
| D17 | Compact icon controls expose shared working-context/thinking settings, estimated context preview and provenance-safe usage, with the original red-pom-pom mascot. | Supported transport options, bounded request sizing, migration/restart or compact native-popover behavior fails. |
| D18 | Project-free chats, explicit MCP OAuth, scoped suggestions/reviewed metachat and shared attention extend the same SDK authority. | Scope isolation, issuer/resource binding, exact configuration review, cancellation, migration or private notification delivery fails. |
| D19 | Configured local models, snapshotted startup defaults and typed reviewed context extend the shared runtime. | Provider identity, resource-bound credentials, source consent or migration/recovery fails. |
| D20 | Core SSH execution uses a pinned owned worker bridge and durable late receipts without replay. | Host/build/root verification, actual remote inference or truthful loss/cancellation accounting fails. |
| D21 | Managed Local worktrees use explicit owned roots and per-root writer leases across every SDK/client filesystem surface. | Safe Git creation/removal, root consistency, concurrency or restart reconciliation fails. |
| D22 | Typed text artifacts have independent encryption/revisions and exact source provenance; project removal binds an explicit reviewed retention choice. | Legacy rekeying, source-actor separation, deletion isolation or persistent client export fails. |
| D23 | Structured clarifications record actual owning-turn answers; optional retained artifacts and saved-draft consumption are one transaction, never permissions. | Actor/turn/revision isolation, cancellation, atomic retention or cross-client answer/queue behavior fails. |
| D24 | Artifact repository copies bind exact source/root/policy and optional new local commit intent; deleting stored grants requires real copy/commit verification. | Copy persistence, no-overwrite/index isolation, cancellation/recovery or deletion proof fails. |
| D25 | Every owned model dispatch has an atomic profile-owned reservation. Finite limits require explicit estimates; unknown completion holds capacity and settings resets cannot lift policy. | Concurrent/late/restart accounting, actual output forwarding, unknown-price handling or role/source retention fails. |
| D26 | Immutable profile views share one root event authority. Credentials/data stay scoped; global environment policy, startup values and budgets remain root-owned across client switching. | Default migration, cross-client isolation, atomic policy/cap races, resource ownership or external SDK/native preview qualification fails. |
| D27 | Reviewed platform workflows add independent tiered knowledge, bounded lifecycle hooks, repository-backed catalogs, explicit Git/GitHub/Linear writes and scoped ecosystem caches; whole-descendant guarantees require qualified SendBox. | Exact review, privacy, compatibility, root leases, command/no-replay, migration/recovery, native VM teardown or packed-client qualification fails. |
| D28 | Plan checklist completion is periodically observed; long-task owning-model estimates stay separate, untrusted advice without hidden inference. | Plan/root ownership, stale reports, cancellation, recovery or cross-client comparison fails. |
| D29 | Document attachments reuse scoped encrypted snapshots and bounded inspection; PDF.js and streamed ZIP/strict XML parse in restricted resource-bounded processes. | Parser content/resource qualification, grant retention, provenance, worker transport or browser-safe packed SDK checks fail. |
| D30 | Lazy typed discovery and compact recoverable views reuse the owned worker; deterministic utilities, structured authoring/SQL and root-bound parent/child coordination extend the same SDK/policy/budget authority. | Required evidence becomes unreachable, actual actor/root/cap ownership fails, or representative task-quality evaluation regresses. |
| D31 | Profile-owned retained-request backoff, one-time scheduled input and evidence-qualified Kupo modes share the existing SDK/worker/ledger; smart compaction is on by default (revised 2026-11-17, below) and all-role finite holds retain exact owners. | Deadline/order, source/account identity, cancellation/restart, model/effort/context evidence, packed-client or exact native-byte qualification fails. |
| D32 | Model-free native schedule preparation uses the existing managed capture; bounded decision/metadata-finishing roles remain on the exact SSH/native parent with separate private-role release, all-role holds and terminal no-replay. | Source/policy/draft scope, actual transport/cancellation, atomic failed/late receipts, client/packed SDK or exact native-byte qualification fails. |
| D34 | Actual session identities/dependencies/bulk controls, explicit voice lifecycle, native JS/TS semantics, isolated HTML and owned Local Playwright outputs reuse the service/SDK/event authority. | Exact task/account/root identity, atomic migration/cleanup, real capture/interaction/output, isolation or packed-consumer qualification fails. |
| D35 | A configured profile-owned My Work GitHub inbox reuses source-bound native reads, retained CI watches, capability jobs and attention; explicit refresh needs no scheduler. | Account/root/head isolation, actual review/thread parsing, complete pagination, truthful partial/restart behavior or shared client/packed SDK qualification fails. |
| D36 | Claude Agent runs the user's own installed, unmodified Claude Code as an off-by-default external harness, with every tool call approved by Moguri and the user's own sign-in. | Anthropic's terms change, Claude Code's control protocol stops routing every tool call to the host, or truthful stop/process cleanup fails. |
| D38 | Milestone regression runs a checked-in covering array (pairwise plus env x selection tuples), an exact manual-Kupo-effort refusal set and the focused contract tests; the 10,080-cell full product is opt-in. | A defect is found only by an untested axis interaction, a newly dependent axis appears, or a release needs the full product. |
| D39 | Optional Stainless runs as a Moguri-owned headless instance with a disposable profile through the owned Playwright tool, plus a Local open-with handoff; detection reads Info.plist only. | Stainless ships its policy-enforcing MCP (#80), disables Chromium automation switches, or a tested build fails `spike:stainless`. |
| D40 | OWASP AST follow-up: deterministic source indicators gate model-approved scripts (user may accept the risk) and refuse hidden-character trusted-folder loads; per-profile saved publisher keys and permanent key/version blocks. Transparency log/PKI, Local whole-descendant isolation, malware scanning and live-model testing are signed-off exclusions. | A qualified transparency log, scanner or isolation boundary is reviewed, or findings show the rules are too noisy or too weak. |
| D41 | OTLP gains opt-in fixed-template logs correlated with spans, finite failure outcomes, correction logs instead of duplicate spans and secret-backend credential headers bound to the collector origin; peers and guests stay uninstrumented. | In-peer/guest propagation is qualified, or a collector needs a header/transport this contract refuses. |
| D42 | Remote (SSH) sessions load skills under the same admission rules as Local; the first use copies the complete admitted package into a digest-named Moguri folder on the SSH host, re-verified before every command that runs from it, and bundled scripts run through normal command approval. | A skill needs binary payloads, Remote reviewed-script execution is qualified, or SSH hosts need a cache-retention policy. |
| D43 | A user steer moves a running model `run_command` to the background: the agent is told at once, the steer applies, and the final result arrives as a notice; the turn waits for it before ending and Stop still kills it. | Commands need to outlive their turn, or a qualified Sandbox image changes the worker transport. |
| D44 | Archiving or deleting a running session, in any client or in bulk, and removing a project with one always warn and need explicit confirmation; "don't ask again" preferences never skip it and the service refuses without `confirmRunning`. | A running session can be archived without stopping its work. |
| D45 | The Code Change view offers Address code review, Fix merge conflicts and Fix CI for a linked PR, enabled from a fresh unretained read of reviews, merge state, checks and the checkout branch; a click queues the matching workflow preset in this chat under normal approvals. | Thread resolution or review data needs GraphQL, or Remote sessions qualify their own GitHub reads. |

D35's [My Work contract](my-work.md) records the existing MIT/GPL library reuse,
protocol95's additive source/refresh marker, original no-replay ownership and
measured Phase 0 prerequisites. It preserves the session/telemetry dashboard
and normal permission/Env boundaries, without adding a GitHub client or claiming
hosted account/CI eligibility or changed physical native payload qualification.

D28's [task progress contract](task-progress.md) records generated checklist and
hidden-client qualification. D29's [document contract](document-attachments.md)
records parser licenses, limits and measured Phase 0 results before integration.
Neither decision expands unrelated roadmap, model authority or unqualified
execution transports.

D31's [recovery/scheduling/Kupo contract](recovery-scheduling-kupo.md) begins at
genuine merged83 `023fa014`, adds three independent protocol84 markers atomically
and preserves all combined80/81/82/83 ciphertext, source reviews and receipts.
The user chose current-profile recovery, oldest currently failed prompt order,
reset only on a complete metered recovered response, unchanged manual-retry
countdowns, overdue one-time scheduled admission and explicitly enabled
automatic text compaction. None is a permission or source-acceptance grant.

**D31 revision, 2026-11-17: smart compaction is the default.** The owner asked
for default smart compaction ([#55](https://github.com/mbianchidev/moguri/issues/55)),
replacing "compaction is explicit opt-in". Automatic text compaction now starts
on for every profile: fixed-model chats summarize older complete turns with
their own model, and Kupo inherits the shared setting unless its reviewed policy
says otherwise. The trigger is the smallest of 75% of the working window, an
eighth of the window before admission headroom, and 200,000 tokens, following
the [Shelley](https://shelley.dev/) observation that long frontier sessions
work best when compacted near 200k. Every call stays a separately metered
compaction role under budgets and cancellation; unknown usage is held, not zero;
images and recent turns are never compacted; history is never truncated and
original events stay restorable. The factory default is recorded as
`default-policy`, distinct from a saved `user-policy`. Settings / Context
compaction or `compaction.automatic: false` turns it off. Details are in
[context compaction](context-compaction.md#smart-compaction-default).
Model/authorization/root changes and unknown effects remain authoritative.

The supplied [HyDRA v1](https://arxiv.org/html/2605.17106v1) informs separation of
requirements, benchmark profiles and pricing, not a claim of provided weights,
calibrated quality, Cascade/Critique specification or a qualified System One
adapter. New modes select actual supported effort and maximum context; budgeted
or alias-clamped High cannot become Performance. Finite automatic Local response
sets use the existing `planBatch`/exact transfer plus reserved checkpoint, with
distinct `routing` plan purpose and no refund of consumed/unknown work.
The cache API is unchanged; its patched closure and exact third-party notices
are built into distributed Node runtimes so packed consumers do not inherit
development-root overrides. Current worker/native bytes still need their own
physical receipt. Missing Jev output bounds, Remote/native wind-down and other
real gates were not qualified by protocol84.

D32's [owned model transport contract](owned-model-transports.md) extends
genuine84 with separate `scheduled_native_preparation_schema`,
`owned_model_transport_schema` and `transport_finishing_schema` markers in one
atomic85 migration. It retains the original `d6aeae4` installer/receipt identity,
not a relabeled Local model or previous guest qualification. A tool-less role
inside a rooted parent is not a rootless OS process. Raw late data/accounting
may improve one originally admitted step without changing terminal work,
cleanup, delegation or source acceptance. Jev remains upstream-unqualified.

D32's [snapshot retry/checkpoint continuation](native-retry-checkpoints.md)
adds protocol86's independent `native_retry_restaging_schema` and
`transport_checkpoint_schema` markers. The actual user permits restaging only
the complete byte-verified original private snapshot under an explicit off-by-
default retry policy, never a changed live-source capture or substituted owner.
The user separately chose new-branch Git publication at the original Local
repository after native-source acceptance; current Local and Sandbox policy
both apply. Remote accepted-work Git stays on its pinned SSH peer/root.
Separate source acceptance, Git review and partial-effect inspection never turn
metadata into acceptance, replay work, clear unknown charges or relabel a
partial job as completed.

The owner-requested [shared themes and TUI follow-up](themes-and-tui.md) retains
OpenTUI/React and the existing profile settings/event authority. Protocol 78 adds
one independent theme-catalogue marker, not a second preference store or the
separately reserved protocol-77 model-continuity migration. Its original JRPG
presentation and actual mouse navigation do not copy franchise assets, create a
GitHub inbox or qualify changed native worker/bridge payloads by version alone.

The [protocol-81 session/Git follow-up](session-reliability.md#explicit-selection-and-retained-request-follow-up)
preserves the actually combined80 lineage and this stack. Explicit autonomy
selection, original-result identities and command receipts share the existing
authority; finite [native Git tools](github-workflows.md#git-operations) reuse
the reviewed CLI/root/job lifecycle, not another Git engine. No dependency or
client queue is added. Both new migration markers are transactional, and changed
worker/bridge bytes require fresh qualification rather than inherited receipts.

The [protocol-82 command/tool preference follow-up](command-tool-preferences.md)
adds original workflow presets, atomic assigned children and a profile-owned
ranked method preference. Exact discovered MCP leaves may expose their own
typed model schemas while retaining gateway execution/account/root approvals.
The existing worker, queue, coordination, SDK and stack remain authoritative;
no dependency, new scheduler, global subagent opt-in or credential bypass is
introduced. Its two distinct migration markers are atomic and preserve genuine
81 and combined80 history. Changed worker/native bytes need a fresh receipt.

D30's [lean tooling and coordination contract](lean-tooling.md) records
prerequisite measurements, independent implementation, reused MIT libraries,
strict schema-58 lineage convergence and qualified/unsupported boundaries. Typed native
schemas won the generated interface comparison over a generic untyped gateway;
that comparison is not live token/cache/quality evidence. Node supervises
existing `rg`/`jq` and isolated data workers under the D06 checkpoint allowance.
No new Rust helper, agent framework, silent compaction or permission-bearing
model/router advice is introduced.

The [protocol-59 workspace experience](workspace-experience.md) retains this stack
while adding refreshed profile-owned skill discovery through the shared SDK/MCP
gateway, explicit global suggestion previews, and four event/accounting-backed
dashboard pages. Its measured prerequisite results, additive migration and
unqualified execution boundaries are recorded in that contract.
The protocol-60 session-navigation follow-up keeps the same stack and owner
lifecycle, removes Global Terminal surfaces and the session grip, and adds
revision-bound child-detachment review with a profile-owned opt-out.

The owner-requested [project Kanban/pricing follow-up](project-kanban.md)
reuses those primitives for a project board chat, one explicitly delegated
Local item through its draft PR, native project context menus/reordering and
originating-provider API-equivalent estimates. It adds no agent framework,
scheduler, credential forwarding or inferred billed costs. The contract
records prerequisite measurements, cancellation/no-replay boundaries and the
separate actual-user consent required for finite USD reference-rate admission.
Protocol 63 explicitly converges its earlier schema-61/62 state with the
automatic-Kupo schema-61 lineage without rewriting consent, selected responses
or accounting. Project context menus retain Kupo-era rainbow/custom colors
alongside Kanban visibility and drag ordering.

## D01. Build from zero with borrowed libraries

**Decision.** Moguri owns its domain model, event store, protocol, local service and clients. It does not fork OpenCode or Pi. Maintained libraries supply providers, MCP, PTYs, terminal rendering, diffs, SQLite and UI toolkits.

**Why.** The durable event model, truthful cancellation and one protocol shared by every client are the reasons Moguri exists. Moguri owns those product-specific foundations and borrows libraries for commodity capabilities.

**Consequences.**

- A from-zero harness starts behind mature harnesses on agent quality. A golden-task evaluation suite starts in Phase 1.
- Phase 0 validates the chosen libraries, toolchains, and packaging before feature work.

## D02. Node.js runtime

**Decision.** The service, session worker, and TUI run on Node.js 26, not Bun.

**Why.**

- Electron is built on Node.js, so one runtime model covers the service, TUI and desktop app.
- Node-API addons, including those built with napi-rs, keep a stable ABI across Node.js versions. [R1]
- OpenTUI runs on Node.js 26.4 or later. [L1]

**Consequences.**

- Node.js 24 LTS is too old for OpenTUI. Node.js 26 is the Current line on the decision date and is scheduled to enter LTS on 2026-10-28. [N1]
- Moguri ships its own pinned Node.js runtime rather than depending on the user's installation.
- The macOS app also ships an `exec`-based [CLI/TUI launcher](cli-launcher.md).
  Installing or removing the user-local command is explicit; copying the app
  does not run the TUI or edit PATH.
- CPU-heavy work must not block the event loop. Use worker threads or the Rust helpers in D06.

## D03. Electron, React and Vite desktop

**Decision.** The desktop app uses Electron with a React and Vite renderer.

**Why.** Chromium renders the same on macOS and Linux. React matches the project's frontend preference, and React views can be reused in VS Code webviews. Electron needs no second language runtime.

**Rules.**

- The renderer talks to the service protocol. A minimal preload bridge exposes only the operating-system features the renderer needs. Context isolation stays on and Node integration stays off in the renderer. This also keeps the renderer portable if D03 is revisited.
- Electron's main process never runs the agent loop or owns durable state.
- Stay on a supported Electron major. Electron supports the latest three stable majors. [X1]
- Electron's real costs are memory and startup time. Phase 0 sets budgets for both and measures them in benchmark runs.

## D04. OpenTUI with React

**Decision.** The TUI uses OpenTUI's React renderer.

**Why.** The TUI and desktop app share the protocol, the client SDK and renderer-agnostic React state hooks. Components are not shared, because the terminal and DOM renderers differ.

**Consequences.**

- OpenTUI is pre-1.0. Pin its version and expect API changes.
- OpenTUI on Node requires Node.js 26.4 or later (D02). [L1]
- Ink is the fallback. It keeps the shared React hooks.

## D05. Moguri-owned agent loop, `pi-ai` providers

**Decision.** Moguri writes its own agent loop: step scheduling, tool dispatch, steer points, compaction triggers, budget checks and cancellation. `pi-ai` supplies provider adapters, GitHub Copilot sign-in and OpenAI-compatible endpoints such as `ds4-server`. The maintained npm package is now `@earendil-works/pi-ai`; the deprecated `@mariozechner/pi-ai` package is not used. Moguri does not use `pi-agent-core`. [P1]

**Why.** Queue, Steer and Interrupt, hard budget stops before each model request, per-step events and cancellation all depend on step boundaries that Moguri controls.

**Consequences.**

- Wrap `pi-ai` behind a Moguri provider interface. Pin its version and keep raw provider data for debugging.
- The loop runs in a session worker on the D10 execution backend. Sandboxed sessions do not run the loop or executable agent tools in the host control-plane process.
- Pi's MIT-licensed tool implementations may be reused where they fit, with their license notices kept.
- Check GitHub's current terms before advertising Copilot sign-in.
- Reuse this loop for every kupo solver leg. D11 adds orchestration, not a second session runtime; D12 adds a separate decision-provider interface for non-chat APIs.

## D06. Rust helpers

**Decision.** Rust handles operating-system and CPU-heavy work. TypeScript handles everything else.

| Helper | Form | Libraries | Responsibility |
| --- | --- | --- | --- |
| `moguri-supervisor` | Separate process | `process-wrap`, `portable-pty` [R2], [R3] | Start commands and PTYs in their own process groups or sessions, stream output, stop process trees and report exactly what survived. |
| `@moguri/native` | Node-API addon built with napi-rs [R1] | ripgrep's `ignore` and `grep` crates, `gix` [R4], [R5] | Search files while respecting ignore rules. Read Git status, diffs, history and blame. |

**Why.**

- Process ownership and cancellation are the riskiest first-release subsystem, and the most operating-system-specific. `process-wrap` supports process groups and sessions on Unix and Job Objects on Windows, which lowers the cost of later Windows support. [R2]
- File search and Git reads are CPU-bound and would otherwise block the Node.js event loop.
- Rust is proven for agent harnesses. OpenAI's Codex CLI is written mainly in Rust. [R6]

**Rules.**

- Git writes go through the user's `git` CLI: worktree creation and removal, commits, push, merge, rebase and branch deletion. This keeps hooks, credentials, signing and Git configuration working as the user expects. `gix` does not yet support push or checkout orchestration. [R4]
- The supervisor executes and reports. The Node.js service records every durable event and remains the only state owner.
- A supervisor crash must not crash the service. Phase 0 decides whether supervised processes survive a service restart and how the service reattaches to them. Either way, survivors are reported.
- Keep a Cargo workspace beside the JavaScript workspace. Ship prebuilt binaries for each target and sign them with the app.
- SendBox workloads need Linux builds of the worker's native addon and supervisor. Local helpers may supervise SendBox/SSH and serve trusted UI queries, but cannot execute Sandbox or Remote agent tool requests locally.
- Move more work into Rust only when a measured budget fails.

**Initial-checkpoint exception.** Rust could not be validated on the available
host. The bounded Node filesystem/Git baseline and `node-pty` process-group
cancellation passed the recorded macOS budgets. The development checkpoint uses
a separate Node worker, `node-pty`, and explicit process-group escalation instead
of claiming that unbuilt Rust helpers work. Workers stop owned commands on parent
disconnect. A service restart marks interrupted work partial and does not replay
effects or assume that cleanup succeeded. Large-repository native search,
Linux supervision and the Rust implementation
remain unvalidated. Revisit this exception before release.
Because process groups do not contain arbitrarily detached descendants, shell
cancellation/deadlines remain partial and pause admission even after the known
group exits. Do not treat the measured nested-process fixture as proof of
complete containment or enable background execution.

The later [user-terminal reattachment prerequisite](terminal-reattachment-primitives.md)
qualifies a separate generated Node/Node-PTY broker on macOS: a controller
SIGKILL preserves one actual PTY, with authenticated scope-bound reconnect,
bounded volatile output and no relaunch/input replay. Protocol 23 integrates
[restart-reattachable user consoles](terminal-reattachment.md), with one
authenticated owner per profile, durable intent and explicit private cleanup.
Source/native, exact packed SDK and actual packaged memory/lifecycle acceptance
remain separate gates recorded in setup. This is for explicitly opened user
terminals and intentional service restart, not general model/agent background
execution, Linux/Rust acceptance or complete descendant containment.

**Reviewed PTY maintenance exception, 2026-11-12.** The first full native
acceptance run exposed the macOS allocator leak in stable `node-pty`1.1.0.
Its completed children retained an extra `/dev/ptmx` handle until process exit,
eventually reaching the unchanged host limit of511. A bounded generated probe
failed after20 exits with21 handles versus its one-handle baseline; the newer
available Node26.13 runtime also reproduced it. The user explicitly approved
pinning maintained MIT `node-pty`1.2.0-beta.18, whose macOS spawn implementation
closes the reserved low descriptors and parent slave on its cleanup path.
The exact npm SHA-512 is retained in the lock. The installed release passes
600 sequential real exits with no allocator growth in4,063.1455ms. This is a
deliberate beta dependency, not a claim that a stable patched release exists.
No host limit, service, network or raw descriptor-closing workaround changed.
Node, Electron, packed consumers and the rebuilt Linux guest remain separate
qualification gates; old passing package/image receipts cannot qualify it.

## D07. Local API transport

**Decision.** The service listens on loopback. Commands use HTTP. Events stream over WebSocket with sequence numbers, so clients can replay missed events after reconnecting.

**Why.** The TUI, the desktop app and VS Code extension hosts all speak HTTP and WebSocket natively, and standard tools can inspect the traffic.

**Security rules.** Loopback does not protect against other local processes or against web pages in a browser.

- Bind only to loopback addresses, on a random port.
- On start, write a connection file containing the port, protocol version and a random token to the user's Moguri state directory. Only the user can read it.
- Require the token on every HTTP request and WebSocket connection. Browser WebSocket clients cannot set headers, so send the token in the first message or a subprotocol, never in a URL. Never log it.
- Reject requests whose `Host` header is not a loopback address, which blocks DNS rebinding. Reject `Origin` values other than Moguri's own clients. Do not enable CORS.
- D13 Remote workers use an authenticated, run-scoped channel inside verified SSH, not unrestricted access to the local API or its token. Public network clients and managed hosted control planes remain out of scope.

## D08. Platforms

**Decision.** macOS ships first, signed and notarized. Linux follows. Windows is deferred.

**Consequences.** Avoid Unix-only assumptions where they are cheap to avoid, because the D06 Rust libraries already support Windows. The first release has no Windows acceptance checks.

## D09. VS Code and `vslocal` extension

**Decision.** Build the extension after the TUI and desktop app share a stable protocol. It is a thin client: commands, a webview reusing desktop React views, native diff views and terminal bridging.

**Rules.**

- Negotiate the protocol version on connect. The extension updates on a different schedule from the desktop app.
- Declare the extension as a UI extension (`extensionKind: ["ui"]`), so it runs beside the local Moguri service. It may select the same D13 Remote env through that service; this does not automatically integrate every VS Code remote/container workspace or create a second control plane.
- Publish to Open VSX for `vslocal` and to the Visual Studio Marketplace for VS Code.

## D10. Native SendBox execution and global enforcement

**Decision.** The setting is **Execution environment**, shortened to **Env**, with Local (default), Sandbox (native SendBox), and Remote (D13 SSH). Global user-only allowed-env policy initially permits all three, subject to readiness. It may restrict execution to Sandbox or Remote, accepting the approved SSH machine without requiring SendBox there. A Sandbox-only restriction remains possible. No profile, repo/project preference, autonomy level, model, plugin, or automation may widen the allowed set.

**Policy changes.** Only explicit user action may change global enforcement. Excluding Local lets already-running Local turns finish under their recorded prior env policy, but blocks new Local turn admission immediately, including queued, child-agent, and restarted work. Persist the policy revision and eligible running turns atomically; clients label those turns Local finishing, not sandboxed. Other permissions, budgets, and manual stop controls remain in force. Defaults never switch a running turn's backend in place.

**Integration boundary.**

- Use SendBox's supported CLI and policy interface behind a typed Moguri backend adapter, not private Rust APIs or a model-generated wrapper. SendBox supports custom guest executables, headless JSON events, and explicit exit status; its `--json` and `--interactive` modes cannot be combined. Phase 0 must prove the worker control and terminal transport rather than assume a ready-made SDK. [S2]
- The host control plane owns durable state. In SendBox mode, the agent worker, model-facing tool execution, subagents, and executable agent extensions live in the guest or use explicitly scoped SendBox brokers. The guest gets a run-scoped authenticated bridge, not the host control-plane token, home directory, secret store, or unrestricted API.
- Build a digest-pinned Linux workload image containing the Moguri worker, its pinned Node.js runtime, Linux Rust helpers, and development tools. SendBox agent profiles do not install the agent. Validate runtime, guest artifacts, image, version compatibility, workspace policy, and credentials before launch. [S1], [S2]
- SendBox currently uses Apple Containerization on macOS 26+ with Apple silicon, or Kata on virtualization-capable Linux. Unsupported hosts or absent prerequisites block Sandbox runs with setup diagnostics; they never cause fallback to Local. VM isolation and intentionally writable workspace mounts are shown separately. [S1]
- Copilot and other remote providers remain external services. A host-side `ds4-server` may remain on the host, but guest access needs an explicitly approved, supported provider connection. Validate scoped authentication and network access; never mount host login state or bypass network policy to make a provider work. The setting governs Moguri session execution, not where an independent inference server runs.
- Check the latest policy and authenticated backend readiness before each new turn. No model request starts for a new turn until its required sandbox is ready. Guest loss interrupts that work and preserves failure or partial outcomes; no host retry is allowed. Supervision and teardown must account for both the SendBox process and guest workload, rather than treating a CLI exit as proof of complete cleanup.
- Preserve the same typed commands, events, budgets, Git policies, and cancellation semantics across all envs. In Sandbox, terminals and agent file/tool operations stay within the approved guest workspace and brokers. Remote is off-machine execution, not an assertion of SendBox controls or protection of unrelated data on that remote host.

**Managed desktop setup direction.** The owner now requires bundled SendBox
0.2.7 and a compatible pinned Linux worker/runtime/dependency image, reviewed
in-app setup and public-release update checks, automatic private workspaces
without per-turn text previews, and selected-provider endpoint/CNAME resolution.
[Managed Sandbox](managed-sandbox.md) records the prerequisite measurements,
root-owned no-script installer requirement and exact data/egress authority.
This supersedes the developer-tooling setup UX, not the root-ownership,
private staging, no-replay, permission or budget boundaries. Legacy manual
configurations are not silently granted the new managed policy.

Explicitly reviewed `*.domain.com` tool rules use the existing released native
matcher. Exact entries remain exact, the apex is separate, and actual provider
endpoints/CNAME provenance stay exact. The adapter adds no wildcard or
dependency. For the default, the owner explicitly selected GitHub Meta
delegation with clear setup disclosure. The `github.com` grant includes Meta
domains and IPv4/IPv6 CIDRs, including shared-cloud ranges. The SendBox host
fetches them into one machine-wide cache, revalidates it at most hourly and
seeds each guest before readiness; guests never contact GitHub Meta. It is not
labeled exact-host-only egress; the service's review digest binds this warning
and activation still requires the user's network-policy acknowledgement.
Actual guest qualification remains separate from authenticated
artifact/package verification.

SendBox 0.2.7 is the only pinned release and the minimum supported one. The
[default release pin](managed-sandbox.md#default-sendbox-027) keeps a saved
older selection and its signed history readable but blocks it before native
execution until the user explicitly reviews the bundled 0.2.7 setup; it is
never silently upgraded and never falls back to Local. Current physical
qualification is recorded in the
[native combination record](milestone-combination-matrix.md); earlier
releases' receipts are not current evidence.

## D11. kupo synthetic model and routing

**Decision.** Users can select a fixed model or **Kupo** (`kupo` in the SDK).
Kupo is Moguri's synthetic model with a versioned automatic orchestration policy
over configured local and hosted models. It follows HydraFusion's public
single, cascade, and independent critique/revision patterns, without assuming
access to GitHub's internal implementation or a standalone HydraFusion API. [H1]

**Rules.**

- Keep fixed-model selection available. kupo selection grants no extra autonomy, permissions, providers, or network access. Autonomy level, Env, and Budget remain separate.
- Always show Kupo in the model catalogue, including its unavailable state. Discover authenticated provider models and configured local endpoints before forming the pool, using metadata and health checks rather than paid inference or arbitrary network scans. Recheck accessibility from the selected env; Remote makes model calls on the SSH machine. An unset/unusable generative pool blocks inference, and decision-only Jev configuration does not supply a solver.
- Filter the candidate pool by profile policy, data locality, capabilities, context and output limits, health, and budget before sending classifier input. Validate the typed plan and recheck eligibility at each dispatch; remote classifiers are themselves data destinations requiring permission.
- The automatic default uses configured models, subject to explicit pool/privacy policy. One eligible model always runs Single without a classifier. With multiple models, an eligible classifier selects a workflow and concrete bindings using declared capability categories and task complexity; it cannot invent quality scores, providers or policy. Explicit Single/Compound classifier policies remain supported. Leg calls never invoke Kupo recursively.
- Single uses the normal loop. Cascade gates an efficient draft with explicit validation before accepting it or escalating. Critique uses an independent, read-only, tool-less model from a different family and a bounded solver revision; two aliases for the same model are not independent critics. If a pattern's prerequisites are absent, choose another eligible pattern or report it unavailable.
- Automatic ordinary-composer orchestration selects a response/tool intent before normal tool permissions. Unselected responses never execute tools or become solver history. This is not patch application or test validation. The separate reviewed worktree workflow reuses owned workspaces and leases: only an accepted, validated patch may be applied against its recorded base. Neither path replays Git/network writes or hides already-performed effects and partial cleanup.
- Bound legs, revisions, escalations, retries, spend, and time. Every classifier, draft, critic, revision, and fallback request belongs to the same cancellation tree and cost ledger, with its role, provider, resolved model version, configuration, and outcome recorded.
- With a finite token/USD cap, reserve wind-down capacity and try to checkpoint and commit accepted work before exhaustion. Git policy and the autonomy level still govern approval; do not add calls past the cap or claim a denied/failed commit succeeded. Unlimited is the session preference default, not permission to lift inherited hard limits.
- Expose the selected `kupo` label and actual per-leg models in both clients. Failure, unavailable models, invalid plans, or low confidence may use only a visible, preconfigured eligible fallback, or pause for the user. Never silently cross a privacy, budget, or sandbox boundary.

**Schema impact.** Phase 1 defines versioned routing-policy snapshots, plans, leg ownership, candidate bases, acceptance/application outcomes, and complete per-call accounting. Use the existing event/projection model and normal migration and restart-recovery rules; do not build a second hidden workflow store.

**Automatic response slice, introduced in protocol 61.** The
[automatic Kupo contract](automatic-kupo.md) records the user-selected normal
composer behavior, reused licenses, prerequisite measurements, capability
inventory, original-response selection, exact Manual approvals and no-replay
recovery. Three through twenty configured models are covered without pool
truncation. Critique still requires reviewed lineage (D56 later adds
name-based cross-lab pairs and Council); finite automatic budgets,
images, tuning, Sandbox and live quality remain unqualified. Historical
explicit Single and reviewed worktree policies below are not silently widened.

**Measured prerequisite.** The [generated routing transport probe](routing-primitives.md)
passes eight mechanical Single-pattern cases through maintained pi-ai:
actual 128/64 output bounds, role telemetry, approved snapshot membership,
receipt failure, unknown usage, changed eligibility and cancellation before
solver dispatch. It does not qualify production routing, calibrated quality,
durable all-role admission, compound candidates or budget wind-down.

The subsequent [private compound transport gate](compound-routing-primitives.md)
exercises an efficient Cascade draft/one configured escalation and independent
Critique/one bounded revision using generated canonical/family metadata.
Every actual pi-ai role forwards its admitted output bound and retains
known/unknown costs before continuation. The result is only a tool-less
proposal. This does not qualify real model-family independence, candidate
workspaces/acceptance/application, the owned ledger or finite wind-down.
The subsequent [private owned-file probe](candidate-primitives.md) exercises
actual SDK worktree staging, exact base/byte review and partial application
without changing the source index/HEAD. Its caller hooks do not qualify durable
candidate ownership, recovery, scheduler accounting or public admission.

**Executable alpha boundary.** [Protocol 16 Single](routing.md) now adds an
explicitly approved scoped pool/hosted-data flag, actual router/solver
reservations and one acknowledged continuation in the existing owned worker.
It is disabled by default and pauses on invalid/stale/unmetered advice, without
a fallback. Local and qualified core SSH use the same approvals and accounting.
Any finite inherited cap, images or per-model tuning block this alpha.
The protocol-29 [manual Local candidate workflow](candidate-workflows.md)
now implements separately reviewed staging/application through all clients,
with independent retention, exact writer ownership and real SIGKILL recovery.
It calls no model and proves base/byte checks, not code quality.
Cascade, independent critique/revision and their candidate/ledger integration,
calibrated thresholds and reserved wind-down remain incomplete; this is not
completion of D11 or its full Phase 0 quality evaluation.

The 0.23 [private checkpoint gate](winddown-primitives.md) additionally proves
pre-reserved role dispatch at exact current caps, stale-session/price rejection,
no borrowed profile capacity and real accepted-work Git mechanics. It passes
42 generated checks, with 93 expanded compatibility cases. The actual
three-role path reports 126 tokens inside its captured 279-token cap.
Production compound ownership/wind-down recovery and public admission remain
gated; these are not live quality, pricing or automatic-approval results.

Protocol 30 adds the [planned-budget foundation](budget-plans.md): future holds
are distinct from model calls, atomically transfer once, and release only while
provably undispatched after the exact owner ends. The actual SIGKILL case
preserves interrupted model usage while releasing only its unused plan.
Production compound/checkpoint ownership and live quality remain unqualified.

Protocol 31 adds [owned reviewed generation](candidate-generations.md): one
explicit fixed-model Local draft reuses the production worker and ledger with
zero tools, exact selected source, independent input/result/provenance and
canonical no-paid-replay intent. Staging/application remain separate real-user
reviews. This is an integrated first model role, not completion of compound
patterns, finite kupo wind-down, calibrated quality or D11.

Protocol 57 intentionally changes only
[candidate/proposal retention](candidate-cleanup.md). Permanent deletion of
the canonical origin session, or fresh policy-allowed verification that the
exact associated PR merged, erases candidate-owned compartments after exact
cancellation/settlement. Archiving alone preserves them; ordinary role/compound
reports and budget accounting remain independent. Repository-free/folder-only
sessions cannot create candidates. Original provenance and first PR association
are migrated without guessed ownership, new inference or filesystem effects.

The 0.24 [private owned-role protocol](owned-role-protocol.md) now exercises
acknowledged candidate-stage continuation in that same actual worker, with
complete planned-capacity transfer and retained results before another role.
It keeps model/host advice separate from acceptance and halts on unknown
usage, failed receipts, stop or control loss. This is not a durable compound
workflow, real-family quality gate or public routing configuration.

Protocol 32 adds the [independent role-state foundation](role-sequences.md):
exact original role/plan/input/result observations survive source retention,
remain data-only and cannot authorize another call on unknown accounting.
This adds shared inspection and no-replay recovery, not a new model-start,
quality or public compound policy.

Source 0.26 connects those records and complete future context/role holds to the
actual control plane and worker. Its internal Node executor shares original
intent, concurrency, receipts and removal/commit guards. Actual per-role raw
contexts/results survive real controller SIGKILL and source deletion without
replay; later contexts explicitly label prior output as untrusted data.
The extended `compound-routing-spike.mjs` covers this integrated mechanical
path alongside the earlier transport/pure-ledger probes. No new event shape,
database, model loop or outward SDK creator is introduced. Pattern/pool
selection, genuine family/quality, candidate decisions and actually authorized
accepted-work wind-down remain separate gates; finite kupo stays blocked.

Source 0.27/protocol 33 adds [canonical final-role proposal origin](role-proposals.md),
not public pattern admission. Read-only resolution verifies the actual final
proposer/input/result/known ledger, while exact staging preview binds its
self-contained origin. Independent candidate grants retain the original raw
inputs/results through source-role deletion; source application still records
separate actual-user acceptance. The additive marker preserves old state and
version-5 exports disclose the new copy. No quality or Git authority follows.

Source 0.28/protocol 34 adds
[explicit provider-declared model inspection](model-evidence.md).
Normal Copilot login/discovery/inference is unchanged. One exact available
model can expose bounded family/vendor/version declarations from the
authenticated catalogue without project content, inference, a durable cache
or inferred aliases. The report's digest binds its observation, not independent
training or quality. Unknown/local/synthetic lineage remains unknown; neither
this report nor its metadata labels can enable compound routing, finite kupo,
Max or acceptance. The additive compatibility marker preserves schema-33
candidate origin and independent raw-copy history.

## D12. System One decisions and autonomy levels

*(Since [D60](#d60-autonomy-and-remote-host-labels-ssh) the `Autopilot` value is
shown as Autonomous and `Autopilot Max` as Autopilot; stored values are
unchanged.)*

**Decision, amended by the owner's session-handling request.** Keep the typed
decision-provider interface and optional **Jev by TypeSafe AI** adapter.
**Manual** remains default and **Guided** still requires human confirmation.
Explicitly selecting **Autopilot** now delegates automatic tool/command
approvals for all subsequent session turns. **Autopilot Max** has the same
unattended approvals and adds a qualified System One-compatible decision layer
for delegated technical choices and steering. Neither changes model, Env,
Budget, hard denials, root ownership or user-only settings. Existing bounded
selections retain their old behavior until explicitly reselected. See the
[protocol-61 contract](session-github-workflows.md).

**Provider contract.** Jev is a structured decision model, not a code/chat generator. Its documented hosted API evaluates state against typed Noul (yes/no probability), Choice, and Score questions; some types include a separate confidence value. Use a dedicated adapter to `POST https://api.typesafe.ai/v1/systemone`, not an invented OpenAI-compatible endpoint or assumed `pi-ai` integration. Other local or hosted providers must declare and satisfy equivalent capabilities. [J1], [J2]

**Rules.**

- Represent structured user questions and steering as bounded typed decisions with explicit alternatives and escalation. Legacy bounded-Max tool decisions remain attributable to their original policy. Missing user-only facts still require clarification; models cannot set their own permission limits.
- Current Autopilot Max automatically approves tools under actual user-selected autonomy, not model advice. Its decision provider can answer qualified technical alternatives and steer at safe boundaries. It needs an explicitly configured compatible provider, without fallback; steering cannot change a pinned model, expand the task/workspace or grant permissions.
- The control plane's deterministic authorizer remains final. User-delegated scope may permit automatic decisions, but a high confidence score cannot override a hard denial, lift a budget, expose a secret, widen allowed envs, or change another user-only security setting. Git and other consequential writes still need explicit user action or policy.
- Validate question/answer types, option membership, numeric bounds, and confidence semantics. Treat input content as data, not instructions. Evaluate decision thresholds on generated fixtures; vendor calibration, speed, or cost claims are not permission or a reliability guarantee. Probability and confidence are not interchangeable. [J2]
- Bind each decision to the exact pending request, arguments/context, delegation, and policy revision. Recheck before tool execution, applying an answer, or admitting a steer. User intervention, revoked delegation, changed input, or cancellation invalidates stale results. Persist the actual model actor, rubric, and available evidence references, never a fake user-authored response or reasoning the provider did not return. Automated answers cannot become user-only Core instructions.
- Keep model keys in the profile's secret backend. Hosted decision inputs need explicit data/network permission from the selected env; a policy forbidding third-party data transfer also forbids sending those questions to hosted Jev. Account for every decision call and retry, with independent deadlines and cancellation. A timeout, invalid output, provider outage, or insufficient confidence pauses or escalates; it never means approval.
- Pin an evaluated Jev version when thresholds depend on it, and record the resolved version returned by the provider even when the user selects an alias. Aliases can move without a client update. [J3]

**Schema impact.** Phase 1 defines autonomy-level settings and default sources, bounded delegation, decision requests and results, recommendation versus human/automated approval actors, policy revisions, invalidation, and requested/applied steering events. Recovery must preserve pending questions and accounting without re-executing effects; durable changes require migrations.

**Measured prerequisite.** The [generated System One wire/schema probe](decision-primitives.md)
passes eight checks without a real account or automatic authority. The
documented request has no output-token-limit field; finite-token contexts
cannot admit this adapter until a qualified bound exists. Missing telemetry
is unreported, invalid advice preserves valid cost units and transport abort
never proves provider-side cancellation. Owned-call/ledger, calibrated
delegation and live/remote integration remain unqualified.

**Guided slice.** The existing solver may attach an offered-choice
recommendation to `ask_user`; the service stamps actual step/model provenance.
The same call pays for that output. Desktop/TUI expose advice without answering
or approving. Exact-step tool narration may guide the human, never replace the
deterministic authorizer. Migration 15 preserves old questions/keys/receipts
and defaults legacy advice to null. This does not enable a decision provider,
Autopilot Max or automated steering.

**Protocol-40 source slice.** The [owned decision integration](owned-decisions.md)
adds an explicitly selected bounded-model System One-compatible alternative
over the existing root-less worker, all-role ledger and deterministic
authorizer. Local Max can review already-delegated tools, exact user-declared
technical choices and bounded user-authored safe-boundary steering without
human impersonation. Actual worker exit, context/policy/human rechecks,
independent reports and real controller-loss recovery remain required.
SDK, CLI, actual TUI and hidden desktop now share explicit configuration,
service readiness, immutable evidence and real human override. Automated
answers retain original copied evidence independently of both report and
source retention. Jev stays unqualified because its current wire cannot enforce
the required output bound; it never silently substitutes this alternative.
The final generated full/packed/native sweep passes without changing factory
defaults or qualified archives. Remote/native Max and live
reliability/calibration remain distinct gates.

**Protocol-61 source slice.** Remembered approvals reuse `settings.updated`;
actual user answers and scoped grants are one transaction. A metadata-only
schema marker preserves encrypted history and legacy autonomy behavior.
Automatic approvals record an `autonomy` actor bound to the explicit consent
marker. New Max does not wait for legacy tool review, while the existing
bounded question/steering worker, ledger and failure rules stay unchanged.
The same slice adds controller-account repository discovery, exact reviewed
GitHub source starts, native client pickers and existing reviewed PR/issue
publication. It adds no dependency or Jev/Remote/native qualification.

### Laya optional provider evaluation

**Assessment, 2026-10-26.** Recommend qualifying
[Laya](https://github.com/NandhaKishorM/laya) as an opt-in, separately installed
System 1 decision provider alongside the Jev target, not replacing Jev or
silently substituting for it. The user would choose the provider and exact
checkpoint independently of the generative solver, kupo, Env and autonomy.
The existing bounded-model alternative also remains separate. This is an
evaluation, not an implemented adapter, an installation or automatic-decision
qualification. Current settings accept only `bounded-model` and `jev`;
Jev's output-bound restriction above is unchanged.

**Evidence boundary.** Source review pins Laya to
`b9fe351ce81e2d974bca2bf219c1e4030c0a05ea`, whose package declares `0.4.16`.
PyPI and the latest GitHub release reported `0.4.15` on the assessment date.
Do not assume a plain `pip install` contains every reviewed source behavior.
No Laya package, weights or server was installed or executed for this review;
no live Jev call or Moguri laptop benchmark was performed. [LY1], [LY8]

**Technical fit.** Laya uses an encoder and fixed decision heads rather than
autoregressive text generation. It returns named `choice`, `noul` (P(true))
and ordinal `score` answers. Its optional `laya[serve]` Python package exposes
`POST /v1/systemone`, `POST /v1/systemone/batch` and `GET /health`. There is no
OpenAI-compatible chat endpoint, so it cannot be registered as an ordinary
Moguri local chat model or sent through the existing pi-ai worker unchanged.
A fixed answer space prevents invented labels, not confident wrong decisions.
[LY1], [LY2]

| Checkpoint | Parameters | Published token window | Appropriate evaluation |
|---|---|---|---|
| [English](https://huggingface.co/convaiinnovations/laya/blob/7b928d828b7b0e022f929d9bd2e44165aa270148/README.md) | 421M | 512 | Short English classification |
| [Multilingual](https://huggingface.co/convaiinnovations/laya-multilingual/blob/1720e3e3357cfe1e281542e223f8273b0890ca34/README.md) | 322M | 1,024 by default; explicitly configurable to 8,192 | Mixed-language and longer bounded state |
| [Typed decisions](https://huggingface.co/convaiinnovations/laya-typed-decisions/blob/e929ae5cf69bc34259cd2f95c9e91145b818b1f0/README.md) | 421M | 1,024 | Specialist trained on four synthetic workflows, not general coding approvals |

These are whole per-question row windows: instructions, alternatives and
special tokens take space away from the state. The model-card links pin the
observed Hub revisions, not tested or approved deployment artifacts.
The source license and all three model cards declare Apache-2.0. This is a
permissive integration candidate, not a completed training-data or transitive
license audit. Separate installation avoids embedding Python, PyTorch, ONNX
or model weights in Moguri; any later redistribution needs its own dependency,
license/notice and exact-artifact review. [LY3], [LY9]

**Deployment and user ownership.** Both deployment modes would use one
dedicated service-owned HTTP adapter and one shared SDK configuration:

| Deployment | Required boundary |
|---|---|
| Same laptop | The user separately provisions Python 3.10+, `laya[serve]` and selected checkpoint weights, then starts the server on loopback, explicitly setting `LAYA_HOST=127.0.0.1`; upstream defaults to `0.0.0.0`. Prefer the host Python runtime when evaluating Metal/MPS rather than assuming a Linux container exposes it. |
| User-managed endpoint | The user supplies the exact approved destination and any profile-owned bearer secret reference. Require authenticated encrypted transport for non-loopback use and separate data/network consent; self-hosted is not synonymous with local-only. |

Moguri must not install Laya, download weights, scan for servers, start or
terminate the user's service, or acquire credentials implicitly. The external
server's normal lazy/preload behavior can download weights, so provision the
reviewed artifacts separately before an offline deployment. Preload only the
selected checkpoint when cold-load latency matters; default all-model
preloading increases residency. A remote HTTP destination does not itself
select the Remote execution Env. Future Remote calls must originate on the
captured SSH machine; existing Remote/native Max gates stay blocked. [LY1], [LY2]

**Compatibility gaps that block a settings-only switch:**

1. **Exact identity.** The response's top-level `model` is the constant
   `laya-rl-agent`, not a Jev version or checkpoint identity. `routing` reports
   the selected checkpoint/repository; authenticated health exposes loaded
   revisions. Unrecognized non-path model names, including Jev IDs, can mean
   "let the router choose." Send a recognized explicitly selected checkpoint,
   pin its revision and artifact digests, and reject unexpected routing.
   Upstream supports opt-in `LAYA_REVISION`/`LAYA_SHA256_DIGESTS`; its
   `reviewed` alias refers to its own pinned table, not a Moguri qualification.
   A separate health read is not atomic per-call provenance. Automatic
   application still needs evidence binding the actual inference to the
   configured runtime, weights, tokenizer/configuration and calibration. [LY2], [LY4], [LY6]
2. **Lossless input.** Moguri's 64 KiB state and 4,096-character criteria
   limits do not establish a fit in these windows. Laya can return an answer
   after cutting state, instruction text or option descriptions.
   `usage.truncated`/`state_tokens_dropped` expose state loss, but do not prove
   that instructions and all option text survived: `build_head` caps each
   option's encoding at 48 tokens and can shorten the combined head further.
   Require exact-renderer/tokenizer preflight or additional server evidence
   covering the complete question and state; reject loss, collisions or
   missing evidence. Do not silently summarize, window, repair or drop
   alternatives to make a request fit. [LY2], [LY3]
3. **Confidence and authority.** Laya's `confidence` is normalized entropy for
   choice/score, while `answer_confidence` is the reported answer's probability.
   `x_jev_confidence` computes a Jev-style formula over Laya probabilities;
   neither it nor wire compatibility makes existing Jev thresholds calibrated
   for Laya. Preserve these distinct semantics and fit/validate thresholds on
   held-out generated Moguri decisions. Upstream documents overconfidence,
   label-sensitive yes/no answers, score weaknesses and an
   `action.act_probability` head with little usable signal. None can authorize
   tools, supply user-only facts or override policy. [LY1], [LY2]
4. **Wire validation.** The full response carries extra routing, confidence,
   action and truncation fields; it is not the exact inner
   `DecisionAdviceSchema`. Validate and retain the raw provider envelope before
   projecting the declared typed advice. Keep `LAYA_JEV_STRICT=0`: strict mode
   removes routing and truncation evidence and does not convert entropy
   confidence into Jev confidence. Test four-decimal probability/score rounding
   against Moguri's existing 0.001 consistency tolerance at every supported
   option count; restrict unsupported shapes rather than globally weakening
   validation or silently repairing results. Disable tournament/shortlist
   paths for an initial one-call adapter, since they change alternatives,
   confidence and accounting. [LY2]
5. **Honest accounting.** Laya reports zero generated output tokens by design,
   but nonzero input work: `input_tokens` sums non-padding rows, including the
   repeated state and question/options for each question. A one-state context
   estimate would underreserve multi-question work. Current
   `decisionCapability`, `DecisionRecord` and `BudgetRuntime.reservation`
   require positive generative output capacity; a new provider-specific,
   provably non-generative admission path is needed, not an invented
   `max_tokens` field, fake generated tokens or zero-cost bypass. Reserve the
   entire bounded question set before dispatch and retain every actual role,
   input usage and known/unknown charge. No API invoice does not imply an
   approved zero USD rate, and JSON response bytes are not generated tokens.
   Unknown completion keeps its hold. [LY4]
6. **Cancellation and readiness.** HTTP abort/deadline cannot prove the
   synchronous inference thread stopped; upstream explicitly allows an
   already-running forward pass to continue after request cancellation.
   `/health` is liveness, not loaded-model readiness, and a wrong/missing
   bearer can still receive `{"status":"ok"}`. Require exact authenticated
   capability checks, bounded request/response bodies and deadlines. Report
   unavailable, busy, failed, partial and cancellation-unconfirmed outcomes;
   do not retry an uncertain call, switch providers or apply a stale late
   result. Stopping Moguri must not kill a separately owned Laya server. [LY2], [LY5]

**Quality and performance judgment.** The 322-421M parameter range and
CPU/MPS support make a separate laptop service plausible, not qualified.
Upstream reports about 2.3 GB for the three-checkpoint download; that is not
resident RAM including PyTorch, activations and caches. Its macOS Intel/Radeon
measurements report 121-146 ms for four short questions on MPS and roughly
13 seconds of first-call Metal compilation. These are not Apple Silicon
laptop or Moguri end-to-end measurements, nor does the advertised 33 ms T4
figure predict them. The specialist's reported 0.766 accuracy versus Jev's
published 0.727 is not a controlled head-to-head: upstream states that it had
no TypeSafe API access and prompts/sample sizes differ. Neither those four
workflows nor a confidence threshold qualifies coding-tool decisions. [LY1], [LY7]

**Qualification and implementation impact.** First run the documented Phase 0
prerequisites and add a separately recorded Laya adapter spike. Generated
fixtures must cover exact named alternatives/legends and confidence semantics,
input/head truncation, Unicode/rounding, alias/revision drift, auth/readiness,
oversized/malformed replies and busy/error responses. Prove concurrent
all-role input-only admission under finite token/USD policy, unknown/late
usage, cancellation failure, actual controller loss/restart, source/report
retention, human intervention and revoked delegation without call/effect
replay. A separately provisioned real-weight run must measure cold/warm
latency, peak RSS, actual device, full supported input sizes and held-out
false-allow/abstention rates; transport fixtures alone cannot qualify quality.
No such Laya qualification is claimed here.

Reuse Node fetch/abort/HTTP (MIT), TypeBox (MIT), existing owned decision
reports, authorizer and append-only all-role ledger, not another agent loop
or client-specific Python binding. An implementation needs a versioned
decision-provider configuration/capability contract, endpoint and secret
references, non-generative bounds/accounting and retained exact inference
provenance. Durable additions require migrations, protocol compatibility,
packed SDK and restart-recovery coverage; old Jev/bounded-model settings
remain intact and defaults stay off. CLI/TUI/desktop must share SDK readiness,
selection, errors, actual actors/usage and stop behavior. This evaluation
changes no dependency, schema, event, API or executable behavior.

## D13. Remote SSH execution

*(Since [D60](#d60-autonomy-and-remote-host-labels-ssh) this Env is shown as
Remote host and `/remote` is `/ssh`; the stored value stays `Remote`.)*

**Decision.** Include a user-configured **Remote** env in the first release. It runs the agent task, tools, and all router/solver/critic/decision model calls on the SSH machine. The user's local Moguri service still owns durable state and the client API; the remote worker reports through a versioned, run-scoped protocol inside SSH.

**Rules.**

- Use an explicitly selected reachable host and approved workspace. Verify host keys, authenticate with the user's SSH agent or secret-backed identity, and check worker/runtime/platform compatibility. Do not disable host-key verification, forward an agent implicitly, copy private SSH keys into the worker, or automatically provision a cloud machine.
- Model access must work from the remote machine using its approved provider setup or explicit scoped credential delivery. A remote localhost endpoint means the remote host; reaching a model server on the user's local machine needs an approved tunnel. Do not silently relocate inference to the local controller.
- Scope remote workspace, files, environment, and credential access. Local attachments are approved snapshots to transfer, not permission to mount the user's home directory or synchronize the secret store. Repository/worktree identity includes the host and remote path; do not substitute a same-named local directory.
- Supervise remote processes and track request/run identities, replay positions, late usage, and cancellation acknowledgements. An SSH disconnect or CLI exit alone proves neither task completion nor process-tree termination. Reconnect without replaying side effects, starting duplicate workers, or falling back to Local; surface unknown/partial outcomes and remote survivors explicitly.
- Remote satisfies an allowed-env policy that permits Sandbox or Remote. State plainly that SSH secures transport and moves execution off the local machine, but does not itself isolate the worker from other data or processes on the remote host. Only a real SendBox runtime may be labeled SendBox-protected.
- Reuse the same permissions, autonomy levels, budgets, Git gates, event schemas, and cancellation tree. Remote work does not introduce a remote scheduler or second durable authority. Broader managed cloud provisioning and hosted orchestration remain deferred.

**Composer/default contract.** Follow the implementation specification's Env/Model/Autonomy level/Budget controls, typed attachment triggers, and global/profile/repo/project/session precedence. Factory values are Local, model unset until a generative provider login or local-model configuration, Manual, and Unlimited. Default changes do not rewrite a running turn or override policy.

**Executable read boundary.** Protocol 17 adds shared read-only Files, Changes
and Plan views through the pinned SSH worker, never the attached Local folder.
Root/env/peer/policy are rechecked after awaiting the bounded read. Git hooks,
filters and protected/denied paths stay suppressed; cancellation/close stops
owned queries. CLI/TUI return Remote plan text, not a Local file action. The
updated inspector can verify authenticated protocol-16 receipts but cannot
attach or resume that legacy worker. This does not qualify Remote consoles,
MCP/memory execution, direct plan saves or native Sandbox.

## Phase 0 validation spikes

Each spike records a pass or fail result and its measurements under `docs/`.

1. **Providers.** `pi-ai` with GitHub Copilot sign-in and streaming, `ds4-server` streaming with tool calls, and cancellation of in-flight requests.
2. **Supervisor.** Start a PTY with a nested process tree on macOS and Linux, stop it, and report survivors. Decide behavior across service restarts.
3. **Event store.** Single-writer SQLite append latency, a crash during a write, and projection rebuilds.
4. **Desktop.** An Electron shell attaching to the service. Measure cold start, idle memory and scrolling through a long timeline.
5. **TUI.** OpenTUI with React on Node.js 26 rendering a streaming timeline.
6. **Native addon.** File search and Git status on a large generated repository, compared with a Node.js baseline.
7. **Packaging.** A signed and notarized macOS app containing the Node.js runtime, the service, the native addon and the supervisor, and a Linux CLI installation.
8. **Native SendBox.** Run the Moguri worker as a custom guest executable on supported macOS and Linux hosts; prove bidirectional control, terminal transport, scoped Copilot and host-side ds4 connectivity, MCP containment, cancellation, guest loss, and restart reconciliation. Exercise Local defaults, per-session selection, allowed-env policy, already-running-turn completion, and the absence of Local fallback.
9. **kupo.** Exercise all three patterns with generated local/hosted tasks against a fixed-model baseline. Measure verified quality, complete cost, latency, and cancellation; test ineligible routes, missing critics, unsafe fallbacks, conflicting candidate patches, budget wind-down and authorized/denied/failed checkpoint commits, and restart without duplicate side effects. Do not claim HydraFusion's benchmark results as Moguri's.
10. **System One and approvals.** Verify Jev's real typed request/response contract and a pluggable alternative using generated fixtures. Cover Manual defaults, Guided confirmation, bounded Autopilot and Autopilot Max with both fixed and kupo models, confidence versus probability, malformed output, missing facts, prompt injection, revoked grants, concurrent human intervention, rate limits, outages, and SendBox/budget enforcement.
11. **Remote SSH.** Prove remote worker and model execution, host verification, scoped credentials/workspaces, attachment transfer, local-model reachability, reconnect/replay, cancellation across a lost connection, and truthful late outcomes without Local fallback or duplicate execution.
12. **Composer and defaults.** Exercise all attachment triggers and clipboard capability states; provider discovery and the no-model setup state; Local/Manual/Unlimited defaults and repo/project overrides; invalid inherited values; concurrent token/USD reservations, telemetry gaps, and session restart without resetting usage.

## D14. One importable SDK and user-controlled capability platform

**Decision, 2026-10-18.** The `moguri` package exposes browser-safe SDK and React
entrypoints plus a Node entrypoint for service discovery/embedding and the CLI.
Both TUI and desktop import that SDK. SDK capabilities own API access and domain
semantics; Electron adds only native affordances and presentation. Protocol 2
and transactional database migration 2 extend existing state without reset.
The [SDK platform contract](sdk-platform.md) records validation and gates.
The [settings platform contract](settings-platform.md) extends this boundary
with searchable grouped settings, profile-wide left navigation and reviewed
native preferences. Desktop-only affordances do not become a second authority.

User-viewable/editable system instructions have shared defaults and reset.
Deterministic permissions cannot be weakened through prompt text. Repository
vector/import-symbol graph indexes are local derived data and explicit opt-in.
Standard skills, approved evolution proposals, scripts, optional read-only
subagents, plugin manifests and the native MCP gateway extend the same policy,
ledger and cancellation tree. Later unattended/self-modifying modes are not
silently enabled.

Dark is the desktop factory theme. Local dictation uses pinned native
NeMo-Speech.cpp and a user-downloaded Nemotron 3.5 GGUF, with NVIDIA's documented
locale tiers shown accurately. No cloud ASR fallback or implicit model download
is allowed. Protocol 107 also lets a profile trust an existing streaming model
file after a read-only review locks its SHA-256: NeMo-Speech streaming GGUF on
the same runtime, or transcribe.cpp 0.4.2 (MIT) streaming GGUF through a pinned
library archive driven by `node:ffi` in an isolated host process. Non-streaming
models such as Whisper are rejected, a changed digest needs a new review, and
external files are never deleted. SendBox remains unavailable until its real transport and guest
prerequisites pass; configuration alone is not proof of containment.

## D15. Shared cache and local project workflow

**Decision, 2026-10-19.** The user-requested
[workspace slice](workspace-platform.md) adds shared content-addressed npm/pnpm
archives, script-free managed installs, local feature/bug/misc boards and
read-only PR/optional Linear integrations through the same SDK.
Protocol/database migration 3 preserves previous state and rejects incompatible
clients. These are explicit bounded additions, not permission to activate
unattended self-modification or the remaining deferred roadmap.

Package/version identity includes SHA-512 and the exact manifest/lock plan.
Advisory checks happen before artifact download/reuse; unknown is not clean.
Project scripts/hooks/configuration are not evaluated during managed installs.
No package gets a malware-free guarantee and no lifecycle code runs on the host
as a fake SendBox substitute. Only qualified adapters are offered; workspace,
private-registry and further ecosystem support were initial explicit limits.
The separately owner-requested protocol-41
[scoped adapters](dependency-cache-scopes.md) extend those formats without
removing integrity, fresh-advisory, credential/resource or lifecycle gates.

Tickets are local and independent of sessions, with revisioned configurable
phases and no assignee. A verified merged PR can advance phase under the
board's read-only observation policy. Linear starts off and imports only
explicit pages using a scoped user key; local issues are never auto-exported.
Those original observation/import paths do not start CI, merge, push or grant
permissions. D27 adds separately reviewed user workflows, not automatic export
or a mutation hidden inside an observation.

CI is restricted to pushes to `main`. Feature/PR checks are performed locally.
The [metadata-only OTLP contract](otlp-export.md) is a bounded D14 extension:
explicit profile-owned opt-in exports existing committed execution/accounting
records through pinned Apache-2.0 OpenTelemetry codecs. It adds no accounting
authority, automatic instrumentation, hosted destination or payload capture.
Its generated Node26/pi-ai primitive qualification precedes integration.
The explicit 30-minute job timeout has been removed. Omitting
`timeout-minutes` uses GitHub's documented 360-minute default, subject to the
six-hour GitHub-hosted job execution limit, not unlimited execution.
Process, provider, HTTP, VM and user-facing CI-watch deadlines remain separate.
Sources: [workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idtimeout-minutes)
and [Actions limits](https://docs.github.com/en/actions/reference/limits).

The [protocol-91 repository-management slice](repository-management.md)
extends the existing Local clone/reviewed Git authority with retained URL-list
batches and actual-user shared-config remote changes. Node/Git, SDK clients,
independent retention and all earlier execution/release boundaries remain
unchanged. No additional repository engine, account authentication or
client-owned import queue is introduced.

## D16. Session workspace, Ghostty and retention

**Decision.** Use maintained `ghostty-web` 0.4.0 (MIT) with Ghostty's actual
WASM VT core and its supplied renderer. Node-PTY remains only the owned
transport. No homemade VT renderer or xterm.js substitution. The generated
[session workspace spike](session-workspace.md) qualifies self-hosted WASM
under sandboxed Electron and strict CSP before feature work.

Cmd/Ctrl+Enter creates a held prompt without starting work. One SDK slash
catalogue drives desktop and TUI; native panel actions are thin bindings.
Read-only mode is enforced at declaration, authorization and execution, not by
prompt text. User-created side/subsessions are distinct from opt-in model
subagents. Agent writers serialize; question-only work may run in parallel.

Protocol/database migration 4 retains immutable event identities and sequences,
using independent encrypted profile/project/session payload compartments.
Deleting a session removes its payload keys, not project-owned artifacts or
external PRs. Production keys use an explicit OS-keychain master; tests inject
generated keys. Missing/corrupt keys fail closed. This is operational retention,
not forensic erasure or deletion of backups.

User consoles have ephemeral input/output and never enter durable command
receipts or model context. Restart never relaunches or replays them. Unconfirmed
ownership requires inspection. Project default files are published only after
an explicit user action, on a non-protected branch, preserving the current
checkout/index. Failed or interrupted publication is partial, not successful.
Repo MCP imports bind the exact reviewed digest and start disabled. Porto is
read-only inventory access, not daemon/process control.

The isolated browser uses Electron's existing `WebContentsView`, with optional
user-enabled [Local agent control](agent-browser.md) through maintained Chromium
accessibility/input APIs and the existing exact-approval MCP gateway. No
personal browser, debug port, new browser runtime or Stainless release is
required. The top switch defaults off and revokes pending control immediately.
The separate optional Stainless integration is [D39](#d39-moguri-owned-stainless-automation);
this does not qualify Sandbox or Remote browser transports or the wider release gates.
CI remains main-push-only.

## D17. Compact composer and model settings

**Decision.** The user-requested [composer/model contract](model-controls.md)
uses one icon toolbar with native lightweight popovers. Cmd/Ctrl visibly
switches Send to a held-queue clock. Default-unlimited usage stays behind the
infinity icon; unknown usage and dollar values are not fabricated.

Working context is an explicitly configured limit within the model's fixed
maximum, with labeled estimates and the maintained provider library's output
headroom. Oversized requests fail without dropping history or adding a paid
call. Thinking settings expose only the actual transport's qualified values:
the generated spike proves OpenAI Responses/Anthropic forwarding and detects
Copilot Gemini's explicitly ignored effort knob. No silent clamping/fallback.
Model options and context preview are SDK operations, not client-only state.

Protocol/database migration 5 preserves existing encrypted state and event
identity, while permitting optional typed model settings and per-step sizing/
effort provenance. The original mascot gains a small red pom-pom using online
trait references, not embedded/copied artwork. Existing protection, budget
qualification and model-provider boundaries are unchanged.

## D18. OAuth and reviewed metachat

**Decision.** The [engagement contract](engagement.md) adds true nullable project
scope, not a synthetic project. The explicit protocol-72
[Home amendment](project-free-execution.md) gives ordinary project-free Local
chats a captured canonical Home/device/inode for approved file/command tools,
matching their existing user-console default. It grants no permissions,
repository identity, indexing, project publication or non-Local fallback.
Model-only chats stay parallel; actual Home writers retain independent
profile/root ownership through failed cleanup, source deletion and restart.
Private roles stay root-less/tool-less. All clients consume the same typed SDK.

Reuse the official MIT-licensed MCP SDK for OAuth discovery, registration,
S256 PKCE and resource-bound exchange/refresh. Owned loopback callbacks require
exact state and one exchange. Secrets stay in the explicit keychain backend;
new grants are unusable until a durable connected event confirms them.
Cancellation settles or explicitly reports uncertain credential cleanup.
No model starts login and no authorization opens without a user action.

Suggestions preview bounded prior user prompts locally. Project-free scope
excludes project chats unless the user explicitly reviews an all-project
preview. Analysis is an ordinary accounted/cancellable model turn in a settings
chat. The model may read non-secret settings or propose an exact change, never
apply, authenticate or grant permissions. Human decisions bind content/base
digests, revisions, evidence and risk; skills install disabled and instruction
writes remain local.

Question/bell/done attention is derived in the same SQLite transaction as the
underlying state. Question detection is a nonblocking heuristic, not a human
answer. Desktop banners are opt-in, generic by default and not replayed on
startup; TUI and GUI share read acknowledgements without resolving work.
Protocol/database migration 6 preserves earlier encrypted history and grants.

## D19. Local model registry, resolved controls and typed context

**Decision.** Reuse maintained pi-ai's OpenAI-compatible adapter for explicitly
configured local endpoints. Never scan hosts, download weights or silently
replace a failed selection. Canonical model/provider identity and actual API
model ID are distinct, and Copilot account readiness remains independent.
Resource-bound keys use the explicit secret backend; untrusted provider echo is
redacted before public persistence, including split stream chunks.

Resolve complete new-session controls once from factory, global,
Default-profile, project and explicit session layers, retaining source/revision
provenance. This is not yet multiple isolated profiles, and preferences never
widen hard policy or rewrite active sessions.

Reuse Sharp (Apache-2.0; bundled libvips LGPL-2.1-or-later) for local bounded,
metadata-stripped image normalization. Reuse existing nested-ignore and exact
GitHub read helpers for reviewed folder/reference snapshots. Images and
snapshots use the existing encrypted destination-session grants; unsupported
image models preserve the full draft/queue instead of dropping or captioning
content. Shared SDK inputs power CLI, TUI and desktop, with no fake terminal
clipboard support.

Protocol/database migration 7 preserves old event identities, defaults,
ciphertext grants and recovery behavior. The [runtime contract](runtime-foundation.md)
records actual provider and failing native qualification; the [input contract](context-inputs.md)
records limits, consent, generated decoder measurements and restart boundaries.
SendBox remains unavailable until a genuinely qualified worker/model/tool
transport exists; a test-signed guest is not a production attested release.

## D20. Owned SSH worker bridge and late receipts

**Decision.** Use system OpenSSH (BSD) with one explicit pinned host identity,
user-selected local private identity, private remote state path and exact
installed worker build. Never disable host verification, forward an agent,
infer a workspace from its local name or silently tunnel localhost. Remote
models and tools run there; the local controller remains authoritative.

An owned Node supervisor forks the existing worker over real IPC and carries
bounded, versioned control frames over SSH. Transport keys live in the explicit
local secret backend and remote supervisor memory; private replay frames are
encrypted and credential-bearing controller replies are never journaled.
Durable local frame receipts bind sequence/digest to primary events atomically.
Reconnect/restart inspects an existing run, never creates another or replays a
side effect. Late usage can improve unknown accounting but cannot turn a
partial turn into successful work.

Model declarations are env-scoped. Remote-local discovery and inference
originate on the SSH host; Copilot forwarding is an explicit short-lived grant
and its model metadata is rechecked remotely. Project-free chats keep null
roots. Changed host keys, targets, workspaces, permissions and approvals fail
closed. Additional transports are qualified separately, never locally
substituted: protocol 17 adds read-only files/Git/plan, protocol 20 exact
provider-free plan saves, and protocol 24 [reviewed Remote MCP](remote-mcp.md)
with independent peer/resource access grants and no refresh forwarding.
Protocol 25 adds [owned Remote user consoles](remote-user-consoles.md)
through a separate pinned, bounded carrier with explicit env/peer/root
identity and the same SDK/client lifecycle. Qualified protocol 27 adds
[repository memory](remote-repository-memory.md) with actual-host bounded
source capture/freshness and atomic typed control-plane derived caches.
Session SDK/clients/model/MCP bind the same peer/root; legacy project APIs
remain explicitly Local. Optional memory is still off, its output untrusted,
and no protected transport falls back to Local.

Protocol/database migration 8 preserves prior inputs, settings and event/grant
identities. Actual generated macOS SSH, worker/file/model operations, image
transfer, lost-completion accounting and SIGKILL recovery qualify the core
path. This is not Linux release qualification, live Copilot entitlement or
detached-descendant containment. The [transport contract](execution-transports.md)
records measurements, ownership and remaining limits. Native SendBox still
requires the separately rebuilt/qualified guest and genuine worker transport.

## D21. Managed Local worktrees and root-scoped leases

**Decision.** Use the user's Git executable (GPL-2.0) and existing Node/SDK/store
without a second workspace database or new library. Unlike explicit Git
publication, automated worktree setup never executes repository hooks, filters,
fsmonitor helpers or submodule fetches. It creates a named non-protected branch
from a resolved local base; no implicit fetch, checkout switch, push or deletion.

Protocol101 makes an owned worktree the default for new single-project Local
Git tasks, atomically retaining its session binding with creation intent.
Explicit checkout preferences and existing roots remain unchanged. Unqualified
multi-repository automatic worktrees fail rather than editing original Git
checkouts. Code-change guidance targets a draft PR unless the actual user opts
out or the task makes no repository changes; it grants no GitHub permission.
The [repository workflow contract](repository-workflow-defaults.md) also keeps
actual-user script trust separate from model advice and normal execution
approval. New/generated/package scripts do not inherit that exact baseline.

Record exact private owned path, directory identity, common Git directory,
branch/base, change-set association and job intent before effects. Every
filesystem surface shares this binding, including memory/cache/MCP and terminal
cwd. Writers serialize per actual root and a failed worktree does not quarantine
unrelated branches. A changed/missing root fails closed, never becomes the base.

Removal requires clean, idle, unbound owned state, retains the branch/artifacts
and never force-deletes partial work. Restart marks unfinished intent partial;
explicit reconciliation checks the filesystem without replaying Git.
Session retention does not delete a worktree. Project relocation/removal blocks
while roots remain. Discovery reads registrations without adopting them.
Protocol/database migration 9 preserves older events, keys, grants, IDs and
defaults. [The contract](managed-workspaces.md) records the measured primitive,
Local slice and remaining Remote/Sandbox/orchestration boundaries.

## D22. Independent artifact keys and canonical provenance

**Decision.** Reuse Node AES-GCM, the explicit keychain and append-only SQLite
authority. Give each typed text document its own key and revision history,
separate from its source conversation. Plan, decision, answer, research note
and report are real classes, not headings in a session transcript.

Migration 10 transactionally rekeys legacy plans while preserving event
plaintext, IDs/sequences, receipts and content digests. Source promotion binds
the canonical event/text and actual user/model/tool actor; file authorship is
unknown, and manual entry is not proof of human authorship. User edits do not
relabel model text or grant instructions/permissions.

Project removal reviews an exact set/digest and explicitly retains to profile,
exports then deletes, or deletes artifact grants. Client exports use an explicit
save action and a new private file, never silent overwrite or repository
publication. Restart, concurrency, shared-content grants and rollback are
generated acceptance. Structured questions, repository materialization/local
commits and work-item/folder organization are separate slices in D23/D24.

## D23. Structured questions and actual-answer authority

**Decision.** Reuse the worker's real tool/delegation path and shared durable
composer. A typed model clarification is untrusted task context, not permission
to execute its contents. Routing respects explicit tool denials but does not
ask the user for redundant permission to ask a question.

Only an actual owning-turn/revision-bound user endpoint records actor `user`.
Choices do not consume unrelated draft text; freeform answers may atomically
consume the exact saved draft while preserving attachments. Cmd/Ctrl+Enter
still holds queued intent. Stop/restart cancels the wait without inventing an
answer or blocking cancellation behind a human response.

Migration 11 preserves prior state and adds source events plus explicit
answer-retention settings, on by default as requested. Answer, independently
keyed artifact/source actors, optional draft clearing and receipt commit
together. Models and delegated decision providers cannot reuse this endpoint
or promote automated answers into user-only Core memory. Their own evaluated
policy/call path remains a separate capability.

## D24. Reviewed repository artifact copies and associations

**Decision.** Reuse Node filesystem/crypto and system Git's independent-index
publication path. Folders and same-project work items are revisioned artifact
associations, never filesystem authority. Migration 12 projects missing legacy
associations as null without rewriting history; project retain clears the
removed work-item link.

Explicit Local previews bind source/history, canonical directory identity,
policy and optional new local branch/base. The owned job/receipt precede
effects. Copy an exact new private history bundle under `artifacts/`, without
overwrites or symlink aliases. Optional commit creates only a reviewed new
non-protected local branch; no checkout, push, signing or hook/filter execution,
and no changes to the real index or unrelated edits.

Partial/cancelled/interrupted effects preserve documents and quarantine the
root, never replay. Project removal revalidates a completed job, exact source
set, actual bytes and requested local commit before forgetting grants.
Independent exports, repository copies and automated answers never become
instructions or user-only memory. Remote/Sandbox publication remains
unavailable until its own qualified transport exists.

## D25. Cumulative reservations and explicit estimated admission

**Decision.** Reuse maintained pi-ai metering and SQLite events; never treat
adapter default cost zero as reported pricing. The generated
[metering prerequisite](budgets.md) proves cache totals and actual output-limit
forwarding before feature work.

Migration 13 preserves source history and imports legacy usage once by actual
step. Model-created children charge their owner; solver/side/subagent and future
routing/decision roles share admission. Persist the profile-owned reservation
with model start before dispatch. Provider reports settle once; unknown/lost
completion keeps capacity through source deletion, stop and restart. Late SSH
usage never rewrites a partial turn as successful.

Only explicit estimate-based finite controls are offered. USD needs fresh,
dated model-specific approved estimates; unbounded/unpriced history blocks
affected units. Separate hard profile policy is not a preference and cannot
be lifted by factory/default reset. Reported overages and output-bound
violations remain visible, never hidden by increasing a cap or refund.

SDK/CLI/TUI/desktop share cumulative status, policy and role/provider/model
dashboard. Budget exhaustion retains a deterministic checkpoint without an
extra model call or claimed commit. Exact bills, routed kupo wind-down,
approved committed checkpoints and broader repository/visibility metadata
remain separate qualification.

## D26. Immutable profiles over one root authority

**Decision.** Reuse Node/React/TypeBox (MIT), SQLite (public domain), the
existing AES-GCM compartments and explicit keychain backend. No new library,
provider loop or per-client database is introduced. Follow the
[profile contract](profiles.md).

Migration 14 preserves Default IDs, receipt results, ciphertexts, wrapped keys,
directories and credential names. New UUID profiles have owned private resource
markers and explicit creating/ready/partial state. Restart never replays setup;
retry/stop is an actual user action. Profiles cannot copy or merge accounts.

Every store/controller/client is scoped; a client property cannot be rebound
even by JavaScript assignment. A switch flushes old editors before constructing
the new client, blocks unsaved forms/dialogs/dictation and never moves owned work.
Native notifications and preview partitions bind profile plus session identity.
Shared verified public archives/official weights may deduplicate, while mutable
installs, captures, grants, memory/style/indexes and task content stay private.

Global environment policy and its per-profile replicas commit atomically,
preserving only actual running Local turn exceptions. Revision checks happen
after asynchronous initialization. Global estimated caps aggregate profile-owned
reservations; deletion/reset/switching cannot refund them. Content-free sequence
invalidation updates available capacity without exposing foreign model events.
Global startup preferences are shared intentionally, with a separate explicit
revisioned reset; profile resets preserve shared values and hard policy.
Remote writer identity uses the execution's captured pinned SSH key and
canonical root, not a profile's Local mapping or target alias. Existing
execution/quarantine events enforce that identity across restart without
rewriting durable payloads. Effective mode/acquisition, not a requested
read-only label, determines when the common writer lease is released.

## D27. Reviewed platform workflows and whole-session boundary

**Decision, 2026-10-22.** The owner requested the
[platform workflow extension](platform-workflows.md) through the same
control plane, SDK, CLI/TUI and desktop. It is a source extension, not a
declaration that the first milestone or unrelated deferred work is complete.

Sky has an exact turn/session lifetime; Terra is project/work-item scoped;
Glacier is independently retained and explicitly promoted profile-wide
compressed knowledge. Tiered model-context injection is separately off by
default. Per-note compartment expiry does not erase independently promoted
copies, retain source text in tombstones, or replay original creation commands.

Lifecycle hooks use the existing worker/tool path with exact user-authored
commands, bounded start/end triggers and actual approvals. They cannot create
model reservations before permission, run in tool-less/read-only roles, become
model context, or grant permissions. Reviewed installation, enabling and
execution remain distinct. Versions and complete bundle rollback are retained.

The selected marketplace is **repository-backed**, with reviewed exact Git
objects and inline compatible manifests. No hosted account, package installer,
mutable checkout, credential discovery or arbitrary plugin entrypoint is added.
Git/GitHub and Linear writes retain independent original user intent/results;
remote version checks and explicit protected-action confirmations do not claim
stronger external atomicity than the API actually supplies. Interrupted writes
are partial and never replayed.

Cache scope is npm/pnpm private registries/workspaces plus Python, Rust/Cargo
and Go. C# stays deferred. Native managers do not authorize host build scripts,
source distributions, toolchain downloads, ambient credentials or cross-profile
private-byte reuse.

The owner explicitly chose **qualified SendBox for guaranteed descendant
containment**. Native Local/SSH process groups remain limited for arbitrary
setsid/double-fork/reparenting. Global Sandbox-only policy blocks new native
turns without switching their Env or relabeling grandfathered Local work.
Only verification of the exact owned VM's absence establishes the complete
process boundary; it does not establish successful filesystem rollback,
permission or prompt-injection resistance. No unsupported macOS fork tracker,
privileged helper, PID inference or unrelated workload is substituted.

## D34. Session controls and owned interactive tools

**Decision, 2026-11-02.** Follow the
[session-control and tool contract](session-controls-and-tools.md) from genuine
merged protocol 86. Reuse the existing store, scoped SDK, worker, context,
GitHub/browser and native speech primitives. There is no new agent loop,
language-server framework, general-purpose scheduler or native OS controller.

TypeScript **7.0.2** moves from development-only to the runtime dependency
closure. Its pinned Apache-2.0 native async semantic API supplies real JS/TS
definitions/references through a closed, bounded virtual filesystem.
Playwright-core **1.64.1**, Apache-2.0, supplies bounded newly owned
Electron/Chromium batches without implicit browser downloads. Its normal
Local executor is separate from restricted document/data parsers and is not
SendBox containment. Restricted/read-only and non-Local app launches stay
blocked. Changed native/worker bytes require fresh qualification, never
earlier protocol-86 receipts.

Five independent protocol-87 markers commit atomically. Actual wait intents
fence current-turn and queued-command completions; retries, unknown results,
source changes and future tasks cannot release them. Navigation/bulk
attachment grants no new execution authority, and independent artifacts and
unknown budget capacity survive conversation deletion. Verified multiple PR
associations never move first-association candidate cleanup provenance.
CI/watch/reviews bind the original account/repository/head independently of
GitHub writes.

Voice enable/disable owns only the single pinned managed model. The factory
Ctrl+Space shortcut remains held push-to-talk; the microphone button remains
click-record/click-confirm. Protocol 88 adds `voice_shortcut_schema` and an
explicit optional `voice.shortcutMode` independent of the retained obsolete
button boolean. Absence means held, never inferred toggle; migration preserves
original values and ciphertext. Input-free warm-up
is not microphone access, and focused-composer standby has separate visible
consent and exact teardown. Native HTML uses its own opaque isolated renderer
without Moguri/Node/filesystem/network access. Genuine screenshot bytes are
retained under their original user/model tool actor and delivered in chat,
not implicitly promoted to model image context.

## D36. External agent harnesses (Claude Agent, Codex Agent)

**Decision, 2026-11-16.** Follow the [agent harness contract](agent-harnesses.md),
modelled on how T3 Code (MIT) drives Claude Code and Codex. A harness session runs
the user's own installed agent with the user's own sign-in: unmodified Claude Code
(Claude Agent) or the Codex CLI through `codex app-server` (Codex Agent). The
harness owns its model calls and tool execution; Moguri owns the session, event
history, an exact decision for every tool call it is asked about, stop records and
the Local root. D05's Moguri-owned loop is unchanged for every other model, and D05
does not make either harness a Moguri provider: no Kupo role, helper role or direct
model call can use it.

Anthropic's `@anthropic-ai/claude-agent-sdk` 0.3.325 (proprietary, Anthropic
Commercial Terms) is a pinned devDependency bundled into the Claude worker. Its
optional per-platform Claude binaries are overridden with an empty stub, so Moguri
never installs, runs or redistributes a bundled Claude Code. A `stream-json`
transport speaks the same control protocol without the SDK. Codex needs no
dependency: Moguri speaks the documented app-server JSONL protocol directly and
never installs Codex or brokers its tokens (T3's managed mode is not adopted).
Every harness runs in a Moguri-owned process group.

Harnesses are off by default and limited to Local, Unlimited, ordinary single-root
text chats, and Manual, Guided or Autopilot. Moguri cannot enforce finite budgets
because it cannot reserve before the harness's own model calls. Codex Agent asks
with `approvalPolicy: "untrusted"`; anything Codex runs without asking is adopted
only as a policy-allowed read, otherwise recorded as unconfirmed, and Codex Agent
is blocked under a default-deny policy. Migration 108 adds
`claude_agent_harness_schema` and four `agent.*` events; claude.ai login, finite
caps, Sandbox/Remote, steering and remembered harness tool grants remain
unavailable.

## D37. Hosted provider accounts and generic endpoint headers

**Decision, 2026-11-16.** Follow the [hosted provider contract](hosted-providers.md).
OpenRouter (API key or key-minting sign-in), the Anthropic API (API key only), the
OpenAI API (API key) and a ChatGPT account (Sign in with ChatGPT, OpenAI's
documented flow for open-source, local apps) are named providers built on the
pinned `@earendil-works/pi-ai` 1.3.0 providers, OAuth flows and locked refresh. No
other runtime, gateway or proxy is added. Credentials live only in the profile
secret backend; settings keep only which providers are connected and the ChatGPT
host ID. OpenAI API keys and ChatGPT sign-in are separate providers so billing never
mixes. Claude.ai subscription sign-in is not offered, and Claude subscription tokens
are refused, per Anthropic's credential policy. Generic endpoints gain plain
headers, header-scoped keys and explicit-only models; credential-bearing header
names must use the secret backend. Hosted models run in the Local Env only.

## D38. Covering-array milestone regression

**Decision, 2026-11-16, signed off by the project owner on #69.** Future
milestone regression and qualification select cells with a deterministic,
checked-in covering array instead of the full Cartesian product of the seven
composer axes. The array covers every supported pair of axis values and every
supported Env x selection x budget, Env x selection x input and Env x selection
x effort tuple, and it contains the 15 Env x selection client journeys. Manual
Kupo effort is not a supported cell: one test per Env proves all 24 Kupo
selection x non-default effort refusals happen before any session, event,
reservation, request or worker. The focused contract tests (actor/cap
questions, exact arbitrary windows, mixed attachments, finite native critique,
oversized witnesses and the conditional/failure criteria) keep proving per-axis
behavior.

The [`docs/implementation.md`](../implementation.md#milestone-acceptance-criteria)
criterion requires every supported combination to use the same control-plane
authorization and events; it never required exhaustive per-cell execution. The
full product stays available as `npm run test:matrix`, with the native
whole-run and complete-group merge tooling, for explicit release qualification.
Milestone 1's 2026-11-15 acceptance used the full product and stays recorded as
such; covering-array reports are never relabeled as full-product qualification,
and earlier reports keep their original meaning. The method, sizes and measured
times are in the [combination matrix contract](milestone-combination-matrix.md#regression-method-covering-array).

This changes test selection and reporting only. No control semantics, approval
policy, budget accounting, dependency, durable event, schema or migration
changes.

## D39. Moguri-owned Stainless automation

**Decision, 2026-11-17, owner choice on #12.** Stainless publishes no MCP,
automation API or external URL scheme yet (mbianchidev/stainless#22). Rather
than wait, Moguri drives the user's installed Stainless itself: detection reads
only `Info.plist`; agents get a new headless instance with a disposable profile
through the existing owned `playwright` tool and normal approvals; previews hand
one URL to the exact bundle with `open -a` for Local sessions only. It is off by
default, tested only on exact listed builds, and other builds need a user-run
check. No new dependency (`playwright-core` is already pinned, Apache-2.0) and
Stainless itself is never bundled. Protocol/schema 111 adds a metadata marker
and an optional setting; no event type changes. Integrating the future Stainless
MCP is [#80](https://github.com/mbianchidev/moguri/issues/80). Contract and
evidence: [Stainless integration](stainless.md).

## D40. OWASP Agentic Skills Top 10 follow-up (#45)

**Decision, 2026-11-17, chosen by the project owner from concrete options.**
Against the unchanged OWASP AST revision `d6f7d7d`:

- **AST05/AST08:** a built-in, versioned, deterministic indicator scanner runs
  over complete skill and script sources (code and instruction layers) and is
  shown in reviews and to the model. Download-and-execute, run-time install and
  decode-and-execute findings stop a model's "safe" script verdict; only the
  actual user's force can run such a script, or the user may explicitly accept
  that risk with an off-by-default Settings / Scripts switch. No external
  malware scanner is integrated.
- **Trusted folders (#70):** auto-admission is refused only for invisible or
  bidirectional control characters; every other finding is disclosed.
- **AST02/AST07:** per-profile saved Ed25519 publisher keys plus permanent key
  and exact-version blocks. A public transparency log or external PKI is
  excluded.
- **AST06:** Local whole-descendant isolation is excluded; Local is host
  execution by design, Sandbox is the isolation boundary and the existing
  allowed-environments policy can require it. Remote reviewed scripts stay
  unsupported; Remote skill loading was added later the same day by
  [D42](#d42-remote-skill-packages-over-ssh).
- **AST01:** qualification uses generated models only; live-model resistance
  testing is excluded.

No new dependency is added. Protocol/schema 112 adds `skill.publisher_saved`,
`skill.trust_blocked`, the `saved-ed25519` publisher kind and
`settings.scriptReview`, with lineage checks. This is not OWASP certification.
The [category matrix](file-access.md#owasp-source-and-review-boundary) records
controls, evidence and the signed-off exclusions.

## D41. OTLP logs, credential headers and coverage (#23)

**Decision, 2026-11-17.** Extend the [metadata-only exporter](otlp-export.md)
rather than adopt OpenTelemetry auto-instrumentation: an opt-in log signal of
fixed-template outcome/correction records correlated with their spans, finite
`error.type` outcomes, a correction log instead of duplicate spans, and
credential headers whose values live only in the profile secret backend, bound
to the collector origin. Logs or headers need a fresh disclosure-2 review;
traces-and-metrics configurations keep disclosure 1 and their protocol-97 shape. SSH
peers and Sandbox guests are not instrumented: their accepted outcomes are
exported from control-plane records, and in-process propagation stays an
explicit coverage gap. `@opentelemetry/sdk-logs` 3.1.0 (Apache-2.0, already a
transitive dependency) is pinned directly for its log record type. Telemetry
stays off by default, never becomes a second ledger and grants no authority.

## D42. Remote skill packages over SSH

**Decision, 2026-11-17, requested by the project owner and chosen from concrete
options.** Remote sessions can load skills on demand; Local skill sources are
the user's trusted input. Admission is unchanged: enabled folders and imported
skills auto-admit read-only, HTTPS archives and skills with hidden or
bidirectional control characters need explicit review, and blocks/revocation
apply as in Local. A Remote grant binds the pinned SSH peer, the project's
explicit canonical remote workspace and its root lease, never a Local root.

The complete skill text enters the agent's context as in Local. On first use
the complete admitted text package, including bundled scripts, is copied over
the existing authenticated bridge into `<state>/skills/<artifact SHA-256>/` on
the SSH host, verified per file and atomically published. Those exact files run
only through ordinary `run_command` approval: the unreviewed-script guard
exempts their exact paths while the grant is active, and the service re-proves
(or restores) the package before each such command. A failed copy is disclosed
in the load; nothing falls back to the controller. SSH remains host execution,
not isolation; Remote `review_script`/`run_script` and Sandbox skill transport
stay unsupported. No new dependency or durable event is added. Contract:
[Remote skill packages](skills-and-rewind.md#remote-skill-packages-protocol-112).

## D43. Steer-backgrounded commands

**Decision, 2026-11-17, requested by the project owner and chosen from concrete
options.** While the agent waits on a running `run_command`, a user steer no
longer waits for the command. The worker returns "Read interrupted by user
steering; shell continues in background." as the call's result, the remaining
calls of that response are not run, and the steer applies. The process keeps
its original timeout and owner. Its actual result is retained as
`tool.background_completed` and given to the agent as a service notice at its
next step. If the agent finishes first, the turn waits for the command (the
owner's choice over stopping it or letting it outlive the turn), then lets the
agent respond. Stop and failures still stop it. No dependency is added; schema
112 adds the event and a lineage marker. Contract:
[steering while a command runs](session-interactions.md#steering-while-a-command-runs-protocol-112).

## D44. Confirm before stopping running sessions

**Decision, 2026-11-17, requested by the project owner.** Desktop, TUI and CLI
always ask before archiving or deleting a running session, even when the user
turned off archive/delete confirmations ("don't ask again"). Running means an
active turn (including one waiting for an approval or answer) or a running owned
job anywhere in the affected tree; bulk actions and project removal follow the
same rule. The service is the backstop: `session.archive`, `session.delete`,
`sessions.bulk` and `project.remove` refuse with `session_running` unless the
client sends `confirmRunning: true` after showing the warning. Automatic
retention already never archives running sessions. No durable event or schema
change. Contract:
[running-session confirmation](session-interactions.md#running-session-confirmation-protocol-112).

## D45. Pull request follow-up actions

**Decision, 2026-11-17, requested by the project owner and chosen from concrete
options.** Code Change shows Address code review, Fix merge conflicts and Fix
CI for the session's linked PR, enabled only when they apply (the owner chose
status gating over always-on buttons or new child sessions). A fresh bounded
read of the PR, its reviews, head checks, GitHub mergeability and the checkout
branch decides; nothing is retained. A click queues the `address-review`,
`fix-conflicts` or `fix-ci` workflow preset in this chat, so every push or
reply stays an ordinary approved tool call. Local sessions only. No dependency
is added; schema 112 keeps the new workflow kinds out of older lineages.
Contract: [pull request follow-up actions](session-github-workflows.md#pull-request-follow-up-actions-protocol-112).

## D46. Clean pushed worktrees when archiving

**Decision, 2026-11-17, requested by the project owner and chosen from concrete
options.** Archiving a session removes its Moguri-created worktree and deletes
that worktree's local branch, but only when the worktree is clean (no
uncommitted or untracked files, and no ignored files beyond rebuildable
dependency, build and cache output), the branch still points at the worktree's
head, and that head is already on a remote-tracking branch. Otherwise both are
kept and the reason is recorded on the worktree. This replaces the earlier rule
that archive never touches a workspace or branch. It is a Retention setting,
`retention.archiveBranchCleanup`, on by default (absent means on), so branch
deletion stays an explicit user action under a user policy. Restoring the
session recreates the worktree from the recorded head and remote branch (the
owner's choice over a fresh base-branch worktree or a read-only session); a
different local branch with the same name blocks the restore instead of being
replaced. Deletion is an exact compare-and-delete (`git update-ref -d` with the
recorded head), and a worktree that `git worktree remove` refuses stays ready.
Sessions without a Moguri worktree (checkout or folder sessions) are untouched.
Schema 112 keeps the new worktree fields and setting out of older lineages.
Contract: [archive cleanup](managed-workspaces.md#archive-cleanup-and-restore-protocol-112).

## D47. Moguri virtual disk for session worktrees

**Decision, 2026-11-17, requested by the project owner and chosen from concrete
options.** An optional, user-sized APFS sparse disk image (macOS `hdiutil`,
system tool, no new dependency) holds new session worktrees, so session work
can't fill the Mac. The owner chose a real disk image over a Moguri-measured
folder budget, worktrees only (the encrypted store stays outside so Moguri can
always start and record what happened), and this pressure policy: below a free
space reserve (5% of the size, at least 512 MiB), Moguri first parks the oldest
archived worktrees that are clean and fully pushed (the D46 primitive), then
pauses work on the disk until free space returns above 125% of the reserve.
Paused means queued turns wait and running turns wait before their next model
call; Stop still works and nothing uncommitted or unpushed is removed. The disk
is global and root-owned, shared by every profile, and stays mounted across
service restarts so user terminals in its worktrees survive. Resizing needs no
running work on the disk; turning it off needs no worktrees on it. Existing
worktrees stay where they were created. Phase 0 measurements and the contract:
[virtual disk](virtual-disk.md).

## D48. Queued prompts look like sent prompts and edit in place

**Decision, 2026-11-18, requested by the project owner and chosen from concrete
options.** Desktop queued prompts render like sent prompts with a dashed
outline, at the bottom above the composer, and keep drag/Alt+Arrow reordering.
Hover or focus shows icon-only Copy, Send now and Delete; clicking a prompt
edits it in place with icon-only Attach, Cancel and Save. While editing, every
composer attachment source works (project files and folders, local files,
images, documents, GitHub, sessions); captures are staged in memory for that
prompt and saved only by Save, never into the draft and never sent. Send now
steers the prompt into the live solver turn (the owner's choice over stopping
the turn or moving it to the front); with no live turn it runs the prompt next:
released, moved to the front, resuming a paused chat. Commands, scheduled
prompts and workflow or delegated tasks can't steer. New
`queue.send-now`; `queue.edit` gains an optional complete `attachments` list;
attachment captures accept `queueItemId`. They emit only existing events, so no
schema change. Contract:
[queued prompt editing](session-workspace.md#queued-prompt-editing-and-send-now).

## D49. Skills and Artifacts workspace tabs

**Decision, 2026-11-19, requested by the project owner (#82).** Skills and
Artifacts join Automations in the left navigation. Skills has three sections:
installed skills with immediate On/Off switches, a marketplace whose
configurable repositories are the existing skill sources (installing re-reads
the exact bytes and creates a disabled skill in one project or every project),
and the agent's built-in toolsets plus custom scripts that users write or ask
the agent to write and then review and turn on. Settings / Skills keeps
import, admission and publisher trust. Suggestions detect repeated requests a
script tool could handle with a deterministic local phrase match; an optional
recurring automation (off by default; every 6, 12, 24 or 168 hours while
Moguri runs, no catch-up) raises one sessionless Inbox entry per suggested name.
Artifacts lists, per project, metadata of build outputs in the checkout and
session worktrees, agent-written files, chat images, links and retained
documents, each linked to its chat; the desktop's All projects scope combines
those per-project lists with project-free chats. Finder reveal re-verifies the exact listed
path and never opens or runs a file. Built-in tools are listed, not toggled:
switching them off per profile was not requested and would change every
chat's catalogue. Protocol 114 adds `skill.install`, `tooling.toolsets`,
`artifacts.library`, the `automations` setting and the `tool-suggestion` Inbox
reason, with marker `tool_suggestion_automation_schema`. Contract:
[skills, tools and artifacts](skills-tools-artifacts.md).

## D50. Recurring automations and declarative workflows

**Decision, 2026-11-19, chosen by the project owner from concrete options for
[#6](https://github.com/mbianchidev/moguri/issues/6).** Protocol 115 adds
service-owned automations: a name, an explicit project, a `once`, `interval`,
`daily` or `weekly` schedule in an IANA timezone, 1 to 10 prompt or script
steps and controls captured once from the project defaults plus explicit
overrides. They run only after explicit actual-user activation. **Each run
starts a new chat** in the project with the captured model, Env, autonomy and
budget (owner's choice over queueing into one chat). **Script steps are
model-free**: the service runs the exact repository-trusted entrypoint, Local
only, rechecking the trust baseline under normal approval (owner's choice over
an agent-run step). **Missed occurrences run once** when Moguri is back and
record the missed count; **an occurrence is skipped and recorded while the
previous run is still active** (owner's choices). Nonexistent DST wall times
shift forward by the gap; repeated ones run at their first occurrence. Steps
chain on `completed` turns; any other outcome ends the run. Restart marks
unfinished creation `partial` and unstarted script steps `blocked`, and never
replays a step. New `automation.recorded`/`automation.run_recorded`, optional
`QueueItem.automation` and `TrustedScriptAttempt.automation`, marker
`automations_schema`. Desktop, TUI, CLI (YAML/JSON workflow files) and SDK share
the state. One-time scheduled prompts are unchanged. Contract:
[automations](automations.md).

## D51. Save drafts on close and continue interrupted chats

**Decision, 2026-11-19, requested by the project owner and chosen from concrete
options.** Closing the desktop window or quitting first finishes saving
composer drafts and an open in-place queued-prompt edit, then closes without
asking; the dialog appears only when saving fails, and explicit-save values
keep the existing confirmation. The service records chats that a quit, service
restart or crash interrupted: the ordinary agent turn that was running and the
prompts that were waiting (never prompts the user held). Continue releases
those prompts and, when a turn was running, queues the built-in continue
workflow ahead of them, which inspects state and never replays effects.
Dismiss forgets the record. After a restart desktop asks with per-chat
Continue, Continue all and "Don't ask again", which saves
`interactions.continueInterrupted: "always"` so later restarts continue every
interrupted chat once after model discovery. New
`session.interruption_recorded`, `session.continue`,
`session.interruption.dismiss` and marker `interrupted_sessions_schema` at
protocol 115. Contract: [saved drafts and interrupted chats](interrupted-sessions.md).

## D52. Customize tab, every-chat scripts and reviewed model GitHub writes

**Decision, 2026-11-20, requested by the project owner.** The Skills tab is
renamed **Customize**. Its Tools section isn't tied to a project: scripts
written there, or proposed by the agent from a project-free chat, apply to
every chat (`projectId: null`), and a project script with the same name
shadows them in that project. Hooks and memory still need a project.

Agents get typed tools for work that session history showed being repeated
through ad hoc `gh api`, `curl` and page-by-page fetching, to contain token
spend: bounded `github_read` resources (tags, latest/tagged release, check
annotations, file contents, repository settings, rulesets, branch rules),
`web_fetch` `find`/`offset` and a 10-minute in-memory page cache that rechecks
web access on every call.

The owner chose to include reviewed model writes. This supersedes the earlier
rule that model-originated GitHub writes were only `create_issue` and
delegated `project_work`: the `github_write` tool may preview and execute
the `GithubModelActionSchema` subset (issue/PR comments and updates, draft PR
creation, comment edits, review replies, thread resolve/unresolve, releases
and repository settings) through the existing reviewed pipeline, only for the
project's discovered repository and account, and only with an actual tool
approval or current user delegation recorded as `toolCallDigest`. Merges,
review submission/approval, comment deletion, remote URL changes, CI watches,
visibility, archiving, renaming, transfer and deletion stay user-only.
Protocol 116 (shared with this change's live Git upstream and durable root
identity work) adds no event type or marker. Contracts:
[skills, tools and artifacts](skills-tools-artifacts.md) and
[GitHub workflows](github-workflows.md#model-github-writes-protocol-116).

## D53. Queued prompts you held start after each completed turn

**Decision, 2026-11-20, requested by the project owner.** By default, when a
turn completes, the service releases the top prompt in that chat's queue that
the user held (Cmd/Ctrl+Enter or a held send), so queued work runs one turn at
a time, top first, without another click. Holding in an idle chat still starts
nothing. Only `completed` turns advance; stopped, failed and partial turns,
paused or blocked chats, steers, subagents and prompts the service held for
review (stop, rewind, archive, restart recovery) keep waiting for Send now or
Resume. The release (`queue.released`) commits with the `turn.finished` event,
and that commit queues no session wrap-up, which follows the last queued
request as for unheld queued work. **Settings / Sessions / Confirmations** turns
this off with `interactions.autoSendQueue: false` (absent means on). Protocol
117 adds only that optional flag: no event type, marker or row migration.
Contract: [held prompts](session-workspace.md#held-prompts-and-shared-actions).

## D54. Getting started, an optional name and a quieter desktop look

**Decision, 2026-11-20, requested by the project owner.** The desktop opens
**Getting started** in the main pane for a profile whose settings have no
`onboarding` record (hidden test windows skip it unless
`MOGURI_TEST_ONBOARDING=1`). It asks, one step at a time, for an optional name,
an accent palette, the theme and a few behaviors (auto-send held prompts, chat
titles, wrap-up, desktop notifications, the needs-input sound, automatic
updates and the menu bar). Choices save as they change, like Settings; the
name saves on Continue. Finish or Skip setup records
`onboarding.completedAt`; **Settings / General** edits the name and restarts
the flow, which never resets saved choices. Opening a chat closes it.

The name (`user.name`, at most 80 characters, no control characters or angle
brackets, absent by default) greets the user and enters each chat's system
prompt in a `<user-name>` block, so the model provider receives it. It is a
courtesy preference, not identity proof or permission, and the user is told
this before saving.

The desktop moves from a green-tinted base to neutral near-black and near-white
surfaces with hairline borders, tracked uppercase section labels and underline
tabs, keeping every element where it was. Icons are `lucide-react` (ISC) at
one stroke weight; model brand marks stay drawn. An **Amber** palette joins
the shared catalog, with the same measured contrast checks as the others; the
Moguri palette stays the factory default. Protocol 117 (unreleased) carries
the two optional settings: no event type, marker or row migration.
Contracts: [design](../design.md), [General](../settings/general.md) and
[Appearance](../settings/appearance.md).

## D55. Kupo classes models by published price and adds Dynamic

**Decision, 2026-11-20, requested by the project owner.** Savings and
Performance no longer require a hand-reviewed profile for every model, which
in practice left only Balanced usable. A model's class now comes from, in
order: its current reviewed profile; execution-host loopback endpoints, which
are economy (no API fee); else its exact, unambiguous published output API
price in Moguri's price table (bundled or refreshed): up to $5 per million
tokens is economy, $20 or more is frontier, and anything between is standard.
Matching uses the same exact ID/name aliases as budget estimates; it never
guesses from a model family, and the table's age affects budget estimates, not
the class. Unpriced network models without a profile stay unclassed and run
only under Balanced rules. Price is a class signal, not a quality score or a
bill. Cascade still needs reviewed scores and Critique a reviewed lineage pair;
D56 later replaced both requirements with price classes and AI labs.

**Dynamic** is a fourth mode. It routes over the Balanced pool and tells the
classifier each model's class and admitted modes. After classification it
applies Savings to simple or README/summary/trivial work, Performance to
complex substantive work and Balanced otherwise, but only when every chosen
model is admitted to that mode (Performance also needs frontier models) and any
advised effort is one that mode allows; otherwise Balanced's rules apply. The
applied mode is recorded as `plan.mode` on the routing turn and shown in
Insights; later roles use that mode's effort rules. Before classification, or
with one eligible model, Balanced's rules apply. A fixed mode the user chose is
never replaced. Protocol 117 (unreleased) carries the new mode value and
optional capability fields: no event type, marker or row migration. Contracts:
[automatic Kupo](automatic-kupo.md) and
[Kupo routing settings](../settings/kupo-routing.md).

## D56. Kupo workflows: price-class Cascade, cross-lab Critique and Council

**Decision, 2026-11-20, requested by the project owner.** Automatic Kupo ran
only Single in practice, because Cascade needed hand-reviewed comparable scores
and Critique a reviewed different-lineage pair. The owner explicitly replaced
those requirements for the defaults: "Cascade: cheaper price class drafts,
pricier class escalates. Critique: critic from a different AI lab (from model
ID)", added a **Council** of at least three AI labs, and asked that each mode
have its own settings. Reviewed comparable pairs and reviewed lineage pairs
stay valid; they are no longer the only way in.

- **Settings.** `kupo.workflows` (absent means every workflow on): Cascade
  `enabled` and optional `classes` (model ID to economy, standard, frontier or
  `excluded`); Critique `enabled` and unordered `labPairs` (empty means any two
  different known labs); Council `enabled`, `labs` (empty means any) and `size`
  (3 to 5 models, one per lab). Lab pairs need two different known labs with no
  duplicates and Council labs must be known; Single is always available.
- **Classes.** A model's class comes from its current reviewed profile, then
  execution-host loopback (economy), then the output price its pay-per-use
  provider declares (OpenRouter style, new here), then its exact published
  price (D55). For Cascade only, the user's `classes` override ranks after a
  reviewed profile, and `excluded` always removes the model from Cascade.
- **Cascade** pairs a draft whose class is strictly cheaper (economy, then
  standard, then frontier) with a pricier escalation. The gate and escalation
  bounds are unchanged.
- **Critique** pairs a drafter and critic from different known labs, from the
  model ID, API ID, display name or direct provider (`modelLab`), never two
  bindings of one provider model. `unknown` never counts as a lab; unidentified
  local models count as one `local` lab. Lab pairs drop the same-cost-class
  rule; reviewed lineage pairs keep theirs. **Lab labels are name-based, not
  proof of independent training.**
- **Council** binds one drafter and `size - 1` reviewers, every model from a
  different known lab. The drafter drafts; each reviewer, in plan order and
  without seeing the others, returns a tool-less pass, revise or reject on the
  same draft. All pass selects the draft. More than half of the reviewers
  rejecting stops the response with no tools or other model. Otherwise (any
  revise, or a minority reject) the drafter revises once with every critique
  as labelled untrusted data, and the whole council reviews the revision
  within `automaticLimits.maxRevisions`; exhaustion never accepts an
  unreviewed response. Finite budgets reserve the complete role set before the
  draft (up to 32 roles), and `routing.response_selected` records every
  reviewer's step in `reviewStepIds`; the projection requires each reviewer's
  original metered pass on that exact source, in order.
- **Modes.** Every mode chooses thinking effort per request by task complexity
  and caps it at xhigh: Kupo never chooses Max, which tends to degrade results
  (owner decision, 2026-11-21; a retained request is retried with its exact
  original effort). Savings runs Single and Cascade with economy and standard
  models at low to High. Balanced runs every enabled workflow but, when the
  estimated solver input exceeds 32,768 tokens, never solves or drafts with a
  frontier model while a non-frontier one is eligible (escalations, critics
  and reviewers may still be frontier). Performance runs Single, Critique and
  Council, mainly with frontier models, at High for simple tasks and xhigh
  otherwise (High where a model has no xhigh), never lower. A
  model whose thinking is a token budget (some Claude models through
  `anthropic-messages`) therefore qualifies for Performance Single at High, but High's thinking budget does not fit the
  bounded 8,192-token draft or 512-token review roles. Dynamic applies the
  mode it wants only when that mode allows the chosen workflow; otherwise
  Balanced's rules apply.
- **Routing.** The classifier sees the workflows each request may use, the
  eligible pairs, Council members with their labs, `longTask` and, for
  Dynamic, each mode's workflows. `automaticPlan` deterministically refuses a
  switched-off, mode-excluded or ineligible workflow, pair or council; its
  output stays untrusted advice. Mode-less legacy selections keep their
  original contract, cannot run Council and cannot run a switched-off
  workflow. `routing.modes` reports each mode's workflows with eligible pairs
  and Council models.

Protocol 117 (unreleased) carries the optional settings, plan, routing-turn,
capability and selection fields: no event type, marker or row migration.
Contracts: [automatic Kupo](automatic-kupo.md) and
[Kupo routing settings](../settings/kupo-routing.md).

## D57. Skills list, per-skill switches and marketplace trust

**Decision, 2026-11-20, requested by the project owner.** Capabilities / Skills
and Settings / Skills show one shared list of every skill the profile knows,
grouped by where it came from. Groups start expanded on the Capabilities page
and collapsed in Settings, which reads its sources only once a source group is
opened. Groups, in order: each GitHub repository the user marks as their own,
labeled **Personal - {repo name}**; each marketplace source, labeled with the
name the user gave its provider; each local skill folder (such as the global
`~/.agents/skills`); plugin bundles; then skills imported or installed for **All
projects** and for each **Project - {name}**. A copy installed from a source
(`skill.install`, which now records `installedFrom`) sits in that source's group.

Every skill has its own switch, which saves immediately. Skills from a personal
repository or a local folder are on by default. Skills from a marketplace
(any remote source not marked personal, including every remote source saved
before this change) are off until the user clicks **Trust**. Trust is the
`skill.trust` command: the service re-reads the source, checks the exact
SKILL.md SHA-256 and the complete package SHA-256 (every file in the skill's
folder) and records them with `actor: "user"` and the command's identity. A
generic settings write or an applied configuration proposal cannot add or
change a trust record. If the marketplace changes the skill, it shows
**Changed** and stays unavailable until trusted again. Trusting is not a
permission: it grants no tools, approves no call and never changes policy.
Installed, imported, approved and bundled registry skills keep their existing
`enabled` flag and `capability.toggle`.

The service enforces this, not only the clients. Session-scoped skill discovery
and reads (`use_skill`, the slash menu, `/skill` and `skill.use`, `skill.consume`
and admission inspection) offer and load only source skills that are on. A
trusted-folder load binds the settings event that started the skill's current
on (or trusted) period, so turning a skill off revokes later effects in chats
that loaded it, and turning it on again needs a fresh load. A remote marketplace
skill loads with the same trusted-source basis once trusted, which replaces the
earlier rule that an archive skill needed a signed per-chat admission before any
load; signed admission still works and still restricts tools.

Existing state keeps working: registry skills keep their switches, local folder
skills stay on, and an untrusted marketplace skill that a chat already admitted
through explicit signed review stays usable in that chat unless the user turns
it off. Remote sources saved before protocol 117 were never loadable without that
review, so treating them as marketplaces disables nothing the user had active.
Protocol 117 (unreleased) adds the optional `skillSwitches` setting, the
optional `personal` flag on remote sources, `skills.list`,
`skill.source.toggle`, `skill.trust` and the optional
`CapabilityEntry.installedFrom`: no event type, marker or row migration.
Contracts: [Skills settings](../settings/skills.md) and
[skills, tools and artifacts](skills-tools-artifacts.md).

## D58. Project-free automations and automation runs in Inbox

**Decision, 2026-11-20, requested by the project owner** ("Automation can have
no project"; "Automation runs are notified in inbox"). This amends D50's
explicit-project rule. An automation may have `projectId: null`. Each run of a
project-free automation creates an ordinary project-free chat through the same
`session.create` path as any chat without a project: a Local run captures the
configured Home binding (`homeRoot`) as in
[project-free execution](project-free-execution.md), and a Sandbox or Remote
run never acquires that Local root. No synthetic, inherited or last-used
project is created or borrowed, and controls resolve from the global and
profile defaults plus explicit overrides. Script steps still need a project,
because only a project has repository trust, so a project-free automation
holds only prompt steps. Project automations are unchanged.

Every run's start and outcome become Inbox entries (`Attention.reason:
"automation"`, kind `done` when completed and `bell` otherwise) that link to
the run's chat. The start entry is raised once the run's chat exists; the
outcome entry (`completed`, `failed`, `stopped`, `partial`, `blocked` or
`skipped`) clears the run's still-active start entry. A run that never created
a chat (skipped, or blocked before creating it) links to Automations instead.
Each entry copies the run ID, revision, name and status
(`Attention.automation`), and the projection refuses an entry that does not
match its exact run. Each run status is raised at most once, so reading or
deleting an entry never brings it back. Entries use the existing read
acknowledgement, deletion, in-app dot and OS banner settings, and opening the
run's chat marks them read like other chat notifications. Reading, opening or
deleting an entry is not an answer or approval and never resumes, stops or
reruns anything. Protocol 117 (unreleased) carries the nullable `projectId`
and the optional attention field: no event type, marker or row migration.
Contract: [automations](automations.md).

## D59. Grouped model lists, Capabilities, Boundaries and calmer navigation

**Decision, 2026-11-20, requested by the project owner.** Desktop navigation and
lists change presentation only; no capability, permission or save rule changes.

- Every model list (Settings / Providers, Kupo's pool and Cascade classes, the
  legacy approved solvers) groups models by the provider that serves them, then
  by AI lab (`modelLab`, D56) when a provider spans several labs. All groups
  start collapsed. **Order by price** lists free models first (execution-host
  local models and zero declared prices), then priced models from the cheapest
  output price, then unknown prices. **Providers** and **AI labs** filters narrow
  the list. Prices come from a pay-per-use provider's own catalogue
  (`ModelOffering.price`) or Moguri's published API-equivalent table, exposed as
  `Snapshot.modelPrices`; missing prices are never zero.
- The **Customize** sidebar page becomes **Capabilities** and gains an **MCP**
  tab to add, switch on or off and remove MCP servers. The same panel heads
  Settings / MCP gateway, which keeps credentials, OAuth and tool discovery.
  Adding a server grants no tool permission.
- The Settings page **Execution & permissions** becomes **Boundaries** (search
  still matches the old words). Under the open page the rail lists its sections
  as anchor links.
- The sidebar's **Archived** tab lists only projects with archived chats, and
  **Issues** only projects whose Kanban has open issues.
- **ask Moguri** (the desktop button, `/meta` and `/metachat`) always opens a new
  top-level chat, never a child of the chat that was open. **Resume queued work** is an icon-only play
  button with the same accessible name.

Protocol 117 (unreleased) carries the optional `modelPrices` snapshot field and
offering prices: no event type, marker or row migration. Contracts:
[design](../design.md) and [Providers](../settings/providers.md).

## D60. Autonomy and Remote host labels, /ssh

**Decision, 2026-11-21, requested by the project owner.** Only display names
change; behavior and every stored value stay the same.

- The autonomy value `Autopilot` is shown as **Autonomous** and `Autopilot Max`
  as **Autopilot**. Manual and Guided are unchanged. The shared
  `autonomyLabel`/`autonomyValues` helpers in `packages/protocol` drive the
  desktop, TUI, CLI and slash text.
- The Env value `Remote` is shown as **Remote host** (`envLabel`). The Settings
  page keeps its **Remote SSH** name, and feature names such as Remote MCP,
  Remote plan saves and Remote consoles are unchanged.
- The `/remote` slash command becomes `/ssh` with the same arguments. `/remote`
  still runs it as an unlisted alias, like `/metachat`; it appears in no menu
  or help. The CLI keeps `moguri remote`.
- Typed `/autonomy` accepts Manual, Guided, Autonomous and Autopilot in any
  case, so `autopilot` now selects the stored `Autopilot Max`; the legacy text
  `Autopilot Max` still works. `/env` accepts `Remote host` and `Remote`.
- Schemas, events, settings, policy `allowedEnvs`, SDK methods and CLI/SDK JSON
  keep `Manual`, `Guided`, `Autopilot`, `Autopilot Max`, `Local`, `Sandbox` and
  `Remote`. No event type, marker, migration or protocol bump is needed.
  Earlier decisions keep their original wording.

## D61. Agent browser control persists for the chat; Stainless runs agent automation when on

**Decision, 2026-11-21, requested by the project owner** ("Agent control of
browser needs to persist for the whole session. Also, make sure the embedded
browser gets runs on Stainless if that integration is on."). The owner chose:
control stays on for the chat's lifetime, across panel and chat switches and
pane reloads, and turns back on automatically after an app restart until the
user switches it off; while Stainless is on, every agent browser automation
(the `playwright` tool) launches Stainless instead of Chromium, and the
Browser pane stays the in-app preview.

- **The user's choice is durable; control identities are not.**
  `Session.browserAgentControl` records the choice per chat. Only the user's
  `session.browser.control` command writes it (the pane switch,
  `sdk.sessions.browserControl`, `moguri browser agent on|off`), as an optional
  `browserAgentControl` change on `session.organized`. `session.organize`
  rejects that field, and no model tool, builtin browser tool, decision model
  or automation has a path to it. Turning it on needs an active Local agent
  chat that is not read-only. Every enable still mints a new `controlId`:
  earlier approvals, element references and website-scope admissions never
  carry over. Browser leases stay ephemeral.
- **Re-enable.** When the chat's pane attaches (chat switch, profile switch
  back, window reload, app restart, or a host whose poll loop ended), the
  desktop host turns control back on with a fresh identity. User navigation in
  the pane still revokes the current identity and unloads the agent-controlled
  document under the existing network gate, then re-enables after the
  navigation settles. Permission and autonomy changes revoke as before and
  re-enable with a fresh identity. A failed poll or the 8-second watchdog
  revokes without erasing the choice; control returns when polling recovers.
  Failed automatic re-enables back off up to 30 seconds.
- **Clears and suspensions.** The user's off records `false`; the service
  revokes at once and refuses a later host enable. Archiving clears the choice
  and restoring does not bring it back; deleting removes the chat. Read-only
  mode, an Env other than Local and an allowed-Env policy without Local only
  suspend it: control stays off, the pane says it is paused, and it returns
  when the cause clears. A profile switch closes the view; the choice stays
  with the chat in its own profile.
- **Hidden pane.** The desktop keeps its single native browser view. When the
  Browser panel leaves the screen (another panel, a modal, another chat
  without its own Browser pane, a window reload) and the choice is on, the view
  and host stay alive but hidden (`setVisible(false)`, background throttling
  off), so approved tools keep working with the same identity. The view closes
  when the user turns control off or the choice is cleared, another chat's
  Browser pane needs it (that chat's choice stays recorded), the profile
  switches, its host's poll loop ends while hidden, or the app quits. One view
  per window keeps the existing isolation and cleanup ordering, so no cap is
  needed.
- **Stainless by default.** While `integrations.stainless.enabled` is true, an
  approved `playwright` batch with `launch.kind: "chromium"` launches the
  installed Stainless (new headless instance, disposable profile) instead of
  the executable the model named, when automation is `ready`. When Stainless
  is on but missing, untested or incompatible, the batch fails before
  launching with `stainless_unavailable`; it never falls back to the named
  executable. Off leaves Chromium launches unchanged, and Electron launches
  are never redirected. The desktop approval card says which browser will run
  and the result's `browser` field says which ran. Every other owned-Playwright
  contract is unchanged: Local only, disposable profile, exact website scope,
  approval, 25-second batch, no replay.
- **Schema.** Protocol 117 (unreleased) adds the `session.browser.control`
  command, the optional session field and `session.organized` change, and the
  private `stainlessDefault` flag on the worker's approval reply. No event
  type, marker or row migration. Contracts:
  [browser control](agent-browser.md) and [Stainless](stainless.md).

## D62. Integrations show their own logos

**Decision, 2026-11-21, requested by the project owner.** Each Settings /
Integrations section title shows the service's own mark: GitHub, Linear and
Model Context Protocol from Simple Icons (CC0), and the Stainless app icon from
its Apache-2.0 repository. sql-not-so-lite publishes no app logo, so it uses a
neutral database icon until it does; Plugins and Marketplace are Moguri's own
features and keep interface icons. Marks are decorative (`aria-hidden`), so
section names and accessible names are unchanged. Provenance is recorded in
[third-party notices](../third-party.md).

## D63. GitHub item lists, session branches and highlighted files

**Decision, 2026-11-22, requested by the project owner.**

- **Lists.** The Code change and Work item panels, the project's From PR and
  From work item dialogs and the Kanban GitHub picker list existing items, open
  first. They load only open items until **Show closed** is switched on, which
  then also lists closed and merged items. Each row shows GitHub's state mark:
  open green, closed red, merged purple, completed issues purple and draft PRs
  neutral. The marks always have a text label.
- **Merged PRs.** GitHub's pull list has no `merged` boolean, so `merged_at`
  also marks a PR as merged. An exact source review (`github.source`) accepts
  merged PRs. Before this, choosing a merged PR failed with "The returned
  GitHub item did not match the exact selected repository, account and number".
  Claims and comparisons of project work still require an open item.
- **New branch.** A new chat starts as a normal chat. The agent still opens a
  draft PR by itself after code changes ([session wrap-up](session-lifecycle.md)). From Code change, the
  user can create the session's remote branch:
  - The session branch is pushed as is.
  - With another name, the branch is first renamed (managed worktree) or
    created and checked out (original checkout).
  - Each step is a separately reviewed Git action with its own confirmations.
    Pushes never force or replay.
  - The agent keeps committing on that branch, so its later pushes and draft
    PR use it.
  - Starting from a PR or work item needs an existing item; those dialogs have
    no create action.
- **Files.** The read-only Files view highlights syntax with `lowlight` (MIT)
  over `highlight.js` (BSD-3-Clause). The highlighted tree is turned into React
  elements by `hast-util-to-jsx-runtime` (MIT), never into HTML strings. Files
  over 256 KiB and unknown languages stay plain text. Syntax colors are theme
  tokens checked for 4.5:1 contrast on the code background.

## D64. Pull request view, draft state and guided tours

**Decision, 2026-11-22, requested by the project owner.** When a session has a
linked pull request, Code change shows it the way a reviewer reads it:

- **Header.** Repository, creation date, author, the title and its `#number`
  (opens the PR on its upstream; only GitHub is supported today), state, head
  and base branches. An open PR has a **Draft / Ready** control.
- **Draft state.** `github.pr.draft` converts an open PR to draft or marks it
  ready for review through GitHub's GraphQL mutations. Users and approved
  agent `github_write` calls can both use it, with the same exact review and
  confirmations as other GitHub writes.
- **Description.** Reviewers, assignees and labels show as chips. The user can
  request or remove reviewers (`github.pr.reviewers`), replace assignees
  (`github.issue.assignees`) and labels (`github.issue.labels`), and edit the
  title and description (`github.pr.update`). These three new writes are
  user-only: agents cannot call them.
- **Files.** Changed files with collapsible unified diffs, and a **Tour** view
  (below).
- **Reviews.** The PR timeline (commits, reviews, comments and events such as
  renames and label changes) with All, Comments, Reviews, Unresolved and Events
  filters and oldest or newest first.
- **Checks.** Check runs at the exact head, grouped as Failing, In progress,
  Unknown result, Skipped and Successful. GitHub Actions rows show
  `workflow / job` and open the run's job page. A completed check without a
  known conclusion is never shown as successful. The exact-head CI watch stays
  under **Watch CI on this head**.
- **Commits.** Newest first, grouped by day, each opening the commit.

Reads go through the new `commits`, `timeline`, `labels` and `assignees` browse
resources and the existing ones, using the project's exact GitHub account.

**Tours.** In the Files tab, **Tour** asks the session's agent for a guided
review on demand. Moguri queues a `pr-tour` workflow turn that uses the
session's normal model, Env, budget and approvals and must not change the
project. The agent answers with a `moguri-tour` JSON block. The desktop
validates the block and renders it: risk, impact and attention ratings, an
overview, ordered steps, a diagram of how the steps connect, and diff snippets
the user can tick as reviewed. A tour for an older head is marked outdated. An
invalid reply is shown as an error, never as a tour. The tour prompt is a
global setting with a per-repository override. Moguri appends the fixed output
contract, which users cannot edit. Details are in [PR tours](pr-tours.md).

Protocol **118** adds these actions, reads, item fields, the `pr-tour` workflow
kind and the optional prompt settings. Its store step only advances the version
because existing rows stay valid.

## D65. Inline review comments, fixed PR associations and one session PR mark

**Decision, 2026-11-22, requested by the project owner.**

- **Diff.** Files shows each changed file as a syntax-highlighted diff with
  old and new line numbers. Unchanged lines between hunks fold into
  "N unmodified lines" rows that expand from the file at the exact head.
- **Comments.** Hovering a diff line shows **+**. The comment is posted to
  GitHub as an inline review comment on that line at the reviewed head
  (`github.review.comment`), after the same exact review and confirmations as
  other GitHub writes. It is user-only, and agents cannot call it. Expanded
  unchanged lines take no comments because GitHub only accepts comments on
  lines in the diff. Posted comments show under **Reviews**, not inline in the
  diff.
- **Associations are fixed.** Once a session has an associated PR,
  `session.organize` refuses to change or clear its PR link. Associations only
  grow: Code change offers **Open another pull request** (create only) instead
  of linking a different existing PR. Every associated PR stays listed as a
  tab the user can switch between.
- **Every PR is observed.** The session PR observer refreshes every associated
  PR, not only the first, with the same bounds (four reads at a time,
  throttling, board auto-refresh, exact root and account).
- **One mark.** A session's PRs share one sidebar mark:
  - green when any PR is open and ready;
  - grey when the open ones are all drafts;
  - purple (merged) once every PR is closed or merged, including closed PRs
    that were not merged;
  - unknown while a PR's state is unverified and none is open.

  The label says how many PRs are in each state.

## D66. Dependency update roundups over My Work

**Decision, 2026-11-21, delivers [#8](https://github.com/mbianchidev/moguri/issues/8).**
A dependency roundup is a read-only, model-free view of open update-bot PRs
built from My Work's retained observations (the
[My Work contract](my-work.md)), not a second GitHub reader. The profile owns one
roundup configuration: the actual user explicitly selects My Work sources
(already reviewed repository/account/root bindings) and update-bot logins
(default `dependabot[bot]`, `renovate[bot]`). Nothing outside those sources
is read.

- **Runs own exactly one refresh.** Each manual or scheduled run is admitted
  atomically with a new My Work refresh, job and receipt
  (`MyWorkRuntime.admitOwned`). A run never adopts another reader's refresh,
  so cancelling it stops only its own readers. Its terminal state follows the
  refresh's actual outcome in the same transaction.
- **Schedules reuse #6.** The optional schedule uses D50's schedule types,
  DST resolution, missed-occurrence coalescing, overlap skipping and the
  shared intake timer. Runs are model-free and need no chat, so they are
  roundup runs, not automation runs. A schedule-started refresh records
  `actor: "schedule"` with the run and the user's activation command
  (`MyWorkRefresh.trigger`); a timer is never relabelled as a user.
- **Provenance over interpretation.** Package/version changes come from
  deterministic parsing of the PR's own title, branch, body tables and labels.
  Security notes are only what the PR reports (labels, `[SECURITY]`, advisory
  IDs and links). No advisory is shown as "no advisory information", never as
  secure. "Likely breaking" is a labelled heuristic. No model is called.
- **Identity and failures.** One entry per canonical PR keeps every source and
  account association and its retained observation. Groups key packages per
  ecosystem (case folds only where the ecosystem does). Unparsed bot PRs stay
  visible. Failed, partial, stale, disabled and missing sources keep their
  verbatim diagnostic and mark the roundup incomplete; the GitHub reader now
  reports provider rate limits explicitly (`github_rate_limited`).
- **Follow-up is explicit.** A roundup never installs, pushes, rebases or
  merges. "Open in My Work" leads to the existing reviewed follow-up that only
  creates an idle source-bound chat.

Protocol 119 adds `dependency_roundups_schema`, `dependency_roundup.recorded`,
`dependency_roundup.run_recorded` and the optional refresh trigger. Contract:
[dependency roundups](dependency-roundups.md).

## D67. Taggable personas under an implicit orchestrator

**Decision, 2026-11-21, delivers [#10](https://github.com/mbianchidev/moguri/issues/10).**
A persona is a profile-owned definition (handle, name, instructions, scope,
model, tools, skills, budget, time limit, output, mention trigger) that runs on
the existing session and coordination model, not a second agent engine.
Personas are created disabled and only an actual-user command creates,
enables, pauses, edits or deletes one; presets (Product Manager, Maintenance,
Docs) are ordinary definitions.

- **Tagging.** When a user-authored turn (or an automation prompt step) starts
  and its text mentions an enabled in-scope persona's `@handle` outside code,
  the same transaction records one run per persona (at most 8, deduplicated
  per turn). A launcher that waits for startup recovery then creates the
  persona's linked subsession under the tagging chat with its user-delegated
  coordination link and task, atomically with the run. The tagging chat is the
  implicit orchestrator: it gets a service notice and the persona's reply as
  session messages, and can wait on or inspect each subsession.
- **No authority from a mention.** Persona subsessions start under Manual
  autonomy. The persona's model replaces the chat's model only when set; its
  budget can only tighten the chat's budget and needs explicit estimate-based
  accounting. Read-only personas start question-only. Hard policy, allowed
  Envs, approvals and writer leases are unchanged, so writable personas take
  turns on shared files while read-only ones run in parallel.
- **Attribution and stopping.** A run binds the exact child task item and
  turn. Its outcome comes from that turn's actual settlement; a stop (user,
  time limit or deletion) is recorded as requested, and a queued task that never
  started is removed and recorded as stopped. Human stops in the child chat
  and approval denials win as for any chat.
- **Restart.** A run that never created its chat is blocked, never replayed;
  started tasks settle through the existing turn recovery.
- **Schedules** use an automation whose prompt tags the persona; the run
  records the automation run as its trigger.

Protocol 119 adds `personas_schema`, `persona.recorded` and
`persona.run_recorded`. Contract: [personas](personas.md).

## D68. Kupo windows follow the request, not the smallest pool model

**Decision, 2026-11-21.** Ordinary automatic and Single Kupo route every
request only to models whose own qualified window fits it, so the pool's
smallest model no longer caps Kupo.

- **Classifier sizing.** The classifier reads the complete history plus the
  candidate snapshot. Before its call, the service estimates that exact input
  and selects a classifier whose working window fits it plus the classifier
  output bound and headroom. A classifier chosen for an empty request is never
  dispatched with a larger one. An explicitly configured classifier that does
  not fit fails with its own error; no other classifier is substituted.
- **Advertised window.** The synthetic Kupo model, `routing.options` and the
  context preview report the largest qualified window in the pool. A pinned
  ceiling is offered when the pool it narrows to still qualifies; models that
  cannot support it are excluded per request, never clamped.
- **Compound unchanged.** Reviewed Compound runs every fixed route, so its
  ceiling still has to suit all of them.

No protocol or schema change; retained routes and pinned windows keep their
original meaning.

## D69. Performance limits task roles, not the classifier

**Decision, 2026-11-21, amends D55.** Performance is about the models that do
the task. Every Performance drafter, solver, critic and Council reviewer must
be a frontier model, with no README/summary/trivial exception; Performance
candidates are frontier-only. The classifier only routes, so any eligible
model may classify, including an explicitly configured economy classifier.
Without a configured classifier, Performance still prefers a frontier
classifier when one fits. The classifier keeps Performance's effort rule
(High or xhigh) and its complete routing input must fit (D68). Dynamic is
unchanged: it applies Performance only when every chosen model is frontier.

No protocol or schema change. A route planned before the upgrade that chose a
non-frontier Performance model fails its dispatch recheck instead of running.

## D70. Pull request diffs render with @pierre/diffs

**Decision, 2026-11-22, settles the open diff-renderer choice.** The PR view's
Files tab renders each changed file with `@pierre/diffs` (Apache-2.0, built on
Shiki), replacing the hand-rolled rows whose highlight.js pass switched off for
PRs over 256 KiB of patch.

- **Always highlighted.** Shiki highlights every file regardless of PR size;
  language grammars load on demand, so they are separate lazily loaded chunks.
- **Expansion without guessing.** Unchanged lines between hunks expand through
  the renderer's loader: Moguri reads the file at the exact PR head and
  rebuilds the base side by undoing that file's patch. **Show the full file**
  covers lines after the last hunk, which a patch cannot size.
- **Comments.** The gutter **+** and each file header's **Comment** button open
  the same reviewed comment form as an inline annotation; line and side stay
  editable so keyboard users can target any line. Expand controls get names, a
  tab stop and Enter/Space.
- **Data.** A PR's files, activity, review threads and commits load as soon as
  it opens; Reviews refreshes in the background.
- **Content-Security-Policy.** The renderer writes Shiki token colours and its
  grid layout as inline `style` attributes and theme `<style>` elements, so the
  desktop CSP now allows `style-src 'self' 'unsafe-inline'`. Scripts, network
  connections, images, frames and objects keep their existing `'self'`-only
  limits, so injected CSS cannot load remote resources or run code.

No protocol or schema change.

## Still open

Earlier SendBox releases were qualified and superseded; their receipts are
not current evidence and do not change D10's production admission
requirements. No Local fallback or production readiness is enabled by them.

- Package manager and monorepo tooling.
- Protocol schema tool and code generation. `pi-ai` already uses TypeBox.
- SQLite driver: `better-sqlite3` or Node.js's built-in `node:sqlite` module.
- How the service and runtime are packaged for the CLI and the desktop app.
- Linux package formats.
- Default kupo classifier, evaluated candidate pools, quality gates, and per-pattern limits.
- Decision-provider thresholds and bounded delegation presets; a concrete model is chosen by the user or a valid saved default after discovery, not silently before setup.
- Remote worker lease, reconnect, and orphan-cleanup behavior under peer loss, to be settled in Phase 0.
- Attachment size/context limits and telemetry quality thresholds for enforceable token/USD budgets.

**Settled for the initial checkpoint:** npm with an exact-version lockfile;
TypeBox for command/IPC validation; Node's built-in `node:sqlite` with WAL,
`synchronous=FULL`, numbered transactional migrations and one service writer;
OpenTUI 0.6.6 on a bundled Node 26.12 runtime; Electron 44 with a same-origin
`moguri://app` HTTP proxy and authenticated loopback WebSocket; native OS keyring
credentials via `@napi-rs/keyring`. Packaging uses `@electron/packager`.
Development macOS artifacts are not notarized releases. Folder attachments,
images, external references and snapshotted default inheritance follow D19.
Estimated finite caps and immutable profiles follow D25/D26. Exact billing,
routed wind-down and decision-model qualification remain open.

The development app deliberately uses unpacked application files (`asar: false`):
the external pinned Node runtime must execute the service/worker and load their
native dependencies through ordinary filesystem paths. An ASAR containing those
entrypoints is not executable by a standalone Node process.

## Sources

- [B]: Moguri implementation specification.
- [I]: README.
- [A]: Contributor instructions.
- [L1]: OpenTUI core README: React and Solid renderers; Bun 1.3.14+ or Node.js 26.4+.
- [N1]: Node.js release schedule: 26.x scheduled for LTS on 2026-10-28.
- [P1]: `pi-ai` README: GitHub Copilot OAuth and OpenAI-compatible endpoints.
- [R1]: napi-rs (MIT).
- [R2]: `process-wrap` README: process groups, sessions and Job Objects (Apache-2.0 or MIT).
- [R3]: WezTerm `portable-pty` crate (MIT).
- [R4]: gitoxide crate status: status and diffs supported; push and checkout orchestration not yet.
- [R5]: ripgrep crates, including `ignore` and `grep`.
- [R6]: OpenAI Codex repository, primarily Rust.
- [X1]: Electron release timelines and support policy.
- [S1]: SendBox README: VM runtimes, custom agents, prerequisites, workspace and credential boundaries.
- [S2]: SendBox integration contract: CLI, YAML policy, custom guest executables, headless JSON events, and MCP brokers.
- [H1]: GitHub's public HydraFusion design: single, cascade, critique/revision, bounded execution, and complete accounting.
- [J1]: TypeSafe AI's official Jev introduction: System One models produce typed decisions, not chat.
- [J2]: Official Jev API: endpoint, state/questions/answers, question types, confidence fields, usage, and errors.
- [J3]: Official Jev model/version documentation: limits, aliases, and resolved versions.
- [LY1]: Laya README at the reviewed source commit: architecture, checkpoints, installation and documented limitations.
- [LY2]: Laya HTTP contract at the reviewed source commit: endpoint, routing, confidence, truncation, usage and strict-mode behavior.
- [LY3]: Laya sequence/head renderer at the reviewed source commit: state window and instruction/option caps.
- [LY4]: Laya inference implementation at the reviewed source commit: exact per-question row usage and zero generated output.
- [LY5]: Laya HTTP implementation at the reviewed source commit: inference executor, cancellation, health and request handling.
- [LY6]: Laya opt-in revision and artifact-digest verification at the reviewed source commit.
- [LY7]: Upstream macOS setup and measurements at the reviewed source commit, not Moguri qualification.
- [LY8]: Laya PyPI metadata, checked 2026-10-26; published release 0.4.15 versus reviewed source declaration 0.4.16.
- [LY9]: Laya Apache-2.0 source license at the reviewed source commit; model-card declarations are linked in the evaluation.

[B]: ../implementation.md
[I]: ../../README.md
[A]: ../../AGENTS.md
[L1]: https://github.com/anomalyco/opentui/blob/f8f608e2b9a41685d613a1156708ff06c826c3ce/packages/core/README.md
[N1]: https://github.com/nodejs/Release/blob/72fdab20216c5f04e0a0fe72a225c2504e9f2b42/README.md
[P1]: https://github.com/earendil-works/pi/blob/c268154ca1171c2f9eefe75d3d7372a68aada2d5/packages/ai/README.md
[R1]: https://github.com/napi-rs/napi-rs/tree/57a539a3d2daff8fcadad20565a5af31db8d949c
[R2]: https://github.com/watchexec/process-wrap/blob/ca45003a831ac125e6673b8759430e5ef33cc1db/README.md
[R3]: https://github.com/wezterm/wezterm/tree/e2a98e1b8af156988ad0ac778658ac27b60a55fb/pty
[R4]: https://github.com/GitoxideLabs/gitoxide/blob/ad0202e3ab396d752a56664001c134f48d834177/crate-status.md
[R5]: https://github.com/BurntSushi/ripgrep/tree/3fce3b5bb0236da2df6d99672afb8a719642eca7/crates
[R6]: https://github.com/openai/codex/tree/ce0323f2f2d3b25e82806cd555237da3db4e1897
[X1]: https://www.electronjs.org/docs/latest/tutorial/electron-timelines
[S1]: https://github.com/mbianchidev/sendbox/blob/5c6f352b0e3e9bf8568325789d5289ca81d606e0/README.md
[S2]: https://github.com/mbianchidev/sendbox/blob/5c6f352b0e3e9bf8568325789d5289ca81d606e0/docs/integrations.md
[H1]: https://github.blog/ai-and-ml/github-copilot/project-hydrafusion-frontier-quality-via-multi-model-orchestration/
[J1]: https://docs.typesafe.ai/introduction
[J2]: https://docs.typesafe.ai/api
[J3]: https://docs.typesafe.ai/models
[LY1]: https://github.com/NandhaKishorM/laya/blob/b9fe351ce81e2d974bca2bf219c1e4030c0a05ea/README.md
[LY2]: https://github.com/NandhaKishorM/laya/blob/b9fe351ce81e2d974bca2bf219c1e4030c0a05ea/docs/http-api.md
[LY3]: https://github.com/NandhaKishorM/laya/blob/b9fe351ce81e2d974bca2bf219c1e4030c0a05ea/laya/common.py#L157-L278
[LY4]: https://github.com/NandhaKishorM/laya/blob/b9fe351ce81e2d974bca2bf219c1e4030c0a05ea/laya/agent.py#L1524-L1574
[LY5]: https://github.com/NandhaKishorM/laya/blob/b9fe351ce81e2d974bca2bf219c1e4030c0a05ea/laya/serve.py#L1200-L1492
[LY6]: https://github.com/NandhaKishorM/laya/blob/b9fe351ce81e2d974bca2bf219c1e4030c0a05ea/laya/revisions.py
[LY7]: https://github.com/NandhaKishorM/laya/blob/b9fe351ce81e2d974bca2bf219c1e4030c0a05ea/LOCAL_SETUP.md
[LY8]: https://pypi.org/pypi/laya/json
[LY9]: https://github.com/NandhaKishorM/laya/blob/b9fe351ce81e2d974bca2bf219c1e4030c0a05ea/LICENSE
