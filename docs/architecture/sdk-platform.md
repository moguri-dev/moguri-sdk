# Shared SDK platform contract

The CLI, TUI and desktop are clients of one Moguri SDK. The SDK owns typed
capability access, shared defaults, settings, cancellation and protocol
negotiation; the service remains the sole durable authority. A new SDK operation
must work without Electron and must be exposable by either client.

## TUI input and first-party product context

This maintenance slice reuses OpenTUI/React (MIT), its native key bindings and
the existing shared SDK/draft/worker path. It adds no dependency, API, event,
setting, schema or migration.

The chat textarea explicitly binds Enter/keypad Enter to submit and Shift+Enter
to newline instead of inheriting OpenTUI's default Return-to-newline action.
Cmd/Ctrl+Enter still holds the exact draft without inference, and
Shift+Cmd/Ctrl+Enter retains send-now. Settings/JSON editors, choices, approvals,
masked credentials, bracketed paste, focus and SDK optimistic-revision guards
keep their existing behavior. OpenTUI's existing enhanced-keyboard negotiation
reports modifiers; unmodified Enter also works with legacy input, whose Ctrl+J
newline fallback remains available. No terminal parser or escape decoder is
implemented by Moguri.

The service appends a bounded `moguri-product-context` block to the effective
prompt before snapshotting/sizing/admission. It identifies the host application,
canonical source/setup guide, executable source-install/entrypoint commands,
input controls and current macOS arm64 alpha limits. It does not infer that a
session has only one UI, confuse execution Env with a client, inspect installed
versions/accounts, invent a public registry/formula/release or grant permission
to install. Known first-party setup does not depend on workspace access,
optional repository memory or an external lookup.

Custom saved system prompts remain byte-for-byte unchanged. New normal turns
share these facts across SDK/TUI/desktop and existing execution transports;
running turns retain their captured prompt. The existing input estimator and
all-role budget reservation count the added context before dispatch. Unknown
accounting, cancellation, permissions and no-fallback rules are unchanged.
Generated native-input tests reproduce the old failure and prove plain Return
send, Shift newline, exact multiline hold and no unintended model call.
Generated provider-wire tests cover custom prompts and project-free questions,
not a claim about paid/live-model answer quality.

Fresh prerequisite probes passed all six available groups: cancellation
33.01 ms; SQLite append p95 0.053 ms/rebuild 0.519 ms; owned PTY cancellation
152.84 ms with zero survivors; TUI updates 17.70 ms; hidden Electron cold start
183.85 ms / 442.89 MiB / 8.23 ms per frame; 2,000-file search/Git
0.810/6.372 ms. The baseline's separate live-provider, Rust/Linux, notarization,
physical SendBox, routing-quality, live decision and personal SSH gates remain
FAIL/unqualified. No personal terminal, microphone, account or paid inference
was used.

### TUI and product-context qualification

Runtime/TUI source `f218085` passes the complete gates below. The separately
committed external-consumer fixture change `1186ef5` reduces only generated
compaction filler, retaining all three original turns and the unchanged
4,096-token headroom assertion. The added product context is fully counted;
neither production context/window nor budget limits are loosened or truncated.
Runtime, distribution and Node fixtures stayed unchanged during the full run.

| Exact check | Result |
| --- | --- |
| Before-fix regression | Both plain-Enter modes, Shift newline and both first-party prompt cases fail for the reported missing behavior |
| Type checks, build and compiled TUI help | PASS; help advertises send/newline/hold without opening a terminal UI |
| Focused native TUI, prompt and model-window gates | 64 passed, one physical-native skip, zero failures / 43.21 seconds |
| Final direct keyboard and custom/project-free prompt cases | 13 passed, zero failures / 5.03 seconds |
| Complete unit/integration/worker/CLI/native-TUI suite | 1,294 passed, 14 physical-native skips, zero failures; 1,308 total / 1,171,138.75 ms |
| Complete hidden Electron suite | 123 passed, two physical-native skips, zero failures; 125 total / 4.3 minutes |
| Actual packed SDK | All entrypoints/declarations, approved/audited install and installed compaction flow pass; all 12 installed-worker probes pass |
| Actual packaged Node/service/worker | One generated root-null model request includes source/setup facts and unchanged saved prompt; Node 26.12.0, owned loopback only |
| Actual macOS bundle/native distribution/update consumer/DMG | PASS; exact existing protocol-54 / SendBox-0.2.4 image reverified; 740,544,106-byte ZIP/manifest / 97,197.29 ms; read-only DMG layout passes |
| Fresh root and external-consumer audits | Zero vulnerabilities |

