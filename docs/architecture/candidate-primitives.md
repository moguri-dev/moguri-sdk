# Owned candidate file prerequisites

This is a private Local/text-patch prerequisite for D11, not a public compound
workflow, isolated process boundary, accepted model result or new SDK API.
Sandbox remains paused. Remote candidate transport is not qualified here.

Reuse Node filesystem/crypto and TypeBox (MIT), the existing protected-path,
bounded UTF-8 read and base-checked atomic-file writer, and actual SDK-owned
Git worktrees (system Git, GPL-2.0-only executable). Do not run model-generated
commands, hooks, validation programs, Git publication or arbitrary draft tools.
An owned Local directory is not process isolation.

The generated test first creates a real managed worktree using the shared SDK.
Only a strict bounded typed patch can be staged there. Capture exact profile,
project, owned-workspace, source/stage directory identities, base commit,
policy revision, paths, base digests and proposed bytes before effects.
Reject a source/stage alias, protected path, malformed or lossy proposal and
changed ownership. Preserve the original source checkout/index while staging.
The preparation authorizer verifies the actual owned checkout is clean; never
adopt existing user/candidate edits as a disposable staging base. Inspect an
unchanged existing proposal without writing it again. A different revision
needs another explicitly owned candidate workspace, not a replay over old work.
Before effects, reject duplicate actual canonical targets and duplicate
NFC/lowercase path keys. The latter is a conservative portable-proposal
restriction, including new files, not an assertion that every host filesystem
has identical Unicode/case rules. Do not silently rewrite the proposed paths.

Review binds a domain-separated SHA-256 of the exact typed snapshot. The
`moguri-candidate-prototype-v1` domain and compact ordered JSON are private
Moguri encodings, not SendBox provenance or snapshot-manifest semantics.
An injected authorizer must approve that exact digest before source writes;
model confidence, validation or a critic verdict is never this approval.
Recheck all bases and staged content before applying the first file and retain
each actual applied path. Source files are not staged or committed by this
primitive. Unrelated tracked/staged/untracked content stays untouched.

The caller must hold the existing exact-root writer lease and supply current
policy/ownership checks plus an acknowledged intent/effect recorder. The
prototype does not add another workflow database, authorize its own calls or
prove those hooks durably integrated. No durable event/schema change is made.
Public admission still requires versioned candidate/acceptance/application
events, independent retention, existing worker/ledger ownership, real command
receipts and crash/restart recovery without replay.

File publication is atomic per file, not a fictional multi-file filesystem
transaction. Preflight can reject a stale set before any source write. A
later conflict, cancellation, failed receipt or changed authority after an
effect is explicitly partial with exact observed paths, never a false rollback,
successful cancellation or automatic overwrite of newer user work. Existing
file guards and a service lease do not establish hostile external-writer race
containment or full detached-process containment.

The shared file writer adds an optional synchronous authority guard immediately
before rename, rechecks owned cancellation after it, then synchronizes the
destination directory before acknowledging success. Its existing effect callback
still fires immediately after rename, so a later durability/receipt failure
cannot hide an already-published file. Candidate completion additionally
rechecks authority and actual bytes after the final file; a newer user edit is
preserved and cannot be recorded as the verified proposal.

Required generated cases include dirty source bases, exact review/rejection,
unchanged real index/HEAD/unrelated files, stale source/stage/policy, changed
directory identity/symlink escape, failed before/after-effect receipts and
multi-file partial cancellation. Native clients remain unchanged until the
subsequent durable service/SDK vertical slice is qualified.

## Measured private gate

`node scripts/candidate-spike.mjs` passes **39/39 in 10.48 s**, including
15 candidate cases, four file guards and the preserved 20 routing cases.
The expanded directly coupled plan/actual-worker/workspace/artifact/config
gate passes **77/77 in 23.78 s**. Both type checks/build and a temporary packed
SDK's independently approved installation, four entrypoints, existing
Local/SSH workflows and audit pass with zero vulnerabilities. This is SDK
compatibility evidence, not a delivered 0.22 archive or packaged desktop.

Actual maintained pi-ai Cascade and Critique outputs also pass through one
real SDK-owned stage and exact byte/base validation, then remain unapplied
until the injected exact-review authorizer allows publication. Read-only
revalidation does not stage the same proposal again. These generated complete
paths take **449.30 ms / 369.49 ms** with **2 / 3** model calls and **84 / 126**
reported tokens, respectively. Billed costs remain unknown. This proves
synthetic mechanics, not real-model quality or family independence.

The dirty-base case compares the **raw source index bytes**, not only its
logical tree, plus actual HEAD/branch and unrelated staged/untracked contents.
Failure cases cover retained intent races, case/Unicode aliases, binary/lossy
text, wrong/mutated review, stale bases, dirty candidate roots, replaced roots,
symlinks, before/after-effect receipt failures, held review/user edits, late
revocation and cancellation after the final file. Applied/partial paths remain
explicit and newer user content is never rolled back by the prototype.

The first fixture incorrectly supplied macOS's noncanonical temporary-path
alias; it was corrected to use the SDK's authoritative canonical project root,
not by weakening root checks. Subsequent red cases exposed stage changes
during intent retention, an abort inside the final authority guard, physical
path aliases, final-file false completion, binary proposals and unsafe reuse
of a dirty staging root. Each failed result is retained separately and is not
counted as qualification.

Remaining gates include actual lease/actor/receipt integration, versioned
independent candidate records, restart reconciliation without replay, shared
SDK/CLI/TUI/desktop exposure, all-role scheduler reservations and authorized
checkpoint wind-down. No public compound policy is enabled by this probe.
