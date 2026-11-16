# Managed workspaces and retained artifacts

This is the first-release worktree/artifact contract, not the deferred
multi-repository orchestrator. Reuse system Git (GPL-2.0 executable), Node
(MIT), the existing one-writer SDK/protocol and encrypted append-only store.
Git remains a filesystem/version-control backend, not the session database.

## Qualification before feature

`node scripts/worktree-spike.mjs` uses only a generated repository, identity
and files. It checks actual worktree creation, lock/dirty removal refusal,
unchanged base checkout/index, preserved unrelated edits and branch retention.
A Git worktree lock prevents removal/pruning; it is not a model authorization
or an exclusive writer lease. Native execution gates remain independent and
must not be presented as complete because a Local Git primitive passes.

The actual generated Git primitive passed in **91.17 ms**, including both
refused removals and unchanged base/index/unrelated content. This measurement
does not qualify service leases or restart reconciliation.

## Implemented Local slice

Protocol/database 9 adds `workspace.saved`, `change_set.saved` and
`session.workspace_bound`. Older sessions project a null binding and preserve
their controls, identity, history and encrypted grants. All clients use SDK
commands; no UI-owned filesystem state exists.

Protocol101 makes these owned worktrees the factory default for new
single-project Local Git tasks. Workspace/change-set/job/session intent is one
transaction, and queued model work/consoles wait for the actual ready root.
Explicit checkout preferences and existing sessions are preserved. Non-Git
folders acquire no synthetic worktree. Unqualified multi-repository automatic
worktrees refuse base-checkout fallback; this does not add the deferred
multi-repository orchestrator. See [repository workflow defaults](repository-workflow-defaults.md).
Projects registered from a trusted [workspace folder](workspace-folders.md) are
read-only sources: they always use these worktrees and never the original checkout.

Worktree jobs atomically retain intent/command receipts before
`git worktree add --no-checkout --lock`, then populate the resolved base with
`read-tree`/`checkout-index`. Hooks, fsmonitor, filters, ambient/global Git
configuration and recursive submodule fetches are disabled. Read-only discovery
lists actual registrations, labels owned ones and never adopts external paths.
Clean idle unbound removal does not delete the branch. A pre-existing released
pruning lock does not become false partial failure.

SDK/CLI/TUI expose create/discover/inspect/open/bind/remove/reconcile; desktop
project settings exposes the same operations and its Files rail performs
bounded protected-path-aware reads. Worker/instructions/tools, diff/plan,
PTY cwd, attachments, memory, cache and MCP cwd use the same binding.
Writers serialize per root; different roots run independently. Legacy base
callers remain supported. A changed branch/directory or unconfirmed owned
effect never silently chooses the base folder.

Generated coverage exercises real worker writes, base/index preservation,
hooks/filter suppression, both client bindings, exact configuration targets,
per-root indexing/cache installs, writer concurrency, dirty/bound removal,
directory replacement and interrupted intent/reconciliation. Archive/deletion
preserves a worktree; project relocation/removal blocks retained roots.

This does not implement external adoption, Remote/Sandbox root mapping,
compound candidates or orchestration. The independent-artifact slice below
extends retained plan snapshots without completing structured questions or
repository materialization/commit.

## Required invariants

Managed workspace identity includes profile, project, actual execution host,
canonical root, base commit, branch and ownership. Sessions can share an
explicit compatible binding, never silently reuse another writer's root.
The service records creation/removal intent before effects, retains partial
outcomes, and reconciles after restart without repeating Git operations.
Worktree removal requires exact current identity and a clean, idle owned root.
Session archive/deletion does not remove its workspace or branch.

Every filesystem surface must resolve the same binding: worker root and lease,
instructions, file/diff/plan views, terminal cwd, indexing/context and dependency
installation. Unqualified Remote/Sandbox operations fail explicitly instead
of reading a local same-named checkout. Applying a staged candidate checks its
recorded base and preserves unrelated user changes; publishing is separate.

Retained plans, decisions, answers, notes and reports have their own scope,
content revisions, status and source-event/actual-actor provenance. Session
retention cannot erase an independent artifact grant. Automated answers are not
human instructions. Project removal previews artifact impact and requires a
specific retain/export/delete choice; no implicit repository publication.

Protocol/database migration, interrupted creation/removal, concurrent clients,
changed bases, dirty/untracked files, symlink escapes and restart recovery need
generated acceptance before clients advertise these operations.

## Implemented independent text artifacts

Reuse the existing AES-GCM/keychain/SQLite machinery, not a second document
database or new encryption library. Each artifact needs its own retention key
and immutable content revisions, so deleting one does not delete another and
retaining it does not retain its source conversation. The supported first
classes are plan, decision, answer, research note and report.

Protocol/database 10 transactionally re-encrypts legacy project-owned plan events into the
artifact's compartment while preserving plaintext event content, IDs, sequence,
receipts and content digests. Remove an old project blob grant only when no
other project-owned event references it. A restart during migration must roll
back, not leave a partly rekeyed history or require deleting user state.

Content provenance is distinct from the user action that retained it. Exact
message promotion binds the canonical completed source text/digest and its real
user/model actor; file capture has unknown authorship. Later edits must not
relabel model text as a human answer. None of these documents becomes policy,
instructions, permissions or model context automatically.