These generated checks prove actual input handling, prompt delivery and retained
policy/accounting behavior, not live model answer quality or physical terminal
support beyond a reported modifier. No personal terminal/account/microphone,
paid inference, native administrator install or personal application/browser
was used; Electron ran only hidden generated fixtures. Existing FFI, optional `.icon`, large-chunk and documented
external-host deprecation notices remain; the app is ad-hoc signed, not notarized.

## Native DMG presentation

The installer reuses the existing Moguri icon, Resvg (MIT), Sharp (Apache-2.0)
and native macOS image tools. `dmgbuild` 1.6.7, `ds_store` 1.3.3 and `mac_alias`
2.2.3 (MIT) write Finder metadata offline; no Finder, AppleScript, personal UI
or authorization is automated. Python 3.10+ is a packaging-only prerequisite.
Exactly hashed wheels install into a private environment bound to the Python
minor and requirement-manifest digest, never system packages or the shipped app.

The supplied reference uses a 540-by-380-point native window, 80-point icons and
12-point labels. The image preserves those proportions, app/Applications centers
at (130,220)/(410,220), a light-gray dashed-arrow background at 1x/2x density,
native icon view with bottom labels, zero scroll and no tool/status/path/sidebar.
The actual Moguri app/volume icon replaces the reference's branding; the title
is `Moguri <version>-arm64`. Background aliases bind the image's own volume and
file identity rather than a build-host path. Only Moguri and Applications are
visible. A source SVG is retained; no label or clickable icon is painted into it.

The app remains separately ad-hoc signed and byte-identical across the ZIP,
DMG and update manifest. New image construction publishes by rename only after
successful completion; failure preserves the previous image and explicit owned
staging. The mounted verification owns its exact mount, uses read-only/no-browse/
no-autoopen flags, and refuses recursive cleanup until detach is confirmed.
No client, control-plane schema, durable event, permission, default or update
application behavior changes. Artifact integrity does not imply notarization.

Generated tests assert exact geometry/pixels, build a real tiny image, inspect
its retained native view, and reject altered window bounds. The actual release
verifier checks native metadata, both Retina resources and background identity,
Applications target, icon and the unchanged signed app through the production
ZIP/manifest consumer. It does not open Finder to make a screenshot.

Before implementation, the six available prerequisite groups passed:
provider cancellation 31.02 ms; SQLite append p95 0.045 ms/rebuild 0.536 ms;
owned PTY cancellation 152.09 ms with zero survivors; TUI updates 16.87 ms;
hidden Electron cold start 173.56 ms / 439.69 MiB / 7.78 ms per frame;
2,000-file search/Git 1.022/6.201 ms. The baseline's unavailable live/native/
notarized/Linux/quality gates remain FAIL/unqualified, not enabled by packaging.

### Installer-layout qualification

The pre-change actual DMG fails the new native-layout gate because it has no
`.DS_Store`. The replacement image passes it without Finder or app execution.
Type checks and production build pass. Ten focused layout, archive, updater,
interruption and native-distribution cases pass in 11.45 seconds, followed by
both repeated geometry/image cases with explicit 72/144-DPI checks in
10.56 seconds. Altered window bounds are refused rather than accepted as a
scaled approximation.

The actual packaged Node/service/native-distribution checks pass with protocol
54 and SendBox 0.2.4. The production update consumer accepts the
740,544,970-byte ZIP/manifest in 98,495.72 ms. A separate read-only mount verifies
the real Finder dimensions/centers, icon, two exact background rasters and DPI,
on-volume background file identity, Applications target and unchanged signed
application hash. All mounts are detached and no personal UI is opened.

