# Compact composer and model controls

This user-requested slice preserves the dark Operate interface and one shared
SDK/service authority. It replaces redundant composer rows with labeled icon
controls and progressive disclosure, not new client-only execution behavior.

## Direct tuning slash commands

`/thinking LEVEL` and `/effort LEVEL` share the existing explicit model-option
command. `default` removes only the effort override. Both preserve the working
window and other controls, use actual transport-supported levels and retain
the existing actual-user model/effort preference. `/context-window` accepts an
exact integer token count or `min`, `half`, `max`, preserving effort without
changing that model-selection preference.

For models without declared discrete windows, exact working ceilings range
from the existing 8,192-token minimum to the model maximum. The maximum/half
menu entries remain presets, not a claim that intermediate local admission
ceilings are unsupported by the transport. `half` floors half the supported
maximum; it never clamps a smaller result up to the minimum. Provider-declared
sets remain authoritative: min/max select their actual endpoints, and exact
or half quantities outside that set fail explicitly. The desktop displays a
valid exact selected ceiling without marking it stale or dropping it from the
menu. Kupo does not acquire fixed-role overrides.

Reuse TypeBox/React/Electron and the maintained pi-ai estimator/clamp under
their existing MIT/component notices; no dependency or provider call is added.
The browser-safe protocol helper, SDK, CLI/TUI and desktop share one acceptance
rule. Existing `session.configured` and `model.selection_remembered` events
provide persistence; no new durable field or event format is needed.
Protocol 69 performs a metadata-only upgrade so a healthy older service cannot
silently retain the old preset-only validation. Ciphertext, grants, receipts,
budgets, source identities and existing controls remain unchanged.

Malformed input, missing/fixed-model selection, unsupported declared windows,
concurrent revisions and active-turn changes fail without substituting values
or starting inference. An overfull next request still stops with all history
retained; no context truncation, automatic compaction, paid retry or budget
increase is introduced. Tests must cover exact transmitted/retained windows,
all shortcuts, sibling-option preservation, discrete-provider restrictions,
cross-client display, failure and actual restart/upgrade without replay.

The generated prerequisite passes OAuth/streaming in 1,088.14 ms (31.73 ms
cancellation), SQLite in 69.55 ms (append p95 0.063 ms), PTY in 159.68 ms
(151.98 ms cancellation, zero survivors), OpenTUI in 1,044.19 ms, hidden
Electron in 575.47 ms (8.32 ms frames), and filesystem/Git in 89.21 ms.
The maintained supported/ignored effort transport probe passes in 81.89 ms.
Physical/live-provider, Rust/Linux, SendBox, quality, notarization and
full-milestone exclusions remain unchanged.

## Cascading menus and complete slash discovery

The owner supplies reference screenshots for a compact Model/Effort/Context
window menu and side submenus. Reuse React/Electron/native popovers (MIT),
existing icons/tooltips, pi-ai option/size primitives (MIT), browser-safe SDK
and Node/component notices. No new dependency or metadata/inference call is
introduced by model selection. Kupo stays an ordinary synthetic model choice;
an unavailable entry has a separate focusable explanation tooltip. Only actual
qualified working windows/efforts are selectable, pending saves and failures
remain owned by the composer, and private model evidence reads stay explicit.

Slash discovery is scrollable and complete: built-in commands first, followed
by explicitly enabled installed/configured skills in the current profile/
session. Source discovery stays off unless configured; fresh gateway pages
bind one exact catalog digest. Selecting a skill loads its reviewed digest as
untrusted user-selected guidance, not a permission or an automatic paid turn.
Source errors remain visible while built-ins remain usable.

Protocol 68 adds atomic `/side PROMPT` admission and fresh gateway-skill loading
through existing command/event paths. A side send binds the original parent
and exact source draft revision when consumed, preserves an existing side
draft, creates/reuses only its original read-only side and atomically enqueues
the exact prompt/source grants before opening that panel. Failure, cancellation,
restart and lost receipts never infer a send, model success or a second call.
Normal parent/side model, Env, permission, context and budget gates remain final.
The schema upgrade preserves encrypted history, grants, receipts and accounting;
new side queue items retain exact command-origin digests so missing receipts
cannot replay an admitted question. No old state is rewritten or deleted.

