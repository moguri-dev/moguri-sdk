# Remote console ownership prerequisites

The 0.19 development source privately tests Remote user-console transport and
now adds protocol-25 ownership/schema foundations.
The current qualified delivery remains immutable **0.18.0-alpha.2 /
protocol 24**. The private proof alone did not enable a Remote terminal API
or qualify complete public recovery. The later schema foundation below does
not enable that API either.
Sandbox work remains explicitly paused.

Reuse Node 26 (MIT), Node-PTY 1.1 (MIT), OpenSSH (BSD) and the existing
authenticated Local terminal broker/channel/binding/engine. No dependency,
second agent loop, model, provider account or terminal transcript store is
introduced. `RemoteRuntime.connect` now exposes its existing internal pinned
SSH connector to another owned transport with a validated bounded frame
ceiling. The default agent/query ceiling stays unchanged; the private console
uses the existing 512-KiB terminal ceiling. Pre-aborted/closed/invalid-limit
connections fail before process admission. A direct connection belongs to its
caller, which must explicitly close its exact SSH child.

## Private ownership boundary

The fixture frontend runs on the actual generated pinned SSH host. It prepares
a canonical root/device/inode binding and private runtime directory before
any broker, then accepts one exact broker/key admission over encrypted stdin.
An exclusive version-1 non-secret admission marker precedes the fork.
Reissuing that original owner bootstrap cannot launch another broker,
including after losing a readiness response. The bootstrap key crosses only
that SSH stream and the new broker's private Node IPC; it is neither a provider
credential nor a file.

The independent detached broker owns the PTY master, volatile bounded output
and exact known process groups. The SSH frontend owns only an authenticated
Unix-socket controller connection. Losing the frontend therefore detaches the
view/controller, not the user console. Fresh attachment performs the existing
mutual HMAC nonce proof, verifies owner/profile/scope/build/PID and enforces a
single live controller lease. Terminal launch IDs/digests remain no-replay.
Nothing resends input or interprets a disconnect as proof of accepted bytes.

Root identity is checked by the existing broker on the execution host before
new input/resize. Changed root metadata cannot redirect a retained terminal
into a replacement directory. Read/inspect and exact owned-group close remain
possible. SSH is host execution, not SendBox isolation; descendants that
detach or reparent are not proven contained.

The helper uses the existing broker's **execution-host Local** inner DTOs.
They are not published as `env: Remote`, not mixed into a user's Local
projection and not evidence that the public Remote boundary is implemented.
Public owner/binding identity must explicitly add pinned Remote provenance,
not relabel these private messages or stat a remote endpoint on the controller.

## Failure and cleanup

Bad/missing HMAC keys, changed helper builds, another controller, changed SSH
host pins and repeated owner bootstrap fail without another owner or PTY.
Transport closures reject pending requests; later fresh reads inspect only
the same original owner. Ordinary private cleanup first observes actual
broker disposal, then removes only the original socket/admission and an empty
owned directory. Unexpected files retain both content and original admission
until explicit inspection/retry. There is no recursive remote-runtime removal,
personal SSH configuration, ambient agent forwarding or Local fallback.

Five generated cases pass in **5,760.70 ms**, with both type checks:

- Actual SSH-originated broker/PTY/root/PIDs and input, exact duplicate launch
  returning the original PID, and no key/input/transcript file.
- SIGKILL of the **owned OpenSSH client**, followed by observed remote frontend
  exit and fresh authenticated attachment to both original PTYs/owner. This is
  not a real Moguri service-SIGKILL claim.
- Missing/wrong keys, live-controller exclusion, changed build/host key,
  original owner-admission exclusion and pre-aborted/invalid-frame rejection.
- Actual generated directory replacement rejects new input while allowing
  known-group close.
- Unexpected private files/admission survive failed cleanup and an explicit
  exact retry succeeds.

The generated daemon, keys, owners, PTY groups and private runtime paths are
owned and cleaned by the fixtures. Authentication keys and workload data are
generated; the existing OS login supplies the fixture daemon's account.
There is no personal authorization, microphone, model call, model weight or VM probe.

The refreshed combined gate passes **14/14 in 11,356.49 ms**, including the
five private console cases and existing real SSH worker/model/tool,
host-key/cold-connect, image, project-free and stale-approval regressions.
The shared agent/query frame ceiling and existing SSH semantics are unchanged.

## Protocol-25 ownership foundation

