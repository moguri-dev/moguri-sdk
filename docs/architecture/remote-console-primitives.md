# Remote console ownership prerequisites

The 0.19 development source privately tests Remote user-console transport.
The current qualified delivery remains immutable **0.18.0-alpha.2 /
protocol 24**. This proof does not enable a Remote terminal API, migrate its
durable ownership schema or qualify complete public recovery.
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
