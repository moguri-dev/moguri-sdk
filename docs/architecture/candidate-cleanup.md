# Session-owned candidate retention

Implemented in service/SDK protocol and database **57**. This intentionally
supersedes the candidate-only retention portions of earlier checkpoint
contracts, not their frozen qualification or ordinary artifact guarantees.

Candidates and fixed-model generation proposals belong to their canonical
originating session. Permanently deleting that session, manually or through
archived-session expiry, deletes their records and proposal compartments.
Archiving alone does not delete them. Ordinary artifacts and independently
retained role/compound reports keep their existing lifecycle.

Reuse Node.js, TypeBox, React, Electron, OpenTUI and maintained pi-ai (MIT),
the existing SQLite/AES-GCM retention store, capability jobs, owned worker,
budget ledger and GitHub metadata reader. System Git is the existing
GPL-2.0-only executable. No dependency or alternate model loop is added.

The lifecycle must retain original session ownership separately from later
viewing, organization or application. PR association binds an exact canonical
repository and PR number, never a repository-wide merge or the session's latest
link. Only a fresh, successful, identity-checked merged response under current
metadata-access policy can start automatic deletion, including for archived
sessions. Closed, unavailable, unverified and stale observations cannot.

Deletion intent precedes cancellation. Settle exact owned jobs and model work
before atomically forgetting candidate grants and recording completion.
Interrupted/failed cleanup remains visible and recoverable; late results and
missing command receipts cannot recreate deleted proposals. Usage, unknown
budget holds, shared artifact grants and filesystem quarantine survive.
Cleanup never reverts applied code or removes branches, worktrees or PRs.

Creation requires an explicit session project backed by the exact Git root.
Manual, generated and compound admission must reject project-free or plain-folder
sessions before model preparation, charges, jobs, proposal retention or writes.
Clients use the same SDK/service authority and never borrow a previous project.

## Canonical ownership and PR observation

Candidate identity remains its proposal-artifact ID. `CandidateRecord.originSessionId`
and `CandidateGenerationRecord.sessionId` are canonical, not the artifact editor's
associations, a later applying session or the current client selection.
`candidate.owner_bound` version 1 is encrypted in that proposal's compartment.
It records the exact profile/project/origin and optional canonical GitHub
repository/PR identity.

When staging from an actual fixed-model generation, the candidate's ownership
event also copies exact original input/raw-result/proposal digests into its own
grant after matching canonical generation, roots and model-source evidence.
Deleting the original generation does not erase another origin's candidate
copy. Those copied grants disappear with that candidate, not the report last
viewed or applied. Missing legacy evidence is not fabricated.

Capture the first recorded PR association at creation, or the first subsequent
explicit link for that original session and source workspace. Never overwrite a
non-null association when the session, work item or change set is relinked.
New work captures its own association. Legacy records with null canonical
origin remain unassigned; do not infer ownership from a report name, latest
viewer, applying session or a convenient current repository.

The dedicated service observer scans retained owners, including archived
sessions, rather than reusing cached session/ticket merge badges. It uses current
`repo.githubAccess` and board `autoRefreshPrs`, groups exact scopes, and captures
the target IDs before each read. Policy/configuration/workspace revisions must
still match after the response. Public reads have a null execution root and
remain possible after an explicitly detached source worktree is removed;
they do not borrow the session's newer checkout. Authenticated reads
check the captured directory/Git identity before and after the controller's
configured `gh` boundary and stay blocked if that exact root is unavailable.
No SSH/controller-account substitution, public
fallback, account discovery or model call is added.

Only the existing metadata reader's identity-checked `merged: true` response,
closed state and valid merge timestamp can establish cleanup intent. Unknown,
open, closed-unmerged, malformed, wrong repository/number, stale scope and
failed authentication cannot. A relink does not retarget old owners; candidates
created during a read are not silently added to its captured target set.
Fresh session/board merge observations and completed Moguri merge operations
prompt an immediate, policy-eligible exact verification rather than waiting for
the poll interval. They are triggers, not deletion evidence. A confirmation
arriving during an older in-flight read queues another fresh pass, so the older
response cannot swallow it or become authority for newer work.

## Durable cleanup and accounting

