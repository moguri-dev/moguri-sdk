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
| D12 | Autonomy level defaults to Manual. Guided, Autopilot, and System One-backed Autopilot Max are independent of model, Env, and Budget; Jev is an optional decision adapter. | A decision provider cannot satisfy the typed contract, privacy requirements, or evaluated decision thresholds. |
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

D28's [task progress contract](task-progress.md) records generated checklist and
hidden-client qualification. D29's [document contract](document-attachments.md)
records parser licenses, limits and measured Phase 0 results before integration.
Neither decision expands unrelated roadmap, model authority or unqualified
execution transports.

The owner-requested [shared themes and TUI follow-up](themes-and-tui.md) retains
OpenTUI/React and the existing profile settings/event authority. Protocol 78 adds
one independent theme-catalogue marker, not a second preference store or the
separately reserved protocol-77 model-continuity migration. Its original JRPG
presentation and actual mouse navigation do not copy franchise assets, create a
GitHub inbox or qualify changed native worker/bridge payloads by version alone.

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
0.2.4 and a compatible pinned Linux worker/runtime/dependency image, reviewed
in-app setup and public-release update checks, automatic private workspaces
without per-turn text previews, and selected-provider endpoint/CNAME resolution.
[Managed Sandbox](managed-sandbox.md) records the prerequisite measurements,
root-owned no-script installer requirement and exact data/egress authority.
This supersedes the developer-tooling setup UX, not the root-ownership,
private staging, no-replay, permission or budget boundaries. Legacy manual
configurations are not silently granted the new managed policy.

Explicitly reviewed `*.domain.com` tool rules use the existing released native
matcher, qualified against the real 0.2.3 guest/proxy. In that release exact entries remain exact,
the apex is separate, and actual provider endpoints/CNAME provenance stay exact.
The adapter adds no wildcard or dependency. For the 0.2.4 default, the owner
explicitly selected GitHub Meta delegation with clear setup disclosure. The
`github.com` grant includes Meta domains and IPv4/IPv6 CIDRs, including
shared-cloud ranges, refreshed before readiness and hourly. It is not labeled
exact-host-only egress; the service's review digest binds this warning and
activation still requires the user's network-policy acknowledgement. Actual
0.2.4 guest qualification remains separate from authenticated artifact/package
verification. The
[default release pins](managed-sandbox.md#default-sendbox-024) preserve older
selected versions, signed history and separate setup approval.

The [separate current physical qualification](sendbox-0.2.4-qualification.md)
now records the exact 0.2.4/protocol-76 macOS path, actual Meta delegation,
generated metered worker/tools and original VM absence. It does not qualify
all Env/control combinations or complete the remaining failure-hardening gates.

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
truncation. Critique still requires reviewed lineage; finite automatic budgets,
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
is allowed. SendBox remains unavailable until its real transport and guest
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
Stainless diagnostics/Playwright integration remains deferred; this does not
qualify Sandbox or Remote browser transports or the wider release gates.
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

## Still open

Issue #17 resumes native SendBox work specifically for released **0.2.3**.
The [fresh release/worker/network/cancellation measurements](sendbox-0.2.3.md)
supersede no historical artifact and do not change D10's production admission
requirements. The signed host/guest and bounded offline worker gates pass;
endpoint-only cold egress fails, while an explicitly captured alias scope
passes its separate generated probe. SDK/controller lifecycle, accounting,
loss/restart and reviewed source publication remain gates. No Local fallback
or production readiness is enabled by those measurements.

- Package manager and monorepo tooling.
- Protocol schema tool and code generation. `pi-ai` already uses TypeBox.
- SQLite driver: `better-sqlite3` or Node.js's built-in `node:sqlite` module.
- Diff renderer: `@pierre/diffs` or CodeMirror's merge view.
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
