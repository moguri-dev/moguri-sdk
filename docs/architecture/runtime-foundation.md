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
