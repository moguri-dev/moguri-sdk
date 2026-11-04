# Session reliability and compact controls

## Explicit selection and retained-request follow-up

The protocol-81 follow-up starts from merged combined80 (`9cc20bd`). It reuses
Node.js, React/OpenTUI, TypeBox and the SDK under their existing MIT/component
notices, SQLite under its public-domain terms, and the installed Git CLI under
GPL-2.0. No dependency, model call, credential lookup or new client queue is
needed. Main-only CI remains unchanged.

Before feature edits, the generated Phase 0 baseline passes provider fixtures
in 1,092.49 ms (31.08 ms cancellation), SQLite in 74.33 ms (0.063 ms append
p95, 0.60 ms rebuild), known-group PTY cancellation in 151.20 ms with zero
observed survivors, OpenTUI updates in 17.23 ms, hidden Electron startup in
213.92 ms (447.19 MiB, 8.05 ms scroll frames), and 2,000-file search/Git reads
in 0.94/6.49 ms. Missing packages were restored with the locked install, with
zero npm advisories. The baseline's unavailable live-account, Rust/Linux,
physical guest, quality and notarization gates are not newly qualified.

An explicit autonomy-selection command must retain actual user intent even
when reselecting a legacy saved value. Loading old controls or editing a model,
window, budget or draft must not upgrade bounded consent. New selections and
explicitly consented defaults must survive subsequent turns, competing clients
and restart; hard denials and execution/budget/root restrictions still win.

Public retained results must have discoverable original identities, not require
models to invent opaque step IDs. Reads bind the actual profile/session,
turn/step/call and operation revision, with digest-pinned UTF-8 continuation.
Hooks, private roles, another session and user-console input/output are excluded.
Deletion cannot be repaired by replaying the source operation.

Snapshot recovery must not leave a healthy event socket permanently
disconnected, apply an old connection's late snapshot, or indefinitely postpone
a command acknowledgement behind streaming refreshes. Capability deadlines are
service-owned; a shorter generic transport timer is not a capability failure.
An uncertain mutation is inspected by its exact original command identity,
never resent. A retained receipt is acknowledged as committed; pending and
unknown outcomes remain distinguishable and preserve local drafts.
An explicit service error stays an error, even if an earlier intake receipt
exists. Only a missing/malformed transport acknowledgement is recovered from
that receipt; a failed stop journal or rollback cannot become success.

The Electron custom-protocol proxy shares that read deadline and explicitly
forwards the read-only original-command receipt route. A transient initial
snapshot failure may authenticate the same exact profile over its event socket;
authentication and missing-profile failures cannot fall back to Default.
Draft autosave resumes only a save rejected as disconnected **before dispatch**,
against the freshly received original draft revision. A newer peer edit becomes
a visible conflict. Unknown dispatched saves, input submissions, paste captures,
tool/Git effects and approvals are never replayed by this recovery path.

Late verified SSH frames retain the original tool's raw-result grant as well
as its compact text, binding actual profile/session/turn/model-step/call.
Paging/reopen uses those bytes, not a live file reread. The original partial
turn and its accounting remain partial; reconciliation does not resume a model
or promote late output into successful completion.

Protocol 81 requires separate `session_request_recovery_schema` and
`builtin_git_schema` markers. Its atomic migration preserves all six combined80
lineage markers, ciphertext, original grants/receipts and unknown charges.
Generated interrupted migration/reopen, stale/disconnected/concurrent clients,
late acknowledgements, original result ownership and actual TUI/hidden desktop
flows are required, together with the independently installed SDK. Changed
worker bytes require their own qualification, not historical protocol80 receipts.

Managed Git rename retains its captured metadata revision and appends the tagged
`workspace.saved`, matching change-set branch and terminal Git/job records
atomically. A lost metadata acknowledgement remains partial until exact user
inspection and metadata-only reconciliation; no Git effect is replayed.
Managed checkout changes cannot move an existing captured change set. Read-only
Git previews also suppress index-stat refresh, preserving the original index.

### Follow-up qualification

