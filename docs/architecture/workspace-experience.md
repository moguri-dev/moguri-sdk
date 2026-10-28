# Workspace experience and skill gateway

## Change contract

This slice simplifies the existing macOS alpha, not the wider release roadmap.
The control plane remains authoritative for skill discovery, suggestion sources,
accounting and work observations. Clients share typed SDK queries and slash
commands. Automations is an empty left-sidebar destination. Code change and
Work item are right-rail, per-session panels, not global resources or new
provider-write capabilities. Code change preserves an already-linked PR;
Work item remains a placeholder for issue links.

Reuse React, TypeBox, the maintained MCP SDK, YAML and yauzl under their existing
MIT licenses, Node's filesystem/crypto primitives, and the existing budget,
event, terminal-owner and settings mechanisms. No new runtime dependency,
charting framework, agent loop, credential backend or terminal renderer is needed.

Protocol/schema 59 adds profile-owned optional skill-source settings and typed
read-only gateway/dashboard queries. A transactional metadata migration preserves
schema-58 events, receipts, encrypted grants and profiles. Existing settings
normalize to no configured sources. No new durable event kind is required.
User-selected source configuration uses the existing settings event and revision
check. Reading a skill cannot install it, enable a capability or grant tools.

The gateway accepts explicitly configured local folders, GitHub repository URLs
or HTTPS ZIP archives. Each find/read refreshes and validates the source; no stale
body is returned after failure. Local recursion rejects links and escaping paths.
Archives are bounded and validated without extraction or execution. Loading binds
the selected source/path and exact SHA-256 body. Sources are control-plane Local
reads, not an implicit SSH/Sandbox filesystem transport. Revocation, changed
configuration and cancellation must invalidate pending results.
Cancellation uses an authenticated, exact-profile query ID and explicit
`/v1/query-cancel` message as well as transport abort. Electron's custom-protocol
Request signal alone does not propagate renderer cancellation reliably. The
native proxy forwards the query ID and cancel route; the service aborts that
original source read, rather than only hiding its reply. A cancelled lookup
releases the settings navigation guard. A 30-second, bounded ephemeral marker
also rejects cancellation-before-admission races. IDs never identify commands,
model calls, permission grants or durable work; cancellation cannot replay or
refund any of those. Missing acknowledgement is an explicit client error.

Global suggestions preview profile-wide usage gaps and bounded prior prompts
without creating a hidden chat or calling a model. Selecting a chat narrows the
scope. Sending excerpts still requires review of the exact source digest.
Generated advice cannot apply configuration or authenticate anything.

Dashboard pages are My work, Usage, Cost and Velocity. Seven UTC days is the
initial range; 30/60/90-day presets and a custom range are available. Custom starts
at the trailing year. All-role model accounting keeps estimates, missing usage,
held capacity and invoices distinct. Velocity shows observed completions,
completion time and user interventions; these are not a causal productivity or
time-saved claim. External MCP/tool-control turns and private subagent turns
are excluded from completion/intervention velocity, not relabeled as user
tasks. Their operations and all-role costs remain in their own accounting.
Date filtering never changes cumulative budget admission.

New Local user consoles default to configured HOME, never the state directory.
Project consoles still bind the actual Moguri worktree. Existing owners retain
their original root and input is never replayed. Missing roots fail explicitly.

Settings use hover/focus copy controls for non-secret text fields and information
tooltips for explanations. Errors, live status and consequential safety warnings
stay visible. Icon-only navigation keeps accessible names and keyboard focus.
Tooltip focus follows keyboard-visible focus, not every focused element: a
mouse click must not pin a hint after the pointer leaves, and pointer-origin
focus restoration must not reopen it elsewhere. Shared and right-rail icons
use that same distinction. Keyboard hints remain visible while focused,
Escape dismisses them without blurring the control, and portalled help remains
hoverable across the existing short exit delay. Dismissal removes only the
tooltip's temporary `aria-describedby`, preserving the control and its action.
This renderer-only repair adds no dependency, service API, durable field or
protocol change.

The footer contains profile name, Ask Moguri and Settings in one row. Copilot
connection status is shown only in Settings / Models / Providers, not the left
sidebar. Both new right-rail panels follow the actual selected session.

## Tooltip dismissal qualification

