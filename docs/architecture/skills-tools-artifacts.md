# Skills, tools and artifacts workspace

Protocol 114, issue #82. Two profile resources sit next to Automations in the
desktop's left navigation: **Customize** (named Skills before protocol 116:
installed skills, a marketplace of configured skill sources and the agent's
toolsets) and **Artifacts** (a project-by-project library of what sessions
produced). A recurring **repeated-task tool check** joins Automations.

Protocol 116 makes the Tools section project-less: scripts written there apply
to every chat, and the chat it opens has no project.

## Change contract

- **Reused libraries:** TypeBox (MIT) for the new command, queries and
  settings; Node.js `fs` for metadata-only scans; Electron `shell.showItemInFolder`
  (MIT) to reveal a file. No new dependency.
- **New invariants:** installing never grants tools or enables anything; listing
  toolsets grants nothing; the artifact library never reads file contents,
  follows symlinks or lists protected paths; the repeated-task check never makes
  a model call and never writes, enables or runs a script.
- **Events and schema:** no new event type. `settings.updated` may carry
  `automations.toolSuggestions`; `attention.raised` may carry the sessionless
  reason `tool-suggestion`. Marker `tool_suggestion_automation_schema` (version
  1) is added by the 114 migration; that history can't become a pre-114 lineage
  and a premature marker fails closed. `skill.install` emits the existing
  `capability.saved` shape.
- **Cross-client:** the service is authoritative. Desktop, TUI and CLI use the
  same SDK calls: `sdk.skills.install`, `sdk.tools.toolsets`,
  `sdk.artifacts.library` and the shared suggestion preview.
- **Failure and cancellation:** an install re-reads the source and fails
  without writing when the digest changed; a library scan is bounded and
  abortable (20 s), and a truncated scan says so; a failed periodic check logs
  and retries at the next interval without raising anything.
- **Tests:** `tests/skills-tools-artifacts.test.ts`,
  `tests/e2e/skills-artifacts.spec.ts` and the protocol-114 marker list in
  `tests/github-read-migration.test.ts`.

## Customize tab

- **Skills:** every installed skill in the profile, grouped by scope (All
  projects, then each project). Each row shows its origin (installed by you,
  approved proposal, plugin bundle or repository marketplace), digest and an
  On/Off switch that saves immediately through `capability.toggle`. Pending
  skill proposals can be reviewed here too. Settings / Skills keeps import,
  per-chat admission and publisher trust.
