# Reserved checkpoint prerequisites

Status: **0.23 development**, protocol/database **29**. These are private D11
mechanical prerequisites, not public finite kupo budgets, a compound scheduler
or an automatic checkpoint feature. The immutable 0.22 SDK/app remain unchanged.
Sandbox stays paused.

Reuse maintained pi-ai, Node/abort/filesystem/crypto and TypeBox (MIT), the
existing independent budget ledger and actual reviewed-candidate SDK. System
Git is the existing GPL-2.0-only executable. No dependency, separate accounting
store, new durable event/schema or private credential is added. The generated
foreground probe is not a replacement production worker loop.

## Reserved dispatch

The normal `BudgetRuntime.reserve` calculation can reserve a complete bounded
checkpoint role before ordinary calls. Reservation is not a provider report.
The private planner refuses a reduced envelope before recording it. All
session/profile/global units include that hold; other roles/profiles cannot
spend it again. Unknown usage/price and actual overages never become zero.

`reservedOutput` verifies the original session/owner/turn, role, provider,
selected/canonical model, env, input estimate and actual output capability. It resolves the
**current authoritative session**, not an old caller snapshot. Exact cap
equality can consume already held capacity without another reservation; a
newly stricter cap below actual/held usage blocks that dispatch. Changed USD
prices cannot silently reprice or reuse the old captured estimate.

This is a synchronous accounting check, not an effect or permission grant.
Its caller must durably append the exact `model.started` **before yielding or
dispatching**. A recorded start rejects reuse even when the completion receipt
is missing. Settled/unknown entries cannot be redispatched. Workflow/root/model
eligibility and approval checks remain separate; this helper does not lift
them or authorize Git.

The generated maintained transport uses the actual request/context estimator,
an explicit loopback endpoint, bounded tool-less requests and zero automatic
retries. Each actual start/completion and derived charge is retained in the
existing store before another role. Context snapshots use actual retained blob
grants, not an invented digest. Failed completion persistence leaves the full
hold and durable start; replay cannot send another request. Cancelled unknown
normal work preserves both holds and blocks another finishing model in this
probe.

## Reviewed local Git mechanics

The shared internal `ProjectService.reviewedCommit` reuses the existing
temporary-index `read-tree`/`hash-object`/`commit-tree` path. Existing artifact
commits use this same helper. It captures files, modes, exact branch/base and
project path before asynchronous work. Paths are preflighted as a complete
distinct portable set; protected paths and lossy text are refused.

Only an **explicit new non-protected local branch** is supported. The normal
checkout, raw source index, HEAD and unrelated staged/untracked work are not
replaced or staged. Captured regular/executable modes are preserved in the new
tree. Hooks/filters are not run; `--no-gpg-sign` is explicit and no tool
attribution is added. There is no push, merge, checkout or branch deletion.

An optional acknowledged publication-intent hook receives the prepared commit
before ref creation. A synchronous current-authority hook runs before
preparation, immediately before publication and before success; stop is
rechecked after each. Ref creation uses the zero-old-ID compare-and-set, never
overwriting a competing branch. The actual ref is checked after publication.
Post-publication cancellation, a lost effect receipt or a moved ref is not
acknowledged success. Objects prepared before a later failure may remain
unreachable; no fictional rollback or automatic replay is claimed.

These hooks do not authorize themselves. A production caller still needs the
actual policy/approval actor, captured root lease, durable original intent,
partial/quarantine lifecycle and no-replay command/job recovery. The private
test uses an explicitly injected exact Git-review fixture after **actual SDK
user acceptance/application**. Model/critic output is never that approval.
This does not establish hostile external-writer or descendant containment.

## Qualification

Run `node scripts/checkpoint-spike.mjs`. The combined gate passes **42/42 in
5.01 s**: 22 new checkpoint/budget/actual-transport checks plus the preserved
20 Single/Cascade/Critique transport checks. Both type checks/build pass.
The final expanded budget/profile/candidate/artifact/routing gate passes
**93/93 in 16.25 s**, including explicit provider/owning-turn rebinding denial.
Six hidden source desktop artifact/budget/candidate workflows pass
in **12.1 s**.

The real generated three-role path reports **126 tokens from three calls**,
with billed USD unknown, inside a **279-token captured cap**. In the spike its
complete accepted-work/checkpoint/restart path takes **1.42 s**. This proves
bounded mechanics, not live provider pricing, quality, empirical model
independence or production routing.

A temporary packed 0.23 SDK independently installs with explicit script
approval/rebuild, four entrypoint types, actual existing Local/SSH/runtime
contracts and zero audit findings. Source audit is also zero. This is
compatibility, not a new immutable SDK archive or actual 0.23 packaged app.
The qualified 0.22 artifacts were not rebuilt or repacked.

Retained red evidence includes a fixture selecting the wrong project-service
property, stale SDK revision assumptions, mutable caller project retargeting,
trusting an old session cap, provider/turn reassignment, and a fixture supplying an unretained context
digest. Those failures are not passes; no production policy was weakened.

Production compound worker ownership, a durable wind-down lifecycle and
unused-envelope outcomes, real-family/quality qualification, SDK/client
configuration and genuinely authorized automatic checkpoints remain separate
gates. Public Single/compound finite admission stays blocked until those are
complete. No new 0.23 native/SDK archive is qualified by this prerequisite.
