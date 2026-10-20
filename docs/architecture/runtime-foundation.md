# Runtime and model foundation

This extends the original SDK/service, not a second agent runtime. The current
gap inventory includes already implemented Ghostty, diff/browser/side panels,
plan snapshots, issue/PR context, deletion and archived retention controls.
Their existing behavior is preserved while the remaining capabilities are added
in the implementation specification's dependency order.

## Libraries and qualification

Reuse Node, the maintained pi-ai provider APIs (MIT), TypeBox (MIT), the explicit
keychain backend and the existing encrypted append-only SQLite store. Configured
OpenAI-compatible local endpoints use the maintained completions adapter, not a
Moguri-written model transport or an unrelated hosted-provider credential.

`node scripts/runtime-spikes.mjs` passed keyless local streaming, actual tool-call
decoding, reported usage and in-flight cancellation in 40.38 ms against a
generated loopback server. The maintained adapter requires an internal API-key
placeholder; an explicit null Authorization header prevents transmitting that
placeholder or reading ambient credentials. No inference service was scanned
and no model weights were downloaded.

Native SendBox, Apple Containerization, Porto and sql-not-so-lite were absent
from PATH; OpenSSH was installed, but that alone is not remote execution
qualification. The user subsequently authorized prerequisite installation.
SendBox 0.2.0's macOS archive passed checksum and GitHub provenance verification.
Apple Containerization 0.10.0 passed the upstream-pinned SHA-256 and Apple
signature/notarization checks. Administrator authentication remains a user
action in the installation terminal, never a password supplied to the agent.
Actual VM/SSH readiness must be recorded separately from generated fixtures.
Existing Porto workloads must not be stopped or reconfigured.

The user authenticated the pinned installers and started the Apple API server.
A real generated Apple VM ran `GENERATED_APPLE_VM_READY` and removed itself.
SendBox 0.2.0 accepted the deny-first policy and started its signed guest, but
repeatedly failed with `exit_code: 5, guest readiness timed out`; its owned VM
was removed. The generated guest had cgroup v2 and the signed supervisor running,
but no ready broker. This is a real qualification failure, not Sandbox readiness.
No hardening was disabled and no host execution was substituted. The user then
authorized a separate SendBox fix session. Its real VM trace found that PID 1
was intentionally moved into `/sendbox-runtime` for controller delegation,
while mandatory egress incorrectly required `/proc/1/cgroup` to equal `0::/`.
Mount information still proved a writable cgroup2 mount rooted at `/`.
The fix requires a rebuilt guest, not merely a replacement host executable.

A separate candidate guest has been built without cache and signed using
generated qualification-only material. It is not the attested production
release, and the installed production bundle/trust root remains unchanged.
Plain Alpine lacks the required `nft` utility; the child separately confirmed
socket-cgroupv2 support with a locally built digest-pinned Alpine/nftables image.
Three candidate fixes preserve root namespace checks, make empty socket health
probes non-consuming and retry controller delegation against refreshed root
processes on bounded `EBUSY`. The separately user-authenticated R3 development
install passed genuine Apple VM execution: exact generated output and exit 0,
non-root UID, NNP=1, seccomp=2, zero effective capabilities and generated workspace
write/read/delete, followed by empty owned-VM inventory. This is not an attested
release, and does not yet qualify Moguri's image, foreground PTY or worker/model
transport. Production remains untouched. Executable entrypoints must be regular
files: Alpine's symlink `/bin/sh` is correctly rejected by `openat2`.

The separate R3 prefix is `/opt/sendbox-readiness-adc32f48-r3`, host/guest 0.2.0
on aarch64, trust root `readiness-qualification-adc32f48-r3`, bundle sequence 7
(minimum accepted 6); integration qualification pins minimum release sequence 7.
Public candidate identities reported by the coordinated SendBox qualification:

| Artifact | SHA-256 |
| --- | --- |
| Host | `00867c75f9503a06d0c03a92020114a0180c0a3976e6a1f29bf9ada45d20b085` |
| Guest tar | `fd0731f8a4757ac27ae3edc18cc3a6b50301990fe9151d923d85f6dcf3381026` |
| Public key | `cc578a226670ac955e5c4695b557e5d73f3e52f9df62142f751501fef6cee5eb` |
| Manifest | `3d3dec8fa01a4b5c2d3e1faa74966dd86e9a7ef2e157a36f5ccaf53f440a4f02` |

These identities are developer qualification inputs, not a factory trust-root
change. Native Moguri probes must verify the installed bytes and boundary
independently before advertising Sandbox readiness.

### Moguri Node workload qualification

The updated no-cache Linux arm64 image verifies exact protocol-9 worker/bridge
payloads, Node 26.12.0, a regular canonical Node ELF, native node-pty and nftables.
The first Bookworm image (nftables 1.0.6) still timed out in guest readiness.
A pinned Node/Trixie image with the separately qualified nftables generation
1.1.3 advances through authenticated R3 readiness into real workload execution.
This narrows compatibility; it does not prove nft alone caused the earlier
failure.

