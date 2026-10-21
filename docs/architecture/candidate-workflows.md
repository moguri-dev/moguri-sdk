# Durable reviewed candidates

Status: 0.22 foundation in development. The
[private transport](compound-routing-primitives.md) and
[owned-file prerequisites](candidate-primitives.md) are qualified separately.
They do not expose public compound routing, finite kupo budgets or a new
candidate client workflow. Sandbox remains paused.

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

The foundation first qualifies schemas, transitions, retention and migration.
Public service/SDK/CLI/TUI/desktop operations, actual writer admission,
concurrency, failure/stop and service-SIGKILL recovery must pass before exposure.
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
