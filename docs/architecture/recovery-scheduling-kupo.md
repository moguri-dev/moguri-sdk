# Model recovery, scheduled prompts and Kupo modes

## Change contract and baseline

This owner-requested slice starts at merged protocol 83,
`023fa0143cdf547c9a66e5cd442ace1500062ad7`. It reuses the service-owned
worker, queue, SDK, encrypted append-only store, approvals, execution
transports and all-role budget ledger. Node, React/OpenTUI, TypeBox and
maintained pi-ai retain their existing MIT notices; SQLite is public domain.
There is no second agent loop, provider adapter or client scheduler.

Protocol 84 reserves three distinct transactional markers:
`model_failure_recovery_schema`, `scheduled_prompts_schema` and
`kupo_modes_schema`. Migration must preserve the six combined80 markers,
protocol81 request/Git markers, protocol82 command/tool markers and
protocol83 content/script-review markers. Genuine predecessor ciphertext,
retention grants, command receipts and unknown charges are not rewritten.
Premature markers, missing markers and downgrade/relabel attempts are errors,
not instructions to delete state.

Before feature edits, all six generated Phase 0 executable groups pass on
macOS arm64: provider fixtures 1,098.58 ms with 31.63 ms cancellation; SQLite
65.07 ms with 0.055 ms append p95 and 0.490 ms rebuild; owned PTY cancellation
152.18 ms with zero observed survivors; OpenTUI 17.21 ms per update; hidden
Electron 189.87 ms cold start, 448.06 MiB and 8.09 ms scroll frames; and
2,000-file search/Git reads 0.908/6.050 ms. These measurements do not qualify
live inference, routing quality, System One, Linux/Rust, notarization or
changed native worker bytes.

The locked dependency restore initially reports six moderate advisories
through glob/minimatch, including the independent consumer's cache dependency.
An override in the development root alone is not a consumer fix.
The portable fix keeps cacache 21's API but builds its patched dependency closure
into the distributed runtime, instead of asking consumers to inherit overrides.
Cacache is ISC-licensed; glob 14.0.3 and minimatch 11.0.3 declare BlueOak-1.0.0.
The build retains the exact installed dependency licenses/notices. Source dev
uses the locked package; installed runtimes use the same built closure and
must pass cache/native archive and independent-consumer checks.
The exact native workload payload also includes both cache runtime files and
their third-party notices. Image/distribution/qualification hashes bind that
complete set; the no-cache Linux build exercises an actual generated SHA-512
cache round trip rather than assuming development dependencies exist in a guest.
Main CI run `41150738532` fails before either job starts because GitHub
reports failed payments or a spending limit. Its Ubuntu 26 migration and
macOS arm64 capacity notices remain visible. CI stays main-push-only.

## Confirmed recovery semantics

One cycle covers qualifying failed sessions in the current immutable profile,
not other profiles or Copilot app sessions. Relative to the cycle's retained
start, rounds occur at 30, 90, 120 and 180 seconds. The first two rounds target
all eligible failures; the last two target the earliest originally prompted
remaining failure. Stable original prompt order breaks ties.
The user confirmed this means the oldest currently failed prompt, not the
session's first-ever prompt.

Only a complete successful model response with recorded valid usage resets
the cycle. An accepted command, launched worker, first token, unknown usage,
tool proposal or successful unrelated session does not. Manual Retry uses the
same original request authority and does not reset the countdown unless that
response succeeds. Automatic/manual attempts of one failure are single-flight.
Exhaustion retains a failed state and red X without another automatic round.

Recovery resumes the exact failed model request, not the original prompt's
tools, hooks, Git, installs or publications. Its retained non-secret input,
actual model binding/API/endpoint, context, controls, root, boundary and prior receipts must
remain verifiable. New drafts, attachments and queued prompts are not consumed.
Every new actual call gets its own reservation and model-start receipt; original
unknown charges remain held. Current denials, budgets, revoked credentials,
Stop, archive/deletion, changed roots and unconfirmed effects win. Missing
continuation proof produces a visible blocked/partial result, never blind replay.
Profile-root authorization epochs retain original actual-user login/logout and
credential-change intent before effects. They contain no credential/account
payload and do not claim authentication succeeded. Changes invalidate previously
captured retry/scheduled scopes; an uncertain mutation is never replayed from a
missing command receipt. Ordinary provider discovery/refresh does not invalidate
an unchanged grant. A later authentication/validation failure cannot inherit
the original transient error's Retry affordance.
A completed-looking retry with unknown/invalid usage remains partial and cannot
reset the cycle, retain an eligible Retry action or authorize another paid call.

