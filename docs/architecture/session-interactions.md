# Desktop session interactions

This slice reuses React, Electron, TypeBox, Ghostty Web and Node-PTY (MIT),
the existing SDK, encrypted event store, owned worker and user-terminal broker.
It adds no dependency, external terminal application or terminal parser.

## Inline command responses and sidebar menus

The user-directed desktop presentation keeps command responses in conversation
order instead of a retained Commands tray and response modal. It renders the
existing service-owned command execution, original input, status, diagnostic
and immutable SDK result; it does not create user/model messages, execute a
response or change prompt/context retention. The latest ten command records
are read automatically, with an explicit earlier-history control. Reads bind
the profile, session, execution revision and result digest. Owner changes abort
or discard late reads; failures remain visible and the read-only retry cannot
dispatch the command again.

Env, Model, Autonomy, Budget, attachments, delivery, slash/session autocomplete
and the keyboard-only Commands palette use one transient sidebar menu host.
Nested model/effort/window choices expand inside that sidebar. Its source-bound
registration stack hides earlier menus without discarding their state, cannot
maximize over the chat, and preserves the previous sidebar selection/size.
The previous context remains mounted but hidden/inactive: opening a menu never
restarts or terminates a user console, side chat or its draft.

Nonmodal menus do not trap Tab. Explicit menus focus their first control;
autocomplete keeps focus and keyboard selection in the original composer.
Escape or the sidebar close button closes the current menu. Focus returns to
the original connected control after the sidebar becomes visible again, and
never steals focus from a different user-selected field or source. Turn
information uses the retained original SDK telemetry inline beneath its
response, not an overlay or click-time model/context query.

Policy help with an action expands inline and uses ordinary Tab/Shift+Tab, not
a floating action dialog. Its link still opens the exact existing setting,
honors unsaved-edit guards and never grants a permission, clears accounting or
changes a selected mode. Noninteractive tooltip labels remain available.
User-only permission, source, continuation and destructive-action reviews
keep their explicit confirmation dialogs.

This reuses React/ReactDOM and the existing MIT libraries and typed SDK. There
is no dependency, service API, event/schema, migration or provider change.
Generated Phase 0 primitives pass: 500 append-only events/250 independently
retained artifacts in 169.748041 ms, and real Ghostty in hidden strict-CSP
Electron, 108x24 cells in 39.6 ms. No personal shell, clipboard or login is used.
Earlier Native/source acceptance remains tied to its exact cuts: rebuilt
desktop assets differ, while all prior Native worker/service/SDK inputs remain
unchanged. This menu slice requires fresh built desktop checks and does not
claim completion of the remaining #53 sidebar/search/game work or the
account-blocked hosted-main acceptance gate.

The focused real hidden-Electron run passes 47 journeys in 56.6 seconds,
including response reload/order, failed read recovery without replay, original
side-control focus and retained maximized consoles. All 34 shared source/API
checks, types/build and packed external SDK checks pass. The old over-chat
400-pixel budget-popover expectation is replaced by the actual contained-sidebar
geometry, while compact telemetry and navigation protections remain. A newly
exposed hidden-side-trigger focus failure is repaired by restoring only the
original connected control after visibility updates, without stealing a newer
focus. The full rebuilt desktop and actual Native control checks remain
separate final receipts. No tests were removed.

## Direct question answers

Question choices use a single vertical native action list, with its own bounded
scroll region for long/many options. Clicking a row sends exactly that offered
answer. The separate Other field is always visible and initially blank; plain
Enter submits its actual text through `questions.answerOther`, including for
choice-only questions. Shift+Enter retains multiline editing. Composition and
Cmd/Ctrl+Enter in this local field never invent an answer or queued prompt.
The ordinary composer keeps its existing saved-draft/held-input behavior.
Exact Other/Other-please-specify labels use the field instead of a duplicate
catch-all button; the retained model question itself is not rewritten.

