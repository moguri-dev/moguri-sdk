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
Shift+F10. Ordinary click opens the chat; double-click opens the existing Rename
dialog for project and project-free sessions. The name is focused and selected
after the modal opens, and Escape or Cancel leaves it unchanged. Rename uses the
same SDK command and service-owned metadata event as the context menu, without
changing drafts, workspaces, controls or permissions. No schema or migration is
added. Archive is not a chat-header action.
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