The resulting DMG is 754,146,585 bytes, SHA-256
`a9304372e507d4414e68d2adbdb2a3725cc25a3715978d8373d96f2ac955e1ce`.
Fresh complete OSV results report no advisories for all three exact Python
build tools; the Node audit reports zero vulnerabilities. The build used a
private Python 3.15 environment and did not change system packages.
No runtime, SDK, CLI, TUI or desktop source changed after the earlier complete
1,294-pass Node and 123-pass hidden Electron baseline; this packaging-only slice
does not relabel those as another full-suite run. Known optional `.icon` and
development-signing limitations remain.

## Global and session sidebar placement

Protocol 59 updates the **left** resources to Dashboard, Suggestions, Automations
and Global Terminal. Artifacts/Candidates/Sandbox move to Settings. Code change
and Work item belong to the **right**, following the selected session; an existing
linked PR remains accessible without a new linking/write workflow. Automations
and the issue-link panel are placeholders, not scheduled work or provider-write authority. The
**right** rail contains only Terminal, Browser, Insights, Changes, Files, Plan,
Side chat, Code change and Work item, in that order. The left resource group is a named native navigation
landmark; repeated selection still returns to chat after existing dirty/terminal
checks. Existing styles, model controls and session hierarchy are unchanged.

This reuses React/native navigation (MIT) and existing SDK/resource routing.
The placement change itself adds no durable event or dependency; the associated
[skill/dashboard contract](workspace-experience.md) describes protocol/schema 59.
Legacy saved Artifacts/Candidates/Sandbox panel names restore their Settings
destination rather than becoming invalid preferences or another right-rail tab;
widths remain intact. Legacy PR actions open Code change; attention stays auxiliary, not another primary
rail items. Hiding an auxiliary panel returns keyboard focus to Insights.
Globals still create no hidden session/inference, terminal opening remains
one-shot and hiding a live owner keeps its existing review/opt-out. Read-only/
profile/root, cancellation and retained-resource behavior are unchanged.

Fresh prerequisite probes passed all six available generated groups before
implementation: cancellation 31.16 ms; SQLite append p95 0.045 ms/rebuild
0.540 ms; owned PTY cancellation 151.87 ms with zero survivors; TUI updates
17.23 ms; hidden Electron cold start 259.31 ms / 442.02 MiB / 8.29 ms per frame;
2,000-file search/Git 0.958/5.865 ms. Separate baseline live/native/notarized/
Linux/quality gates remain FAIL/unqualified, not enabled by navigation changes.

### Sidebar and attention-row qualification

Navigation source `ad075e8` and attention-row source `27a6bf7` reuse the same
frozen build for final checks. The new navigation regression fails against the
old 13-button right rail; the attention regression reproduces the 34-pixel
approval marker and wrapped caption before the scoped-style fix.

| Exact check | Result |
| --- | --- |
| Type checks/build/audit | PASS; zero vulnerabilities |
| Focused native navigation/terminal/settings cases | 20 passed, zero failures / 38.7 seconds |
| Shared session/workspace/settings gates | 22 passed, zero failures / 6,484.58 ms |
| Final compact attention/lifecycle/sidebar cases | 6 passed, zero failures / 9.4 seconds |
| Complete final hidden Electron suite | 126 passed, 2 physical-native skips, zero failures; 128 total / 4.5 minutes |
| Actual packed external SDK/install | All entrypoints and existing flows pass; all 12 installed-worker probes pass |
| Actual newly packaged hidden app | Both attention states, both navigation cases and safe global-terminal toggling: 5 passed / 7.6 seconds |
| Actual bundle/native distribution/ZIP/DMG | PASS; protocol 54 / SendBox 0.2.4; 740,545,018-byte ZIP/manifest / 99,738.95 ms; exact native installer layout and unchanged signed app verified |

The final DMG is 754,146,974 bytes, SHA-256
`a7d2e24d76a70117b55737c7c3b0bdec77e138223226037cc163aa2a082518de`.
The prior installer-layout identity remains a historical artifact, not this
new desktop build. No service, SDK, CLI, TUI or durable protocol source changed
from the preserved complete 1,294-pass Node baseline; that full run is not
relabeled as a new one. Only generated fixtures/hidden windows and explicitly
owned read-only verification mounts were used. Personal Finder windows,
accounts, terminals and ongoing owners were not closed or adopted.

