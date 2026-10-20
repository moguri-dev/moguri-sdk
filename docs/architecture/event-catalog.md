# Initial event catalog and protocol

Every durable event carries `id`, `seq`, `schema_version`, `timestamp`,
`profile_id`, `project_id`, `work_item_id`, `session_id`, `turn_id`, `step_id`,
`parent_event_id`, `correlation_id`, `event_type` and a typed `payload`.
Migration 10 adds optional opaque `artifact_id` key-scope metadata without
changing event identities or plaintext payloads.
Unused scope fields are null in checkpoint 1.

| Event family | Payload and invariant |
| --- | --- |
| `project.added` | Canonical project identity/path. No filesystem access is implied for an agent. |
| `session.created`, `session.configured` | Title/controls, optional resolved startup values/source revisions and explicit configuration changes. Running turns cannot be rewritten. |
| `session.archived`, `session.restored` | Non-destructive lifecycle changes after settling owned work and holding prompts. PR merge does not prevent restoration. |
| `session.blocked`, `session.resumed` | Admission diagnostic or explicit user resumption. Resumption does not prove prior cleanup. |
| `draft.saved` | Text and authorized snapshots; increments the draft revision. |
| `queue.enqueued`, `queue.edited`, `queue.removed`, `queue.reordered` | Exact unclaimed message mutation, each with a queue revision. |
| `queue.delivery_changed` | Explicit conversion of an unclaimed steer into a new queued turn. |
| `turn.started` | Admitted item, controls, allowed-env revision and optional committed prompt digest; claims the item once. |
| `steer.applied` | One item enters its owning turn at a safe model-step boundary. |
| `model.started` | Step, actual role/canonical model/provider/API model, effective context window/effort and estimated context. The session may retain the synthetic selection; actual role/model never become `kupo` charges. Creates an unknown, in-progress accounting entry; estimates are not provider token telemetry. |
| `routing.started`, `routing.planned`, `routing.finished` | Single owning-turn policy/task/revision snapshot, exact classifier/eligible pool, untrusted plan and actual lifecycle/diagnostic. Completion/accounting and accepted-plan commitment precede any solver continuation. Restart never replays a routed effect. |
| `assistant.delta` | Durable streamed text for that step, batched by the worker. Router deltas remain audit events and never append to a public assistant answer or solver context. |
| `model.completed` | Public message, normalized-context blob digest and actual/unknown usage. Does not imply overall turn success. |
| `model.late_usage` | Exact owned remote step/frame improves unknown accounting after disconnect; no new continuation, tool replay or rewrite of a partial turn. |
| `execution.started`, `execution.changed` | Pinned target/build/root/run, actual worker and cancellation/cleanup status. SSH exit is not descendant-containment proof. |
| `execution.frame_recorded` | Run, sequence and digest committed atomically with the primary events; a duplicate cannot authorize another side effect. |
| `tool.requested` | Exact declared tool, approval UUID and policy revision. Optional Guided text binds the actual solver model/step/call; it never authorizes execution. |
| `tool.decided` | Allow/deny, exact request UUID and real `user`/`policy`/`delegation` actor, with rule ID for explicit grants. Model advice never becomes a human answer. |
| `tool.started`, `tool.output`, `tool.completed` | Approved execution, bounded output, explicit actual/denied/stopped/failed/partial/unconfirmed result. |
| `process.started` | Owned tool-call ID, PID and process group. |
| `turn.stop_requested`, `turn.stop_acknowledged` | Distinct cancellation transitions. Acknowledgement alone is not successful cleanup. |
| `turn.finished` | Completed/stopped/failed/partial, with actionable diagnostics. Unsettled model usage and process cleanup remain unknown. |
| `policy.updated` | New user-only allowed-env revision and exact Local turns permitted to finish. |
| `provider.changed` | Non-secret connection status/diagnostic. Device codes and tokens are not durable events. |
| `settings.updated` | Shared validated settings, value revision and permission revision. Edits cannot rewrite an admitted prompt snapshot. |
| `capability.saved` | Project content digest, kind, source, owner and explicit enablement revision. |
| `capability.proposed`, `proposal.decided` | Reviewed exact proposal/base digest, real model/user origin and actual user decision. No automatic application or enablement. |
| `job.started`, `job.progress`, `job.finished` | Owned capability work, bounded progress, actual completed/failed/cancelled/partial outcome and retained result reference. |
| `board.saved` | Project configuration/revision, ordered phases, merged destination and explicit read-only integration policy. |
| `issue.saved` | Complete revisioned local ticket and real `user`, `github` or `linear` actor. Only a verified merge can drive an automated phase transition. |
| `cache.prepared` | Exact plan digest, advisory check time, package/reuse/download counts and `scripts: blocked`, never a permanent safety grant. |
| `queue.held`, `queue.released` | Explicit prompt admission state; holding does not require a provider or start a model request. |
| `session.organized`, `session.group_saved` | Revisioned title/pin/unread/group/acyclic same-project attachment and group metadata. |
| `session.mode_requested`, `session.mode_changed` | Immediate restriction of new approvals and safe-boundary mode acknowledgement. Side/model-subagent sessions cannot gain edit authority. |
| `session.browser_changed` | Explicit validated HTTPS/loopback preview association, not model context. |
| `project.configured`, `project.folder_saved`, `project.relocated` | Typed policy/configuration/navigation and attached-folder changes; atomic exact-membership reorder and index invalidation. |
| `artifact.saved` | Legacy immutable plan snapshot; migration preserves its payload/identity while moving encryption into an independent artifact compartment. |
| `artifact.revised`, `artifact.deleted` | Typed document revisions, exact source/actual-actor provenance and user edits/archive or profile-owned deletion tombstone. Source sessions/files and other grants are not deleted. |
| `workspace.saved` | Revisioned owned Local root/branch/base/common-directory identity, job and creating/ready/removing/partial/removed outcome. Never a permission or fallback root. |
| `change_set.saved` | Stable workspace/branch/base and optional ticket/PR association. No publish/merge authorization. |
| `session.workspace_bound` | Explicit nullable binding for a fresh idle session; existing conversation/queue is not moved. |
| `terminal.changed` | Owned user-console lifecycle only, never input/output or keystroke hashes. Acknowledged inspection is distinct from proven closure. |
| `turn.prompt_bound` | Exact effective step prompt digest, including mode, repository instructions and any opted-in retrieved memory. |
| `session.deleted`, `project.removed` | Transactional tombstone/key erasure with retained sanitized usage; independent artifacts survive session deletion. |
| `mcp.oauth_changed` | Non-secret explicit OAuth lifecycle and transient-link readiness. Tokens, authorization URLs, state, PKCE verifiers and client secrets are not event payloads. |
| `configuration.proposed`, `configuration.decided` | Exact scoped content/base digests and revision, verified source excerpts, actual user/model origin and a real user decision. No self-approval, authentication, automatic enablement or publication. |
| `attention.raised`, `attention.cleared`, `attention.acknowledged` | Atomically derived question/approval/failure/done state; heuristic provenance is explicit and read acknowledgement never resolves or approves. |
| `question.asked`, `question.answered`, `question.cancelled` | Exact model/step/call and owning-turn question, optional offered-choice Guided model recommendation, actual answer actor and cancellation. Advice never resolves the wait; actual-user answers cannot be forged by a model, heuristic or queue item. Retained model advice/actual answer keep distinct source digests. |
| `budget.recorded` | Immutable profile-owned reservation/settlement/import: actual model role/owner, held unknowns, explicit price basis and reported total. Source deletion/restart never refunds unconfirmed calls. |
| `budget.policy_changed`, `budget.blocked` | Explicit revision-bound profile cap or actual admission rejection. A blocked request retains a diagnostic checkpoint without inventing an answer, extra paid call or Git success. |
| `profile.saved`, `global.controls_changed`, `global.policy_changed`, `global.budget_changed` | Root-only profile lifecycle and shared preference/policy/cap revisions. Atomic scoped replicas preserve enforcement without exposing foreign payloads. These internal events never enter a user's scoped replay. |

