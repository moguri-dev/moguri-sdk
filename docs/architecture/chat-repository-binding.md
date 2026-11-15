# Chat repository binding

Project-free Local chats start in the captured Home binding described in
`project-free-execution.md`. The user explicitly asked for one exception: when
such a chat starts producing code inside an existing Git repository, the chat
moves under that repository's project instead of staying in Home. If the
repository is not yet a project, it is imported only after the user confirms,
or after the user saved the "don't ask again" preference.

This is a real rebind, not a client-side grouping. The service records which
project now owns the chat, and the next turn runs in the repository root.

## Authority and reuse

The local control plane is authoritative. TUI, desktop and SDK clients read
the same `Session.repositoryProposal` and send the same typed commands; no
client owns a proposal, a move or a preference. Reuse the existing TypeBox
schemas, append-only event store, `project.add` validations, Home root identity
checks (`sourceRootSync`) and session subtree helpers. No dependency, scanner,
Git library or new execution transport is added.

A real project is acquired only when all of these hold:

- An actual successful `write_file` or `edit_file` call in an owning model turn
  of an ordinary Home-backed Local chat wrote a file inside Home.
- Walking upward from that file's directory finds a `.git` entry (directory or
  file) strictly below Home. Home itself is never proposed, even when Home is a
  dotfiles repository. Plain directories are never proposed.
- Either a project with that exact canonical path already exists, or the actual
  user confirmed the import, or the profile preference
  `interactions.confirmRepositoryImport` is `false`.

Nothing is inferred from earlier chats, prompts, model text, command output,
directory names or another session. Commands such as `git init` through
`run_command` are not observed. The service never creates a synthetic project.

## Events

| Event | Payload and invariant |
| --- | --- |
| `session.repository_observed` | `{ root, turnId }`. Only for an ordinary project-free Home-backed Local chat (no repositories, workspace or read-only role). `root` is a canonical path/device/inode strictly inside the chat's `homeRoot`. Sets `repositoryProposal` to `pending`. |
| `session.repository_dismissed` | `{}`. Requires a pending proposal and sets it to `dismissed`. A dismissed root is never proposed again for that chat. |
| `session.project_bound` | `{ projectId, root, actor, previousHomeRoot }`. The event's `project_id` is the new project and `session_id` the moved chat. Requires a project-free Local agent, side or subagent chat without repositories or a workspace, and an existing project whose path equals `root.root`. Sets `projectId`, removes `homeRoot` and `repositoryProposal`, and records `workspaceOrigin: "explicit-checkout"`. `actor` is `user` for explicit commands and `service` for automatic moves. |

Corrupt observations, dismissals or bindings stop projection with a
`chat_repository_corrupt` error rather than guessing a project or root.

## Detection

When an owning model turn of a Home-backed chat finishes, the service scans
that turn's own `tool.completed` events from newest to oldest. The repository
of the most recently written file wins. The repository root is captured with
`realpath` and `sourceRootSync`; symlinks that leave Home are ignored. The
observation commits in the same transaction as `turn.finished`, before it.

If the newest repository equals the current proposal (pending or dismissed), or
was dismissed earlier in this chat, nothing is recorded. A write by a child
chat records the proposal on the topmost chat of its tree, because only whole
trees move. Detection failures never change the turn outcome: the service
logs a code-only diagnostic and records nothing.

## Moving a chat tree

The moved unit is the root chat and every descendant reached through
`parentSessionId`. The root must be a Home-backed Local chat without a parent;
moving a child alone is refused with a request to move the parent. Every chat
in the tree must be project-free Local, without repositories, a managed or
Sandbox workspace, and must be settled:

- not archived, removing or held by a queued command;
- no active turn, run, native or checkpoint admission, external effect,
  decision owner, Sandbox owner, capture or running/waiting job;
- no pending approval or question, pending/retrying model recovery or
  scheduled prompt;
- no running, partial or unconfirmed process, uninspected partial command job,
  unsettled SSH/native execution, or `active`/`unconfirmed` Home writer;
- not blocked or paused for inspection.

The project must not be removing or quarantined. A refused move fails with a
409 `MoguriError` and changes nothing. All `session.project_bound` events, plus
`project.added` when importing, commit atomically in one transaction.

Already-queued prompts stay queued. Existing Home user consoles keep their
original root and no longer accept input after the move; close them and open
a console in the repository. Pre-move workspace checkpoints keep their Home
identity and cannot restore files into the repository.

## Automatic and confirmed import

At the start of each queue pump, before any queued prompt is admitted, the
service checks root chats with a pending proposal:

- If a project with the exact path exists and the tree is settled, it binds
  the tree with actor `service`.
- If no project exists and `interactions.confirmRepositoryImport` is `false`,
  it re-verifies the root's device/inode, applies the same validations as
  `project.add` (canonical directory, no pending clone or import batch, unique
  identifier) and commits `project.added` with the bindings.
- Otherwise the proposal stays pending and clients ask the user.

Unsettled trees are retried at a later pump. A vanished or replaced root is
left pending and logged once with a code-only diagnostic; nothing is retried
in a loop. Automatic moves never throw out of the pump.

The commands are:

- `session.project.bind { sessionId, projectId, expectedRevision }`: explicit
  user move of a Home chat tree into any existing project.
- `session.repository.import { sessionId, expectedRevision, path, confirm: true }`:
  `path` must equal the pending proposal root. The service re-verifies its
  identity, reuses an existing project with that path or adds one with the
  shared `project.add` validations, then binds the tree.
- `session.repository.dismiss { sessionId, expectedRevision }`: records "not
  now" for the pending proposal.

## Clients

Clients use `sessionRepositoryProposal(session, snapshot)` and ask only when it
returns `project: null` and `confirm: true`. The TUI shows one line above the
composer ("This chat wrote code in ROOT. Import it as a project and move this
chat?"). F12 or a click opens the choices without taking keys from the composer: import
and move, import and move with "don't ask again" (saves the preference after
the import succeeds), or not now (dismiss). The desktop uses the same SDK calls.

## Preference

`interactions.confirmRepositoryImport` is an optional profile setting. A
missing value means `true`: ask before importing. Saving `false` is the "don't
ask again" choice and authorizes automatic import for later observations in
this profile. It never authorizes tools, Git operations or other projects.

## Retention

Events before the move stay in the project-free compartment
`profile/<profile>/session/<session>`; later events land in
`profile/<profile>/project/<project>/session/<session>`. Session deletion
forgets every compartment keyed by the session. Project removal now forgets
the sessions it removes as well as the project, so a moved chat cannot
reappear as a project-free Home chat after removal or restart.

## Migration and compatibility

Protocol/schema 105 adds the events and the retention marker
`chat_repository_binding_schema` in one atomic migration step, following the
version-103 pattern. A marker on pre-105 state, a missing marker on 105 state,
or actual binding events/preferences relabelled as pre-105 history are refused
and the original state is preserved. Older clients refuse protocol-105 state.

## Tests

`tests/chat-repository-binding.test.ts` uses generated Homes, `git init`
repositories and a loopback provider. It covers detection only inside nested
repositories (never Home or plain folders), dismissal without re-proposal,
automatic moves of a chat and its side chat before the next queued turn runs
in the repository, atomic confirmed import, preference-driven automatic
import, refused moves for active turns, unconfirmed writers and child chats,
restart replay, session deletion and project removal without resurrection,
corrupt events and the 104 to 105 migration.