`candidate.cleanup_recorded` version 1 is profile-root recovery metadata:
immutable reason and target IDs, monotonic revision, pending/failed/completed
state and diagnostic. Persist pending intent before stopping anything. The
manual session-delete route and archived-session expiry call the same controller
cleanup path. Project removal uses it for the sessions it actually removes,
regardless of the separate retain/export/delete choice for ordinary artifacts.

Cancel only exact candidate stage/apply job IDs, target generation turns and
compound work actually owning those candidates. A later turn sharing the session
is not an owner. Await job settlement, actual owned Node-worker exit and admitted
frame processing; bounded failure preserves the pending intent and grants.
No retained PID is adopted or blindly signalled. Session deletion still honors
existing terminal/remote/unconfirmed-process reconciliation requirements.

Artifact deletion, removal of proposal keys/blob grants, preserved root
quarantine, completed cleanup and session deletion commit together. Generic
explicit report deletion shares the same tombstones. Original stage/apply and
paid-generation intent hashes survive without proposal text, preventing
missing-receipt replay. Successful retry of an already completed session deletion
is idempotent. Removing a candidate does not undo files or delete its stage.
Append-only encrypted audit rows are not plaintext retained candidate records,
and this is not a claim of SSD erasure or removal of external user exports.

Model-completion output for fixed-model generation is encrypted with the
proposal, not redundantly retained by the source session. Before deleting that
compartment, `candidate.usage_retained` preserves only exact original usage
metadata needed by a surviving session. It binds the original generation,
session and independently retained draft ledger entry; it neither contains
proposal bytes nor settles/refunds a call again. Required budget entries,
unknown holds, planned-capacity history and ordinary/shared artifact grants
remain independent.

Recovery first reconciles interrupted owned records without replaying inference
or files, then resumes retained cleanup. It also removes older candidates whose
canonical origin is proven deleted by retained session/project deletion events.
Unknown origin stays unknown. Late callbacks cannot recreate forgotten scopes,
and dispatch checks deleted-command tombstones before looking up roots.
Pending/failed cleanup appears in the shared snapshot and desktop Candidates /
stored-session management. It never becomes a successful deletion receipt.
After a failed attempt, the surviving session may still save its unsent draft
so desktop's required pre-delete flush cannot deadlock retry. New model,
candidate and other owned work remain blocked; saving a draft neither sends it
nor lifts the retained deletion intent.

## Upgrade and clients

Migration 57 transactionally installs `candidate_retention_schema`. Existing
candidate/generation records keep their version-1 provenance. A deterministic
historical replay binds original owners and first PR links, then idempotently
appends ownership events before new work. It does not assign current sessions,
inspect repositories or authenticate during migration.

For each legacy generation, rekey a model-completion payload only when its
recorded profile, report, session, project, turn, step, model and raw-result
digest all match. Preserve event IDs, sequences and timestamps; add the exact
`candidateGenerationId` and move that payload to the existing proposal key.
Remove an obsolete session blob grant only when no other retained event needs
it. Other ciphertext, keys, receipts, derived scopes and required accounting are
unchanged. Marker/rekey failure rolls back to an exactly reopenable schema 56.
No new paid call, guessed grant, deletion-as-migration shortcut or state reset.

New ownership-bearing candidate/generation exports use `moguri-artifacts`
version **10**, including exact owner/PR events and the existing original
documents/results. Legacy export formats remain unchanged; ordinary artifacts
keep their prior formats and independent lifecycle. Export bounds remain exact.

SDK `candidates.eligibility(sessionId)` reports eligibility/diagnostic without
jobs, artifacts or inference. CLI `candidate eligibility --session ID` and
shared `/candidate eligibility` use it. Desktop disables manual, generated and
compound creation until the same service check succeeds; source changes
invalidate stale eligibility/preview results without discarding drafts.
Direct commands repeat the authoritative Git/source guards before effects.
Session-delete confirmation and retention settings disclose automatic candidate
deletion, with no per-candidate confirmation.

## Prerequisite measurements

Generated macOS arm64 qualification on 2026-10-25, before integration:

