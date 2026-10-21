# Independently retained role observations

Status: **qualified 0.25.0-alpha.1 / protocol and database 32** foundation for owned
compound operations. This records exact ordered role intent/observations and
offers shared read-only inspection. It does not select a workflow/model pool,
start a model, establish family/quality, approve code or enable finite kupo.
The public model-generation operation remains the qualified fixed-model
one-call subset. Sandbox and live personal inference remain paused/off.

Reuse Node, TypeBox, maintained pi-ai, React/Electron/OpenTUI (MIT), the existing
append-only domain, per-artifact AES-GCM compartments, budget plans/entries and
actual acknowledged worker. No dependency, alternate model loop or workflow
database. The actual [worker protocol](owned-role-protocol.md) is reused by the
generated ledger/retention probe, not copied into a production prototype.

## Exact immutable intent

A version-1 `RoleSequenceRecord` shares its report-artifact identity and keeps
immutable profile, source/budget owner/turn, project/workspace/folder/env,
original command/digest, original input, authority and policy digests. Each
ordered role captures its distinct plan, selected/provider/API model and
complete input/output bounds. Definitions cannot change or borrow another
record's plan/step/command.

Calls progress from pending to started to recorded; skipped roles never acquire
a step, input/result digest or usage. Only one original role may be in flight,
and a later role needs the exact earlier recorded successful result and settled
known-output ledger entry. A retained raw result may precede accounting
derivation inside one atomic append, but cannot itself authorize continuation.
Unknown/invalid metering or output violation is not free usage or success.

Observed step/input/result/outcome fields become immutable once known.
Stop is monotonic. A terminal sequence cannot resume, replay, rewrite outcome
or turn model data into a user answer. A partial/stopped record may append a
late result only for an already admitted unconfirmed step; it remains partial/
stopped and cannot start another call. Protocol completion says only that
recorded roles completed, not that code passed tests or the user accepted it.

Every role must retain its exact original held/consumed/released plan and
matching actual entry, owner, scope, role, model and complete bounds. A consumed
plan must bind its original start before request access. Reported usage remains
in the independent profile ledger. Role records reference that accounting;
they do not create a second total or provider bill.

## Retention, context and recovery

Original input, per-role actual context/raw normalized result and role history
share the independent artifact grant, not the source session/project key.
Retain/export/delete choices remain explicit. Bound input is immutable in
generic artifact editors; metadata edits remain possible. Active sequences
cannot be archived/deleted or silently discarded by project removal.

Exports with roles use `moguri-artifacts` **version 4**, including exact role
events and their referenced blobs. Generation version 3, candidate-only version
2 and ordinary version 1 retain their formats. The exact 8-MiB limit applies
without truncation. Explicit deletion forgets only that independent grant and
leaves minimal original command/digest intent, never another paid request or
input resurrection. Other copies and budget charges remain independent.

`turn.control_started` purpose `role.sequence` creates no fake user message.
Its model deltas/results stay notices; reconstruction excludes every role in
that control turn from normal solver history, including critic/revision.
Inspection/export never inserts those data as instructions or approval.

Startup marks unsettled metadata partial/unconfirmed before reconciling its
owner. No model preparation, checkout lookup, stage/write or request replay.
The canonical owner-end event releases only unused plans and keeps admitted
unknown work held. A user stop with no active owned worker records a partial
stop, not a fabricated worker acknowledgement or proven process cleanup.
Root-less/no-tool intent can preserve `workspaceEffects: none` without claiming
arbitrary descendant containment.

## Shared inspection

SDK `roleSequences.list()` returns current-profile metadata;
`read(sequenceId, index?)` reads original input and optionally one actual
retained role input/result. No create/run/accept/refund client command is
introduced. Missing/deleted/foreign records, invalid role indices and altered
input identity fail explicitly. The original-intent lookup runs before any
future caller may resolve a root/model and blocks deleted command resurrection.

CLI `moguri roles SEQUENCE_ID [ROLE_INDEX]` works after source deletion.
Shared `/roles [SEQUENCE_ID [ROLE_INDEX]]` lists or inspects the same data.
Native TUI artifact editing is metadata-only. Desktop Artifacts exposes role
state/model/index and exact raw data, keeps input read-only, and observes
active archive/delete guards. Completion is never labeled a code approval.

## Versioned migration and gates

Schema 32 adds the transactional `role_sequence_schema` marker,
`role.sequence_recorded`, typed control purpose, independent blob references,
read-only query and deletion-intent tombstone. Existing version-1 event
envelopes and old ciphertext/keys/receipts/derived rows remain unchanged.
Schema-31 generation results remain byte-identical; no historical sequence is
invented. A failed marker leaves schema 31 exactly reopenable. Legacy fixtures
reject new role records rather than relabeling them as older data.

Generated qualification covers serial/immutable bindings, stop/late results,
known versus unreported actual entries, source retention/reopen, isolated
profiles, real failed marker rollback, active report guards and exact export/
deletion. Actual controller SIGKILL covers pending, admitted, retained result
and completed metadata, without checkout/model preparation or replay.

The existing actual worker probe additionally retains every real role input/
result into this compartment before acknowledgement. Three loopback roles
report 126 tokens; a failed completion insert keeps one unknown 99-token hold,
releases unused plans and dispatches no next model. Source-session deletion
and restart preserve its real raw results and version-4 export. Synthetic
model identities/family labels are not empirical family or quality evidence.

The complete source gate passes **760/760 in 543.54 s**, both type checks/build
and zero audit findings. All **49 hidden source desktop workflows** and **49
exact packaged-app workflows** pass in **1.8 min** each. Four actual controller
SIGKILL phases complete in **1.66 s** without model/root preparation. The raw
schema-31 rollback preserves existing generation data and measures the final
marker in **2.20 ms**. Native TUI inspection and both bounded desktop/compact
visual rounds are complete.

The fresh and exact delivered SDK consumers independently approve/rebuild/
audit with zero findings, type-check all four entrypoints and exercise actual
installed role inspection, source deletion/reopen, version-4 export and
deletion intent. The exact archive's actual worker passes **12/12 in 3.64 s**.
The actual app's bundled Node/runtime/SDK/CLI separately passes that retained
metadata contract without model preparation. [Setup](../setup.md#current-qualified-0250-alpha1-checkpoint)
records immutable native/SDK identities and honest Electron-only versus
combined footprint measurements. No earlier archive was repacked.

Production compound policy, complete unknown-future context bounds, eligible
family/privacy validation, candidate/critic/revision decisions, actual-policy
accepted-work wind-down and live quality remain separate admission gates.
