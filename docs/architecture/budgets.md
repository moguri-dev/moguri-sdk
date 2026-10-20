# Budget and telemetry contract

Phase 4 reuses maintained pi-ai (MIT), Node primitives (MIT), TypeBox (MIT) and
the existing append-only SQLite authority. No new dependency or second ledger
database is needed.

## Measured metering prerequisite

Two generated real-worker/maintained-adapter probes pass in **711.29 ms**.
A 30-input/12-output OpenAI-compatible report with 10 cached input tokens
normalizes to **20 uncached + 10 cached + 12 output = 42 total**, not 52.
The explicit 128-output limit reaches the actual provider request.
Omitted provider metering stays null/unknown; adapter default cost zero is not
a reported price, free Copilot entitlement or billed amount. No personal
credentials, paid endpoint or microphone is used.

## Accounting authority

Factory session preference remains Unlimited. A finite preference does not
override stricter profile policy. Calls must reserve atomically immediately
before dispatch, including solver, side, subagent, routing, critic, revision,
decision and retry roles. Model-created children charge their owning session;
different roles or envs never reset a cumulative ledger.

Retain profile-scoped accounting independently of session/project payload
retention. Migration 13 preserves old IDs, receipts and grants. Imported
historical metering is labeled; missing totals, prices or attribution are not
zero. Deleted-source summaries are deduplicated by actual step identity.

The current adapters expose context estimates, not a qualified exact tokenizer.
Finite controls therefore require an explicit **estimate-based** policy and
the warning: **Budgets can interrupt a session mid-task. Usage reporting can
lag, and a clean final commit is not guaranteed.** Do not label estimated
admission as an exact provider-billing guarantee. No silently inferred prices:
USD admission requires explicit dated, fresh model-specific input/output
rates. Cache categories use the declared conservative input rate, not an
invented discount. Estimated, provider-reported and billed amounts remain
separate fields.

Reserve input estimate plus an actual forwarded output limit. Check session
and profile availability together; another concurrent leg cannot reuse a
reservation. Reconcile reported total once, without adding cached/category
breakdowns again. Missing/lost completion keeps the entire reservation held
and visible; late authenticated telemetry may refine it, never retroactively
complete a partial turn. An in-flight provider overage is retained explicitly
and blocks further chargeable calls; it is not hidden by raising the cap.

Stop/restart must preserve unknown reservations rather than refunding work
whose provider outcome is unconfirmed. Resume, model/env/default changes and
source deletion do not reset accounting. Refuse finite units when historical
unknowns cannot be bounded. Dashboard totals disclose incomplete telemetry,
actual role/provider/model attribution and distinct estimate/report/bill fields.

## Exhaustion and checkpoints

Block before another chargeable request when the applicable limit cannot
reserve even one output token. Preserve accepted work, pending diff, source
events and a durable diagnostic checkpoint. Never run another model merely to
approve finishing. A Manual/Guided Git commit still requires real confirmation;
denied, unavailable or failed checkpoint commits are not successes.

The future kupo scheduler must reserve wind-down capacity before dispatching
normal legs and use the same role-aware admission for final validation and
revision. This contract does not claim kupo or delegated decision providers
implemented. Native Sandbox and Remote side-panel qualification are independent.

## Current executable scope

Explicit estimate-based session token/USD limits, separate revisioned
Default-profile hard policy, profile-owned reservations/settlements and
source-retention-safe status/dashboard APIs are wired across clients. The
actual maintained worker receives reduced output limits. A provider exceeding
that bound is partial and cannot qualify finite retries silently.

The packed external SDK executes a real generated provider/worker exchange
with a 16-token forwarded bound, settles 42 reported tokens, then applies a
profile cap and proves the next request is blocked with a retained diagnostic
checkpoint. This is synthetic qualification, not real Copilot billing.
No extra model or Git commit is performed by the fixed-model stop path.
Routed wind-down/accepted-work commit and repository/visibility filters remain
open alongside their scheduler/transport dependencies.
