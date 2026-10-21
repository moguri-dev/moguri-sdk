# Planned wind-down capacity

Initial foundation: **0.23 development / protocol and database 30**. This adds durable
planned holds and shared inspection, not public finite kupo, compound worker
orchestration or automatic Git approval. The qualified immutable
[0.23 delivery](../setup.md#current-qualified-0230-alpha1-checkpoint) includes
these primitives at protocol 31. Current **0.24 development** adds complete
batch calculation below, without changing the protocol or repacking 0.23.
Sandbox remains paused.

Reuse Node, TypeBox and maintained pi-ai (MIT), the existing profile-owned
append-only budget authority and AES-GCM retention. No dependency, second
accounting database, provider token report or permission surface is added.

## Plans are not calls

Version-1 `BudgetPlan` records capture the exact profile, session/budget owner/
turn, env, selected/provider/canonical model, role, authority digest, complete
input/output envelope and dated price. A plan begins held and transitions once
to consumed or released. Original identity, scope, bounds and price cannot be
changed, terminals cannot regain capacity and unknown prices cannot become zero.

Held plans contribute to the same session/profile/global admission and held
totals, including other unloaded profiles. They do **not** create model calls,
reported tokens, streaming samples or bills. `plannedHolds`,
`plannedHeldTokens` and `plannedHeldUsd` disclose that capacity separately.
Zero calls is an empty call set, never a provider report for a future request.
Per-call history excludes plans.

## Atomic transfer and release

Internal `BudgetRuntime.plan` reserves the entire required bound or fails
before normal work. `consumePlan` validates current authoritative ownership,
scope, authority, prepared identity/capability and captured price. It transfers
the hold to one actual `budget.recorded` entry with `planId`, together with the
terminal consumed plan and exact `model.started`, before dispatch is authorized.
The actual input may be below its conservative bound; the complete planned
output must still fit current policy. No hold is counted twice or borrowed by
another profile/role. Any failed/incomplete append rolls everything back.

The projector verifies the unique retained plan/entry link, original fields,
complete token bound and exact captured-price micro-dollar reservation.
Model-start metadata must match in the admission transaction. Actual overages
and missing usage remain in the model ledger; they are not erased to satisfy a cap.

When the exact owner turn finishes, session is deleted or project is removed,
the service automatically releases **only still-held undispatched plans**.
The policy record retains its actual source event and reason. Consumed plans
cannot release the associated call; interrupted/unknown model charges stay held.
This is deterministic accounting, not a user answer, model decision or new
approval. No client/script refund or plan-creation command is exposed.

## Complete planned batches

Internal `planBatch(session, inputs)` calculates one to 32 distinct future
role holds for the same exact owning turn. It captures request values and
resolves the current authoritative session rather than trusting an old caller
snapshot. Each subsequent role sees all preceding prospective holds in the
same session/profile/global units, including root capacity already charged
by other profiles. Only the newly calculated plans are added to the captured
global total; recorded local/foreign charges are not counted twice.

Every role needs its complete bounds and captured price. If any role cannot
fit, has unknown/stale pricing under a USD cap, repeats an ID, changes owning
turn or overflows safe aggregate precision, the calculation returns no usable
prefix and writes no state. It creates no model call, provider report or
permission. Single-plan `plan` delegates to this same path, preserving the
existing contract rather than keeping a separate calculation.

The caller must append **all returned events with the original owning intent
in one transaction before yielding or dispatching**. This synchronous helper
does not itself append, lock another database or make a partial event subset
safe. Failed final-event insertion rolls back all plans and the command
receipt. Subsequent consumption and canonical-owner unused release still use
the existing independently retained version-1 lifecycle.

Reuse Node, the same TypeBox/MIT contract and budget calculations. There is no
new event/schema/migration, client write API, dependency or automatic Git/model
authority. Existing SDK/CLI/TUI/desktop inspection already sees the resulting
individual holds. A batch does not forecast unknown future candidate context,
prove a model family/quality gate or enable finite kupo by itself.

The reservation binary search now uses `low + ceil((high - low) / 2)`;
summing large safe bounds first could round its midpoint back to `low` and
fail to terminate. The exact maximum-safe-integer regression runs in an owned
deadline-bounded subprocess, so a future numeric regression cannot hang the
test controller.

## Retention and migration

`budget.plan_recorded` and the matching actual-call entry use the independent
profile budget compartment, not source session/project keys. Source deletion
preserves terminal plans, captured prices, original model holds and provenance.
Restart never creates a second hold, starts a model or replays work.

The additive `budget_planning_schema` marker preserves schema-29 ciphertext,
keys, receipts, blobs and derived scope rows. Failure rolls back exactly;
no state deletion is needed. Old entries keep absent `planId` fields and no
historical plan is fabricated. Earlier pre-reservations are not retrospectively
reclassified/refunded using missing evidence.

## Shared inspection

`sdk.budgets.plans({sessionId?,projectId?,folderId?,turnId?,modelId?,providerId?,
role?,env?,range?,status?,offset?,limit?})` returns bounded retained pages.
States are held, consumed and released. Date ranges use the existing UTC
semantics; filters never change cumulative admission.

CLI `budget plans --session ID --filters '{"status":"held"}'` and TUI
`/dashboard plans {"sessionId":"ID","status":"held"}` use the same query.
Desktop session usage and Dashboard distinguish held plans from calls and show
captured estimates, exact ownership, consumed steps and release reasons.
Scope changes discard stale query responses. Model-only estimates say
**No model calls** for a plan-only group, never a misleading free call.

Planned capacity has no call-time repository attribution. Repository-specific
usage excludes it; clear repository/organization/visibility filters to inspect
plans. Profile/call/date filters remain independent of hard policy.

## Qualification boundary

Run `node scripts/budget-plans-spike.mjs`. Targeted generated checks cover
typed immutable transitions, exact caps, unique atomic transfer, real bounded
provider reporting, actual owned-worker stop, failed start append, captured
prices, source-independent retention, isolation and schema rollback.

The source spike passes **17/17 in 1.13 s**, the directly coupled encrypted
legacy/accounting gate **70/70 in 3.53 s**, actual compiled CLI/shared commands
**2/2 in 903.25 ms**, and the actual native TUI case in **191.52 ms**.
Both bounded desktop/compact inspection rounds are complete. The initial
plan-only price display was corrected from a misleading zero-price appearance
to **No model calls**, without changing actual telemetry.

Actual control-plane SIGKILL releases the unused plan while preserving one
unknown **9,965-token** model reservation and exactly one request, with no
source modification or retry. The complete source gate passes **698/698 in
481.26 s**, both type checks/build and all **45 hidden source desktop workflows
in 1.6 min**. No failed or skipped test was counted as qualification.

A fresh temporary packed protocol-30 SDK independently passes explicit script
approval/rebuild, zero audit findings, all four entrypoint types and actual
installed SDK/CLI/shared planned-hold/source-deletion/restart behavior, alongside
all earlier Local/SSH/runtime contracts. Source audit is also zero.
That source-only foundation did not qualify a new immutable archive/app;
later exact 0.23 qualification is recorded in setup. Earlier artifacts remain
unchanged.

The 0.24 complete-batch spike passes **26/26 in 1.13 s**, including nine new
batch cases and the prior actual stop/SIGKILL/transfer/retention/migration
cases. The expanded accounting/profile/routing/generation/compaction gate
passes **135/135 in 137.08 s**, with both type checks/build. Tests cover
exact token/USD boundaries in all scopes, foreign-profile capacity, current
controls, no failed prefix or receipt, simultaneous admission, source
deletion/reopen and safe aggregate precision.

A fresh temporary 0.24 SDK independently installs with explicit script
approval/rebuild, zero audit findings and four strict external entrypoint types.
Its actual internal batch rejects an 89-token cumulative cap without a prefix,
fits exactly 90 tokens, creates no model call, then releases all unused holds
on source deletion/reopen. Prior installed Local/SSH/generation contracts pass.
Five relevant hidden desktop workflows pass in **10.9 s** and three real native
TUI flows in **2.97 s**. No immutable 0.24 app or archive is claimed.

Retained red evidence includes the initially missing batch API, stale fixture
SDK revisions, assuming a synthetic unreported reservation had an observed
terminal lifecycle, and relying on a query page's order instead of stable plan
IDs. The maximum-integer test also exposed the real unsafe midpoint; that
owned run was stopped, the search fixed and its regression moved into a
deadline-bounded child. None of those failures is counted as qualification.

Production compound ownership, bounded input planning for unknown future
candidates, unused-plan scheduling/review, real-family quality and actually
authorized checkpoint workflows remain gated. These accounting primitives
do not grant filesystem/Git authority, live pricing or descendant containment.