Remote owner intent can begin with **preparing**, a null endpoint/directory
and no PID before remote resource preparation. Later endpoint/PID observations
are filled once, never switched. Missing/unconfirmed/unstarted metadata stays
explicit rather than being turned into a Local path. The independent profile
owner binds an immutable pinned target, actual peer digest and bridge/broker
digests. A dedicated Remote HMAC scope is distinct from the preserved
version-1 Local scope.

Remote terminal bindings explicitly carry `env: Remote`, the pinned peer,
actual execution-host canonical root/device/inode and their digest. The broker
accepts only a binding matching its own boundary. Original owner/binding bytes,
env, launch/original-command and observed PID cannot change under a retained
identity, including a forged unchanged digest with altered root fields.
Remote metadata can never authorize Local endpoint stat, key lookup or
private-path cleanup; unfinished transport paths fail explicitly.

Migration 25 adds the `remote_terminal_schema` marker without rewriting
schema-24 payloads, content grants, keys or receipts. The legacy downgrade
fixtures remove only markers newer than their chosen version.
Existing Local owner/proof/launch formats remain accepted unchanged.
Migration failure rolls back and preserves the exact schema-24 database.

The current **11/11 boundary/state cases pass in 6,887.38 ms**, with both type
checks. They cover actual SSH broker Remote mode and cross-peer rejection
before a PTY, preserved Local owner/PTY identity and ciphertext through
schema-24 upgrade, explicit unready Remote-owner reconciliation without any
Local key read, immutable projection/field bytes and interrupted marker
recovery. The earlier combined Local recovery regression also passed; these
foundations are not public Remote-console service-SIGKILL/client acceptance.
The broader foundation build/regression gate passes **43/43 in 6,975.28 ms**,
covering the Local terminal lifecycle, original input/launch/secret failures,
profile owners, repository/operation/MCP schema rollbacks and the new Remote
boundary/state cases. The SDK/types, service/workers, TUI and desktop build.
The existing Ghostty chunk-size advisory remains visible.

## Production carrier development

The source now includes a separate `terminal-bridge.mjs` build and typed
`RemoteConsoles`/`RemoteTerminalChannel` carrier. A core SSH probe reports
the host's Node argv, shell and bridge/broker hashes; only matching local
expected hashes enter `terminalBuild` metadata. This is installed-build
evidence, not a public console-ready flag.

The 512-KiB stream never traverses the model worker or its durable journal.
It supports actual Remote binding reads, deterministic private endpoint
preparation from a retained owner ID/scope, one-use broker admission,
authenticated attach and exact known cleanup. Owner metadata/admission/
cleanup markers are bounded, private, versioned and secret-free.
Technical bootstrap keys cross only pinned SSH and private Node IPC.
Cleanup preserves unexpected files, observes the known PID's exit without
signalling an arbitrary retained PID, and can retry its exact pending stage.

The shared SSH runtime tracks direct caller-owned children as well as existing
agent/query wrappers, so shutdown detaches every owned SSH stream rather than
leaving a hidden controller lease. The independent broker/PTY survives;
a fresh transport can authenticate only the same retained owner/key.

Three generated production-carrier cases pass in **4,186.29 ms**, with both
type checks and a complete build. They exercise event-first durable owner/PTY
metadata, actual SSH output/input, duplicate launch without replay,
detach/reattach, key/build rejection before another connection and actual
runtime shutdown/fresh transport recovery. Tests write generated control-plane
intents directly while the public terminal admission API remains gated.
The complete public manager/session/policy/recovery/client path is still being
integrated; no Remote console-ready surface or 0.19 archive is qualified.

## Required public acceptance

Before advertising Remote user consoles, the authoritative service/SDK must
add versioned immutable pinned-peer/owner/root/launch identities and a
schema-preserving migration, with intent before remote broker and PTY
admission. Keys stay in the explicit profile backend, never journals. Local
ownership must remain compatible and never accept Remote metadata as a Local
filesystem path.

Service restart/SIGKILL, lost startup/input/cleanup receipts, unavailable keys/
host, target aliases/changes, profile isolation, source deletion and cancellation
need actual public recovery coverage. Normal stop versus explicit preservation
must remain distinct. Pending and accepted-but-unconfirmed input cannot replay.
SDK/CLI/OpenTUI/Ghostty need the same boundary, attachment generation, read/
resize/input/close and retention semantics, followed by exact installed SDK
and actual bundled-runtime qualification. No new public readiness follows
from this private proof alone.
