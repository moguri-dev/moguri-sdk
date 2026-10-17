# Moguri architecture decisions

**Decided 2026-10-17 by the project owner. Status: accepted, pending the Phase 0 validation spikes below.**

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
| D07 | The local API is HTTP on loopback plus WebSocket events, protected by a token. | Remote execution or a security review requires sockets or TLS. |
| D08 | macOS ships first, Linux next, Windows later. | Windows users become a priority. |
| D09 | The VS Code and `vslocal` extension follows a stable TUI and desktop protocol. | The protocol stays unstable after the first release. |
| D10 | Native SendBox execution is a first-release option. YOLO is the default; a user-only global policy can require SendBox for all new turns. | Phase 0 cannot prove the guest worker, control transport, or required containment on a supported host. |

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

**Decision.** Moguri writes its own agent loop: step scheduling, tool dispatch, steer points, compaction triggers, budget checks and cancellation. `pi-ai` supplies provider adapters, GitHub Copilot sign-in and OpenAI-compatible endpoints such as `ds4-server`. Moguri does not use `pi-agent-core`. [P1]

**Why.** Queue, Steer and Interrupt, hard budget stops before each model request, per-step events and cancellation all depend on step boundaries that Moguri controls.

**Consequences.**

- Wrap `pi-ai` behind a Moguri provider interface. Pin its version and keep raw provider data for debugging.
- The loop runs in a session worker on the D10 execution backend. Sandboxed sessions do not run the loop or executable agent tools in the host control-plane process.
- Pi's MIT-licensed tool implementations may be reused where they fit, with their license notices kept.
- Check GitHub's current terms before advertising Copilot sign-in.

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
- SendBox workloads need Linux builds of the worker's native addon and supervisor. Host helpers may supervise SendBox and serve trusted UI queries, but cannot execute sandboxed agents' tool requests on the host.
- Move more work into Rust only when a measured budget fails.

## D07. Local API transport

**Decision.** The service listens on loopback. Commands use HTTP. Events stream over WebSocket with sequence numbers, so clients can replay missed events after reconnecting.

**Why.** The TUI, the desktop app and VS Code extension hosts all speak HTTP and WebSocket natively, and standard tools can inspect the traffic.

**Security rules.** Loopback does not protect against other local processes or against web pages in a browser.

- Bind only to loopback addresses, on a random port.
- On start, write a connection file containing the port, protocol version and a random token to the user's Moguri state directory. Only the user can read it.
- Require the token on every HTTP request and WebSocket connection. Browser WebSocket clients cannot set headers, so send the token in the first message or a subprotocol, never in a URL. Never log it.
- Reject requests whose `Host` header is not a loopback address, which blocks DNS rebinding. Reject `Origin` values other than Moguri's own clients. Do not enable CORS.
- Remote access is out of scope until remote execution. It will need TLS and real authentication.

## D08. Platforms

**Decision.** macOS ships first, signed and notarized. Linux follows. Windows is deferred.

**Consequences.** Avoid Unix-only assumptions where they are cheap to avoid, because the D06 Rust libraries already support Windows. The first release has no Windows acceptance checks.

## D09. VS Code and `vslocal` extension

**Decision.** Build the extension after the TUI and desktop app share a stable protocol. It is a thin client: commands, a webview reusing desktop React views, native diff views and terminal bridging.

**Rules.**

- Negotiate the protocol version on connect. The extension updates on a different schedule from the desktop app.
- Declare the extension as a UI extension (`extensionKind: ["ui"]`), so it runs on the local machine where the Moguri service runs, even when the editor window is connected to a remote host or container. Remote workspaces stay out of scope until remote execution.
- Publish to Open VSX for `vslocal` and to the Visual Studio Marketplace for VS Code.

## D10. Native SendBox execution and global enforcement

**Decision.** Ship a built-in SendBox execution adapter alongside direct host execution. Sessions default to **YOLO (host)**. Users may select **SendBox (local sandbox)** per session or change global and profile defaults. A separate global **Require SendBox** setting rejects new YOLO turns and cannot be overridden by a profile, session, model, plugin, or automation.

