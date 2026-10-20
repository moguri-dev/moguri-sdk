# Budget and telemetry contract

Phase 4 reuses maintained pi-ai (MIT), Node primitives (MIT), TypeBox (MIT) and
the existing append-only SQLite authority. No new dependency or second ledger
database is needed.

Protocol 21 additionally provides a separate sanitized tool/MCP outcome
projection and current-profile retained ciphertext measurements. These do not
alter model charges, caps, permission authority or provider invoices. See
[tool outcomes and retained storage](operation-telemetry.md) for their precise
denominators, privacy/coverage boundaries and byte exclusions.

## Measured metering prerequisite

Two generated real-worker/maintained-adapter probes pass in **711.29 ms**.
A 30-input/12-output OpenAI-compatible report with 10 cached input tokens
normalizes to **20 uncached + 10 cached + 12 output = 42 total**, not 52.
The explicit 128-output limit reaches the actual provider request.
Omitted provider metering stays null/unknown; adapter default cost zero is not
a reported price, free Copilot entitlement or billed amount. No personal
credentials, paid endpoint or microphone is used.

### Observed streaming prerequisite

The additional generated stream/category gate passes five checks in
**752.75 ms**. The maintained adapter's real loopback SSE exchange completes
in **133.40 ms**, exposes three normalized output chunks at 25-ms fixture
spacing and observes at least 40 ms between first and last delivery. The
same 20 uncached + 10 cached + 12 output report remains 42 total tokens.
Absent cache detail is distinguishable from an explicitly reported zero.

Timing uses the execution host's monotonic clock around normalized exposed
output events, not provider timestamps, UI batching or hidden reasoning.
A single/no output event has no measurable streaming interval. An observed
delivery rate is not provider GPU generation throughput, a model benchmark or
proof of productivity. At that internal-prerequisite checkpoint it was not
durable usage or a complete dated/priced dashboard. The shipped 0.11 archives
remain unchanged.

## Protocol-18 telemetry and dated views

Protocol 19 additionally meters the actual `compaction` role through this same
ledger. Reviewed context estimates/history are exposed by `sdk.compactions`;
applying/restoring a summary never resets admission or substitutes its
context-only synthetic normalization for the real compactor report.

The owned worker now retains observed first-output delay, first-to-last
normalized output delivery interval, event count and cache-report presence.
Observations come from the execution host, not controller/UI delivery times.
Actual cache categories are nullable: omitted metadata is not reported zero.
Input including cache derives from reported total minus output; cache subsets
are not added to the total again. Independently valid token charges survive
inconsistent timing, which becomes explicitly unknown with a diagnostic.

The independent ledger retains category/timing metadata, captured dated price,
actual turn and owning turn alongside existing role/model/owner and charges.
Model-created child execution IDs stay distinct, while an owning-turn view can
include their actual charges. Decision/steering/unknown roles, unreported output
and single-event streams cannot produce a generative delivery rate. Aggregated
rates use paired reported output/observed intervals only and disclose coverage.
They remain observed delivery estimates, not active GPU time or productivity.

`budgets.dashboard` supports the last 7/30/60/90/365 UTC calendar days, selectable
year, inclusive custom dates and all time. Day, Monday-based week, month and
whole-range buckets use the same scoped complete ledger before role pagination.
Only periods with calls are listed; edge buckets can be partial. More than
3,660 calendar buckets is an explicit error, not truncation or fallback.
Captured-rate history uses the admission-time user estimate, never today's
replacement rate, an inferred Copilot price or a bill.

`budgets.calls` returns bounded current-accounting pages with deterministic
time/ID ordering and per-call provenance. New calls/late reports can reorder
pages; totals are not computed by adding those pages. Project/folder/session/
owning-turn/provider/model/role/env/date filters never alter cumulative cap
admission. Other profiles' payloads remain outside this view.

Imported source timestamps are not automatically request times. A matching
recorded model-start event can establish that provenance; otherwise date
filters exclude the uncertain call with an explicit count and All time
includes it. A dated total therefore covers verified-time calls only, not an
asserted zero for excluded history.

Migration 18 preserves old event ciphertexts, receipts and retention grants.
Startup appends only provable ledger metadata; it neither rewrites old rows
nor changes/refunds charges, fabricates missing timings or reprices calls.
Source deletion/restart preserves the independent records. An injected marker
failure leaves schema-17 state unchanged and reopenable. Legacy protocol-16/17
SSH receipts remain inspectable without attachment or continuation.

Desktop exposes UTC range/bucket controls, token details, observed streaming,
periods, captured prices and per-call/owning-turn views. The SDK and shared
CLI/TUI `/dashboard` / `/dashboard calls` paths expose the same data.
Compaction history, repository/org/visibility metadata and routed wind-down
still require their separate qualified implementations; this is not a claim
that every Phase-4 or first-release metric is complete.

The corrected protocol-18 source passes **341 complete local checks in
261.37 s**, all **24** hidden desktop flows in **48.6 s**, and all 24 from the
actual packaged **0.12.0-alpha.1** app in **49.1 s**. A first packaged failure
exposed request ownership ending at model-popover unmount; the corrected parent
gate preserves drafts and errors through real settlement. Failed evidence is
retained rather than counted as a pass. The exact delivered external SDK
installs/audits/exercises actual CLI dated/call queries and the shipped SSH
worker. Source/consumer audits are zero. Setup records immutable artifacts.

## Accounting authority

Factory session preference remains Unlimited. A finite preference does not
override stricter profile/global policy. Calls must reserve atomically immediately
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
and profile/global availability together; another concurrent leg cannot reuse a
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
profile/global hard policies, profile-owned reservations/settlements and
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

## Qualification

The complete local gate passes **208** checks in **148,048.03 ms**. All **17**
hidden Electron flows pass in **37.5 s**, including real composer limits,
profile-policy persistence through factory reset and actual dashboard values.
The packed external consumer's generated model exchange and fresh audited
installation pass; source and consumer audits both report zero findings.

Coverage includes exact token/micro-dollar thresholds, actual concurrent
project-free admission, model-child ownership after source deletion,
unknown/lost completion, stale/zero price distinctions, cached input without
double-counting, forwarded output-limit violations, old-state import, real
control-plane SIGKILL and authenticated late SSH settlement.

Injected SQLite settlement failure proves primary completion and its ledger
update roll back together while the unknown reservation stays held. It also
exposed a worker waiting indefinitely for the failed acknowledgement:
termination now revokes that worker's authority and releases pending exchanges,
including before bootstrap, without inventing an accepted result. The bounded
regression confirms the owned process handle exits. This does not prove
detached/reparented descendant containment.

The resulting protocol-13 **0.7.0-alpha.1** development app also passes all 17
hidden workflows from its actual ad-hoc-signed macOS arm64 package (37.8 s),
including the budget/actual-dashboard flow. The delivered SDK archive, not a
freshly repacked proxy, passes the generated-model admission and profile-cap
test. DMG integrity and exact hashes are recorded in [setup](../setup.md).
These are development artifacts, not notarization, real billing or native R5
qualification.