Restart preserves undispatched timing and ownership. An admitted attempt with
an unknown result is partial and is not resubmitted. Missed recovery rounds
cannot be fabricated as on-time calls or replayed as a burst.
An in-flight attempt is not an eligible failed session at another deadline.
Rounds retain their actual target sets; they never duplicate a running request.

## Scheduled prompts

Holding an ordinary prompt while idle first asks whether to send it now.
The profile-owned remembered choice is Ask, Send now or Schedule; it is not
a permission or an answer to a model question. Choosing Schedule opens
5/10/30/60-minute or custom local date/time controls. Existing active-turn
Queue, Steer, Interrupt and ordinary held slash commands keep their authority.

A scheduled record captures the exact profile/session, saved draft and
attachments, controls, canonical root/boundary, local timezone/UTC offset and
instant. It is not an ordinary user message or model context before actual
turn admission. Its ghost prompt and the Automations / Scheduled prompts group
read the same SDK state. Hover, keyboard focus and the automation row expose
the same Send now/cancel operations.

Timer and Send now atomically claim one original input into the existing queue.
The actual turn still rechecks the captured binding and current policy. A
concurrent draft edit is preserved; cancellation cannot erase admitted work.
Overdue prompts send once after restart, subject to those same checks.
Disconnect never moves the timer to a client. Nonexistent DST wall times are
rejected; the selected UTC offset/occurrence and timezone remain explicit.
The admitted instant and original wall-time/offset are immutable. A later
timezone database change cannot rewrite historical intent or prevent reopening.

## Kupo source and boundaries

The actual supplied source is
[HyDRA: Hybrid Dynamic Routing Architecture for Heterogeneous LLM Pools,
arXiv 2605.17106v1](https://arxiv.org/html/2605.17106v1), read on 2026-10-31.
Sections 3.1-3.3 separate four-dimensional requirement prediction from
benchmark-derived model profiles, price and deterministic eligibility.
Section 10.2 uses first-turn/post-compaction sticky routing. This is not a
specification of Cascade, Critique, permissions, a System One adapter or
Moguri's model quality.

Version 1 explicitly defers production scorecards and several evaluation
numbers. Its release URL/weights are still promised, not supplied. Its
limitations include judge bias, benchmark/profile mismatch, a 512-token
predictor cap and cost-inflation attacks. Moguri must not claim those missing
weights, calibrated scores, live savings or training independence. Its
fail-open provider fallback is incompatible with Moguri's exact-boundary
contract and is not adopted.

Balanced, Savings and Performance are synthetic-model modes, not user-selected
thinking effort. Each actual selected model needs a supported effort and its
genuine maximum qualified context. Savings excludes reviewed frontier entries
and xhigh/max; local preference does not erase tokens, configured rates or
unknown accounting. Performance needs supported xhigh/max for substantive
work and reviewed frontier evidence; unavailable combinations fail before
paid work, not by clamping or guessing from names.

Classifier/gate/critic output stays untrusted advice. Repeated workflows need
actual configured bounds and complete all-role admission. Router prose cannot
become solver instructions, a user answer, source acceptance or tool permission.
The user explicitly chose opt-in automatic compaction under a reviewed Kupo
policy. It must preserve original context/source grants, keep a bounded recent
tail and include complete bounded metered work. A summary is model-produced
context, never a user answer, source acceptance or permission. Missing System One qualification stays visibly
unavailable; no provider installation or invented Jev/Laya endpoint is implied.
Sandbox and SSH require actual dispatch, model calls, continuation and
cancellation at their selected boundary and fresh native-byte qualification.

## Required qualification

Generated tests must exercise the actual service/SDK and workers with
controllable clocks: exact four deadlines, original prompt ordering, success
reset, exhaustion, concurrency, manual retry, Stop, accounting, migration and
restart/no-replay. Scheduled tests cover draft/context preservation,
timer/Send-now races, cancellation, overdue restart and DST.

Hidden desktop and native TUI interactions must prove retry controls, idle
scheduling review, ghost prompts, the Automations group and real mode changes.
The packed external SDK must expose the same browser-safe/React/Node contracts.
Fixture routing observations are mechanical qualification, not live quality or
calibration evidence. Unsupported combinations must remain explicitly blocked.
