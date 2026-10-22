# Owned decisions and Autopilot Max

Status: protocol/database 40 service and SDK source integration. Client
presentation and final source/native acceptance are separate checkpoints.
Existing qualified archives are unchanged. This is not live Jev access,
calibrated decision quality or completed first-milestone acceptance.

Reuse maintained pi-ai, TypeBox, Node HTTP/IPC/abort/crypto and the existing
worker, model registry, authorizer, encrypted event store and all-role ledger
(MIT). There is no second agent framework, new dependency, model-owned
permission system or credential store. The current compatible adapter uses
an explicitly selected bounded generative transport to produce typed
System One-style advice; it is not Jev and never substitutes for Jev.

## Explicit provider and immutable request

`settings.decisions` defaults off with no selected model. The user explicitly
chooses `bounded-model`, an available concrete Local model, a positive output
bound, independent deadline, total calls per turn and separate confidence
and selected-probability thresholds. Network/hosted inputs need their own
`allowHosted` consent. A local provider label is not a loopback boundary, and
a loopback proxy is not proof that it never forwards data.

The optional `jev` setting remains visibly unqualified. Its documented
`POST /v1/systemone` request has no enforceable output-token-limit field.
The controller cannot invent `max_tokens`, lift finite policy, reserve zero
output or silently select a generative alternative. The dedicated generated
Jev wire/schema prerequisite remains in
[decision-primitives.md](decision-primitives.md); it is not a production
adapter. Remote/native Max is also blocked rather than executing its model
on the Local controller.

One decision binds the exact actual parent session/turn and solver step,
pending request ID/revision, arguments, declared alternatives, user
delegation, policy, selected model and complete input/output envelope.
Project-free scope stays null. A Local source additionally binds the actual
canonical directory/device/inode, not only its pathname or project ID.
Replacing a directory cannot adopt an older decision.

The independent report retains the original request, rubric, policy/model
snapshot and source binding, actual dispatched model input, raw result,
validated advice, known/unknown charges and applied/rejected observation.
Confidence is not permission, calibrated reliability or a user fact.

## One bounded owned worker

The existing worker runs once with Local, null root, read-only mode and no
tools. It cannot request a process, validation, another role, filesystem
access or private owned-role continuation. Its real reservation, started
entry and original request transition commit atomically before dispatch.
All decision and steering roles count against actual session/profile/global
caps and existing finishing holds. A smaller affordable output cannot
silently replace the original complete decision contract.

Complete named Choice, Noul and Score contracts validate exact keys, types,
option membership, numeric bounds and probability distributions. Choice
confidence and selected probability must independently meet their thresholds.
Scores bind the original zero-based legend and weighted mean; scores and
predicates remain advice, not automatic choice actions.

The complete original state is bounded to 64 KiB and output JSON to 16 KiB.
Oversize/invalid inputs are not truncated or repaired. No retry, alternate
provider or free usage is inferred. Invalid advice still retains valid
reported usage. Missing/stopped/deferred results retain their original full
unknown hold.

No advice applies until the exact worker has acknowledged its terminal
result and actually exited. The original source, model, policy, delegation
and human interaction are rechecked after preparation and before effects.
User cancellation synchronously signals the owned worker even if stop-intent
persistence fails. Provider-side completion or cancellation is not proved
by local abort/exit.

## Three separately delegated surfaces

**Tools.** With `reviewDelegatedTools`, Max may allow, decline or escalate
only an action already allowed by an exact actual-user tool/command rule.
Hard denial wins before a paid decision; an ordinary `ask` still needs the
human. Model cost consent is not tool authority. The final authorizer and
actual current root/folder/read-only checks remain authoritative. Applied
events retain `actor: decision-provider`, the actual rule and decision ID,
never `actor: user`.

**Technical choices.** An automatic answer needs an exact user-configured
`technical-choice` question and identical offered choices, with freeform
disabled. Unseen questions, open-ended responses and user-only facts stay
human. The answer contains the real decision-model/step/provenance and
`permissionGrant: false` / `userFact: false` when relayed to the solver.
Independent retained answers preserve the actual provider actor, not a fake
human or user-only Core instruction. Answering never consumes a human draft.

**Steering.** Optional steering starts off. Only a real safe solver boundary
after known earlier work can choose one exact bounded user-authored text,
continue without adding anything, or pause for human review. No pinned
model, Env, workspace, goal or permission is changed. The solver receives an
explicitly labelled untrusted provider steer, not fabricated human text;
public history records a notice, not a user message. Actual queued human
steering/mode changes win.

Changing/removing the configured decision provider pauses Max at its next
boundary, rather than silently becoming ordinary generative Autopilot.
Manual, Guided, Autopilot, fixed/kupo selection and factory controls remain
independent. Compound staging, project tests, source application and Git
still retain their separate actual-user review gates.

## Retention, recovery and migration

`decision.recorded` has an independent per-report retention key and raw blob
grants. Source deletion does not remove results or refund budget entries.
Generic artifact editing is metadata-only; active reports cannot be
archived/deleted. Version-9 artifact exports contain exact decision history,
raw evidence and retained accounting. Deletion keeps the original source
intent tombstone, not authority for another paid call.

The additive `owned_decision_schema` marker preserves schema-39 wind-down,
older compound state, ciphertext, receipts and model settings. No state reset
is required. Recovery rejects unapplied ready advice or records interrupted
work as partial without inference or effects. Known cleanup and metering
remain known; unknown completion remains held. A lost receipt/report cannot
authorize replay.

## Generated qualification checkpoint

The actual worker/service/SDK source checks cover successful bounded tool
review, exact technical choice, safe steering, separate actor/cost,
independent report export, source deletion/store reopen, hard denials,
human-only requests, malformed/foreign/incomplete output, unreported usage,
confidence versus probability, human override, revoked delegation/provider,
replaced directory identity and actual controller SIGKILL during inference
and after a clean result before effects.

The focused source set passes **23 checks in 8.32 s**; contract/policy
prerequisites pass separately. Schema-39 wind-down rollback/reopen and
schema-38 compound migration remain covered. Hidden desktop, actual TUI,
packed external SDK, full source and fresh native acceptance are not
established by this intermediate checkpoint. Generated thresholds/fixtures
prove mechanics and boundaries, not live reliability, independent training,
model quality or provider billing.

The refreshed `node scripts/decision-spike.mjs` prerequisite passes all
**8 generated wire/failure checks in 395.66 ms**: the actual loopback
request takes **17.11 ms** and its intentional deadline/transport-stop probe
takes **86.44 ms**. These are not live/provider-side timing measurements.