Project removal must preview the exact artifact set and bind the user's choice
to its digest. Retain detaches selected documents into profile scope; delete
destroys their artifact grants; export requires retrieving the exact bounded
archive before explicitly deleting stored project copies. Concurrent creation/
editing invalidates the preview. Source repository files and external copies
are never deleted or claimed securely erased.

All operations share SDK, CLI/TUI and desktop bindings, optimistic revisions,
archive/unarchive, bounded read/history/export and explicit deletion.
Project-free chats can retain profile documents without inventing a root.
Generated coverage includes same-content/different-artifact grants, model
versus human provenance, stale revisions/source digests, source-session deletion,
project retain/export/delete, transaction rollback and restart. Standalone
documents need no conversation or filesystem root. Native exports create a new
0600 file, verify exact bytes/digest and fsync without overwriting a destination.
The protocol-12 repository slice below adds materialization/local commits and
work-item/folder associations. Structured questions add actual-user answers,
not a delegated decision-provider implementation.

## Implemented structured questions and actual-user answers

An enabled model may ask a typed clarification with bounded choices/freeform
text. Routing that question is not permission to execute its contents. Respect
explicit tool denials, but do not require a redundant "may I ask" approval.
The question remains untrusted model content; answers cannot approve tools,
change policy or promote themselves into Core memory.

Only an actual user answer endpoint records actor `user`. A future delegated
decision path must retain its actual model/provider/call provenance, never
reuse that endpoint or relabel its output. Exact question revision/owning turn
checks reject stale or cancelled answers. Stop/restart cancels pending waits
without inventing an answer or blocking the worker cancellation chain.

Protocol/database 11 implements user-requested answer retention on by default, with an explicit setting to opt
out. Answer source event, independent artifact revision and command receipt
commit atomically, including optional exact saved-draft consumption. The artifact preserves model-question and actual-answer
sources and survives session retention. New events/settings/projection require
a numbered migration and generated multi-client/restart/cancellation coverage.
Desktop and TUI must expose the same real waiting state, not a heuristic
question badge masquerading as an authoritative request.

Desktop's contextual Answer action and TUI Shift+Cmd/Ctrl+Enter use that saved
draft; Cmd/Ctrl+Enter still holds queued intent. Choice answers do not clear
other draft text or attachments. Routing uses policy authority, respects
explicit denials and never claims a human approval. Independent artifacts label
actual user answers separately from the model question.

Generated protocol-11 qualification passes eight question cases: real owning
turns and consumed drafts, concurrent choices, stop without deadlock/fake
answers, retention opt-out, explicit tool denial, project-free read-only
questions, rollback of derived-artifact failures, and schema-10/restart
recovery. Actual CLI/native-TUI and hidden Electron flows exercise the same
SDK. The complete local suite passes 185 checks; all 15 hidden desktop flows
and a fresh audited external SDK install pass. No delegated-answer or native
Sandbox readiness is inferred from these results.

## Implemented repository artifact materialization

Reuse Node's maintained filesystem/crypto primitives (MIT) and system Git's
existing independent-index publication path (GPL-2.0-only executable), without
new dependencies. Profile navigation folders and same-project local work items
are artifact associations, not filesystem authority or session ownership.
Migration 12 preserves old revisions and defaults missing associations to
null; retaining a removed project's documents clears their work-item binding.

An explicit project/workspace preview binds the exact artifact set/history,
export digest, canonical directory identity, policy revision and optional new
local branch/base. Write only a new private immutable JSON history bundle under
that root's `artifacts/`. Never overwrite other files, follow a destination
symlink, silently choose a session/base root or bypass denied/read-only policy.
This is explicit Local repository publication, not a qualified Remote/Sandbox
filesystem transport.

Optional commit means an explicitly selected new non-protected **local**
branch with the reviewed HEAD as parent. Use a temporary index, no signing,
hooks, filters, checkout or push, preserving the real index and unrelated
edits. A concurrent branch creation/base change rejects publication.

The durable owned job and its receipt precede filesystem/Git effects. Serialize
root writers; cancellation/failure after any possible effect is partial.
Restart never repeats publication. Project removal with `materialize` must
revalidate a completed job, current exact source set, actual persisted bytes
and any requested local commit before forgetting artifact grants. A wait
timeout, successful CLI exit, old digest or partial commit is not that proof.
Repository copies survive retention and remain user-owned, not automatically
loaded instructions; external edits after removal remain outside Moguri's
retention guarantee.

Eight generated publication cases pass: folder/work-item scope/history;
exact persisted bytes before deletion; durable receipt and writer exclusion;
cancel-after-copy without false success; racing branch/partial Git failure;
schema-11/restart without replay; unchanged real index/checkout/unrelated edits
and missing-commit deletion rejection; stale/denied/symlink destinations; and
actual managed-root identity separation. Cases combine related assertions.
The focused 26-check CLI/native-TUI/service run and all three hidden artifact
desktop flows pass. No paid calls or personal credentials are used.

The complete protocol-12 gate passes **194** local checks in **143,085.56 ms**
and all **16** hidden Electron workflows in **34.3 s**. A fresh packed external
consumer builds/checks all four entrypoints, installs its approved exact package,
performs real repository copying/local commits and folder/work-item retention,
and reports zero audit findings. Source/build audit also reports zero findings.
This does not qualify an installer, delegated decisions or native Sandbox.
