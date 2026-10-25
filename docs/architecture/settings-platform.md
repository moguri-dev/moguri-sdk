# Searchable settings and desktop runtime preferences

This contract extends the executable alpha. Requested controls are not evidence
that their native capability is installed or qualified. `docs/setup.md` remains
the inventory of available behavior.

## Scope and navigation

Settings are grouped as General, Models, Integrations, Execution & permissions,
Sessions, Instructions, Per-project configuration, Appearance, Voice,
Accessibility and Notifications. Search indexes category labels, controls and
their common names, without indexing credentials or conversation content.
Boolean/select controls save their own field against the committed revision.
Text controls have an adjacent Save action. Neither search nor navigation
discards edits or commits unrelated fields.

The scrollable left navigation owns Start and profile-wide resources:
Suggestions, usage, independently retained artifacts/candidates, native execution
management and the global console. Attention has one entrypoint in the top bar.
The right rail contains only current-session tools. Existing sessions are selected
explicitly where a global operation needs a source; opening a global page never
creates a hidden session, inherits a null root or starts a model.

Provider configuration and profile management live in Settings. Project-folder
actions open the actual project's configuration. Original Moguri typography,
colors and component patterns are retained; the reference image is not a design
source.

## Authority and defaults

The local service and typed SDK own persisted configuration, integration status
and capability operations. Root-owned machine preferences remain separate from
profile-owned voice, appearance, instructions and notifications. Switching a
profile does not move drafts, owned work, credentials or source roots.

Factory execution controls remain Local, no selected model, Manual and Unlimited.
Existing global/profile/project/session precedence and hard policy still apply.
Default tool policy can ask or deny; an ordinary preference cannot create a
blanket shell grant. Verbosity affects response guidance, not telemetry,
permissions, budget admission or retained outcomes.

Archive and deletion automations both start off with seven-day factory
thresholds. Upgrading preserves explicitly saved legacy retention values.
Only actual canonical completion qualifies for automatic archival. Live work,
pending user input, drafts, queues, active descendants and uncertain ownership
block archival. Deletion uses the existing retention/grant APIs, never direct
database unlinking. Independent artifacts and workspaces keep their own lifetime.

Recovery after sleep or interruption is explicit. Reconnection must not replay a
paid call, tool, queued held prompt, clone, publication or unknown completion.
Idle-sleep prevention covers real owned work and the configured tail interval,
not manual sleep, lid closure or the remote host's power policy.

## General and integrations

Automatic update discovery runs on desktop startup and every four hours.
Private release access uses an explicitly supplied PAT in a purpose-specific
secure secret namespace, never settings, event payloads, argv or model context.
This credential is not the Copilot account or the GitHub CLI account.
Restart/install requires actual user confirmation of the exact staged release.

The user explicitly selected updates without Apple signing. Ad-hoc builds are
not notarized releases. Verified release identity, bounded authenticated
downloads, archive path/link validation, asset SHA-512, exact bundle identity and
owned destination checks remain required. Never strip quarantine, disable
Gatekeeper, evade an OS warning or call an incomplete replacement successful.
Interrupted application replacement retains recoverable old/staged bytes and
does not automatically repeat an uncertain install.

Protocol/database 50 adds root-owned `application.update_recorded`. A separate
`dev.moguri.application.updates.<whole-store-key-id>` secret namespace holds only
the private-release PAT; token intake is transient, never a durable command,
receipt argument, model input or shell argument. Native desktop admits an
automatic check on startup and every four hours while it runs; hidden fixtures
admit none. Current root preferences are rechecked. An existing ready/partial
update needs review, not an automatic paid/network retry. Manual checks and
cancellation retain original command identity and actual outcomes.