## Right-pane icon toggles

Each of the nine right-rail buttons opens its session view when inactive and
uses the existing guarded header-hide path when clicked again while visible.
The icon rail remains, including after maximized-pane collapse; existing open/
size preferences and keyboard focus are retained. Expanded/pressed state and
the controlled pane are exposed on the native buttons. Programmatic/slash
show requests remain idempotent, not accidental toggles.

This reuses React/native buttons (MIT), existing UI preference state and
terminal/draft controls. No dependency, SDK operation, durable event, setting,
schema or migration is added. Dirty owned editors still block hiding without
writing/discarding text. A live Terminal still uses the existing hide
confirmation/opt-out, preserves its same authenticated owner and never replays
input or creates a replacement just because the pane was reopened. X remains
a separate explicit termination action with no hide confirmation.
Native terminal-review dialogs close before applying a confirmed navigation/
focus action, and their close event cannot also report cancellation. Cancel
returns focus without hiding or terminating the owner.

Generated native tests cover all nonterminal buttons by pointer/keyboard,
maximized collapse/reload, Terminal cancel/hide/opt-out/same-owner reattach/X,
and a dirty workspace-plan editor that cannot be collapsed or written by
another click.

Fresh prerequisites passed all six available groups: provider cancellation
31.33 ms; SQLite append p95 0.058 ms/rebuild 0.684 ms; owned PTY cancellation
151.87 ms with zero survivors; TUI updates 17.26 ms; hidden Electron cold start
197.95 ms / 444.78 MiB / 8.26 ms per frame; 2,000-file search/Git
0.926/6.423 ms. Separate baseline live/native/notarized/Linux/quality gates
remain FAIL/unqualified, not enabled by a pane toggle.

### Right-pane toggle qualification

Source `7a65a99` preserves the existing show-only programmatic action and adds
the click-again hide branch only to rail buttons. The before-fix native Browser
case fails because its pane stays visible. Native terminal review also exposed
focus trapping while a confirmed action ran before dialog settlement; closing
the dialog first and separating confirmed close from cancellation fixes that
without a timer or changing terminal authority.

| Exact check | Result |
| --- | --- |
| Type checks/build/fresh audit | PASS; zero vulnerabilities |
| Focused toggles, native dialog/terminal, workspace and session interactions | 25 passed, zero failures / 42.8 seconds |
| All direct toggle/terminal/dirty-editor cases | 3 passed / 4.3 seconds |
| Complete hidden Electron suite | 132 passed, 2 physical-native skips, zero failures; 134 total / 4.9 minutes |
| Actual external packed SDK/install | All entrypoints/flows pass; all 12 installed-worker probes pass |
| Actual packaged hidden app | All toggle cases plus navigation and unread ownership: 8 passed / 10.6 seconds |
| Actual bundle/native distribution/update/DMG | PASS; protocol 54 / SendBox 0.2.4; 740,545,116-byte ZIP/manifest / 99,152.81 ms; exact native installer layout and unchanged signed app verified |

The latest DMG is 754,146,553 bytes, SHA-256
`541ff15c39717357a6c8d779fb76509840bdfac5ba111f986f3e947842733216`.
Older installer hashes remain historical. No service/SDK/CLI/TUI/protocol source
changed from the preserved complete 1,294-pass Node baseline, and that run is
not relabeled as another one. All terminal/plan data and app windows are generated
or hidden; no personal UI/account/microphone, paid inference, native administrator
install or automatic user-app/browser opening was used. Existing development
signing, FFI/chunk/optional-icon and physical-native limitations remain.

## Explicit session-terminal admission

This follow-up reuses React, Ghostty and Node-PTY (MIT), existing SDK admissions
and authenticated owner/root checks. No library, SDK operation, durable event,
setting, schema or migration is added.
CLI/TUI/SDK callers retain their existing explicit open/reconcile operations;
only desktop entry routing and its local pending-state presentation change.

