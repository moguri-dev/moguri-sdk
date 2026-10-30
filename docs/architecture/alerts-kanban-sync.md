# Dismissible alerts and stable Kanban observation

## Change contract

Reuse React, the existing icon/theme/keyboard controls, TypeBox, Node, the
service/SDK queue and GitHub read adapters under their existing MIT/component
notices; SQLite remains public domain. No dependency, durable event, public
command/query shape, schema migration or protocol change is required.

Desktop notifications use one dismissible alert component with an accessible
native X button. Error/warning messages remain distinguishable from polite
informational outcomes. A successful card move is information, never a red
error. Dismissal is view-local presentation only: it does not clear a service
failure, acknowledge uncertain effects, answer a question, approve work, discard
a draft or enable a blocked control. Necessary recovery controls remain
available outside a dismissed message. Changed/new messages reappear; ordinary
rerenders do not resurrect a dismissed message. Retained chat notices, review
forms and live loading/account labels are not disposable alerts.
Static safety explanations remain dismissible without becoming live status
announcements; dynamic warnings retain an explicit alert/status role.
The native TUI footer likewise distinguishes operation errors from information
and exposes `[x]`; Escape dismisses a footer notice only in ordinary composer
focus. Neither dismissal consumes text or touches a pending answer/approval.

Kanban's persisted source identity remains exact: Local profile/project/
workspace, canonical root device/inode, numeric GitHub account/repository and
captured remote. Project presentation revisions and old policy counters are not
new owners. Each read-only observation must instead capture and recheck current
policy throughout its job. A real root/account/remote change or current denial
still blocks reads and publication. Existing source/card digests remain intact;
failed jobs are not rewritten as success, partial pages never publish, and no
GitHub mutation, credential fallback or automatic write replay is introduced.
SDK/TUI and desktop observe the same service-owned outcome.

Generated regressions must cover informational severity and X dismissal,
keyboard/focus behavior, changed-message reset, persistent conditions and draft/
approval preservation, successful sync after presentation/current-policy
updates, real changed-owner denial, concurrent changes, cancellation and restart.
Packed SDK and hidden desktop checks exercise the actual shared runtime.

## Phase 0

Before feature edits, `npm run spike` passed its six executable generated
foundation groups on macOS arm64 / Node 26.12.0:

| Fixture | Result | Measurement |
| --- | --- | --- |
| Copilot discovery/stream/cancel | PASS | Six intercepted requests; 1,076.25 ms; cancellation 32.22 ms. |
| SQLite WAL/crash/rebuild | PASS | 1,000 events; append p95 0.0514 ms; rebuild 0.525 ms; interrupted transaction rolled back. |
| Nested PTY cancellation | PASS | 151.89 ms; zero surviving owned fixture processes. |
| OpenTUI React streaming | PASS | 60 updates; 17.73 ms average. |
| Hidden Electron baseline | PASS | 10,000 rows; 183.23 ms cold start; 443.91 MiB; 8.21 ms scroll frame. |
| Node filesystem/Git baseline | PASS | 2,000 files / 2,047 entries; 1.18 ms search; 7.75 ms Git status. |

The raw log is `kanban-alerts-phase0.log` in the originating session. Generic
initial-checkpoint diagnostics still report FAIL for unavailable personal/live
provider/decision/SSH and quality evaluation, Rust/Linux supervision and signed
releases. Historical native/attachment/default/budget diagnostics do not
replace those capabilities' separate qualified receipts. No personal login,
microphone, paid inference or source checkout was used as a fixture.

## Implementation

The old `.notice` base style used error colors even when its live-region role
was informational. Information is now the default, with explicit error colors.
`Alert` supplies native X dismissal, severity, announcement and focus behavior
for every desktop banner; the AST-validated migration converted 223 message
sites in 67 existing files without reformatting unrelated code. Snapshot
updates do not reopen an unchanged dismissed message. Rich draft/settings/
approval recovery actions stay outside the dismissible body, and image errors
are outside attachment-preview buttons rather than nested interactive controls.
Retained chat text, live labels and actual review forms remain their own UI.

The stale sync error compared every field of a persisted `GithubSourceBinding`
against current project/settings counters. Read-only Kanban observation now
compares only exact owner/root identity at that lifetime boundary, while a
fresh per-job policy signature pins current permissions, allowed Env,
configuration values and credential epoch. Presentation-only project metadata
does not change that signature. It is rechecked after staged reads and before
publication; current denials and real source changes still fail before
replacement metadata is requested. The original source is reused, not
re-signed, so card `sourceDigest` values and historical failed jobs survive.
All non-observation reviews keep their prior strict revision behavior.

The packed SDK verifier also exercises this path in an independently installed
runtime with generated CLI/GraphQL responses and actual generated Git roots:
color/policy updates, source-preserving issue closure, foreign-account denial
and restart without rewriting source IDs or failed jobs.

## Qualification

The service/TUI/shared-alert implementation is `af299f7`; the static/live-region
and generated fixture corrections are `c81cdba`. The latter changes only
desktop presentation and tests, not observation authority or the SDK API.

| Executed check | Result |
| --- | --- |
| Complete serial Node/native-TUI suite | **2,013 passed**, **15 explicit physical-native skips**, **2,028 total**, zero failures; 28.34 min. |
| Complete hidden desktop suite after the semantic fixes | **295 passed**, **3 explicit package/native skips**, zero failures; 8.4 min. |
| Repeated exact alert/ownership regressions | **15/15 hidden cases pass**, three repetitions of each new case. |
| Final full build/types and corrected native paths | Pass; **2** semantic/architecture Node cases and **11** hidden alert/document/review/session cases rechecked after the final full build. |
| Fresh packed SDK | Imports/types, explicitly approved audited install and new installed Kanban observation/restart pass; the new probe uses **0 model calls / 0 GitHub writes**, taking 991.18 ms. All **12/12** installed-worker probes pass. |
| Root and independently installed dependency audits | **Zero vulnerabilities**. |
| Native payload continuity | Every package/lock/worker/bridge/MCP/data-worker digest matches the existing qualified protocol82 image. This slice does not relabel old physical receipts or claim a new guest/release qualification. |

Generated tests cover root/account/remote/folder/Env denial before replacement
metadata, revoked in-flight policy, cancellation, local-edit preservation,
restart, unchanged source/card digests, failed-job retention, neutral move
messages, keyboard/mouse X dismissal, new-message reset, recovery controls and
actual pending-approval ownership. No personal data, login, microphone, paid
inference or real repository mutation is used as a fixture.

Full-client qualification caught static safety text becoming an extra live
status and old tests choosing an informational X instead of the actual error.
Static explanations now retain no live role unless explicitly dynamic, and
tests select the intended error. A native trace also proved document assertions
finished before shutdown raced the renderer's saved-draft acknowledgement.
The fixture now waits for that real acknowledgement; no guard or timeout was
weakened.

Final raw evidence is retained in this session's `kanban-alerts-full-unit.log`,
`kanban-alerts-qualified-desktop.log`, `kanban-alerts-repeat-desktop.log`,
`kanban-alerts-packed-sdk.log`, `kanban-alerts-final-build.log` and
`kanban-alerts-final-desktop.log`. Existing FFI/chunk-size/deprecation notices
remain visible. The unchanged main-only CI policy still does not run on this
working branch; the previously observed main account-eligibility refusal
requires GitHub Billing & plans action, not disabled validation.
