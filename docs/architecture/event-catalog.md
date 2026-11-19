# Initial event catalog and protocol

Every durable event carries `id`, `seq`, `schema_version`, `timestamp`,
`profile_id`, `project_id`, `work_item_id`, `session_id`, `turn_id`, `step_id`,
`parent_event_id`, `correlation_id`, `event_type` and a typed `payload`.
Migration 10 adds optional opaque `artifact_id` key-scope metadata without
changing event identities or plaintext payloads.
Protocol 28 also uses that existing artifact compartment for candidate records
and their complete job lifecycle/results; it does not add a workflow database.
Unused scope fields are null in checkpoint 1.

| Event family | Payload and invariant |
| --- | --- |
| `project.added` | Canonical project identity/path. No filesystem access is implied for an agent. Protocol 109 adds optional `workspaceFolderId`: a permanent read-only source registered from a trusted workspace folder. |
| `session.created`, `session.configured` | Title/controls, optional resolved startup values/source revisions and explicit configuration changes. Running turns cannot be rewritten. |
| `session.archived`, `session.restored` | Non-destructive lifecycle changes after settling owned work and holding prompts. PR merge does not prevent restoration. |
| `session.blocked`, `session.resumed` | Admission diagnostic or explicit user resumption. Resumption does not prove prior cleanup. |
| `draft.saved` | Text and authorized snapshots; increments the draft revision. Protocol 43 atomically grants both original and extracted document digests, without persisting plaintext document bodies in events. |
| `queue.enqueued`, `queue.edited`, `queue.removed`, `queue.reordered` | Exact unclaimed message mutation, each with a queue revision. |
| `queue.delivery_changed` | Explicit conversion of an unclaimed steer into a new queued turn. |
| `turn.started` | Admitted item, controls, allowed-env revision and optional committed prompt digest; claims the item once. |
| `turn.control_started` | Explicit user-requested compaction, generation, retained role-sequence or exact plan-save purpose/ID, unchanged controls, policy and inspectable contract/intent digest. Owns the existing worker without a fake user message or queue claim. Role-sequence output is data, never normal solver context. |
| `plan.save_recorded` | Revisioned exact user Remote write intent/binding, actual directory/file/result/terminal/retention phase and independent artifact. Pending/recovered intents never replay effects or infer successful cancellation, retention or save. |
| `compaction.saved`, `context.changed` | Retained source/model-bound proposal revisions and actual lifecycle, then exact user apply/restore. Original event/blob history and ledger charges stay intact; rejected, stale or stopped proposals cannot become active context. Protocol 110 adds `default-policy`/`session-model` automatic origins, `applyOnSuccess` for `/compact`, and `context.changed` actor `compaction-policy` for smart compaction. |
| `steer.applied` | One item enters its owning turn at a safe model-step boundary. |
| `model.started` | Step, actual role/canonical model/provider/API model, effective context window/effort and estimated context. The session may retain the synthetic selection; actual role/model never become `kupo` charges. Creates an unknown, in-progress accounting entry; estimates are not provider token telemetry. |
| `routing.started`, `routing.planned`, `routing.finished` | Single owning-turn policy/task/revision snapshot, exact classifier/eligible pool, untrusted plan and actual lifecycle/diagnostic. Completion/accounting and accepted-plan commitment precede any solver continuation. Restart never replays a routed effect. |
| `assistant.delta` | Durable streamed text for that step, batched by the worker. Router/compactor/draft deltas remain audit events and never append to a public assistant answer or solver context. |
| `model.completed` | Public message, normalized-context blob digest and actual/unknown usage, nullable cache categories and execution-host stream observations. Inconsistent timing becomes unknown without discarding independently valid token charges. Does not imply overall turn success. |
| `model.late_usage` | Exact owned remote step/frame improves unknown accounting after disconnect; no new continuation, tool replay or rewrite of a partial turn. |
| `execution.started`, `execution.changed` | Pinned target/build/root/run, actual worker and cancellation/cleanup status. SSH exit is not descendant-containment proof. |
| `execution.frame_recorded` | Run, sequence and digest committed atomically with the primary events; a duplicate cannot authorize another side effect. |
| `tool.requested` | Exact declared tool, approval UUID and policy revision. Optional Guided text binds the actual solver model/step/call; it never authorizes execution. |
| `tool.decided` | Allow/deny, exact request UUID and real `user`/`policy`/`delegation` actor, with rule ID for explicit grants. Model advice never becomes a human answer. |
| `tool.started`, `tool.output`, `tool.completed` | Approved execution, bounded output, explicit actual/denied/stopped/failed/partial/unconfirmed result. A `background` outcome (protocol 112) means a user steer interrupted the wait on a running `run_command`. |
| `tool.background_completed` | Protocol 112: the actual final result of that backgrounded command, at its original step; delivered to the model as a service notice. |
| `automation.recorded`, `automation.run_recorded` | Protocol 114 profile/project events for automations and their runs ([contract](automations.md)). Definitions change only by actual-user commands; runs keep their captured definition, controls, occurrence, missed count and per-step progress, and never move back from a terminal outcome. `QueueItem.automation` and `TrustedScriptAttempt.automation` bind a queued prompt step or a model-free script step to its exact run. |
| `session.interruption_recorded` | Protocol 114: sets or clears the chat's interrupted turn and waiting prompts after a quit, restart or crash ([contract](interrupted-sessions.md)). It must match the running turn and unheld queued prompts at that point; Continue, Resume, Dismiss, a new turn or archiving clear it. Recording it never starts or replays work. |
| `task.progress_reported` | Protocol-42 bounded owning-solver estimate, actual model/step/call and exact checked-plan digest. Encrypted session advice, never lifecycle completion, answer, acceptance or permission. |
| `process.started` | Owned tool-call ID, PID and process group. |
| `agent.session_bound` | Protocol 108. Harness (`claude-agent` or `codex-agent`), native session or thread ID, transport, user executable path/version, sign-in method (never credentials) and canonical Local root, committed when the harness reports its initialized session. `resumed` must match the previously bound native session of the same harness on the same root. |
| `agent.step_started`, `agent.message` | One harness response in the owning turn, with text, summarized reasoning and harness tool calls, plus a text-only context blob. Not a Moguri model call or budget entry. |
| `agent.usage` | The harness's cumulative session token totals and, for Claude Code, its own USD estimate. Never provider-reported or billed cost and never enters the Moguri budget ledger. Harness tool calls use the existing `tool.*` events with `call.harness`. |
| `workspace_folder.saved` | Protocol 109. A trusted workspace folder: canonical root device/inode, sync flag, excluded relative paths and the actual user's trust command. Revisions are monotonic; root, identity and creation time never change. See [workspace folders](workspace-folders.md). |
| `workspace_folder.removed` | Protocol 109. Stops tracking a folder. Its projects stay registered and read-only. |
| `pr_automation.recorded` | Protocol 113. One Fix broken CI record per PR head and check, or one conflict resolution record per queued conflict turn, in its session's compartment. Revisions are monotonic; the session, PR, head and account binding never change; CI attempts are append-only with their original job and admission time; terminal outcomes are final. See [pull request automation](pr-automation.md). |
| `turn.stop_requested`, `turn.stop_acknowledged` | Distinct cancellation transitions. Acknowledgement alone is not successful cleanup. |
| `turn.finished` | Completed/stopped/failed/partial, with actionable diagnostics. Unsettled model usage/process cleanup remain unknown. A known user-plan no-effect failure with confirmed worker exit or a tool-less/root-less generation can explicitly record no workspace effects without claiming general process containment. |
| `policy.updated` | New user-only allowed-env revision and exact Local turns permitted to finish. |
| `provider.changed` | Non-secret connection status/diagnostic. Device codes and tokens are not durable events. |
| `settings.updated` | Shared validated settings, value revision and permission revision. Edits cannot rewrite an admitted prompt snapshot. Schema 107 adds optional `voice.model`: an external streaming model locked to its reviewed path, size and SHA-256, written only by `voice.model.trust`/`voice.model.managed`. Schema 108 adds optional `claudeAgent`, `codexAgent`, `hostedProviders` (connected hosted providers; credentials stay in the secret backend), `hostedDeviceId` (the Sign in with ChatGPT host ID, not a credential) and endpoint `auth: "header"`/`authHeader`, `headers` and `discovery`. Hosted account commands record `model.authorization_changed` with the provider ID. Schema 109 adds optional `git.branchPrefix` (prefix for generated branch names) and `retention.archiveMerged`/`archiveMergedAfterDays` (archive sessions after their pull request merged). |
| `capability.saved` | Project content digest, kind, source, owner and explicit enablement revision. |
| `capability.deleted` | Exact retained standalone skill removed from the registry by the actual user after a revision check. Plugin-owned skills and other kinds are rejected; history is retained. Schema 106. |
| `capability.proposed`, `proposal.decided` | Reviewed exact proposal/base digest, real model/user origin and actual user decision. No automatic application or enablement. |
| `job.started`, `job.progress`, `job.finished` | Owned capability work, bounded progress, actual completed/failed/cancelled/partial outcome and retained result reference. Protocol-27 memory indexing retains original command/digest/authority/target before capture. Protocol-28 candidate jobs retain exact original phase/command/root; progress/finished bind `candidateId` and share its independent artifact key. A terminal/partial candidate job cannot be replayed/upgraded; completion needs its matching verified candidate result. Schema-107 `voice.inspect` jobs retain a read-only model review (header, streaming capability, SHA-256, file fingerprint) that alone can become a trusted voice model. |
| `board.saved` | Project configuration/revision, ordered phases, merged destination and explicit read-only integration policy. |
| `issue.saved` | Complete revisioned local ticket and real `user`, `github` or `linear` actor. Only a verified merge can drive an automated phase transition. |
| `cache.prepared` | Exact plan digest, advisory check time, package/reuse/download counts and `scripts: blocked`, never a permanent safety grant. |
| `queue.held`, `queue.released` | Explicit prompt admission state; holding does not require a provider or start a model request. |
| `session.organized`, `session.group_saved` | Revisioned title/pin/unread/group/acyclic same-project attachment and group metadata. |
| `session.mode_requested`, `session.mode_changed` | Immediate restriction of new approvals and safe-boundary mode acknowledgement. Side/model-subagent sessions cannot gain edit authority. |
| `session.browser_changed` | Explicit validated HTTPS/loopback preview association, not model context. |
| `project.configured`, `project.folder_saved`, `project.relocated` | Typed policy/configuration/navigation and attached-folder changes; atomic exact-membership reorder and index invalidation. Schema 109 adds optional `repo.screenshots`, `repo.installers` and `repo.installerCommand` (agent screenshot and end-of-session installer preferences). |
| `artifact.saved` | Legacy immutable plan snapshot; migration preserves its payload/identity while moving encryption into an independent artifact compartment. |
| `artifact.revised`, `artifact.deleted` | Typed document revisions, exact source/actual-actor provenance and user edits/archive or profile-owned deletion tombstone. Generation/role deletion retains only original command ID/digest to block paid resurrection. Source sessions/files and other grants are not deleted. |
| `candidate.saved` | Protocol-28/29 version-1 artifact-owned candidate revision: exact Local source/stage/base, immutable proposal, original commands/jobs and optional exact owning session, actual user acceptance, attempted/observed paths and stop request. Terminal verified record/result/job commits atomically. Changed identities, erased effects, fabricated acceptance and terminal replay are rejected; restart never probes/replays pending effects. Shared user APIs do not authorize compound models. |
| `candidate.generation_recorded` | Protocol-31 version-1 independent report-owned generation: immutable original input/command/model/root/authority, actual draft step and raw/proposal observations, monotonic stop and truthful proposed/stopped/failed/partial terminal state. Result, model usage and actual-model artifact provenance commit atomically; restart never dispatches another call or stages files. |
| `role.sequence_recorded` | Protocol-32 version-1 independent report-owned scope/command/policy and exact ordered plan/model/step/input/result observations. Later starts require settled known bounded prior accounting. Stop/terminal work cannot replay; a terminal unconfirmed step may only append an actual late result without changing the overall partial outcome. No acceptance or workflow-selection authority. |
| `workspace.saved` | Revisioned owned Local root/branch/base/common-directory identity, job and creating/ready/removing/partial/removed outcome. Never a permission or fallback root. Protocol 112 adds `volume` (worktree on the virtual disk), `parked` (archive or disk-pressure cleanup removed a clean, pushed worktree; restore recreates it) and `cleanup` (the latest kept/removed reason). |
| `application.virtual_disk_saved` | Protocol 112, global: the optional virtual disk for new session worktrees (size, image, mount point, creating/ready/resizing/unmounted/removing/off/failed status, diagnostic, and pause/resume pressure transitions). Not accounting, telemetry or a permission. |
| `change_set.saved` | Stable workspace/branch/base and optional ticket/PR association. No publish/merge authorization. |
| `session.workspace_bound` | Explicit nullable binding for a fresh idle session; existing conversation/queue is not moved. |
| `terminal.changed` | Owned user-console lifecycle and immutable Local/Remote env/peer/root/launch/original-command, never input/output or keystroke hashes. Acknowledged inspection is distinct from proven closure. |
| `terminal.owner_changed` | Independent profile-owned authenticated user-console owner/build/endpoint and actual lifecycle/private-cleanup stage. Protocol-25 Remote preparation can retain null paths/PID before resources; observed peer/build/path/PID cannot switch. No auth key or I/O; exact reattachment never guesses a PID or replays input. |
| `mcp.remote_recorded` | Protocol-24 exact profile/session/project/turn/step MCP intent/result revisions, actual model/external actor, peer/resource/root/helper and original command. Version-1 intent/result content is encrypted into the owning session in the same transaction. No access/refresh credential. Scope, observed forwarding and retained results cannot be rewritten; late receipts preserve the original partial turn/job without replay. |
| `turn.prompt_bound` | Exact effective step prompt digest, including mode, repository instructions and any opted-in retrieved memory. |
| `session.deleted`, `project.removed` | Transactional tombstone/key erasure with retained sanitized usage; independent artifacts survive session deletion. Protocol 105 project removal also erases every compartment of the sessions it removes, including their pre-move project-free history. |
| `session.repository_observed`, `session.repository_dismissed` | Protocol 105. A canonical Git repository root strictly inside a project-free Home chat's captured Home, observed from that chat tree's own successful file writes, and the actual user's "not now". Never Home itself, never inferred from other chats. |
| `session.project_bound` | Protocol 105. Moves one exact project-free Local chat into an existing project whose path equals the captured root; `project_id` is the new project. Removes `homeRoot`/proposal, records an explicit checkout origin and a `user` or `service` actor. See `chat-repository-binding.md`. |
| `mcp.oauth_changed` | Non-secret explicit OAuth lifecycle and transient-link readiness. Tokens, authorization URLs, state, PKCE verifiers and client secrets are not event payloads. |
| `configuration.proposed`, `configuration.decided` | Exact scoped content/base digests and revision, verified source excerpts, actual user/model origin and a real user decision. No self-approval, authentication, automatic enablement or publication. |
| `attention.raised`, `attention.cleared`, `attention.acknowledged` | Atomically derived question/approval/failure/done state; heuristic provenance is explicit and read acknowledgement never resolves or approves. |
| `question.asked`, `question.answered`, `question.cancelled` | Exact model/step/call and owning-turn question, optional offered-choice Guided model recommendation, actual answer actor and cancellation. Advice never resolves the wait; actual-user answers cannot be forged by a model, heuristic or queue item. Retained model advice/actual answer keep distinct source digests. |
| `budget.recorded` | Immutable profile-owned reservation/settlement/import: actual model role/session/owning turn, held unknowns, captured price basis, reported total and nullable category/stream/time provenance. Source deletion/restart never refunds unconfirmed calls; filters do not change admission. |
| `budget.plan_recorded` | Protocol-30 version-1 profile-root planned capacity, not a call/report: immutable owner/turn/role/provider/model/bounds/rate and held-to-consumed/released lifecycle. Consumption atomically binds one actual entry/start; policy release is only for a proven undispatched hold after its exact owner ends. |
| `budget.policy_changed`, `budget.blocked` | Explicit revision-bound profile cap or actual admission rejection. A blocked request retains a diagnostic checkpoint without inventing an answer, extra paid call or Git success. |
| `operation.recorded` | Atomic sanitized profile-root tool/MCP attempt revision: actual actor, safe identifiers, owning scope, exact outcome and nullable timing/source provenance. No arguments, command/output/error text or prompt contents. |
| `operation.coverage_started` | Versioned tracking boundary and retained-only historical coverage. Previously forgotten history is unavailable, not zero calls. |
| `repository.recorded` | Explicit user refresh/clear revision, encrypted at the profile root: exact Git/root scope, verified owner/visibility/license evidence, lookup location, timestamp and job provenance. Protocol-26 authenticated SSH observations retain original host/port/login/key/root/build; incompatible boundary metadata is rejected. Future reservations capture immutable snapshots; legacy charges are not backfilled. |
| `profile.saved`, `global.controls_changed`, `global.policy_changed`, `global.budget_changed` | Root-only profile lifecycle and shared preference/policy/cap revisions. Atomic scoped replicas preserve enforcement without exposing foreign payloads. These internal events never enter a user's scoped replay. |
| `skill.publisher_saved`, `skill.trust_blocked` | Protocol 112, profile-root only. An actual-user saved Ed25519 publisher key (SPKI SHA-256 fingerprint, canonical PEM, identity label) or a permanent block of a key fingerprint or exact skill artifact digest. Unique and monotonic; a saved key is not identity verification, and a block stops new admissions, loads and later effects without recalling delivered instructions. |
| `telemetry.export_configured` | Profile-root reviewed OTLP configuration. Protocol 112 disclosure 2 adds `logs` and canonical credential header names; values stay in the secret backend. Disclosure-1 history projects with logs off and no headers. |

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
discovery reads registrations without adopting arbitrary paths. Protocol 17
routes read-only Remote session files/Git/plan queries through the exact pinned
SSH worker and explicit remote root. Replies carry bounded typed data, not
durable model context or filesystem permission. Post-await peer/root/env/policy
changes reject the reply; Remote plan text never becomes a Local opener path.
No mutating Remote workspace API is enabled by those reads. Migration 17 adds
only a compatibility marker and preserves prior encrypted history/receipts.
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
{"type":"authenticate","protocolVersion":29,"profileId":"default","token":"<private token>","after":0}
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
