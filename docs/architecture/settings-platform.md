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

## Reused components and persistence

Reuse React and Electron (MIT), Ghostty Web (MIT), Node builtins/SQLite, the
existing SDK/event store/keychain and native SendBox supervision. Existing
`semver` (ISC) and `yauzl` (MIT) provide version and bounded ZIP primitives if
needed by release staging. Do not add a parallel provider loop, terminal parser,
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
