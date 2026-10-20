# Phase 0 validation

Measured 2026-10-18 on macOS 26.6, Apple silicon, Node 26.12.0.
Reproduce with `npm ci` and `npm run spike`. All fixtures are generated.
The script fails on a regression in an executable spike; explicitly unavailable
release prerequisites are reported separately as FAIL and remain blockers.
These are the initial checkpoint measurements. The later user-requested
[SDK platform slice](sdk-platform.md) records its separate capability, package
and recovery evidence; initial unsupported services are not silently promoted
to release-ready.
The [0.6 engagement slice](engagement.md#local-qualification) records later
OAuth, project-free scope, reviewed metachat, attention and actual-bundle checks
without replacing these historical baseline measurements.
The later [profile checkpoint](profiles.md) records the qualified protocol-14
scope/upgrade/client/package behavior. The separate
[decision-provider prerequisite](decision-primitives.md) records generated
wire/failure measurements and the missing output-limit constraint; it does not
promote routing or automated decisions to operational.

Initial budgets were set before the run: SQLite append p95 below 20 ms; bounded
2,000-file listing below 500 ms and Git status below 1 s; Electron shell ready
below 3 s, aggregate working set below 600 MiB and scroll frame below 40 ms.
These are development-spike budgets, not product performance claims.

| Required spike | Result | Evidence and limits |
| --- | --- | --- |
| Providers | PASS fixtures; FAIL live services | The real maintained pi-ai Copilot OAuth adapter performed device authorization, token exchange, account-filtered discovery, streaming and cancellation against six intercepted HTTP requests. Cancellation: 32.8 ms. No personal credentials, paid inference, live entitlement check or ds4 endpoint was used. |
| Supervisor | PASS macOS baseline; FAIL Rust/Linux | An actual PTY ran a shell and nested `sleep`; group cancellation took 153.5 ms with zero surviving children. `node-pty` 1.1.0 ships a non-executable macOS helper; the checked-in preparation script restores its executable bits. Rust and Linux were unavailable. |
| Event store | PASS | 1,000 separately committed SQLite WAL/FULL appends: p95 0.061 ms. Rebuild: 0.489 ms. Killing a writer with an open transaction retained exactly the 1,000 committed events. |
| Desktop | PASS shell and initial client | Electron 44.9.0, hidden isolated window, 10,000 generated timeline rows: ready in 165 ms after process startup, aggregate working set 445.9 MiB, 30 scroll frames averaging 8.22 ms. Hidden app tests also cover onboarding, shared drafts, tool approvals, cancellation and restart against generated provider responses. |
| TUI | PASS | OpenTUI/React 0.6.6 on Node 26.12.0 rendered 60 updates, averaging 17.97 ms per update. Test rendering must synchronize React commits before flushing the native scene. Node reports experimental FFI; Bun is not required. |
| Native addon | FAIL comparison; PASS bounded baseline | No Rust toolchain. Async Node listing: 0.934 ms; system Git status: 5.63 ms for 2,000 generated files. This does not establish performance on a large real repository. |
| Packaging | PASS development; FAIL release prerequisites | A 269 MiB ad-hoc-signed arm64 DMG and 224 MiB ZIP were built. Verified the bundle signature, DMG checksum, pinned Node, native TUI entrypoint, isolated compiled service and the actual packaged Electron/worker workflow. No signing/notarization identity or Linux execution host was available. |
| Native SendBox | FAIL unavailable | No installed CLI or digest-pinned guest image. Sandbox admission must be disabled. |
| kupo | FAIL unavailable | No approved/evaluated multi-model pool or classifier. No routing quality, cost, isolation or wind-down claims. |
| System One and approvals | PASS human approvals; FAIL live adapter/delegation | Exact-argument human approval, denial races and policy invalidation use the shared service. No decision provider or automated delegation is configured or evaluated. |
| Remote SSH | FAIL unavailable | No user-configured SSH host; none was scanned or inferred. Remote admission must be disabled. |
| Composer/defaults/budgets | FAIL complete contract | The checkpoint implements factory defaults and explicit project-text snapshots only. Other attachments, inherited preferences and finite budgets remain unavailable rather than weakening their contracts. |

## Decisions before feature work

Use the narrower initial checkpoint recorded in `decisions.md`, not the complete
first-milestone label. Node/PTY is a measured, explicit temporary D06 exception.
No failed backend may be offered as operational.

Use maintained `@earendil-works/pi-ai` 1.3.0 rather than its deprecated predecessor.
The initial dependency selection exposed 13 audit findings; replacing the
deprecated provider and packaging dependency chains reduced the audit to zero.
Only required, pinned native installation scripts are allowed. Unused Google,
protobuf and filesystem-watcher lifecycle scripts are denied.

## Copilot access boundary

Moguri uses pi-ai's existing device flow, never a scraped IDE token, personal
access token masquerading as a subscription, or an OpenCode fork. Credentials
belong in Moguri's profile-scoped OS keyring. Logging in requires the user's
GitHub authorization and account entitlement; no automated test establishes it.
The upstream flow may enable account models requiring a policy update, which
must be disclosed before sign-in.

[GitHub's OpenCode announcement](https://github.blog/changelog/2026-01-16-github-copilot-now-supports-opencode/)
describes a formal partnership specific to OpenCode. It does not establish
official support for Moguri. The
[current Copilot terms](https://docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features#github-copilot)
refer users to their applicable consumer, enterprise or Microsoft terms.
Moguri must not advertise official partner status, guarantee subscription
compatibility, bypass account policy, or treat catalog estimates as billed usage.

## Packaged checkpoint evidence

The clean-install and final runs passed 23 unit/integration/native-TUI checks, the hidden
Electron workflow, type checks, builds and dependency audit. The same Electron
workflow then passed against the ad-hoc app, loading its compiled worker and
production dependencies. The packaged service check uses an injected generated
provider with no models, so it never reads a personal keychain entry or makes a
provider call.

The first packaging attempt revealed that current Packager defaults to ASAR:
standalone Node cannot execute those virtual paths. The decision was updated
before proceeding; development packaging now explicitly uses unpacked app
files. `scripts/verify-package.mjs` guards against recurrence. This establishes
development artifact functionality, not notarization or complete release scope.

Process-group cancellation is also a limited result: detached/reparented
descendants are not fully verifiable with the temporary supervisor. Cancelled
or timed-out shell tools conservatively settle partial and pause further work,
even when the measured known group has zero survivors.