| Primitive | Result |
| --- | --- |
| Locked installation | 430 packages installed; zero audit findings |
| Provider fixture streaming/cancellation | Pass; 6 requests, cancellation 31.85 ms; no real login/inference |
| SQLite WAL/crash/rebuild | Pass; 1,000 events, append p95 0.049 ms, rebuild 0.50 ms |
| Owned PTY process-group cancellation | Pass; 151.51 ms, zero generated survivors |
| OpenTUI streaming | Pass; 60 updates, 17.36 ms/update |
| Hidden Electron shell | Pass; cold start 187.93 ms, aggregate 444.72 MiB, scroll frame 11.27 ms |
| Generated filesystem/Git baseline | Pass; 2,000 files, search 0.91 ms, Git status 5.92 ms |
| Independent retention compartments | Pass; 500 append-only events, 250 remain readable after session-key removal, 137.68 ms |
| Hidden Ghostty | Pass; 423,045-byte WASM, actual input/grid, 25.20 ms |
| Candidate/file/routing primitive gate | Pass; 39/39 in 10.36 s |

The initial spike first failed because this worktree lacked dependencies;
`npm ci` restored the lockfile before rerunning it. The Phase 0 runner continues
to report unavailable live-provider, Rust/Linux, signed/notarized packaging,
native SendBox, real multi-model quality, live System One and configured SSH
qualification as failures. Its historical full-attachment/default/budget gate
is also not a new qualification. None is substituted by these generated checks.
The baseline build reports existing large renderer chunks; no dependency,
platform or release-readiness claim changes.

## Lifecycle qualification

The focused cleanup/PR/state/recovery gate passes **28/28 in 14.06 s** with
generated data. The actual two-phase service SIGKILL cleanup gate takes
**3.14 s**; the existing five-phase candidate-file recovery gate also passes
in **8.08 s**. Schema-56 marker rollback preserves exact ciphertext/key/receipt
rows, and the owner backfill/reopen takes **11.59 ms** in this generated run.
Exact generation-result rekey rollback, null-origin preservation, old orphan
cleanup without root/model access, shared grants, independent copies, profile
isolation, unknown capacity, archive-only retention, expiry, verified external
merges and revoked/stale/auth-failed metadata are covered.

Retained red regressions exposed a redundant session raw-output grant, missing
generation-source copies, disabled cleanup after an explicitly removed public
source worktree, and an in-memory notice mutation after a real key-deletion
rollback. Their focused regressions pass without weakening storage, scope,
accounting or filesystem policy. Source type checks, build and audit pass;
the build retains its existing large-chunk warning. No personal credentials,
model weights, microphone, visible user browser or paid inference is used.

The first complete Node run retained **1,367 passes, five failures and 14
physical-native skips across 1,386 cases in 1,126.56 s**. The failures exposed
four migration fixtures journaling new retention fields before claiming older
schemas and one fixture retaining the new marker while downgrading. They now
choose the pre-57 journal encoder before generating actual worker/model evidence;
the encoder cannot retrofit existing history or admit current cleanup events.
Older marker rollback still compares every ciphertext row. The current success
path permits only the separately tested exact generation-result rekey, preserving
all unrelated ciphertext/keys/receipts and event identity. The strict production
and legacy-fixture provenance guards were not relaxed.

The targeted compatibility/merge-trigger rerun passes **24/24 in 14.06 s**.
The packed external SDK also passes installation, all four entrypoints,
real installed worker/CLI workflows and twelve private role/receipt probes,
with zero audit findings. Its installation reports existing transitive
`whatwg-encoding` / `node-domexception` deprecations and an explicitly approved
Moguri postinstall notice. These are not newly introduced dependencies.

The complete Node compatibility rerun passes **1,374 cases, zero failures and
14 physical-native skips out of 1,388 in 1,134.02 s**. The following full hidden
desktop run retained **173 passes, two failures and three physical-native skips
out of 178 in 5.9 min**: one usability assertion expected the superseded
candidate warning, and an existing Remote resize fixture sampled hidden native
geometry before acknowledgement. The copy assertion now checks the Git-project
gate. The resize fixture awaits actual native content dimensions, explicitly
matches the renderer viewport, then still requires real SSH grid growth and
shrinkage; no terminal production code, fixed sleep or relaxed comparison.
The repeated mixed usability/Remote gate passes **16/16 in 44.6 s**.

Final failure-path coverage additionally found and fixed desktop retry's need
to flush a newly edited unsent draft after failed cleanup. Only draft saving is
allowed while that retained deletion is pending; candidate/model work remains
blocked. The actual shared DraftEditor and hidden sidebar deletion flow pass,
with **27/27** session-interaction/retention cases and **21/21** draft/retention
cases. Installed SDK generation cleanup, deleted paid-intent rejection and
independent actual usage retention also pass against the rebuilt package.