Reuse React/Electron and the existing MIT SDK/question APIs. There is no new
dependency, durable schema, migration, event or paid model call on presentation.
Answers retain the exact question revision/turn and actual user actor, not model
advice or permission. Keep the question/advice and option list independently
scrollable so the compact Other field and Stop remain reachable. Failed/stale
submissions preserve Other text and show the actual error; successful submission
clears it only after acknowledgement. Existing side-chat and draft boundaries
remain intact. On short windows the ordinary composer becomes one row while a
question is pending, without clearing its draft or changing its shortcuts.

Before this change the repeated generated macOS arm64 foundation checks passed:
six intercepted provider requests, 32.57-ms cancellation; 1,000 WAL events,
0.065-ms append p95 and 0.485-ms rebuild; owned PTY cancellation 152.78 ms with
zero survivors; OpenTUI 17.69 ms/update; hidden Electron 177.06-ms cold start,
446.52 MiB and 8.16-ms scroll frames; 2,000-file search/Git at 0.95/6.92 ms.
The spike separately returned FAIL/unqualified rows for live Copilot/ds4,
Rust/Linux supervision, signing/notarization, physical SendBox, live kupo
quality/cost, live System One, user-configured SSH and its historical
initial-checkpoint attachments/defaults/budget inventory. Those old inventory
messages are not a current executable capability list; this UI change does not
promote any of those qualification gates to passes.

The final type check/build, eight canonical-question checks and 18 hidden
Electron question/session-interaction journeys passed. Coverage includes
click-to-send exact choices, actual list scrolling and keyboard focus at
840x620, plain-Enter Other submission, composition/queue-shortcut separation,
failed answer persistence with retained text/retry, main/side draft isolation,
advice versus user provenance and cancellation. The current dependency audit
reported zero vulnerabilities. No tests were removed; one earlier partial-result
copy assertion was aligned with the existing enforced-recovery contract without
removing its no-implicit-resume check.

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
Shift+F10. Ordinary click opens the chat; double-click, F2 or contextual Rename
edits its name inline for project and project-free sessions, never in a dialog.
The name is focused/selected, Enter saves and Escape/Cancel leaves it unchanged.
Rename uses the same SDK command and service-owned metadata event without an
unrelated project-configuration read. A changed peer title preserves the local
proposal as an explicit conflict. Unrelated session-revision drift may retry
once only for a known revision conflict with the original title unchanged.
One newly generated factory-title change is also distinguished from a peer's
user rename: the original factory revision and new model source must match,
so the actual inline user edit can win without overwriting another user.
Drafts, workspaces, controls and permissions stay unchanged; saving is not
reported successful before acknowledgement. No schema/migration is added by
this inline editor. Archive is not a chat-header action.
Routine archive/delete confirmation preferences are profile-owned settings, not
permissions, automatic deletion grants or a way around project/artifact review.
Failure to save a requested preference prevents the action; failed resource
cleanup still blocks deletion. Independent artifacts and repository files survive.

The interaction follow-up reran Phase 0 before feature edits on macOS arm64:
six generated primitives pass (six intercepted provider requests, 32.34-ms
cancellation; 1,000 SQLite events, 0.061-ms append p95 and 0.541-ms rebuild;
owned PTY cancellation 150.96 ms with zero survivors; 60 OpenTUI updates at
17.98-ms mean; hidden Electron 196.33-ms startup/446.20 MiB/8.06-ms scroll;
2,000-file search/Git at 0.83/6.34 ms). The baseline's unavailable live-provider,
Rust/Linux, notarization and other historical gates are not promoted to passes.
This reuses existing MIT React/Electron/SDK libraries and adds no dependency.

## Live ordinary input

Protocol 90 adds an explicit SDK `message.send` request delivery `auto`.
Desktop and ordinary TUI Enter use it by default. The service resolves it to
Steer only for the actual active ordinary solver, otherwise an ordinary queue
item. The retained delivery enum remains Queue/Steer/Interrupt; model, private
role, compaction, stopping and user-operation ownership is not guessed.
Slash commands stay ordered, Cmd/Ctrl+Enter stays held, explicit Queue stays
future-turn work and explicit Interrupt retains its cancellation contract.
An open structured question still needs its actual owned answer API.

