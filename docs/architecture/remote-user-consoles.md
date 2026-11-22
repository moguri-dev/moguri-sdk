# Owned Remote user consoles

Protocol/database 25 extends the existing Local console contract to explicitly
mapped Remote projects. This is a user-controlled host console, not an agent
tool, MCP grant, SendBox boundary or proof of detached-descendant containment.
The qualified **0.19.0-alpha.1** delivery spans service/SDK/CLI/OpenTUI/Ghostty.
Its exact independently installed SDK and actual packaged application are
qualified; [setup](https://github.com/mbianchidev/moguri/blob/main/docs/setup.md#preserved-qualified-0190-alpha1-checkpoint)
records immutable artifact identities and separate source/consumer/package
evidence.

Reuse Node 26 (MIT), Node-PTY (MIT), OpenSSH (BSD), TypeBox (MIT), the existing
broker/engine/HMAC/framer, SDK generations and process-group stop helper.
No new dependency, provider/model request, terminal renderer or agent loop
is introduced. The measured [private prerequisite and implementation
history](remote-console-primitives.md) precedes public integration.

## Authority and immutable identity

The Local control plane remains the only durable writer. The Remote broker
owns PTY masters and bounded volatile buffers, not another Moguri domain
database. A profile can retain one Local owner and distinct pinned-peer Remote
owners. Concurrent opens share only the original owner for that profile/peer;
four consoles per session and sixteen per profile still aggregate across envs.
Another profile never inherits its endpoint/key/terminal metadata.

`terminal.owner_changed` records Remote **preparing** intent with null paths
and PID before remote resource preparation. It binds the actual host/key/port/
login, retained SSH argv/identity path, peer and bridge/broker hashes. A
prepared directory/endpoint can be filled once; an observed PID cannot switch.
The Remote HMAC domain is distinct from unchanged Local version-1 ownership.
Schema 25 preserves schema-24 ciphertext, keys, receipts and Local owner/PTY
identity; marker failure rolls back without a reset.

An exact `terminal.changed` intent precedes the PTY. It binds original canonical
command ID/digest, launch digest, explicit `env: Remote`, peer, session/project
and actual Remote canonical root/lossless device/inode. Whole binding bytes,
env, original launch/command and an observed PID are immutable, even if corrupt
metadata tries to reuse a digest with changed fields. No saved PID is blindly
adopted or signalled.

## Pinned carrier and technical secret

A core SSH probe reports optional console helper argv/hashes and the execution
host's shell. The controller compares expected file digests without selecting
its own shell. Missing/inaccessible console files or an invalid console shell
are explicit console-unavailable metadata, not failure of an otherwise
qualified core agent. Strict console admission never falls back to Local,
an alternate shell, helper or peer.

The separate 512-KiB `terminal-bridge.mjs` stream does not traverse the model
worker, PTY or durable agent journal. The execution host prepares a private
deterministic `mo-...` path for the retained owner ID/scope. Bounded version-1
owner/admission/cleanup markers contain no key, input, transcript or keystroke
hash. One exclusive admission precedes the independent broker; an original
start or PTY intent cannot launch again after a lost acknowledgement.

The generated 32-byte technical owner capability stays in the explicit profile
secret backend under `dev.moguri.profile.PROFILE_ID.terminal-owners`,
`terminal-owner-OWNER_UUID`. It reaches only the captured pinned SSH stream,
Remote memory and new broker's private Node IPC. It is not a Copilot/MCP access
credential; no refresh or private SSH key is copied. Fresh mutual HMAC nonces
bind each attachment to exact owner/profile/peer/build/PID, with one live
controller lease and no takeover operation.

The Local controller never stats/unlinks a Remote endpoint or treats a Remote
PID as Local. Only the explicitly selected Local SSH identity/pin store is read
for SSH authentication. Target aliases are not new peer authority.

## Lifecycle and input

New Remote consoles require the exact probed helper/project mapping and a
deliberate user open. No selected model, autonomy delegation or MCP grant is
needed. Policy/env/root/script/peer are rechecked after asynchronous admission;
the actual broker rechecks inode identity before input/resize.

Explicit service restart/preservation and unexpected control-plane loss detach
without replacing the original broker/PTY. Recovery authenticates the retained
owner/key only and creates a new attachment generation, not a new shell.
Existing Remote input then needs its current allowed env/pinned peer/project
mapping and authenticated attachment, not another core-agent probe. Changing
model/MCP preferences does not grant terminal input. Changing env/policy/root
blocks new bytes while read/close still use the original captured boundary.

Input/output/resize are ephemeral, never model context or durable receipts.
An input ACK means accepted by the exact PTY, not shell-command success.
An error/control loss can leave accepted bytes unconfirmed. SDK chunks,
Ghostty queues and reconnect discard unsent bytes; uncertain bytes never retry.
Actual service SIGKILL during an intentionally held post-write HTTP ACK is
covered without replay or source-event input leakage.

Ordinary stop/default disposal closes known groups/owners before exact private
cleanup; hiding the panel detaches only the view. Failed group/key/directory
cleanup retains registry, writer lock and typed pending intent. Unknown files
are not recursively removed. A fixed cleanup-only connection for an exact
confirmed-stopped pending owner may run after agent shutdown; it cannot
reopen normal work. Missing keys/changed peers/builds/orphans remain explicit
unconfirmed state, never another backend, guessed process or replacement.

## Clients and qualification

The same `sdk.terminal` commands serve Local and Remote. CLI input is bounded
piped UTF-8 only. Shared `/terminals open` is explicit new admission; list/read/
reconcile/close and owner inspection never launch a shell implicitly. Stdin is
not a composer command.

Ghostty shows the captured SSH host/root and owner/key pin, keeps original-host
output/close after scope changes, disables newly disallowed input and uses
the existing attachment-generation guard. Factory-dark layout and the Local
console contract stay intact.

The corrected source passes **548/548 checks in 416.23 s**, both type checks,
the complete build and **37/37 hidden desktop workflows in 1.3 min**.
Source audit reports zero vulnerabilities. Cases cover real service SIGKILL,
missing-key restoration, lost original/input ACKs, failed state/PID
publication, actual host root/inodes, parallel capacity/profile aliases,
unreopened-profile cleanup, admission cancellation, policy changes and exact
partial cleanup retry, plus existing Local and core SSH/MCP/plan behavior.
These use generated same-host SSH fixtures, not personal authorization,
microphone, model weights, a VM probe or Linux release acceptance.
The exact installed SDK additionally passes approved install/rebuild, audit,
all four external entrypoint types and actual Local/Remote terminal restart/
input/CLI/TUI/no-replay/private cleanup. All **37 actual packaged workflows
pass in 1.4 min**. Bundled-runtime qualification independently verifies the
Remote owner/PID/restart/ordinary-stop boundary before the separate Local
console memory cohort. Exact archives and DMG integrity are recorded in
setup; ad-hoc signing is not notarization.
