# Compact composer and model controls

This user-requested slice preserves the dark Operate interface and one shared
SDK/service authority. It replaces redundant composer rows with labeled icon
controls and progressive disclosure, not new client-only execution behavior.

## Provider and model availability

Provider/model availability belongs to the actual profile, not client-only
picker state. Providers can be disabled without signing out, deleting secrets
or changing existing sessions. Local/SSH endpoint configuration remains exact;
the provider-list action changes its existing enabled flag and the shared
availability preference atomically. Copilot availability is independent of
its retained login. Enabling may refresh configured metadata, never authorize
an account, scan a host, download weights or start inference.

Model rows are grouped only by the exact upstream `apiModelId` (or its original
concrete ID), not fuzzy display names, prices, vendor/family claims or inferred
lineage. This is a declared catalog key, not proof of actual model identity,
training independence or quality. Each group has one enabled preference and
at most one selected concrete provider offering. Multiple offerings require
an explicit source choice. A retained choice never silently switches when
that provider becomes disabled, disappears or becomes unavailable. A sole
offering without a saved choice is the default; adding a collision requires a
choice before either source is selectable. Preparation rechecks the exact
advertised API ID as well as availability after asynchronous credential work.
The ordinary boundary rechecks that exact metadata again after asynchronous
repository attribution, immediately before reservation and `model.started`.
An upstream API literally named `kupo` remains distinct from the synthetic
`kupo` selection.

The selectable catalog contains only enabled, available, selected offerings.
The management inventory still exposes disabled/configured entries and clear
reasons. Desktop, TUI, CLI, `/model`, defaults, Kupo and owned-model admission
share the service registry; hiding a row alone is insufficient. New selection
and new model admissions reject disabled or unselected IDs, including prepared
calls held before admission. Already admitted work retains its actual result,
charges and cancellation outcome; configuration never refunds an unknown hold
or replays a call. Existing session/default IDs remain visible as unavailable
instead of being cleared or rebound to another provider.

Reuse TypeBox/React/Electron and maintained pi-ai under their existing
MIT/component notices; no dependency or provider-evidence call is added.
Browser-safe SDK capabilities manage typed revision-bound availability actions.
Protocol 70 adds profile-owned model preferences through existing
`settings.updated` persistence plus a strict migration marker. No old encrypted
history, receipts, grants, model provenance or accounting is rewritten. Restart
must preserve disabled IDs and exact source choice, and old matching services
must not be reused for the new selection contract.

Generated tests must prove a 21-model catalog can expose only three selected
models, disabled IDs fail through both shared slash and raw commands, exact
duplicate source exclusivity, provider re-enable without credential loss,
scope isolation, concurrent edits, disable during preparation, no automatic
fallback, migration failure/reopen and real restart without paid replay.
Settings use the existing switches, exclusive source dropdowns and explicit
help rows; ordinary model controls display only the authoritative selected set.

Before feature edits the generated prerequisite passes OAuth/streaming in
1,077.40 ms (32.18 ms cancellation), SQLite in 66.09 ms (append p95 0.065 ms),
PTY in 159.20 ms (151.32 ms cancellation, zero survivors), OpenTUI in
1,026.71 ms, hidden Electron in 565.67 ms (8.12 ms frames) and filesystem/Git
in 93.69 ms. The generated configured-provider/startup probe also passes.
Physical SendBox/SSH, live-provider, Rust/Linux, family/quality, notarization
and full-milestone exclusions remain explicitly unchanged.

### Availability qualification

The application source is `b350dd5`. Eighteen focused availability,
compiled-CLI/shared-TUI and migration cases pass in 2,963.63 ms. Generated
checks reduce 21 models to three, reject disabled slash/raw/new-session
selections, retain exactly one source across provider disable/removal/restart,
preserve credentials and profile isolation, and reject concurrent revisions.
Unqualified SSH inventory makes no discovery or secret read. An actual
upstream ID named `kupo` does not become the synthetic router.

Held preparation, already-prepared results and final repository attribution
are tested before the atomic reservation/start. A lost or mismatched source
dispatches zero requests and retains no invented model charge. Disabling
after admission instead retains the actual 42-token completion. The
69-to-70 migration recovers from interrupted insertion with identical
encrypted rows and receipts; missing, corrupt and prematurely retained
markers fail without repair.

| Surface | Observed result |
| --- | --- |
| Strict types and production build | Pass |
| Complete source/service/worker/recovery/CLI/native-TUI run | 1,705 passed, 14 existing skips and three stale fixture expectations; 1,722 cases in 1,458,435.93 ms |
| Final fixture-only source requalification | All 39 affected Kanban/SSH/search/availability/client/migration cases pass in 27,666.31 ms, including all three previous failures; application source and bundles remain unchanged |
| Complete hidden desktop suite | 236 passed, three existing skips; 239 flows in 8.0 minutes |
| Actual packaged-app critical flows | 35 passed in 1.3 minutes |
| Native help geometry | 34 sections, 200 renderings at widths 1,280/860; maximum offset one CSS pixel against the strict two-pixel bound |
| Independently installed packed SDK | All entrypoints/declarations and the actual protocol-70 21-to-3, source-exclusivity and disabled-slash probes pass |
| Actual installed-worker continuation/accounting probes | 12 passed |
| Source, independent-consumer and native-workload audits | Zero vulnerabilities |
| No-cache Linux arm64 worker payload/native PTY | Pass in 52,231.74 ms with exact protocol-70 inputs |
| Production ZIP/manifest consumer | Pass; 779,846,671 bytes in 121,369.00 ms |
| Canonical and labelled DMG | Exact signed bundle, Finder layout/resources, byte equality and disk-image checks pass |

