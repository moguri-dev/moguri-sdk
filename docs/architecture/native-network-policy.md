# Native operations and scoped website approvals

Ordinary native file reads, searches, queries and edits run without prompts under
the factory Manual/Guided policy. Arbitrary scripts and website access outside
approved hosts still require actual approval or existing user delegation.
Explicit Autonomous/Autopilot retains automatic approval, never hard-policy overrides.
Explicit deny, read-only scope, protected paths, writer ownership, budgets and
actual execution boundaries remain authoritative.
The [canonical file-access contract](file-access.md) records normalized rule
matching, conservative macOS deny/review aliases, protected filename variants
and exact-root/symlink enforcement. Native automatic approval cannot bypass it.

## Reuse and authority

Reuse TypeBox, the existing Node file/data workers, permission pipeline,
append-only settings events, SDK, React/OpenTUI and authenticated Chromium host.
Their existing MIT/component notices apply. No dependency, shell classifier,
OS packet filter or general-purpose script evaluator is introduced.

The Local website allowlist is actual-user managed and profile-owned. Entries
are scoped to one original session, a real project, or all Local projects in
that profile. Matching entries are additive and show their source scope.
Changing scope, deleting a source or switching profile never rebinds an entry.
Models cannot add, remove or expand entries. Rules authorize Moguri's web and
Agent-browser tools, not network confinement of approved Local scripts.
Remote cannot inherit Local grants. Sandbox uses its actual enforced host
scope; tool approval cannot broaden its firewall or select another transport.

Exact bare DNS names permit default-port HTTPS. Exact HTTPS origins retain
their scheme and port; loopback HTTP origins additionally support Browser
previews. Public page/search tools retain their public-HTTPS destination guard.
Credentials, paths, query/fragment tricks,
malformed hosts and wildcard rules are rejected. Private-address,
control-plane, browser-lease and no-credential boundaries still apply.

Native operations use deterministic known capabilities, not a leading-word
guess about arbitrary shell strings. A configured external MCP, user script,
debug evaluation or arbitrary process does not become safe because it claims a
read-only annotation. Explicit stricter user review/deny rules are retained.
Automatic native operations record policy provenance, not fabricated user
approval or another paid decision-model call. After waiting for an actual
writer root, automatic admission rechecks the original policy/permission
revision and authorization basis before retaining `tool.started`.

## Network admission and redirects

The service captures the approved initial origin plus effective host rules
before dispatch. Normal Local/Remote web requests and native browser requests
receive that exact bounded authority. Each redirect, main-frame navigation,
browser subresource and WebSocket request must remain inside it; an allowed
initial URL cannot launder an unreviewed
destination. A blocked redirect reports its actual destination and outcome,
without replay or automatic cross-host approval. Explicit Autonomous keeps its
broader approval, while public-address and hard firewall rules remain enforced.

Browser control still starts off, uses its exact authenticated native host and
page handles, and revokes pending work on permission/scope changes. Direct
user navigation is distinct from an agent grant. The user's per-chat Agent
control choice persists (D61), but every automatic re-enable after navigation,
a reconnect or a permission change is a new identity with no inherited website
admission; the deny-by-default gate returns with it. Local rules are not an OS
firewall and cannot constrain arbitrary already-approved host processes.

## Fresh reads and safe edits

Ordinary `read_file` requests return the current permitted source even when
their optional prior digest became stale. The result explicitly identifies
the changed version and returns its fresh `sourceRef.expectedDigest`.
A stale byte continuation restarts at the beginning instead of mixing pages
from different versions. Callers requiring an exact version opt into
`requireExactVersion`; original retained results remain separately readable.

Writes and edits still bind the exact current digest and unique edit matches.
A fresh read is never a successful edit, silent write, fallback root or
permission to overwrite an unseen version.

## Persistence and qualification

Protocol/schema 73 adds optional user-owned website rules and typed SDK
management, with a strict atomic migration marker. Preserve original
ciphertext, grants, receipts, budgets, models and preferences. Older state
does not manufacture host grants, and current rules cannot be relabelled as
older data. Recovery never replays requests, scripts or browser interaction.

Generated tests cover default native approval, stricter policies, exact
script review, all three host scopes, malformed/cross-profile rules, revision
conflicts, restart/migration failure, redirect and permission revocation,
read refresh/pinned continuation and unchanged write CAS. SDK/CLI/TUI/desktop
share the same service policy. Use generated homes, documents, endpoints and
recognizers, never personal files, credentials, accounts or paid inference.

