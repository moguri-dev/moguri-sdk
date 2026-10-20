# Owned execution transports

This contract extends the existing worker loop, not a second agent framework.
Reuse Node/Node-PTY (MIT), OpenSSH (BSD), pi-ai (MIT), the explicit keychain
backend and the encrypted append-only event store. SSH is transport and host
separation, not SendBox process isolation.

## Qualification before capability

An owned rootless loopback OpenSSH server passed strict generated host-key
verification and a real worker-originated HTTP request in 175.94 ms. A changed
host key prevented execution before another request. The server used generated
keys, loopback-only listening and no system service changes. This proves that
primitive on macOS, not Linux support, a complete worker transport or an external
host's readiness. `node scripts/remote-spike.mjs` repeats it.

The actual existing worker now passes SSH inference, exact read/write approvals,
remote instructions, scoped remote-local discovery, image transfer and
project-free null-root execution. A deterministic lost-completion connection
retains reported usage for reconciliation without another inference; a genuine
control-plane SIGKILL/restart preserves its run/key/cursor and never starts a
replacement. Initial native end-to-end worker qualification completed in
1,377.74 ms; the refreshed SSH primitive completed in 131.59 ms. Generated hidden
Electron drives actual setup, explicit project mapping, model-preserving env
selection and execution through the compiled transport.

This qualifies the macOS core agent path, not Linux release readiness or live
Copilot entitlement. Embedded Remote consoles, executable MCP transport,
repository-memory retrieval and diff/plan panels remain blocked. Explicit
client-side browser URLs do not create an implicit remote-port tunnel.

## Authority and identities

Remote requires an explicitly configured SSH host, pinned public host key,
selected local identity and installed compatible Moguri worker command.
Private keys and the local secret store are never copied or forwarded.
Each project supplies its own approved canonical remote path; null-project
chats retain no filesystem root. Model metadata and inference for remote-local
endpoints originate on that host. Scoped Copilot access requires a separate
explicit grant and sends only per-request access, never a refresh credential.

An owned remote supervisor forks the existing worker over real Node IPC.
Versioned bounded frames cross SSH; they are not a replacement `process.send`
implemented by mutating Node. The controller remains the only event writer and
authorizer. Tool policy is rechecked locally and filesystem policy at the actual
worker root. Unqualified MCP/extension/terminal transports remain blocked rather
than executing on the local host.

## Shared pinned-root writer ownership

Writable Remote turns share a root lease across profiles, keyed by the pinned
SSH public host key and the explicit canonical remote workspace. Local
project IDs, profile IDs, target display names/IDs and connection aliases are
not physical ownership boundaries. The active lease uses the execution's
captured peer/root, not later editable project/target settings. Distinct remote
roots remain independent; project-free Remote chats acquire no fake root.

The previous Local-only cross-profile lookup let two distinct Local project
mappings dispatch writers to the same Remote root. A generated two-profile
real-SSH regression reproduced `running` where the second turn had to remain
queued. The corrected root authority checks actual captured Remote leases
before dispatch and derives quarantine from retained execution metadata,
including unloaded profiles after restart. Another profile's resume or
readiness probe cannot clear that quarantine; the actual owner's explicit
inspection/resume is required. Same-profile duplicate remote mappings remain
rejected rather than silently creating competing writers.

A requested read-only restriction does not release an effective writer early.
An acknowledged read-only boundary releases its lease and wakes other
controllers even while the original read-only turn continues. Promotion uses
the actual acquisition reservation, not a pending mode label that could make
two readers falsely claim the same writer lease.

This reuses Node crypto and existing execution/mode/blocked events; no new
durable shape, account backend, migration or client-specific state is added.
Generated coverage exercises actual SSH models, aliases, same-profile
refusal, independent roots, delayed mode acknowledgement and unloaded-profile
restart quarantine. It does not infer that distinct/rekeyed host keys identify
the same OS filesystem, discover Local/Remote aliasing or establish SSH
process isolation. Unqualified remote side panels remain blocked.

