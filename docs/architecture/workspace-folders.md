# Workspace folders and read-only source projects

## Scope

A workspace folder is a folder the user trusts, such as `~/workspace`, that
holds many Git repositories. Moguri reads it to find repositories, registers
the ones the user picks as projects, and can keep that list in sync. Those
projects are **read-only sources**: Moguri never edits the original checkout.
Every Local session works in its own managed worktree under Moguri's state
directory (`<state>/worktrees/<project>/<workspace>`), as described in
[managed workspaces](managed-workspaces.md).

Reuse Node.js filesystem primitives (MIT), TypeBox (MIT), React (MIT) and the
existing SDK, encrypted event store, `project.added` registration and
managed-worktree machinery. No new dependency, network call, model call or
executable transport is added. Discovery does not run Git.

## Trust and permission

Importing requires the actual user's explicit `trust: true` command after
reviewing the exact discovery result. The folder record keeps that consent
(`actor: "user"`, command ID/digest and time). The desktop accepts a typed path
or the native macOS picker. Picking a folder also gives the app any
operating-system access it needs for protected locations; a typed path relies on
access the user already granted.

Folder trust means only "Moguri may read this folder and list its
repositories". It is not repository script trust, a permission grant, a
SendBox boundary or a malware check. Scripts still need their own
[repository trust](repository-workflow-defaults.md) review, and hard policy,
tool denials and folder restrictions stay authoritative. Discovery and sync
require Local in the allowed-env policy; a blocked policy pauses sync.

## Discovery

Discovery is read-only and bounded:

- It inspects at most three directory levels below the chosen folder.
- It never follows symbolic links and skips dot folders, `node_modules` and
  Moguri's own state directory.
- A directory whose `.git` is a real directory with `HEAD` and `objects` is a
  repository. Discovery stops there, so nested repositories and submodules are
  not separate projects.
- A `.git` file (linked worktree or submodule checkout) is counted and
  skipped, never imported.
- Limits: 20,000 directory entries, 10 seconds, 500 repositories. Hitting a
  limit marks the result incomplete with a plain-language diagnostic.
- The folder's device/inode identity must be unchanged after the scan.

Managed worktree creation still verifies the exact Git root with
`git rev-parse --show-toplevel` before any session uses it.

## Durable model

Protocol 109 and store schema 109 (`workspace_folders_schema`) add:

| Item | Meaning |
| --- | --- |
| `workspace_folder.saved` | Full folder record: canonical root identity, `sync`, `excluded` relative paths, user trust, monotonic revision. |
| `workspace_folder.removed` | Stop tracking. Projects stay registered and stay read-only. |
| `Project.workspaceFolderId` | Set in `project.added` for folder projects. It marks a read-only source permanently, even after the folder is removed. |

The import command appends the folder record and every chosen `project.added`
event in one transaction. The review digest binds the profile, root identity,
existing folder revision, policy revision, current registrations and every
discovered entry; any change requires a new review. Overlapping folders
(one inside another) are refused. Across restarts a tracked folder is the same
folder while its canonical path and inode match: macOS renumbers device IDs at
boot, so the stored device is not compared then (see
[directory identity across restarts](domain-model.md#directory-identity-across-restarts)),
and checks never rewrite the trusted record. A folder that was deleted and re-created has a new inode: sync
pauses, and the review asks the user to stop tracking it and add it again. Repositories already registered as projects
are listed but left unchanged.

Older state upgrades by adding the marker in its own transaction. Pre-109
lineage cannot contain folder events or folder projects; premature or missing
markers fail closed without changing state. Generated fixtures use
`removeWorkspaceFoldersFixtureMarker`.

## Sync

"Keep in sync" (the default) checks each synced folder when the service starts,
every five minutes and on "Check now". A check registers repositories that are
new, not excluded and not owned by a pending clone or URL import. Choices left
unchecked during review become exclusions; removing a folder project adds its
path to the exclusions so sync never re-adds it. "Import once" keeps the folder
with sync off: later checks only report how many new repositories are
available for review.

Sync never removes projects. A project whose directory disappeared is reported
as missing, because project removal needs its own reviewed artifact choice.
A missing folder pauses sync until it is back; a replaced (re-created) folder
pauses sync until the user stops tracking it and adds it again. Each reports
its own diagnostic. Observations
(last check time, added, available, missing) live in memory only, so unchanged
checks append nothing. Checks and imports run one at a time per profile and
stop when the service shuts down; an interrupted check commits nothing.

## Read-only enforcement

For a project with `workspaceFolderId`, the service refuses with
`project_read_only`:

- Writable Local sessions in the original checkout: `workspaceMode:
  "checkout"`, a saved checkout preference, rebinding a fresh session to the
  checkout, moving a project-free chat into the folder, attached-checkout Local
  groups, switching a Sandbox/Remote session to Local, and switching a
  read-only chat to agent mode. Turn admission rechecks this. New Local
  sessions, including ones started from a work item, issue or PR, always create
  a managed worktree; if the repository is gone, creation fails instead of
  falling back to the folder. The project's Kanban chat stays read-only.
- Project-scope writes without a managed workspace: Git writes and remote
  changes, the defaults branch, artifact copies, Sandbox publication back to
  the folder, dependency installs and reviewed instruction-file writes.

Local sessions are not OS isolation: an approved shell command can still reach
any path the user can. The agent's root, tools, folder rules and every Moguri
write path stay inside the worktree; use Sandbox for real isolation.
Remote sessions use their SSH host path and never touch the local folder.
Sandbox sessions may copy files into the VM, but cannot publish back.
Creating and removing a worktree registers the worktree and its branch in the
repository's `.git` directory; that is inherent to Git worktrees. The
checked-out files, index and current branch are never changed. Projects added
individually keep the existing defaults: a new worktree, with the original
checkout available as an explicit choice.

## Clients

All clients use the SDK: `sdk.projects.folders.{preview, import, configure,
check, remove, status, list}`.

- Desktop: Settings > Repositories > Workspace folders takes a typed path or the
  native picker, then shows the review,
  sync choice and trust consent; each folder row has an immediately saved
  "Keep in sync" switch, "Check now" and "Stop tracking". The New dialog links
  there. Project settings shows the source folder and locks the workspace mode.
- CLI: `moguri project folders`, `folder-preview`, `folder-import`,
  `folder-sync`, `folder-check` and `folder-remove`.

## Verification

Generated coverage (`tests/workspace-folders.test.ts`,
`tests/e2e/workspace-folders.spec.ts`) checks discovery boundaries and
limits, stale reviews, selection validation, missing trust, overlapping
folders, worktree location and untouched index/branch/status, refused
checkout/configuration/defaults/remote changes, sync additions, exclusions,
project removal, sync off, restart persistence, folder removal, the four
schema upgrade/missing/premature/history cases and the desktop flow.