## HTTP commands

The service binds to a random `127.0.0.1` port. Every HTTP route requires
`Authorization: Bearer <private token>`, exact loopback Host and an approved
or absent Origin. There is no CORS allowance.

- `GET /v1/health`: protocol and service identity.
- `GET /v1/snapshot`: authoritative current profile projection.
- `POST /v1/commands`: TypeBox-validated `{ id, profileId, command }`.
- `POST /v1/query`: TypeBox-validated capability queries, including prompt,
  memory, MCP metadata/results, voice and Sandbox readiness.
- `POST /v1/terminal`: authenticated ephemeral input/resize, deliberately outside
  durable command receipts. Query output uses bounded replay offsets and is not
  an event stream or model context.

The command union covers project/session creation, configuration,
archive/restore/resume, draft/snapshot attachment changes, queue admission and
mutation, explicit steer conversion, exact approval responses, stop, provider
login/cancel/logout/refresh and allowed-env policy. Invalid data, stale revisions,
expired approvals, unavailable capabilities and reused command IDs have explicit
error codes; they are not success-shaped empty responses.
Platform commands add revision-checked settings/reset, imports and toggles,
reviewed proposals, explicit style facts/indexing, keychain credential changes,
approval-bound MCP calls, optional subagents, local speech and job cancellation.
Workspace commands add revisioned board/ticket changes, exact-plan cache
preparation/install with explicit metadata-sharing consent, and user-only Linear
credential changes/imports. Workspace queries inspect boards/plans or non-secret
integration readiness. No PR mutation or CI dispatch is exposed.
Credential values are never written into events or command receipts.
Session-workspace commands cover organization, modes, explicit user children,
reviewed project settings, retained plans, deletion/retention and terminals.
Missing repo defaults require explicit publication approval. MCP imports bind
the exact reviewed file digest. No opening/reading action silently pushes.
Engagement commands add explicit OAuth begin/cancel/clear/client setup, nullable
session creation, metachat creation, exact-source-consented suggestions,
reviewed configuration decisions and attention acknowledgements. Queries expose
only transient authorization links, scoped source previews and exact proposal
reviews. Source preview makes no model call; generated analysis uses an ordinary
owned model turn. Null project scope supplies no filesystem or shell root.
Runtime/input commands add explicit model refresh/resource-bound keys and
selected client text/images or exact reviewed folder/GitHub/session snapshots.
Preview performs no inference. Source revisions and destination-session grants
are checked again at capture/admission. Image bytes travel only through the
bounded private query/provider paths, never public event frames.
Managed-workspace commands add explicit Local creation, clean idle unbound
removal and identity-based reconciliation. Their job/intents/command receipts
commit before effects. Session-bound Git/files queries use the actual root;
discovery reads registrations without adopting arbitrary paths.
Artifact commands add standalone or session-scoped typed documents, exact
canonical source promotion and optimistic edits/archive/delete. Queries expose
bounded revision reads/history/exports and reviewed project artifact impact.
Model content is never recorded as a user answer; export/materialization is not
implicit filesystem authority. Project removal requires the explicit reviewed
retain/export/materialize/delete choice when documents exist. Materialization
job intent and command receipt precede repository effects. Folder/same-project
work-item associations use immutable artifact revisions. A completed owned job,
current source set, actual copied bytes and optional new local commit must all
be reverified before deleting source grants. Partial/restarted publication is
quarantined and never replayed; current checkout/index and unrelated edits stay
unchanged.
Question commands accept only actual owning-turn user input with an observed
question revision and optional exact draft consumption. Question, draft,
artifact/source provenance and receipt failures roll back together. Stop/restart
cancels waiting requests without inventing facts, changing permissions or
holding the worker's cancellation chain behind a human response.
Budget policy is separate from factory/settings resets. Model dispatch binds
its reservation and `model.started` atomically before authorization. Complete
and authenticated late usage settle the same entry once. Unknown/lost
completion retains its full hold. Source/project forgetting does not delete
profile-owned sanitized accounting. Finite preferences explicitly accept
estimated admission; missing historical pricing is not free usage.

