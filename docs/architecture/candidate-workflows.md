# Durable reviewed candidates

Status: 0.22 source implements the Local reviewed-candidate slice. The
[private transport](compound-routing-primitives.md) and
[owned-file prerequisites](candidate-primitives.md) are qualified separately.
The shared SDK, CLI, native TUI and desktop expose manual proposal staging and
separately reviewed application. They do not enable compound model routing or
finite kupo budgets. A new immutable packaged delivery remains a separate gate.
Sandbox remains paused.

Execution development now uses protocol/database **29**. The additive
`candidate_execution_schema` marker preserves old version-1 records with
missing owner/attempt/stop fields; absence is not fabricated historical
telemetry. New stage/apply intents bind an explicit Local agent-session owner,
while record/job/result encryption remains independently artifact-owned.
Stopping that owning session cancels its job; deleting an old source session
does not destroy the candidate. A later explicit compatible Local session may
review/apply the same retained proposal without relabeling its authorship.

The shared SDK flow is preview, explicit stage into an existing
clean managed worktree, read/wait, fresh apply review and explicit apply.
No selected model or model call is required. Stop intent precedes abort;
attempted and observed paths remain separate, and terminal candidate/job
success commits atomically. The service rejects read-only/Remote/excluded
Local scopes before resolving Local data. Actual service SIGKILL qualification
covers before-effects, after-first-file and retained completed outcomes without
replay; native packaging remains required before delivery.

## Executable scope and clients

`candidates.preview(sessionId, stageWorkspaceId, patch)` checks the current
Local agent session, exact clean owned worktree/repository/HEAD, source bases
and policy. `stage` requires that preview digest and retains a separate report
and original job before files. `read` and `wait` expose actual metadata and
immutable proposed bytes; a settled wait is not necessarily successful.

`applyPreview(candidateId, explicitSessionId)` freshly checks the same recorded
source/base and staged bytes. `apply` requires its current revision/digest and
records actual-user acceptance before source publication. A compatible new
Local session can own this action after the original session is deleted.
`reject` changes only a fully staged proposal; `stop` requests only the exact
captured active job. Cancelling an old completed stage job cannot affect a later
apply phase.

The CLI accepts bounded patch JSON files with explicit `--session`,
`--workspace`, digest/revision and `--confirm-write` flags. Shared
`/candidate` commands use exact structured JSON and `confirm-stage` /
`confirm-apply`; `/candidates` opens the desktop panel or lists retained
proposals in the TUI. Desktop loads or explicitly adds text files, stages an
exact preview, then requires a separate fresh source review. Scope changes
preserve unsaved text, invalidate old output and never retarget a pending edit.
Bound candidate report bytes are read-only in the generic artifact editor;
renaming, organization and complete history export remain available.

This slice supports at most 20 unique portable relative text paths, 32-KiB
patch JSON and a 64-KiB versioned document. New leaf files need existing
approved parent directories. It does not delete/rename files, create directories,
alter modes, run validators or execute model-generated commands. Checks prove
roots/bases/bytes, not project tests, semantic code quality or model-family
independence. No model, automatic Git commit, push, merge or branch deletion.

Reuse Node and TypeBox (MIT), existing AES-GCM/SQLite artifact compartments,
managed worktrees/root leases and canonical capability jobs. System Git is
the existing GPL-2.0-only executable. No dependency, alternate workflow store,
arbitrary draft command or process-isolation claim is added.

## Versioned authority

Protocol/database 28 adds `candidate.saved`, a version-1 typed candidate
record, and original candidate job intent. A transactional schema marker is
additive: preserve existing ciphertext, keys, receipts, vectors, histories and
original job identities. A failed marker migration must reopen schema 27
unchanged. Old profiles start with no candidates, not a fabricated proposal.

Candidate identity equals its independent retained report-artifact identity.
Both the proposal document and candidate events use that artifact's retention
key, not the source session/project grant. Existing explicit project
retain/export/delete choices and artifact deletion must preserve or forget
both consistently. Retaining a document never grants filesystem authority.
Current artifact content must still match the immutable recorded document;
generic editing cannot replace a bound proposal.

Candidate `job.started` carries its exact original candidate/command/phase
intent. Its progress/finished events additionally bind `candidateId`; all
three lifecycle events and result grants share the same artifact compartment.
Do not leave orphan project-owned job events or proposal/result copies after
artifact deletion. Only a complete matching candidate result can complete a
job, and a terminal/partial job cannot be upgraded or replayed.