The fixed HTTPS GitHub repository, release and asset IDs must agree with one
bounded architecture-specific manifest. API redirects never forward the PAT to
asset/CDN hosts. Archives require exact size/SHA-512, bounded expansion, unique
normalized/case-folded paths, CRCs and ordinary files/directories. Only safe
internal relative framework links are created, after files; symlink parents,
escapes, cycles, devices and unexpected application roots are rejected. Actual
bundle inventory SHA-512, identifier, package version/entrypoint and Mach-O
architecture are checked. Staged bytes are quarantined, not executed.
AppleDouble `__MACOSX` metadata is size/path bounded but never extracted or used
as application permissions; actual `ditto` metadata directories may be 0775.
Application entries retain their strict mode/type checks and full tree digest.
The drag-to-install DMG separately includes an `/Applications` shortcut beside
the actual app bundle. That external link is never inside the application tree
or updater ZIP. Packaging verification mounts only its own read-only image,
checks both top-level entries, then detaches it without launching the app.
No dependency, durable schema, runtime API or installation permission changes.

Installation is separately reviewed against fresh old/staged tree digests, the
actual owned packaged app, same-filesystem candidate and retained backup.
Unpackaged runtimes cannot replace a checkout. Durable installing intent precedes
filesystem preparation. The current pinned standalone Node and a builtin-only
bundled installer are copied/hashed into a private original helper compartment;
non-system-dylib runtimes are refused instead of lazily borrowing libraries from
renamed/new code. Helper environment excludes Node/DYLD injection. The exact
service/desktop owners must end before replacement; no guessed PID is signalled.
The service arms that one helper only after actual all-profile/SQLite shutdown.
Unknown/missing receipts or failed cleanup never authorize another installer.

The helper preserves the previous app, re-verifies actual copied/renamed bytes
and requests normal OS launch without removing quarantine or bypassing warnings.
`installed` is not `completed`: the new running bundle/version must match the
retained journal/digest at next startup. A failed launch still retains known
installed bytes and explicit launch failure. Original partial stages, siblings
and backups are not implicitly deleted. Tests exercise a real copied helper and
standalone Node with generated bundles/PIDs, while suppressing OS application
launch and all personal credentials.

Menu-bar visibility is a real native preference, not a renderer-only checkbox.
Native capabilities accept only the trusted main renderer and actual user
actions. Embedded browser content never gains native configuration authority.

GitHub integration uses the user's existing GitHub CLI account, explicitly
distinct from Copilot model login and the updater PAT. SSH metadata continues
to use the captured SSH account rather than controller credentials. Linear
credentials retain their existing explicit secure backend and reviewed team
scope. MCP discovery/OAuth stays resource-bound and user-initiated.

SendBox settings expose the existing managed deny-first policy and exact native
artifact/image/network qualification. Opening Settings is not permission to
download an image, start a VM, run lifecycle scripts or fall back to Local.
Missing prerequisites and partial native cleanup stay visible.

The sql-not-so-lite integration connects to an explicitly configured existing
`mbianchidev/sql-not-so-lite` daemon. It does not start a daemon, trigger its
default Home scan, expose Moguri's private store, or replace Moguri's event
storage. Its upstream default listener has no authentication/TLS; prefer
execution-host loopback and never transmit credentials over plain network HTTP.
Connection/status inspection must report actual failures, not an optimistic
"connected" preference.

## Reviewed storage relocation

Changing session storage means relocating the complete encrypted control-plane
store, including profiles and independently retained artifacts, after review
and restart. It does not split a session's events from their retention grants.
Explicit `MOGURI_STATE_DIR` continues to take precedence; do not silently override
an explicitly selected root.

Review binds canonical source/destination ownership, data identities, the exact
copy set and active-work impact. Stop or quiesce writers before copying SQLite
state, including WAL. Preserve event bytes, profile IDs, master-key identifiers,
secret namespaces, budget holds, independent grants and unknown outcomes.
Captured project/worktree/terminal roots are separate filesystem authorities;
do not rewrite event history or silently move an active checkout.

Persist intent before effects. Publish discovery changes atomically only after
verifying the actual copied bytes. Old roots must not start a second stale
writer or silently become an empty replacement store. Partial/cancelled moves
retain old data and a reviewable outcome; cleanup and rollback are explicit,
never recursive deletion of an entire user-selected root. Exact authenticated
user PTYs can survive an explicit service restart, without input replay.

