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
