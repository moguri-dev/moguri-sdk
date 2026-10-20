# Initial domain model

`packages/protocol/src/index.ts` is the shared TypeScript/TypeBox contract.
Protocol version and database migration version are 17; immutable event
envelopes remain schema version 1. This is the
initial checkpoint, not the complete Phase 1 schema for future capabilities.

Migration 17 records the read-only Remote workspace/worker compatibility
boundary without rewriting event ciphertexts, receipts, keys or retained grants.
Queries remain ephemeral user views, not a second workflow store or model
context. The updated inspector accepts authenticated protocol-16 receipt
metadata without attaching or continuing a legacy worker.

## Implemented entities

| Entity | Identity and authority |
| --- | --- |
| Profile | Immutable Default/UUID identity, revisioned name/color and creating/ready/partial lifecycle. One root registry owns explicit setup/retry/stop. Scoped SDK/store/controller views exclude foreign state and never copy accounts or rebind old editors. |
| Project | Stable UUID/canonical base folder, ordered navigation folder/color and revisioned repository/policy/script/MCP bindings. Worktrees are explicit owned bindings, never inferred from branch names. |
| Session | UUID/nullable project and managed-workspace binding, controls/revisions/lifecycle, agent/read-only mode, pending safe-boundary mode, explicit agent/side/model-subagent/metachat kind, pin/unread/group/parent metadata, PR/work-item binding, drafts/queue/messages/usage and exact approval. A null project never resolves to another root. |
| Managed workspace | Project-owned Local root, exact canonical directory/device/inode, common Git directory, branch/base, revision, change set and creation/removal job. Partial intent never authorizes a base-root fallback. |
| Change set | Stable project/workspace/branch/base association with optional local issue/PR context. It does not authorize publication or imply compound candidate orchestration. |
| Turn | Admitted queue item, UUID, immutable controls/policy and prompt-digest snapshot, and worker ownership. Admission removes exactly one unclaimed queue item atomically. |
| Step | One authorized provider request, normalized final context snapshot, usage quality, request wall time and declared tools. Worker completion requires durable acknowledgement before tools or the next step. |
| Routing turn | Opt-in Single policy/task/revision snapshot, exact classifier/eligible solver IDs, untrusted typed plan and actual lifecycle. Uses the same owning turn, worker, approvals and ledger; classifier context is never solver history. |
| Draft | Text, approved attachment snapshots and optimistic revision. Local unacknowledged edits are explicitly not authoritative. |
| Queue item | UUID, text, snapshots, delivery mode, held state, optional steer target and mode-control intent. Held prompts never auto-admit. Only unclaimed items are mutable. |
| Approval | UUID, exact tool ID/name/arguments, step, policy and permission revisions. Human answers are `user`, invalidations `policy`, explicit grants `delegation` with rule ID. |
| Owned process | Tool-call ID, PID, process group, owning turn and actual outcome. Unknown cleanup remains unconfirmed. |
| Attachment | Session-authorized project/client text, normalized image, exact folder/GitHub/session snapshot, SHA-256, bytes and source revision. Explicit selection grants captured content only, never arbitrary filesystem access. |
| Usage | Actual router/solver/side/subagent model/step, nullable provider token fields, request wall time, outcome and distinct nullable estimated/provider-reported/billed amounts. |
| Budget entry | Independent profile-owned step/actual-role/owning-session record: estimated reservation, actual reported total, held unknowns, explicit dated rate and request outcome. Source deletion never refunds it. |
| Budget policy | Separate revision-bound profile/global hard caps, independent of resettable preferences/rates. Global admission counts every profile without exposing foreign task content. No billing guarantee is inferred from input estimates. |
| Settings | Profile-owned revisioned values and factory defaults, with intentionally shared root startup preferences. A separate permission revision invalidates stale approvals. Prompt text is not policy. |
| Capability | Project-scoped skill/script/plugin/style knowledge, immutable content digest, source, enablement revision and optional owning plugin. |
| Proposal | Exact content/base digests, project, kind, actual user/model actor and pending/approved/rejected decision. Approval installs disabled content. |
| Capability job | Owned kind/session/turn, progress, terminal status, retained result digest and explicit error. A wait timeout is not cancellation. |
| Repository index | Derived profile/root-partitioned lexical vectors, source digests/mtime/size, chunks and import/symbol graph. Default IDs remain unchanged; other profiles prefix derived index identity. Not a second session store. |
| Issue board | Project, configuration revision, ordered phase IDs/names, merged destination, explicit PR-observation access and optional Linear team. |
| Local issue | Stable UUID/project-local number, feature/bug/misc, title/body/phase, optimistic revision, archive state and verified remote-link provenance. No assignee. |
| Dependency plan | Exact project/manager/manifest/lock digest, unique public package versions and SHA-512 artifacts. Branch names are not mutable cache identities. |
| Cache receipt | Project/workspace/manager plan digest, actual advisory-check time, package/reuse/download counts and blocked-script boundary. Never a permanent security guarantee. |
| Retained artifact | Independent project/profile text document with folder/same-project work-item associations: plan/decision/answer/research-note/report, immutable revisions, archive, origin-session/workspace/file and exact source actors. Per-artifact grants survive session retention; model content never becomes a user answer. |
| Artifact repository job | Exact source/history/root/policy and optional new local branch/base intent, durable receipt and verified copy/commit result. Partial effects are quarantined, never replayed or proof authorizing source deletion. |
| User terminal | Session/project ownership, PID, dimensions and actual/unconfirmed/acknowledged lifecycle. Ghostty owns VT rendering; output and input are bounded ephemeral data. |
| Model options | Optional working window and supported thinking effort in revisioned session controls; the provider maximum is not changed. Step usage records effective window/effort and labeled estimated context separately from actual token telemetry. |
| Model catalogue | Scoped actual capability/output limits and validated endpoint boundary. A local provider label does not prove loopback; network/unknown routing needs explicit data consent. No endpoint credentials or provider payloads are exposed. |
| MCP authorization | Non-secret owned OAuth lifecycle, server/scope/expiry and transient-link readiness. State/verifier/authorization URL are ephemeral; issuer/resource-bound clients and grants stay in the secret backend. A durable connected decision gates use. |
| Configuration proposal | Actual user/model origin, exact target scope, source excerpts, content/base digests and revision, with pending/applied/rejected state. A model cannot decide it. Human approval never enables a skill or publishes instructions. |
| Attention | Question/bell/done, real-state or heuristic provenance, session, active state and separate read acknowledgement. It never becomes a user answer or approval. |
| Structured question | Exact model/step/call and owning session/turn, bounded choices/freeform, revision and real open/answered/cancelled state. Actual user answers are distinct from model/delegated actors and never permission grants. |
| Remote execution | Owned run/target/verified build/root, actual worker PID, cancellation, durable frame cursor and pending/confirmed-worker/unconfirmed cleanup. SSH exit is not proof of descendant containment. |

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
admission for the bound root, or only the affected project-free session, until explicit user inspection/resumption. Queues
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

