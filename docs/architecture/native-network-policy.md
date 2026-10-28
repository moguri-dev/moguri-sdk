# Native operations and scoped website approvals

Ordinary native file reads, searches, queries and edits run without prompts under
the factory Manual/Guided policy. Arbitrary scripts and website access outside
approved hosts still require actual approval or existing user delegation.
Explicit Autopilot/Max retains automatic approval, never hard-policy overrides.
Explicit deny, read-only scope, protected paths, writer ownership, budgets and
actual execution boundaries remain authoritative.

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
without replay or automatic cross-host approval. Explicit Autopilot keeps its
broader approval, while public-address and hard firewall rules remain enforced.

Browser control still starts off, uses its exact authenticated native host and
page handles, and revokes pending work on permission/scope changes. Direct
user navigation is distinct from an agent grant. Local rules are not an OS
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
