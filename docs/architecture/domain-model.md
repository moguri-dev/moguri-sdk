# Initial domain model

`packages/protocol/src/index.ts` is the shared TypeScript/TypeBox contract.
Protocol version and database migration version are 7; immutable event
envelopes remain schema version 1. This is the
initial checkpoint, not the complete Phase 1 schema for future capabilities.

## Implemented entities

| Entity | Identity and authority |
| --- | --- |
| Profile | Only `default` is exposed. Every command/event is scoped; other profile rows are excluded from projection, replay and attachment authorization. Profile creation/switching is not implemented. |
| Project | Stable UUID/canonical folder, ordered navigation folder/color and revisioned repository/policy/script/MCP bindings. One active agent writer; no implicit managed Git worktree. |
| Session | UUID/nullable project, controls/revisions/lifecycle, agent/read-only mode, pending safe-boundary mode, explicit agent/side/model-subagent/metachat kind, pin/unread/group/parent metadata, PR/work-item binding, drafts/queue/messages/usage and exact approval. A null project never resolves to another root. |
| Turn | Admitted queue item, UUID, immutable controls/policy and prompt-digest snapshot, and worker ownership. Admission removes exactly one unclaimed queue item atomically. |
| Step | One authorized provider request, normalized final context snapshot, usage quality, request wall time and declared tools. Worker completion requires durable acknowledgement before tools or the next step. |
| Draft | Text, approved attachment snapshots and optimistic revision. Local unacknowledged edits are explicitly not authoritative. |
| Queue item | UUID, text, snapshots, delivery mode, held state, optional steer target and mode-control intent. Held prompts never auto-admit. Only unclaimed items are mutable. |
| Approval | UUID, exact tool ID/name/arguments, step, policy and permission revisions. Human answers are `user`, invalidations `policy`, explicit grants `delegation` with rule ID. |
| Owned process | Tool-call ID, PID, process group, owning turn and actual outcome. Unknown cleanup remains unconfirmed. |
| Attachment | Session-authorized project/client text, normalized image, exact folder/GitHub/session snapshot, SHA-256, bytes and source revision. Explicit selection grants captured content only, never arbitrary filesystem access. |
| Usage | Solver/side/subagent model/step, nullable provider token fields, request wall time, outcome and distinct nullable estimated/provider-reported/billed amounts. |
| Settings | Revisioned shared values and factory defaults; separate permission revision invalidates stale approvals. Prompt text is not policy. |
| Capability | Project-scoped skill/script/plugin/style knowledge, immutable content digest, source, enablement revision and optional owning plugin. |
| Proposal | Exact content/base digests, project, kind, actual user/model actor and pending/approved/rejected decision. Approval installs disabled content. |
| Capability job | Owned kind/session/turn, progress, terminal status, retained result digest and explicit error. A wait timeout is not cancellation. |
| Repository index | Derived project-partitioned lexical vectors, source digests/mtime/size, chunks and import/symbol graph. Not a second session store. |
| Issue board | Project, configuration revision, ordered phase IDs/names, merged destination, explicit PR-observation access and optional Linear team. |
| Local issue | Stable UUID/project-local number, feature/bug/misc, title/body/phase, optimistic revision, archive state and verified remote-link provenance. No assignee. |
| Dependency plan | Exact project/manager/manifest/lock digest, unique public package versions and SHA-512 artifacts. Branch names are not mutable cache identities. |
| Cache receipt | Project/manager plan digest, actual advisory-check time, package/reuse/download counts and blocked-script boundary. Never a permanent security guarantee. |
| Retained artifact | Project-owned immutable content snapshot, origin-session reference and optional source path. Session deletion cannot remove its independent grant. |
| User terminal | Session/project ownership, PID, dimensions and actual/unconfirmed/acknowledged lifecycle. Ghostty owns VT rendering; output and input are bounded ephemeral data. |
| Model options | Optional working window and supported thinking effort in revisioned session controls; the provider maximum is not changed. Step usage records effective window/effort and labeled estimated context separately from actual token telemetry. |
| MCP authorization | Non-secret owned OAuth lifecycle, server/scope/expiry and transient-link readiness. State/verifier/authorization URL are ephemeral; issuer/resource-bound clients and grants stay in the secret backend. A durable connected decision gates use. |
| Configuration proposal | Actual user/model origin, exact target scope, source excerpts, content/base digests and revision, with pending/applied/rejected state. A model cannot decide it. Human approval never enables a skill or publishes instructions. |
| Attention | Question/bell/done, real-state or heuristic provenance, session, active state and separate read acknowledgement. It never becomes a user answer or approval. |