Protocol/database 48 introduces root-owned `application.configured` and its
single observed revision, independent of every profile's settings. The real
Electron menu-bar icon follows that saved flag; hidden fixtures suppress native
tray creation. Protocol/database 49 adds `application.storage_recorded`, a
private external locator and a whole-store key-ID writer lease. An explicitly
provided state root stays explicit, including through SDK auto-start. Default
discovery and launcher-internal state-directory propagation are distinguished.

Relocation review fixes the canonical source/destination, whole-store identity,
all profile IDs, actual active owners, exact destination inode/emptiness and copy
set (`state.sqlite`). Admission retains original intent before synchronously
closing profile admission. Every known controller is signalled before setup or
cleanup awaits. An authenticated transient intake acknowledges the original
operation without requiring a snapshot after its service closes. All SQLite
connections and WAL close before the bounded streaming copy. Actual source and
destination SHA-512 plus the retained key ID are reverified before atomic locator
publication. The first target boot verifies those exact copied bytes before its
SQLite acknowledgement and ordinary profile/provider initialization.

`storage_resource_base` retains the original private filesystem authority for
profile resources, worktrees, models, caches and PTY brokers. Those paths and
event bytes are not migrated to the data directory. Per-key external mapping
rejects old/copy aliases, and a live or unconfirmed writer lease prevents a
second service for the same key ID. Missing recorded locators and changed copied
bytes block startup rather than selecting an empty or stale fallback. Source
and partial target are retained. A restarted interrupted intent becomes partial,
never an automatic copy/restart. Native maintenance suppresses automatic service
reconnection until the explicitly requested app restart.

## Instructions and appearance

Global guidance applies within the actual profile, with explicit project
overrides for documentation, conflicts, CI, planning and debugging. Templates
cover README readiness/sections, issue types/fields, PR evidence, preferred
stacks, language bootstrap, non-code/user-facing writing and community files.
The readiness skill is inspiration, not a fabricated license, contact, badge,
support promise or legal review. Unset contacts/licenses remain unset.

Guidelines enter the recorded instruction snapshot for future turns. They
cannot authenticate, grant tools, answer a structured question or authorize Git.
Upstream controls require one actually detected repository, including a
supported nested `.git` directory; multiple roots remain explicit rather than
guessed.

Dark remains the factory theme. Named palettes and custom element colors are
typed profile preferences shared through the SDK. Color checks include text,
controls, disabled states and visible keyboard focus. Custom themes do not
change the semantic meaning of warnings or permission states.

## Voice, shortcuts and notifications

The pinned NeMo-Speech runtime captures only its default native microphone.
Its `--device` option selects compute backend, not an audio input device.
Do not invent a CLI microphone-selection flag. Explicit desktop media-device
capture must normalize bounded local PCM/WAV before the existing recognizer.
Audio is transient, never durable model context, command receipts or events.
No microphone access, ASR model download or test playback occurs on Settings
load.

Shortcut mapping preserves IME composition, text editing, terminal ownership,
Enter-to-send, Shift+Enter newline and Cmd/Ctrl+Enter held prompts. Push-to-talk
owns press/release, repeated keys, async permission/startup, blur/unmount,
profile/session changes and cancellation. Releasing before startup must not
open a late microphone or send a message.

Needs-input sounds come from actual questions/approvals, not heuristic badges.
Completion sounds require actual completed work, not stopped/failed/partial
outcomes. Sound and desktop-banner choices are independent. Startup baselines
and reconnect cursors prevent replay and duplicates. Default earcons are
original/generated. Explicitly selected custom sounds are bounded and retained
independently of source session deletion; new blob references need transactional
retention grants.