Explicitly navigating to another session/project or starting a chat while
Terminal is open creates one entry intent for that actual selected session.
An existing console is reused; otherwise an eligible transport opens its exact
root. Protocol 59 project-free Local requests disclose/use configured HOME, never the previous
project. Passive initial selection, profile restoration, Settings/tab remounts,
hidden project selection and reselecting the same visible X-closed chat cannot
manufacture launch intent.

The private console's own action/admission gate, not the shell's general busy
state, controls startup and +. A delayed read acknowledgement or other UI request
cannot disable an independent user console. Both automatic entry and explicit
plus claim the intent before dispatch; actual pending terminal work stays
serialized, a definite refusal remains diagnostic, and only an explicit later
action can retry. Remote probe completion settles that same local gate before
consuming pending entry intent. Existing one-global/four-per-session/sixteen-per-
profile bounds and all service rechecks remain unchanged.

No environment fallback or owner adoption is added. Local/qualified Remote
admissions stay bound to actual profile/session/root/peer; unqualified Sandbox
user consoles explain their boundary rather than starting a Local shell.
Read-only/stale views and Agent command output remain separate; queued input
still cannot cross attachment generations or become model context.

Fresh pre-change probes pass all six available generated groups: cancellation
32.13 ms; SQLite append p95 0.050 ms/rebuild 0.546 ms; PTY cancellation
151.82 ms with zero survivors; TUI updates 17.21 ms; hidden Electron cold start
259.17 ms / 442.38 MiB / 8.12 ms per frame; 2,000-file search/Git
1.197/6.768 ms. Separate live/native/notarized/Linux/quality gates remain
FAIL/unqualified, not newly enabled.

### Session-terminal startup qualification

Source `8bdac15` fixes both reproduced desktop failures: changing the selected
session lost the pane's opening intent, and an unrelated held read
acknowledgement disabled startup/plus through App-wide busy state. Generated
tests also cover new-chat and visible Chats entry, passive hidden selection,
exact project/data roots, same-owner reuse, X without replay, a definite refusal
with explicit retry, allowed-env rejection and a real pinned loopback SSH probe
settling before one Remote admission.

The full suite exposed a test-only close race: persisted backend draft text
could be observed before its renderer acknowledgement. `930d7b6` waits for the
actual **Draft saved** status before teardown, preserving the intended
beforeunload guard rather than bypassing it or adding a sleep.

| Exact check | Result |
| --- | --- |
| Type checks/build/fresh audit | PASS; zero vulnerabilities |
| Six focused startup cases, each repeated three times | 18 passed / 41.4 seconds |
| Policy/acknowledged-save teardown repeated ten times | 10 passed / 20.2 seconds |
| Complete final hidden Electron suite | 138 passed, 2 physical-native skips, zero failures; 140 total / 4.7 minutes |
| Actual external packed SDK/install | All entrypoints/flows pass; all 12 installed-worker probes pass |
| Actual newly packaged hidden app | All six startup cases plus toggles, unread and navigation: 14 passed / 22.5 seconds |
| Actual bundle/native distribution | PASS; protocol 54 / SendBox 0.2.4; pinned image unchanged |
| Production ZIP/manifest consumer | PASS; 740,545,228-byte archive / 101,592.62 ms |
| Native DMG | PASS; exact Finder layout, portable metadata/resources and unchanged signed app |

The new DMG is 754,148,542 bytes, SHA-256
`2f83cc1fafdfcf62756758781c9fe78edce2e3aa0e0a7f91c4df108436bd948d`.
Earlier installer identities remain historical. No service/SDK/CLI/TUI/protocol
source changed from the retained complete 1,294-pass/14-skip Node baseline; it
is not relabeled as another full run. All sessions, roots, SSH keys and consoles
are generated, with hidden Electron and no personal UI/account/microphone,
paid inference, administrator install or automatic user-app/browser opening.
Only verifier-owned image mounts were detached; an earlier user-opened image
was not closed. Ad-hoc signing, FFI/chunk/optional-icon notices, external SDK-host
compatibility overrides and physical-native/notarization/Linux limits remain.

## Desktop interaction maintenance, 2026-10-23

