# Task completion estimates

The completion bar compares the session's actual bound plan checklist with
optional advice from its owning solver. Neither number proves code quality,
acceptance, permission, successful cancellation or overall task completion.
Checked items have equal weight; unchecked work can be much larger.

## Change contract and qualification

Reuse the existing MIT-licensed TypeBox, SDK, React, plan reader, Markdown
ecosystem and authenticated worker delegation. `mdast-util-from-markdown` 2.1.0,
`micromark-extension-gfm-task-list-item` 2.1.0 and
`mdast-util-gfm-task-list-item` 2.0.0 are explicit MIT-licensed dependencies
already present through the Markdown renderer. No background model, scheduler
or separate plan database is introduced. Generated checklist, ownership, cancellation, recovery,
scope and client tests qualify this slice.

Protocol/schema 42 adds `session.progress` and `task.progress_reported`. The
additive migration records the new contract without rewriting history,
ciphertext, receipts or existing plans. Reports use the session's existing
encrypted retention compartment and disappear with its deletion.

## Checklist and periodic comparison

Desktop and TUI request the same SDK query on selection, on task/binding changes,
and every 15 seconds while connected. Requests never overlap in one subscription.
The service reads the existing configured plan through the session's actual
Local, pinned SSH or qualified native transport. It never substitutes the Local
checkout. An unavailable plan is unknown, not zero percent or an old cached
success. Project-free chats do not inherit a plan.

Only parsed GFM list checkboxes outside fenced or indented code count. Nested items count
individually. No checklist means an indeterminate bar, not fabricated progress.
The query carries the exact plan digest, path, environment and observation time.
Binding changes during a read invalidate its result.

## Model assistance for long-running tasks

After a minute of owned work, the solver's `task_progress` tool can report a
bounded percentage and short explanation at a safe model/tool boundary. Its
description requests a fresh comparison about once a minute or at a material
milestone. This is part of the ordinary, metered solver loop, not a hidden
periodic model call. A long in-flight inference cannot provide a fresh estimate
until it reaches a safe boundary.

The read action returns the checklist. Reports must bind its exact current
digest (or null when no plan is available), current turn, actual model/step/call,
and acknowledged ownership. A report never changes checkboxes, releases a queue,
answers a question or approves a tool. Like a clarification, this metadata-only
tool needs no extra approval unless explicitly denied by tool policy.

The UI distinguishes **Plan checklist** from **Model estimate**. It labels
estimates stale after two minutes or a plan change and exposes disagreement of
20 percentage points or more. A model's 100% does not finish the task. Terminal
outcomes remain authoritative; later tasks cannot inherit an earlier estimate.
CLI and `/progress` expose the same observation and provenance.

## Source qualification

Generated primitive/API qualification passed 4/4 cases in 1.41 s. The hidden
Electron workflow observed a real 50% to 100% checklist change on the 15-second
poll without inference or a successful task outcome (16.1 s). Type checks and
the production build passed. The existing large Ghostty chunk warning remains.
Generated Markdown parser qualification took 2.14 ms and correctly separated an
indented checkbox example from an actual task. A red regression exposed the
earlier line-based false positive before replacing it with the existing parser
ecosystem.

The required baseline `npm run spike` passed generated Copilot transport
(1,077.86 ms), SQLite (60.50 ms), known-group PTY cancellation (151.85 ms,
zero fixture survivors), TUI (17.13 ms/update), hidden Electron (223.30 ms cold
start, 449.73 MiB), and bounded filesystem/Git (1.04/6.16 ms). Initial setup
failed on missing node-pty; `npm ci` restored the declared dependencies before
rerunning. Live provider entitlement, Rust/Linux, signed packaging, native
SendBox, live routing/decisions and a personal SSH target remain unqualified by
that baseline, not silently accepted by these generated progress checks.
