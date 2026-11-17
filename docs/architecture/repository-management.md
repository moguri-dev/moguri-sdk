# Reviewed repository management

## Scope and prerequisites

Settings imports a reviewed list into explicitly chosen Local destinations.
Project settings changes one existing Git remote after reviewing its actual
shared-config boundary. Both use the service and browser-safe SDK, not a second
client queue. They do not authenticate, run a model, fetch, push, initialize
submodules or modify a user's installed Moguri service.

The pre-change generated Phase 0 rerun on macOS arm64 passed provider fixtures
(six intercepted requests, cancellation 30.87 ms), SQLite (1,000 events,
append p95 0.062 ms, rebuild 0.52 ms), PTY cancellation (152.13 ms, no survivors),
OpenTUI (60 updates, average 17.39 ms), hidden Electron (195.06 ms startup,
446.75 MiB, 8.21 ms scroll frame across 10,000 rows), and a generated 2,000-file
repository (search 0.82 ms, Git status 5.77 ms). Missing worktree dependencies
were restored with the existing lockfile; its audit reported no vulnerabilities.
The runner still reports unavailable live-provider, Linux/Rust, signed-package,
SendBox, model-quality and other original release gates separately. These
measurements do not qualify them or changed native worker bytes.

Reuse Node.js filesystem/crypto/process primitives (MIT), Git (GPL-2.0-only),
TypeBox (MIT), React (MIT), and Moguri's existing clone, reviewed Git, writer leases and encrypted
event store. No new dependency, agent loop or executable transport is added.

Folders that already hold checkouts use [workspace folders](workspace-folders.md)
instead: discovery plus read-only registration, with no clone.

## Import contract

Accept up to 100 nonempty URL lines, including ordinary pasted bullet lists.
Preview returns normalized credential-free HTTPS/SSH sources, duplicate and
existing-registration decisions, and every absolute destination under the
chosen canonical parent. Deterministic host/namespace/repository folder names
avoid identical basenames across owners. A matching existing checkout may be
registered only after its exact root/common-directory/remote is reviewed.
Conflicting files or retained uncertain clone intent block that entry, not
silently select a different folder.

Admission binds the entire exact input and preview, profile, parent inode,
registration set, current Local policy and hard denials. One sequential owned
batch reuses the existing script/filter/submodule-free clone primitive and its
five-minute per-clone safety deadline. Git uses existing SSH keys/known-hosts,
never a copied Copilot token, implicit account switch or interactive login.
HTTP redirects require the user to supply the current URL explicitly.

`repository.import_recorded` retains the original input/review, destinations,
per-item transitions and job identity independently of imported projects.
An item's dispatch intent precedes filesystem/network effects. Registration and
that item's successful outcome commit atomically. A failed item does not undo
successful registrations or delete partial directories. Cancel stops further
items and distinguishes undispatched cancellations from possible partial work.
The parent cannot report success when an item failed or is unconfirmed.
Reconnect, restart and missing receipts inspect that same retained batch;
they never replay a clone or infer absence from a missing result.
Uninspected partial items retain their exact writer boundary, even if a directory
is missing. A revision-bound actual-user inspection may release that hold,
without changing the original outcome, asserting process cleanup or rerunning
work. The acknowledgement and its canonical command remain independently retained.

## Remote-change contract

The actual-user-only `git.remote.set` action reuses `github.preview/execute`,
independent `github.operation_recorded` retention, cancellation, inspection and
terminal job publication. It is not a new model Git tool or permission grant.
The review binds the exact canonical root, HEAD/index/working bytes, common Git
directory, config file identity/digest, selected fetch/push URLs, policy and
complete linked-worktree boundary. Git itself expands existing global URL
rewrites without a network call; same-repository HTTPS-to-SSH destinations are
shown explicitly per worktree. Different-host/repository or unsafe transport
rewrites, worktree-specific overrides and ambiguous config fail rather than guess.

All affected roots must be free of owned work, including other profiles.
Remote review separately checks exact Local consoles across profiles; this
does not make their independent consoles singletons or prevent two profiles
from explicitly opening separate private consoles in the same folder.
The config lock and exact revision are rechecked before atomic publication.
Only the selected remote's reviewed URL fields change. Branches, refs, index,
working files and unrelated remotes remain unchanged. No network request or
authentication is part of changing a URL.