Provider-neutral session state is projected from immutable events. Normalized
pi-ai model messages live in content-addressed blobs referenced by completion
events so provider continuation signatures survive without leaking vendor
payloads or credentials into clients. Context reconstruction never re-executes
stored tools. Attachments also use digest-verified blobs.

## Lifecycle

Sessions begin idle and may be queued, running, waiting for human input,
stopping, completed, stopped, failed, partial or archived. Archive/restore is
non-destructive. An ended turn cannot retain a live approval.
Archival settles owned work and holds queued user prompts. Restoration does not
depend on an attached PR remaining open. Deletion settles ownership, detaches
surviving children and forgets only the requested retention compartment.

Steers bind to one turn and never migrate implicitly. Interrupt priorities are
recorded through queue ordering. Failed or partial work quarantines automatic
admission for the project, or only the affected project-free session, until explicit user inspection/resumption. Queues
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
routing/decision plans, richer attachments, reservations and profiles
must extend this authority rather than introduce client-only stores.

Migration 2 adds `memory_files`, `memory_chunks`, `memory_graph_nodes` and
`memory_graph_edges`. The sqlite-vec virtual table is initialized lazily when
the opted-in index is used. Re-indexing replaces a project's derived tables
atomically; cancellation before commit preserves the previous index. Changed,
missing or newly ignored sources return no stale snippet text. The graph is a
bounded snapshot from the last successful index, not a live semantic compiler.

Migration 3 adds derived `dependency_cache_objects` metadata while preserving
schema-1/2 state. Boards, tickets and cache receipts are projected from immutable
events, not stored in client databases. Archive does not delete tickets.
Interrupted installs become partial on restart and quarantine project admission;
verified cache objects remain reusable only after current checks. Credentials
stay in the explicit keychain and are never copied to this projection.

Migration 4 transactionally encrypts payload/blob storage in independent
profile/project/session compartments without changing prior event IDs,
sequences or receipts. Scope keys are wrapped by an OS-keychain master; its
stable identifier is retained with state. Deletion destroys the selected keys
and blob grants while preserving immutable ciphertext audit rows and sanitized
usage. Project removal also removes derived indexes and historical project MCP
credentials, not repository files, external PRs, shared caches or service logs.
Relocating an attached folder invalidates its derived index. This is not
forensic secure erasure or removal of external backups.

Migration 5 records the optional model-control schema without rewriting event
identities, ciphertext grants or legacy defaults. Schema-4 state upgrades in
place. Context preview is a read-only local estimate of the saved draft,
instructions, declared tools and conversation; it never calls a model.

Migration 6 records nullable scope, OAuth/engagement events, user guidance and
notification preferences without rewriting older identities or encrypted grants.
Configuration content/evidence remains independent of origin-session retention.
Global guidance, skills and OAuth accounts are profile-owned; historical project
OAuth resources are removed with project data. Startup fails incomplete OAuth
flows, never replays callbacks, and preserves attention/read state without
inventing new questions.

Migration 7 records the local-model/startup-control/typed-input schema without
rewriting historical event identities, scope keys, snapshots or receipts.
Existing project/settings values merge new defaults; legacy sessions keep their
saved controls. New sessions retain complete resolved values and source/revision
provenance. Local connections use canonical provider identity distinct from the
upstream API model ID; non-secret connection states do not expose credentials.
Typed snapshots retain exact destination-session grants. Image pixels remain
in independently encrypted blobs, not public events or snapshots.