Protocol/database 46 adds the browser-capture marker and transient typed voice
route. Admission binds original client job ID/profile/session, requires installed
model/runtime, and excludes concurrent speech. Private 0700/0600 WAV staging is
canonical-root checked and removed on settlement/restart; unknown entries block
new capture, never get adopted. Device capture uses an AudioWorklet emitted as
an actual same-origin asset (`?no-inline`), without weakening CSP. Physical
press/release, delayed media admission and one final upload remain controller
owned. Tests use Chromium's actual generated device and a generated recognizer,
not a real microphone or downloaded model.
Unconfirmed client cancellation retains its original lease and a visible discard
retry; another microphone cannot start while that cleanup is unresolved.

Protocol/database 47 adds notification settings and `notification.sound_saved`
and `notification.sound_removed`. Every immutable sound is a separate encrypted
retention compartment (`notification-sound/<id>`); its digest enters the existing
transactional blob-reference mechanism. Removal retains only original command
identity, preventing import replay after receipt loss without keeping deleted
audio/name in that tombstone. Per-profile choices require an existing resource.
File import accepts regular, no-follow, bounded canonical PCM16 WAV, at most ten
seconds and 32 retained resources per profile. No compressed-media decoder or
sound fallback is added. Native preview/import validate the trusted main frame
and exact active profile before/after asynchronous delivery. Profile/suspend
signals close pending playback; a late audio-context resume cannot start it.
Failed audio cleanup retains its exact context for explicit retry. OS banners
are silent; separate application audio follows its own saved enable/focus flags.
Migration preserves prior ciphertext, exact defaults and explicit device choices.

### Press/release dictation and audible attention

The desktop microphone button follows the saved push-to-talk preference, just
like its keyboard shortcut: press owns one capture, release flushes and transcribes
it once, including release outside the button through pointer capture. Space and
Enter provide the same hold/release interaction when the button has focus.
Toggle mode keeps its click/start, click/stop behavior. Early release before
microphone readiness never opens a late input and explains why no transcript
exists. Interrupted or externally cancelled captures are visible, not silent
returns to idle. Hiding the window after Stop does not cancel local recognition
of the already-finalizing clip; active microphone capture is still discarded
on blur, hiding, sleep or owner changes.

Completed text is displayed for review before revision-checked insertion.
`sdk.voice.transcript(sessionId, jobId)` reads the exact completed local speech
job through the existing bounded result pages, without truncation or a new
service route. It never sends a prompt. Settings, CLI and TUI keep the same local
recognizer and explicit insertion authority.

