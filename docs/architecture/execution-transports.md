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
