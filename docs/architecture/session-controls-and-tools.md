# Session controls, voice input and interactive results

## Change contract

This owner-requested continuation starts at genuine merged protocol 86,
`8de380e62d5735a19fc264a4a098e742dd9bb373`. It keeps the existing service,
append-only encrypted store, worker, SDK, OpenTUI and Electron clients. It is
not completion of the first milestone.

Reuse React/Electron, Ghostty, TypeBox and the existing scoped GitHub, context,
browser, command and artifact primitives under their existing licenses.
TypeScript's native semantic compiler API and Playwright's owned Electron/Chromium drivers
are Apache-2.0. They supply language intelligence and app interaction, not an
agent framework, permission system, native OS controller or another scheduler.
The pinned NeMo-Speech.cpp runtime retains its MIT notices. The sole managed
Nemotron model remains revision `1c8deaecc64b91f034d73e08dd8b64625eb3395d`,
741,548,352 bytes, SHA-256
`a5c435f294eea8f88ce68dd27b8c3bfea7f777cb2fbba04fcd30eaa555f429ae`,
licensed OpenMDW-1.1. Tests never download real weights.

Protocol 87 adds five independent transactional migration markers:
`session_coordination_controls_schema`, `session_pr_associations_schema`,
`voice_lifecycle_schema`, `chat_outputs_schema`, and
`language_app_tools_schema`, each version 1. A genuine 86 upgrade adds the
complete set atomically. Premature history/markers, corrupt current markers
and interrupted migrations fail closed, preserving ciphertext, grants,
receipts, budgets, original actors and earlier native qualification identities.
An older healthy service cannot satisfy these required APIs.

New session wait records bind the actual profile/source, exact target task,
original execution scopes and revisions. New PR association records retain
verified observations without moving the first candidate/PR cleanup binding.
Tool output attachments retain their original call, bytes, digest and owner
through the same encrypted reference transaction. Bulk actions use existing
session lifecycle events, after whole-set/tree review and owned-work settlement,
not client loops that silently apply half an obsolete selection.

## Session interaction invariants

Every exposed ID is the actual stable service ID. ID lookup and navigation grant
no filesystem, execution, hidden transcript, console, credential or approval
authority. Mention selection uses the existing exact reviewed public-session
attachment path; text remains literal until the source review is accepted.
Explicit peer-message grants bind the actual same-profile source and target
scopes and do not grant parent-style dispatch/stop authority.

The user chose **release only after the captured prerequisite task succeeds**.
A wait binds a currently running turn or one exact already queued task, never
whatever future task later occupies the target. Failure, stop, target deletion,
archive, changed ownership and unknown restart outcomes remain blocked until
an explicit cancel/replacement. Cycles are refused before admission. Waiting
does not start work, release a held prompt, answer a question or bypass budgets,
writer leases, policy, cancellation or recovery gates.
Manual and automatic model retries cannot bypass a live wait. Explicit unheld
Stop cancels the user's wait and holds its undispatched prompts in the same
synchronous command boundary. Ordinary slash text remains queued; it is not a
new permission or command bypass. A parent model stopping owned child work
does not manufacture a user dependency cancellation.
The original wait event fences completion, so a same-turn retry cannot adopt
its earlier failed end. A captured queued slash task waits for its actual
terminal command/view acknowledgement, not a guessed model turn or a command
receipt alone.

Pinned entries appear first within their original project or Chats scope.
Unpinned priority is actual open questions/approvals, verified ready/finished,
errors, then running/queued/idle. Stable stored order breaks ties. Heuristic
question badges and model-written progress are not ordering authority.
The user explicitly confirmed on recheck that children remain under their
parents and priority applies within sibling lists, not a flattened project.
Moving a row never changes execution scope.

Multiple PRs retain exact associations and selection. URL syntax alone is not
verified GitHub state. Count badges count distinct retained associations.
Actions, review threads and CI watch bind the actual account/repository/PR/head;
read/watch is not write, push, merge, review approval or rebase authority.

Bulk selection stays within one original project. Attach/detach requires a
homogeneous current attachment state and a valid complete resulting tree.
Archive/delete recheck every selected session and descendant before effects
and again before final publication. Scoped opt-outs remember only UI
confirmation, never cleanup, source, policy or execution permission.
Independent artifacts, worktrees, external PRs and unknown accounting survive.

## Voice ownership

