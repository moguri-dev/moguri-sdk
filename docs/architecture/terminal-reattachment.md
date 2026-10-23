# Restart-reattachable user consoles

Protocol/database 23 gives explicitly opened **Local user terminals** an
independent, authenticated Node/Node-PTY owner. One owner process serves a
profile's consoles; the service remains the only durable state writer. This
extends D06's measured Node exception, not general agent background execution,
Remote/Sandbox consoles, Rust supervision or complete descendant containment.
Protocol 25 separately extends this to
[owned pinned SSH consoles](remote-user-consoles.md), preserving the Local
version-1 format and never relabeling an existing Local process.

Protocol/migration 44 adds one independently owned **Global Local terminal**
per profile, with real null session/project identities rather than a synthetic
conversation. The user explicitly opens the disclosed canonical home root or
another explicit SDK/CLI root. Project-free Local session consoles likewise need
an explicit root; neither grants workspace authority to its model. The same
broker and launch digests bind null scopes, exact root/inode and actual profile.
Remote still requires non-null session/project/peer ownership. Global intent
survives unrelated session/project deletion; concurrent opens cannot start a
second global PTY, and missing receipts cannot resurrect closed original work.
Existing owner metadata/builds are retained, not silently upgraded or replaced.

The [prerequisite spike](terminal-reattachment-primitives.md) qualified the real
PTY, process-loss, framing and authentication primitives before integration.
Reuse Node and `node-pty` (MIT), TypeBox (MIT), existing process-group stopping,
the JSON framer, SDK and `ghostty-web` (MIT). No dependency, VT parser, provider
request, plaintext production key file or model capability is added.

## Authority and identities

Retain a profile-root `terminal.owner_changed` event before the owner process,
then a session- or independent profile-scoped `terminal.changed` intent before an actual PTY launch.
The owner records its ID/profile, private protocol/build/scope digests, actual
observed PID, canonical private runtime endpoint, lifecycle and private-resource
cleanup stage. `retained`, `pending` and `removed` distinguish keeping resources
from incomplete or observed credential/runtime cleanup.

The terminal retains the original canonical command ID/digest, exact launch
digest, profile/session/project/workspace, **Local** environment, canonical root
and lossless device/inode identity. Arguments and shell text are not copied
into terminal metadata. The broker validates the binding and launch digest
before spawning. It remembers admitted terminal identities, including expired
closed buffers; losing a successful command receipt cannot authorize a second
launch. A failed publication after the real spawn stays unconfirmed until that
existing process is inspected.

Fresh mutual HMAC proofs bind each socket connection to the retained scope,
build and actual owner PID. There is one authenticated controller lease, not a
takeover operation. Wrong keys, scope, build, endpoint permissions or PID fail
closed. Recovery authenticates and inspects an existing owner only: it never
guesses a PID, adopts an orphan terminal, launches a replacement or replays
input.

The default explicit secret backend is the OS keychain namespace
`dev.moguri.profile.PROFILE_ID.terminal-owners`, with slot
`terminal-owner-OWNER_UUID`. An embedded runtime may explicitly inject
`platform.terminal.vault`; an explicitly supplied scoped platform vault is also
reused. There is no production plaintext fallback. Only owned bootstrap IPC
receives the generated 32-byte key; it is absent from argv, events, receipts,
terminal output and model context. Generated tests use isolated synthetic
backends, including a test-only persistent backend for actual service SIGKILL.

The runtime directory is a canonical owner-only `mo-XXXXXX` temporary directory.
Only its owner-only Unix socket is expected. Cleanup unlinks that exact socket
and removes an empty directory, never recursively deletes unexpected files.

## Lifecycle, races and failure

An explicit `moguri service restart`, `stopMoguriService(stateDir,
{ preserveTerminals: true })` or embedded `runtime.close({
preserveTerminals: true })` detaches without stopping user PTYs. Unexpected
controller loss also leaves the independent owner available for authenticated
inspection. Ordinary service stop, default embedded disposal and an explicit
terminal close retain owned-group stop semantics. Closing or hiding the
desktop panel detaches its view, not the shell.

The authenticated lifecycle endpoint acknowledges **acceptance**, not completed
shutdown. Opposite in-flight stop/restart actions conflict. Clients wait for
the private registry to disappear and detect explicit unconfirmed shutdown.
Failed group/private-resource cleanup retains the registry, writer lock and
typed cleanup intent. New work stays blocked; after backend/process inspection,
an explicit stop retry can complete cleanup without spawning a second writer.
Known-stopped resources do not require a fabricated live broker to retry key or
empty-directory removal.

Pending admission is tracked. Shutdown cancels secret/startup admission and
waits for admitted opens before detach/stop. A newly created broker whose
startup or PID publication fails is stopped through its exact owned child
handle before any PTY request; an unobserved stop remains unconfirmed. A partial
secret write cleans its exact slot. Missing credentials for an existing owner
never select another backend or create a replacement.

