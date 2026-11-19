# Saved drafts on close and interrupted chats

Protocol 114 delivers two owner requests from 2026-11-19
([D50](decisions.md#d50-save-drafts-on-close-and-continue-interrupted-chats)):
draft prompts survive closing and restarting the app, and chats that were
working when Moguri stopped can be picked up again with Continue, Continue all
and a "don't ask again" choice.

## Owner decisions (2026-11-19)

- **Close and quit save first.** Closing the window or quitting finishes saving
  composer drafts and an open in-place edit of a queued prompt, then closes
  without asking. The "Draft not saved" dialog appears only when saving actually
  fails. Explicit-save values (Settings text, panel editors, profile changes)
  keep the existing "Unsaved changes" confirmation.
- **What counts as interrupted.** A chat whose running turn a quit, service
  restart or crash stopped, and a chat whose queued prompts were waiting to run.
- **Continue** sends the built-in continue workflow (inspect the current state,
  never replay earlier effects) and releases the prompts that were waiting.
- **Don't ask again** saves "Continue all automatically", so later restarts
  continue every interrupted chat without asking. It can be changed in
  Settings.

## Drafts on close

Composer drafts already save to the service about 200 ms after each edit. The
gap was closing in that window or while a save was in flight, which showed an
"Unsaved changes" dialog, and an open queued-prompt edit, which was silently
dropped.

1. The renderer's `beforeunload` blocks the close when a draft is dirty or
   saving, or a queued-prompt edit differs from its saved prompt, and tells the
   main process why through a synchronous `moguri:unload-blocked` message
   (`drafts` or `edits`).
2. For `drafts`, the main process keeps the window open without a dialog. The
   renderer flushes every `DraftEditor` and saves open queued-prompt edits with
   the ordinary `queue.edit` command (the same as pressing Save), bounded to 10
   seconds, then reports `moguri:drafts-settled`.
3. On success the main process closes the window again, so the original window
   close (service keeps running) or Quit (service stops) continues. On failure
   or after 15 seconds without a report it shows **Draft not saved** with **Keep
   Moguri open** or **Close without saving**.
4. For `edits`, the existing **Unsaved changes** dialog is unchanged.

A draft conflict with another client counts as a failure, so neither version is
overwritten. A queued prompt that the service already claimed keeps its
existing "sent or removed before your edit was saved" notice. An abrupt kill of
the app process can still lose the last unsaved keystrokes; there is no second
local copy of draft text outside the encrypted store.

## Interrupted chats

### Recording

`session.interruption_recorded` (session event) sets or clears
`Session.interruption`:

| Field | Meaning |
| --- | --- |
| `cause` | `shutdown`: an explicit quit, a service restart or an encrypted-store move stopped the work. `restart`: the service found a turn still running after an unclean stop. |
| `turnId` | The ordinary agent turn that was running, or null. External tool turns, automation script steps and control turns (compaction, generation, roles) are not continued. |
| `queuedItemIds` | Prompts that were waiting to run: unheld, non-steer queue items in a chat that was running or queued and not paused. Prompts the user held stay held. |
| `at` | When it was recorded. |

- **Graceful stop.** Before `close()` stops running turns, the service records
  the interruption of every agent or Ask Moguri chat that is running or queued.
  Stopping then holds the queue and ends the turn `stopped` as before.
- **Unclean stop.** At startup the existing recovery marks an unfinished turn
  `partial` and pauses a recovered queue. The service records the interruption
  first, unless the graceful path already recorded it for the same turn.
- The record clears on Continue, an explicit Resume, Dismiss, any new turn and
  archiving. Projection rejects a record whose turn or prompts don't match the
  chat at that point in the event stream.

### Continue

`session.continue` requires a recorded interruption and an idle chat, keeps the
existing Resume check that interrupted command jobs were inspected, and, when
work will run, checks current policy, Env readiness and model availability. In
one transaction it releases exactly the recorded prompts, records
`session.resumed` (clearing the restart's workspace block, as an explicit Resume
does) and, when a turn was running and the chat has an original task without a
pending question or approval, queues the built-in `continue` workflow ahead of
the released prompts. The continue workflow inspects the latest outcome and
current state and never replays a failed, partial or unknown tool, Git, model
or external effect. Approvals, budgets and autonomy are unchanged.

`session.interruption.dismiss` only clears the record; held prompts stay held
and the chat stays paused until the user acts.

### Continue all automatically

`settings.interactions.continueInterrupted` is `ask` (default) or `always`.
With `always`, the service continues every interrupted chat once, after startup
provider discovery settles, so a model is available. A chat that can't continue
(for example a missing model, a denied Env or an uninspected command job)
keeps its record and gets a `session.blocked` notice with the reason. Nothing
is retried in a loop: a record is consumed by the continuation that clears it.

## Clients

| Client | Surface |
| --- | --- |
| Desktop | After connecting, **Continue interrupted work?** lists each chat with **Open**, **Dismiss** and **Continue**, a **Don't ask again: continue all automatically after a restart** checkbox, **Not now** and **Continue all**. It appears once per interruption per app launch and never with `always`. A chat with a record shows **Interrupted when Moguri stopped** with **Continue** and **Dismiss**. **Settings / Confirmations / Interrupted chats after a restart** saves immediately. |
| TUI | A notice names interrupted chats once per interruption. `/interrupted [list|continue ID|continue all|dismiss ID|always|ask]`. |
| CLI | `moguri interrupted [list|continue ID|continue all|dismiss ID|always|ask]`. |
| SDK | `sessions.interrupted()`, `continueInterrupted(id)`, `continueAllInterrupted()` (per-chat results), `dismissInterruption(id)`; `executeInterruptedCommand` is the shared helper. |

## Schema and migration

Protocol and store schema 114 add the `interrupted_sessions_schema` marker
(alongside `automations_schema`), `session.interruption_recorded`, the optional
`Session.interruption` projection field and
`settings.interactions.continueInterrupted`. The migration only inserts the
marker; a pre-114 store containing the event or setting is refused without
deleting state. No new dependency.

## Evidence

- `tests/interrupted-sessions.test.ts`: a quit records the running turn and
  the waiting prompt but not a user-held prompt; Continue runs the continue
  workflow first, then the waiting prompt, without replaying anything and
  keeping the held prompt held; a simulated crash records a `restart`
  interruption; Dismiss and an explicit Resume settle it; `always` continues
  once after restart and not again after a later clean restart; the pre-114
  lineage refusal.
- `tests/e2e/draft-persistence.spec.ts` (hidden Electron): closing the window
  right after typing saves the composer draft and an open queued-prompt edit
  without a dialog, and the draft is in the composer after relaunching; after a
  quit the restart prompt lists the interrupted chat, the chat shows its
  notice, and **Continue all** with **Don't ask again** continues it and saves
  `always`.