## WebSocket

Connect to `/v1/events`, then send:

```json
{"type":"authenticate","protocolVersion":16,"profileId":"default","token":"<private token>","after":0}
```

Tokens never enter the URL. The server rejects unauthenticated, malformed,
wrong-version, unexpected-Origin and wrong-Host connections. Authentication
must complete within five seconds.

The server replays missed `event` frames and sends `ready` with a current
snapshot. Live events retain sequence numbers; `invalidate` refreshes ephemeral
provider setup state. Slow clients are closed with a reconnect instruction,
not allowed unbounded buffering. The SDK reconnects, resolves rotated private
connection metadata and resynchronizes without resending mutations.

The desktop renderer uses the same protocol through a same-origin
`moguri://app` HTTP proxy and an authenticated loopback WebSocket. Its sandboxed
preload exposes only connection discovery, explicit directory/file pickers and
explicit HTTP(S) opening, bounded clipboard writes and an isolated preview.
The preview has its own ephemeral partition, no Node/preload bridge, denied
permissions/downloads/popups and no automatic model context. Node integration
is disabled; arbitrary native navigation and permission requests are blocked.
User-triggered microphone permission is an explicit native bridge operation.
Notification navigation is a narrow session-ID event, not arbitrary native
execution. OS banners use generic content unless the user opts into previews.
Neither renderer nor outward MCP may answer a human approval on a model's behalf.

## Honest accounting

Successful calls retain provider-reported token telemetry when supplied.
Empty/preliminary telemetry, aborted requests and interrupted workers are
conservatively unknown, never zero. Request wall time is measured separately;
active-generation throughput is not claimed. All Copilot dollar fields remain
null because catalog API prices are not a subscription invoice.
