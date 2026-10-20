# Reviewed context compaction

This non-sandbox Phase-4 slice preserves the original append-only conversation.
A compaction is a separately metered, tool-less model proposal, not a user
answer, permission, memory update or automatic history deletion. Generation,
review, application and restoration use the same authoritative SDK/service.
There is no automatic compaction or alternate agent framework.

## Reuse and measured prerequisite

Reuse maintained MIT-licensed `@earendil-works/pi-ai`, its per-message estimate,
TypeBox and React, plus the existing Node worker, SSH channel, encrypted store
and all-role budget ledger. No runtime dependency or tokenizer is added.

`node --import tsx --test tests/compaction-primitives.test.ts` first proved the
tests fail with the missing primitive. The first implementation passed four of
five cases but correctly rejected the proposed reduction: pi-ai's normal
context estimator anchored both histories to the same trailing reported usage.
A compaction comparison cannot reuse a report describing a different prefix.
The corrected comparison sums the maintained per-message estimate for both
complete histories. It does not edit actual usage or claim exact tokenization.

The corrected **six cases pass in 679.06 ms**, including the real owned worker's
single bounded tool-less call in **207.84 ms** and owned cancellation in
**207.67 ms**. The generated transport forwards the exact 512-token probe
limit, reports actual normalized usage, accepts no tools and starts no second
model request. Complete turn/tool pairs, interleaved/incomplete history,
unsupported images, rejected expansion and old-usage invalidation are covered.
Type checks pass. This is a mechanical prerequisite, not a production summary
quality benchmark, new API qualification or a completed first milestone.

The context-only replacement is explicitly model-produced. Its synthetic
normalization has no billable-usage anchor and a logical prefix timestamp newer
than the replaced/retained messages, so old solver or compactor input reports
cannot describe the new prefix. The actual model completion, original usage
and ledger charges stay separately retained, including unknown reports.

## Authority and persistence contract

Preview binds an idle session's exact effective conversation, complete prefix,
retained recent turns, active summary, chosen real model, execution boundary
and current controls/policy/settings. An explicit generation action may spend
budget but cannot apply the result. A synthetic kupo selection never silently
chooses the compactor. Text-only support fails explicitly on image history.

The owned worker receives a fixed inspectable read-only contract and a JSON
source packet, no tools. Actual preparation and dispatch recheck the captured
scope; Remote inference stays on the pinned SSH machine. Every call retains
its actual compaction role, model, admission reservation, usage and outcome.
An absent report stays unknown/held, not zero or a free failed call.

A valid result must be complete, tool-less, bounded and strictly smaller under
the same labeled conversation estimate. It remains a proposal until an actual
user applies its exact revision against unchanged source. Application changes
only the effective prefix; recent complete turns and original event/blob
history remain. Restoration uses original history without another model call,
replay, refund or provider substitution. A restored context may exceed the
working window; normal admission must still fail rather than truncate it.

Protocol/database 19 is intended to add a compaction model role, a typed
control-turn start, retained compaction revisions and explicit user context
changes. Its migration must preserve all previous ciphertexts, receipts,
grants and ledger entries, with failed-migration and restart recovery coverage.
Pending generation, cancellation, failure, partial/control-loss and stale
source cannot be relabeled as a successful/applied summary. No restart retry
or hidden use of a model's confidence is authorized.

## Required client and recovery coverage

The SDK is the capability API; CLI/native TUI and desktop expose preview,
generation, history/content review, apply, discard and restore. Desktop must
keep draft text independent of these operations, display errors and actual
pending lifecycle, and require review before the context changes.

Integration coverage must include real Local/SSH calls, role/cap settlement,
unknown usage, output bounds, concurrent source/policy changes, no tool effects,
stopped/partial results, idempotent commands, source deletion, migration and
restart. An externally packed consumer and both actual clients must exercise
the delivered surface. At this prerequisite checkpoint those APIs, migration
and client workflows are not yet implemented or qualified. Sandbox remains
paused; nothing here establishes descendant containment.