The final runtime correction is `f0cc4bec5e676051b7dba3f2f9439ce77a7e7b67`;
subsequent commits change only generated fixtures and documentation. The complete
final serial run uses `26689184e86ef7ea4c8d2c25d5f6e52afcb0f6f4`.
Current compiled guest hashes still match the
[original protocol81 physical receipt](sendbox-0.2.4-qualification.md#protocol-81-session-and-git-follow-up).
Historical or deliberately stopped qualification attempts are not counted.

| Surface | Observed result |
| --- | --- |
| Complete serial Node suite, including actual native TUI | **1,975 passed, 15 explicit physical-native skips / 1,990 total**, zero failures, 25.95 min |
| Complete hidden source desktop | **284 passed, 3 explicit package/native skips**, zero failures, 8.5 min |
| Repeated draft/modal/peer-terminal acknowledgement flows | **55/55**, 1.2 min |
| Exact service-failure/stop-journal/rollback/reconnect and decision cases | **56/56** |
| Original predecessor consent and combined80/81 migration/reopen cases | **70/70**, 22,376.49 ms |
| Final generated recognizer marker/cancellation/capture and hidden controls | **20/20 Node**, **9/9 hidden desktop**; no production speech change |
| Independently installed packed SDK/types/browser/React/Node/CLI and actual workers | **PASS**, including new Git/receipt/result/managed-reopen cases and **12/12** owned-worker probes |
| Generated retention and real hidden Ghostty primitive | **PASS**, 500 events/250 retained artifacts in 178.36 ms; 108-by-24 acknowledgement in 24.80 ms |
| Generated owned SSH and isolated worktree primitives | **PASS**, 148.71/101.64 ms |
| Exact current physical SendBox qualification | **7/7 gates**, 23,075.63 ms, original owned guests absent |
| Strict types, production build, root and fresh external-consumer audits | **PASS**, zero reported vulnerabilities |

Legacy fixture creation retains actual predecessor controls rather than
relabeling a new explicit selection. The generated recognizer now writes its
complete PID marker before advertising readiness; an empty concurrent read
previously became PID zero and falsely tested the caller's process group.
The cleanup assertions still require the exact positive owned PID to be absent.
No microphone, personal account or paid inference was used.

Full logs remain in the session's `files/` as `verified-unit-81.log`,
`qualified-desktop-81.log`, `qualified-packed-sdk-81.log` and
`qualified-native-81.log`. The exact native receipt remains at its original
repository-local path above. Nonfatal packed-consumer deprecations
(`whatwg-encoding`, `node-domexception`) and its explicitly reviewed Moguri
postinstall notice remain visible. Main-only CI's account billing/spending
eligibility failure and runner notices are recorded with the native evidence;
no working-branch CI or personal authorization was triggered.

## Push-to-talk audio onset

The Ctrl+Space follow-up reuses the existing browser AudioContext/AudioWorklet
and local SDK/capture lease with Node/React/TypeBox under their existing MIT
notices; the installed NeMo-Speech runtime and model licenses are unchanged.
There is no dependency, protocol, event, migration or recognizer/vocabulary
change. No real microphone, personal account or model weights are used to
qualify it.

The generated red regressions reproduce two independent causes of clipped
opening speech: no microphone starts while an unrelated draft save is awaiting
its acknowledgement, and the complete first 250 ms of input is lost while the
audio worklet initializes after the device has already opened.

Only the actual recording gesture prepares a silent, input-free processing
context, in parallel with admission. No microphone opens before the original
service capture and fresh desktop permission check. The normalized graph is
ready before device acquisition, and the returned stream connects synchronously
before permission-release IPC or any other await. No initial PCM is truncated
or replayed. First-time OS authorization remains explicit; an already granted
permission does not repeat the OS prompt or a redundant post-prompt snapshot.

Dictation binds its original local selection without awaiting an ordinary
autosave. Existing autosave serialization and foreign-revision conflicts still
protect edits. A pending input submission or attachment capture is refused
rather than arming a delayed microphone. The SDK's ephemeral capture admission
returns its exact service acknowledgement without waiting for a full conversation
snapshot; job state continues through the shared event stream and `jobs.wait`.
CLI/TUI use that same SDK contract, not a second capture queue.

Release-before-admission, blur, sleep, profile/session change and failure abort
the exact prepared graph and owned capture. A late service lease or device
cannot open another microphone. Existing two-click/button, held shortcut,
streaming/flush limits, cleanup errors and draft preservation remain distinct.
The tests inspect real generated opening PCM and held-save timing, not a
constant fake recognizer's final sentence as a proxy for captured audio.

Before feature edits, all six generated Phase 0 executable groups pass:
providers **1,095.06 ms** (32.71 ms cancellation), SQLite **66.95 ms**
(0.0656 ms append p95), known-group PTY **159.98 ms** (152.30 ms cancellation,
zero observed survivors), OpenTUI **1,066.20 ms**, hidden Electron **591.79 ms**
(176.81 ms cold start, 442.88 MiB), and filesystem/Git **93.13 ms**.
The generic initial-checkpoint unavailable diagnostics are not newly qualified
live-provider, Rust/Linux, release, quality or personal-microphone gates.

### Onset qualification

Source `7a63f69913e9d1332f06146e91adb9663b66dd1e` passes **53 related Node
tests**, **31 actual hidden desktop cases** (52.7 s), and **12 repeated
cold-onset/held-save/failed-processor/release cases** (21.1 s), without skips or
failures in those selectors. Strict types, build and the fresh independently
installed packed SDK also pass, including its **12 actual installed-worker
probes**. Root and external-consumer audits report zero vulnerabilities.

The old build captures **zero** opening probe samples when worklet startup is
delayed by 650 ms. With this fix, three independent runs preserve **3,214 to
3,336** above-threshold opening samples in the first 4,096 normalized samples,
despite the same processor delay and a separately cold **1,000-ms** recognizer.
The generated tone exists for only its first 250 ms, so later silence cannot
pass this check. A deliberately unacknowledged draft save previously prevents
all microphone acquisition; the fixed focus/key-gesture-to-recording observations
are **228.07 to 241.10 ms** while that same save remains blocked. These are
generated-device observations, not a promise about OS prompts or personal
hardware.

Release before service admission opens **zero microphones** and closes the
exact silent preparation. An unavailable processor also opens no microphone,
closes its context, cancels the real original job and preserves draft text.
Pending input intake, concurrent drafts, actual controller SIGKILL, unchanged
stream/restart/no-replay behavior and both main/side composer interactions are
covered by the related suites. No real microphone, weights or live speech
accuracy was exercised; this repairs lost onset audio rather than rewriting
proper names or claiming new recognizer accuracy.

Logs are retained in the session's `files/` as `ptt-onset-red.log`,
`ptt-onset-repeated.log`, `ptt-onset-related-unit.log`,
`ptt-onset-related-desktop.log` and `ptt-onset-packed-sdk.log`.
The worker, remote bridge, MCP worker and data-worker hashes remain exactly the
protocol81 physical payload recorded above; no native receipt was relabelled.
There is no new packaged/notarized app or personal authorization claim.

## Change contract

This owner-requested follow-up covers Local tool and GitHub read failures,
hold-to-talk transcription, shared settings controls/search, session navigation,
named multi-repository folders, read-only side-chat parity and long retained
conversations. It extends the existing service and SDK, not another agent loop.

Reuse Node/SQLite/process primitives (MIT), TypeBox (MIT), React/OpenTUI (MIT),
the existing Markdown renderer (MIT), Moguri-owned icons, maintained pi-ai (MIT)
and the pinned local NeMo-Speech runtime with its separately accepted model
license. No model weights, personal microphone, authentication or user
application is exercised during qualification.

The owner explicitly selected folder sessions that may edit and run commands
in every member repository. Such a session must capture the exact member roots
at creation, never their common parent or an inferred checkout. Repository
selection for a filesystem/command tool is explicit. Writer ownership,
restrictions, cancellation and uncertain outcomes apply to every captured
root. Navigation grouping or session nesting alone grants no execution,
coordination or context authority. New multi-root execution is Local-only;
unqualified transports cannot fall back to Local.

Durable scope additions and tool-wide remembered approvals require a versioned
protocol/transactional migration. Genuine older state, encrypted grants,
original approvals and unknown budget holds must survive migration and restart.
SDK, CLI/TUI and desktop share commands and models. Presentation-only search,
folder collapse and reorder cues never become model permission.

Ctrl+Space owns one local capture until release. Partial recognized text belongs
to that exact composer/profile/session and must not overwrite concurrent edits,
duplicate a final buffer or submit a turn. Cancellation settles owned capture
and keeps already inserted text visible; audio remains private and temporary.
No cloud recognizer, implicit model download or personal recording is allowed.
The microphone button instead always toggles record/confirm on separate clicks;
it is not push-to-talk, regardless of an older saved button preference.

Autopilot tools still obey hard denials, read-only scopes and environment
policy. Actual user selection/defaults must propagate automatic approval
consistently. Remembered approvals distinguish a whole named tool, a specific
call, a safe command family and an exact command; MCP tools remain bound to
their actual server/schema. Models cannot mint these grants.

Remove the arbitrary text-byte ceiling on effective conversation history,
not the selected model's actual context window, image-resource bounds or
budget policy. Original history is never silently truncated. Existing reviewed
context compaction can extend a session without deleting its conversation.

Qualification must cover realistic large PR responses through the actual
bounded CLI reader, digest conflict/fresh reread without weakened write guards,
approval/default inheritance, streaming/stop/concurrent composer edits,
multi-root identity and writer contention, stale drags, atomic grouping,
restart/migration and hidden desktop keyboard/native drag interactions.

## Generated prerequisites

Before feature implementation, `npm run spike` repeated the generated
OAuth/stream/cancellation, SQLite replay, owned PTY, OpenTUI, hidden Electron and
filesystem primitives. All six pass: **1,084.07 ms**, **64.61 ms**, **159.30 ms**,
**1,042.07 ms**, **633.13 ms** and **89.62 ms**, respectively. OAuth
cancellation is **31.18 ms**; PTY cancellation is **151.24 ms** with no known
survivors. `npm run spike:sessions` retained 500 events and 250
independently owned artifacts in **132.12 ms**, and exercised real hidden
Ghostty/WASM with acknowledged 108-by-24 dimensions in **23.70 ms**.
The source log is retained separately from final qualification.

The pinned runtime's read-only `transcribe --help` confirms WAV streaming and
native live endpointing. Its `serve --help` and pinned
[server](https://github.com/NVIDIA/NeMo-Speech.cpp/blob/v0.2.0/docs/server.md)/
[API](https://github.com/NVIDIA/NeMo-Speech.cpp/blob/v0.2.0/docs/api.md)
contracts confirm authenticated loopback PCM16 WebSockets, delta/final
transcripts and an explicit buffer-commit acknowledgement. This does not
qualify a personal microphone/model.
The existing unavailable live-provider, model-quality, physical SendBox,
Linux-host and notarized-release gates remain unavailable.

## Reproduced failures

The protocol-90 follow-up reproduces service publication waiting for an
unrelated provider discovery promise. Recovery and authenticated service
readiness no longer wait for that promise: model status stays Connecting until
its actual result, and a new chat can be admitted without authorizing inference.
Pending read-only discovery is cancellable. A protected OAuth token refresh
that may already have rotated authorization still settles/persists before
shutdown; cancelling the caller does not discard the only valid credential.
The original shutdown/admission/ownership fences are unchanged.

A generated hidden Browser check also reproduces permanent host disconnection
after one failed status poll. Only bounded reads of the exact same connection,
profile and native lease can recover. Recovery explicitly revokes agent control,
retains seen request IDs and cannot replay an action or re-enable control.
A changed connection or failed revocation remains an explicit blocked owner.
Read-status errors clear after a genuine successful read; navigation/interaction
errors are not hidden by that read.

Payload-free response spans separate service handling, desktop proxy body/
upstream-header waiting and observed event-loop lag above the nominal 20-ms
sample spacing. Each loop maximum belongs to its reported current five-second
window, not necessarily that request. Elapsed spans are not CPU, lock, network
or model diagnosis. The user's earlier 16.1-second service phase and clustered
before-header waits remain distinct observed evidence; generated SQL and
provider/poll fixes alone do not prove the full live latency is gone.

A generated realistic PR collection above 512 KiB produces the user's exact
owned-CLI partial diagnostic through the actual process reader. REST reads now
have an explicit 8 MiB complete-response bound; mutation and process bounds
remain separate. No body/page prefix is substituted as a successful response.

Selecting Autopilot through generic `session.configure`, instead of the SDK
convenience method, omitted its automatic-approval flag and prompted for the
first real command. Explicit autonomy changes and new per-session selections
now retain that delegation consistently. Old stored bounded consent is not
rewritten by unrelated model/window changes.

A text conversation above 1 MiB now passes when it fits the actual selected
model window. The independent 16 MiB image-resource bound, fresh request
estimate, output headroom and finite budgets remain enforced. The context-window
error points to compaction inside the same session rather than discarding it.

Protocol/schema **65** adds a required transactional metadata marker for new
session scope and whole-named-tool approvals. An exact remembered call keeps
its argument digest; a separately selected whole tool may accept new arguments
only in its captured scope/environment. Exact commands, conservative command
families, schema-bound MCP targets and hard denials remain distinct.

## Streaming and side-chat checkpoint

The shared capture intake owns ordered PCM frames and a transient nonce, not a
durable audio command. A private authenticated native listener is reused only
while its exact owner is alive. Its Node host watches the controller pipe and
stops its known child on EOF; ordinary stop/cancel joins cleanup. Failed private
cleanup remains visible rather than authorizing another recognizer.

The composer updates only its captured provisional span. It adjusts that span
for surrounding typing, rejects overlapping/foreign edits and checks actual
capture ownership through final acknowledgement. Release flushes once even if
the terminal job event arrives before the HTTP reply. There is no Insert step
or automatic prompt submission for live desktop dictation. Legacy SDK batch
uploads and explicitly reviewed file/native transcripts remain separate.

### Two-click microphone and gesture-owned push-to-talk

The owner requires separate desktop controls: click the microphone to record,
click again to confirm; hold the configured voice shortcut (Control+Space by
default) and release to finish. Space/Enter activation of the focused native
button also toggles, not hold/release. Repeated Enter cannot repeatedly toggle
the microphone, and pointer release outside the control cannot commit a clip.

The old optional button PTT mode could finalize a click before an utterance was
captured, producing early-capture or genuine empty-recognition errors. A
generated hidden-browser regression reproduces that first-click failure with
the saved legacy flag enabled. The renderer no longer reads that flag or offers
its checkbox. Existing `voice.pushToTalk` values remain in the typed settings
and survive save/reopen, avoiding a destructive compatibility change.

Each held shortcut owns one transient gesture identity. Only its original
capture may be finished or cancelled by that release/effect cleanup. It cannot
take over an already running click recording, or stop a newer clip after the
user explicitly stopped/discarded the earlier one. Click-toggle reads the
controller's current state rather than a stale render. Early release still
prevents late microphone startup; profile/blur/sleep cancellation and the
original nonce/session authority remain intact.

The subsequent interaction repair separates an acquired physical recorder
from its asynchronous readiness acknowledgement. A release may flush the
already-owned PCM while the UI is still Starting; partial text can be read in
that interval, and completion cannot later republish Recording or cancel a
successfully finalized owner. Release before actual acquisition keeps the
no-late-microphone rule. Permission-release cleanup is shared/idempotent and
retains the exact permission ID on failure for retry.

Per the actual user choice, dictation now defaults enabled but microphone
standby defaults off; explicit off settings remain off. Missing configured
runtime/model readiness does not create automatic failed preparation jobs.
No permission, model download or recording is inferred from that default.
Consented standby uses an icon/accessible description, not repetitive chat
status paragraphs. Streaming PCM never becomes a durable WAV/message context;
owned buffers and any batch spool keep their existing zeroing/deletion rules.
Batch spool cleanup now rechecks the original inode/device, private mode,
size and modification witness before unlinking. A missing/replaced/changed
WAV is retained as explicit partial cleanup, never another writer's file
deleted under a success-shaped result. Generated success/failure/replacement
checks prove memory zeroing and exact owned-file removal without a microphone.

The pinned native server's PCM16 and final-before-commit contract was checked
against the existing 0.2.0 source. The transport, native runtime/model, SDK API,
durable events/settings shape and protocol 76 are unchanged. No cloud/backend
fallback, weights download or fabricated replacement for an empty transcript
is introduced. Genuine empty results still report their error while preserving
the draft. This repair changes renderer activation/ownership, not ASR accuracy.

Generated qualification includes a real 48-kHz oscillator entering the browser
capture graph, normalized nonzero PCM16 with at least 16,000 samples delivered
before the second click, one final commit, preserved draft text and zero model
turns. It also covers stale release/cancellation, focused-button keys, exact
device selection, custom shortcut save, delayed admission, cold listener
readiness, partial text and final acknowledgement. No personal microphone or
real speech weights are used.

#### Two-click repair qualification

Source `c3cb044411973990fd47976ebd1f21fe33725108` passes the generated checks below.
The red regressions first reproduced a click ending under the old held-button
preference and a stale shortcut ending/cancelling a newer recording. The native
PCM16/final-before-commit implementation was verified at pinned source
`47f43763bb40ec463150dd8d9a788c54f3728bdb`; no speculative recognizer-format
change or suppression of `speech_empty` was used.

Before the repair, `npm run spike` repeated its six executable foundation
primitives: providers **1,119.47 ms** (31.25 ms cancellation), SQLite
**69.64 ms** (append p95 0.0552 ms), known-group PTY **159.96 ms**
(151.95 ms cancellation, zero observed children), OpenTUI **1,029.46 ms**,
hidden Electron **754.93 ms** (252.29 ms startup, 445.92 MiB), and bounded
filesystem/Git **88.16 ms**. Its generic initial-checkpoint unavailable
diagnostics remain distinct from current feature/native evidence.

| Surface | Result |
| --- | --- |
| Speech/capture/PCM/draft/host/restart and legacy-preference regressions | 71 passed, zero failures/skips; 10,959.21 ms |
| Source hidden dictation/settings/side-composer flows | 14/14 passed, 28.7 s |
| Actual rebuilt packaged dictation/settings plus native setup/publication | 19/19 passed, 1.1 min |
| Packed external SDK install/types/entrypoints and installed workers | Pass, including generated speech probes and 12 owned-worker cases |
| Exact packaged Node/service native distribution check | Pass, 1,095.04 ms |
| Final production ZIP staging and read-only DMG identity/layout | Pass; 779,906,467-byte ZIP staged in 118,715.47 ms |
| Strict types, production build and source/independent-consumer npm audits | Pass, zero npm vulnerabilities |

The test includes at least one second of actual nonzero, browser-normalized PCM
before the second click. Ctrl+Space during click recording and an older held
gesture's later release cannot commit that clip. Normal button Space/Enter,
custom and unassigned shortcuts, interrupted capture and genuinely empty
recognition are exercised without a chat/model turn.

The qualified protocol-76 native payload remains byte-identical: worker
`946c9778d9cd37cb9b684be72aaa09648bd3cc255a334895606f8c43c9195a81`,
bridge
`c21994ac933b9a071d02f426aae3f57c693a645fa8f1490273f7aa891c85a54c`,
image
`docker.io/library/moguri-worker@sha256:9e8092cca9654fb198b01e1378de7e7f238703d5645bde713a380f098fb68b2d`.
No new guest qualification is inferred from generated speech, and no existing
healthy service needs a new API or schema for this renderer repair.

The labelled **794,198,526-byte** development installer is
`release/Moguri-0.30.0-alpha.1-dictation-controls-macos-arm64.dmg`,
SHA-256
`e0da754db00a1ce4638dc50151ec6689550b75f7f0b844e9db5d4d2d1ab8b51b`.
The new ZIP SHA-512 is
`c884fb15ab9b882212aaca4b30c2e8f8984454b527d982ab7a45f0a5e052aa43cd85d5c5542ce9efe78c778ad5b413b89a46e31552ebf7caa7667dad2b43720e`.
The previous native-qualification desktop archives remain in
`release/qualification-history/pre-dictation-controls-0cb60151cb8e`.
The app remains ad-hoc signed, not notarized or uploaded. Generated input and a
generated recognizer qualify activation, capture and ownership, not actual ASR
accuracy on the user's microphone. No personal app, Finder or microphone was
opened. Existing FFI/chunk/optional `.icon` and consumer deprecation notices
remain separate from vulnerabilities.

### Native listener readiness and capture finalization

The microphone remains a microphone while recording, including Ctrl+Space.
The protocol-71 optional button-hold behavior is historical and is superseded
by the two-click repair above. Its pressed/recording state reflects
the owning capture; the icon does not disappear into a stop-square glyph.
Release still flushes the same bounded input, never another capture or a chat
submission.

The pinned NeMo-Speech.cpp 0.2.0 `serve` implementation prints `listener.ready`
with unflushed C stdout before entering its listener. A pipe may retain that
line while the authenticated server is already ready. Readiness must therefore
use a bounded, authenticated `GET /v1/models` on the exact owned loopback
listener and require its transcription capability. Startup output remains
bounded diagnostic/protocol data, not the sole readiness acknowledgement.
Never scan hosts, use a public/cloud endpoint, replay audio, download weights,
change the selected backend or merely raise the existing sixty-second startup
bound to hide this mismatch.
The pinned source is commit
`47f43763bb40ec463150dd8d9a788c54f3728bdb`:
[listener output](https://github.com/NVIDIA/NeMo-Speech.cpp/blob/47f43763bb40ec463150dd8d9a788c54f3728bdb/app/serve.cpp#L672-L681)
and [authenticated model inventory](https://github.com/NVIDIA/NeMo-Speech.cpp/blob/47f43763bb40ec463150dd8d9a788c54f3728bdb/server/http/http_server.cpp#L447-L466).

Keep the original capture's terminal error instead of replacing it with a
generic missing-lease error. Foreign session/nonce checks and no-replay
refusals remain authoritative. Release stops progress polling; an already
in-flight poll cannot cancel finalization or replace its actual final receipt.
Service progress distinguishes cold model preparation from ready streaming.
The client final wait covers the original service recording/flush deadline,
not an assumed already-warm recognizer.

Reuse Node process/HTTP/timer primitives and ws under their existing MIT
notices, and the pinned Apache-2.0 native runtime with separately accepted
OpenMDW model terms. Add no dependency, model download, audio retention or new
durable event/field. Protocol 71 uses a metadata-only upgrade so an existing
healthy protocol-70 service cannot retain the old broken startup behavior;
encrypted rows, grants, receipts, budgets, models and preferences stay intact.
Generated tests must include actual native buffered stdout, delayed listener
readiness, authentication/capability failures, cancellation/process teardown,
terminal-error ordering, held final replies, migration/restart and mic state
in the real hidden composer. No personal microphone or real weights are used.

#### Protocol-71 readiness qualification

The application source is `f059c3c`. Four regressions reproduce before the
repair: a real C stdio wrapper holds the recognizer's readiness line while its
authenticated listener is ready; a failed recognizer is replaced by the
generic missing-lease error; an in-flight poll cancels the original final
receipt; and Ctrl+Space replaces the mic with a stop square. The repaired
native buffered-start case completes in 392.41 ms without increasing the
sixty-second readiness bound. The client final wait instead respects the
already-existing whole-service recording/flush lease.

Generated coverage verifies exact authenticated capability metadata,
unauthorized/redirect/oversize/missing-ASR rejection, startup cancellation,
original terminal failures, ordered PCM and one final commit, partial-cleanup
retention, foreign-owner refusal, crash recovery and lossless 70-to-71
metadata migration. Existing crash/upload tests now assert the exact retained
original failure rather than a generic missing-owner sentence; no ownership,
process, deadline or no-replay assertion was relaxed.

| Surface | Observed result |
| --- | --- |
| Strict types and production build | Pass |
| Focused speech/capture/PCM/draft/host/recovery/import checks | 45 passed in 11,079.64 ms |
| Focused actual hidden dictation/side-context flows | Eight passed in 15.3 seconds |
| Complete source/service/worker/recovery/CLI/native-TUI suite | 1,714 passed, 14 existing skips, zero failures; 1,728 cases in 1,478,146.31 ms |
| Complete hidden desktop suite | 240 passed, three existing skips; 243 flows in 8.0 minutes |
| Actual packaged-app mic/cold-start/restart/composer flows | 35 passed in 1.3 minutes |
| Independently installed packed SDK | All entrypoints/declarations and actual installed delayed/no-stdout recognition, retained transcript restart and original failure probes pass |
| Actual installed-worker continuation/accounting probes | 12 passed |
| Source, independent-consumer and fresh Linux-workload audits | Zero vulnerabilities |
| No-cache Linux arm64 payload/native PTY | Pass in 45,193.99 ms with exact protocol-71 inputs |
| Production ZIP/manifest consumer | Pass; 779,827,942 bytes in 112,925.79 ms |
| Canonical and labelled DMG | Exact signed bundle, Finder layout/resources, byte equality and disk-image checks pass |

Before feature edits, generated OAuth/streaming passed in 1,091.24 ms
(30.76 ms cancellation), SQLite in 64.90 ms (append p95 0.058 ms), PTY in
159.23 ms (151.44 ms cancellation, zero survivors), OpenTUI in 1,063.26 ms,
hidden Electron in 549.88 ms (8.29 ms frames) and filesystem/Git in 93.19 ms.
Broader generic live-account, Rust/Linux-host, physical SendBox/SSH,
signed-release and model-quality gates remain unqualified by those primitive
probes; current executable capabilities remain the setup inventory's authority.

The labelled development installer is
`release/Moguri-0.30.0-alpha.1-dictation-readiness-71-macos-arm64.dmg`
(794,075,476 bytes), SHA-512
`9a7b00408c82a5416a4a20b820ef4a01ab1e146d5c4c9af409fc0543a7299520612958575814de57aec2ca99476fc75dcce69cda733a9b09cb4f0bc193901ef6`.
Its native workload is
`docker.io/library/moguri-worker@sha256:a7024db63cceebb5b33cbbc4ce79dfcc8b81383226b16266b8ff1b04fe2dda19`.
This is ad-hoc-signed, not notarized or uploaded. Generated audio/recognizers
qualify transport and ownership, not the user's microphone, real model
accuracy or cold-start speed. No personal app, Finder, login, keychain, audio
or weights were used. Existing experimental FFI, lazy Ghostty, optional
`.icon` and encoding/DOMException notices remain non-blocking. CI stays
main-push-only; no empty working-branch check list is called a CI pass.

`sessions.side` atomically opens an existing original side chat or creates one
with complete effective parent context and inherited controls. Both chat surfaces
use the same composer, model/window/effort controls, activity Markdown, voice
and queue. The service permanently enforces read-only mode; navigation nesting
does not grant parent context or coordination.

### Per-question side context

The owner requires later main-session history on each new side question, while
earlier side responses keep their original captured inputs. Reuse the maintained
pi-ai message types/estimator (MIT), React/Electron (MIT), existing Node/component
notices and SQLite's public-domain event authority; add no dependency or paid
model call. Refresh only from the actual birth parent in the same profile,
never a navigation attachment or another project/default.

Protocol/schema 67 adds an optional exact `turn.started.sideContext` capture:
source parent, retained sequence watermark, context digest, image evidence and
admitted file/document descriptors. Append it atomically with the new side turn
and encrypted child grants before worker launch; original history, receipts,
model charges and earlier captures are not rewritten. Capture once per new
turn, not on model/tool continuations, provider retries or a late main delta.
The source is the retained effective main context, excluding private roles,
unsent drafts/queues and model/permission advice as authority. Preserve the
side's own prior exchanges and reviewed own-context compactions separately.

New inherited images/documents require the actual selected model's capability.
Input/window/budget admission sizes the complete refreshed envelope; no old
history, images or scoped sources can be silently dropped. Missing original
parent or failed retention is explicit and preserves the undispatched queue.
Restart never replays a side/model call. Parent removal cannot erase existing
child-owned captures or turn a navigation relink into a new source.
Desktop, TUI and SDK use this service-owned behavior with unchanged controls
and permanent read-only enforcement; UI labels disclose capture-at-question
semantics, not continuous mid-answer observation.

Before feature edits the generated macOS arm64/Node 26 baseline passes
OAuth/streaming in 1,124.50 ms (32.09 ms cancellation), SQLite in 73.81 ms
(append p95 0.059 ms), PTY in 160.69 ms (151.85 ms cancellation, zero survivors),
OpenTUI in 1,034.47 ms, hidden Electron in 790.07 ms (8.26 ms scroll frames),
and filesystem/Git in 98.62 ms. Live Copilot/ds4, Rust/Linux, signed/notarized
release, physical SendBox, Kupo quality, System One, configured physical SSH
and full-milestone gates remain explicitly FAIL/unavailable in this primitive.
Tests must prove fixed/routed/queued side refresh, exact prior-input stability,
typed source retention, unsupported images, compactions, profile/birth-parent
isolation, concurrent main work, cancellation, failure, migration and restart.

#### Protocol-67 side-context qualification

The original generated failure proved the second side question omitted the
main session's later turn. The repaired real controller/worker now sends main
time one, main time two and earlier side exchanges exactly once on the next
question, while preserving the original first-call bytes. Active side tool
continuations stay frozen; held questions capture on explicit admission.

| Surface | Final result |
| --- | --- |
| Strict types, production build and verifier syntax | Pass |
| Focused context/source/compaction/schema coverage | 63 passed, followed by 50 expanded profile/cancellation/lineage cases |
| Complete source/service/worker/CLI/native-TUI suite | 1,674 passed, 14 existing skips, zero failures; 1,688 cases in 1,463,358.58 ms |
| Complete hidden desktop suite | 226 passed, three existing skips, zero failures; 229 flows in 7.6 minutes |
| Actual packaged desktop | 19 passed in 45.6 seconds |
| Independently installed packed SDK | Protocol-67 declarations, browser-safe root/React, explicit Node/MCP and actual main1/side1/main2/side2/reopen flow pass |
| Actual installed-worker accounting/continuation probes | 12 passed |
| Root, independent consumer and native workload audits | Zero vulnerabilities |

Generated tests also prove exact child-owned pasted-file and document grants
after parent deletion, unsupported-image preservation, the full refreshed
working-window bound, finite budget refusal before a paid call, original-parent
identity despite navigation relinking, profile isolation, unknown cancellation
holds, atomic capture-append failure and 66-to-67 migration rollback without
ciphertext, receipt, consent or accounting rewrites. A reviewed side compaction
summarizes only its own exchanges; refreshed main context stays separate and
its cost remains included in the complete estimates.

The exact protocol-67 Linux arm64 payload was rebuilt without cache with locked
dependencies and compiled native PTY. Its OCI digest is
`sha256:ec3d22d7e440547ac4b464c1c249dccd019a8c0abe9147a064efe27583ffcabb`.
This is producer/image evidence, not physical SendBox containment or an
external Linux release qualification. The actual 779,789,947-byte ZIP passes
the production update consumer; the styled canonical DMG retains the exact
signed bundle and the labelled byte-identical copy passes disk-image checks:

```text
release/Moguri-0.30.0-alpha.1-side-context-67-macos-arm64.dmg
794074567 bytes
SHA-512:
6c2d21c86b4dc945b95d2237a866257dab4e0beef7dec6aba28e6df4e047d9f3c817d3c17d7c2134afb3565b0d41b93f227c223d95d413088652b27482ce554b
```

The installer is local, ad-hoc-signed development output, not a notarized or
uploaded release. No personal application or previously user-mounted image
was replaced/opened. No real microphone, login or paid inference was used.
Known non-blocking notices remain experimental OpenTUI FFI, the lazy Ghostty
chunk, optional `.icon` format and transitive encoding/DOMException
deprecations. Original physical/live-provider, Rust/Linux, quality and
notarization exclusions remain unchanged.

The current focused source checkpoint passes the original approval/schema
lineages plus actual generated recognizer streaming, controller-pipe teardown,
frame sequence/finalization, no-PCM/token retention and safe composer edits.
All **13 related hidden Electron flows pass in 18.6 seconds**, including live
Ctrl+Space words before release, pointer/keyboard flush once, exact device
selection, pre-admission release, cancellation, empty recognition, immediate
side-chat parity, fuzzy names, custom swatch and Markdown reasoning. This is
generated mechanical evidence, not physical microphone/model-quality or final
whole-feature release qualification.

## Captured folders and compact settings

`project.group` uses the existing folder/configuration events in one transaction
with every captured project revision. `session.create` accepts an exact folder
member/revision set, captures canonical path/device/inode identities and rechecks
membership before retaining the new session. The paired `projectFolderId` and
`repositories` fields are immutable; `projectId` stays null. This does not turn a
null project-free scope into a root or a common-parent grant. Schema 65 refuses
older-labelled history containing either new scope field.

The central managed-root resolver owns explicit filesystem/command selectors,
client Files/Changes reads and user consoles. Model grants return the actual
selected root, not the worker's nonexistent default. Standalone SDK tools use
the same resolver, folder restrictions and permission context. Original roots
are rechecked before authorization and their current member settings revision
participates in the asynchronous guard.

Every captured root participates in active/pending writer ownership and
retained uncertainty. A single-project or foreign-profile writer cannot run
through another member while the group owns it. Archive preserves unknown
ownership; deletion/removal cannot erase it. Read-only sides preserve the exact
root set and original parent context without acquiring writer tools. Folder
session restarts retain queued/held work and identities without replay.
Repository-specific GitHub panels and workspace plan files stay in a member
project chat; a folder's explicit model task checklist remains in Plan.
Unqualified per-repo MCP, hooks, memory indexing, background jobs,
publication and managed-worktree rebinding do not substitute a member.

Native center drops attach session navigation or review a newly named project
folder; edges retain shared ordering. Folder expansion and fuzzy search are
presentation only. The shared grip control binds profile/entity scope and the
complete original ID order, preserving current item objects and rejecting stale
structure. It serves board-phase drafts and actual service-owned prompt queues,
with Alt+Up/Down, focus restoration, pending gates and visible failures.
Single booleans use switches, true multi-selects remain checkboxes and exclusive
inspection/removal choices use dropdowns. Icon-only actions keep accessible
names/tooltips and preserve destructive review.

Focused source coverage includes actual cross-root model and SDK tools,
member-specific remembered grants/restrictions, atomic stale grouping,
single/group and cross-profile contention, cancellation and original-root
restart quarantine. Hidden desktop flows exercise native center/edge drags,
folder creation, explicit file/console selection and actual saved phase order.
The speech suite additionally SIGKILLs a real generated control plane, observes
its exact recognizer stop through the private host pipe, and restarts without
reopening audio, replaying frames or creating inference/accounting entries.

Independent multi-acknowledgement Git reviews keep their checkbox checklist;
one acknowledgement uses the single-option switch. Worktree-removal choices
use one explicit dropdown target with its captured revision and a labelled bin
action, preserving the branch and every unselected checkout. Unexpected native
recognizer signals remain in the private host's failure diagnostic rather than
being reduced to an unexplained supervisor exit code.

Compatibility fixtures explicitly choose bounded Max when exercising its older
tool-decision authority. They do not use a new automatic Max selection to
manufacture that old consent. New automatic approvals and Max technical choices
are qualified separately. Earlier failed/aborted runs with old toggle/hold/drag
expectations are not counted as final passing qualification.

## Final protocol-65 qualification

The final executable tree at `0b5080f`, with the acknowledged-readiness test
guards at `e7466b7`, passes the following complete local qualification.

| Surface | Result |
| --- | --- |
| Clean install, type checks and production build | Pass; source audit reports zero vulnerabilities |
| Complete source/service/worker/CLI/native-TUI suite | **1,630 passed, 14 existing platform/native skips, zero failures** across 1,644 cases in **1,369,419.11 ms** |
| Complete hidden desktop suite | **220 passed, three existing native/packaged skips, zero failures** across 223 flows in **6.8 minutes** |
| Actual packaged desktop | **11 passed** in **15.2 seconds**, including hold-to-talk, side controls/context, folder/session drops, file/console/plan scope, phase ordering and exact reviewed Git/worktree actions |
| Independently packed SDK | All root/React/Node/MCP imports and declarations, audited install, captured-root operations, named-tool grants, immediate sides and actual shipped speech-host ownership/signal checks pass |
| Actual installed worker | **12 passed**, including acknowledged continuation, complete budget transfer, failed receipts and control loss |
| Final source and independent-consumer audits | **Zero vulnerabilities** |
| Canonical ZIP/manifest and DMG | Pass the bounded production update consumer, signed-bundle identity and actual Finder geometry/background verification without opening Finder |

The pinned protocol-65 Linux arm64 workload was built without cache and
qualified with exact locked dependencies/native PTY/payload identities in
**40,286.72 ms**. Final packaging reuses only that verified unchanged payload.
This is not qualification of physical SendBox containment or an external Linux
release host.

The actual final ZIP is **779,784,650 bytes**. The separately generated installer
`release/Moguri-0.30.0-alpha.1-session-65-macos-arm64.dmg` uses a distinct
Session-65 volume label, has a valid native image checksum, and is
**794,026,246 bytes**. Its mounted application tree exactly matches the canonical
manifest. Its SHA-512 is:

```text
05419dd7fe62312ca7eb5703498fed6b60991c6faf432ebe8c3a5602f713cadcb8319618110f67be69ce7a3bb8cb4600047c0a5f9c167dfdbc9113356614290d
```

Qualification uses generated data, private temporary state, owned loopback
services and hidden windows. It does not open a personal application/browser,
record a microphone, download model weights, authenticate an account or perform
live paid inference. The installer remains ad-hoc-signed development output,
not notarized or installed into the user's Applications folder.
An additional generated SDK smoke opens a real group User PTY in the selected
member, verifies its captured binding and actual `pwd` output, then closes that
exact console without a HOME fallback, model call or terminal replay.

Non-blocking notices remain experimental OpenTUI FFI, the lazy Ghostty chunk
size, the packager's skipped optional `.icon` format and deprecated transitive
`whatwg-encoding`/`node-domexception` packages. CI remains restricted to pushes
to `main`; an empty PR check list is not a claimed CI pass.