The owner-reported click/mouse-out bug reproduces before the repair: the
Settings hint remains after the pointer moves to the heading because its
clicked button still matches `:focus-within`. Source
`f54910fb6ec9bb5b90648e3a42c9206080bf702d` instead uses keyboard-visible focus
for focus-triggered display and persistence. The right rail also refuses to
open a hint merely because pointer-driven navigation restored focus.

The regressions exercise Settings, clicked information and Copy icons with
focus still on their original controls, moving onto and off the portal, actual
Tab/Shift+Tab focus, Escape, ARIA description removal, pointer-origin focus
restoration and sidebar activation. Existing Remote and source-update tests
now use the shared real-keyboard focus helper rather than treating a
programmatic focus call after a mouse click as keyboard input. Their original
warning, permission and update assertions remain intact.

Before the repair, the six generated foundation spikes pass: providers
1,114.33 ms (31.11 ms cancellation), SQLite 63.95 ms (append p95 0.0519 ms),
known-group PTY 159.65 ms (151.87 ms cancellation, zero observed children),
OpenTUI 1,040.88 ms, hidden Electron 747.06 ms (242.11 ms startup,
442.53 MiB), and bounded filesystem/Git 92.43 ms. Historical generic
unavailable-checkpoint diagnostics are not current feature discovery.

| Surface | Result |
| --- | --- |
| Focused source tooltip/settings/menu/turn/sidebar/Remote flows | 23/23 passed, 45.3 s |
| Actual rebuilt packaged tooltip, dictation and native setup/publication | 37/37 passed, 1.7 min |
| Packed external SDK install/types/entrypoints and 12 installed worker probes | Pass; independent consumer npm audit has zero vulnerabilities |
| Strict types, production build and source npm audit | Pass; zero npm vulnerabilities |
| Exact packaged Node/service native distribution check | Pass, 1,085.56 ms |
| Actual final ZIP/manifest through production update staging | Pass; 779,906,515 bytes in 116,203.74 ms |
| Read-only DMG identity/layout and exact application bytes | Pass; user app/Finder not opened |

Protocol 76, the qualified worker/bridge and immutable native image remain
byte-identical. No API/schema/dependency migration or new physical-native
qualification is inferred from this renderer-only change.

The labelled **794,198,369-byte** development installer is
`release/Moguri-0.30.0-alpha.1-desktop-fixes-macos-arm64.dmg`, SHA-256
`a9628a5cc51816e784d407caf40d8bfff86be2f0ad2496a035ef3df83b562ed3`.
Final ZIP SHA-512:
`d420f380993aff5fc06d428730908838ee844cf51921243ca06292f3c7d636214e7d657170c7bef17f2bdbe82f57bfa8eceac443de61323871dbaafdb7f3fec9`.
The previous dictation archive cut remains under
`release/qualification-history/pre-tooltip-dismissal-c884fb15ab9b`, with the
separately labelled dictation installer untouched. This app is ad-hoc signed,
not notarized or uploaded. Generated fixtures use no personal data, microphone,
model weights or paid inference. Existing FFI/chunk/optional `.icon` and
consumer deprecation notices remain non-blocking, not hidden vulnerabilities.
CI remains main-push-only.

## Settings scroll containment

The desktop shell and settings content establish their own positioning
boundaries. Absolutely positioned, visually hidden model labels must not use
the initial document as their containing block: otherwise labels below a long
list escape the scroll container and enlarge the document, even though the
visible app shell already hides overflow. The settings category list and
content remain independently scrollable, shrink within the available height
and contain wheel/trackpad overscroll. The app frame and settings toolbar stay
inside the viewport. This uses browser layout in the existing React/Electron
clients, both MIT-licensed, without another library, event handler, dependency,
service API, durable field or protocol change. TUI/SDK behavior and existing
save, cancellation and navigation guards are unchanged.

A generated **81-model** provider list reproduced the reported blank area:
the document grew to **5,305 CSS pixels** in a **1,100-pixel** viewport. Scrolling
the category list moved the root document by **58 pixels**, placing the toolbar
at **-12 pixels** and exposing space below the app. The offscreen model labels
were positioned against the document rather than their own scrolling content.
The regression now verifies root/document containment, the final model's native
keyboard switch and authoritative autosave, both scroll boundaries, independent
category scrolling, access to Restore all defaults, and switching between a
long provider list and short Appearance settings.

| Generated viewport | Document height | Content height | Outer scroll offsets |
| --- | --- | --- | --- |
| 2,000 x 1,100 | 1,100 | 984 | All zero |
| 1,280 x 800 | 800 | 684 | All zero |
| 860 x 620 | 620 | 504 | All zero |

