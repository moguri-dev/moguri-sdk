# Local skill admission and per-turn rewind

## Change contract

Baseline: merged main `b1612e12ef8881b619ce678404f2c073bddc9435`, genuine
protocol97. This work reuses the service, SDK, encrypted append-only store,
canonical file guards, root writer leases, complete-source script review,
all-role accounting and existing React/OpenTUI clients. Node26 filesystem and
crypto, TypeBox, YAML, semver, React and the existing archive reader retain
their existing MIT licenses; system Git remains GPL-2.0-only. No new dependency,
provider, authentication service, agent framework or model-owned approval is
introduced.

The guidance is **OWASP Agentic Skills Top 10**, revision
`d6f7d7d0de314f52a83a85d1828e06ab096e595c` (2026-08-12 16:27:33 UTC),
rechecked against the upstream repository on 2026-11-09. Its checklist and
universal-format proposal are guidance, not a certification or permission
schema that Moguri silently translates.

New versioned events retain exact skill reviews, actual-user admissions and
revocations, consumed-source provenance, before-turn checkpoints, terminal
boundaries and reviewed rewind intents/results. The additive migration must
preserve the actual95 My Work, actual96 background-service and actual97 OTLP
markers, original ciphertext, owners and accounting. Earlier turns have no
invented filesystem checkpoint.

## Prerequisites

Before feature integration, `npm ci` restored the missing native dependency;
the install audit reported zero vulnerabilities. The generated macOS arm64
Phase0 run passed provider/streaming (1,101.01 ms; cancellation 30.79 ms),
SQLite (62.46 ms; append p95 0.049 ms; rebuild 0.580 ms), PTY cancellation
(151.13 ms; zero known survivors), OpenTUI (17.40 ms/update), hidden Electron
(199.72 ms startup; 447.81 MiB; 8.05 ms scroll) and generated search/Git
(0.802/5.800 ms).

The separate retention/Ghostty spike passed 500 events and 250 independent
artifacts in 166.09 ms, and real hidden Ghostty WASM in 24.80 ms. The
model-control spike passed actual supported/ignored effort forwarding and
complete context sizing in 68.03 ms. These are generated primitives, not
personal authorization, live entitlement or physical native qualification.
The foundation script's static unavailable live/Rust/Linux/release/native
markers remain failed/unqualified; its exit status is not blanket acceptance.

## Required invariants

Skill discovery is not admission. A review names complete immutable source
bytes, version, supported dependencies, source identity and the exact
profile/session/workspace/policy. A repository label or hash is not publisher
identity. User-pinned signing keys and explicitly acknowledged unverified Local
sources must remain distinguishable. Required missing, changed, expired or
revoked evidence blocks use. Metadata, manifests, scanners and model verdicts
never grant tools, credentials, authentication, user answers or policy changes.
Unsupported authority-bearing and foreign compatibility declarations fail
explicitly. Complete inspection never means a prefix or omitted dependency.

Local skill restrictions intersect the current service policy; they cannot
broaden it. Revocation prevents future model consumption and future effects,
including races, but cannot retract instructions already delivered or undo
effects already running. A rewind does not recreate admission grants.
Reviewed script execution remains separately permissioned and Local-only.
**Sandbox reviewed-script execution is still unqualified.** Neither a general
native-worker receipt nor this change enables it; Remote remains unsupported.
Issue45 must remain open while those and other full-category gates remain.

Every newly admitted ordinary or control turn needs a versioned before-turn
checkpoint and its actual terminal boundary, including failed/stopped/partial
work. Capture failures retain explicit availability diagnostics. Checkpoints
bind exact event sequence, context, profile, session, turn and workspace.
No historical snapshot is reconstructed from today's files.

Rewind requires a target-bound preview and actual-user confirmation. Current
owned work must settle and the actual writer boundary must be available.
Conflicting external bytes require explicit per-file decisions. Preserve
unrelated files, current Git HEAD/index, protected paths, other sessions,
independent artifacts and later append-only history. Never use a destructive
reset, restore expired approvals, weaken current policy, replay tools/model
calls, erase costs, refund usage or release another owner's capacity.
Remote effects (push, merge, deployment, external MCP) are never undone.
Unsupported Env/root restoration must fail without a different-root fallback.

## Qualification requirements

Generated tests cover malformed/malicious metadata, exact source/version/key
bindings, dependencies, limits, stale/revoked evidence, authority races,
cancellation and restart. Rewind evidence must include all turn outcomes,
dirty/staged/untracked intent, external and concurrent writers, stale previews,
failed cancellation, capture/restore persistence failures, partial effects,
restart/no-replay, repeat requests, migration and encrypted retention/deletion.
Shared SDK, CLI/TUI and hidden desktop flows plus a separately packed consumer
must exercise the real authority, not client-only simulations.

Final executable behavior, supported scope, measurements and exact artifact
identities are recorded here as integration is qualified. Earlier receipts
remain predecessor evidence, never proof of changed payloads.