Profile recovery includes owners and pending private cleanup in profiles no
client reopened. Owner metadata is independent of session retention; removing
a session first confirms its known groups stopped and forgets its volatile
buffers, without deleting another session's shared owner.

Input and resize recheck the current Local policy, session/root mapping and
captured device/inode, including after asynchronous admission. A changed or
excluded Local environment permits inspection/close, not new input or a Remote
label. An authenticated broker rechecks the actual directory identity too.
Stopping known process groups does **not** prove containment of detached or
reparented descendants.

## Volatile bytes and client behavior

Each PTY keeps a UTF-8-safe **128-KiB** volatile output window. Pages advertise
lost-prefix/base and next offsets in UTF-16 code units, with a
**65,536-code-unit** page ceiling. Reads observe the current live window, not a
frozen multi-page snapshot. New output may advance the base between reads;
concatenating those independent pages can exceed the retained-window bound
without the broker retaining excess bytes. A complete-window inspection retries
when page bases differ, while streaming clients handle the advertised gap.
Private control frames are limited to **512 KiB**; ordinary worker frame
behavior is unchanged. At most four live consoles per session and sixteen per
profile, including at most one independent global console, are admitted. Each broker retains at most 32 closed terminal buffers
and 4,096 seen launch identities; reaching that identity bound requires explicit
ownership shutdown, not silent history reuse.

Input/output never enters events, durable command receipts, model context or
terminal-input hashes. Output survives a control-plane restart only while its
owner/buffer survives. Missing or expired buffers have an explicit diagnostic,
not a persisted transcript or fabricated output.

The shared SDK exposes open/read/input/resize/close, terminal and owner
reconciliation, and explicit process-inspection acknowledgements. Empty owners
remain inspectable even if root authority changed before the first PTY intent.
An owner cannot hide unconfirmed terminals through an owner-level
acknowledgement. Inspection acknowledgement is not proof of historical cleanup;
unverifiable owner metadata/capabilities remain retained.

CLI exposes `terminal list/open/read/input/reconcile/close`,
`owner-reconcile` and explicit `acknowledge`/`owner-acknowledge`. Input comes only
from bounded piped UTF-8 stdin, never command arguments or receipts. Shared
`/terminals` commands let CLI/native TUI inspect/read/reconcile/close existing
consoles. `/terminal` remains the desktop Ghostty action.

Every actual attachment has a new SDK `attachmentId`. Ghostty reconnects that
generation, labels disabled input, and shows its actual retained Local owner
and root. No retained terminal status triggers automatic replacement. New
consoles require an explicit action; even reopening a closed console does not
create another process.

Queued unsent UI input is discarded on detach, error, service/profile/session
change or reconnect. SDK multi-chunk input checks cancellation and the actual
attachment between chunks. An unacknowledged or partly delivered input remains
uncertain; it is not resent. Empty output pages are not passed to Ghostty's
zero-length WASM allocation/write path.

## Qualification

Generated integration covers actual service SIGKILL and explicit lifecycle
restart, same owner/PTY PIDs, lost command receipt and metadata publication,
partial secret writes, admission cancellation, missing key restoration, private
endpoint/root changes, shared-owner profile isolation, unloaded-profile stop,
migration-23 rollback and retryable cleanup without recursive removal.

Hidden native tests exercise real Ghostty idle pages, queued-input detachment,
closed-console reopening and actual service restart with the same process.
The owned Electron reconnect barrier prevents a generated test's transient
service gap from invoking production auto-start/secret backends.

Exact packed SDK and actual packaged Node/owner/client qualification, including
one-owner multi-console memory measurements, are required before describing a
new development archive as delivered. See [setup](../setup.md) for the currently
qualified source/artifact results. No personal authorization, microphone,
model weights, paid inference or Sandbox probe is used.

The existing 600-MiB development budget is the **Electron-shell process
aggregate** in `scripts/spikes.mjs`, not an invented total-runtime cap. Report
control-plane/broker RSS and the combined application total separately, along
with generated user programs. The initial package verifier incorrectly
applied that shell threshold to all components. Its retained per-process
diagnostic measured 554.08 MiB Electron plus
277.33 MiB control-plane/broker, 831.41 MiB combined. That rejected result is
retained; correcting its scope does not erase or relabel the combined memory.

Import-boundary checks also exposed unnecessary service/provider/MCP/native
loads during SDK discovery. `createRuntime` now explicitly loads its separate
`runtime.mjs` entry only when embedding is requested. The private broker uses
the existing core validation/error helpers and narrow terminal schema, not the
entire application protocol. Public API/class identity and durable schema
semantics are unchanged. These are measured module boundaries, not a Rust
qualification or a claim that the overall application uses less than 600 MiB.
