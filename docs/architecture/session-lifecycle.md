# Session lifecycle

What Moguri does when a request starts and after a round of requests finishes. Every step runs inside the
chat with its own model, Env, autonomy, approvals, hard policy and budget. Nothing here can merge, force-push,
rebase shared history, delete branches or approve its own changes.

## When a request starts

| Step | Where it lives |
| --- | --- |
| System prompt, your instructions, project `AGENTS.md`/`moguri.md` and guidance | `PlatformRuntime.prompt` |
| A Moguri-managed worktree for new single-project Local Git chats | [managed workspaces](managed-workspaces.md) |
| A generated chat name from the first prompt | [chat titles](chat-titles.md) |
| A rename when later requests change topic | `titleRefreshText` in the controller, this page |
| Loading skills that match the request | the enabled skill catalog tells the model to load relevant skills before planning |
| An early draft PR | repository workflow guidance: open it once the first meaningful change is committed and validated |

### Title refresh

Only chats with a model-generated title are eligible (`titleSource: "model"`); a user title is never replaced.
On each `turn.started`, the controller joins the new request with any steers applied since the last naming
record and calls `topicDrift`. A drift needs at least six content words, of which under 15% appear in the
current title or the previous naming source. Stop words and plural/past endings are ignored.

A drift records a `chat.title_recorded` intent with `purpose: "refresh"`. It reuses the bounded naming
pipeline unchanged, including naming before the turn's first solver call: the same model choice, 128-token output, reservation, accounting and no-replay rules,
with `CHAT_TITLE_REFRESH_PROMPT` and the input `{ source: "topic-refresh", currentTitle, text }`. The model
may return the current title; then nothing changes and the record says so. `session.title_generated` for a
refresh requires `titleSource: "model"` at its compare-and-set revision. At most three refreshes per chat;
`chatTitles.refresh: false` turns it off.

## When a round finishes

A round is everything since the latest user-request `turn.started`. When its last request finishes
`completed`, the controller derives one wrap-up in the same transaction as `turn.finished` if all hold:

- `settings.wrapUp.enabled` (default on);
- an ordinary agent chat (not Kanban, side, read-only or archived) with no queued, held-back approval or
  question;
- no lifecycle item in this round yet;
- either successful edits (`edit_file`, `write_file`, `edit_document`, `write_document`, `git_write`) in a
  Moguri-managed worktree since the previous round's wrap-up, or skills loaded while evolution is on.

The wrap-up is a normal queue item with `lifecycle` facts and the visible text "Wrap-up: ...". Its message
is a notice, not user text. The model receives `lifecycleGuidance(facts)`:

1. resolve conflicts with the base first, then commit every remaining change;
2. push and open or update the draft PR, or commit only when the project opted out of PRs;
3. check CI on the PR head, fix a failure this change caused once, and ask the user with `ask_user` when the
   same failure repeats or looks flaky;
4. address unresolved review comments without resolving threads on the reviewer's behalf;
5. with evolution on, propose concrete fixes to the skills used through `propose_skill`;
6. for a delegated chat, send the parent one concise summary with `session_message`.

If the model or Env is unavailable, the session is blocked or its queue is full, the wrap-up is skipped and
logged; `turn.finished` is never rolled back.

## After the wrap-up

`LifecycleFollowUps` (`apps/service/src/session-wrap-up.ts`) runs while `settings.wrapUp.followUps` is on.
For up to 24 hours after the round's last lifecycle turn completed, it checks each idle chat with a ready
managed worktree at most every two minutes. The PR is the session's linked PR or the last PR URL the agent
wrote in a lifecycle turn of this round. Before using it, the watcher checks that the PR head branch equals
the worktree's current branch.

One bounded read gets the PR head, up to 300 reviews and the head's latest check runs. Nothing is retained;
`followUpFacts` decides:

- **Review**: reviews in `COMMENTED` or `CHANGES_REQUESTED` by someone other than the PR author, submitted
  after the last lifecycle turn finished and not handled earlier in the round. Up to three per round. Reviews
  from your own account are ignored, because the agent pushes and replies as you.
- **CI**: every check run on the head finished and at least one ended `failure`, `timed_out`,
  `startup_failure` or `action_required`. One follow-up per head, at most two per round. When the same set
  of checks fails again after a fix, the follow-up is `repeated` and tells the model to stop and ask.
  After that the round gets no more CI follow-ups.

A follow-up is admitted only if the chat is still idle and in the same round. A new request starts a new
round with fresh limits.

## Pull request automation

The same watcher drives [pull request automation](pr-automation.md). When either flag is effective for the
session's repository, it also polls while review/CI follow-ups are off, for 24 hours after the round's last
finished turn (a wrap-up is not required).

- **Fix broken CI** evaluates failed checks before follow-ups are decided. Checks it is handling (paused for a
  provider outage, scheduled, rerun requested or passed on rerun) are removed from the CI follow-up's failing list.
- **Automatic conflict resolution** adds a `conflicts` trigger: when GitHub reports the PR not mergeable, one
  follow-up per head (two per round) carries `conflicts: { id, headSha, headRef, baseRef, baseSha }`, committed
  together with its `pr_automation.recorded` record. `followUpAllowed` admits it from the conflict flag, not the
  follow-up switch. Order: conflicts, then reviews, then CI.
- While a flag is on, lifecycle facts carry `automation: { ciRetry, conflictResolution }`. The wrap-up then commits
  before resolving conflicts with the feature-preserving protocol, and CI guidance tells the model not to rerun jobs.

## Skill suggestions

`propose_skill` is available only with **Suggest skill improvements** (Skills / Optional evolution) on,
which stays off by default. Proposals are pending `capability.proposed` records. Suggestions lists them with
a review step and **Approve disabled** / **Reject**; the Suggestions nav item shows a dot while some wait.
The desktop shows an OS notification for each model proposal when notifications are on and the window is
not focused.

## Durable state

Protocol 113 adds the `conflicts` trigger and the optional `automation`/`conflicts` facts; see
[pull request automation](pr-automation.md#durable-state).

Protocol and store 109 carry the new optional fields: `QueueItem.lifecycle`, `settings.wrapUp`,
`settings.chatTitles.refresh` and `ChatTitleRecord.purpose`. The 109 lineage check refuses them in older
state, and the legacy fixture remover mirrors it. The follow-up watcher's observations live only in memory;
its counters come from durable queue history, so a restart neither forgets nor repeats a follow-up.

## Tests

`tests/session-wrap-up.test.ts` covers drift, guidance, follow-up decisions, the wrap-up in a generated
managed worktree, the watcher end to end with a stubbed PR and title refresh. `tests/e2e/session-wrap-up.spec.ts`
covers the switches and the Suggestions review.