Before feature edits the generated macOS arm64/Node 26 baseline passes
OAuth/streaming in 1,083.68 ms (30.76 ms cancellation), SQLite in 63.95 ms
(append p95 0.057 ms), PTY in 159.27 ms (152.12 ms cancellation, zero survivors),
OpenTUI in 1,038.00 ms, hidden Electron in 558.50 ms (8.28 ms scroll frames),
and filesystem/Git in 90.86 ms. Physical/live-provider, Rust/Linux, SendBox,
quality, signed/notarized release and full-milestone gates remain explicitly
FAIL/unavailable. Generated source and native tests must cover actual selection,
keyboard/submenu bounds, unavailable tooltips, save failure, full slash ordering,
source drift, atomic side routing, draft isolation and restart without replay.

The [protocol-68 qualification](chat-activity.md#protocol-68-composer-and-compact-control-qualification)
records the final complete source/desktop runs, actual packaged menus and
slash/side flows, independent SDK install, exact installer identity and
unchanged physical/live-provider exclusions.

## Reuse and Phase 0

Reuse React/native popovers, existing SVG icons and the maintained pi-ai
`getSupportedThinkingLevels`, context estimator and output/context clamp. The
provider library remains MIT; no new runtime dependency or tokenizer is added.
`node scripts/model-controls-spike.mjs` must verify the real maintained adapter
against a generated loopback endpoint before the controls are wired. No personal
authorization, provider call, microphone or image download is needed.

The generated loopback probe passed with a 16,384-token working window and
8,192-token output ceiling. Actual OpenAI Responses and Anthropic payloads
forwarded low effort. A first attempt with a reasoning-capable Copilot Gemini
model failed the forwarding assertion: its compatibility metadata explicitly
disables controllable effort. Those models must expose provider-controlled
thinking, not a silently ignored choice. The corrected probe validates this
negative case alongside both supported transports, in about 51 ms.

Context size is a configurable working window up to the selected model's fixed
maximum, not a claim that the provider's maximum changes. Input sizing is a
clearly labeled estimate, not exact tokenization. Reserve the library's context
headroom and reject an overfull request without silently truncating history,
compacting, selecting another model or adding a paid call.

Request sizing never falls below a fresh maintained per-message estimate of the
current normalized prompt/tools/history, even when a retained usage report is
eligible as an anchor. Output is capped against the same estimate and headroom.
This preserves finite-budget/context admission with stable source timestamps;
it does not change actual usage, prices or billed-cost provenance.

## New-session model defaults

Reuse React, TypeBox, the existing SDK, model-option qualification and append-only
encrypted store (MIT components); no dependency or provider transport is added.
The global settings picker writes the existing shared-global control defaults.
A fixed global model/effort applies to new sessions subject to the established
profile, project and explicit session overrides. Existing sessions are never
rewritten by saving a default.

With no explicit model default, new independent sessions use the last model
and thinking effort the user explicitly selected in the actual current profile.
The user chose selection, not last inference or last sent prompt. Navigating,
running a model/role, inheriting startup/parent controls, changing unrelated
settings and failed selections cannot update this preference. An explicit
no-model override remains no-model. Working-window settings are not copied
from the remembered session; explicit higher-priority model settings remain
authoritative.

Protocol/database 55 adds a profile-owned model-selection preference and strict
`model_defaults_schema` migration marker. A root-scoped
`model.selection_remembered` event is committed atomically with the successful
selection, outside session/project retention. It retains only the model/effort
pair, actual-user/source identity and event provenance, never conversation,
credentials, permissions or a model decision. Source-session deletion/restart
cannot erase the preference or authorize another model call. Legacy state starts
without an invented remembered choice; existing fixed defaults, ciphertext,
keys, receipts and independent artifacts remain unchanged.

The SDK, CLI/TUI selectors and desktop share explicit selection intent. Default
resolution stays service-owned across Start, project-free/project/worktree/work
entrypoints and unparented settings chats. Existing explicit parent/session
inheritance and policy still win. An unavailable saved model/effort remains
visible and blocked at the existing admission checks; no provider, environment
or option is silently substituted and no discovery/inference is added.

Fresh prerequisite probes pass all six generated groups: cancellation
31.95 ms; SQLite append p95 0.044 ms/rebuild 0.521 ms; owned PTY cancellation
152.79 ms with zero survivors; TUI updates 17.52 ms; hidden Electron cold start
174.90 ms / 442.36 MiB / 8.22 ms per frame; 2,000-file search/Git
0.882/5.860 ms. Separate live/native/notarized/Linux/quality gates remain
FAIL/unqualified, not enabled by these preferences.

### Model-default qualification

Source `d23432a` and `7d5fb04` provide the shared-global picker and independently
retained explicit-selection fallback. The before-fix generated resolver/service
cases return no model after a real selection; three fail and the explicit
no-model override already passes. The final cases cover fixed/last-selected/
none, effort versus window-only changes, same-value selection, source-session/
project deletion, actual restart, profile isolation, work-item/worktree/settings
creation, explicit parent inheritance, unavailable models and atomic failures.
Resetting tuning without a selected model cannot erase a remembered choice;
only an explicit model clear does so.

Migration 54-to-55 interruption retains the old version and exact ciphertext,
keys, receipts and controls. Current missing/corrupt markers and forged
user/source/turn/artifact owners fail explicitly. Programmatic old routing
fixture setup opts out of remembered selection rather than relabel future
preference events as legacy history. Refused-settings UI cleanup returns through
the real saved navigation guard, not a sleep or forced unload.

| Exact check | Observed result |
| --- | --- |
| Type checks/build/root, external-install and worker-image audits | PASS; zero vulnerabilities |
| Fresh maintained model-transport/context probe | PASS; Responses/Anthropic low effort and provider-controlled Completions / 115.58 ms |
| Final selection/retention/migration/older-workflow checks | 21 passed / 1,586.82 ms |
| Default-model UI paths | 4 passed / 7.7 seconds; refused-save case repeated ten times: 10 passed / 18.4 seconds |
| Complete final Node/worker/recovery/CLI/native-TUI suite | 1,315 passed, 14 physical-native skips, zero failures; 1,329 total / 1,109,292.21 ms |
| Complete final hidden Electron suite | 157 passed, 2 physical-native skips, zero failures; 159 total / 5.1 minutes |
| Actual packed external SDK/install | All entrypoints/flows and 12 installed-worker probes pass |
| Actual installed protocol-55 model-default probe | SDK/CLI/shared-TUI selection, fixed-global precedence, no-model reset, source deletion/restart: PASS / 525.40 ms / zero model calls |
| No-cache Linux arm64 payload/native PTY | PASS; exact protocol-55 input digests and locked install / 37,018.02 ms |
| Actual newly packaged hidden app | Defaults/composer/settings/profiles/Start cases: 17 passed / 28.7 seconds |
| Actual bundle/native distribution | PASS; protocol 55 / SendBox 0.2.4 |
| Production ZIP/manifest consumer | PASS; 740,582,167-byte archive / 107,679.96 ms |
| Native DMG | PASS; exact Finder geometry/resources and unchanged signed app |

The final bundled workload is
`docker.io/library/moguri-worker@sha256:7f4d9f522b6b8ebea0c54e3b21232e0a6505747e3baa7b6e6ae175408db14589`.
The rebuilt DMG is 754,196,028 bytes, SHA-256
`4b792e2ac20fe01b150cd1a1cbf0addfc58b0ccb03331ae71737230609c03cd2`.
Older image/installer identities remain historical. This is fresh protocol-55
evidence, not a relabeled earlier Node run. No personal account, model weights,
microphone, conversation, administrator installation or paid inference was used;
Electron and loopback fixtures are hidden/generated. Only owned verification
mounts were detached, never an earlier user-opened image. Ad-hoc signing,
FFI/chunk/optional-icon notices, downstream SDK-host compatibility overrides and
physical-native/notarization/Linux release limits remain unchanged.

## Per-response output and reasoning

Ordinary requests use the prepared model's declared output maximum, bounded by
the selected working window, fresh normalized input estimate and existing
4,096-token context headroom. There is no additional fixed 8,192-token ceiling.
That former application cap could exhaust reasoning capacity before a small
README operation produced its next complete tool call. The maintained provider
adapter receives the resulting bound, including explicit supported effort,
without adding another thinking allowance outside it.

Budget admission can reduce this bound further to the exact remaining token/USD
capacity under all applicable session, profile and global policies. Larger model
capacity never changes those policies, prices or unknown holds. Explicit
router, compactor, candidate, owned-role and wind-down bounds still apply.
Existing ledger entries retain the limit actually forwarded at their original
admission; no historical output limits or charges are rewritten. No schema,
dependency, permission, model substitution or automatic retry is introduced.

A genuine provider length stop remains partial. Its diagnostic reports the
actual forwarded response limit, explains shared reasoning capacity when
applicable and states that pending tools from that incomplete response did not
run. Earlier acknowledged effects are not undone or described as absent.
Inspection/resume cannot replay that model response or execute its pending
arguments; only a new explicit authorized turn can continue.

The 2026-10-24 generated transport prerequisite passes Responses, Anthropic and
provider-controlled Completions option probes in 249.73 ms without inference.
Regression coverage exercises actual 32,768-token payload bounds, supported
high reasoning without exceeding them, an approved existing README edit with
9,500 reported output tokens, exact 64-token finite admission and a genuinely
truncated tool request that cannot write or replay. Provider output usage remains
separate from visible response length and unknown/billed costs.

### Output-capacity source qualification

Committed source `6df9e8a` passes the complete generated qualification. Source
and compiled Node/renderer inputs remain unchanged throughout the final suites:

| Check | Observed result |
| --- | --- |
| Full unit/worker/recovery/CLI/native-TUI suite | 1,266 passed, 14 physical-native skips, zero failures; 1,280 total / 1,391.05 s |
| Full hidden Electron suite | 121 passed, 2 physical-native skips, zero failures; 123 total / 4.6 min |
| Packed external SDK and actual installed-worker probes | All entrypoints/client paths pass; 12 worker probes pass |
| Actual rebuilt packaged limit/rename/browser-audio UI | 3 hidden cases pass in 4.2 s |
| Type checks, production build and dependency audits | PASS; zero vulnerabilities |
| No-cache Linux arm64 worker payload and synthetic PTY | PASS in 45.16 s; exact new worker digest retained |
| Actual macOS bundle/native-distribution/update ZIP and DMG | PASS; 740,345,780-byte archive verified through the production update consumer in 112.87 s |

The immutable local workload identity is
`docker.io/library/moguri-worker@sha256:83d2f7f4dc2bdc092854792cd52be8284470abdc28fb33c9ffa4eead26a13724`.
It qualifies producer bytes and packaging, not physical SendBox containment,
Linux release readiness or live provider behavior. The 14 unit and 2 desktop
physical skips remain explicitly gated. No personal session/account, microphone,
speech model weights or paid inference was used. The app is ad-hoc signed, not
notarized; known external-host npm override and non-blocking chunk/icon notices
remain documented in the setup qualification.

## Domain and persistence

Issue #17 replaces arbitrary numeric windows with one browser-safe SDK contract:
use the exact model maximum and its integer-floored half, excluding choices below
the 8,192-token working minimum. A genuine provider-declared window list replaces
those derived choices. Explicit unsupported/stale values are errors, never
clamped, and retained history and settings remain unchanged. The service rechecks
the actual prepared model before each request; both clients consume the same
choices. Existing pi-ai (MIT), React (MIT), TypeBox (MIT), estimates and event
authority are reused without a new dependency. No new model role or paid call is
introduced. Migration/restart coverage must preserve legacy arbitrary settings
and refuse their use until explicitly corrected, rather than rewriting events.
Pool eligibility/classifier metadata, candidate-generation previews and complete
future owned-role bounds use the same actual default working window, not an
unselectable theoretical maximum. Pool admission includes request headroom;
none of these calculations authorizes a public compound workflow or a paid call.

The issue's fresh Phase 0 run on macOS arm64 measured generated provider
cancellation at 31.04 ms, SQLite append p95 at 0.053 ms, crash projection rebuild
at 0.54 ms, known PTY-group cancellation at 151.84 ms, OpenTUI updates at
17.23 ms, hidden Electron cold start at 195.44 ms and aggregate memory at
449.52 MiB. The actual model-control, compound-transport, decision and budget-plan
primitives passed again. These generated results do not qualify live model
quality, complete detached-process containment, System One/Max, or Sandbox.
Installed SendBox reports 0.2.1; released 0.2.3 needs separate attested-artifact
and native worker/network/loss qualification. Historical static unavailable
labels in the original spike are not current runtime discovery.

Protocol/database migration 5 adds optional typed session model options and
advertised supported thinking levels. Legacy controls retain their defaults and
all schema-1/2/3/4 data, encrypted grants and immutable event identities survive.
No user state deletion is an upgrade path.

Thinking options come from the actual model capability list. Unsupported values
are rejected rather than silently clamped. Each step records its effective
window, selected effort and estimated context alongside the existing actual/
unknown usage provenance. Budget/token/cost readouts must not turn unknown
telemetry into zero; estimated/provider-reported/billed amounts stay distinct.
The SDK exposes settings identically to CLI/TUI and desktop.

## Client behavior

Attach is a plus at the left, followed by environment, model name and autonomy.
The trailing group is budget/usage, microphone and paper-plane Send. Holding
Cmd/Ctrl changes the send affordance to a clock and holds the prompt without
starting work. Existing explicit Steer/Interrupt delivery remains available.
Popover dismissal, keyboard focus, disabled states and native browser occlusion
must work at compact widths and with long model names.

Environment icons are house/box/globe; autonomy is hand/traffic light/car/rocket.
Unqualified Sandbox and Autopilot Max remain visibly unavailable. Core Remote
now requires its separately qualified pinned SSH transport; missing readiness
never maps to Local.
Model window and thinking options live in the same model menu. Budget starts
unlimited and uses infinity; its popover exposes input/output/cache/context and
available monetary telemetry. Fixed models support explicitly estimate-based
limits through the shared all-role ledger, not exact provider billing.

[Experimental kupo Single](routing.md) is opt-in and labeled as Moguri's
synthetic model, not GitHub Copilot. Its pool, classifier, hosted-data consent,
threshold and availability live in shared settings. Model-specific tuning and
finite session limits stay disabled for Single until those paths are qualified;
hard profile/global caps still block it. Explicit `/model ID` and picker
selection clear prior per-model overrides. Both clients expose actual metered
roles/models and model-supplied plan provenance without promoting classifier
text into solver instructions.

Model-setting mutation ownership is request-scoped, not tied to a popover's
mount lifetime. Closing/reopening the menu cannot release an in-flight gate or
run a preserved command under stale settings. The composer tracks actual
pending requests and retains refusal diagnostics outside the closed menu.
Working-window and thinking-effort dropdowns save on selection through those
same revision-bound requests, without a second Save step or a model call.
Controlled hidden workflows hold the real service mutation, dismiss the menu,
verify disabled submission/preserved drafts, then exercise both successful
settlement and explicit refusal. Keyboard tests wait for actual enabled
controls, not a completed click that merely started an asynchronous request.

**Review context and compactions** opens the shared SDK's explicit text-history
workflow. Preview, metered generation, proposal review/apply and restoring the
retained originals are separate actions. It never silently truncates history,
chooses a kupo compactor, changes the model selection or grants tool authority.
See [reviewed compaction](context-compaction.md).

The original face/bat-wing mascot gains a small red antenna pom-pom. Visual
reference: <https://en.wikipedia.org/wiki/File:MoogleFFIXConcept.png>, linked by
the Moogle article. This is trait reference only: no image bytes, tracing,
third-party artwork or branding are embedded.

Generated tests cover supported/unsupported effort, context admission, migration/
restart, actual adapter options, Cmd keydown/keyup/blur, popover navigation,
usage provenance and compact layout. CI remains main-push-only.

## Alpha qualification

The `0.5.0-alpha.1` macOS arm64 checkpoint passes **88** generated unit/
integration/native-TUI checks and **six** hidden Electron workflows against
source and the packaged app. The composer workflow checks exact icon roles,
queue-only modifier behavior before model selection, context/effort persistence,
actual generated request parameters, safe Enter handling inside popovers,
unknown monetary telemetry and non-overlapping compact/long-model layouts.
Bounded visual inspection and confirmation, plus a static UI scan, are complete.

Clean locked installation, type/declaration checks, production builds and both
source/external-consumer audits pass without reported vulnerabilities. The
independently packed SDK exposes model options and local context preview without
Electron. The versioned app, DMG, ZIP and SDK tarball retain the original runtime
boundaries; ad-hoc signature, regenerated mascot icon, native PTY transport and
DMG checksum are verified. Development artifacts are not notarized.

No live inference, personal login/keychain/microphone or real model weights were
used. Nonfatal upstream dependency/FFI, initial file-package approval, optional
`.icon` fallback and lazy Ghostty chunk-size notices remain visible. No feature
CI is dispatched; the workflow still triggers only on pushes to `main`.
