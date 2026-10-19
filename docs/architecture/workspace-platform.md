# Shared dependency cache and local project issues

This user-requested slice extends the existing SDK platform, not a second
client-side service. The existing dark identity, prompt, memory, extension and
voice behavior remain unchanged. CI runs only on `main` pushes; verification of
this slice is local.

## Phase 0 and sources

Reuse Node crypto/SQLite/HTTP, TypeBox, YAML and the existing OS keychain. Add
`cacache` 21.0.1 (ISC) and its development declarations, and pinned pnpm 12.14.0
(MIT). pnpm's optional native binary is used through its maintained launcher;
its installer scripts are denied. No project lifecycle code is evaluated by
the cache.

The generated macOS arm64 spike installs the same integrity-pinned package in
two npm branches from one shared native cache, rejects mismatched bytes and
never runs its deliberately hostile postinstall. pnpm's local-tarball store
priming alone does **not** hydrate an offline registry snapshot. A bounded
loopback mirror serving only preverified artifacts works with the native pnpm
installer. The passing combined run took 339 ms for a 685-byte fixture, not a
real-project performance claim. `npm run spike:workspace` reproduces it.

Sources: [npm cache](https://docs.npmjs.com/cli/v11/commands/npm-cache),
[lockfiles](https://docs.npmjs.com/cli/v11/configuring-npm/package-lock-json),
[pnpm store](https://pnpm.io/cli/store),
[pnpm layout](https://pnpm.io/symlinked-node-modules-structure),
[OSV batch API](https://google.github.io/osv.dev/post-v1-querybatch/) and
[Linear GraphQL](https://linear.app/developers/graphql).

## Cache contract

Immutable package archives share one profile-owned content-addressed cache
across registered projects/worktrees. Every plan binds the exact manager,
manifest and lockfile digests, not a mutable branch name. Switching branches
invalidates a stale plan while common package/version/integrity content is
reused. Different bytes under one name/version are never conflated.

Initial adapters are npm lockfile 2/3 and pnpm lockfile 9, public npm-registry
packages with SHA-512 integrity. Unknown formats, private/custom registries,
Git/URL/executable resolutions and missing integrity fail explicitly.
No user registry credentials are inferred or copied.

Explicit preparation/installation authorizes sending public dependency
name/version metadata to OSV. Check every exact version before downloading
artifacts, and again before reuse/install; known vulnerabilities, incomplete
responses, pagination, outages or unknown status block admission. Integrity
is checked on insertion and reads. A clean advisory result is not proof that a
package is safe or malware-free. No permanent "secure" badge is promised.

Managed installs disable all project/package lifecycle scripts and pnpm hooks.
Installers receive only a sanitized manifest and exact lock in clean private
staging; repository `.npmrc`, workspace configuration and executable hooks are
not evaluated. Only a completed, rechecked tree replaces `node_modules`.
Failure before that leaves the original tree untouched; an unconfirmed crash
during replacement preserves a protected backup rather than replaying effects.
pnpm is allowed to trust only the exact lock already approved and checked by
this gate; its artifact requests go to a loopback allowlist mirror. npm uses
its verified native cache offline. Installed dependency trees stay private to
the worktree; npm archive reuse is not shared mutable `node_modules`.
pnpm may use copy-on-write reuse where supported. Any request to run lifecycle
code needs a qualified real SendBox boundary and currently fails closed.
One cannot sandbox a postinstall before downloading its bytes; fetch
quarantined, integrity-check and never execute on the host is the safe order.
Arbitrary separately approved shell commands are outside this managed API.

## Issues and integrations

Local issues have project-scoped ticket numbers, feature/bug/misc type,
title/body, phase and revision. Boards have ordered customizable phases and an
explicit merged-PR destination. They have no assignee or hosted account.
Removing an occupied phase is rejected instead of orphaning tickets. Archive
is non-destructive; issue state is independent of session retention.

Linking a GitHub PR authorizes bounded read-only observation while the service
runs. Only a verified `merged` response advances a phase. Closed-without-merge,
missing auth and network failures do not. Concurrent local edits/changed links
win over stale responses. A board can disable observation or use an explicitly
selected GitHub CLI account for private repositories. No merge, push or CI
operation is exposed.

Linear is optional and off by default. A user supplies a personal API key
through a dedicated masked/keychain path and enables one team on a board.
Explicit bounded imports retain remote provenance and do not export local
issues, read an assignee, upload repository data or overwrite local edits.
GraphQL errors, including partial HTTP-200 responses, are failures. Interactive
OAuth and unattended two-way sync are not implied.

## Durability, cancellation and acceptance

Migration 3 preserves prior immutable events/receipts, vectors and capabilities;
new board/issue/cache events extend the shared projection. Derived cache
metadata is not authorization. Restart marks interrupted jobs partial and
never replays installs or effects. Cancellation leaves verified reusable
archives but never labels an interrupted install successful.

Tests must cover two real branch workspaces, hash tampering, advisory outage/
denial before artifact download, changed locks, blocked lifecycle code, owned
process cancellation, concurrent clients, phase deletion, closed versus merged
PRs, concurrent merge/edit responses, migration/restart and Linear opt-out/
secret redaction. CLI/TUI, desktop and external packed SDK expose the same APIs.

## Local acceptance, 2026-10-19

A clean locked installation, production build and type checks pass. The full
generated suite passes 59 checks, including real CLI/TUI interaction, native
npm/pnpm installs (including a scoped package), two Git worktree branches,
concurrent cache reuse, changed-plan rejection, new-advisory revocation,
corruption, cancellation/TERM escalation and old-tree preservation. It also
covers ticket revision/phase conflicts, merged versus closed/missing PRs,
concurrent observation/edit races, Linear opt-out/revocation and schema-1/2
upgrade/restart without replaying an interrupted install.

All three hidden Electron workflows pass, including local Kanban,
custom phases, verified PR transitions, optional Linear and the shared cache.
The external packed consumer independently type-checks all four SDK
entrypoints and runs embedded runtime, vectors, native MCP, local tickets and a
script-free managed install. Audit reports zero vulnerabilities. The repeated
native-cache spike takes approximately 345 ms on generated bytes, not a
production benchmark. Bounded desktop/compact inspection and the mechanical
UI scan cover the new surfaces without changing the existing visual system.

No CI was dispatched or run for this feature branch. No personal authorization,
real microphone, speech model weight, live private dependency, GitHub mutation
or Linear write was used. Lifecycle execution and SendBox remain unqualified,
not described as successful sandboxing.
