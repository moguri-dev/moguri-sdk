# Owned execution transports

This contract extends the existing worker loop, not a second agent framework.
Reuse Node/Node-PTY (MIT), OpenSSH (BSD), pi-ai (MIT), the explicit keychain
backend and the encrypted append-only event store. SSH is transport and host
separation, not SendBox process isolation.

## Qualification before capability

An owned rootless loopback OpenSSH server passed strict generated host-key
verification and a real worker-originated HTTP request in 175.94 ms. A changed
host key prevented execution before another request. The server used generated
keys, loopback-only listening and no system service changes. This proves that
primitive on macOS, not Linux support, a complete worker transport or an external
host's readiness. `node scripts/remote-spike.mjs` repeats it.

The actual existing worker now passes SSH inference, exact read/write approvals,
remote instructions, scoped remote-local discovery, image transfer and
project-free null-root execution. A deterministic lost-completion connection
retains reported usage for reconciliation without another inference; a genuine
control-plane SIGKILL/restart preserves its run/key/cursor and never starts a
replacement. Initial native end-to-end worker qualification completed in
1,377.74 ms; the refreshed SSH primitive completed in 131.59 ms. Generated hidden
Electron drives actual setup, explicit project mapping, model-preserving env
selection and execution through the compiled transport.

This qualifies the macOS core agent path, not Linux release readiness or live
Copilot entitlement. Embedded Remote consoles, executable MCP transport,
repository-memory retrieval and diff/plan panels remain blocked. Explicit
client-side browser URLs do not create an implicit remote-port tunnel.

## Authority and identities

Remote requires an explicitly configured SSH host, pinned public host key,
selected local identity and installed compatible Moguri worker command.
Private keys and the local secret store are never copied or forwarded.
Each project supplies its own approved canonical remote path; null-project
chats retain no filesystem root. Model metadata and inference for remote-local
endpoints originate on that host. Scoped Copilot access requires a separate
explicit grant and sends only per-request access, never a refresh credential.

An owned remote supervisor forks the existing worker over real Node IPC.
Versioned bounded frames cross SSH; they are not a replacement `process.send`
implemented by mutating Node. The controller remains the only event writer and
authorizer. Tool policy is rechecked locally and filesystem policy at the actual
worker root. Unqualified MCP/extension/terminal transports remain blocked rather
than executing on the local host.

## Failure and recovery

Run IDs are unique and start is create-only. Reattachment never creates another
worker or replays a side effect. Run-scoped transport keys live in the explicit
local secret backend and remote supervisor memory. Private remote replay frames
are encrypted; credential-bearing controller replies are never journaled.
Acknowledged frames can be removed only after the local durable writer records
them. Cursors bind run, sequence and digest atomically with their primary events.

Disconnect requests owned cancellation, but does not prove remote cleanup.
Model/tool outcomes, cancellation request/acknowledgement, uncertain descendants
and late accounting stay distinct. Recovery reconciles an existing run without
admitting new work or supplying new model access. Late usage can improve an
unknown ledger entry without rewriting a partial turn as successful.

Protocol/database migration 8 adds transport configuration, run identities,
frame receipts and late-usage events without rewriting prior event identities
or encrypted grants. Generated acceptance must cover actual SSH worker/model
execution, host-key/auth failure, exact workspace and attachment transfer,
configuration races, duplicate frames, reconnect, disconnect cancellation,
late usage, restart and no Local fallback. A capability becomes ready only
after the installed worker/runtime and target pass those checks.

## Linux payload preparation

`node scripts/prepare-worker-image.mjs --build` prepares an isolated context
containing only the dependency manifests and built worker/MCP/bridge modules,
not the checkout, host home, credentials or model weights. Apple Containerization
builds it without cache from Node 26.12.0 Bookworm's pinned Linux arm64 manifest
`sha256:2928a235e5af9997b97f8fbe5718cfd40676fc9190b619effc0c0249c41bb4e4`.
The upstream Docker Hub tag API supplied that platform digest before work.

The image reuses Node (MIT), existing locked runtime dependencies, Node-PTY
(MIT), system nftables and the build toolchain. Other dependency lifecycle
scripts stay disabled; only the explicitly pinned Node-PTY native rebuild runs.
The image verifies every staged payload digest, Node version and a generated
Linux PTY primitive before success. It runs as the image's unprivileged node
user and never publishes an image.

This prepares a workload prerequisite, not a ready Sandbox or a proof of
Linux-host cancellation, guest policy, model networking or containment.
Authenticated candidate guest installation remains a separate user action.

The initial no-cache build failed after 6,848.36 ms because Apple's newly
installed builder defaults to Rosetta while Rosetta is absent. No workload
success or Sandbox readiness was claimed. Native ARM preparation uses the
supported `build.rosetta=false` property rather than installing translation,
changing guest trust or modifying unrelated Porto workloads.

`node scripts/pty-worker-spike.mjs` separately tests a generated bounded ASCII
frame over an owned raw host PTY, with delayed-reader backpressure and echo
checks. SendBox's documented interactive channel requires a controlling
foreground PTY and cannot use `--json`; its own authenticated input-credit
behavior still needs genuine guest qualification, not inference from this
host-only primitive.

After selecting native ARM mode, the no-cache workload build passed in
40,351.79 ms: Node 26.12.0, all staged hashes, a compiled Linux Node-PTY and
zero npm audit findings. Its initial manifest is
`sha256:4b2e8c1cfe35d0e1b06c62e7d4bd3a352c6e09af5f2b0ea28b28a814f4b25f30`.
Apple's image store requires an explicit immutable local repository alias;
without it a differently qualified name attempts a registry pull. Preparation
now registers and verifies that alias instead of assuming tag normalization.
The parent-owned builder was stopped after this check.

The raw host PTY primitive passed 1,398,104 generated payload bytes in
374.86 ms with a delayed reader and no input echo. The private worker frontend
can negotiate the same bounded prefixed encoding on an owned TTY while keeping
ordinary SSH pipes on their existing JSON protocol. This does not enable
Sandbox or substitute host-only checks for the candidate's genuine guest gate.
