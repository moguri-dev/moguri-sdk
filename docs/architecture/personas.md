# Taggable personas

Protocol 119 delivers [#10](https://github.com/mbianchidev/moguri/issues/10):
opt-in, named personas with stable `@handle`s that work in linked subsessions
when tagged. The decision record is
[D67](decisions.md#d67-taggable-personas-under-an-implicit-orchestrator).
Personas reuse sessions, coordination links, approvals, budgets, skills and
[automations](automations.md); they are not a second agent engine.

## Change contract

- **Reused, no new dependency.** Node.js 26, TypeBox (MIT), React, Electron,
  OpenTUI, the existing session/coordination model, intake timer and
  automations.
- **Invariants.** Personas start disabled. Only actual-user commands create,
  enable, pause, edit or delete them. A mention, role name or model output
  grants no permission. Runs are attributed to the persona and run, never to a
  fabricated user answer.
- **Events and schema.** `persona.recorded`, `persona.run_recorded`, marker
  `personas_schema`. Pre-119 stores with either are refused; migration only
  inserts the marker.
- **Cross-client.** Service-owned commands through the SDK; desktop, TUI and
  CLI share the snapshot (`personas`, `personaRuns`).
- **Failure and cancellation.** Runs bind the exact child task; stops are
  recorded as requested and settle from the actual turn outcome; restart never
  re-dispatches.

## Definitions

| Field | Meaning |
| --- | --- |
| `handle` | 2 to 32 characters `[a-z][a-z0-9-]*`, unique among non-deleted personas. Broadcast-like names (`all`, `here`, `everyone`, `moguri`, `orchestrator` and others) are reserved. |
| `name`, `description` | Shown in clients and the persona's brief. |
| `instructions` | Up to 4,000 characters, sent with every task. |
| `projectId` | Scope: one project, or null for every project and project-free chat of the profile. |
| `modelId` | A fixed model, or null for the tagging chat's model. An unavailable model blocks the run; nothing is substituted. |
| `access` | `read-only` (question-only subsession) or `agent` (writable). Both start under Manual autonomy. |
| `skills` | Up to 20 skill names the brief asks the persona to load when relevant. Guidance only. |
| `budget` | A per-run session budget, or null. Combined with the tagging chat's budget, the stricter limit wins; a limited budget needs `basis: "estimate"`. |
| `timeoutMinutes` | Stop condition: 1 to 1,440 minutes after the subsession starts. |
| `output` | `reply` or `report` (Summary, Findings, Recommended next steps). The final reply always returns to the tagging chat. |
| `mention` | Start when tagged. Schedules use an automation whose prompt tags the persona. |
| `status` | `disabled` (new), `enabled`, `paused` or `deleted`. Pausing or deleting stops new runs; active runs continue unless stopped. |

Presets are ordinary definitions: **Product Manager** (`@product-manager`,
read-only research, requirements and measurement plans, never installing
analytics or sending data without explicit approval), **Maintenance**
(`@maintenance`, dependency and repository chores, never merging or pushing
without approval) and **Docs** (`@docs`, documentation that matches the code).

## Tagging and the orchestrator

1. When a turn starts from user-authored input (typed, held, scheduled-prompt
   or queued work) or an automation prompt step, the service reads `@handle`
   mentions outside code spans, emails and paths. Each enabled persona in scope
   with `mention` on gets one `starting` run in the same transaction (at most
   8 per turn; the run ID derives from the turn and persona, so a turn
   dispatches each persona once). Disabled, paused, unknown or out-of-scope
   mentions start nothing. Only agent chats dispatch: delegated tasks,
   lifecycle turns, commands, workflows, project work prompts (which embed
   untrusted issue text), automation script steps, steers into a running turn
   and subagent, side or metachat sessions never do.
2. After startup recovery, a single-flight launcher rechecks the run, the
   persona's exact enabled revision and the tagging chat, then creates the
   persona's subsession titled `@handle · Name` under the tagging chat. The
   subsession, its user-delegated coordination link, the task message and
   queue item, and the run's `running` update commit together. Sandbox and
   grouped-repository chats are refused without a Local fallback, and a
   writable persona cannot start from a read-only chat.
3. The task is the persona's brief (who tagged it, instructions, skills,
   access, output, and that tagging grants no permission) followed by the
   exact tagged text, within the existing 8 KB delegated-task bound; nothing
   is truncated.
4. The tagging chat is the implicit orchestrator. It receives a service notice
   (`coordination.message`, origin `service`) naming the persona and
   subsession, and the persona's reply as the existing automatic result
   message. It can use `wait_session` and `session_context` on the
   subsession. Read-only personas can work at the same time; writable personas
   take turns under the existing writer leases.

## Runs

A `PersonaRun` records the persona and revision, handle, trigger (`mention` or
`automation`), source (chat, turn, item, actor `user` or `automation`, and the
automation run), the subsession, its exact task item and turn, captured
controls, deadline, requested stop and status.

- **Progress.** The child's turn that starts the exact task item binds the run.
  That turn's actual `turn.finished` outcome settles it (`completed`,
  `failed`, `stopped`, `partial`). A failure that automatic model recovery is
  retrying (or has exhausted for now, which a later successful retry can
  reopen) keeps the run running with its time limit; when recovery is blocked
  or cancelled without another outcome, the run ends `failed` (or `stopped`
  after a requested stop).
