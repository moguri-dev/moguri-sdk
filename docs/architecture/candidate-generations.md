# Owned reviewed proposal generation

**Current retention, protocol 57:** [session-owned cleanup](candidate-cleanup.md)
replaces this checkpoint's source-independent proposal lifecycle. Permanent
origin-session deletion or fresh verification of its exact associated PR merge
deletes proposal records, inputs and raw output grants. Archiving alone
preserves them. Required usage/unknown capacity and ordinary artifacts remain
independent; the historical qualification below is unchanged.

Status: qualified **0.23.0-alpha.1, protocol/database 31**. This is one
bounded, tool-less production `draft` role in the existing owned worker. It
generates an unaccepted text patch from explicitly reviewed Local source
snapshots. It does not enable Cascade, independent critique/revision, finite
kupo wind-down, automatic Git authority, real-model quality claims, Remote
generation or Sandbox. The immutable qualified 0.22 delivery is unchanged.

Reuse Node, maintained pi-ai, TypeBox, React, Electron and OpenTUI (MIT), the
existing SQLite/AES-GCM artifact and budget compartments, and the
[reviewed candidate](candidate-workflows.md) guards. System Git remains the
existing GPL-2.0-only executable. No dependency, provider credential backend,
second model loop or model-owned filesystem authority is added.

## Review and dispatch

An explicitly Local writable project agent session must select an available
fixed model with a known canonical provider/API identity and output capacity.
An unset model or `kupo` fails before Local root resolution. New generation is
blocked by disallowed Local policy, pending read-only mode, active work,
unheld queued prompts, conflicting root owners or unconfirmed operations.

Input is `{task, files: [{path, baseDigest}]}`. Capture is limited to 20 distinct
portable paths, 64 KiB of complete selected-file JSON and 128 KiB of the
complete retained input document. Original text is captured, not the client's
unsaved proposal. A new leaf file uses `baseDigest: "absent", text: null`;
an existing empty file remains `text: ""`. Existing allowed parent directories,
protected-path, symlink, folder-policy and exact digest rules still apply.

The independently retained version-1 input binds both canonical Local
directory/Git roots, their shared exact HEAD, separate clean managed staging
worktree, current authority, task, original text, selected model/options,
effective base system prompt plus the strict generation contract, and labeled
input/output bounds. Preview uses the working context and 4096-token
headroom. Maximum generated output is the smallest of the actual provider
bound, 8192 tokens and remaining context; current finite budget admission can
reduce it further. No history is truncated.

The review digest is SHA-256 over
`"moguri-candidate-generation-v1\0" + compactInputDocumentJson`. Blob IDs remain
ordinary SHA-256 of exact text. Approval is explicit model cost and independent
input/result retention consent, not a write, acceptance or quality decision.

`turn.control_started` with purpose `candidate.generate` owns the existing
Node worker without a synthetic user prompt. The worker receives no root and
zero tools. Current source/model/policy and prepared model capacity are
rechecked around asynchronous preparation and repository attribution. Exactly
one actual `draft` budget reservation and `model.started` commit atomically
before inference. There is no retry, extra solver or fallback.

Generation holds no filesystem writer lease while thinking because it has no
filesystem tools. Original roots, clean staging checkout and source bytes are
checked again after output; a concurrent change rejects the proposal without
discarding observed output or charges. The normal later stage/apply workflow
still claims both writer roots before effects.

## Result and authorship

The model must return exact tool-less JSON:
`{kind:"patch", summary, edits:[{path, baseDigest, text}]}`. Fences, extra
fields/paths, changed bases, incomplete/tool output, missing metering or an
exceeded forwarded output limit cannot become a proposed result. Raw JSON
output is limited to 32 KiB and its wrapped candidate document to 64 KiB;
nothing is silently repaired, stripped or truncated.

The version-1 `CandidateGenerationRecord` shares its report-artifact ID and
retention key. It keeps immutable original command ID/digest, input/model/root/
authority bindings, actual observed model step/provider/API, raw result and
proposal digests. Observations cannot be replaced; stop is monotonic and
terminal `proposed`, `stopped`, `failed` or `partial` state cannot replay.
Failed/partial/stopped outcomes require a diagnostic.

Normalized raw model output, actual usage settlement, generation result and
the actual-model artifact revision commit through the same derivation
transaction. Input revision sources distinguish the user's task from unknown
captured file authorship. A valid proposal adds the exact real model event,
step, model and result digest. Generation notices/deltas and raw results never
become ordinary solver context, user answers, approvals or code-quality proof.
Reported, estimated, unknown and billed accounting remain distinct.

`candidate.stage` may name `generationId`. The backend verifies its retained
proposed record, current immutable proposal document, exact roots, ordered
summary/path/base/text values and actual model provenance. It copies canonical
sources and records the immutable origin on the staged candidate. No
client-supplied actor assertion suffices. Editing generated bytes/summary in
desktop clears that origin and becomes an explicitly unverified import.

Generation itself writes neither checkout. Loading a proposal only populates
a local editor. Staging requires its separate exact review; source application
requires another fresh review and real `user` acceptance. None commits,
pushes, creates/deletes a branch, executes a validator or approves a model.

## Retention, cancellation and restart