The source settings/navigation/layout/tooltip suite passes **25/25 cases**
in **50.3 seconds**, including 202 information-control renderings across all
34 settings sections at wide/narrow widths. Strict type checks and the
production build pass. The six freshly repeated executable foundation spikes
also pass: generated providers **1,099.92 ms** (cancellation **30.80 ms**),
SQLite **65.50 ms** (append p95 **0.0539 ms**), owned PTY **159.23 ms**
(cancellation **151.00 ms**, zero survivors), OpenTUI **1,070.78 ms**, hidden
Electron **745.38 ms** (startup **257.03 ms**, **443.75 MiB**), and bounded
filesystem/Git **94.64 ms**. Historical generic unavailable-checkpoint rows
remain separate from current feature/native qualification. Fixtures contain
only generated data; no personal window, browser or microphone is controlled.

Source `55c97d5ebf5931871f8b90c7cabf080465cd5893` also passes **35/35 actual
packaged desktop cases** in **1.3 minutes**, covering settings, responsive
sidebars, tooltip dismissal and both dictation gestures. The separately run
packaged Sandbox group passes **4/4 cases** in **21.9 seconds**, including
actual reviewed guest tools and source publication with the pinned SendBox
0.2.4 receipts. An initial generated management-autosave assertion timed out;
the original failure log is retained, and the same assertion passed 14 isolated
repeats and the final full native group. Its cause was not established.
Failure-only diagnostics now retain the generated backend revision/management,
actual checkbox, alerts and toolbar status instead of obscuring future evidence.
This is not a claim that the wider recovery matrix is complete.

The fresh packed external SDK install, browser-safe entrypoints, CLI and
12 installed worker probes pass; root and independent-consumer npm audits
report zero vulnerabilities. The six native payload/dependency hashes still
match the original protocol-76 immutable image. The exact final packaged
native distribution/BOM and Node/service check passes in **4,660.89 ms**.
The **779,906,542-byte ZIP** passes the actual production update consumer in
**113,694.67 ms**. Read-only DMG checks confirm layout, identity and the exact
signed application bytes without opening Finder or the user's app.

The new, separately labelled **794,198,362-byte** combined installer is
`release/Moguri-0.30.0-alpha.1-settings-scroll-macos-arm64.dmg`, SHA-256
`3976996b2f36986687b8859eb26a9d8077fb5d3a150ea389df6b4c9eda0f5093`.
ZIP SHA-512:
`842d8ef5ddedd63c475dc2bfb92deeed7f37ddb8324dd8cdd76e2c02c270f21d32dd5c2db99e519dafd30a78e98141685bc049faee4906fbeb1e8390eff2048f`.
Application-tree SHA-512:
`0450dcb83c966ad43cd8b9b8a72a04c356f31186634bf63f040f234fd6784006c30e62b5491eb28224a177a3c5c504094ca872039bd144735bba7d29242206a2`.
The previous tooltip archive cut remains under
`release/qualification-history/pre-settings-scroll-d420f380993a`; earlier
labelled installers and evidence remain untouched. This is still an ad-hoc
signed, non-notarized development build, not a new native qualification.
Existing FFI/chunk/optional `.icon`, scoped consumer postinstall and deprecated
transitive-package notices remain explicit and non-blocking. CI is unchanged.

## Visual direction

Keep the factory theme: midnight `#11161e`, canvas `#141922`, surface `#191f29`,
mint `#a8d7bc`, slate `#a2afc0`, and text `#e1e8f0`, resolved through existing
theme variables. Native system type carries headings and controls; monospaced
figures distinguish measured data. Avoid a new marketing-style hero or fonts.

The dashboard's signature is a work pulse: a compact time-series plot and
project/model breakdowns first, with exact records behind disclosure controls.
The surrounding navigation and settings stay quiet. Graphs include accessible
text/data alternatives and do not depend on color alone.

## Prerequisite measurements

Fresh macOS arm64 run before feature integration, 2026-10-25:

| Primitive | Result | Measurement |
| --- | --- | --- |
| Generated provider streaming/cancellation | PASS | 6 requests; cancellation 31.77 ms |
| SQLite WAL/crash/rebuild | PASS | 1,000 events; append p95 0.050 ms; rebuild 0.51 ms |
| Known PTY process-group cancellation | PASS | 152.45 ms; zero fixture survivors |
| OpenTUI React timeline | PASS | 60 updates; mean 17.27 ms |
| Hidden Electron timeline | PASS | cold start 193.29 ms; 445.53 MiB; frame 12.11 ms |
| Generated filesystem/Git baseline | PASS | 2,000 files; search 0.96 ms; Git 5.98 ms |
| Independent encrypted compartments | PASS | 500 events / 250 artifacts in 114.80 ms |
| Hidden Ghostty WASM | PASS | 423,045 bytes; input/108x24 grid in 23.50 ms |
| Model-control forwarding and sizing | PASS | 56.06 ms; unsupported effort not forwarded |
| Official MCP OAuth/refresh | PASS | 17.50 ms; one refresh |
| Vector/graph and official MCP discovery/call/result | PASS | 500 rows in 6.59 ms; MCP round trip passed |

`npm ci` restored missing dependencies and reported zero vulnerabilities.
The expected OpenTUI experimental FFI warning remains. The base spike still
labels live inference, Rust/Linux, signed packaging, native SendBox, multi-model
quality, live decisions and personal SSH qualification FAIL/unavailable. Its
historical full-attachment/default/budget limitation is not a new regression.
Nothing here claims those physical/live gates passed or enables a fallback.

## Verification boundaries

Generated tests cover HOME/worktree roots, exact skill freshness and scope,
malformed/escaping archives, changed and removed sources, bounded pagination,
MCP discovery/read, profile isolation, schema-58 restart migration, global
suggestion consent, dated accounting and truthful velocity samples. Hidden
Electron checks cover navigation, all four dashboard pages, field copying,
secret exclusion, keyboard tooltips and preserved edits. Build/type checks and
an independently packed SDK consumer remain required.

## Integrated qualification

This subsection records the protocol-59 checkpoint.

The final generated macOS arm64 runs pass **1,446 Node/worker/CLI/TUI cases**
with **14 platform/native skips**, and **183 hidden desktop cases** with
**three packaged/physical-native skips**. No tests remain failed or cancelled.
Type checks and the production build pass. `npm ci`, the independently installed
packed SDK consumer, all **12 installed worker continuation probes**, and
moderate-level root/consumer audits pass with **zero vulnerabilities**.
The SDK consumer explicitly checks fresh skill lookup/read, changed-body
rejection, global previews, seven-day dashboard data and private HOME consoles.
These generated providers/SSH endpoints are not live entitlement or physical
SendBox/release qualification.

The desktop pass also exposed a real Ghostty integration race: the host widened
from 219 to 267 pixels while its canvas stayed at 200 pixels and the remote grid
stayed at 25 columns. FitAddon's 50 ms resize guard discarded the single resize
notification. Both User and Agent surfaces now debounce host observation before
calling the existing FitAddon, and dispose pending fits before their terminal.
The actual remote-grid/Agent cases pass **18 repeated checks**, without
weakening the grid acknowledgement or adding a terminal parser.

Detailed accounting stays mounted across background chart refreshes, preserving
reservation controls and exact repository reviews. Copy announcements use a
polite live region without impersonating each section's operational status.
Capability limitations and errors stay visible; language/transport explanations
remain keyboard-accessible information tooltips.

Known advisories remain: OpenTUI's experimental FFI warning, Ghostty's lazy
bundle-size warning, and deprecated transitive `whatwg-encoding` /
`node-domexception` packages in the external consumer. Its existing install
script review is explicitly approved and rebuilt by the verification harness.
None is an audit vulnerability or a qualification of the skipped physical gates.

## Session navigation follow-up

The desktop no longer offers a Global Terminal, global scope picker or a hidden
project console. Project actions open an existing session's private console at
its bound worktree; project-free sessions use configured HOME. Without an
existing session, the action asks the user to create/select one rather than
creating a hidden chat. CLI/slash entrypoints stop offering global creation.
Low-level SDK compatibility and authenticated inspection, reconciliation and
close of retained null-session consoles remain available. Removing navigation
never kills, retargets or replays an existing owner.

Reuse React (MIT), the existing native dialog, scoped reorder API, settings
events and Ghostty/PTY lifecycle. No dependency or terminal implementation is
added. Whole session rows use their upper/lower halves to reorder siblings,
including children. The grip is removed, not replaced with another button.
Context menus, Shift+F10 and Alt+Up/Down remain keyboard alternatives; attaching
to a parent remains an explicit context-menu action.

