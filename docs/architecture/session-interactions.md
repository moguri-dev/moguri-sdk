# Desktop session interactions

This slice reuses React, Electron, TypeBox, Ghostty Web and Node-PTY (MIT),
the existing SDK, encrypted event store, owned worker and user-terminal broker.
It adds no dependency, external terminal application or terminal parser.

## Shared authority

Protocol/schema 51 adds an additive session-interaction marker. Old settings
normalize archive/delete confirmation preferences to enabled without rewriting
their ciphertext. Session order uses the existing `session.organized` event.
`session.reorder` checks the complete sibling set and every revision before one
atomic append. Pin priority remains separate from order. Attach/detach reuses
the existing same-project, no-active-work, no-model-subagent and acyclic hierarchy
checks; it never transfers a workspace, environment, permissions or model context.
Dropping on a session attaches; sibling edge targets reorder; dropping on the
owning project or Chats group detaches. Keyboard menu actions provide the same
operations. Other profiles and projects cannot be adopted by a drag payload.

Session actions open from right-click, a macOS two-finger click, Context Menu or
Shift+F10. Ordinary click opens the chat. Archive is not a chat-header action.
Routine archive/delete confirmation preferences are profile-owned settings, not
permissions, automatic deletion grants or a way around project/artifact review.
Failure to save a requested preference prevents the action; failed resource
cleanup still blocks deletion. Independent artifacts and repository files survive.

## Explicit plans and questions

Only an acknowledged owning-model `task_progress` plan action with at least two
steps creates a task checklist. A chat turn, prose message or existing repository
plan file does not synthesize one. `task.plan_updated` retains its actual
model/step/call, turn, binding, revision and complete bounded steps in the session
compartment. Checkmarks remain model advice, not acceptance or tool permission.
Unknown/cancelled ownership cannot publish a late plan. The desktop checklist and
completion estimates live only in the Plan sidebar, never above the composer.
The existing explicitly opened workspace-plan-file editor and its SDK/CLI/TUI
save/retention transports remain separate from this model task checklist.

Every model clarification offers Other with an explicit text submission.
`question.answer` carries an optional `other: true` and retains that actual-user
choice. Ordinary strict-choice answers and automatic technical-choice delegation
keep their original offered-choice checks. Other cannot impersonate a model
answer, consume an unrelated draft, answer another turn or approve an action.

## Work and terminal lifecycle

Resuming held prompts admits one prompt per turn, waiting for the owning run to
settle before starting the next. It never answers a pending question, concatenates
held prompts, starts parallel turns or replays interrupted work. Existing failure,
cancellation, policy, accounting and root-writer gates remain authoritative.
New stop requests explicitly record `holdQueue` when future prompts must pause.
Legacy stop events retain their old interpretation. Explicit Interrupt keeps its
separate next-turn behavior; stopping or restarting never resumes held work.
While a turn runs, a nonempty draft plus Cmd/Ctrl exposes Hold in the primary
button; a successful queue submission restores Stop without cancelling the turn.

Closed terminals disappear from the visible selector, not from retained ownership
or cleanup evidence. The embedded renderer remains Ghostty. Default shells resolve
on the actual execution host, including its account login shell when a desktop
launch omitted SHELL. A bounded allowlist preserves shell configuration locations
without forwarding control-plane credentials or Node/DYLD injection. No external
Ghostty, iTerm or Terminal.app is launched, and no personal configuration is read
by tests. Unconfirmed owners are never hidden or replaced.
The initial sidebar admission and explicit Open/plus buttons share a pending gate,
so opening the panel cannot race another click into creating duplicate consoles.

## Required evidence

Use generated fixtures for sibling-order races, cycles and cross-profile/root
refusal; legacy ciphertext-preserving upgrade and restart; custom answers,
stale revisions and explicit answer actors; model-plan ownership and cancellation;
serial queue admission; shell resolution and credential exclusion; and hidden
native context-menu, drag, confirmation, panel geometry and modifier interactions.
Qualify the packed external SDK, actual development bundle, build and audit before
publication. Record measured prerequisite and qualification results here.

## Fresh prerequisites

The generated baseline commands completed before implementation. Passed probes:
provider cancellation 32.05 ms; SQLite append p95 0.045 ms and rebuild 0.523 ms;
known PTY-group cancellation 151.06 ms with zero fixture survivors; TUI updates
16.93 ms; hidden Electron cold start 188.13 ms, 447.53 MiB and 8.28 ms/frame;
2,000-file search/Git 0.931/5.991 ms; independent retention 112.13 ms; actual
hidden Ghostty 24.50 ms; model-control transport checks 81.66 ms.

The baseline still labels live provider entitlement, Rust/Linux supervision,
Apple-signed/notarized packaging, a native guest, model-routing quality, live
decision providers, personal SSH and its original full-attachment acceptance
matrix FAIL/unqualified. These are the baseline's separate gates, not capabilities
silently enabled by this UI slice. Later qualified contracts are not replaced by
those initial-checkpoint labels. No personal login, shell, clipboard, microphone
or paid inference was a prerequisite fixture.