- **Stop.** `persona.run.stop`, the time limit and deletion with
  `stopRunning` record `stopRequested` (`user`, `timeout`, `deleted`). A
  queued task that has not started is removed and the run is `stopped`; a
  running task's turn, or its waiting automatic retry while the chat is idle,
  is stopped and the run takes the actual outcome, so unconfirmed cleanup stays `partial`. A stop
  never targets a newer turn.
- **Human intervention.** Stopping the subsession (a task that has not started
  is then removed and the run is `stopped`), removing its queued task,
  archiving or deleting it, denying approvals or sending messages there work
  as in any chat and win over the persona. The run records the actual result.
- **Restart.** A `starting` run never created its subsession, so it becomes
  `blocked`; started tasks settle through the existing turn recovery. Nothing
  is re-dispatched.

## Clients

| Client | Surface |
| --- | --- |
| SDK | `sdk.personas.list/runs/presets/get/create/createPreset/update/enable/pause/delete/stopRun`; `personasSummary`, `personaRunLine`, `personasSlash`. |
| Desktop | **Personas** next to Automations: preset buttons, **New persona** and **Edit** dialogs (explicit Save), the **On** switch (saves immediately), facts, instructions, recent runs with **Open tagging chat**, **Open persona chat** and **Stop**, and runs of deleted personas. |
| TUI and slash | `/personas [list|runs|presets|add PRESET|enable @HANDLE|pause @HANDLE|delete @HANDLE [stop-running]|stop RUN_ID]` in every client. Tag with `@handle` in any message. |
| CLI | `moguri personas list | runs | presets | add PRESET | create FILE | update HANDLE FILE | enable|pause HANDLE | delete HANDLE [--stop-running] | stop RUN_ID` (definition files are YAML or JSON). |

## Evidence

`tests/personas.test.ts`: mention parsing (code, emails, paths, files),
definition validation, reserved and unique handles, budget tightening, the
task brief, run projection, derived dispatch and deduplication, paused and
out-of-scope personas, automation-step provenance, exact child binding, model
retry, partial cancellation, queued removal, deletion while working, restart
blocking and the protocol 119 migration; with the generated provider, an
enabled persona's Manual subsession, link, notice and result, the disabled and
out-of-scope cases, a user stop, the time limit, a human stop in the child,
deletion with stop, and restart without re-dispatch.
`tests/e2e/personas.spec.ts` drives the hidden desktop preset, switch, tagged
run and its chats.

## Limitations

- Personas never start from mentions in Sandbox or grouped-repository chats.
- Recurring persona work goes through an automation that tags the persona;
  there is no separate persona timer.
- Writable personas tagged together run one after another on shared files.
- Chats in session groups tag personas like any other chat; there is no
  separate group-level tagging action.