The complete input, normalized raw result, proposal, report revisions and
generation events use the proposal artifact grant. Protocol 57 also binds the
generation's canonical model-completion payload to that compartment, removing
the otherwise redundant session-only raw-output grant. Permanent source
deletion removes these candidate-owned grants while preserving the ledger.
Verified-merge cleanup retains only the exact usage metadata in the surviving
session, not proposal text or another settlement/refund.
Project removal still requires explicit clean-worktree removal and reviewed
artifact retain/export/delete choices. Metadata edits are allowed; bound
report text is immutable. Active reports cannot be archived or deleted.

New exports containing canonical candidate/generation ownership use
`moguri-artifacts` **version 10**, including exact ownership/first-PR events.
Earlier checkpoint formats, including generation version 3, remain readable
as historical exports; ordinary documents keep their existing format. The same exact 8-MiB
export bound applies. No report bytes enter model context automatically.

Original commands are checked against retained intent before root/model
lookup. Lost receipts return the original identity, not another paid call.
Explicit report deletion leaves only its profile-owned original-intent
tombstone; that command returns `candidate_generation_deleted` even after
source deletion rather than resurrecting the report or spending again.
Other independently granted ordinary artifact copies remain independent.

Explicit generation/session stopping reaches the actual owned worker even
if either stop-intent journal append fails. A failed append is not described
as a retained stop request. Unknown model work keeps its full budget hold;
known actual charges survive stale/invalid output. Cancelling a waiter or
disconnecting a client stops observation only, not the owned model operation.

Restart marks interrupted records partial without source lookup, model
redispatch or staging. Pre-admission interruption creates no phantom call.
Interrupted admitted work retains unknown capacity; an already retained
proposal and settled usage remain retained. No-tool generation can explicitly
record `workspaceEffects: none` without quarantining unchanged roots. This is
not proof of hostile detached-descendant containment.

## Shared clients and schema

SDK `candidates.generatePreview`, `generate(..., true)`, `generation`,
`waitGeneration` and `stopGeneration` expose the same service record.
The waiter observes canonical snapshot status and reads the large report on
settlement, fails explicitly on deleted/missing state or disconnection and
never retries inference. `stage(..., generationId?)` preserves verified origin.

CLI uses `candidate generate-preview|generate INPUT.json --session SOURCE
--workspace STAGE`, with exact `--digest` and `--confirm-cost` for generation.
`generated`, `generation-wait` and `generation-stop` inspect/wait/stop; CLI
SIGINT requests its exact owned stop, prints retained outcome and exits
unsuccessfully for anything other than `proposed`. Shared `/candidate`
commands use structured JSON and `confirm-cost`. Desktop exposes the same
source/model review, cost/retention acknowledgement, report/actual usage/stop
and separate load/stage/apply path. Native TUI uses shared commands and
metadata-only retained report editing.

Migration 31 adds the transactional `candidate_generation_schema` marker,
typed `candidate.generation_recorded`, `draft` role, generation control
purpose, optional candidate origin and deletion-intent tombstone. Existing
ciphertext, keys, receipts, planned holds and absent historical generation
fields remain unchanged. Failure leaves schema 30 exactly reopenable. Legacy
fixtures reject future generation/draft records instead of relabeling them.

## Qualification boundary

Generated loopback models exercise the actual worker, forwarded token bounds,
ledger, no-tool request, unchanged source/index/HEAD, immutable provenance,
explicit staging/application, concurrent admission, invalid/stale output,
finite/blocked/unknown/output-violation accounting and both stop-journal
failures. The actual controller SIGKILL gate covers before admission, in
flight, before result retention and retained proposal, with zero replay.
Schema-30 rollback compares raw ciphertext/key/receipt/derived rows.

Compiled CLI, shared commands, native TUI keystrokes and hidden Electron
positive/stale-scope flows are covered. Both bounded desktop/compact visual
rounds are complete. External SDK and actual bundled-runtime qualifiers use
the same generated public workflow and independently retained replay check;
their delivery results belong in [setup](https://github.com/mbianchidev/moguri/blob/main/docs/setup.md), not inferred from source
tests. No paid inference, personal account, microphone, model weights or VM
probe is part of this qualification.

The complete source gate passes **720/720 in 519.93 s**, both type checks/build
and zero audit findings. All **47 hidden source desktop flows** pass in
**1.7 min** and all **47 from the exact packaged app** in **1.8 min**.
The focused generation/migration/client gate passes **23/23 in 33.17 s**,
including actual four-phase controller SIGKILL in **5.25 s** and a measured
schema-30-to-31 marker after failure rollback in **0.82 ms**.

Both a fresh temporary SDK pack and the exact delivered archive independently
install with explicit script approval/rebuild, zero consumer vulnerabilities
and four strict external entrypoint types. Their installed worker/SDK/CLI
generate one actually metered draft, retain canonical model provenance and
version-3 history, separately stage/apply, then reopen missing-receipt intent
without another request or overwriting newer user work. The actual app's
bundled Node/service/worker/SDK/CLI independently passes that same path and
the prior Local/SSH contracts. Native identity/signature/assets/DMG integrity
and separately scoped Electron/runtime footprint are recorded in setup.

The first complete source attempt was **719/720** because an existing SSH
connectivity fixture's generated-directory cleanup returned `ENOTEMPTY`.
Its isolated seven-case suite and the complete 720-case rerun pass without a
production or policy change. That failed cleanup is retained as red evidence,
not counted as a passed source gate. Earlier invalid fixture assumptions and
the concurrent-admission red/green remain recorded separately.
