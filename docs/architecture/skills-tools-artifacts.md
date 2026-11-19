# Skills, tools and artifacts workspace

Protocol 113, issue #82. Two profile resources sit next to Automations in the
desktop's left navigation: **Skills** (installed skills, a marketplace of
configured skill sources and the agent's toolsets) and **Artifacts** (a
project-by-project library of what sessions produced). A recurring
**repeated-task tool check** joins Automations.

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
  1) is added by the 113 migration; that history can't become a pre-113 lineage
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
  `tests/e2e/skills-artifacts.spec.ts` and the protocol-113 marker list in
  `tests/github-read-migration.test.ts`.

## Skills tab

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
  - *Your scripts* are project `script` capabilities with an On/Off switch.
    Pending script proposals are reviewed here: approving installs a disabled
    copy.
  - *Write a script* submits user-authored source with `proposal.create`
    (actor `user`) for the same review. *Ask the agent to write a script*
    creates a chat in the chosen project and saves an editable draft built by
    `toolScriptPrompt`; nothing is sent until the user sends it. The agent
    submits through `propose_script`, which needs the existing optional
    evolution switch (offered inline when off).
  - Script contract (`SCRIPT_TOOL_CONTRACT`): a Node.js ES module run in the
    project root that reads `{"arguments": {...}, "projectRoot": "..."}` from
    stdin, writes at most 128 KiB to stdout and exits 0. When a script
    proposal is approved, a leading `// description: ...` comment becomes the
    tool description agents see; otherwise the previous generic description is
    kept.

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

`SuggestionPreview.tools` carries the result to Suggestions, Skills / Tools and
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
or deleted. Projection rejects any other shape. The Inbox entry opens Skills /
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
**Show in Finder** goes through `moguri:reveal-artifact`, which re-queries the
library, requires the exact listed path, rejects symlinks and changed real
paths, and only reveals the file; nothing is opened or executed. Links open
through the existing external-link bridge. Retained documents are edited in
Settings / Artifacts.

## Clients

| Capability | Desktop | TUI | CLI |
| --- | --- | --- | --- |
| Toggle skills and scripts | Skills tab switches | `/capability enable/disable` | `moguri capability enable/disable` |
| Install a source skill | Marketplace **Install** | `/skills install ID SHA [global]` | `moguri skills install ID --digest SHA [--project ID]` |
| Toolsets | Tools tab | `/tools` (scoped catalogue) | `moguri toolsets` |
| Repeated-task suggestions | Suggestions, Tools, Inbox | `/suggestions`, `/inbox` | `moguri suggestions preview` |
| Automation | Automations switch and interval | `/settings` JSON editor | `moguri config set SETTINGS.json` |
| Artifact library | Artifacts tab | `/artifacts library` | `moguri artifact library [--project ID]` |