Reuse React (MIT), existing native keyboard/pointer events, the shared revisioned
settings/session SDK and pinned NeMo-Speech.cpp 0.2.0 (Apache-2.0). No dependency,
protocol event or database migration is needed. Resizable desktop chrome is a
local presentation preference, with compatibility for the previous fixed-width
sidebar preference; settings and transcripts remain service-owned across clients.

Enter sends and Shift+Enter inserts a newline. Cmd/Ctrl+Enter still holds a
prompt without running it, and composition/repeated key events must not submit
work. Both chat composers follow the same desktop convention. Sidebar resizing
must also work with keyboard arrows, retain enough room for chat, and preserve
unsaved panel edits. Collapsing the right pane leaves its icon rail available.
Message copy controls appear on hover or keyboard focus, not persistently.

Toggle/dropdown preference changes use the existing optimistic-revision writes.
They cannot implicitly save other text edits, acknowledge prompt risk, apply a
model proposal or retry over another client's changes. Text/JSON settings retain
nearby explicit Save actions. A failed save preserves edits and surfaces the
failure; an in-flight save continues to block navigation/submission as appropriate.
The settings-focused conversation is presented as **ask Moguri**, without
changing its reviewed proposal or scope boundaries.

Compact layouts keep offered answers and composer actions visible together
with a held queue down to 840 x 620. Long question/advice content scrolls with
keyboard access instead of pushing Send below the window. Speech stop/discard
and capability-job cancellation remain available during a held preference save;
new recordings are blocked until the configuration settles.

Ctrl+Space must reach the focused chat surface without auto-repeating start/stop.
Native stop requests are idempotent and finalization has its own bounded deadline,
separate from cancellation escalation. Cancellation discards output; nonzero and
signal exits never become successful transcripts. Diagnostics retain the actual
exit status/signal and bounded native errors. Tests use generated recognizers,
including delayed finalization, startup/stop races, cancellation and native
failure, never a microphone, model weights or a personal provider account.

Before integration, the fresh Phase 0 run passed generated provider cancellation
in **31.57 ms**, SQLite append p95 **0.054 ms** and crash rebuild **0.54 ms**,
known PTY-group cancellation **151.94 ms**, OpenTUI updates **17.07 ms**, and
hidden Electron cold start **196.53 ms**, aggregate memory **446.50 MiB** and
10,000-row scrolling **11.97 ms/frame**. The 2,000-file Node baseline measured
**0.88 ms** search and **6.20 ms** Git status. Platform vector/graph work passed
in **6.04 ms** with real MCP discovery/call/result. Model-control forwarding and
its unsupported-effort negative case passed in **55.32 ms**; retained-compartment
and hidden Ghostty spikes passed in **123.95 ms** and **25.80 ms** respectively.
The real pinned speech binary's version/help passed without audio or weights.

Source qualification passed the locked install, type checks and production build,
**1,074 unit/native checks with 9 gated skips in 977.11 s**, and the final hidden
desktop suite with **76 passes and 1 native-Sandbox skip in 3.1 min**. All four
packed external SDK entrypoints and installed-worker probes passed; the audit
reported **zero vulnerabilities**. The nine generated speech checks include
3.3-second finalization, repeated stop, cancellation, bounded stderr and the
separate 30-second deadline. Hidden desktop coverage additionally holds a real
settings request while stopping/discarding generated dictation, preserving the
draft and rejecting a subsequent native signal failure.

The original Phase 0 script still explicitly reports unavailable live provider,
Rust/Linux, notarized packaging, native SendBox, evaluated multi-model quality,
live decision-provider and configured SSH checks. Its historical initial-slice
attachment/default labels do not supersede later qualified protocol slices.
These maintenance measurements do not qualify those unavailable capabilities
or claim real microphone capture or ASR accuracy.

## Requirements and delivery boundary

Dark is the factory desktop theme. The visual identity is an original minimal
face-and-bat-wings mark, represented as SVG, native app icon and terminal ASCII.
No supplied third-party illustration is embedded or traced.

The shared settings surface includes an editable, viewable strong system
prompt, a breakage warning, and restore-to-default actions. Hard permissions
are deterministic service policy, not editable model instructions. Restore
preserves projects, conversations, knowledge, credentials and downloaded models.
Any reset that weakens permissions is an explicit user action.