Future Git/GitHub reads use the actual new URL and freshly checked account.
Current Local metadata and review projections are invalidated. Historical
source snapshots, original PR associations, candidates, accounting and
in-flight input are never rewritten or retargeted. Remote/Sandbox sessions
cannot borrow a controller checkout or account for this Local-only operation.
Partial/lost publication retains the original review and inspection boundary;
it never authorizes a retry or declares the old config restored.

## Protocol and recovery

Protocol 91 adds independent `repository_import_batches_schema` and
`repository_remote_changes_schema` markers in one transaction. It adds the
typed import commands/queries/snapshot and extends existing reviewed Git
documents/operations with the remote action and its lease boundary. Terminal
remote publication uses existing configuration/observation events without
rewriting their older history.

Upgrade preserves genuine 88/89/90 ciphertext, original receipts, retention
grants, unknown holds and all earlier markers. Premature/missing markers and
new history relabeled as an older lineage fail closed. Restart retains partial
batch items and remote operations without another dispatch. A required API
bump prevents reuse of an older healthy same-protocol service lacking these
capabilities. Installing/upgrading an actual running service remains a separate
explicit user operation.

Generated coverage must include a 38-entry list, bullets/duplicates/invalid
credentials, unavailable/private sources, destination collisions, stale and
concurrent reviews, cancellation, lost acknowledgements, publication failure,
restart/no replay, shared-worktree config, dirty/index preservation, hard
denials, account/repository moves, original PR/candidate sources, hidden
Settings interactions, CLI/TUI and an independently installed packed SDK.

## Qualification at executable source `90a5d698`

All repositories, URLs, accounts, app bundles, recognizers and model responses
used by these checks were generated fixtures or owned loopback endpoints.
None of the illustrative real repository list was cloned, imported, changed or
authenticated. Hidden Electron exercised the actual Settings screens; no
personal app/browser was opened and the installed Moguri service was not restarted.

| Check | Result |
| --- | --- |
| `npm run typecheck`, `npm run build` | PASS |
| Full `npm test` | PASS, 2,343 passed, 29 skipped, 28.6 minutes |
| Full hidden `npm run test:e2e` | PASS, 358 passed, 5 skipped, 12.1 minutes |
| Independently installed `npm run verify:sdk` | PASS, browser/React/Node/MCP imports and declarations, actual installed import/remote/CLI/restart behavior, existing worker/SSH/retention checks |
| Root and packed-consumer audits | PASS, zero vulnerabilities |
| `actionlint .github/workflows/ci.yml` | PASS, main-push-only coverage and cancellation retained |

The import checks clone an actual generated 38-entry list, preserve exact
review/input grants, distinguish bullets and URL aliases, refuse credential/
transport/destination ambiguity, handle private/unavailable/moved sources,
serialize concurrent clients and preserve successful registrations through
partial/cancelled work. Actual service SIGKILL before effects retains an absent
destination's uncertainty and never replays its command; only an exact user
inspection releases that hold.

Remote checks verify actual common-dir worktrees, dirty bytes/index/HEAD,
unrelated remotes, safe GitHub HTTPS-to-SSH expansion, stale config/root/account
reviews, hard denials, foreign consoles, cancellation after publication,
failed result publication and tampered/foreign locks. Original PR/candidate
associations and source bytes remain retained; refreshed views bind the new
repository/account instead of transferring old scoped approvals.

One earlier full run observed a private-installer metadata ownership/type/size
rejection in the unchanged updater test. Its isolated reruns and final full
run passed; no updater code or strict private-file checks were changed.
The existing OpenTUI experimental FFI and greater-than-500-kB Vite chunk
warnings remain disclosed, not suppressed. Skips and the separate signed
SendBox release/adoption gate do not become release readiness.

SHA-256 of the actual tested build:

| Artifact | Digest |
| --- | --- |
| `dist/runtime.mjs` | `f96abdd286d1039ea0a9e9d7d4c6c66875761f4c919f571beb3dd6277bd93d69` |
| `dist/worker.mjs` | `8774d80d9fb6dab422cdb56137c5a63ac15b003c456fd3c1f0a9bcfc397058db` |
| `dist/remote-bridge.mjs` | `2dcb0a760c7f6bbace9c368d4c5bf291ff2d8d66ad0cefba8ffe4ac0d5bc779e` |
| `dist/sdk/index.mjs` | `1be5fb68644b428b50df166015f0791267ab716d78337f1bc0fa18cbbe7a7caf` |

These identify the generated-tested Node/SSH bytes, not a VM qualification,
signing/notarization receipt or permission to adopt an older native payload.
