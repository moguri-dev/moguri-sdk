# Exact user-requested Remote plan saves

This first-release slice extends the existing `plans.save` capability to the
pinned SSH workspace. It is an explicit user filesystem action, not a model
request, optional child, tool delegation or Local fallback. Local plan behavior
stays on its existing path. Sandbox work remains paused.

## Reuse and prerequisite

Reuse the Moguri-owned worker/control loop, Remote execution identity, encrypted
frame journal, single event authority, SDK, TypeBox, filesystem helpers and
independent artifact grants. Node, TypeBox, React and the test-only esbuild are
MIT-licensed; OpenSSH retains its upstream BSD/ISC-style licenses. No runtime
dependency or second agent framework is added.

The [measured SSH mutation prerequisite](remote-plan-primitives.md) passed six
generated cases in 4,549.71 ms before the feature. It distinguishes known worker
exit from unconfirmed effect acknowledgement, preserves post-write stop as
partial, blocks folder rules and makes no model request. The production worker
now has a typed user-operation branch rather than the fixture's transport packet.

## Reviewed binding and authority

`plans.read(sessionId)` returns Remote bytes/digest plus `bindingDigest` and
actual pinned root/host/build metadata. Remote saves require that reviewed hash:
`plans.save(sessionId, text, expectedDigest, bindingDigest)`. Local callers keep
the existing three-argument API. An absent file in two different roots is not
enough to authorize the second root. No SDK/client guesses a replacement binding.

Capture exact profile/session/project, mode, root, peer/build, configured plan
path, expected file digest, input bytes, command identity and current env/folder
policy. Persist intent before dispatch. Recheck after asynchronous preparation
and immediately before granting this one exact write. No model, account,
autonomy recommendation or confidence is needed or permitted to authorize it.
Read-only/side/model-child sessions, denied/read-only folders, unavailable envs,
shared-root writers and unconfirmed cleanup fail explicitly.

The same worker initializes no provider for user plan work. A typed start carries
the exact operation with empty model context; one argument-bound approval
request reaches the controller. A durable user intent authorizes that exact
operation, not a policy grant for later model tools. No synthetic human prompt
or model response is added. These control-turn results never become orphaned
tool results in subsequent solver context.

## Filesystem and acknowledgement lifecycle

Shared bounded directory preparation records actual created directories.
Cancellation checkpoints before atomic rename prevent unstarted writes;
a commit witness distinguishes bytes already replaced from no-effect failure.
Valid non-binary Unicode, 128-KiB UTF-8 and bounded parent depth are checked.
Typed `user-plan.complete` carries bounded structured data, so JSON escaping
cannot turn a legitimate full-size plan into an oversized model-tool receipt.

Persist the exact result/frame cursor before acknowledging it. After the
worker's terminal request, retain observed terminal metadata and acknowledge
that request before waiting for the actual owned-worker exit. Waiting for exit
before terminal acknowledgement deadlocks the existing bridge. Only then
atomically commit the independent artifact, completed save/turn and successful
command receipt and resolve the SDK call with its artifact ID.

Stop after directories/file work, changed scope, lost result/terminal
acknowledgement, unexpected worker exit or failed artifact/receipt retention
is partial/unconfirmed. Actual effects remain inspectable; no rollback,
successful cancellation or clean save is invented. Exact save stop cannot
target whichever newer turn happens to be running.

Known failure without any filesystem effect and with confirmed owned-worker
exit does not unnecessarily quarantine the root. Unknown/partial work still
does. SSH and known worker exit never prove process-descendant containment.
These checks cover process/control loss, not filesystem power-loss survival.

## Durability and independent provenance

Protocol/database 20 adds `plan.save_recorded` revisions and the `plan.save`
control purpose. Original history, receipts, profile keys/grants and ledger
charges stay unchanged. `RemotePlanSave` retains exact command/input/policy,
execution/boundary, file outcome, actual directory effects, result, artifact,
phase and diagnostic. No historical Remote save or zero-cost model call is
invented. There is no model reservation because no model is called.

A restart turns unsettled intents partial without retrying a write or emitting
a success receipt. A repeated original command cannot replay a pending/partial
intent, even when no success receipt exists. Actual late frames are adopted
only against their exact retained user authorization/input/root/build. Explicit
reconciliation can retain known written bytes with frame provenance, never
promote the original partial turn into success or rerun its effect.

Remote artifacts use independent retention grants and actual user/Remote
boundary provenance, not a Local-file or chat-answer label. Session deletion
does not erase a committed artifact. A written file without successful snapshot
retention remains an explicit partial outcome requiring inspection.

## Shared clients

SDK `plans.saves`, `saveInfo` and `stopSave` expose actual owned lifecycle.
CLI uses `plan read`, then `plan save FILE --digest DIGEST --binding BINDING`
for Remote. `plan saves/info/stop` inspect/control one exact operation.
Shared `/plan edit` opens the native TUI's scoped text editor without a Local
file opener; `/plan save {text,expectedDigest,expectedBinding} confirm-write`
is an explicit alternative. JSON text is never whitespace-normalized.

Desktop enables the existing Plan editor after a qualified read. It preserves
dirty text on errors/partial results, exposes actual save/cleanup/boundary and
retained-artifact metadata, and stops by exact save ID. Scope changes block
saving old edits into another root. A settled original RPC cannot auto-load a
new mapping over those edits, even if the peer SDK snapshot arrives late.

Generated coverage includes real pinned SSH, exact bytes and maximum size,
mode/root/policy races, pre/post-effect stops, missing acknowledgements,
retention failure, duplicate commands, physical schema migration/failure and
actual control-plane SIGKILL before authorization and result receipt. Native
TUI/desktop and exact installed-package qualification are recorded in setup.
The wider Remote console/MCP/memory and complete first milestone stay separate.

## Targeted source evidence

The real native TUI edit/save/retained-inspection flow passes in **1,624.60 ms**
without a selected model or Local opener. Four focused hidden desktop flows
pass in **13.4 s**, including no-model saving/draft preservation, post-write
stop, and a held settled RPC followed by root remapping. The first desktop run
was three of four: long path/fingerprint overflow at 900 x 740 was real, then
corrected with bounded wrapping/progressive disclosure and confirmed at both
sizes. Its original trace/context/screenshot remain retained separately.

Shared-root writer ownership across isolated profile/target aliases passes in
**2,715.98 ms** with zero model requests. A physical control-plane SIGKILL before
authorization and before result receipt passes without replay, preserving
actual late-frame/Remote artifact provenance. These are generated mechanical
checks, not filesystem power-loss or containment qualification. Complete source,
packaged-client and exact installed-consumer evidence is recorded in setup.