The requirement recheck preserves the original control contract: the microphone
button is click-record/click-confirm, while Ctrl+Space is held push-to-talk by
default. The legacy `voice.pushToTalk:false` field described the old button
behavior; it is not evidence that the user chose a toggle shortcut.
An explicit `voice.shortcutMode` stores `hold` or `toggle` independently, with
`hold` as the fallback when absent. Existing stored values are not rewritten.
Protocol 88 and transactional `voice_shortcut_schema` version 1 qualify this
new setting so an older healthy service cannot accept the new client contract.
Migration/restart tests must preserve original ciphertext and explicit choices,
reject forged provenance, and prove that the absent setting stays held even
when the legacy boolean is false. No dependency or license changes are needed.

Enable/disable is explicit. Enable reviews the pinned license/download and
qualified local runtime. Disable cancels owned capture/download work, closes
recognizers and removes only the exact Moguri-managed model/staging paths.
No user-selected external model or another application's files are removed.
Atomic staging admits at most one managed model; interruption is recoverable
without accepting partial bytes or silently downloading again.

Input-free audio graph and recognizer preparation are distinct from live
microphone capture. Standby microphone access requires visible explicit
consent and an exact focused composer/profile owner. Disable, focus/ownership
loss, cancellation and sleep close it. First-time OS consent remains genuine.
No audio enters history, command receipts, model context or cloud inference.
Streaming final text is accepted only for the original capture and complete
recognizer result; drafts and words already inserted remain intact on failure.

## Tools and interactive content

Definitions/references use actual TypeScript language-service results for
supported JavaScript/TypeScript files, not regex/name matches. Inputs, project
inventory, individual source bytes, total bytes, elapsed time and output are
bounded. Reads respect original roots, ignores, protected paths and folder
policy. Other languages/backends report unsupported explicitly.
TypeScript 7 does not export the old JavaScript `createLanguageService`.
The qualified pinned `typescript/unstable/async` API supplies actual symbol,
definition and reference operations instead. All five filesystem callbacks
are closed: unknown file reads return null, unknown directory inventories are
empty, and existence checks return false, never undefined/native fallback.
The initial full-reference probe failed because it passed a SourceFile rather
than the selected semantic token. The corrected exact-token probe passed in
16.08 ms, with one real declaration and four references including an import
alias and its call; the unrelated same-name string/local was not a reference.
It used two generated virtual files, not the host repository or a new language
server/framework. The initial supported corpus excludes standard libraries,
installed dependency types, custom config/plugins and files outside the
captured inventory. These limitations are disclosed with every result.
Array find/sort/compare helpers have deterministic typed inputs, no model
inference, locale-dependent ordering, implicit coercion or arbitrary code.

Generated HTML retains original source and provenance. Desktop rendering uses
an opaque-origin sandbox without privileged preload, Node, service tokens,
filesystem, network, child frames, forms, popups, downloads or top navigation.
Inline interactions work only inside that isolated document. Non-rendering
clients expose the retained source and disclose that they cannot render it.

Click/type/wait/screenshot operate only on an exact approved owned page/app.
Playwright supports explicitly launched owned Electron/Chromium targets, not
arbitrary native windows or the user's personal browser. Each launch and input
keeps the existing tool/command authorization and actual process owner.
The dedicated trusted `playwright-worker.mjs` executor is explicitly normal
Local host execution, not the restricted document/data parser. A generated
probe proved Node permission propagation is incompatible with Electron's
embedded runtime (`--allow-net is not allowed in NODE_OPTIONS`); that failed
attempt remains recorded rather than being relabelled. App code already needs
the same actual unrestricted-Local execution grant as commands. Restricted
folder policy, read-only mode and non-Local Env exclude this executor. The
normal parser's heap/watchdog/Node permissions stay unchanged. The app executor
gets no provider/service credentials, uses an exact private temporary profile,
and closes its newly owned target after one bounded action batch. Failed/unknown
cleanup retains that profile.
Regular executable and entry checks reject symlink aliases before launch;
private-profile removal rechecks the original device/inode/owner. Chromium
requests and WebSockets retain the admitted website scope. Service workers,
WebRTC, WebTransport and new workers are unavailable in this bounded driver.
The Node heap and ten/30-second worker deadlines are enforced; native compiler
memory is an explicit Go GC target, not a claimed hard aggregate OS memory cap.
Cancellation closes known owned targets; unknown cleanup remains partial.
Restart never adopts PIDs or replays clicks, typing, launch or screenshots.
Screenshots are actual page bytes, normalized locally and attached to the
original chat response through typed retention/delivery.

Automations copy may describe broader actions, but current scheduling remains
the actually implemented prompt capability. Kupo Balanced/Savings/Performance
are selectable **Kupo effort**, separately from concrete model thinking effort.
Eligibility, source reviews, transport qualification and all-role accounting
remain authoritative.

## Prerequisite measurements, 2026-11-02

The first `npm run spike` failed for missing `node-pty`. Locked `npm ci` restored
454 packages; both install and explicit audit reported zero vulnerabilities.
No personal account, microphone, real weights or paid inference was used.