Earlier failing runs are not passing evidence: asynchronous controlled
switches now show the pending intent without resetting the click, and errors
restore the actual saved state. Multi-role fixtures declare distinct
generated API IDs where they really simulate different models; an intentional
same-model loopback offering uses the actual explicit source choice. No
duplicate guard, revision check, timeout or ownership boundary was weakened.
The missing prepared-API and post-attribution checks were reproduced before
their fixes.

The complete source run is not described as a fresh zero-failure run. Its
three obsolete expectations were the separate Kanban solver reusing the
router's API ID, a Remote test expecting two simultaneous sources, and the
search list omitting the new provider destination. Only those generated
fixtures/expectations changed afterwards. The final rerun exercises every
case in all three affected files plus the full new availability suite.
The Remote regression still proves its environment rejection before the
explicit source switch; no assertion or source-exclusivity check was relaxed.

The labelled development installer is
`release/Moguri-0.30.0-alpha.1-model-availability-70-macos-arm64.dmg`
(794,057,880 bytes), SHA-512
`3096360a5d00726e93f9ec065c90235e2977cb9e185f7c49b3cd3337774a47c9fdbea052cf5aca4b8d5612570d5d390af03d764c1c3399d628baf70dad74cf32`.
Its bundled worker is
`docker.io/library/moguri-worker@sha256:6b95e0eeef1d89bfb0b0912087703f07c2b56b94d096afd3008d4f3137d32874`.
This is ad-hoc-signed development output, not a notarized or uploaded release.
No installed personal app, Finder, login, OS keychain, microphone or paid
provider was used. Existing experimental OpenTUI FFI, lazy Ghostty chunk,
optional `.icon` and transitive encoding/DOMException notices remain
non-blocking; audits report no vulnerability. CI stays main-push-only, and
empty working-branch checks are not a CI-pass claim.

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

### Tuning shortcut qualification

The final stable application source is `32d227d`. All three built-in names
appear before skills in shared discovery/help and use the existing typed,
revision-bound settings path. Generated checks cover exact 24,577-token
requests, the floored half of 32,769, the 8,192 minimum, actual declared
endpoints, unsupported half rejection, retained sibling options and
effort-only remembered selection. Invalid, stale and active-turn requests
preserve the original controls; model-free configuration and real service
restart do not add inference. The metadata-only 68-to-69 upgrade also passes
failure/reopen with identical encrypted rows and receipts.

| Surface | Observed result |
| --- | --- |
| Strict types and production build | Pass |
| Focused shortcut/options/defaults/upgrade checks | 42 passed in 7,508.80 ms |
| Native composer/default controls | 10 passed in 14.4 seconds |
| Actual native TUI shortcut input | Pass without inference |
| Complete source/service/worker/recovery/CLI/native-TUI suite | 1,690 passed, 14 existing skips, zero failures; 1,704 cases in 1,457,307.79 ms |
| Complete hidden desktop suite | 232 passed, three existing skips, zero failures; 235 flows in 8.0 minutes |
| Actual packaged-app critical flows | 38 passed in 1.7 minutes |
| Independently installed packed SDK | All entrypoints/declarations and the protocol-69 exact/min/half/max/effort probe pass without another model call |
| Actual installed-worker continuation/accounting probes | 12 passed |
| Source, independent-consumer and native-workload audits | Zero vulnerabilities |
| No-cache Linux arm64 worker payload/native PTY | Pass in 54,149.06 ms with exact protocol-69 inputs |
| Production ZIP/manifest consumer | Pass; 779,823,329 bytes in 114,636.36 ms |
| Canonical and labelled DMG | Exact signed bundle, Finder layout/resources, byte equality and disk-image checks pass |

Earlier red runs are not passing evidence. The tiny-model fixture needed its
actual output bound reduced to 128 tokens before it could legitimately select
Kupo; its former full-window output declaration correctly failed availability.
No application gate, deadline, confirmation or history-retention check was
weakened to make it pass.

The verified worker identity is
`docker.io/library/moguri-worker@sha256:6c253fd7d1e8af016c43155998a915501dc9145170e97cfadf5579e583c4df61`.
The current labelled local development installer is:

```text
release/Moguri-0.30.0-alpha.1-model-shortcuts-69-macos-arm64.dmg
794080040 bytes
SHA-512:
0576433b85957db9ef9cccf5be2ae0ee27a998acc30c3255a9751844272115156b8c9338cf3f94b60249b1d5a32a78e3ce0f55bdfc69a6082c8070e506d87782
```

The installer is ad-hoc-signed development output, not a notarized or uploaded
release. No installed personal app, Finder, real microphone, personal login
or paid inference was used. Experimental OpenTUI FFI, lazy Ghostty chunk,
optional `.icon` and transitive deprecation notices remain non-blocking.
Physical SendBox, external Linux, live-provider, quality and full-milestone
exclusions remain unchanged. CI remains main-push-only, not a passing PR check.

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
