# Initial domain model

`packages/protocol/src/index.ts` is the shared TypeScript/TypeBox contract.
Protocol version and durable event schema version are both 1. This is the
initial checkpoint, not the complete Phase 1 schema for future capabilities.

## Implemented entities

| Entity | Identity and authority |
| --- | --- |
| Profile | Only `default` is exposed. Every command/event is scoped; other profile rows are excluded from projection, replay and attachment authorization. Profile creation/switching is not implemented. |
| Project | Stable UUID, canonical local directory and display name. One active-turn lease per project. No managed Git worktree or deletion behavior is implied. |
| Session | Stable UUID, project, controls, configuration revision, lifecycle, current turn, draft revision, queue revision, messages, usage, owned processes and pending exact-argument approval. |
| Turn | Admitted queue item, UUID, immutable controls/policy snapshot and worker ownership. Admission removes exactly one unclaimed queue item atomically. |
| Step | One authorized provider request, normalized final context snapshot, usage quality, request wall time and declared tools. Worker completion requires durable acknowledgement before tools or the next step. |
| Draft | Text, approved attachment snapshots and optimistic revision. Local unacknowledged edits are explicitly not authoritative. |
| Queue item | UUID, text, snapshots, delivery mode and optional steer target-turn ID. Only unclaimed items are mutable. |
| Approval | UUID, exact declared tool ID/name/arguments, step and policy revision. Only an actual client answer is attributed to `user`; invalidation is attributed to `policy`. |
| Owned process | Tool-call ID, PID, process group, owning turn and actual outcome. Unknown cleanup remains unconfirmed. |
| Attachment | Session-authorized project-text snapshot, SHA-256, byte count, path and UUID. No arbitrary client-side path grant or silent live-file reread. |
| Usage | Solver model/step, nullable provider token fields, request wall time, outcome and distinct nullable estimated/provider-reported/billed amounts. |

Provider-neutral session state is projected from immutable events. Normalized
pi-ai model messages live in content-addressed blobs referenced by completion
events so provider continuation signatures survive without leaking vendor
payloads or credentials into clients. Context reconstruction never re-executes
stored tools. Attachments also use digest-verified blobs.

## Lifecycle

Sessions begin idle and may be queued, running, waiting for human input,
stopping, completed, stopped, failed, partial or archived. Archive/restore is
non-destructive. An ended turn cannot retain a live approval.

Steers bind to one turn and never migrate implicitly. Interrupt priorities are
recorded through queue ordering. Failed or partial work quarantines automatic
admission for the project until explicit user inspection/resumption. Queues
recovered after restart require explicit resumption even if they were unclaimed.

Allowed-env revisions record the active Local turn IDs permitted to finish.
New Local admission consults the current policy in the same single-writer
execution boundary as event commitment. An old permission cannot admit a new
turn, and no unready env is mapped to Local.

## Persistence and evolution

SQLite migration 1 creates append-only `events`, idempotent command `receipts`
and digest-addressed `blobs`, with update/delete triggers guarding event history.
WAL plus FULL synchronization protects acknowledged commits. Event sequence
numbers are monotonic. Event IDs and command IDs are distinct.

Command receipts bind an ID to the exact serialized command and result.
Concurrent identical IDs share one in-flight operation; argument changes are a
409 conflict. Editable revisions protect multi-client drafts and queue state.
Sending a draft, clearing it, enqueuing it and storing the receipt are one commit.

Opening a newer database version or unsupported/corrupt event fails without
resetting state. Further durable changes require numbered migrations, explicit
event evolution and restart coverage. Work items, change sets, artifacts,
routing/decision plans, richer attachments, reservations, profiles and extensions
must extend this authority rather than introduce client-only stores.