The corrected source gate passes **262** full local checks in **176,325.91
ms**. Seven focused peer/root cases cover the reproduced cross-profile race,
existing same-profile refusal, independent roots, unloaded-owner restart
quarantine and both sides of actual read-only acknowledgement. The temporary
lifecycle-only handle probe was removed; no native VM, personal credential,
system SSH daemon change or new containment claim was involved.
The versioned **0.9.1-alpha.1** development app then passes all **20** actual
packaged hidden workflows in **45.2 s**, strict runtime/assets/signature and
DMG integrity. A fresh audited installation of the exact delivered SDK passes
its compiled runtime and existing profile/Guided/model/platform exchanges.
The seven peer/root scenarios above are actual generated SSH integration,
not simulated native VM evidence. Setup records hashes and historical limits.

## Failure and recovery

Run IDs are unique and start is create-only. Reattachment never creates another
worker or replays a side effect. Run-scoped transport keys live in the explicit
local secret backend and remote supervisor memory. Private remote replay frames
are encrypted; credential-bearing controller replies are never journaled.
Acknowledged frames can be removed only after the local durable writer records
them. Cursors bind run, sequence and digest atomically with their primary events.

Disconnect requests owned cancellation, but does not prove remote cleanup.
Model/tool outcomes, cancellation request/acknowledgement, uncertain descendants
and late accounting stay distinct. Recovery reconciles an existing run without
admitting new work or supplying new model access. Late usage can improve an
unknown ledger entry without rewriting a partial turn as successful.

The persistent bridge closes only after the actual final durable cursor drains,
not after an assumed 30ms delay. Final status/journal writes share the control
queue, so closing cannot race a late acknowledgement's filesystem writes.
Actual worker exit confirms only `owned-worker-stopped`; it does not invent an
acknowledged successful outcome or descendant containment. Generated coverage
holds the terminal cursor deliberately and exercises genuine control-plane
SIGKILL recovery.

Protocol/database migration 8 adds transport configuration, run identities,
frame receipts and late-usage events without rewriting prior event identities
or encrypted grants. Generated acceptance must cover actual SSH worker/model
execution, host-key/auth failure, exact workspace and attachment transfer,
configuration races, duplicate frames, reconnect, disconnect cancellation,
late usage, restart and no Local fallback. A capability becomes ready only
after the installed worker/runtime and target pass those checks.

## Linux payload preparation

`node scripts/prepare-worker-image.mjs --build` prepares an isolated context
containing only the dependency manifests and built worker/MCP/bridge modules,
not the checkout, host home, credentials or model weights. Apple Containerization
builds it without cache from Node 26.12.0/Trixie's pinned Linux arm64 manifest
`sha256:f6e55fb0e92f7f115549278ab36f68f0659790f5d4fd7cb4446486d8ed70d842`.
The upstream Docker Hub tag API supplied that platform digest before work.
The original Bookworm digest/build measurements below are historical
prerequisites, not the current compatible native workload.

The image reuses Node (MIT), existing locked runtime dependencies, Node-PTY
(MIT), system nftables and the build toolchain. Other dependency lifecycle
scripts stay disabled; only the explicitly pinned Node-PTY native rebuild runs.
The image verifies every staged payload digest, Node version and a generated
Linux PTY primitive before success. It runs as the image's unprivileged node
user and never publishes an image.

This prepares a workload prerequisite, not a ready Sandbox or a proof of
Linux-host cancellation, guest policy, model networking or containment.
Authenticated candidate guest installation remains a separate user action.

The initial no-cache build failed after 6,848.36 ms because Apple's newly
installed builder defaults to Rosetta while Rosetta is absent. No workload
success or Sandbox readiness was claimed. Native ARM preparation uses the
supported `build.rosetta=false` property rather than installing translation,
changing guest trust or modifying unrelated Porto workloads.

`node scripts/pty-worker-spike.mjs` separately tests a generated bounded ASCII
frame over an owned raw host PTY, with delayed-reader backpressure and echo
checks. SendBox's documented interactive channel requires a controlling
foreground PTY and cannot use `--json`; its own authenticated input-credit
behavior still needs genuine guest qualification, not inference from this
host-only primitive.