The Trixie build passed in **32,874.13 ms** with zero npm audit findings.
Its local-only immutable reference is
`docker.io/library/moguri-worker@sha256:4591ec01ac6955440c2c54eaa40427fb64d3884f5f695f8c30e364ce2eff06d1`,
based on verified arm64 Node 26.12.0/Trixie manifest
`sha256:f6e55fb0e92f7f115549278ab36f68f0659790f5d4fd7cb4446486d8ed70d842`.
Worker digest is
`b3ad90fefe5e488ea8521553b63ed0ac9a623cf1043ad79c81847f5515155f63`.
Build tags bind payload/recipe identity; immutable aliases are verified locally
without publishing the image.

**R3 cannot run the normal Node workload.** It aborts with exit 134 at
`node_platform.cc:109`, `uv_thread_create`. A real non-root ctypes/pthread probe
inside the same signed guest reports `pthread_create=EPERM`,
`clone3(NULL,0)=EPERM`, process limit 256, NNP=1, seccomp=2 and no effective
capabilities. Thread compatibility, not image presence or a shell-only pass,
must be qualified before enabling Moguri Sandbox. Do not disable hardening,
allow uninspectable clone3, or call single-threaded Node an equivalent runtime.
The coordinated SendBox repair changed only the two uninspectable clone3-denial
surfaces to ENOSYS so glibc can fall back to the existing flag-filtered clone.
Clone3 remains denied; architecture guards, namespace masks and all other
mandatory controls stay enforced.

`node --import tsx scripts/sendbox-worker-spike.mjs --candidate INSTALLATION.json
--workload IMAGE_QUALIFICATION.json` verifies root-owned candidate hashes and
uses generated private configuration. It requires exact persistent-guest
terminal success and decoded output, then the actual Moguri foreground-PTY
bootstrap. R3 execution failed before that PTY stage. A long generated VM
name also produced Apple `startProcess` EINVAL; bounded names avoided that
failure without changing protections.

Abrupt SIGTERM of a diagnostic host CLI left its owned VM alive. It was stopped
and deleted by exact identity, with empty owned inventory confirmed. The spike
now matches its unique run prefix, trusted bootstrap executable and generated
workspace mount before targeted cleanup. This is not a qualified production
cancellation/restart adapter. No foreign VM, service registration, Porto process
or production trust path was changed.

### R4 normal threading and Moguri bootstrap

The user separately authenticated R4 under
`/opt/sendbox-readiness-adc32f48-r4`. Its native quality gate and genuine Node
26.12.0 worker-thread/create/join tests pass with retained clone3/namespace/
process-control denials. Expected host/guest remain 0.2.0/aarch64, trust root
`readiness-qualification-adc32f48-r4`, release sequence 8/minimum accepted 7;
Moguri qualification pins minimum release sequence 8.

| Artifact | SHA-256 |
| --- | --- |
| Host | `b1cecdc3b9ae472adcf3027c3b23078f3106760729db8de9527b4848fa67663d` |
| Guest tar | `1464bb448205e9a0fd135461324515117cbc284953b2686228f7b9f5995ebab1` |
| Public key | `abf436a098b5c21e4a8d6a16107ce516bd7aa32c370156cb5ff6702991d8579d` |
| Manifest | `3936c30ab7c9d67ebef53eb339704a1e7b555260f635e98fe2156207f9c8592d` |

Moguri independently verified root ownership and exact installed hashes, then
passed actual signed-guest ctypes thread/retained-denial checks, normal Node
worker-thread IPC, non-root/NNP=1/seccomp=2/no-capabilities, generated workspace
write/read/delete and the **real protocol-10 Moguri foreground-PTY bootstrap**
in **3,816.87 ms**. Owned inventory is empty afterward.

The bootstrap-qualified protocol-10 local-only image is
`docker.io/library/moguri-worker@sha256:759564d72938010e79109a223362f6a3f90077ea8226be85502ff1389bc95fdf`;
worker SHA-256 is
`d3755c349096417a4d09cc252f06ab800b3ee1e2487491e6dc514ea55cfe277b`.
Its no-cache build passed in **30,484.22 ms**, including a non-root read check
for its public read-only payload manifest. An earlier 0600 manifest correctly
failed EACCES; only that non-secret image metadata is now 0444, not credentials
or host state.

This remains development-candidate/primitive evidence. Provider turns, scoped
credential forwarding, large input-credit behavior, SDK transport integration
and cancellation/restart still require genuine qualification. No production
trust change, attested release or ready Sandbox capability is claimed.

### Foreground control under enforced egress

Actual R4 tests prove normal detached Node fork/IPC works, but arbitrary direct
loopback TCP times out under deny-first egress. That is intended enforcement,
not permission to open a control port or weaken nftables. The persistent SSH
bridge's loopback supervisor is therefore not a native Sandbox transport.

