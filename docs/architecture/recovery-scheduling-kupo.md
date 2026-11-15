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

## Delivered protocol84 supported and blocked boundaries

This table and its exact qualification remain evidence for the original
`d6aeae4` delivery/installer, not the new worker. Protocol85's model-free native
scheduling preparation and selected-parent decision/finishing implementation
are recorded separately in [owned model transports](owned-model-transports.md).
Protocol86's [snapshot retry/checkpoint contract](native-retry-checkpoints.md)
records the later confirmed restaging boundary and accepted-work implementation.
Jev remains a distinct unavailable upstream wire.

| Boundary | Executable result at protocol84 delivery |
|---|---|
| Local recovery | Exact four rounds, oldest currently failed eligible prompt, successful metered reset, exhaustion and manual/timer single-flight. Unknown results, later authorization failures and lost controller attempts remain blocked/partial. |
| SSH recovery | Actual pinned worker/model/root continuation with original request bytes, all-role charges and no controller-model or Local-checkout fallback. |
| Native Kupo/scheduling | Actual then-pinned SendBox guest runs Balanced Single, one-time scheduled input and owned Stop in an already reviewed private workspace. Unprepared native scheduling keeps the explicit source-preparation gate. |
| Native recovery after rollback | **Blocked.** The failed guest's private workspace is no longer an admissible current root. The outer cycle retains the original failure/unknown charge but cannot self-acknowledge inspection or relaunch a substituted stage. Inspect/resume the original private workspace and submit a new reviewed prompt; automatic native root-transfer continuation is not qualified here. |
| Modes and compound responses | Actual Local mode/effort/max-context filtering and bounded repeated Cascade/Critique. Savings also dispatches and recovers through owned SSH. Generated source profiles prove mechanics, not frontier quality, training independence or live savings. |
| Automatic compaction | Explicit opt-in complete text compaction, same owned worker and ledger, original source/history paging and no replay after SIGKILL or unknown usage. Images remain intact and visibly gated when a complete context cannot fit. |
| Finite automatic routing | Complete Local response-role holds and reserved checkpoint. Remote/native wind-down is still unqualified; no controller Git or Local model fallback. |
| Decisions | Exact selected solver/Cascade source can use the explicitly configured Local bounded-model alternative and real decision-provider actor. Jev/System One output bounds and Remote/native decision transports remain unqualified; no generative substitute is labeled System One. |

The current no-cache Linux image also proves actual native PTY and distributed
SHA-512 cache operation with zero moderate-or-higher advisories. Physical
qualification uses the existing root-owned side-by-side SendBox
installation pinned at that time, its pinned public archive/attestation and exact worker payload.
It never installs an OS package, signs in, uses personal inference, mounts the
source checkout or removes shared container images.

The protocol84 distribution is identified by manifest digest
`80afecd16f996ce4cd19da0097a21285eaff62ef1a84e1cec4024b27d0c12a24`,
complete payload digest
`c9519f430bfe619c89fd983d78a034f80f4139b9203305187c3f95b461707095`
and immutable image
`docker.io/library/moguri-worker@sha256:4cb24320e8cf7260c7e182363f48a69ee9a621361bfa2e9cc61b465e03f3685f`.
Its worker and bridge digests are respectively
`73bed22aabd28826afc6bd5a9f1b3c70df6789dfbf664baa2d34eaa2011e2127`
and `8d261611408ab6227be3827ea941b626327396b99193c5d9aaf633da57aba051`.
Receipts live under `.native/qualification/`; they are generated private
evidence, not a notarized release, live billing/quality proof or authority to
reuse different bytes. Remaining native recovery/System One/wind-down gates
are not removed by these measurements.

The packed consumer separately installs/audits the actual archive and exercises
protocol84 browser/React/Node types, actual worker retry, unknown holds, timers,
source paging and restart. Its install can show existing deprecated
`whatwg-encoding`/`node-domexception` notices and the pending postinstall
allow-list notice before the harness reviews the exact archive script.
Renderer chunk-size and OpenTUI experimental FFI warnings remain visible,
not suppressed.

Final local qualification on 2026-10-31: build and type checks pass; the full
serial suite passes **2,093**, skips **17**, and fails **0**; hidden Electron
passes **308**, skips **3**, and fails **0**. The independently installed SDK
runtime/types/imports and its audit pass with **0 vulnerabilities**, as does the
current root audit. Skipped cases are not counted as native or Linux release
proof. Separately, actual qualification on the then-pinned SendBox release passes at
`.native/qualification/current-sendbox-LlAQEB/qualification.json`, and both new
physical prepared-workspace/Stop and blocked-rollback tests pass. Original
history/receipts are preserved; generated model usage proves accounting
mechanics, not real billed costs or routing quality.