| Primitive | Result | Measurement |
| --- | --- | --- |
| Generated provider stream/cancellation | PASS | 6 requests, cancellation 31.78 ms |
| SQLite WAL/crash rollback | PASS | 1,000 events, append p95 0.062 ms, rebuild 0.491 ms |
| Owned macOS PTY group cleanup | PASS | 152.10 ms, zero generated survivors |
| Actual OpenTUI updates | PASS | 60 updates, mean 17.12 ms, Node 26.12.0 |
| Hidden Electron | PASS | startup 186.67 ms, 443.89 MiB, scroll 7.94 ms/frame |
| Generated file inventory/Git | PASS | 2,000 files, 1.04/6.83 ms |
| Independent encrypted retention | PASS | 500 events, 250 artifacts, 135.04 ms |
| Actual Ghostty WASM | PASS | 423,045 bytes, 108x24 grid, 24 ms |
| Actual supported model controls | PASS | 3 generated transports, 53.62 ms |
| SQLite vector partitions/graph | PASS | 500 rows, 10.33 ms |
| Official MCP discovery/call/result | PASS | Generated MCP fixture |

The baseline build passed and prepared the pinned native speech executable
without weights. Its existing lazy-renderer chunk-size warning remains visible.
The original spike's live entitlement, Rust/Linux, release notarization,
personal SSH, live model-quality and native guest groups remain separately
unqualified. A protocol number does not qualify changed worker/native bytes.

## Required implementation evidence

Generated tests must cover the reported held Ctrl+Space startup failure,
complete transcription and draft preservation, lifecycle cancellation/restart,
one-managed-model ownership, exact ID attachments, wait cycles/stale/deleted
targets, heterogeneous bulk rejection, whole-tree rechecks, priority/pinning,
PR counts/exact heads, opaque interactive HTML and real screenshot bytes.
Use actual worker/TUI, hidden desktop/owned generated Playwright apps and an
independently installed packed SDK. Preserve failed attempts and disclose any
unavailable transport or physical qualification rather than substituting Local.

The first implementation incorrectly inferred a shortcut toggle preference from
the legacy `pushToTalk:false` field. The requirement recheck rejected that
interpretation; the user never changed the original held-shortcut default.
Input-free preparation, gesture-synchronous audio resume and capture ownership
remain separate from that correction. Held early release must still discard
late capture rather than record after the gesture ended; explicitly selected
toggle mode must survive key release and finish only on its next activation.
Hidden session/PR/HTML cases cover actual opaque-renderer interaction, late
source-read ownership, retained screenshot delivery and stale PR head rejection.
The five migration cases cover exact rollback/reopen and
missing/corrupt/premature/downgraded provenance. Historical tests select a
pre-87 journal encoder before their first write; they never rewrite current
ciphertext to manufacture an older format. Native TUI checkpoint review waits
for actual SSH worker cleanup, and preparation failure closes its own fixture
instead of leaving the complete suite waiting indefinitely.

## Protocol-87 qualification before the shortcut recheck, 2026-11-03

These are retained results from before the incorrect shortcut-default
interpretation was corrected. They do not qualify changed protocol-88 bytes.

| Surface | Result | Actual coverage |
| --- | --- | --- |
| Locked install, build and type checks | PASS | Pinned Node 26.12.0; speech runtime prepared without model weights |
| Root and independent packed-consumer audits | PASS | Zero reported vulnerabilities |
| Complete `npm test` | PASS | 2,163 passed, 29 explicitly skipped, zero failures; 1,963.97 seconds, including actual native TUI and crash/restart cases |
| Complete `npm run test:e2e` | PASS | 321 passed, four explicitly skipped, zero failures; 9.4 minutes of hidden desktop/generated app, audio and network fixtures |
| `npm run verify:sdk` | PASS | Independently installed browser-safe/root/React/Node entrypoints, actual worker/CLI and protocol-87 session/tools/retention/restart probe without inference |
| Actual macOS development package | PASS | Ad-hoc signature, mascot, bundled Node/service/worker/TUI, Ghostty, speech executable and installed session/tools/retention probes; not notarized |
| Packaged desktop shell aggregate | PASS | 551.78 MiB with one console; 569.72 MiB with four, against the existing 600 MiB shell budget; control-plane/broker and user-program memory reported separately |
| Fresh no-cache Linux arm64 workload | PASS | Protocol 87, locked production install, zero audit findings, native PTY/cache/payload hashes; image qualification only |
| Generated pinned loopback SSH | PASS | One worker-originating request, 161.65 ms; not an external SSH host qualification |
| Generated local-provider transport | PASS | Two requests, 48.20 ms; not model-quality or physical-device qualification |
| Real SendBox guest/control/containment | BLOCKED | Native executable presence is healthy, but the verified guest/runtime/workload boundary remains unqualified |
| Personal microphone, real weights, live accounts and external SSH host | NOT RUN | No personal device, authorization, paid inference, automatic weight download or external host was used |