An admitted live input keeps its exact original turn target and is shown as
acknowledged, waiting for the next safe boundary, not a later queued task or an
unacknowledged local preview. A separate Send now action remains available
beside Stop while composing during a turn. The agent reads real user input
without mechanically cancelling its current operation or discarding prior work.

If an automatic live input arrives after the solver's final boundary, a
successful owning-turn completion atomically converts only that marked input
to an ordinary next turn. Explicit legacy Steer targets never move implicitly.
Stop/partial/failed recovery never makes that conversion or restarts paid work;
held inputs and original partial outcomes remain retained. First-topic naming
uses the [separate source/budget contract](chat-titles.md), not a client title
heuristic or model permission.

## Reliable session reordering

This desktop repair reuses React/Electron (MIT), the existing typed SDK,
`compareSessions`/`sessionOrderScope`, native drag events and owned SVG glyphs.
The original reorder repair added no dependency or durable schema. The
[protocol-60 follow-up](workspace-experience.md#session-navigation-follow-up)
adds the shared detach acknowledgement/preference and its metadata migration.

Whole rows are draggable, with no grip or extra action button. Top/bottom target
halves insert before/after a sibling, including children, never nest the source.
Alt+Up/Down on the focused name and context-menu Move up/down share the same
order path. Attach to session remains an explicit menu action. Root rows and
project/Chats/group headers or backgrounds accept child detachment within the
original project, using one organization command rather than a partial
detach-plus-reorder sequence.
Pin priority, archive, parent/group and profile boundaries are preserved.
Leaving a target removes its insertion cue; invalid targets show no accepted
move cue. Unpin uses a crossed-out pin; Pin and pinned-state markers stay pins.

Dragging binds the original complete sibling set, order and structural scope,
not every unrelated session revision. Live unread, draft, title or turn changes
cannot invalidate an otherwise unchanged arrangement. Drop checks the actual
fixed-profile SDK view and sends fresh complete revisions through the same
atomic service CAS; concurrent membership/order/pin/hierarchy changes refuse
the move rather than overwrite another arrangement. Background UI work does
not disable dragging; the actual pending order/action gate remains effective.

One definitive `revision_conflict` can refresh and retry once only while the
complete original structural intent still matches. The service checks every
revision before appending any order event. Unknown/network/non-revision errors
never retry, and a second failure remains explicit. Attachment/detachment does
not inherit this metadata-only retry or change its existing authority checks.

Drag, Detach and choosing None in the parent dialog share the same default-on
review. It binds the exact original session revision and destination group.
Cancel preserves hierarchy/order and settings; source or destination changes
invalidate review. The remembered opt-out uses profile-owned interactions
settings and can be restored in Settings / Confirmations. The service still
requires explicit acknowledgement when that preference is on, and never
permits model-owned subagents or active work to detach. A failed preference
save prevents the action; a concurrent hierarchy change after saving is checked
again before the final revision-bound command. Ownership and tool policy do
not change.

Fresh prerequisites pass all six available generated groups: cancellation
31.94 ms; SQLite append p95 0.048 ms/rebuild 0.501 ms; owned PTY cancellation
152.72 ms with zero survivors; TUI updates 17.69 ms; hidden Electron cold start
242.80 ms / 443.06 MiB / 8.19 ms per frame; 2,000-file search/Git
0.917/5.957 ms. Separate live/native/notarized/Linux/quality gates remain
FAIL/unqualified, not enabled by this navigation repair.

### Session ordering qualification

Source `287f887` fixes a reproduced native failure: an ordinary unread update
during a real mouse drag changed the full session revision and cancelled the
move. Exact structural intent now survives that unrelated activity, while a
concurrent pin change still refuses the captured move without an order-event
prefix. Unknown/non-revision failures do not retry, and old hover cues clear.
That historical pass used an action-control grip; protocol 60 removes it and
uses the same insertion halves for whole rows. The 6-pixel point, 15-pixel
status glyph and narrow captions remain unchanged.

The first full run also exposed an old keyboard-readiness race: `connect()`
can seed a snapshot before its event channel authenticates. `39e02cd` waits for
the mode switch to be enabled and verifies Attach focus before testing Tab.
It neither bypasses the actual connected gate nor weakens the focus assertion.

| Exact check | Result |
| --- | --- |
| Type checks/build/fresh audit | PASS; zero vulnerabilities |
| Native ordering, hierarchy, keyboard and narrow-row checks | 21 passed / 20.8 seconds |
| Nine new ordering/icon cases repeated twice | 18 passed / 13.8 seconds |
| Atomic sibling CAS/restart/shared-session service checks | 7 passed / 2,708.10 ms |
| Authenticated mode/keyboard case repeated ten times | 10 passed / 19.1 seconds |
| Complete final hidden Electron suite | 153 passed, 2 physical-native skips, zero failures; 155 total / 4.7 minutes |
| Actual external packed SDK/install | All entrypoints/flows pass; all 12 installed-worker probes pass |
| Actual newly packaged hidden app | All ordering/icon/hierarchy/keyboard/narrow-row cases: 21 passed / 21.0 seconds |
| Actual bundle/native distribution | PASS; protocol 54 / SendBox 0.2.4; pinned worker image unchanged |
| Production ZIP/manifest consumer | PASS; 740,546,225-byte archive / 100,592.68 ms |
| Native DMG | PASS; exact Finder geometry/resources and unchanged signed app |

The rebuilt DMG is 754,157,653 bytes, SHA-256
`b3c9b3081f04121b2251d0bfc966d460eb0300d59923dc7fca3d1eea7c27eb4d`.
Earlier installer identities remain historical. The complete 1,294-pass/
14-skip Node baseline is retained, not relabeled: no service/SDK/CLI/TUI/protocol
source changed, and only the focused service checks were freshly rerun.
All ordering fixtures are generated and make no model request. Hidden UI and
owned resources were used, never personal app/browser/account/microphone,
paid inference or administrator installation. An earlier user-opened image
was not closed. Ad-hoc signing, FFI/chunk/optional-icon notices, downstream
SDK-host compatibility overrides and physical-native/notarization/Linux limits
remain unchanged.

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
Read-only side chats render the same question card and exact answer endpoint;
their custom-answer edits cannot switch side owners or consume the parent draft.
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
Releasing the modifier while that request is pending keeps the disabled clock
visible until acknowledgement or failure. Compact control rows wrap without
overlap; popovers stay above the complete toolbar, not a newly wrapped row.

### Composer recovery action

Desktop recovery reuses React/Electron (MIT), the existing Play glyph and typed
`session.resume` command. No dependency, capability, event, schema or migration
is added; CLI/TUI/SDK resume operations and service policy stay unchanged.

An inactive session with an authoritative blocked-session, exact managed-root,
or applicable base-project marker exposes **Resume** in the composer's primary
button, not a separate **Resume after inspection** header action. Failure text
or a partial status alone cannot invent a recovery boundary. The compact icon,
accessible name, inspection warning and form guidance distinguish Resume from
sending a prompt; resuming never claims cleanup succeeded or grants permission.
An active turn retains Stop and the existing explicit Hold override.

Pointer, plain Enter and native form submission call the same existing Resume
operation for the actual selected session, without sending, clearing or replacing
its draft/attachments. No model or nonempty draft is needed merely to acknowledge
an inspected boundary; actual queued execution still passes service admission.
Shift+Enter stays newline, Cmd/Ctrl+Enter stays Hold, and slash commands retain
their explicit action. Existing queued-message controls remain separate.

Resume is single-flight through acknowledgement. Pending work is disabled/
announced; a refusal remains visible with the boundary and draft intact, and
only a new explicit action retries. Disconnect/archive/configuration gates
remain effective. Rendering, reload, typing and changing modifiers cannot
automatically resume, answer a question, approve an action or replay work.

Fresh prerequisites pass all six available generated groups: cancellation
32.58 ms; SQLite append p95 0.049 ms/rebuild 0.567 ms; owned PTY cancellation
152.64 ms with zero survivors; TUI updates 18.05 ms; hidden Electron cold start
251.34 ms / 439.20 MiB / 8.30 ms per frame; 2,000-file search/Git
1.235/6.299 ms. Separate live/native/notarized/Linux/quality gates remain
FAIL/unqualified, not enabled by this desktop presentation change.

#### Composer recovery qualification

Source `b9ee41c` removes the separate header action and reuses the compact
primary slot, without adding a new service operation. The before-fix native
case has no Resume control in that slot. Generated unconfirmed worker startup
creates real service quarantine, rather than fabricating a failed-status badge.
Tests cover project, project-free, shared-base and managed-root recovery,
including a fresh same-root session without a selected model.

Pointer, Enter and native form submission preserve the exact draft/context.
A held/refused request admits only once, shows its original error, retains the
blocked boundary and retries only after a new explicit action. Hold,
Shift+Enter, slash commands, Stop and existing queue/menu behavior remain.
These six recovery cases make no model request and touch no personal data.

| Exact check | Result |
| --- | --- |
| Type checks/build/fresh audit | PASS; zero vulnerabilities |
| Six recovery cases repeated twice | 12 passed / 10.8 seconds |
| Final recovery and existing composer cases | 9 passed / 8.6 seconds |
| Complete hidden Electron suite | 144 passed, 2 physical-native skips, zero failures; 146 total / 4.8 minutes |
| Actual external packed SDK/install | All entrypoints/flows pass; all 12 installed-worker probes pass |
| Actual newly packaged hidden app | All recovery, composer and Start/Stop cases: 14 passed / 18.4 seconds |
| Actual bundle/native distribution | PASS; protocol 54 / SendBox 0.2.4; pinned worker image unchanged |
| Production ZIP/manifest consumer | PASS; 740,545,367-byte archive / 108,514.36 ms |
| Native DMG | PASS; exact Finder geometry/resources and unchanged signed app |

The rebuilt DMG is 754,160,386 bytes, SHA-256
`93c95c1b5533656da69ac86455b8b73134233d7a85405a3b38ef6e3e773b2261`.
Previous installer identities remain historical. The complete 1,294-pass/
14-skip Node baseline is retained, not relabeled as another run: no service,
SDK, CLI, TUI or protocol source changed. Hidden/generated UI and owned fixtures
were used; no personal app/browser/account/microphone, paid inference or
administrator installation was used. An earlier user-opened image was not
closed. Ad-hoc signing, FFI/chunk/optional-icon notices, downstream SDK-host
compatibility overrides and physical-native/notarization/Linux limits remain.

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

## Session status and linked PR indicators

This protocol-54 addition reuses React, Electron and TypeBox (MIT), the existing
GitHub API/explicit `gh` reader, SDK event stream and encrypted store. No library,
executor, model call or client-owned status store is added.

Required user input takes precedence over active work, which takes precedence
over a verified attached-PR merge. Completion is the actual completed session
state, not a held queue, failed/partial/stopped outcome, notification read
acknowledgement or attached URL. Structured questions and permissions retain
their yellow question/pause even when in-app notifications are disabled or
acknowledged. Optional heuristic questions remain labelled possible questions;
they cannot answer a question or approve work.

Active work has a blue pulsing point and rotating loading glyph. Completion has
a green point/check plus a green open-PR or gray draft-PR glyph when applicable.
A verified merge has a purple point/merged-PR glyph. Unknown draft/PR access is
neutral and labelled unverified, never guessed ready or merged. Labels and
distinct glyphs supplement color; selected, hover and normal colors meet 3:1
non-text contrast in light/dark/custom palettes. Reduced-motion preference
disables both new animations without hiding the work indicator.

Row-state styling uses scoped data attributes, never bare `approval` or other
component-state classes. Otherwise the approval card's padding/background can
inflate the point and pause glyph and squeeze out the title. The point remains
6-by-6 pixels and the trailing glyph 15-by-15. The secondary attention caption
stays one line with ellipsis at narrow widths, while the full session title and
actual input/approval descriptions remain accessible. The main approval card
keeps its own layout and permission controls.

Actual native regression coverage measures rendered bounds, not only nominal
CSS width: the prior approval point is 34 pixels wide, and the narrow question
caption wraps to 23 pixels high. Fixed rows retain the 6-pixel point, 15-pixel
glyph, one-line caption and visible title at 232/180-pixel sidebar widths in
selected and unselected states, without changing required input or card padding.
Both states also pass in the actual newly packaged hidden app.

Unread session names use modest 550-weight emphasis instead of an extra dot;
read names retain weight 400 and the same typeface/size. The existing manual
unread flag and enabled unacknowledged attention state drive that presentation,
with an accessible unread description. Choosing a session or explicitly
marking it read clears the corresponding flag/attention acknowledgement through
existing SDK actions. Mark read captures its exact attention IDs before yielding;
a later question cannot be acknowledged by an older held action. Read acknowledgement never answers a question, approves
a tool, completes work or removes an actual yellow question/approval marker.
The separate top-bar notification indicator is unchanged. Manual unread remains
visible when in-app notifications are disabled. No event/schema/settings change
or client-owned durable read state is introduced.

Before this typography follow-up, all six available generated prerequisites
passed: provider cancellation 31.47 ms; SQLite append p95 0.175 ms/rebuild
2.173 ms; owned PTY cancellation 151.96 ms with zero survivors; TUI updates
17.19 ms; hidden Electron cold start 426.72 ms / 439.88 MiB / 8.07 ms per frame;
2,000-file search/Git 2.658/25.924 ms. The baseline's separate live/native/
notarized/Linux/quality gates remain FAIL/unqualified.

### Unread typography qualification

Source `0591c38` adds no dependency, durable schema, setting or API. Before the
fix both actual manual/background unread cases fail at unchanged 400-weight
text. Fixed titles use weight 550 without extra unread-only row dots, retain the
same family/size, and return to 400 on an actual read acknowledgement.

| Exact check | Result |
| --- | --- |
| Type checks/build/fresh audit | PASS; zero vulnerabilities |
| Focused unread, exact-read-race, attention, lifecycle and native interaction cases | 17 passed / 28.8 seconds |
| Final direct unread cases | 3 passed / 6.7 seconds |
| Complete hidden Electron suite | 129 passed, 2 physical-native skips, zero failures; 131 total / 5.1 minutes |
| Actual external packed SDK/install | All entrypoints/flows pass; all 12 installed-worker probes pass |
| Actual newly packaged hidden app | Unread/read/race, compact attention and navigation: 7 passed / 9.3 seconds |
| Actual bundle/native distribution/production update/DMG | PASS; protocol 54 / SendBox 0.2.4; 740,545,039-byte ZIP/manifest / 100,762.14 ms; exact native layout and unchanged signed app verified |

The newest DMG is 754,147,235 bytes, SHA-256
`7433b9681143a274186cc35d532f37fdb5d4ce3b3352c41abcdcfbaa564019bf`.
Previous installer identities remain historical measurements. The held read
test admits a later real question before releasing the earlier action and
verifies that the newer attention stays unread/pending. Read state never
answers it or removes its actual yellow status. No service/SDK/CLI/TUI/protocol
source changed from the preserved complete 1,294-pass Node baseline; that
earlier full run is not relabeled. All fixtures/windows are generated/hidden;
no personal UI, account, microphone or paid inference was used.

`session.pr_observed` retains version-1 metadata in the owning session, bound to
the actual profile, session, canonical PR URL, project, managed workspace/root/revision,
configured access mode and configuration revision. Its projection does not
change session revisions, updated time, unread state, draft, queue, order or
lifecycle. Protocol/schema 54 adds `session_indicators_schema` transactionally;
legacy PR links may lack draft information and remain unknown. Upgrade/reopen
preserves event ciphertext, keys, blobs, receipts and grants; missing/corrupt
markers fail explicitly, not through state deletion or a guessed downgrade.

Linking authorizes only bounded metadata reads. The service observes direct or
exact managed-change links, reuses the work-item board's current observation,
and respects its auto-refresh opt-out. Direct PR verification seeds its actual
result in the session-create transaction, avoiding a second request.
At most four requests remain admitted until settlement, including aborts whose
transport has not settled. Fresh results and failed attempts are held for at
least two minutes; verified merged metadata is stable. Unexpected parse or
commit failure cannot trigger immediate retries.

Automatic observation rechecks source/root/access and auto-refresh before
retaining a result. URL/root/configuration changes, archival/deletion, revoked refresh and
shutdown discard late results without resurrection. Missing access retains an
unknown result with a diagnostic, not a success-shaped fallback. Private reads
assert the exact Local root before and after the selected control-plane `gh`
read; a missing managed root never adopts the base checkout. Project-free
reads are public/root-null and cannot inherit a previous account. This remains
the disclosed control-plane linked-PR boundary, not a captured SSH account or
permission to refresh Remote repository metadata. Explicit from-work verification
remains a single user-requested read. No PR write, merge, CI,
checkout change or model execution is authorized by an observation.

All clients receive the same typed optional observation and browser-safe
selectors. Desktop PR panels and shared `/pr` commands resolve the same source.
Rendering, clicking or reloading a client does not initiate metadata reads.

The fresh pre-change generated baseline passed all six available groups:
provider cancellation 31.78 ms; SQLite append p95 0.143 ms/rebuild 0.609 ms;
owned PTY cancellation 151.82 ms with zero survivors; TUI updates 17.09 ms;
hidden Electron cold start 255.71 ms / 442.23 MiB / 8.14 ms per frame;
2,000-file search/Git 1.016/6.139 ms. The baseline's separate live provider,
Rust/Linux, signed/notarized, physical SendBox, model-routing, live decision and
personal SSH gates remain FAIL/unqualified, not enabled by these indicators.
No personal login, repository content, microphone or paid inference was used.

### Protocol-54 qualification

Source `234ed00` passed the following generated gates with the same frozen
production build; no source or distribution was rebuilt during a suite.

| Exact check | Observed result |
| --- | --- |
| Type checks and production build | PASS |
| Focused indicators, PR reads, lifecycle races and both retained lineages | 45 passed, zero failures / 2,487.23 ms |
| Existing native-management retention and archive gates | 4 passed, zero failures / 299.44 ms |
| Complete serialized unit/integration/worker/CLI/native-TUI suite | 1,289 passed, 14 physical-native skips, zero failures; 1,303 total / 1,170,944.47 ms |
| Complete hidden Electron suite | 123 passed, 2 physical-native skips, zero failures; 125 total / 4.3 minutes |
| Actual packed external SDK | Root/React/Node/MCP imports, declarations, approved install, exact profile/root-null PR metadata and shared TUI PR commands pass; all 12 installed-worker probes pass |
| Actual new packaged app | Both indicator scenarios and double-click rename pass hidden: 3 cases / 6.6 seconds |
| Fresh root, external-consumer and no-cache image dependency audits | Zero vulnerabilities |
| Actual protocol-54 native distribution | Bundled SendBox 0.2.4 and exact no-script side-by-side installer/image bytes verified without installation or administrator UI |
| Production update consumer and read-only DMG layout | PASS; 740,542,481-byte ZIP/manifest / 101,567.60 ms; app never executed by the update verifier |

The rebuilt no-cache Linux arm64 worker image is
`docker.io/library/moguri-worker@sha256:2b9a68d46acb5696d3762123a0be292f903619fa96e7a2c27a521a21eb25553d`.
That proves the compiled artifact/protocol and locked dependencies, not physical
SendBox guest/effective-network containment or Linux release readiness.
The development app is ad-hoc signed, not notarized. Existing OpenTUI FFI,
large-chunk and optional `.icon` notices remain non-blocking; minimal external
SDK hosts still need their own documented compatibility overrides for the
upstream deprecation notices. Root and image installs emit neither requested
deprecated-package notice. No personal account, microphone, real speech weights
or paid inference was used.

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

## Double-click rename prerequisites and qualification

The 2026-10-24 prerequisite rerun passed all six available generated baseline
groups before implementation: cancellation 31.77 ms, SQLite append p95 0.053 ms
and rebuild 0.90 ms, owned PTY cancellation 151.85 ms with zero survivors, TUI
updates 16.98 ms, hidden Electron cold start 179.87 ms / 443.98 MiB /
11.43 ms per scroll frame, and 2,000-file search/Git 1.01/8.40 ms.
The baseline's separate unavailable live/native/release groups remain
FAIL/unqualified, not newly enabled by a metadata shortcut.

The new generated desktop regression fails before the handler exists and
passes for both project and project-free sessions, actual typed replacement,
Escape cancellation/focus return, keyboard Rename, shared SDK observation and
reload persistence without inference. Type checks and production build pass;
the shared session/interaction gate passes 15 cases, and the hidden navigation,
drag, profile, terminal and rename gate passes 21 cases in 36.8 seconds.

## Dependency security follow-up

The final audit surfaced new advisories for the previously installed Electron
44.9.0, body-parser 2.3.0 and fast-uri 3.1.8. Existing dependencies were upgraded
to compatible Electron 44.9.3, body-parser 2.4.0 and fast-uri 3.1.9, with reviewed
registry integrity changes and no forced major upgrade or audit bypass.
`npm ci` restored the exact lock and the root audit reported zero vulnerabilities.
The native interaction probe checks the actual running Electron version against
the installed package, including when pointed at the packaged executable.

## Final qualification

All final runs below used the patched dependency lock, current protocol 51 and
generated fixtures. No source or distribution files were rebuilt while a suite
was running.

| Exact check | Result |
| --- | --- |
| Full serialized unit/native suite | 1,167 passed, nine gated skips, zero failures; 1,176 total / 976,994.90 ms |
| Complete hidden Electron suite | 104 passed, one native-Sandbox gate, zero failures; 105 total / 3.4 minutes |
| Nine interaction and four shutdown cases in the actual newly packaged app | 13 passed / 16.6 seconds; actual Electron 44.9.3 verified |
| Packed external root, React, Node and MCP entrypoints, approved install, shared SDK/CLI/TUI and installed worker | Passed; includes new ordered-session, explicit Other and task-plan types |
| Fresh root and external-consumer audits | Zero vulnerabilities |
| Actual ZIP/manifest through bounded production update consumer | Passed, 306,926,945 archive bytes / 94,215.92 ms; no app execution or quarantine bypass |
| Actual read-only mounted DMG | Passed; real app and Applications shortcut, no app execution |

Fault/race probes retain exact migration ciphertext and receipts, reject stale
sibling sets, preserve independent documents, pause undispatched work through
stop/restart and hold the clock until a delayed queue acknowledgement. Native
drag/drop and Shift+F10/arrow/Escape exercise real menus and focus. Compact
controls/popovers do not overlap, and a held first-console admission cannot
race another Open into a duplicate shell. Existing Local/SSH workspace-file
save/stop and dirty-binding retention remain qualified behind the separate
workspace-file editor.
The final side-question follow-up changed only desktop rendering/answer wiring;
the complete Electron, packed-consumer and actual-package checks above were
repeated afterward. Service/protocol/TUI code and the patched lock remain the
same as the complete unit/native run.

The existing dependency-deprecation, OpenTUI experimental FFI and lazy Ghostty
chunk-size warnings remain. Packaging still reports the optional missing
`.icon` format while `.icns` is present; the development bundle is ad-hoc signed,
not an Apple-notarized release or proof of Linux readiness.
