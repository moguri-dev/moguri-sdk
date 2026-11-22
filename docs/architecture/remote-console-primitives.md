# Remote console ownership prerequisites

This records the chronological 0.19 private transport proof, protocol-25
ownership/schema foundation and subsequent public integration. The private
proof and schema foundation alone did not enable a Remote terminal API or
qualify complete public recovery. The complete **0.19.0-alpha.1** slice is
now independently qualified through installed SDK and actual packaged app;
see [the operational contract](remote-user-consoles.md) and
[immutable artifact identities](https://github.com/mbianchidev/moguri/blob/main/docs/setup.md#preserved-qualified-0190-alpha1-checkpoint).
Earlier qualification statements below describe their recorded stage, not
the current delivered capability.
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

## Service and SDK development integration

The current development service now routes explicit Remote console commands
through `RemoteConsoles`, the shared terminal manager and the same SDK.
Remote binding reads happen on the actual host; policy/env/project/root/peer
are rechecked after awaits before broker/PTY admission. Pending owners retain
preparation before remote directory creation, prepared metadata before key/
broker dispatch and exact terminal/original-command intent before a PTY.
Local and Remote owners coexist without sharing keys or endpoints; profile
and per-session console caps still aggregate across envs.

Existing Remote input needs its current allowed env/pinned peer/project
mapping and a freshly authenticated owner attachment, not another model or
core-agent probe after restart. The broker rechecks actual inode identity on
the execution host. Changing env/policy/root blocks new bytes while retained
read/close still use the original boundary. Input accepted before a scope
change remains explicit and is never resent.

Normal stop closes/disposes exact known groups/owners. Explicit preservation
detaches the frontend and restores only the original owner/PTY with a new
input generation. Remote cleanup checks only known remote files; it never
stats/unlinks a Remote endpoint on the controller. A failed stop preserves its
registry/lock and cleanup intent. An exact confirmed-stopped pending owner
can open a fixed cleanup-only SSH connection after the agent runtime closed;
normal new work stays closed. This avoids making a legitimate cleanup retry
depend on reopening agent execution.

The current backend gate passes **11/11 in 9,981.32 ms**, with both type
checks. It includes actual service SIGKILL and missing-key restoration,
preserved restart/no replacement, separate Local/Remote owners, no-model
input/resize/close, policy revocation, original lost command receipts,
failed running/PID publication and unrelated-file/registry-preserving stop
retry. The Local fixture assertion initially compared `/var` to the actual
canonical `/private/var`; the test now checks `realpath`, without changing
the product's root invariant. CLI/TUI/Ghostty boundary UX, further concurrency/
cancellation/lost-input coverage and exact installed/package acceptance
remain required. No qualified 0.19 delivery is implied.

The shared CLI and actual OpenTUI now explicitly open/list/read/close consoles
through `/terminals open` and the existing SDK. Stdin is never a composer
command. Ghostty uses captured Local/Remote env/peer/root and policy to gate
input, not a hard-coded Local label; existing Remote input after restart
does not require a new core-agent probe. New Remote consoles still require a
matching probed helper. UI hide/error/reconnect discards unsent bytes and
keeps original-host reads/close available after an env change.

Four targeted hidden Ghostty workflows pass in **10.3 s**, including actual
Remote open/no-model input, stale queued-byte discard, reopened service
restart/original PIDs/read-only env change and the existing Local reattachment
flows. Compiled CLI stdin and actual OpenTUI pass **2/2 in 2,536.44 ms**.
The crash/concurrency gate passes **5/5 in 6,328.15 ms**: real service SIGKILL
with normal/missing-key/lost-input-ACK modes, one broker under parallel
admission, profile/alias isolation including an unreopened profile, pending
secret-write cancellation and changed authority before broker/PTY dispatch.
Remaining source-wide and exact installed/package qualification is separate;
the latest delivered immutable alpha remains 0.18.0-alpha.2.

The first full source run completed **547 cases**, with 531 passing and 16
core MCP/plan primitive failures. Their intentionally partial worker installs
had no optional console helpers: the new probe incorrectly made those helper
files mandatory for core-agent readiness. Probe metadata now explicitly
reports missing/inaccessible console helpers or an invalid console shell
without disabling an independently qualified core worker. Console admission
still rejects missing/mismatched helpers; no anonymous or Local fallback was
added and no fixture was padded to hide the regression.
The targeted core/console/plan gate then passes **26/26 in 12,410.05 ms**, with
both type checks and a complete build. All **37 hidden desktop workflows
passed in 1.3 min** on the preceding source build. Full source requalification
and exact artifacts remain required.
Local expected-helper checks now compare file digests without choosing or
validating the controller's shell. Only the execution host supplies a new
Remote console shell, and existing owner recovery/cleanup depends on retained
helper bytes, not a changed default shell. The refreshed **24/24
console/core-MCP/plan cases pass in 12,530.99 ms**, including a deliberately
invalid Local shell with valid Remote admission. Console unavailability
remains explicit and cannot authorize a fallback.

The corrected full source gate passes **548/548 in 416.23 s**, both type
checks/build, zero-vulnerability source audit and **37/37 hidden source
desktop workflows in 1.3 min**. The exact SDK then passes a fresh
approved/rebuilt install, zero-vulnerability consumer audit, all four
external types and actual installed Local/Remote owner/input/restart/
CLI/TUI/no-replay/cleanup. All **37 actual packaged workflows pass in
1.4 min**, with bundled Node/SSH Remote console original-owner/PID restart
and ordinary stop verified independently. Local one/four-console RSS remains
below the original Electron-only 600-MiB budget; combined runtime and user
programs are reported separately in setup. All earlier artifacts stay frozen.

## Public acceptance contract

Advertising Remote user consoles requires the authoritative service/SDK's
versioned immutable pinned-peer/owner/root/launch identities and a
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
