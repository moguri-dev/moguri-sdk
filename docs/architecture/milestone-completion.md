# First-milestone completion

This work starts from merged `04591cf43417bacc1db3830a207978f410314aff`,
protocol 91. The packaged startup/restart repair and repository-management
changes are already included. The acceptance criteria in
[`implementation.md`](../implementation.md#milestone-acceptance-criteria)
remain authoritative; this document does not declare the milestone complete.

## Scope and authority

The user requested missing first-milestone features end to end and explicitly
selected reviewed candidate staging, project tests and application on Local,
Remote and Sandbox. Ordinary response orchestration and reviewed repository
candidates are distinct workflows. Neither model output nor passing tests
accepts source changes.

The earlier actual-user native checkpoint decision remains unchanged: native
source publication requires its own acceptance, followed by separately reviewed
Local Git at the original repository. Sandbox-only policy still blocks that
Local Git action. This is not a native Git fallback.

Reuse the existing service, worker, SDK, append-only encrypted event store,
profile/root writer leases, all-role budget ledger and authenticated transports.
Node, React, OpenTUI, TypeBox and maintained pi-ai retain their existing MIT
licenses. SendBox is Apache-2.0 and system Git is GPL-2.0-only. No new model
framework, scheduler, secret store or permission authority is introduced.

Runtime readiness is separate from endpoint availability. Bounded metadata
inspection must distinguish observed runtime/hardware facts, supplied model
requirements, estimates and unknowns. It must not scan hosts, run inference,
start a server, download weights or change provider selection. Reports bind
the actual profile, endpoint/model, execution root, peer/build and freshness.
Another machine's RAM or a reachable `/models` response is not capacity proof.

Transport additions require exact source/stage identity, immutable bases and
retained intent before effects. Remote operations execute on the pinned SSH
peer. Native executable tests remain inside the qualified guest. Cancellation,
failed acknowledgement, receipt failure and restart preserve unknown or partial
work without replay. Existing Local candidate records and private snapshots
keep their original meaning.

Required API and durable additions use new, independent migration markers.
Protocol 92 adds `model_runtime_readiness_schema`, `kupo_options_schema` and
`candidate_transports_schema`, each version 1, in one genuine-91 transaction.
Missing, corrupt or prematurely retained markers fail closed; actual newer
runtime requirements, pooled controls and transport candidates cannot be
relabelled as older history.
`model.runtime_executable_reviewed` records an exact actual-user runtime/byte
review and `model.runtime_review_consumed` consumes it before I/O, independently
from ephemeral hardware reports. `candidate.workspace_recorded` preserves
independent resources; `candidate.transport_recorded` preserves original launch,
authenticated frame/receipt, stop and cleanup ownership. V2 candidate exports
use format11 with those original transport results, not a reinterpretation of
Local v1 documents. Unloaded-profile leases and every artifact/project deletion
surface retain unresolved candidate ownership.
Migration rollback/reopen must preserve existing ciphertext, identities,
grants, command receipts and unknown budget holds. All clients import the same
SDK; the browser and React entrypoints remain runtime-free. Installed packed
consumers must exercise the actual new APIs, not source imports alone.

## Phase 0, 2026-11-05

The initial prerequisite command failed because this worktree had no
`node-pty` installation. Locked `npm ci` restored 454 packages and reported
zero vulnerabilities. The repeated spike used pinned Node 26.12.0 and
generated fixtures, without personal accounts, microphone or model weights.

| Primitive | Result | Measurement |
| --- | --- | --- |
| Provider streaming and cancellation | PASS | Six intercepted requests; cancellation 31.72 ms |
| SQLite WAL and crash rollback | PASS | 1,000 events; append p95 0.0716 ms; rebuild 0.765 ms |
| Owned macOS PTY groups | PASS | Cancellation 152.17 ms; zero observed known survivors |
| Actual OpenTUI updates | PASS | 60 updates; mean 17.22 ms |
| Hidden Electron | PASS | Cold start 292.89 ms; 450.02 MiB; scroll 8.15 ms/frame |
| Generated filesystem/Git | PASS | 2,000 files; search 1.07 ms; Git status 8.96 ms |
| Supported model controls | PASS | Three generated actual provider transports; 89.15 ms; ignored effort stays explicitly unavailable |
| Local-model transport | PASS | Two generated requests, keyless tools/usage/cancellation; 60.96 ms |
| Pinned loopback SSH primitive | PASS | One worker-originating request; 186.86 ms; wrong host key rejected before another request |

The generic spike's historical live-provider, Rust/Linux, signing/notarization,
native-worker, model-quality and external-SSH rows remain unavailable. They
are not new physical probes of installed SendBox or qualification of changed
worker bytes. Exact native image/control/network/cleanup evidence and public
distribution decisions remain separate gates.
The separate runtime spike observes healthy `sendbox`, `container`, `ssh`,
`porto` and `sqnsl` executables. Presence/version responses do not establish
guest containment, current workload qualification, external-host readiness
or model hardware capacity. No daemon or personal service was restarted.

The merged baseline also records a concrete native prerequisite failure:
the pinned SendBox egress gateway can lose Meta DNS replies before workload
readiness. Its separately reviewed upstream repair is not yet a released
Moguri dependency. See the [current native verification
record](managed-sandbox.md#current-verification-and-unresolved-native-startup).
Do not merge/release another repository, weaken network controls, restart
personal runtimes or qualify an unreleased guest to conceal this blocker.

## Required final evidence

Generated tests must cover supported and unavailable runtime/model metadata,
all required model/autonomy/budget/context combinations, exact source/stage
reviews, rejected candidate preservation, wrong profile/peer/root/build,
concurrent controls and leases, cancellation failure, late accounting,
storage/receipt failure and real restart without replay.

Finish with current source/type checks, actual TUI and hidden desktop paths,
an independently installed SDK consumer and packaged entrypoint checks.
Report every failed or unavailable native/platform gate separately. No old
receipt, passing model verdict, package version or test total substitutes for
final first-milestone acceptance.
