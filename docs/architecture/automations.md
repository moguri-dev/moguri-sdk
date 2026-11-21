# Automations: recurring schedules and declarative workflows

Protocol 115 delivers [#6](https://github.com/mbianchidev/moguri/issues/6):
service-owned automations that run a prompt or a declarative combination of
prompts and repository-trusted scripts once or on a recurring schedule. The
decision record is [D50](decisions.md#d50-recurring-automations-and-declarative-workflows);
[D58](decisions.md#d58-project-free-automations-and-automation-runs-in-inbox)
adds project-free automations and Inbox entries for runs (protocol 117).
One-time scheduled prompts in an existing chat
([recovery and scheduling](recovery-scheduling-kupo.md#scheduled-prompts)) are
unchanged and remain a separate, lighter feature.

## Owner decisions (2026-11-19)

The project owner chose each of these from concrete options:

- **Each run starts a new chat** in the automation's project with the captured
  model, Env, autonomy and budget, so every run has its own outcome, usage and
  artifacts. Runs never queue into an existing chat.
- **Script steps are model-free.** The service runs the exact
  repository-trusted entrypoint directly, Local only, rechecking the trust
  baseline, under normal approval for the captured autonomy. No model call.
- **Missed occurrences run once** when Moguri is back (sleep, quit or restart)
  and the run records how many earlier occurrences it covered.
- **Overlapping occurrences are skipped** while the previous run is still
  active, and the skip is recorded as its own run.

On 2026-11-20 the owner asked that an automation can have no project and that
automation runs are notified in Inbox (D58, see
[Project-free automations](#project-free-automations-protocol-117) and
[Inbox entries](#inbox-entries-protocol-117)).

## Definitions

An automation is a profile-owned record (`automation.recorded`) with:

| Field | Meaning |
| --- | --- |
| `projectId` | The explicit project every run uses, or `null` (protocol 117) for a project-free automation whose runs start ordinary project-free chats. |
| `schedule` | `once` (exact instant with its local time and UTC offset), `interval` (every 15 to 43,200 minutes), `daily` (wall time) or `weekly` (weekdays plus wall time), always with an IANA `timeZone`. |
| `steps` | 1 to 10 steps run in order: `prompt` (up to 16,384 characters) or `script` (repository-relative `path`, `interpreter` and optional `args`). |
| `controls` | Full captured controls resolved once from the project defaults (global and profile defaults without a project) plus explicit overrides: Env, model, autonomy, budget and model options. Later default changes do not alter them. |
| `status` | `active`, `paused` or `deleted`. Deleted definitions leave the snapshot; their runs' chats are kept. |
| `nextAt`, `anchorAt` | The next occurrence (only while active) and the interval anchor set by each activation or edit. |
| `commandId`, `commandDigest` | The actual-user command behind the current revision. Timers never author one. |

A definition with any script step must use Local and have a project. Sandbox
and Remote never inherit repository trust, a project-free automation has no
repository trust, and nothing falls back to Local.

### Project-free automations (protocol 117)

With `projectId: null` each run creates an ordinary project-free chat through
the same `session.create` path as any chat without a project. A Local run
captures the configured Home binding (`homeRoot`) exactly as described in
[project-free execution](project-free-execution.md); a Sandbox or Remote run
never acquires that Local root. No synthetic, inherited or last-used project
is created or borrowed, and the chat stays project-free. Project-free
automations hold only prompt steps; a script step is refused with
`automation_script_project`. The project choice is fixed at creation.

### Readable workflow files

`moguri automations create FILE --project ID` (or `--no-project`) reads YAML or JSON:

```yaml
name: Morning dependency check
schedule:
  kind: weekly          # once | interval | daily | weekly
  days: [1, 2, 3, 4, 5] # 0 = Sunday
  time: "09:00"
  timeZone: Europe/Rome
controls:               # optional overrides of the project defaults
  autonomy: Manual
steps:
  - prompt: Summarize open dependency pull requests and failing checks.
  - script: scripts/check-deps.sh
    interpreter: sh      # sh | bash | node-module | node-commonjs | python3
    args: [--quick]
  - prompt: Write a short report of what the script found.
```

`once` takes a local `at` (`YYYY-MM-DDTHH:MM`) and resolves its first
occurrence in `timeZone`; a nonexistent DST wall time is rejected. `interval`
takes `minutes`. The canonical `{kind: "prompt", text}` form is also accepted.
`parseAutomationWorkflow` validates the parsed object; YAML parsing stays in the
Node CLI so browser SDK entrypoints don't load a YAML parser.

## Schedule semantics

- **Explicit activation.** A new automation runs only when the user turns it on
  (`enabled: true` at creation or `automation.enable`). Activation, edits and
  pausing are actual-user commands; a timer only advances `nextAt` and records
  runs.
- **Wall times and DST.** Daily and weekly times are wall-clock times in the
  automation's timezone. A time that does not exist on a spring-forward day
  runs once, shifted forward by the gap (02:30 becomes 03:30). A repeated time
  on a fall-back day runs once, at its first occurrence. Intervals count real
  elapsed minutes from the anchor and ignore DST.
- **Missed occurrences.** When the timer fires late, every due occurrence is
  coalesced into one run for the latest due occurrence. `missed` counts the
  earlier ones (up to 1,000). `nextAt` moves to the first occurrence after
  now. Nothing replays a burst.
- **Overlap.** If a run of the same automation is still `starting` or
  `running`, the occurrence is recorded as a `skipped` run with the active
  run's ID and no chat. **Run now** is refused with the same reason.
- **Once.** After a once automation fires, it stays active with no next time.
  Turning it on again needs a future time.

## Runs

Each run (`automation.run_recorded`) captures the definition revision, its
steps and controls, the trigger (`schedule` or `manual`), the occurrence with
its local time and offset, the missed count and the authorizing command. Its
status moves `starting` → `running` → `completed`, `failed`, `stopped`,
`partial` or `blocked`; `skipped` and early `blocked` runs are terminal at
creation. Each step has its own status (`pending`, `queued`, `running`,
`completed`, `failed`, `stopped`, `partial`, `skipped`, `blocked`), queue item
and turn.

1. The timer or **Run now** retains the `starting` run before any effect.
2. The run creates its chat through the ordinary `session.create` path, so a
   Local Git project gets its default managed worktree and a project-free Local
   run gets the captured Home binding, and atomically records the chat and
   queues the first prompt step.
3. A prompt step is an ordinary queued turn marked with
   `QueueItem.automation`. It uses the chat's admission, approvals, budgets and
   policy; it cannot be edited in the queue, steered or sent early.
4. When a step's turn finishes `completed`, the same transaction queues the
   next step. Any other outcome ends the run with that outcome and skips the
   remaining steps. The last completed step completes the run. A transient
   model failure that the existing automatic model recovery will retry keeps
   the step running until the retried turn finishes; when recovery gives up
   (exhausted, blocked or cancelled) the run fails.
5. A script step starts once the chat is idle (no turn, queued input, pending
   approval or question, for example a wrap-up turn) and its worktree is
   ready; until then it stays queued. It
   becomes an external tool turn in the run's chat with a pending approval
   unless the captured autonomy approves automatically. At dispatch the service
   rechecks the project's actual-user repository trust, the script bytes and
   dependency inputs, retains a `repository.script_reserved` attempt that names
   the automation run and step, and runs the script under the existing
   supervisor. A denial stops the run.

Runs and definitions are profile/project events, independent of the run
chat's retention: archiving or deleting a chat ends a run that had not started
its current step, and the run record stays.

## Inbox entries (protocol 117)

Every run is reported in Inbox (`Attention.reason: "automation"`, type
**Automation runs**). The service derives the entries in the same transaction
as the run record:

- **Start:** when the run's chat exists (`running`), one `bell` entry links to
  that chat.
- **Outcome:** when the run ends `completed` (a `done` entry), `failed`,
  `stopped`, `partial`, `blocked` or `skipped` (a `bell` entry). The outcome
  clears the run's still-active start entry, so Inbox shows the latest state of
  each run. A run that never created a chat (skipped, or blocked before
  creating it) has no `sessionId`; desktop links it to Automations.

`Attention.automation` copies the run ID, run revision, name and status, so
the entry stays readable after the run leaves the snapshot's recent-run
window; the description adds the run's diagnostic while it is available. The
projection refuses an entry that does not match its exact run, profile, chat,
project, revision or status. Each run status is raised at most once: reading,
deleting or the chat's own activity never brings an entry back or clears it
early. Entries use the existing read acknowledgement, deletion, in-app dots and
OS banner preferences (preview content off shows only "An automation run
started", "completed" or "needs inspection"); they play no needs-input sound.
Opening the run's chat marks its entries read like other chat notifications.
Reading, opening or deleting an entry is not an answer or approval, and never
resumes, stops or reruns a run.

## Cancellation

- **Stop** on the run (desktop **Stop**, `/automations stop`, `moguri automations stop`,
  `sdk.automations.stopRun`) stops the run's chat. A running step settles as
  `stopped` (or `partial` when effects are unconfirmed) and later steps never
  run. A queued step that has not started is removed and the run ends `stopped`.
- Stopping the chat itself has the same effect.
- **Pause** stops future occurrences only; an active run continues.
- **Delete** refuses while a run is active unless the user confirms stopping it
  (`stopRunning`), mirroring D44. That run stays in the snapshot until it
  settles, so its stop and queued step are handled like any other run.

## Restart and no replay

- A run still `starting` at restart is `partial`: its chat or worktree creation
  may be incomplete. Nothing is recreated.
- A step whose turn was running is settled by the existing restart path
  (`turn.finished` `partial`), which ends the run `partial`.
- A script step that had not started is `blocked`; use **Run now** for a new
  run.
- A queued prompt step stays queued, and the chat follows the existing
  "Saved queue recovered" rule: it waits for an explicit Resume or
  [Continue](interrupted-sessions.md).
- An overdue active automation fires once after restart and coalesces its
  missed occurrences. Script step intents carry a deterministic identity so a
  missing receipt cannot start the same step twice.

## Permissions, Env and budget

Automations grant nothing new. Each run uses its captured controls, and every
run rechecks current hard policy, allowed Envs, Env readiness and model
availability before creating its chat; failures record a `blocked` run with
the reason and never substitute a model, Env or Local fallback. Push, merge,
rebase and other privileged actions still need explicit user action or
delegated policy through normal approvals. Usage, estimated cost and artifacts
are the run chat's own, through the existing ledger.

## Clients

| Client | Surface |
| --- | --- |
| SDK | `sdk.automations.list/runs/create/update/enable/pause/delete/runNow/stopRun`; `create(null, ...)` makes a project-free automation and `list(null)` lists them; `Snapshot.automations` and `automationRuns` (latest 50 runs per automation plus every active run); run entries through `sdk.attention.list({ type: "automation" })`. |
| Desktop | **Automations**: each automation's schedule, next run, project (or **No project**), captured controls, steps, recent runs with **Open chat** and **Stop**; **On schedule** switch saves immediately; **New automation** and **Edit** use a dialog with an explicit Save, and its **Project** select offers **No project**. **Inbox** lists run starts and outcomes. |
| TUI | **F9 / Automations** lists automations with **Run now** and **Pause** or **Turn on**; `/automations [list|runs ID|enable ID|pause ID|run ID|stop RUN_ID|delete ID [stop-running]]`. |
| CLI | `moguri automations list [--project ID|--no-project]|runs|create FILE (--project ID|--no-project) [--paused]|update ID FILE|enable|pause|run|stop|delete [--stop-running]`; `moguri inbox list` shows run entries. |

## Schema and migration

Protocol and store schema 115 add the `automations_schema` marker,
`automation.recorded`, `automation.run_recorded`, the optional
`QueueItem.automation` and `TrustedScriptAttempt.automation`. The migration
only inserts the marker. A pre-115 store containing any of these, or a
premature marker, is refused without deleting state. Protocol 117 (unreleased)
makes `projectId` nullable on automations, runs and `automation.create`, and
adds the `automation` attention reason with the optional
`Attention.automation`; existing rows stay valid, so there is no new event
type, marker or row migration. Reused libraries: TypeBox
(MIT) for schemas and `yaml` 2.9.1 (ISC, already a runtime dependency) for
workflow files. No new dependency.

## Evidence

`tests/automations.test.ts` uses the generated intake clock and fixture
provider: DST gap and overlap, weekdays, intervals and missed-occurrence
coalescing; explicit activation and pausing; a new chat per run chaining two
prompt steps; an overlapping occurrence skipped and Stop without later steps;
missed occurrences coalesced after restart; graceful-shutdown and simulated
crash recovery without replay; a model-free trusted script step under Manual
approval and the missing-trust block; the workflow file parser; and the shared
`/automations` helper across two SDK clients. Protocol 117 coverage in the
same file: a project-free automation run by **Run now** and by its schedule in
new chats with the captured generated Home and no project, script steps
refused without a project, start and outcome Inbox entries with read
acknowledgement that answers nothing, OS banner text under both preview
settings, a forged entry refused by the projection, and skipped, stopped,
blocked and restart-`partial` entries. `tests/e2e/automations.spec.ts` drives
the hidden desktop dialog, **Run now**, **On schedule**, **Open chat**, the
**No project** choice and the Inbox entry.

## Personas and dependency roundups (protocol 119)

An automation prompt step that tags an enabled [persona](personas.md) starts
that persona in a subsession of the run's chat, recorded with the automation
run as its trigger. [Dependency roundups](dependency-roundups.md) reuse these
schedule types, DST rules, missed-occurrence coalescing and the shared timer
for their own model-free runs, which need no chat and are not automation runs.

## Limitations

- Runs need the Moguri service running. Nothing wakes the Mac or runs on a
  server; delegating automations to a server stays deferred.
- Steps carry no attachments, and a run's chat starts without earlier context.
- Script steps run only Local repository-trusted entrypoints; arbitrary
  commands, reviewed URL scripts and Sandbox or Remote scripts are not steps.
- Sandbox runs follow normal Sandbox chat admission, including private
  workspace review; they are not separately qualified on native hardware here.
- Triggers other than time (events, webhooks, CI) are not part of #6.
