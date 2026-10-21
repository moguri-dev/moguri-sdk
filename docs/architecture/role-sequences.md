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

## Internal owned execution, 0.26 source

Source **0.26.0-alpha.1 / protocol and database 32** connects these records to
the actual `ControlPlane` and worker, rather than a fixture host or another
model loop. It is an internal
Node-authority operation, not a new public compound creator, family claim,
quality gate, acceptance action or finite-kupo setting.

Reuse the maintained MIT pi-ai/TypeBox and Node helpers, reviewed generation
source capture, exact Local roots, current profile/pool policy, complete
planned holds and the existing artifact/role exporter. Capture the whole
original source, relevant policy/control snapshot, every concrete model's
metadata/instruction, complete future context/output bounds and duration
before admission. Alternate models must already belong to the approved,
privacy-eligible pool. No model chooses an endpoint or receives tools/root.

Future contexts explicitly wrap earlier bounded text as untrusted JSON data.
Their complete admission envelope uses the maximum JSON escaping of every
earlier allowed result, not the initially empty context or a token-to-byte
guess. Recheck the actual prepared context, model, source, policy and held
capacity at every boundary. Commit complete plans and original intent
atomically; commit each exact actual start before access and raw result/
accounting before acknowledgement or continuation.

`moguri-owned-role-input` version 1 is an independently retained blob over the
existing protocol-32 records, plans and control events, not changed event
shapes or a new database/migration. The privileged Node controller's internal
`executeOwnedRoles` shares original-command concurrency, receipts, removal
guards and the ordinary commit/derivation path. It is not an outward SDK/HTTP/
MCP creator. Existing SDK/CLI/TUI/desktop readers observe real live records
without another client state machine. Original/deleted intent remains a
pre-root/pre-model guard. Recovery never resumes the sequence or replays work.
Deadline/stop, failed journals, unknown usage, over-limit output and changed
authority stop continuation and retain actual charges/raw data; no filesystem
effect or successful cleanup is fabricated.

The same browser-safe settled-role predicate gates projection, completion and
later context before model preparation. Raw `stop` output without valid known
accounting is not a continuation. Caller input/review/receipt identity is
captured before yielding; mutation cannot redirect the original operation.
No tools, write lease, staged candidate, acceptance or Git authority is added.

The coupled source gate passes **38/38 in 95.50 s**, including unchanged
generation behavior and actual four-phase controller SIGKILL in **9.18 s**.
The isolated SIGKILL gate takes **6.46 s**: pending dispatch, actual in-flight
inference, retained first result and completed sequence retain 0, 1, 1 and 3
original requests; every restarted request count is zero. Unknown work stays
held, known first/all output retains 42/126 tokens, and unused plans release.
Recovery mocks model preparation and checkout resolution to fail if invoked.
Both type checks/declaration build pass. Whole-source, external-consumer and
desktop compatibility are still pending; the qualified 0.25 SDK/native records
above remain the delivery baseline, not a claimed immutable 0.26 release.

Generated tests cover maximum JSON escaping, exact finite capacity versus one
token less, whole initial transaction rollback, failed actual start/result
inserts, concurrent/deduplicated ownership, source/model changes and unapproved
pool authority,
unknown/over-limit/incomplete/tool/empty results, deadline, stop and both failed
stop-intent journals, caller mutation, source deletion/reopen and minimal
deleted-intent refusal. None of the generated role labels attests independence
or live model quality.

Production compound policy, complete unknown-future context bounds, eligible
family/privacy validation, candidate/critic/revision decisions, actual-policy
accepted-work wind-down and live quality remain separate admission gates.
