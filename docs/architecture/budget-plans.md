# Planned wind-down capacity

Status: **0.23 development / protocol and database 30**. This adds durable
planned holds and shared inspection, not public finite kupo, compound worker
orchestration or automatic Git approval. The immutable 0.22 delivery is unchanged.
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

Actual control-plane SIGKILL releases the unused plan while preserving one
unknown **9,965-token** model reservation and exactly one request, with no
source modification or retry. A full local compatibility run and external SDK
qualification are still pending. No new immutable 0.23 archive/app is qualified.

Production compound ownership, bounded input planning for unknown future
candidates, unused-plan scheduling/review, real-family quality and actually
authorized checkpoint workflows remain gated. These accounting primitives
do not grant filesystem/Git authority, live pricing or descendant containment.
