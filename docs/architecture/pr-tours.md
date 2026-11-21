# Pull request tours

Protocol 118 ([D64](decisions.md#d64-pull-request-view-draft-state-and-guided-tours)). A tour is a guided review of one pull request, shown in the PR view's
**Files** tab under **Diff | Tour**. The chat's own agent writes it on demand; Moguri stores nothing new.

## Generation

- **Generate tour** (or the refresh button) calls `workflows.start(sessionId, "pr-tour", prompt)`. The text is
  the effective tour prompt, then a fixed contract from `prTourWorkflowPrompt` that binds the PR URL, number and
  exact head SHA, names the `github_read` files read at that head and describes the JSON shape. The composer
  draft is never consumed.
- The turn is an ordinary queued workflow turn: it uses the chat's model, Env, autonomy, approvals and budget,
  and its model calls are metered like any other turn. It never runs on its own.
- `pr-tour` is a read-only workflow (`readOnlyWorkflow`). The controller exposes only read tools and refuses any
  model-owned write, command or child work for that turn, whatever the prompt says.
- The desktop offers Generate only in an unarchived Local agent chat with a Moguri model. Claude Agent and Codex
  Agent run their own tools, so Moguri can't hold their turn read-only; Sandbox and Remote chats have no
  `github_read`.

## Reply contract

- The final reply ends with a fenced block whose info string is `moguri-tour`, holding JSON that matches
  `PrTourSchema`: `version: 1`, `pr`, `headSha`, `risk`, `impact` and `attention` (`low`, `medium` or `high`),
  `overview`, 1 to 12 `steps` (`title`, `summary`, up to 6 `snippets` of `path` with optional `startLine`,
  `endLine` and `note`) and up to 24 `edges` (`from`, `to` as 1-based step numbers, `label`).
- `startLine` and `endLine` are new-file line numbers inside the file's patch. Without them the snippet shows
  the file's first hunk.
- `parsePrTour` reads the last such block, never throws and returns a readable error for a missing, unclosed,
  non-JSON or off-schema block, edges that don't join two existing steps and reversed ranges.

## Where the tour comes from

- `prTourStatus(session, url)` reads the session's real queue and transcript. A queued item or sent message
  whose `/pr-tour` text carries the marker line `Pull request: URL (#N) at head SHA` belongs to that PR.
- Queued and running states come from the queue and `session.turnId`; a running turn also reports whether it
  waits for the user and how many tool calls it made. No progress is estimated.
- For a finished turn the newest assistant reply containing `moguri-tour` is parsed. It is ready only when its
  `pr` and `headSha` equal the requested ones. Otherwise the turn failed with the parser's reason and, when the
  turn ended with a diagnostic, that diagnostic. An older valid tour stays visible under a newer failure.

## Freshness and snippets

- A tour whose `headSha` differs from the selected PR head is outdated: the view says which head it was written
  for and offers Regenerate. Its snippets are hidden because GitHub serves file patches only for the current head.
- Snippets load through `github.files` at the exact selected head with the selected account (pages of 100 until
  every referenced path is found). `prTourSnippet` shows the requested lines with two lines of context, removed
  lines in place and a gap between hunks, up to 80 lines. A missing file, a binary or oversized patch and lines
  outside the diff are reported, never reconstructed.
- **Reviewed** checkboxes and the `n/N snippets` counter are a per-profile `localStorage` note keyed by PR URL and
  tour head. They are not a GitHub review or an approval.

## Prompt settings

- Global: `settings.prTour.prompt` (up to 8000 characters), edited in **Settings / Integrations / GitHub / PR
  tour** with Save and **Reset to default**. Absent or blank means `DEFAULT_PR_TOUR_PROMPT`.
- Per repository: `projectSettings.repo.tourPrompt` (up to 8000 characters), edited in **Settings / Project**
  under **Tour prompt for this repository**. Absent or blank inherits the global prompt.
- `effectivePrTourPrompt` applies repository, then global, then default. The PR binding and the reply contract
  are appended after the user's prompt and can't be edited.

## Not done

- No new tool, event type or durable record. The tour lives in the chat transcript, so deleting the chat removes it.
- No tour for Sandbox, Remote or agent-harness chats, and no snippets for an older head.
- No automatic regeneration when the PR changes, and no syntax highlighting in snippets.
- The model's risk, impact and attention ratings are untrusted advice, not a merge or review decision.

Tests: `tests/pr-tour.test.ts` (parser, prompt precedence and contract, status derivation, snippets and the
settings round trip) and `tests/workflow-commands.test.ts` (a `pr-tour` turn's model write is denied).
