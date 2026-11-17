# Reviewed context compaction

This non-sandbox Phase-4 slice preserves the original append-only conversation.
A compaction is a separately metered, tool-less model proposal, not a user
answer, permission, memory update or automatic history deletion. Generation,
review, application and restoration use the same authoritative SDK/service.
There is no alternate agent framework. Since protocol 110, smart compaction
runs automatically by default; see [Smart compaction default](#smart-compaction-default).

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

The first complete source run passed 364 of 365 checks and exposed a related
finite-budget regression: stable source timestamps made a historical report
eligible as a low anchor for a different current request. A focused regression
measured 48 anchored versus 2,723 fresh estimated tokens. Shared request sizing
now uses at least the maintained fresh per-message estimate, including current
system/tools, and caps output against that same estimate plus normal headroom.
Actual reported tokens and prices are not rewritten. The failed full run stays
recorded as failed, not a qualification pass.

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

Protocol/database 19 adds a compaction model role, `turn.control_started`,
`compaction.saved` revisions and explicit user `context.changed` events.
Its migration preserves all previous ciphertexts, receipts,
grants and ledger entries, with failed-migration and restart recovery coverage.
Pending generation, cancellation, failure, partial/control-loss and stale
source cannot be relabeled as a successful/applied summary. No restart retry
or hidden use of a model's confidence is authorized.

## Shared clients and recovery coverage

The SDK is the capability API; CLI/native TUI and desktop expose preview,
generation, history/content review, apply, discard and restore. Desktop keeps
draft text independent of these operations, displays errors and actual
pending lifecycle, and requires review before the context changes. Closing the
review does not stop the service's call; reopen it to inspect or explicitly stop.
Stops bind the exact compaction/turn, never whichever solver happens to be
running when a late click arrives. Admission and application also bind the
current global cap without depending on another profile's changing usage.

The first external-consumer check observed `running` through a stale peer SDK
snapshot rather than awaiting the operation's authoritative lifecycle. Its
qualification now polls the typed compaction state, not a nullable cached turn
ID. This does not add retries, infer a successful result or release capacity.

Targeted integration coverage includes real Local/SSH calls, role/cap settlement,
unknown usage, output bounds, concurrent source/policy changes, no tool effects,
stopped/partial results, idempotent commands, source deletion, migration and
restart. The same actual pinned SSH compactor passes in **5,083.46 ms**, and
the actual native TUI preview/generate/read/apply/restore flow in **1,371.46 ms**.
Five focused hidden desktop flows pass in **10.3 s**, including required review,
draft preservation, compact layout, close/reopen/acknowledged stop and the
existing model-request lifecycle cases. Source/packaged full qualification and
exact external-consumer evidence are recorded separately in setup.
Sandbox remains paused; nothing here establishes descendant containment.

## Corrected source and artifact qualification

The complete corrected source passes **366 checks in 279.27 s** and all **26**
hidden source-desktop workflows in **52.6 s**. All 26 also pass against the
actual packaged **0.13.0-alpha.1** app in **52.8 s**. Native TUI's complete
compaction workflow passes in **1,105.20 ms** in that full run.

The package verifier independently exercises the actual bundled Node service
and worker: three generated source turns, one tool-less compactor call, real
42-token role settlement and explicit review/apply/restore. The exact delivered
SDK passes a fresh audited install, all four external type entrypoints,
installed CLI lifecycle, ownership rejection and shipped SSH reads. Source and
consumer audits are zero. Generated fixtures establish mechanical boundaries,
not summary quality. Setup retains immutable artifact hashes and earlier
failed evidence; no archive was rebuilt merely to add its qualification notes.

## Smart compaction default

Protocol and store schema 110 implement the [D31 revision](decisions.md):
automatic compaction is on unless the user turns it off. This section is the
contract; the sections above remain the evidence for the reviewed primitives
it reuses.

### Shelley evaluation

[Shelley](https://shelley.dev/) (read 2026-11-17) enables automatic compaction
by default and nudges the model near 200k tokens, where it reports the best cost
and quality tradeoff for current frontier models. It keeps an append-only log
and materializes compaction as special messages that the harness substitutes
when building context, with originals still queryable. Moguri adopts the default,
the ~200k ceiling and the append-only/substitution model, which it already had.
It does not adopt Shelley's in-place model tool that trims chosen tool outputs:
that would let the solver rewrite its own context mid-turn, outside the
separately metered, source-bound compaction role, and it would need a new
review and replay contract. Shelley's security model also assumes the user
supplies their own sandbox; Moguri's execution boundaries are unchanged.

### Policy

`settings.compaction` is optional. Absent means the factory default:

| Field | Default | Meaning |
| --- | --- | --- |
| `automatic` | `true` | Compact automatically. `false` keeps original context until admission would refuse a request. |
| `triggerFraction` | `0.75` | Fraction of the working window (0.5 to 0.9). |
| `triggerTokens` | `200000` | Absolute ceiling for the trigger, or `null` for the fraction alone. |
| `keepRecentTurns` | `2` | Complete recent turns that are never compacted (1 to 20). |
| `maxCallsPerTurn` | `1` | Automatic calls one owning turn may make (1 to 4). |
| `outputTokens` | `4096` | Summary output bound (256 to 4096), further limited by the model. |

The trigger is the smallest of `window x triggerFraction`, `window - 4096 - window/8`
(so compaction starts before the 4,096-token admission headroom would refuse
the request) and `triggerTokens`. Desktop Settings / Sessions / Context
compaction saves these choices on change. A saved setting records actor
`user-policy`; the factory default records `default-policy`, so a summary is
never presented as something the user configured.

### Fixed-model chats

Before an ordinary solver call in an agent or side chat, the service estimates
the complete request (system prompt, context, steers and tools). At or above the
trigger it runs one tool-less compaction with the chat's own model and working
window, using the lowest supported thinking effort when the chat set one. The
same owned worker, budget reservation (`compaction` role), source digest,
prefix selection and strict size check as Kupo apply. A valid, complete,
strictly smaller result is applied with `context.changed` actor
`compaction-policy` and a visible notice; the worker continues with the
replacement and normal admission still applies to the solver call.

Automatic compaction is skipped for Kupo routing turns (handled below), agent
harness models, synthetic models, subagents, metachats, yielded coordinators and
image history. It is also skipped when the chat has no older complete turns
beyond the kept tail, or when this owning turn used its call budget; normal
admission then decides, never truncation.

If a call fails, is stopped, has unknown usage or returns a summary that is not
smaller, original context stays active, unknown usage stays held and the turn
ends partial with the reason. A turn that ran no tool or process before the
failure records no workspace effects, so the next send continues without Resume.
After a failed attempt, or after the user restores original history, the next
automatic attempt waits until the conversation grows by a quarter of the window
beyond that attempt's size, so a model without usage reporting cannot charge for
the same summary every turn.

### Kupo

Kupo's explicit reviewed `autoCompaction` policy still wins and keeps actor
`user-policy`. Without one, automatic Kupo inherits `settings.compaction`
(actor `default-policy` or `user-policy` accordingly) using the route's
qualified working window and the same trigger formula. Explicit Kupo policies
keep their previous fraction-only trigger.

### `/compact`

`/compact` (or `/compact now MODEL_ID`, required for Kupo chats) is the
built-in shortcut on an idle chat: the SDK previews with the chat's model and
sends `compaction.generate` with `apply: "on-success"`. The typed command is the
user's cost confirmation. On settlement the service applies a complete, valid,
strictly smaller result with actor `user` in the same commit; otherwise the
proposal stays reviewable and original context remains active.
`/compact restore` restores the active compaction's original history without a
model call. The detailed `/compact state|preview|generate|apply|restore ...`
forms and the desktop Context review are unchanged.

### Persistence and recovery

Store schema 110 adds the `smart_compaction_schema` marker. Pre-110 lineages
cannot contain a saved `compaction` setting, a `default-policy` or
`session-model` automatic origin, an `applyOnSuccess` compaction or a
`compaction-policy` context change. Missing, premature and relabelled markers
fail closed with original state preserved. A crash during automatic compaction
leaves it partial with unknown usage held and no replay, as before.

### Qualification

`node --import tsx --test tests/smart-compaction.test.ts` covers the default
fixed-model application, opt-out, failure with unknown usage and the growth
backoff, `/compact` apply/restore and the four schema lineage cases. Existing
Kupo, compaction primitive/recovery and migration suites still pass. Desktop
e2e covers the Context compaction page and the inherited Kupo toggle.
Generated fixtures prove mechanics, not summary quality or live savings.