The capability families are prompt, permissions/SendBox, repository vector and
graph memory, style memory, optional subagents, standard skills, curated scripts,
plugins, the native MCP gateway and local dictation. Optional model-driven
evolution starts off and may only propose reviewed changes; no proposal can
enable itself, acquire permissions, alter user-only settings or apply a script
or skill without human approval. Autonomous later-work activation stays behind
the implementation specification's milestone gates.

## Phase 0 sources and new dependencies

Reuse the existing Node/SQLite/TypeBox/pi-ai/React stack. Add the official MCP
TypeScript SDK (MIT), sqlite-vec (MIT/Apache-2.0), Ajv (MIT), YAML (ISC) and
Cheerio (MIT), with ignore (MIT) for root/nested exclusions. Resvg (MPL-2.0)
is build-only rasterization for the original icon.
Local speech uses NVIDIA NeMo-Speech.cpp (Apache-2.0, retaining upstream
notices), not a hosted inference API.

The official `nvidia/nemotron-3.5-asr-streaming-0.6b` model card identifies
OpenMDW-1.1 licensing and 40 language-locales: 19 transcription-ready,
13 broad-coverage and 8 requiring adaptation. This is 32 working locales out of
the box, not a verified 22-language claim. The pinned native runtime is 0.2.0;
existing local GGUF paths avoid implicit model downloads. A user must explicitly
request and accept the model download before dictation. No model weights or real
microphone input are used by automated tests.

Sources:

- <https://huggingface.co/nvidia/nemotron-3.5-asr-streaming-0.6b>
- <https://github.com/NVIDIA/NeMo-Speech.cpp/tree/v0.2.0>
- <https://github.com/NVIDIA/NeMo-Speech.cpp/blob/v0.2.0/docs/cli.md>
- <https://github.com/mbianchidev/sendbox/blob/main/docs/integrations.md>
- <https://github.com/mbianchidev/sendbox/blob/main/docs/interactive-sessions.md>

SendBox is not installed on the validation host, nor is an approved digest-pinned
workload image/guest bundle configured. Its documented interactive input requires
a real controlling PTY and cannot be combined with JSON. Do not
pretend piping Node IPC through `--json` works. Sandbox remains fail-closed until
the real worker transport, scoped authentication and cleanup are qualified.

## Invariants, persistence and validation

New settings and capability changes are versioned immutable events with
optimistic revisions, source and real approval actors. Database migration 2
must preserve schema-1 sessions, drafts, queues and receipts. Repository indexes
are derived, profile/project-scoped SQLite vector/graph data; they do not become
a second session store. Local hashed-token vectors are labeled lexical vectors,
not claimed to be learned semantic embeddings. Indexing and context injection
require explicit opt-in, respect protected/ignored paths and retain digests.

The gateway exposes bounded discovery/description/call/result operations, not
every backend schema in every prompt. Backend credentials stay in an explicit
secret store. Tool metadata and returned content are untrusted. MCP annotations
do not confer permission. A model cannot start OAuth, approve itself, widen the
configured server set or execute a changed tool schema under an old approval.

Generated fixtures must prove SDK importability outside the checkout, shared
settings/restore behavior, migrations/restart, stale approval rejection, scoped
index invalidation, vector and graph retrieval, bounded gateway discovery,
stdio/HTTP cancellation, secret-safe auth and optional capability defaults.
Voice tests use generated audio or a generated recognizer, never real
microphone capture; runtime/model absence must be actionable, never cloud
fallback. Both clients must expose the same operation rather than duplicate it.

Protocol 44 distinguishes speech initialization, actual microphone readiness and
final transcript draining. The pinned 0.2.0 CLI runs with its non-interactive
readiness announcement visible on stderr; microphone device names/live preview
text are not retained as job progress. No quiet-mode startup guess substitutes
for that phase signal. This announcement is operational status, not permission.
Automatic language selection omits the language override. Initialization and
recording each have two-minute bounds; graceful SIGINT finalization has its own
60-second bound, distinct from cancellation/output-limit TERM/KILL escalation.
Cancelled, unready, empty and deadline-exceeded output never becomes a transcript.
The composer inserts only a completed owned result against the current saved
draft revision, never sends it, and preserves concurrent typing/conflicts.