Attention audio also covers actual failed/partial work, alongside exact pending
questions and approvals. Completed audio still excludes failed, partial, stopped
and runnable follow-up work. New factory preferences enable both sounds while
focused as well as in the background; saved explicit mute/focus preferences
remain authoritative. Native banners stay independently disabled and silent.
There are no new durable events, schema changes, dependencies or migrations.
Reuse React/Electron (MIT), Web Audio and the existing Apache-2.0 NeMo-Speech
runtime; no models are downloaded by tests. The MIT-licensed
[Handy](https://github.com/cjpais/Handy) press/release interaction and
[pi-voice](https://github.com/earendil-works/pi-voice) single-take capture/stop/result
lifecycle inform the behavior, without importing their application runtimes.

Before integration, the repeated macOS Phase 0 run passed the six executable
spikes: SQLite append p95 **0.047 ms**, rebuild **0.52 ms**, PTY cancellation
**151.91 ms** with no fixture survivors, TUI updates **17.04 ms**, Electron shell
startup **190.57 ms**, working set **444.94 MiB**, scrolling **11.99 ms**, and
2,000-file Git status **5.92 ms**. Existing unavailable live-provider, Rust/Linux,
release-signing, SendBox, routing and remote-host gates remain unqualified.
Generated tests cover physical pointer/keyboard release, early admission,
cancelled outcomes, actual bounded WAV delivery, transcript/draft isolation and
attention/completion/focus preferences without a real microphone or speaker.

## Reused components and persistence

Reuse React and Electron (MIT), Ghostty Web (MIT), Node builtins/SQLite, the
existing SDK/event store/keychain and native SendBox supervision. Existing
`semver` (ISC) and `yauzl` (MIT) provide version ordering and bounded ZIP
primitives for release staging. Do not add a parallel provider loop, terminal parser,
configuration database or unsigned automatic script executor.

NeMo-Speech.cpp 0.2.0 remains Apache-2.0. The optional pinned Nemotron model is
OpenMDW-1.1 and still requires explicit download/license consent. This work never
downloads model weights as a dependency or test fixture. sql-not-so-lite is MIT;
connecting to it does not bundle or manage the daemon.

New durable fields/events require an explicit schema migration, legacy nested
default normalization and restart coverage. No upgrade requires deleting state.
Root settings are replicated only through existing root authority, not a
foreign-profile content broadcast. Native filesystem/update intents retain
their own immutable owner and terminal/partial outcome.

Startup connection compatibility is not a durable schema change. Node discovery
separates structurally invalid metadata from a private older-protocol connection,
checks authenticated PID/protocol health, and exposes a token-free exact-root
upgrade review. Desktop requires actual human confirmation before the existing
authenticated restart path, preserving terminals without input replay. A changed
registry during confirmation is rejected before any stop; newer services are not
downgraded. Dead/unreachable stale metadata uses ordinary lock/recovery startup,
not a database reset. Timeout/unconfirmed health never authorizes PID-based
force-stop. Discovery remains lazy and Node-only; browser/React entrypoints do
not import provider, MCP or PTY runtime code. Tests use generated endpoints,
original drafts/grants and a real generated replacement service, never personal
credentials or model requests.

Ordinary desktop close is not a terminal-preserving restart. Accepted last-window
close, Cmd+Q and Quit fence new connection/profile admission, await an in-flight
connection, and stop the exact captured private-root/service fingerprint through
the existing authenticated lifecycle. Electron exits only after real all-profile
cleanup, including owned user consoles and stopped/partial worker outcomes.
Unsaved-edit cancellation leaves the service running; changed ownership or failed
cleanup retains the original state and an explicit retry. Reviewed update/storage
restart handoffs remain separate. This follow-up reuses Electron (MIT), Node
builtins and the existing Node SDK lifecycle; it adds no dependency, durable
event, schema migration, provider permission or client-only domain state.
Generated native coverage exercises accepted close during actual work, cancelled
close, failed private cleanup/retry and a delayed connection admission.

## Fresh prerequisite measurements

Phase 0, session/Ghostty and model-control spikes were rerun before this change:

| Generated probe | Result |
| --- | --- |
| Provider cancellation | 31.94 ms |
| SQLite append p95 / crash rebuild | 0.051 / 0.502 ms |
| Known PTY-group cancellation | 152.28 ms |
| OpenTUI update | 16.88 ms |
| Hidden Electron cold start | 178.27 ms |
| Aggregate Electron shell memory | 449.03 MiB |
| 10,000-row scrolling | 8.2 ms/frame |
| 2,000-file search / Git status | 0.947 / 5.944 ms |
| Independent retention | 122.73 ms |
| Hidden real Ghostty | 24.10 ms |
| Model-control transport checks | 62.66 ms |

The model spike forwarded supported low effort for OpenAI Responses and
Anthropic and withheld the unsupported Copilot compatibility option. These
generated results do not qualify real account entitlement, live model quality,
Apple signing/notarization, Linux release execution, a new native guest or a
personal SSH machine. Original spike unavailable/FAIL labels remain historical
gates, not proof of current runtime discovery.

Additional generated/native qualification for the implemented settings:

| Exact probe | Result |
| --- | --- |
| PCM/device/PTT, cancellation and retained sound checkpoint | 30 focused checks and nine hidden UI checks passed |
| Full-store move with independent sounds, two profiles and unchanged project roots | Passed, 322.75 ms |
| Changed target / partial-copy restart / no-replay | Passed; source and exact competing bytes retained |
| Root preference and native relocation UI | Passed in a hidden window; no real tray/picker/relaunch |
| Private GitHub feed/PAT/CDN and original-command checks | Passed with generated credentials and intercepted HTTPS requests |
| Actual copied standalone helper, shutdown arm, old/new bundle and startup receipt | Passed, 2,318.36 ms; generated owner PIDs and suppressed OS launch |
| Interrupt after preserving old bundle | Passed, 46.59 ms; exact backup and candidate retained, zero launches |
| Actual freshly packaged macOS ZIP/manifest through production consumer | Passed, 306,986,780 archive bytes / 96,895.78 ms |
| Packed external SDK, CLI and shared terminal updater/store paths | Passed; no personal credential, inference or app launch |
| Initial settings checkpoint: complete serialized unit/native suite | 1,149 passed, nine gated skips, zero failures; 1,158 total / 1,047,837.54 ms |
| Initial settings checkpoint: complete hidden Electron suite | 90 passed, one native-Sandbox gate; 91 total / about 3.5 minutes |
| Initial settings checkpoint: packed-consumer install, all SDK entrypoints and dependency audit | Passed; zero vulnerabilities |

The desktop-close follow-up additionally qualified the current exit behavior:

| Exact follow-up probe | Result |
| --- | --- |
| Captured-owner stop, startup compatibility, reconnect and terminal recovery | 36 focused Node checks passed |
| Related close, dictation, onboarding and explicit Remote restart UI | 15 hidden Electron checks passed |
| Complete hidden Electron suite after the exit change | 95 passed, one native-Sandbox gate, zero failures; 96 total / 3.6 minutes |
| The four close/cancel/cleanup-retry/pending-admission cases in the actual newly packaged executable | Passed; generated state and hidden windows only |
| Fresh packed external SDK types/entrypoints, approved install, installed worker/CLI/TUI and audits | Passed; zero vulnerabilities |
| Fresh actual macOS ZIP/manifest through the production consumer | Passed, 306,994,866 archive bytes / 96,299.39 ms; no application execution or quarantine bypass |
| Fresh actual read-only mounted DMG | Passed; real app and Applications shortcut, no application execution |

The package producer now keeps development bundles under
`release/builds.noindex/`; distribution archives stay directly under `release/`.
The older full-unit count above is a historical checkpoint, not a claim that the
entire serialized unit suite was rerun for this exit-only follow-up.

The actual shell-installed Node depended on non-system Homebrew dylibs and was
not a standalone installer runtime. That failed probe was not worked around by
borrowing libraries; the real helper qualification uses the project's pinned
standalone Node, and production rejects non-system dependencies before effects.
The package's ad-hoc signing and optional `.icon`-format warning do not claim
Apple developer signing, notarization, live private-token entitlement or Linux
release readiness. The existing lazy Ghostty chunk-size warning remains separate
from correctness of these native primitives.

Raw pre-settings migration probes now remove only the six additive 45-50
markers through a shared guarded fixture helper before testing their original
transactional failure/rollback. Their ciphertext, key, receipt and original
schema assertions are unchanged. A genuine new native intent/sound event cannot
be relabeled as old fixture state. The project-free permission assertion includes
the explicit default `ask`, and the no-repository MCP race mutates a valid folder
policy revision rather than attempting an intentionally prohibited upstream
configuration. Production migration/admission checks were not weakened.

## Required evidence

Use generated fixtures for preferences/revision races, migrations, restart,
retention boundary ages, interruption/cancellation, exact-root relocation,
private release feeds/archives/digests, secret namespaces, SQL health,
media-device/WAV capture, shortcut collisions, notification cursors and power
driver ownership. Hidden Electron tests exercise actual grouped search,
global/session navigation, dirty-edit barriers and profile switching.

Qualify the built SDK's browser-safe root/React and explicit Node/runtime
entrypoints in a packed external consumer. Build/type-check and focused checks
precede the full native/unit and hidden Electron suites. No real microphone,
personal credentials, user data, paid inference or system audio is a fixture.