**Policy changes.** Only explicit user action may change global enforcement. Enabling it lets already-running YOLO turns finish under the recorded prior execution-mode policy, but blocks new YOLO turn admission immediately, including queued, child-agent, and restarted work. Persist the policy revision and eligible running turns atomically; clients must label the remaining host work accurately. Other permissions, budgets, and manual stop controls remain in force. Defaults never switch a running turn's backend in place.

**Integration boundary.**

- Use SendBox's supported CLI and policy interface behind a typed Moguri backend adapter, not private Rust APIs or a model-generated wrapper. SendBox supports custom guest executables, headless JSON events, and explicit exit status; its `--json` and `--interactive` modes cannot be combined. Phase 0 must prove the worker control and terminal transport rather than assume a ready-made SDK. [S2]
- The host control plane owns durable state. In SendBox mode, the agent worker, model-facing tool execution, subagents, and executable agent extensions live in the guest or use explicitly scoped SendBox brokers. The guest gets a run-scoped authenticated bridge, not the host control-plane token, home directory, secret store, or unrestricted API.
- Build a digest-pinned Linux workload image containing the Moguri worker, its pinned Node.js runtime, Linux Rust helpers, and development tools. SendBox agent profiles do not install the agent. Validate runtime, guest artifacts, image, version compatibility, workspace policy, and credentials before launch. [S1], [S2]
- SendBox currently uses Apple Containerization on macOS 26+ with Apple silicon, or Kata on virtualization-capable Linux. Unsupported hosts or absent prerequisites block sandboxed runs with setup diagnostics; they never cause fallback to YOLO. VM isolation and intentionally writable workspace mounts are shown separately. [S1]
- Copilot and other remote providers remain external services. A host-side `ds4-server` may remain on the host, but guest access needs an explicitly approved, supported provider connection. Validate scoped authentication and network access; never mount host login state or bypass network policy to make a provider work. The setting governs Moguri session execution, not where an independent inference server runs.
- Check the latest policy and authenticated backend readiness before each new turn. No model request starts for a new turn until its required sandbox is ready. Guest loss interrupts that work and preserves failure or partial outcomes; no host retry is allowed. Supervision and teardown must account for both the SendBox process and guest workload, rather than treating a CLI exit as proof of complete cleanup.
- Preserve the same typed commands, events, budgets, Git policies, and cancellation semantics across both backends. In sandboxed sessions, terminals and agent file/tool operations stay within the approved guest workspace and brokers.

## Phase 0 validation spikes

Each spike records a pass or fail result and its measurements under `docs/`.

1. **Providers.** `pi-ai` with GitHub Copilot sign-in and streaming, `ds4-server` streaming with tool calls, and cancellation of in-flight requests.
2. **Supervisor.** Start a PTY with a nested process tree on macOS and Linux, stop it, and report survivors. Decide behavior across service restarts.
3. **Event store.** Single-writer SQLite append latency, a crash during a write, and projection rebuilds.
4. **Desktop.** An Electron shell attaching to the service. Measure cold start, idle memory and scrolling through a long timeline.
5. **TUI.** OpenTUI with React on Node.js 26 rendering a streaming timeline.
6. **Native addon.** File search and Git status on a large generated repository, compared with a Node.js baseline.
7. **Packaging.** A signed and notarized macOS app containing the Node.js runtime, the service, the native addon and the supervisor, and a Linux CLI installation.
8. **Native SendBox.** Run the Moguri worker as a custom guest executable on supported macOS and Linux hosts; prove bidirectional control, terminal transport, scoped Copilot and host-side ds4 connectivity, MCP containment, cancellation, guest loss, and restart reconciliation. Exercise YOLO defaults, per-session selection, global enforcement, already-running-turn completion, and the absence of host fallback.

## Still open

- Package manager and monorepo tooling.
- Protocol schema tool and code generation. `pi-ai` already uses TypeBox.
- SQLite driver: `better-sqlite3` or Node.js's built-in `node:sqlite` module.
- Diff renderer: `@pierre/diffs` or CodeMirror's merge view.
- Terminal renderer: xterm.js or ghostty-web.
- How the service and runtime are packaged for the CLI and the desktop app.
- Linux package formats.

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