Protocol 53 converges main-line schemas 44-52 and desktop schemas 44-46 using
retained provenance, not version-number guesses. Its atomic marker migration
preserves both event sets and existing ciphertext, grants and receipts.
Missing or corrupt source markers fail without repair-by-default. The
[retained-state contract](../sdk.md#retained-state-upgrades) and generated
reopen/rollback checks cover both histories and their known partial crossing.

Root-install compatibility reuses MIT-licensed encoding-sniffer 1.0.2 and
node-fetch-native 1.6.7 with Node 26's actual fetch/Response/DOMException rather
than a deprecated DOMException shim. Generated decoding, native response and
abort fixtures qualify the overrides; no provider, credential or hosted
inference behavior is substituted. Electron 44.9.3 and patched allowed
transitives address the observed install advisories.

## Validation measurements, 2026-10-18

On the same macOS arm64 / Node 26 host, sqlite-vec 0.1.9 successfully loaded into
Node's real SQLite driver. Inserting 500 vectors, querying a project-partitioned
nearest-neighbor result and reading a graph edge took 13.12 ms total. An official
MCP client/server pair performed initialization, tool discovery, invocation and
result decoding through the supported in-memory transport.

The official 0.2.0 macOS arm64 Metal runtime (5,031,510 bytes) was downloaded,
matched against NVIDIA's published SHA-256 and executed. `--version`, JSON model
discovery and transcription help passed without weights or microphone access.
The default ASR catalog names Nemotron 3.5 and pins its GGUF revision. Model
inference and capture remain user-setup-dependent, not claimed benchmark passes.

SendBox remains a FAIL/unavailable physical-host spike because the CLI, trusted
guest artifacts and approved workload image are absent. Tests may exercise
configuration and fail-closed policy, not call a fixture a qualified real VM.

## Executable SDK platform checkpoint

The complete macOS suite passes **43** generated unit/integration/native-TUI
checks. The hidden Electron suite passes **2** workflows for source clients:
Copilot/device-flow wiring, streaming/tools, cross-client drafts and recovery,
plus dark defaults/mascot, prompt warning/edit/reset, preserved dirty settings,
shared permissions, real local indexing, MCP discovery and default-off modes.

The packed external consumer passes strict NodeNext declarations for all four
public entrypoints and runs an embedded service, project-partitioned vector
retrieval, native MCP discovery and speech-runtime readiness without Electron,
personal auth or model weights. A clean locked install, type checks, production
build and audit pass with zero reported vulnerabilities. Known upstream
`node-domexception`/`whatwg-encoding` deprecations and OpenTUI's experimental FFI
warning remain visible.

New regression coverage includes schema-1 migration without history/receipt
loss, persistent vectors/graph after restart, ignored/stale source suppression,
real stdio and Streamable HTTP MCPs, credential redaction, bounded pagination,
process shutdown/cancellation, revocation and external/agent project-lease
exclusion. Subagent cancellation covers a queued child before admission.
Generated recognizers prove early stop prevents later microphone startup,
finalize versus discard, and TERM-resistant output-limit escalation.

The repeated primitive spike measured 500 vector inserts/query/graph reads in
5.45 ms; official MCP discovery/call/result passed. The UI's bounded desktop/
compact/settings inspection and deterministic design scan found no remaining
mechanical issues. None of these results claims live Copilot entitlement,
learned semantic embeddings, real ASR accuracy, microphone capture, qualified
SendBox or notarized release readiness.

The versioned `0.2.0-alpha.1` macOS arm64 development artifact also passed the
packaged SDK/service, bundled Node, CLI/TUI, mascot-icon and native speech
runtime checks. Both hidden Electron workflows passed against that actual app.
Its DMG is approximately 298 MiB and ZIP 240 MiB; the DMG checksum and ad-hoc
bundle signature verify. Packager reports the optional `.icon` format absent;
the generated `.icns` fallback is present and byte-verified against the source
branding build. No production signing/notarization or model weights are claimed.
