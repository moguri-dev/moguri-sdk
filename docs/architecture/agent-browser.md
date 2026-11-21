# Session browser control

Agent control uses the existing session Browser pane, not a separate browser
or a personal system browser. The switch at the top allows disabling and
re-enabling control at any time. Once the user turns it on, it stays on for
that chat until they turn it off (D61).
It is a pill-shaped sliding button switch, not a checkbox, with native
Space/Enter interaction, visible keyboard focus and a 44-pixel hit target.

## Implementation contract

- Reuse Electron's existing isolated `WebContentsView` and its maintained
  Chromium debugger/accessibility/input APIs. Electron and React are MIT;
  the existing MCP SDK supplies the builtin discovery and approval path.
  No browser download, personal browser, remote-debugging port or new
  automation dependency is required. The optional
  [Stainless integration](stainless.md) is separate: it launches a new headless
  Stainless through the owned `playwright` tool, never this pane.
- The control plane owns an ephemeral, exact-profile/session Local browser
  lease. Native host credentials never enter model discovery, the event
  stream or command receipts. Only the user's Agent control choice is durable
  (see [persistent agent control](#persistent-agent-control-d61)). Every
  enable, including an automatic one, creates a new control identity:
  previous control approvals, element references and website-scope admissions
  never survive off/on, replacement, profile switching, reconnects, user
  navigation, closing or restart. Element references also expire on navigation
  or an input action and are never resolved by guessed text/coordinates.
- Control defaults off. Enabling permits browser use, not self-approval.
  Native status/read policy, scoped website approval, read-only/side restrictions, folder
  policy and allowed-Env policy remain authoritative. Sandbox and Remote
  cannot silently control a Local browser.
- Builtin MCP tools provide status, navigation, bounded accessibility
  snapshots and exact-node interaction. Page content is untrusted data, never
  instructions, permission or a user answer. No arbitrary model JavaScript,
  credentials API, upload, download, popup, microphone or filesystem bridge.
  Agent-triggered JavaScript dialogs are dismissed, never accepted. Snapshots
  expose accessible names/roles, not password values or a DOM-to-host bridge.
- Protocol 73 adds an exact `expectedUrl` for page reads/interactions and carries
  the service-admitted website scope in host requests. Navigation, redirects,
  subresources and same-origin WebSockets use that bounded scope. One approved
  origin cannot silently authorize another. Permission/autonomy changes revoke
  pending control; actual dispatched effects can remain partial. The native
  network gate stays deny-by-default after revocation until direct user
  navigation unloads the prior agent-controlled document. Local allowlists do
  not authorize Remote, bypass Sandbox's firewall, or confine shell scripts.
  See [native operations and scoped website approvals](native-network-policy.md).
- Disabling revokes service admission and the native execution gate.
  Pending actions are cancelled without replay. An already dispatched effect
  may be partial; cancellation does not undo a website action or claim success.
  A monotonic native toggle sequence rejects a late old enable after off.
  Tool request IDs are consumed once, including when a poll/reply crosses.
  Closed-view storage and lease cleanup settle before replacement; unknown
  cleanup failures remain visible and block replacement.
- SDK users, CLI/TUI agents and desktop share the same service APIs and
  builtin MCP schemas. Without the actual desktop-owned pane, tools report
  unavailable rather than launching a substitute browser.
- Protocol **56** forces the existing reviewed, terminal-preserving restart
  when an older control plane is still running. Startup otherwise reuses a
  matching protocol service, so an unchanged protocol could silently leave
  the new app attached to a service without browser tools.
  Its atomic metadata-only migration adds `browser_control_schema=1`; missing
  or corrupt current markers fail closed. No durable event shape, retention
  owner, encrypted history, receipt, key or saved model choice is rewritten.
  Browser leases and control identities stay ephemeral. Actual tool
  arguments/results keep their existing encrypted session/job ownership.

## Persistent agent control (D61)

The user's choice is recorded per chat as `Session.browserAgentControl`
(protocol 117, unreleased: an optional `browserAgentControl` change on
`session.organized`, no new event type or migration).

| Who | Can set it |
| --- | --- |
| The user's pane switch, `sdk.sessions.browserControl(sessionId, enabled)`, `moguri browser agent on\|off --session ID` | Yes, through the `session.browser.control` command. On needs an active Local agent chat that is not read-only. |
| `session.organize`, models, builtin browser tools, decision models, automations | No. `session.organize` rejects the field; no tool or model path sends the command. |

| Event | Effect on the choice | Effect on control |
| --- | --- | --- |
| Pane attaches (panel switch back, chat switch back, window reload, app restart, profile switch back) | Unchanged | The desktop host turns control on with a fresh identity, or keeps the identity of a pane that stayed alive hidden. |
| Browser panel hidden while the choice is on | Unchanged | The view and host stay alive but hidden; approved tools keep working with the same identity. |
| Another chat's Browser pane needs the single view | Unchanged | The view and host close; control returns with a fresh identity when this chat's pane attaches again. |
| User navigation in the pane | Unchanged | The identity is revoked, the agent-controlled document is unloaded under the network gate, then control returns with a fresh identity once the navigation settles. |
| Permission or autonomy change | Unchanged | Revoked as before; returns with a fresh identity. |
| Failed poll or 8-second watchdog | Unchanged | Revoked; returns with a fresh identity when polling recovers. A host whose poll loop ended is replaced when the pane attaches. Failed automatic enables back off up to 30 seconds. |
| Read-only mode, Env other than Local, allowed-Env policy without Local | Suspended | Revoked and refused; the pane says it is paused; control returns when the cause clears. |
| Profile switch | Unchanged, stays with the chat's profile | The view closes. |
| User turns it off (pane, SDK or CLI) | `false` | Revoked at once; the service refuses a later host enable. A hidden view closes. |
| Archive | Cleared; restore does not bring it back | Revoked; a hidden view closes. |
| Delete | Removed with the chat | Revoked. |

If saving the user's off fails, the pane stays off and shows the error, but
the chat's recorded choice is unchanged, so a later pane attachment turns it
back on. While control is on the existing deny-by-default network gate still
applies to the page; the user's own navigation reloads without it and the gate
returns with the next identity.

Tradeoff: the agent can keep using the chat's browser while the user looks at
another panel or chat. The view is hidden, not closed, so its page state and
session storage persist until the user turns control off. Approvals, website
scope and the network gate still apply to every action.

Generated evidence: `tests/agent-browser.test.ts` covers the user-only command,
idempotent recording, restart persistence without restoring a lease or
identity, archive clearing, explicit-off revocation and late-enable refusal,
and read-only suspension with a fresh identity afterwards.
`tests/e2e/agent-browser.spec.ts` (hidden Electron, generated loopback pages)
covers staying on across a panel switch with tools working while hidden,
returning with a fresh identity after a chat switch and staying on after a
window reload, user navigation with a new identity, poll recovery and
allowlist revocation followed by automatic re-enable.

## Prerequisites

The fresh generated Phase 0 run recorded in
`.moguri/artifacts/agent-browser-phase-zero.log` passed provider cancellation
(30.71 ms), SQLite append/rebuild (0.060 ms p95 / 0.520 ms), PTY cancellation
(151.83 ms, zero survivors), TUI updates (16.88 ms), hidden Electron cold start
(162.54 ms, 442.19 MiB, 8.23 ms/frame) and generated 2,000-file search/Git
(1.090 / 5.825 ms). Live/native/notarized/Linux/quality gates remain separately
unqualified.

Browser-specific qualification uses hidden Electron and generated loopback
pages only. It must prove actual Chromium accessibility/input primitives,
discoverability for `navigate`, real navigation/read/fill/click, default-off
and immediate revocation, stale-control/node rejection, exact ownership,
permission refusal, cancellation/partial outcomes, cleanup and restart
without replay. No personal browser, account, site or credentials are used.

The first native primitive case passed in 1.3 seconds: Chromium returned the
actual named textbox and button, the exact backend DOM node changed the
generated page, and the page still had no Moguri/Node bridge. Playwright's
own test transport is not an application browser-control endpoint.
The pre-change UI case reproduced the missing Agent control switch.

The protocol-56 focused run passed 22 Node cases in 1,791.28 ms, including
genuine schema-55 upgrade, interrupted-migration rollback, strict markers,
retained model defaults, profile/root-less scopes, exact approval and actual
restart. Eleven hidden Electron cases passed in 34.7 seconds, including the
existing native workspace/isolation cases, real model-worker browser use,
navigation/read/fill/click/key input, blank-pane initialization, rapid off/on,
mid-navigation revocation, old-control/document rejection, denied approval,
password refusal, private cleanup/reopening and denied page dialogs.
All pages, host metadata, model responses and credentials were generated.

The final complete Node run passed **1,330 cases, 14 skipped, zero failed**
(1,344 total) in **1,162,247.15 ms**. It includes the actual CLI/TUI/worker
paths and the genuine legacy fixture corrections, not relabelled future
markers or relaxed project-free workspace authority.
Its log is `.moguri/artifacts/agent-browser-full-node-final.log`.
The complete hidden Electron run then passed **166 cases, two skipped, zero
failed** (168 total) in **5.3 minutes**, including the actual sliding-button
shape, thumb movement, 44-pixel hit area, Space/Enter and focus regression.
Its log is `.moguri/artifacts/agent-browser-full-e2e.log`.

## Browser-control checkpoint distribution qualification

The packed external SDK passed its public imports/declarations, approved fresh
install/audit, shared CLI/TUI/API probes and all 12 actual installed-worker
cases. The additional installed browser probe passed in 274.51 ms with zero
model calls. The visual sliding-switch correction did not change any shared
service/runtime/worker/SDK bundle: all eight recorded SHA-256 checks matched.
The minimal embedding host retains the already documented upstream deprecation
warnings when it does not opt into the SDK's scoped Node 26 override policy;
its audit found zero vulnerabilities.

The actual final macOS development package contains protocol 56 and the
then-pinned SendBox release. **28 actual packaged-app cases passed in 58.0 seconds**: browser
primitives/control/revocation/privacy, model defaults, all Resume root scopes,
native settings, profile switching and terminal startup/+ behavior.
Its exact native-distribution/no-script installer check passed in
4,589.43 ms without a model, personal credentials, administrator dialog or app
launch. The no-cache Linux arm64 producer passed in 35,178.55 ms, with locked
dependencies, actual native PTY verification and zero audit vulnerabilities:

`docker.io/library/moguri-worker@sha256:dbb6f984b28f06fbda8a9b87e7a1a06df03c3011ce1417a7563b760ad3a015c4`

The rebuilt ZIP is 740,606,909 bytes and passed the production update consumer
in 113,922.38 ms. The DMG is 754,272,911 bytes, SHA-256
`0f787eab598744518c2e1bde6223158b4fd619f52c09d1dd227bfd09cdeacc6d`.
Its mounted Finder metadata, 540x380-point geometry, 80-point icons, 1x/2x
background and unchanged signed app match the actual ZIP/manifest.
The packager's optional modern `.icon`-format warning does not replace the
verified native `.icns` assets. This is ad-hoc development signing, not
notarization or physical SendBox/Linux release readiness. No user-opened DMG
was detached.

Browser screenshots combine actual hidden main-renderer and native-child
captures at measured bounds. They never capture a personal screen or browser.