After selecting native ARM mode, the no-cache workload build passed in
40,351.79 ms: Node 26.12.0, all staged hashes, a compiled Linux Node-PTY and
zero npm audit findings. Its initial manifest is
`sha256:4b2e8c1cfe35d0e1b06c62e7d4bd3a352c6e09af5f2b0ea28b28a814f4b25f30`.
Apple's image store requires an explicit immutable local repository alias;
without it a differently qualified name attempts a registry pull. Preparation
now registers and verifies that alias instead of assuming tag normalization.
The parent-owned builder was stopped after this check.

The raw host PTY primitive passed 1,398,104 generated payload bytes in
374.86 ms with a delayed reader and no input echo. The private worker frontend
can negotiate the same bounded prefixed encoding on an owned TTY while keeping
ordinary SSH pipes on their existing JSON protocol. This does not enable
Sandbox or substitute host-only checks for the candidate's genuine guest gate.

## Native foreground primitive

SendBox is reused as its maintained Apache-2.0 CLI, not reimplemented or
described as a process group. The separately installed development R4 bundle,
public key, version pair, trust-root ID, release sequence and host ownership/
hashes remain explicit; they do not replace production trust.

Signed egress intentionally blocks direct loopback TCP. Native control therefore
uses the same bounded private wire with an owned foreground process and real
Node fork/IPC, not the SSH loopback daemon. The runtime's exact proxy environment
is preserved into the worker; arbitrary ambient secrets and NODE_OPTIONS are
not. Actual worker/provider-step/tool/large-image gates use synthetic fetch
responses and are labeled as such; live proxy/networking is a separate gate.

## Native SDK contract being qualified

### Live mounts and failure rollback

The separately qualified R5 runtime live-binds its selected workspace. It does
not wait for exit 0 to copy files back. Its common security wrapper regards only
`GuestTerminal::Exited { code: 0 }` as successful. Normal non-success finalization
captures an after-snapshot/diff, then restores the pre-run tree by swapping the
host workspace directory. Newly created files disappear and baseline files
return. A later security-finalization failure can also roll back guest exit 0.
This applies equally to awaited direct writes and same-filesystem atomic
rename; `fsync` is not a way to bypass the rollback policy.

These semantics are explicit in the retained SendBox revision
`f2d8770ba3e9b5c95cdfa7eca0fe0d20f7279d39`:
`crates/sendbox-host/src/lib.rs:223-246`,
`crates/sendbox-host/src/security.rs:448-499`,
`crates/sendbox-session-security/src/lifecycle.rs:617-684` and
`crates/sendbox-security/src/snapshot.rs:475-545`.

Therefore a native SDK execution must not hand a concurrently editable user
checkout to automatic security rollback. It needs a private Moguri-owned
staging root and captured source/base identity. Retain failed/stopped
after-snapshot provenance and pending changes separately; apply only an accepted
change set after rechecking the exact host base, current policy and required
human decision. Rollback of the private root must never erase a concurrent user
edit in the source checkout. Every client must identify staged versus actually
published effects through the SDK rather than assuming a completed guest
`write_file` survived teardown.

Do not force a stopped/partial worker to exit 0 merely to retain its files.
Keep actual worker, CLI, snapshot, publication and cleanup outcomes distinct.
Generated acceptance must include stop/nonzero rollback, retained after-state,
publication failure, changed host base and concurrent source edits, alongside
the model/control/VM gates below.

### Current protocol-16 R5 prerequisite

The separate user-authenticated R5 prefix is
`/opt/sendbox-readiness-adc32f48-r5`, host/guest 0.2.0/aarch64,
trust root `readiness-qualification-adc32f48-r5`, caller minimum sequence 9
(bundle sequence 9/minimum accepted 8). Moguri independently verified regular
canonical root-owned installed host/key/manifest hashes and non-writable modes.
Production trust, guest controls and Apple's service were not changed.

| R5 candidate artifact | SHA-256 |
| --- | --- |
| Host | `b1cecdc3b9ae472adcf3027c3b23078f3106760729db8de9527b4848fa67663d` |
| Guest tar, reported by the coordinated installer | `47512860170186ec6fe4a5f5059b6f456851e43fe5ca75b4f116cd77ba913948` |
| Public key | `9834a580e8997500e446525776a6f28fdba8aee774b107a501258e46a844aa4f` |
| Manifest | `030b950048469331adfe40865301765e9c9f9f20431c9c46ca5f1a4e41d3cee3` |

