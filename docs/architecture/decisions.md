# Moguri architecture decisions

**Decided 2026-10-17 by the project owner. Status: accepted, pending the Phase 0 validation spikes below.**

**Initial executable checkpoint, 2026-10-18.** The [Phase 0 results](phase-zero.md)
authorize a deliberately smaller development checkpoint: macOS Local execution,
fixed GitHub Copilot models, Manual approvals, and Unlimited budget through both
clients. This is not completion of the first milestone. Unsupported environments,
routing, delegation, attachment types and finite budgets must report unavailable,
never approximate their guarantees or fall back to Local. External-service and
release-packaging failures remain release blockers.

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
effects or assume that cleanup succeeded. Interactive terminal reattachment,
large-repository native search, Linux supervision and the Rust implementation
remain unvalidated. Revisit this exception before release.

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

## D11. kupo synthetic model and routing

**Decision.** Users can select a fixed model or **kupo**. kupo is Moguri's own synthetic auto model: a classifier and versioned orchestration policy that choose among configured local and hosted models. It follows HydraFusion's public single, cascade, and independent critique/revision patterns, without assuming access to GitHub's internal implementation or a standalone HydraFusion API. [H1]

**Rules.**

- Keep fixed-model selection available. kupo selection grants no extra autonomy, permissions, providers, or network access. Autonomy level, Env, and Budget remain separate.
- Discover authenticated provider models and configured local endpoints before forming the pool, using metadata and health checks rather than paid inference or arbitrary network scans. Recheck accessibility from the selected env; Remote makes model calls on the SSH machine. An unset/unusable generative pool disables kupo, and decision-only Jev configuration does not supply a solver.
- Filter the candidate pool by profile policy, data locality, capabilities, context and output limits, health, and budget before sending classifier input. Validate the typed plan and recheck eligibility at each dispatch; remote classifiers are themselves data destinations requiring permission.
- A configured classifier can be local, hosted, or a D12 System One provider. Its result selects a workflow and concrete model bindings; it cannot create providers or change policy. Leg calls do not invoke kupo recursively. Replanning happens only at recorded safe boundaries, with context rebuilt from canonical events and approved artifacts rather than raw provider session payloads or replayed tools.
- Single uses the normal loop. Cascade gates an efficient draft with explicit validation before accepting it or escalating. Critique uses an independent, read-only, tool-less model from a different family and a bounded solver revision; two aliases for the same model are not independent critics. If a pattern's prerequisites are absent, choose another eligible pattern or report it unavailable.
- Reuse owned workspaces and worktree leases to stage compound candidates. Only an accepted, validated patch may be applied against its recorded base; conflict, cancellation, or rejection must not overwrite the user's changes. Solver legs cannot publish an unaccepted candidate; publishing is a separate policy-checked action after validation. Do not replay Git writes, network writes, or other side effects on retry/escalation. Report any effects already performed and partial cleanup honestly.
- Bound legs, revisions, escalations, retries, spend, and time. Every classifier, draft, critic, revision, and fallback request belongs to the same cancellation tree and cost ledger, with its role, provider, resolved model version, configuration, and outcome recorded.
- With a finite token/USD cap, reserve wind-down capacity and try to checkpoint and commit accepted work before exhaustion. Git policy and the autonomy level still govern approval; do not add calls past the cap or claim a denied/failed commit succeeded. Unlimited is the session preference default, not permission to lift inherited hard limits.
- Expose the selected `kupo` label and actual per-leg models in both clients. Failure, unavailable models, invalid plans, or low confidence may use only a visible, preconfigured eligible fallback, or pause for the user. Never silently cross a privacy, budget, or sandbox boundary.

**Schema impact.** Phase 1 defines versioned routing-policy snapshots, plans, leg ownership, candidate bases, acceptance/application outcomes, and complete per-call accounting. Use the existing event/projection model and normal migration and restart-recovery rules; do not build a second hidden workflow store.

## D12. System One decisions and autonomy levels

**Decision.** Add a typed decision-provider interface with an optional **Jev by TypeSafe AI** adapter. It supports kupo routing and can be enabled with a fixed model for decisions and steering. **Autonomy level** offers **Manual** (default), **Guided** (current generative model recommends; human confirms), **Autopilot** (current model acts within delegated policy, asking sparingly), and **Autopilot Max** (a configured decision model decides and steers within that policy). None implicitly selects kupo or changes Env or Budget.

**Provider contract.** Jev is a structured decision model, not a code/chat generator. Its documented hosted API evaluates state against typed Noul (yes/no probability), Choice, and Score questions; some types include a separate confidence value. Use a dedicated adapter to `POST https://api.typesafe.ai/v1/systemone`, not an invented OpenAI-compatible endpoint or assumed `pi-ai` integration. Other local or hosted providers must declare and satisfy equivalent capabilities. [J1], [J2]

**Rules.**

- Represent tool approvals, structured user questions, and steering as bounded typed decisions. Offer explicit alternatives, including escalation to the user. For open-ended questions or missing user-only facts, request clarification rather than invent an answer. The current model may frame alternatives; it cannot set its own permission limits.
- Autopilot Max can answer instead of prompting the user, approve or deny delegated tool requests, and steer at safe loop boundaries. It needs an explicitly configured compatible decision provider; no silent fallback to generative self-approval. Steering cannot change a pinned model, expand the user's goal or workspace, or grant new permissions.
- The control plane's deterministic authorizer remains final. User-delegated scope may permit automatic decisions, but a high confidence score cannot override a hard denial, lift a budget, expose a secret, widen allowed envs, or change another user-only security setting. Git and other consequential writes still need explicit user action or policy.
- Validate question/answer types, option membership, numeric bounds, and confidence semantics. Treat input content as data, not instructions. Evaluate decision thresholds on generated fixtures; vendor calibration, speed, or cost claims are not permission or a reliability guarantee. Probability and confidence are not interchangeable. [J2]
- Bind each decision to the exact pending request, arguments/context, delegation, and policy revision. Recheck before tool execution, applying an answer, or admitting a steer. User intervention, revoked delegation, changed input, or cancellation invalidates stale results. Persist the actual model actor, rubric, and available evidence references, never a fake user-authored response or reasoning the provider did not return. Automated answers cannot become user-only Core instructions.
- Keep model keys in the profile's secret backend. Hosted decision inputs need explicit data/network permission from the selected env; a policy forbidding third-party data transfer also forbids sending those questions to hosted Jev. Account for every decision call and retry, with independent deadlines and cancellation. A timeout, invalid output, provider outage, or insufficient confidence pauses or escalates; it never means approval.
- Pin an evaluated Jev version when thresholds depend on it, and record the resolved version returned by the provider even when the user selects an alias. Aliases can move without a client update. [J3]

**Schema impact.** Phase 1 defines autonomy-level settings and default sources, bounded delegation, decision requests and results, recommendation versus human/automated approval actors, policy revisions, invalidation, and requested/applied steering events. Recovery must preserve pending questions and accounting without re-executing effects; durable changes require migrations.

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

## Still open

- Package manager and monorepo tooling.
- Protocol schema tool and code generation. `pi-ai` already uses TypeBox.
- SQLite driver: `better-sqlite3` or Node.js's built-in `node:sqlite` module.
- Diff renderer: `@pierre/diffs` or CodeMirror's merge view.
- Terminal renderer: xterm.js or ghostty-web.
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
images, external references, finite caps and preference inheritance are not
enabled until their full contracts are implemented.

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