Migration 8 adds explicit SSH target/project-path configuration, independently
bound remote-local model identity, owned execution/frame events and late usage.
It preserves schema-7 inputs/defaults and all prior IDs/grants. Frame receipts
are appended atomically with primary effects; restart never creates another
worker. Remote replay payloads are private encrypted transport data, not a
second authority. Late accounting can replace unknown telemetry while a partial
turn remains partial. Inspection acknowledgement remains distinct from cleanup.

Migration 9 adds managed-workspace/change-set events, nullable legacy session
bindings and root-scoped quarantine without rewriting historical events,
IDs, grants, defaults or receipts. All filesystem surfaces resolve the same
binding; one writer leases each root, not the entire logical project.
Creation/removal intent and its command receipt precede Git effects.
Interrupted jobs retain partial ownership and require explicit reconciliation,
never replay. Session deletion preserves worktrees; root removal preserves
branches and independent plans. Project relocation/removal refuses retained
worktrees. Remote/Sandbox root mappings and external adoption are unavailable.

Migration 10 transactionally re-encrypts legacy plan events/blobs into independent
artifact compartments. Plaintext event content, IDs, sequences, receipts and
digests remain unchanged; opaque optional `artifact_id` envelope metadata binds
the key scope. Old project blob grants are removed only when no other event
references them. Append-only triggers are restored before commit; interruption
rolls back to a complete schema-9 state. New revisions/deletion use typed events.
Exact source preview/promotion distinguishes actual user/model/tool authors;
manual text is user-entered, not verified authorship. Project removal binds an
explicit retain/export/delete choice to the reviewed set. Retain detaches
documents without retaining source sessions; deletion forgets all artifact
revisions. Artifact storage does not imply repository materialization, commits
or authority to answer on the user's behalf.