A fresh no-cache arm64 image passed in **33,482.15 ms**, with locked
dependencies, zero npm audit findings, native PTY and all current payload
hashes verified. Its local-only immutable reference is
`docker.io/library/moguri-worker@sha256:0a0a9eb33a894ee34ec5c31d33465a859ce2bec84f868f75d9e65cace0fd5825`;
protocol 16 worker SHA-256 is
`9190c0d469413924acb65ea90626739e12fd6c9666c89f731c7e8b04e9fb3b0b`.
The parent-owned builder was stopped afterward.

The current payload passed genuine R5 normal Node/thread/workspace and
foreground worker primitives in **4,832.06 ms**: three explicitly generated
pi-ai responses, two exact approved read/write tools, a **3,151,914-byte**
generated image and a **4,202,798-byte** start frame. All owned VMs were removed.
The refreshed atomic-proof fixture separately passed its normal run in
**5,248.49 ms**. Neither run uses a real provider response or egress.

The first model-stop harness run observed a pending model delta, requested and
acknowledged stop, `aborted`/unreported model completion, a stopped worker and
CLI 130 in **289.63 ms**. The command-stop run observed an actual approved
process, acknowledged stop, conservative partial tool/turn outcome and CLI 2
in **1,309.35 ms**. Both had empty independently checked generated-prefix VM
inventory. Their overall harness gates remain failed pending verification of
retained after-snapshot proof: the initial assertion incorrectly expected a
new file to remain in the host workspace after normal failure rollback.
Missing live-path proof alone does not establish that the guest never wrote it.

Networking remains a separate failed/unqualified gate. An api-only deny-first
R5 fetch retained CONNECT 502 and explicit CONNECT 403; these are not evidence
of user cancellation. Fresh public DNS still shows the unapproved exact alias
`glb-db52c2cf8be544.github.com` for `api.githubcopilot.com`, but no retained guest
audit proves it is the sole cause. The user's domain-consent question returned
automatic unavailability, not either offered choice, so no domain, wildcard,
IP or production-policy extension was made. Offline cancellation work does not
enable Sandbox/API readiness.

### Owned SDK execution requirements

The control plane must record an owned native execution before CLI effects:
profile/session/turn, immutable configuration signature, pinned image/worker,
actual host/guest mount mapping, trust metadata, unique runtime prefix and
eventual CLI/worker/VM identities. The same SDK serves both clients. No selected
configuration or executable-presence check makes Sandbox ready.

User-provided policy is bounded/validated, and cannot implicitly forward Git,
SSH, IDE, refresh or unrelated secret-store credentials. Copilot delegation is
separate and explicit; only per-request access crosses the authenticated raw
channel. Prepared model metadata/inference and repository instruction reads
must originate in the guest. Unqualified model/extension/console/panel surfaces
remain blocked, not run against a same-named host root.

Native frame sequence/digest receipts commit atomically with their primary
events. A worker terminal report is only a report: acknowledge it durably, then
wait for actual owned VM teardown before recording a successful turn. Stopped,
failed, partially cancelled and cleanup-unconfirmed outcomes remain distinct.
Unknown model usage never becomes zero. No credential-bearing reply is logged.

Stop propagates through owned work and private queries. Host CLI termination
does not prove teardown. Inspect only the exact persisted runtime prefix,
verified bootstrap executable and approved mount/image, then stop/delete only
that VM. Never kill a stale/reused host PID or foreign Apple/Porto workload.
Restart marks interrupted work partial and inspects/cleans existing owned
resources without launching another worker, replaying a tool or promoting a
late model result into success.

Durable native execution/report/frame events require migration and recovery
coverage. Generated acceptance must include genuine SDK/CLI/TUI/Electron
execution, private provider access, root mapping, input-credit/backpressure,
concurrent runs, configuration/approval races, cancellation failure and actual
control-plane loss. A failing live gate remains a failure, not a skip or a
reason to weaken guest controls.
