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