Migration 11 adds typed question/answer/cancellation events and answer-retention
settings without changing prior IDs, ciphertext grants or saved controls.
Legacy sessions get a null pending question. The actual-user endpoint checks
owner/turn/revision and optional exact saved-draft revision. Primary answer,
derived independent artifact/source actors, draft consumption and command
receipt commit atomically. Stop/restart cancels waits without fake answers or
tool replay; a heuristic badge/queued prompt never resolves a real question.
Factory answer retention is on with explicit opt-out. Delegated
decision-provider answer policy remains open.

Migration 12 adds folder/work-item association and repository-job metadata
without rewriting old event identities, receipts or ciphertext. Old revisions
project null associations. Project retain clears the removed work-item link.
Explicit Local materialization verifies an independent private history copy;
optional new local commits preserve checkout/index and never push. A completed
job, current source set and actual bytes/commit must be revalidated before
project deletion forgets grants. Partial/restarted jobs retain inspectable
destination intent and never replay effects.

Migration 13 adds role-aware independent accounting and separate hard profile
policy without rewriting old source events, receipts or keys. Legacy reported
totals import once by actual step identity; missing prices/bounds/attribution
remain labeled unknown. Model-created children charge the real parent.
Reservations share the dispatch transaction, complete/late reports reconcile
once, and stopped/interrupted requests keep capacity held. Price-free is an
explicit configured estimate, never a default provider bill. Profile/source
retention does not erase these sanitized counters.

Migration 14 changes receipt identity to `(profile_id, id)` while preserving
every legacy Default digest/result, event identity, ciphertext and wrapped
key. A failed migration rolls the receipt conversion and schema marker back
atomically. Internal `_global` registry/default/policy/budget events never
enter user projections or event replay. Root policy changes and per-profile
replicas commit together; only actual recorded running Local turns may finish.
Opaque global accounting invalidation updates capacity without broadcasting
another profile's calls. Profile resources have owned private markers; setup
interruption is partial and does not replay on restart. See
[the profile contract](profiles.md).

Migration 15 adds optional Guided offered-choice recommendations, stamped from
the actual solver step with separate model actor/provenance. Old questions
project null advice. Receipt/key/ciphertext identity is unchanged and an
injected marker failure rolls back to schema 14. Advice remains part of the
existing accounted solver call, not an extra hidden request, user answer or
permission. Retained answer documents preserve its model digest separately
from the actual user's answer.

Migration 16 adds opt-in Single routing policy snapshots, typed plans and
actual per-call router/solver provenance in the existing worker and ledger.
Missing old settings project the disabled defaults; all schema-15 profile
ciphertexts, receipts, blob grants and keys remain unchanged. Interrupted
routes become partial without replay and keep unknown reservations held.
An injected marker failure reopens the unchanged schema-15 state. See the
[routing contract](routing.md) for the alpha's deliberately blocked paths.