Dropping a child on a root row, its project/Chats/group header or a root-list
background requests detachment into that root group. Its original project,
workspace, Env and cancellation owner do not change. A root-row drop is a
detachment destination, not a promise of an additional reorder transaction.
Only a single organization command is committed. Sibling reordering retains
complete structural-intent checks, fresh revision CAS and the one safe retry
for a revision-only conflict.

Protocol/schema 60 adds default-on `interactions.confirmSessionDetach` and an
explicit optional detach acknowledgement on `session.organize`. An additive
metadata migration preserves old settings, events, receipts, profiles and
console owners; nested settings normalize the missing preference to true.
The preference is profile-owned and resettable in Settings / Confirmations.
Remembering a choice cannot bypass service hierarchy, active-work, model-owned
subagent, profile or revision checks, and never grants tool permissions.

Drag and menu detach use the same native review. Cancel changes neither
settings nor hierarchy. Confirmation rechecks the captured source hierarchy,
workspace/Env and root destination after any draft/preference save. Structural
changes invalidate review; active work and service failures remain explicit.
No failed or partial detach is labeled successful.

Fresh prerequisite measurements before this follow-up, macOS arm64:

| Primitive | Result | Measurement |
| --- | --- | --- |
| Generated provider streaming/cancellation | PASS | 6 requests; cancellation 32.04 ms |
| SQLite WAL/crash/rebuild | PASS | 1,000 events; append p95 0.044 ms; rebuild 0.52 ms |
| Known PTY process-group cancellation | PASS | 152.17 ms; zero survivors |
| OpenTUI React timeline | PASS | 60 updates; mean 17.30 ms |
| Hidden Electron timeline | PASS | cold start 184.54 ms; 443.77 MiB; frame 8.26 ms |
| Generated filesystem/Git baseline | PASS | 2,000 files; search 1.04 ms; Git 5.55 ms |
| Independent encrypted compartments | PASS | 500 events / 250 artifacts in 109.26 ms |
| Hidden Ghostty WASM | PASS | 423,045 bytes; input/108x24 grid in 25.40 ms |

The base spike's live inference, Rust/Linux, signed packaging, physical SendBox,
multi-model quality, decisions, personal SSH and historical complete-feature
gates remain FAIL/unavailable, not newly qualified by this UI work.
Generated checks must prove whole-row child ordering, cancel/confirm,
remembered and reset preferences across restart/profile boundaries, stale
review refusal, unchanged authority, removed global entrypoints and retained
private-console lifecycle. Packed-consumer, build and migration checks remain
required.

Native checks also exposed focus loss after successful detachment: a
microtask could focus the old child row before React replaced it in the root
list. Session actions now restore focus in a layout effect only after the
rendered snapshot reaches the committed SDK sequence. Cancel, remembered
detachment, parent-selector review, archive and delete dialogs pass twelve
repeated checks without weakening focus assertions.

The first full desktop run also found a browser fixture sending its keyboard
command before the authenticated command gate was ready. It now waits for
the actual Run command button, not merely an editable textarea; no timeout or
dialog-dismissal assertion was weakened. That exact case passes ten repeated
checks under concurrent complete-Node-suite load.

## Protocol-60 integrated qualification

The final macOS arm64 runs pass **1,455 Node/worker/CLI/TUI checks** with
**14 platform/native skips** in 21.2 minutes, and **192 hidden desktop checks**
with **three packaged/physical-native skips** in 6.4 minutes. No checks remain
failed or cancelled. Type checks and the committed production build pass.
The independently installed packed SDK passes every entrypoint, the explicit
detach acknowledgement/preference/reset checks and all **12 installed worker
continuation probes**. Root and independently installed consumer audits report
**zero vulnerabilities**.

Coverage includes both child-list scopes, root/group/header destinations,
cancel and restored focus, keyboard/parent-selector alternatives, stale source
and destination refusal, preference-save failures and concurrent hierarchy
changes. Genuine model-owned subagents and active work remain non-detachable.
Profile isolation, reset, encrypted restart recovery and schema-59 migration
rollback preserve original identities, payloads, receipts and legacy consoles.
Project terminal actions use the selected actual managed worktree; empty
projects create neither a global console nor a hidden chat.

The same non-blocking FFI, lazy Ghostty bundle-size and transitive-deprecation
advisories above remain. Generated success does not qualify physical SendBox,
personal provider/SSH access, signed release artifacts or deferred features.
