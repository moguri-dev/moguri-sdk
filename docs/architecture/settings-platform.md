# Searchable settings and desktop runtime preferences

This contract extends the executable alpha. Requested controls are not evidence
that their native capability is installed or qualified. `docs/setup.md` remains
the inventory of available behavior.

## Current control destinations

The protocol99 presentation correction puts source-admission management only
under **Settings / Skills**, with the actual selected source chat and no
inferred root. Source/profile/committed-configuration changes discard the old
inspection and confirmation. The existing per-session prompt timeline sidebar
owns **Checkpoints and rewind**, opening the original exact-target controls in
a keyboard-accessible dialog. Neither management panel remains in the inline
conversation strip; named skill-load activity still belongs in chat.
See the [source/rewind placement contract](skills-and-rewind.md#desktop-control-placement).

**Inbox** follows **Dashboard** in left navigation and replaces the titlebar
attention destination. Its read, actual answer/approval and notification
deletion actions stay distinct; see the [session Inbox contract](session-inbox.md).
These destinations reuse the shared SDK without new authority, events or
migrations in the placement correction.

## Registered-project selection and active-session follow-up

The presentation-only commits `ccfd724`, `0f0ec2d` and `3bcaa87` reuse React and
Electron (MIT), Playwright (Apache-2.0), the existing browser-safe SDK, shared
session indicators, revision-bound project configuration, retained drafts and
native navigation menus. That slice adds no dependency, service capability,
event, durable field or migration. Its original protocol-82 observations below
remain historical. The combined follow-up uses the separately documented
[protocol-83 content-review contract and qualification](content-review.md);
no earlier worker/native receipt is relabeled.

The project configuration dropdown lists only the active profile's registered
projects. Its exact selected ID is independent of the current conversation.
An empty profile selects nothing. A disappeared target stays explicitly
unavailable, never replaced with the first project; pending editor text remains
available read-only until explicitly discarded. Busy/dirty edits block target
changes, and writes keep the existing configuration revision check. Selection
does not move a session, change its captured execution root or start work.
Settings search alone has no copy-value control. Non-secret configuration
fields retain their existing copy affordances.

Project-group menus expand/collapse their actual member projects (the attached
folders), not an invented recursive folder hierarchy. They preserve unrelated
groups, configuration, drafts and pagination. Expanding also opens the selected
outer group. Collapse state remains renderer presentation, using the existing
profile-reset lifecycle rather than becoming execution or persistence authority.

Private-update setup is a visible explicit button for the fixed updater source,
`moguri-dev/moguri` (formerly `mbianchidev/moguri`,
[D75](decisions.md#d75-sdk-and-tui-split-repository-moves-and-homebrew-prerequisites)),
independent of the browsed project. GitHub's documented fine-grained PAT URL
supports `target_name`, `contents=read`, name, description and expiration,
**not repository selection**. Moguri omits `target_name` so one link works for
any owner. Visible instructions require the release repository's
owner and **Only select repositories** with that repository; the link is not described as an already
repository-scoped grant. Users review and generate tokens themselves. Clicking
does not inspect credentials, authenticate or start an update. See GitHub's
[supported prefill parameters](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#supported-query-parameters).

Dashboard's My work page prioritizes current active sessions ahead of historical
charts. Existing SDK snapshots/events and shared status labels supply actual
running, waiting and stopping states. Date ranges never hide current activity;
the explicit project filter still applies. Held queues are not running work.
Connection loss labels last-observed activity stale and disables navigation
instead of claiming that no work exists. Navigation uses the existing exact
session/profile and draft-flush path; it does not answer, approve, resume or
consume queued prompts.

Before feature integration on macOS arm64, the six generated Phase 0 checks
passed: OAuth/streaming **1,091.09 ms**, cancellation **30.59 ms**; 1,000-event
WAL append p95 **0.053 ms**, rebuild **0.509 ms**; nested PTY cancellation
**152.53 ms**, no known-group survivors; 60 TUI frames **17.00 ms/update**;
hidden Electron cold start **201.84 ms**, **437.22 MiB**, scroll frame
**11.23 ms**; 2,000-file search **0.97 ms**, Git status **6.23 ms**.
Independent retention retained 250 artifacts across 500 events in **133.51 ms**;
hidden Ghostty input/108-column resize passed in **23.60 ms**. Generated
model-option forwarding/sizing passed in **62.07 ms**. Live credentials,
Linux/Rust, native isolation and release qualification are not established by
these generated checks. Main CI run `41019712786` never started its steps:
GitHub annotations require account billing/spending-limit action, not a workflow
change or another run.

### Generated qualification

The six new hidden Electron scenarios in
`tests/e2e/settings-dashboard.spec.ts` passed twice (**12/12 in 13.7 s**).
The final focused client regression run passed **37/37 in 1.2 min**; the
associated SDK/service checks passed **46/46 in 5.95 s**. They exercise actual
keyboard/context-menu selection, empty/foreign-profile and deleted project
targets, concurrent configuration revisions, unchanged ordinary copy controls,
current group membership, the intercepted supported GitHub setup URL, live
waiting/running/stopping activity, refreshed work counts, stale connections,
exact-session focus and preserved drafts/questions/held queues.

`npm ci --no-fund`, typecheck, build and the packed external consumer
`npm run verify:sdk` passed; both dependency audits reported zero vulnerabilities.
These original protocol-82 measurements retain their genuine migration/restart
history and existing SDK/CLI/TUI paths. The packed consumer also retains its
real worker, profile, budget, cancellation and restart probes. These were
targeted source checks, not whole-suite or release qualification. The later
[combined protocol-83 evidence](content-review.md#final-generated-qualification)
records the full Node/desktop results and exact current payload identities;
live GitHub authentication and unqualified native boundaries remain separate.

Generated Dashboard screenshots are retained in the Playwright output as
`active-sessions.png` and `active-sessions-filtered.png`. No real account,
authorization page, customer data or model endpoint was used. Existing Vite
chunks above 500 kB still produce a size warning; the packed consumer reports
the upstream `whatwg-encoding`/`node-domexception` deprecations and explicitly
reviews this package's install script before rebuilding. No warning was hidden
or validation disabled.

## Scope and navigation

Settings are grouped as General, Models, Integrations, Boundaries,
Sessions, Instructions, Per-project configuration, Appearance, Voice,
Accessibility and Notifications. Search indexes category labels, controls and
their common names, without indexing credentials or conversation content.
Boolean/select controls save their own field against the committed revision.
Text controls have an adjacent Save action. Neither search nor navigation
discards edits or commits unrelated fields.

The scrollable left navigation owns New and profile-wide Dashboard, Inbox,
Suggestions and Automations. Global Terminal was removed in protocol 60;
Automations now lists service-owned one-time schedules, not recurring/declarative
workflows. Code change and Work item live in the right rail, bound to the selected
session, not global resources. Independently retained
Artifacts/Candidates and native execution management live in Settings; Sandbox
combines managed SendBox setup and retained workspace/publication controls.
Session notifications use Inbox rather than a top-bar attention entrypoint.
The right rail contains only current-session tools. Existing sessions are selected
explicitly where a global operation needs a source; opening a global page never
creates a hidden session, inherits a null root or starts a model.

Provider configuration and profile management live in Settings. Project-folder
actions open the actual project's configuration. Original Moguri typography,
colors and component patterns are retained; the reference image is not a design
source.
Copilot connection status is visible only under Settings / Models / Providers;
the left footer does not contain a provider badge or connection button.

The [protocol-59 experience](workspace-experience.md) keeps profile name, mascot
Ask Moguri and icon-only Settings on one footer row. Non-secret configuration
input/textarea controls share hover/focus copy affordances; password fields
and Settings search are explicitly excluded. Long explanatory prose uses focusable
information tooltips. Consequential warnings, actual status, errors and source
review acknowledgements stay visible. Editing, revision conflicts and dirty
navigation guards are unchanged.

### Contextual action captions

Settings buttons use the adjacent field, row or section as their subject.
Linear key actions say **Store**, **Verify**, and **Remove**, not repeated
credential instructions. Shortcut fields say **Record** and **Save** in both
Keyboard shortcuts and Voice dictation; recording still names its actual field
for assistive technology and preserves the same capture/Escape/Tab behavior.
Credential forms, updates, storage, integrations, source reviews and retained
record panels use the same concise verbs. Keep necessary consequences explicit:
for example **Move and restart**, **Install and restart**, **Create and push**
and **Commit on new branch**.

Visible captions must remain part of the contextual accessible name. Native
button semantics, precise target names and original state announcements remain
intact. Long warnings, actual credential/account status, review details,
consent checkboxes, partial outcomes and confirmation requirements are not
replaced by the short caption. Existing icon-only actions remain icons except
the specifically requested Linear **Remove** button.

This is presentation-only reuse of React/Electron and the existing settings
components under their current MIT/component notices. The installed
Rolldown/Oxc parser performs lossless explicit-caption edits and audits the
original controlled attributes. No dependency, service/SDK/TUI contract,
protocol/schema, credential namespace, permission, budget, cancellation or
restart behavior changes. Protocol 70 and its exact native worker remain
unchanged. Generated native checks must verify visible copy, label-in-name,
actual Linear storage/verification/removal, shortcut recording/cancellation,
individual saves and the existing dirty/navigation gates.

The prerequisite generated OAuth/streaming check passes in 1,074.62 ms
(32.44 ms cancellation), SQLite in 71.65 ms (append p95 0.069 ms), PTY in
159.09 ms (150.94 ms cancellation, zero survivors), OpenTUI in 1,072.40 ms,
hidden Electron in 548.06 ms (8.11 ms frames) and filesystem/Git in 94.12 ms.
Platform vector/graph and official MCP primitives pass too. The generic spike
continues to report its broader live-account, Rust/Linux, signed-release,
personal SendBox/SSH, quality and wider-initial-checkpoint gates as unqualified;
these are not new readiness claims or a replacement for the executable setup
inventory. No personal key, microphone, app or login is used.

### Concise action qualification

Source `5ff2d75` shortens 151 static actions and their stateful counterparts,
including shortcut recording, budget saves, profile forms, OAuth and source
review controls. Exact contextual names retain label-in-name accessibility.
A lossless JSX check confirms all **838 original controlled actions/fields
across 41 components** keep the exact callbacks, values, disabled states and
consent gates. Linear's requested text Remove button replaces its icon wrapper
with the same native button type and unchanged removal callback.

Generated native regressions first reproduce the three verbose-caption cases.
The final tests use the real secret backend shim and intercepted Linear
verification endpoint: Store makes no account request, Verify requests the
actual stored identity once, and keyboard Remove clears only that key.
Shortcut Record captures a chord without saving it until Save; Escape cancels
recording, both settings locations agree, and unrelated bindings stay intact.
Visible captions remain in their exact accessible names across the visited
settings sections. No selector update changes a functional assertion.

| Surface | Observed result |
| --- | --- |
| Strict types and production build | Pass |
| Focused settings/shortcut/integration source checks | 19 passed in 1,318.88 ms |
| Focused native concise-action/credential/shortcut/help checks | Seven passed in 13.9 seconds |
| Complete hidden desktop suite | 239 passed, three existing skips, zero failures; 242 flows in 7.9 minutes |
| Actual packaged-app settings/integration/review flows | 35 passed in 1.6 minutes |
| Native help geometry | 34 sections, 200 renderings at widths 1,280/860; maximum offset one CSS pixel against the strict two-pixel bound |
| Independently installed packed SDK | All entrypoints, declarations and actual runtime checks pass |
| Actual installed-worker continuation/accounting probes | 12 passed |
| Source and independent-consumer audits | Zero vulnerabilities |
| Production ZIP/manifest consumer | Pass; 779,847,600 bytes in 112,930.49 ms |
| Canonical and labelled DMG | Exact signed bundle, Finder layout/resources, byte equality and disk-image checks pass |

No backend source or schema changed, and no new complete backend run is
claimed. The exact protocol-70 worker remains SHA-256
`8d7086958be7137be3b0408c3a6e4d05cd07379c3345e5eab4f7b9094450f75d`,
with the existing verified native image
`docker.io/library/moguri-worker@sha256:6b95e0eeef1d89bfb0b0912087703f07c2b56b94d096afd3008d4f3137d32874`.
Temporary audit/refactoring utilities were removed. Generated screenshots were
inspected; no personal app, Finder, login, keychain, microphone or paid provider
was used. Existing experimental FFI, lazy Ghostty, optional `.icon` and
transitive encoding/DOMException notices remain non-blocking.

The retained development installer is
`release/Moguri-0.30.0-alpha.1-settings-actions-70-macos-arm64.dmg`
(794,055,608 bytes), SHA-512
`a9d96d7eda95df010117f84d4045c8ca0f494880dbddae9b429a538e3215d058bcb2836a8f79aa5644e1bc2b6915b76bc2cb36e851b2f591562ce01f71daff2d`.
It is ad-hoc-signed, not notarized or uploaded. Main-push-only CI is unchanged;
an empty working-branch check list is not a CI-pass claim.

### Explicit explanation rows

Every settings information icon must share an explicit row with the heading,
toggle, field, disclosure or table title it explains, not a trailing standalone
row. Heading icons center on their title; wrapped control labels keep help on
the first control line. Native labels and disclosure structure stay intact:
help buttons are separate from toggle labels and summaries, so opening help
does not toggle a preference or expand/collapse its subject.

Reuse React/Electron (MIT), the existing contextual SettingsHelp/InfoTip and
native tooltip/keyboard behavior, plus the installed Rolldown/Oxc JSX parser
for mechanical refactoring. No dependency, service API, durable schema,
permission or model behavior changes. Outside settings, explanatory text
remains ordinary readable content. Critical status, warnings, failures and
review acknowledgements remain visible, and all existing preference handlers,
save/dirty gates and cancellation semantics are preserved.
Static readiness instructions remain plain text, not additional live status
regions competing with the actual operation acknowledgement.

The generated prerequisite passes OAuth/streaming in 1,078.24 ms (32.28 ms
cancellation), SQLite in 64.12 ms (append p95 0.049 ms), PTY in 158.67 ms
(151.22 ms cancellation, zero survivors), OpenTUI in 1,066.71 ms, hidden
Electron in 544.30 ms (8.01 ms frames) and filesystem/Git in 92.90 ms.
Native geometry must prove actual title/control alignment at wide and narrow
widths, correct hover/focus/Escape behavior, unchanged toggle state when help
is used and no orphan icon across settings categories. Physical/live-provider,
Rust/Linux, SendBox, quality, notarization and full-milestone exclusions remain
unchanged.

### Settings help alignment qualification

Source `9c4862f` and `9f9e9e8` require every SettingsHelp caller to supply its
actual title/control target. The original screenshot's heading offset
reproduces at 3.4375 CSS pixels, with an update explanation on its own row.
The final shared layout removes inherited button minima and margin/baseline
heuristics. It measures **34 settings sections and 196 rendered explanations**
at 1,280 and 860 pixels wide, with a **one-CSS-pixel maximum offset** against a
strict two-pixel acceptance bound. Generated before/after screenshots were
inspected. Clicking/focusing help cannot change its switch or native disclosure.

A lossless JSX/attribute check verifies all **773 original controlled fields,
actions and handlers across 34 components** remain unchanged. Actual state
messages remain readable; static readiness instructions are not duplicate live
regions. Ordinary non-settings explanations remain text. No runtime dependency,
service/SDK API, protocol, schema, credential, permission or budget path changes.
The existing protocol-69 native worker remains byte-identical.

| Surface | Observed result |
| --- | --- |
| Strict types and production build | Pass |
| Focused settings/domain checks | 26 passed in 5,103.28 ms |
| Focused native settings/save/copy/notification/update checks | 17 passed in 27.2 seconds |
| Final Remote/MCP/terminal/geometry regressions | 11 passed in 32.4 seconds |
| Complete final hidden desktop suite | 234 passed, three existing skips, zero failures; 237 flows in 7.8 minutes |
| Actual packaged-app settings/Remote/controlled-workflow flows | 47 passed in 2.0 minutes |
| Independently installed packed SDK | All entrypoints, declarations and actual runtime checks pass |
| Actual installed-worker continuation/accounting probes | 12 passed |
| Source and independent-consumer audits | Zero vulnerabilities |
| Production ZIP/manifest consumer | Pass; 779,823,858 bytes in 114,704.80 ms |
| Canonical and labelled DMG | Exact signed bundle, Finder layout/resources, byte equality and disk-image checks pass |

Earlier failed runs are not passing evidence. The final regression preserves
Remote operation announcements as the one live status, locates consolidated
SSH guidance by its actual heading and waits for the peer SDK's original
terminal receipt instead of assuming renderer readiness updated every client.
No deadline, ownership check, disclosure guard or test timeout was weakened.
This UI-only slice does not relabel an earlier complete backend run as new.

The retained worker is
`docker.io/library/moguri-worker@sha256:6c253fd7d1e8af016c43155998a915501dc9145170e97cfadf5579e583c4df61`.
That earlier local development installer is:

```text
release/Moguri-0.30.0-alpha.1-settings-info-69-macos-arm64.dmg
794075713 bytes
SHA-512:
5fab86b662d823b1377a716fca295b2c0dc83023eeeeff5d3d1d2ddbfac5906b23707d599ceddede4c7c085645399c6f58d56eeac5f095844c334903fc7db203
```

The installer is ad-hoc-signed development output, not a notarized or uploaded
release. No installed personal app, Finder, real microphone, personal login
or paid inference was used. Experimental OpenTUI FFI, lazy Ghostty chunk,
optional `.icon` and transitive deprecation notices remain non-blocking.
Physical SendBox, external Linux, live-provider, quality and full-milestone
exclusions remain unchanged. CI remains main-push-only, not a passing PR check.

Settings / Confirmations also owns default-on child-session detachment review.
The same review applies to drag-out, Detach and the parent selector's None
choice. Remembering an opt-out saves only this profile's interactions preference;
reset restores confirmation. The service's exact revision, hierarchy, active
work and model-owned-subagent checks are independent of that preference.

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
the optional release token; token intake is transient, never a durable command,
receipt argument, model input or shell argument. Native desktop admits an
automatic check on startup and every four hours while it runs; hidden fixtures
admit none. Current root preferences are rechecked. An existing ready/partial
update needs review, not an automatic paid/network retry. Manual checks and
cancellation retain original command identity and actual outcomes.

Since the open-source readiness change (no protocol change), a check with no
saved token reads the public upstream releases anonymously and applies the same
manifest/archive/bundle verification. A saved token is always used, and an
unreadable or rejected token fails the check instead of falling back to anonymous
access. Anonymous 401/403/404 responses report that the repository is private or
unavailable; GitHub's `x-ratelimit-remaining: 0` reports a rate limit. Neither
stages anything.

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
tray creation. The menu model is pure (`apps/desktop/src/tray-menu.ts`) and is
rebuilt from the active profile's snapshot; actions that need confirmations or
unsaved-edit guards cross to the renderer as typed `moguri:tray-action` messages,
and a closed window takes the pending action once it mounts. The optional
`shortcuts.openApp` (protocol 109) registers a system-wide Open Moguri shortcut. Protocol/database 49 adds `application.storage_recorded`, a
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
Moguri stores no Git upstream. It reads the remote from the folder's own Git
configuration on every use: the `gh repo set-default` choice
(`remote.<name>.gh-resolved=base`), then `origin`, then the only remote. The
checked-out branch never changes it. Several remotes without a default or
`origin` stay unselected rather than guessed. The Repository section shows it when exactly one repository is
detected, including a supported nested `.git` directory.

Dark remains the factory theme. Named palettes and custom element colors are
typed profile preferences shared through the SDK. Color checks include text,
controls, disabled states and visible keyboard focus. Custom themes do not
change the semantic meaning of warnings or permission states.
The [theme catalogue follow-up](themes-and-tui.md) adds the missing requested
presets, preserves Ocean/Orchid/Moguri and saved custom choices, and binds the TUI
to the same tokens. `/theme` uses the ordinary shared settings revision check;
it never selects a model or grants permissions.

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
The signal check uses a generated 48-kHz Web Audio MediaStream, requires actual
normalized 16-kHz PCM with a peak above 1,000 PCM16 units, and checks one upload
and zero generative-model calls. The host's plain Chromium fake microphone can
return silence, so a recognizer fixture returning text alone is not evidence
that waveform samples survived capture. Real microphone hardware and ASR
accuracy remain unqualified by these generated checks.

Final qualification: **82/82** focused voice/audio/settings/recovery checks pass
in **11.31 s**; the full hidden Electron rerun passes **174 cases**, with **3**
existing skips, in **5.5 min**, using the generated `.moguri/artifacts` output
directory. The full unit run exercised **1,359 cases**: **1,341** passed and
**14** skipped; its four pre-sound recovery-fixture incompatibilities were
corrected at fixture generation and all pass in the focused rerun. No migration
guard was weakened or ciphertext rewritten. Type checks, production build,
packed external SDK verification and the moderate-level dependency audit pass
with **zero vulnerabilities**. Vite retains its existing large-chunk warning.

### External streaming voice models

A profile may replace the managed Nemotron download with an existing model file
the user already keeps elsewhere. Trust is explicit and bound to exact bytes:

- `voice.models.discover` is an explicit, read-only query: without a path it
  searches Handy's model folder and the Hugging Face cache (honoring `HF_HOME`,
  `HF_HUB_CACHE` and `HUGGINGFACE_HUB_CACHE`); with a path it checks that file
  or folder. It reads at most a 4-MiB header per file, classifies speech
  architectures from the header, never follows folder links, skips hidden,
  partial and Hugging Face `blobs`/`refs` entries, deduplicates by real path,
  keeps results inside the searched root or home, and is bounded (6 levels,
  50,000 entries, 300 headers, 200 results, 10 s). Nothing is persisted and no
  model is trusted; it only feeds `voice.model.inspect`. Typed paths may start
  with `~/`.
- `voice.model.inspect` starts a read-only `voice.inspect` job. It resolves the
  absolute path to its real path, refuses files inside Moguri's managed model
  directory, reads at most a 16-MiB header prefix, and routes by format.
  NeMo-Speech GGUF (`general.architecture: asr`) must declare
  `asr.encoder.cache_supported`. Other GGUF files are probed by the pinned
  transcribe.cpp library, which must report `supports_streaming` at 16 kHz.
  Legacy whisper.cpp `.bin`, Whisper GGUF and other offline-only models are
  rejected. Only then is the whole file hashed, and a changed size, inode or
  mtime during the review fails it.
- `voice.model.trust` accepts only a completed review job of this profile,
  rechecks the file fingerprint, and writes `settings.voice.model` (path, size,
  SHA-256, runtime, architecture, name, trust time) with `enabled: true`.
  Generic `settings.update` cannot select, alter or clear it; reset may clear
  it. `voice.model.managed` clears it. Neither command runs while dictation or
  disable is active.
- Every preparation re-verifies the selected file. A cached digest is reused
  only for the same device, inode, size and mtime. A mismatch closes the warm
  recognizer, fails with `speech_model_changed`, and reports
  `trust: "changed"` with the observed digest until the user reviews and trusts
  the file again. A missing file reports `trust: "missing"`.
- Moguri never copies, moves or deletes the external file. Disable still
  removes only the managed download and staging.

The transcribe.cpp runtime is the pinned 0.4.2 native archive, verified by size
and SHA-256 like NeMo-Speech, and loaded only inside a separate Node process
(`transcribe-host`) through the built-in experimental `node:ffi`. The host
speaks ordered JSON lines over stdio, checks the library version, converts
PCM16 to float frames and wipes them, and is killed on cancellation, timeout or
protocol violation. A native fault therefore ends the capture job without
taking down the control plane. Streams use the same frame, capture and text
bounds as NeMo-Speech, and an empty final result is `speech_empty`.
transcribe.cpp models serve browser-captured desktop dictation and mono
16-kHz PCM16 WAV transcription; native microphone recording remains a
NeMo-Speech capability and is rejected with `speech_runtime_microphone`.
External models use automatic language handling; locale tiers describe the
managed Nemotron model only.

Protocol/database 107 adds `external_voice_model_schema`. A pre-107 lineage
containing a `voice.inspect` job or a saved `voice.model` is refused, and
migration rewrites no ciphertext. Tests use generated GGUF headers, a generated
transcribe host and the existing generated NeMo recognizer, never real weights
or a microphone. A manual qualification on 2026-11-15 loaded the real pinned
macOS arm64 library with a public Moonshine Streaming Tiny Q8 GGUF and a
synthesized WAV in a temporary folder: Whisper Tiny reported no streaming,
Moonshine streamed partials and finalized the exact sentence in 133 ms.

## Reused components and persistence

Reuse React and Electron (MIT), Ghostty Web (MIT), Node builtins/SQLite, the
existing SDK/event store/keychain and native SendBox supervision. Existing
`semver` (ISC) and `yauzl` (MIT) provide version ordering and bounded ZIP
primitives for release staging. Do not add a parallel provider loop, terminal parser,
configuration database or unsigned automatic script executor.

transcribe.cpp 0.4.2 is MIT, with ggml, miniz and Silero VAD notices kept in its
archive; it adds no npm dependency. NeMo-Speech.cpp 0.2.0 remains Apache-2.0. The optional pinned Nemotron model is
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