The qualified Linux workload digest is
`sha256:eaae5fd2d64ddc111ea83fb3999047941be954268ffd9519647b42922407d897`.
This does not reuse an earlier native receipt or turn image construction into
SendBox containment. Owned Local Electron/Chromium interaction is not arbitrary
native OS control; the semantic backend supports the disclosed bounded JS/TS
corpus, not every language or installed dependency.

The first complete desktop attempt had one timeout in the existing default-model
profile-override test. That exact case passed alone, then the final complete run
passed without increasing timeouts or weakening assertions. Earlier historical
fixture and native TUI cleanup failures remain distinct from the final green
whole-suite results. Expected OpenTUI experimental FFI, existing Vite chunk-size
and optional macOS `.icon`-format warnings remain visible; the actual `.icns`
mascot and ad-hoc signature passed package verification.

Raw qualification logs are retained in the implementation session's `files/`:
`session-controls-full-local-final.log`,
`session-controls-full-desktop-final.log`,
`session-controls-sdk-final-qualified.log`,
`session-controls-packaged-qualified.log`, and
`session-controls-remote-qualification.log`.

The latest observed main GitHub run,
[41405993889](https://github.com/mbianchidev/moguri/actions/runs/41405993889),
is completed/cancelled at the original base. Both Linux/macOS jobs completed
install, audit, typecheck and build, then were cancelled during tests; their
SDK and desktop steps were skipped. The cancellation cause is unknown, not an
inferred account block or source failure. CI remains main-push-only, with no
working-branch/PR trigger change or rerun.

## Requirement recheck

The recheck found and corrected the default-shortcut gap rather than treating
earlier passing tests as proof of the user requirement. The regression first
failed against the old renderer's actual toggle tooltip and the missing typed
shortcut setting. Corrected source/build checks pass 78 generated service/tool
cases and 38 hidden desktop cases, including held cold admission with the
obsolete false button value, explicit toggle and settings UI, complete
transcripts, actual restart, atomic migration rollback, HTML interaction,
PR Actions/reviews and real screenshot attachment bytes.

| Requested behavior | Executable path and qualification |
| --- | --- |
| Stable IDs and details | Actual service IDs, Insights copy control and headless `/session-id`; hidden details case |
| ID mentions attach context | Same typed source snapshot/review as session attachments; hidden mention case, no model call or source execution |
| Queued session dependencies | Original captured task, success-only release, cycle/stale/deleted/failed/stop/retry guards and actual SIGKILL recovery |
| Session messages | Same-profile reviewed peer grants, original actors and no implicit target task/paid reply |
| Multiple PRs and badge | Exact distinct associations, count beside PR icon and usable selection; primary cleanup binding unchanged |
| Session priority | Questions/approvals, ready/finished, errors, running/queued; sibling order preserves nesting as explicitly chosen |
| Pin/unpin | Project or Chats-local promotion, including attached descendants, without changing original roots |
| Multi-selection | Same-project homogeneous attach/detach and whole-set archive/delete; scoped confirmation opt-outs, revision/tree and cleanup rechecks |
| Automations copy | Desktop/TUI describe actions beyond prompts and disclose that only one-time prompts currently run |
| Kupo effort | Balanced/Savings/Performance in the model effort dropdown, distinct from concrete-model thinking effort and still eligibility-gated |
| Dictation controls | Mic click-toggle, Ctrl+Space held by default, explicit independent shortcut toggle, main/side ownership and complete draft insertion |
| Voice preparation/model lifecycle | Input-free preparation; separately consented focused standby; exact managed-model enable/download/disable/delete/re-download, at most one managed model |
| Extra tools | Actual bounded JS/TS definitions/references and typed stable array find/sort/compare, never regex-labelled semantics |
| Interactive HTML | Original retained source and a genuinely interactive separate opaque renderer without privileged/network/filesystem access |
| GitHub PR pane | Exact account/repo/head file patches, runs/jobs/steps/logs, review comments/threads and bounded CI watch |
| App control and screenshots | Owned Local Browser and Playwright Electron/Chromium input, waits, actual PNG bytes attached to the original response, cancellation/partial cleanup and no input replay |

JS/TS corpus and owned Local Electron/Chromium limits are intentional qualified
boundaries, not support for arbitrary languages, native OS windows or a personal
browser. Generated microphone/recognizer tests do not establish physical-device
accuracy or authorize personal microphone use.