## Phase 0 prerequisite rerun

The generated `npm run spike` report on macOS arm64 used Node 26.12.0 before
implementation. Six foundation groups passed:

| Primitive | Measurement |
| --- | --- |
| Generated provider streaming/cancellation | 6 intercepted requests; 31.39 ms cancellation |
| SQLite append/rebuild/crash rollback | 1,000 events; 0.056 ms append p95; 0.51 ms rebuild |
| Nested PTY cancellation | 151.86 ms; zero survivors |
| OpenTUI streaming | 60 updates; 16.96 ms average |
| Hidden Electron startup/scroll | 262.55 ms cold start; 444.95 MiB; 8.25 ms frame |
| Filesystem/Git baseline | 2,000 files; 1.22 ms search; 7.02 ms Git status |

The generic report still marks live account/model entitlement, Rust/Linux,
signed/notarized packaging, its unconfigured SendBox/SSH probe, model quality
and live decision providers as failed or unqualified. These fixture passes
do not establish those capabilities. The report's broader-release probe also
remains unqualified; it is not evidence that the implemented platform has
only the historical initial checkpoint's feature set.

## Executable qualification

The final production build and type checks passed. The complete source suite
used pinned Node 26.12.0 with two isolated test-file workers:

```sh
node_modules/node/bin/node --import tsx --test --test-concurrency=2 tests/*.test.ts
```

It passed **1,770 cases, 14 existing skips, zero failures** (1,784 total) in
**803,815.09 ms**. The serial preliminary run exposed obsolete factory-read
approval assumptions, not permission to hide them: approval-specific fixtures
now configure genuine stricter user review rules; ordinary native-flow cases
assert policy provenance without a fabricated answer. The current and
automatic-61 actual SIGKILL fixtures also report their owned temporary root and
terminate their exact child on timeout rather than keeping the suite alive.

Both complete hidden Electron runs passed **249 flows, three existing skips,
zero failures** (252 total) in **8.3 minutes each**: one uses the source desktop,
the other the actual packaged executable. They include actual Chromium
navigation, accessibility/input, allowed-site automatic dispatch, denied
cross-origin redirects and subresources, dispatched-rule removal, direct-user
navigation revocation, concise settings CRUD and inherited scope display.
No personal browser, account, microphone or clipboard was used.

The external packed SDK was independently installed and audited, including
browser-safe root/React/Node types, actual policy-owned Home writes/reads,
fresh-source provenance, all website scopes, CLI/shared TUI behavior and
restart. Its **12 actual installed-worker continuation/accounting probes**
passed. The actual bundled Node/service/SDK/CLI qualification also passed
Local website settings, policy-versus-user attribution, original Home/Agent
output, real generated OAuth/SSH, terminal ownership and retained role/candidate
recovery. Source, installed-consumer and no-cache native-workload audits found
**zero vulnerabilities**.

The no-cache Linux arm64 workload binds:

| Payload | SHA-256 |
| --- | --- |
| Immutable image | `df976bc8e9d1647a771a15a5ecb0a5b669035e19ab971a4c982117237d4907d3` |
| Worker | `b23874581b895b4f740a0f6d14152841192cc001b9db3cce56a3f61d2bd3d887` |
| SSH bridge | `95114d2a00c80c89aea43990bdebe6a34d2b50a5cf0e932a8d22482fc9402b5a` |
| MCP worker | `24a7f1e152f6c080cb694b637be881b428c32241dbdef0a5eaec1995c5e16144` |

Packaging did not rebuild or change those frozen compiled worker bytes.
The **779,898,752-byte** ZIP passed the actual production update consumer in
**107,358.47 ms**. The canonical DMG passed checksum and privately mounted
layout/bundle verification without opening Finder or executing the application.
The byte-identical labelled installer is
`release/Moguri-0.30.0-alpha.1-local-firewall-73-macos-arm64.dmg`,
**794,141,106 bytes**, SHA-512:

```text
e481e3153d787e0565148ca1ebec8bf017da32729dc2cd8a831054e441329ab0b01dc7abb9be281b2e543727145bc9ae417e86d27c371554ead31ba124074a29
```

This is a development/ad-hoc-signed macOS arm64 artifact, not a notarized or
uploaded release or fresh native-VM/Linux-UI qualification. Existing notices
remain: OpenTUI's experimental FFI, the large lazy Ghostty chunk, the missing
optional `.icon` format with verified `.icns`, and upstream
`whatwg-encoding`/`node-domexception` deprecations. They did not become failures
or fabricated readiness claims.
