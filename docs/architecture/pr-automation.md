# Pull request automation

Two independent flags, **Fix broken CI** and **Automatic conflict resolution**,
act on a session's own pull request. Each has a global default in
**Settings / GitHub workflows** and an optional per-repository override in
**Settings / Project**. Both default to off: saving any other preference never
turns new automation on.

## Change contract

This slice reuses Node.js built-ins (MIT), TypeBox (MIT), React and OpenTUI
(MIT), the GitHub CLI (MIT), system Git (GPL-2.0 executable) and the public
[GitHub Status](https://www.githubstatus.com/) API. No dependency is added.
Shared logic lives in `packages/protocol/src/pr-automation.ts`; the service
engine is `apps/service/src/pr-automation.ts`, driven by the existing PR
watcher in `apps/service/src/session-wrap-up.ts`.

Neither flag grants push, merge, rebase, force-push, branch deletion or
authentication. Fix broken CI performs one kind of GitHub mutation, a single-job
rerun, and only within the gates below. Conflict resolution is an ordinary
lifecycle turn that uses the chat's own model, Env, autonomy, approvals, hard
policy and budget.

## Defaults, overrides and exceptions

- Global: `settings.prAutomation = { ciRetry, conflictResolution }`. Absent means
  both off. The switches save immediately.
- Repository: `ProjectSettings.repo.ciRetry` and `repo.conflictResolution`, each
  `"enabled"` or `"disabled"`. Absent inherits the global default. The selects
  ("Use the global default", "On for this repository", "Off for this
  repository") save immediately and show the effective value and its source,
  for example "Now: On (repository override)".
- `effectivePrAutomation(settings, project)` resolves both flags; a repository
  override always wins. Changing a global default never touches overrides.
  Choosing the global default again deletes the override and its exception.
- `prAutomationExceptions(...)` lists every override (repository, flag,
  effective value, global value). Settings / GitHub workflows shows them with
  **Open settings**, which opens that repository's Project settings.
- The values are ordinary settings and project configuration, so desktop, the
  TUI (**Settings / Pull request automation**, plus the JSON editors) and the SDK
  read the same revisioned service state, including after restart.

## Fix broken CI

The PR watcher polls an idle session's PR at most every two minutes for 24 hours
after the round's last finished turn, when the session has a ready Moguri
worktree and the PR's head branch is that worktree's branch. Fix broken CI runs
there only when every gate holds:

- the effective flag is on and the session is Local, not read-only or archived;
- hard policy allows Local, and the tool policy doesn't deny `*`, `github` or
  `run_command` or default to deny;
- the repository reads GitHub with the signed-in GitHub CLI account;
- no exact command rule denies `gh api --hostname github.com --method POST
  repos/OWNER/REPO/actions/jobs/ID/rerun`.

When a gate fails, pending retries for that head are cancelled with the reason.

Once every check on the head has finished, each failed (`failure` or
`timed_out`) check gets one durable record per head and check:

1. **Not an Actions job.** Commit statuses and third-party checks can't be rerun
   by Moguri. The record is `ineligible` with that reason.
2. **Provider health first.** Moguri reads GitHub Status `summary.json` and
   `incidents.json`. The relevant components are Actions, API Requests and Git
   Operations. A non-operational component or an unresolved incident naming one
   of them is **disrupted**: the record is `deferred` with the incident name,
   link, components and observation time. The failure isn't blamed on the
   change, the log isn't judged and the check isn't handed to the model as a
   code failure. An unreachable page, a malformed response, a missing Actions
   component or stale data (an `Age` header or `Date` more than five minutes
   old) is **unknown**, never healthy, and also pauses retries. A green page
   alone never makes a failure retryable.
3. **The job's own log.** The last 512 KiB of the job log is classified.
   Deterministic evidence wins: assertion mismatches, TypeScript/Rust/compile
   errors, unresolved modules and lint summaries make the record `ineligible`.
   Transient evidence (an external HTTP 500/502/503/504, npm `E50x`, HTTP 429
   rate limits, `ECONNRESET`/`ETIMEDOUT`/DNS/TLS timeouts, runner shutdown or
   lost communication) makes it eligible. A resolved Actions incident that
   overlapped the job (with a five-minute margin) also counts as transient
   evidence. Anything else is unclear and is never retried.
4. **Bounded attempts.** At most two reruns per check and head, one minute and
   then five minutes after the failed job finished (`scheduled` until then).
   Before each attempt Moguri rereads provider health (an observation is reused
   for at most a minute), the signed-in account (it must match the record's
   login and numeric ID), the job and the PR head. A changed head, closed PR or
   changed account makes the record `superseded`.
5. **Admission is not success.** The attempt is committed as `admitted` before
   GitHub is called, then `requested`, `failed` (GitHub rejected it) or
   `unconfirmed` (interrupted). The record follows the check's new attempt to
   its actual conclusion: `succeeded` only on an observed success, otherwise the
   result (failure, cancelled, timed out and so on) is retained and the record
   ends `exhausted` once attempts run out.
6. **Cancellation.** `sdk.prAutomation.cancel(id)` (desktop: **Cancel automatic
   retry** in the Code change view) aborts an in-flight request first, which
   settles as `unconfirmed`, then marks the record `cancelled`. A rerun GitHub
   already started keeps running; Moguri never cancels GitHub work.
7. **Restart.** At startup every attempt still `admitted` becomes `unconfirmed`.
   It is never requested again; the watcher only observes whether GitHub shows a
   new attempt and records its result.

Checks that automation is handling (`deferred`, `scheduled`, `requested`,
`succeeded`) are left out of the model's CI follow-up, so it isn't asked to
change code for a flaky job or an outage. The model's CI guidance also tells it
not to rerun jobs itself.

GitLab CI isn't supported: Moguri has no GitLab pipeline binding, so it reruns
nothing there and doesn't consult GitLab Status.

## Automatic conflict resolution

When GitHub reports the session's PR as not mergeable (`mergeable: false` or
`mergeable_state: "dirty"`) and reports its base ref and SHA, the watcher
queues a `conflicts` lifecycle turn, once per head and at most twice per round.
The same commit retains a `conflict-resolution` record bound to the PR, head,
head ref, base ref and base SHA. This runs even when review/CI follow-ups are
off.

The turn's guidance is a fixed protocol: stop and ask if anything is
uncommitted; fetch the base and confirm the head; merge it with
`git merge --no-ff --no-commit` (never rebase, force-push, `-X ours/theirs` or
`checkout --ours/--theirs`); for each conflicted file name both sides' features
and write one result that keeps both; run the relevant tests, type checks,
linters and builds; commit and push only when both features survive and checks
pass; otherwise `git merge --abort`, leave the conflict and ask with `ask_user`.

The wrap-up turn keeps its existing conflict step either way (the user's
decision for this slice). With the flag on, the wrap-up commits first and then
uses the same protocol.

After the turn finishes, Moguri verifies the worktree read-only with hooks,
filters and fsmonitor disabled; it never touches the index or files:

| Status | When |
| --- | --- |
| `merged` | HEAD moved, contains both the original head and the base, no merge is in progress, and no conflicted file (`git merge-tree --write-tree --name-only`) equals either side's blob or still has `<<<<<<<`/`>>>>>>>` markers. CI on the new head is still the validation to check. |
| `paused` | The merge is still in progress, files are unmerged, or no merge was committed. Both originals are kept for review. |
| `needs-review` | History was rewritten (HEAD lacks the original head), a conflicted file equals one side, or markers remain. |
| `unverified` | HEAD moved without the base, or the worktree couldn't be inspected. |
| `stopped` | The turn was stopped or failed, or its queue item was removed before it started. |

Stopping or removing the queued turn uses the chat's normal controls.

## Durable state

Protocol and store **113** add `pr_automation.recorded` (one record per CI
check/head or conflict, monotonic revisions, immutable session/PR/account
binding, append-only attempts whose job and admission never change, final
terminal outcomes), `settings.prAutomation`, the two repository override fields
and the optional lifecycle `automation` and `conflicts` facts. Lifecycle items
carry `automation` only while a flag is on, so default wrap-ups keep their
earlier shape. Migration 113 atomically adds the `pr_automation_schema` marker;
the lineage check refuses any of this history in pre-113 state, and
`removePrAutomationFixtureMarker` mirrors it for legacy fixtures. Records are
session-scoped events and leave the snapshot with their session.

## Tests

`tests/pr-automation.test.ts` covers inheritance, overrides, exceptions and
restore; flaky HTTP 5xx versus deterministic, unclear and non-Actions failures;
healthy, down, active-incident, recovered, unreachable and stale status data;
backoff, the two-attempt bound, changed heads and accounts; pending and
in-flight cancellation; settings-driven cancellation; restart recovery without
replay in memory and through an actual service restart; persistence across two
clients and restart; the pre-113 lineage refusal; Git conflict fixtures where
both features survive and their generated tests pass, where `-X ours` silently
drops a feature, where markers remain and where the merge is left in progress or
aborted with an unrelated edit and the index intact; and the watcher queuing one
bound conflict turn with follow-ups off and verifying its worktree.
`tests/e2e/pr-automation.spec.ts` covers the switches, exception list,
**Open settings** and the repository selects in hidden Electron.
