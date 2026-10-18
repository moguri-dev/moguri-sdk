# Initial executable architecture

This is the first working checkpoint, not the completed first milestone.
The implementation specification remains the target; `phase-zero.md` records
what has actually been validated.

## Change contract

Reuse pi-ai (MIT) solely behind the service/worker provider boundary, OpenTUI
(MIT) for terminal rendering, React (MIT) for both clients, Electron (MIT) and
Vite (MIT) for desktop, TypeBox (MIT) for validation, `ws` (MIT) for events,
`node-pty` (MIT) for owned commands, and `@napi-rs/keyring` (MIT) for secrets.
Node's SQLite driver avoids an additional database addon. Dependency notices
are retained in installation and packaged dependencies.

The invariant is one service writer, one append-only event history, and one
shared typed command protocol. Clients cannot approve on behalf of a model,
silently substitute a model/backend, reset accounting, or replay a command
because a connection was lost. Commands carry idempotency IDs; editable data
carries revision checks.

Schema version 1 introduces events, command receipts and content-addressed
attachment snapshots in transactional SQLite migrations. Opening newer state
fails explicitly. Projections rebuild from events. Durable additions require a
migration and recovery tests, not deletion of user state.

Both clients share the SDK and subscribe to the same sequenced stream. The
service owns projects, sessions, transcripts, drafts, queue, pending approvals,
policy and accounting. Desktop-only panel selection is presentation state.
Only Local, fixed Copilot models, Manual approval and Unlimited budget are
operational in this checkpoint. Other settings explain their missing capability.

The agent loop runs in a separate Node process. It receives short-lived
per-request model access through a private IPC channel, never the control-plane
token or refresh credential. Every tool needs exact-argument human approval.
File tools are project-scoped, reject protected paths and symlink escapes, and
require a base digest before overwriting. Approved shell commands are explicitly
unsandboxed Local execution, not filesystem isolation.

Stopping records requested and acknowledged cancellation before a terminal
outcome. Process groups receive bounded TERM/KILL escalation. Unknown or
surviving work is partial/failed, never successful. Workers clean up on parent
disconnect. Restart reconciliation does not retry model requests, file writes
or shell commands and does not claim unconfirmed cleanup.

Unit, real-HTTP/WebSocket integration, migration, restart, queue/approval race,
worker/process-tree cancellation and cross-client tests establish this contract.
Provider and UI tests use generated fixtures without personal data; live
Copilot authorization is a separate user action.