Existing artifact operations cannot edit a bound proposal's bytes or archive/
delete its active owned job. Name/association changes remain normal revisions.
Exact project review digests include candidate history. Explicit exports that
contain candidates use `moguri-artifacts` version 2 and retain canonical
candidate/job events plus exact result blobs; ordinary document-only exports
stay version 1. The same 8-MiB bound applies, without truncation. Source/project
deletion therefore cannot silently discard workflow provenance after export.

The document binds the exact Local source/staging roots, lossless directory
identities, Git common directory/HEAD/branch, source file bases, full proposed
text and current authority digest. The staging root must be an explicitly
selected clean managed worktree from the same project/base, never the source
root, a guessed path or a silently created branch. A new revision needs another
explicit owned candidate root. No Remote-to-Local substitution is supported.

Model/validator/critic output remains untrusted data. Initial user-imported
patch content has unknown authorship; the user's retention/review action does
not turn it into user-written instructions. A real apply command can retain
actor `user` acceptance of the exact proposal and fresh review/authority
digests. Critic confidence, passing byte checks and model advice cannot create
that acceptance or lift project/env/tool policy.

## Effects and recovery

Stage and apply intents retain the canonical command ID/digest and original
job before effects. Repeated or missing-receipt commands must return that
identity without re-probing or re-executing files/Git. Candidate revisions
cannot change their original roots, document, ordered paths or stage intent;
apply ownership/acceptance becomes immutable once admitted.

Retain ordered staged, attempted and confirmed-applied paths. Source writes
need current exact-root leases, allowed Local env, writable folder policy,
unchanged bases/staged bytes and the reviewed actor. Preserve the real source
index/HEAD and unrelated files. Publication/commit is separate and remains
policy checked. The writer's synchronous last-boundary guard and per-file
directory sync do not create a multi-file transaction or hostile-writer
containment.

Cancellation/failure after a possible effect is partial, not rollback or
successful cancellation. Recheck current authority and actual bytes before a
verified terminal result. Restart preserves the original intent, marks
interrupted work honestly and inspects without replay. Unknown/partial roots
remain quarantined until an explicit existing user recovery action.

Candidate jobs lease both captured roots across clients and isolated profiles.
Cache/plan/artifact/terminal/worktree surfaces honor that ownership. Reviewed
repository-instruction publication also registers its exact writer root and
cannot race a candidate in either direction. Final verified candidate state,
result grant and job completion commit together; a failed terminal append
preserves actual partial files instead of claiming success.

Compound model roles additionally need the existing owned worker/all-role
ledger, genuine model-family qualification, bounded workflow reservations and
authorized accepted-work checkpoint wind-down. Those gates remain separate.

## Foundation evidence

The combined internal state/file/routing gate passes **51/51 in 11.26 s**,
including twelve state/retention cases, with both type checks/build. The
generated schema-27-to-28 marker transaction takes **0.57 ms** and preserves
raw ciphertext, keys, receipts, blob grants and derived scope rows. An injected
marker failure leaves schema 27 exactly reopenable.

Cases include exact original intent/job/root binding, immutable revisions and
acceptance, observed-effect prefixes, terminal/partial replay rejection,
separate profile grants with identical document/ID, source retention,
independent job/result deletion, real service reopen without probing missing
roots, existing SDK artifact edit/delete/export guards and version-2 history.
The actual serialized export accepts **8,388,608 bytes** and rejects the next
byte while preserving grants. This is not an actual in-flight file-operation
SIGKILL or public candidate execution/client qualification.

Retained failed evidence includes missing event/retention support, insufficient
transition/outcome guards, unsafe generic document edits, an accidentally
nested regression registration and a legacy-fixture guard incorrectly reading
an already closed store. The regression was moved to top level and the legacy
guard now uses the reopened generated database. No production data or denial
policy was changed to make those fixtures pass.

The committed foundation then passes the complete **631/631 local cases in
494.00 s**, all **41 hidden source desktop workflows in 1.5 min**, and a
temporary packed protocol-28 SDK's independently approved/rebuilt/audited
installation, four external entrypoints and existing Local/SSH/runtime
contracts. Source and consumer audits report zero vulnerabilities. The
legacy gate's two closed-store fixture failures were corrected before this
complete run; they were not counted as passes.

This qualifies internal state/retention compatibility, not a public candidate
stage/apply workflow, in-flight candidate-file SIGKILL, an immutable delivered
0.22 archive or actual packaged desktop. The public Single subset and
finite-budget/compound gates remain unchanged; the qualified 0.21 artifacts
were not rebuilt or repacked.