The owned `--foreground` bridge uses the same bounded private wire and real
Node worker IPC without a TCP daemon, detached supervisor or replay journal.
It preserves only the runtime's exact proxy variables into the worker, never
arbitrary ambient secrets or NODE_OPTIONS. Explicit Node launch flags remain
part of the user-selected command. A terminal outcome is not completed unless
its actual parent acknowledgement arrived; worker exit still does not prove
native VM teardown or descendant containment.

The generated native model-loop fixture uses a clearly labeled in-guest fetch
interceptor with synthetic responses, not a reachable local model endpoint or
a real credential. It cannot establish provider networking/entitlement. A
separate optional credential-free metadata probe permits only
`api.githubcopilot.com` through the signed runtime proxy. All other egress stays
deny-first. Large input, exact tool effects, native cleanup and SDK/controller
integration remain independent gates.

The direct foreground primitive subsequently passed actual worker fork/IPC,
three maintained pi-ai steps with that explicit generated fetch fixture, two
exact approved read/write effects and a generated PNG above 1 MiB through the
real native TTY in **4,806.24 ms**. Exact image bytes/digests and preserved proxy
environment were checked in the guest; owned VM inventory was empty.
Local-only image:
`docker.io/library/moguri-worker@sha256:54be7fc3bb256841b39adaa4f83e8e99f761b7824df18b7bb0c337cba4cb2f8a`.

The separate live metadata-egress gate is still **failed/unqualified**: with
DNS enabled and only `api.githubcopilot.com` allowed, two preceding fresh
thread/Node probes passed, but the next fresh VM timed out before readiness,
before its metadata fetch ran. No later pass rewrites that failed run. The
coordinated native repair is diagnosing it; SDK readiness must not be enabled
from the synthetic model-loop result.

Retained evidence for that exact failed run identifies an Apple 0.10.0
`containerStartProcess` failure (`vmexec error read ack pipe`) for the stdio
relay: it never started, while `containerWait` stayed blocked until timeout
cleanup. This is not evidence of HMAC/byte corruption. Separate readiness
passes do not rewrite the failed run. Later workloads reached Node but their
live fetches failed with CONNECT proxy responses 502/403; Undici's outer
`Request was cancelled` was not proof of an SDK/user cancellation. Networking
remains unqualified. The upstream wait-before-start fix in
[apple/container#1289](https://github.com/apple/container/pull/1289), included
in 0.11.0, does not by itself prove the underlying acknowledgement failure fixed.
No global runtime upgrade or policy relaxation is part of this evidence.
The images above remain historical protocol-10 primitive fixtures, not current
protocol-11 SDK payloads.

SendBox entry allow rules match argv token counts, not shell-style tail globs:
`/bin/sh -c *` matches the three-token generated probe, while `/bin/sh *` does
not. `scripts/sendbox-spike.mjs` preserves failed configuration and reports the
actual exit status rather than converting missing readiness to a skip.

## Model registry and defaults

An explicit registry combines Copilot's independent account state with configured
local endpoints. Model IDs include provider identity; duplicate upstream names
must not select another provider. Endpoint discovery is bounded to explicitly
configured URLs and user-declared model limits. Missing metadata, unreachable
servers, changed configurations and missing credentials are visible states,
not reasons to use another model.

Local secrets use resource-bound keys in the profile's explicit secret backend.
No credential belongs in settings, model input, events or client caches.
Configuration changes invalidate stale dispatch; each request rechecks the
selected model and capability limits. Local models use the same worker, tools,
permissions, queue, cancellation and usage events as Copilot.

Startup controls resolve session overrides over project, profile, global and
factory preferences. The admitted complete values and their sources are
snapshotted into the session. Later preference changes never rewrite an existing
session, and preferences cannot widen environment or permission policy.

Protocol/database migrations preserve prior identities, ciphertext grants,
receipts and defaults. Generated tests must cover stale discovery, cancellation,
credential errors, same-named models, default precedence, restart and external
SDK consumers. Client surfaces consume the registry and resolution APIs rather
than implementing their own model or preference store.

## Execution boundaries

Sandbox must launch the actual worker and model/tool work through the supported
SendBox CLI and an attested, digest-pinned workload. An unqualified host remains
blocked, never silently Local. Remote must execute worker and model calls on the
verified SSH machine, with no implicit host or private-key forwarding. A genuine
owned test guest may qualify those paths; a fake SSH executable cannot establish
real remote containment.

Every transport must preserve exact request ownership, acknowledgement,
cancellation and partial outcomes. Restart cannot replay tools or assume that a
disconnected CLI proves descendant cleanup. Strong containment belongs to a
qualified VM/cgroup boundary, not to a renamed host process group.

Packed-consumer qualification reproduced a macOS PTY teardown race: one of
three generated groups returned `EPERM` to signal-0 immediately after accepted
TERM, then `ESRCH` after exit. Group supervision now keeps permission denial
unconfirmed and polls within its existing bounded TERM/KILL grace; only actual
`ESRCH` proves group absence. Persistent denial remains partial/unconfirmed,
unexpected OS errors propagate, and invalid group IDs are rejected before any
signal. This fixes the observed teardown race, not detached-descendant
containment or restart reattachment.