- **Marketplace:** the configured skill sources (`skillSources`: GitHub
  repositories, HTTPS ZIP archives and local folders, plus the global
  `~/.agents/skills` and `~/.moguri/skills` folders) are the configurable
  repositories. Source changes save immediately. **Install** sends
  `skill.install { projectId | null, skillId, expectedDigest }`:
  - the service re-reads the source through the skill gateway and fails if the
    exact bytes changed since discovery;
  - only source skills can be installed (already installed registry skills
    can't);
  - the entry is a standard disabled `skill` capability (`source: "user"`)
    whose `contentDigest` equals the source digest, in the chosen project or,
    with `projectId: null`, for every project;
  - reinstalling a skill with the same name and different bytes updates that
    entry to a new disabled revision; identical bytes are refused; a
    plugin-owned name is refused;
  - a built-in slash command clash returns the usual rename notice.
  The committed-catalog repository marketplace (`marketplace.install`) is
  unchanged and linked from this tab.
- **Tools:**
  - *Built-in toolsets* come from `tooling.toolsets`, which groups the actual
    service tool definitions (Files, Search and code intelligence, Git and
    GitHub, Commands and scripts, Documents, Data, Web and browser, Planning
    and sessions, Skills/MCP/proposals). A tool without a documented group is
    listed under Other, never hidden. Each chat still receives only the tools
    its environment, mode, scope and policy allow.
  - *Foundational scripts* (`grep_logs`, `fetch_page`, `search_memory`,
    `memory_graph`).
  - *Your scripts* are `script` capabilities with an On/Off switch, either
    for every chat (`projectId: null`) or for one project. Pending script
    proposals are reviewed here: approving installs a disabled copy.
  - The Tools section isn't tied to a project. *Write a script* submits
    user-authored source with `proposal.create { projectId: null }` (actor
    `user`) for the same review. *Ask the agent to write a script* creates a
    project-free chat (`sessions.create(null, ...)`, captured Home) and saves
    an editable draft built by `toolScriptPrompt`; nothing is sent until the
    user sends it. The agent submits through `propose_script`, which needs the
    existing optional evolution switch (offered inline when off) and, in a
    project-free chat, proposes a script for every chat.
  - `proposal.create` and `propose_*` accept a null project only for skills
    and scripts (`proposal_scope` otherwise); hooks and memory always belong
    to a project.
  - A chat sees `scriptEntries(registry, projectId)`: its project's enabled
    scripts plus enabled every-chat scripts whose name the project doesn't
    reuse. A project script therefore shadows a global one with the same name;
    a project-free chat sees only every-chat scripts.
  - Script contract (`SCRIPT_TOOL_CONTRACT`): a Node.js ES module run in the
    chat's working folder (the project root, or captured Home for a
    project-free chat) that reads `{"arguments": {...}, "projectRoot": "..."}`
    from stdin, writes at most 128 KiB to stdout and exits 0. When a script
    proposal is approved, a leading `// description: ...` comment becomes the
    tool description agents see; otherwise the previous generic description is
    kept.
  - Repeated work found in session history also became typed built-in tools
    rather than scripts: the GitHub reads and `github_write` in
    [GitHub workflows](github-workflows.md), and `web_fetch` `find`/`offset`
    with a 10-minute page cache (see [Repeated lookups](#repeated-lookups)).

### Repeated lookups

Scouting real agent sessions showed the same public pages fetched again and
again to page through them or look for one string, and `curl | grep` used for
the same lookup. `web_fetch` now accepts:

- `find`: a literal, case-insensitive string. Only the matches are returned,
  each with `context` characters around it (default 200, up to 2,000);
  overlapping matches merge, at most `maxMatches` (default 20, up to 100) and
  50,000 characters of match text are shown, and `totalMatches`/`shownMatches`/
  `complete` say whether any were left out;
- `offset`: read 50,000 characters from this position; `nextOffset` is null
  at the end.

The fetched readable text is kept in memory for 10 minutes (32 pages at most,
per Local or Sandbox source) so a search or the next page doesn't download it
again; results say `cached: true`. Web access policy is checked again for the
requested and final URL on every call, cached or not. Nothing is written to
disk or the event stream.

## Repeated-task tool suggestions

`detectToolSuggestions` runs over the suggestion preview's already-scoped
prior prompts (12 most recent chats, 8 user prompts each, 32 KiB). It is a
deterministic phrase match, not a model verdict:

- conversions such as "turn this markdown into a PDF" or "generate a PDF from
  these notes" map known formats to a name like `markdown_into_pdf` and need
  two distinct chats;
- other repeated tasks need a leading task verb (resize, compress, extract,
  rename, ...) plus its object, such as `resize_screenshots`, and three
  distinct chats;
- a suggestion whose name matches an existing script capability is flagged
  `installed`.

`SuggestionPreview.tools` carries the result to Suggestions, Customize / Tools and
the TUI/CLI `/suggestions` output. It is not part of the preview digest and is
never sent to a model by itself.

### Automation

`settings.automations.toolSuggestions = { enabled, intervalHours }` with
`intervalHours` 6, 12, 24 or 168. Absent means off. While on, the service polls
every 15 minutes (configurable for tests) and runs the check once per interval
while it is running; there is no catch-up replay of missed intervals. Each new
suggested name raises one `attention.raised` with `reason: "tool-suggestion"`,
`kind: "bell"`, `source: "heuristic"`, no session or project, and the tool name
as `messageId`. A name is never raised again, even after it was read, cleared
or deleted. Projection rejects any other shape. The Inbox entry opens Customize /
Tools; reading or deleting it changes nothing else.

## Artifacts tab

`artifacts.library { projectId | null }` returns metadata only:

- **Output folders:** `dist`, `out`, `build`, `release(s)`, `artifacts`,
  `output(s)`, `target`, `publish`, `bin` and `exports` at a root or up to two
  levels below it, in the project checkout (no linked session) and in every
  ready managed worktree (linked to the session that owns it). Walks skip hidden
  entries, symlinks, protected paths and dependency/cache folders, list
  `.app` bundles as one installer without descending, and stop at 6 levels,
  20,000 entries or 600 files (`truncated: true`).
- **Agent-written files:** `path` arguments of `write_file`, `write_document`
  and `edit_document` in Local single-project or project-free sessions,
  resolved inside that session's actual root and listed only if the file still
  exists. They keep the writing session.
- Only installers, archives, images, documents and media are listed; source
  code and metadata files are not.

The desktop combines the library with chat images (message attachments), links
in user and assistant messages (`messageLinks`) and active retained documents,
then filters by type and search. Every item links to its chat when known.
**Scope.** The Project picker offers **All projects**, each project and
**Chats without a project**. It opens on the current chat's or project's scope,
or on All projects when neither is open. All projects is a desktop view over the
same per-owner `artifacts.library` query: it runs one query per project plus one
for project-free chats (at most four at a time), shows each item's project, lists
a file found by two projects (nested checkouts) once, and reports a failed scan
by project while still showing the rest. Every item keeps its own owner, so
Finder reveal and Trash re-verify it against that owner's library, never a
combined list.
**Show in Finder** goes through `moguri:reveal-artifact`, which re-queries the
library, requires the exact listed path, rejects symlinks and changed real
paths, and only reveals the file; nothing is opened or executed. Links open
through the existing external-link bridge. Retained documents are edited in
Settings / Artifacts.

**Deleting.** Saved notes and listed files can be deleted one at a time or by
selecting several, always after an explicit confirmation that names each
item. Notes use the existing `artifacts.delete` (retained revisions and grants
are removed; chats and other copies stay). Files go to the system Trash through
`moguri:trash-artifacts`, which re-queries the library for each path, rejects
paths that are no longer listed, symlinks and changed real paths, and calls
Electron `shell.trashItem`; nothing is permanently deleted, opened or run. Files
in a workspace folder project's own checkout are never offered or moved, because
those projects are read-only sources; their worktree outputs can be. Each file
reports its own result, so a partial failure is shown rather than hidden. Chat
images and links are conversation history and can't be deleted here. Hidden
test windows move files into `MOGURI_TEST_TRASH_DIR` instead of the real Trash.

## Clients

| Capability | Desktop | TUI | CLI |
| --- | --- | --- | --- |
| Toggle skills and scripts | Customize tab switches | `/capability enable/disable` | `moguri capability enable/disable` |
| Install a source skill | Marketplace **Install** | `/skills install ID SHA [global]` | `moguri skills install ID --digest SHA [--project ID]` |
| Toolsets | Tools tab | `/tools` (scoped catalogue) | `moguri toolsets` |
| Repeated-task suggestions | Suggestions, Tools, Inbox | `/suggestions`, `/inbox` | `moguri suggestions preview` |
| Automation | Automations switch and interval | `/settings` JSON editor | `moguri config set SETTINGS.json` |
| Artifact library | Artifacts tab | `/artifacts library` | `moguri artifact library [--project ID]` |
| Delete a saved note | Artifacts tab, Settings / Artifacts | Not available | `moguri artifact delete ID --revision N --confirm-remove` |
| Move a listed file to the Trash | Artifacts tab | Not available | Not available |
