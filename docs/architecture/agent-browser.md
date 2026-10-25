# Session browser control

Agent control uses the existing session Browser pane, not a separate browser
or a personal system browser. The switch at the top allows disabling and
re-enabling control at any time.

## Implementation contract

- Reuse Electron's existing isolated `WebContentsView` and its maintained
  Chromium debugger/accessibility/input APIs. Electron and React are MIT;
  the existing MCP SDK supplies the builtin discovery and approval path.
  No browser download, personal browser, remote-debugging port or new
  automation dependency is required. Stainless remains a separate future
  integration: its repository currently has no executable browser.
- The control plane owns an ephemeral, exact-profile/session Local browser
  lease. Native host credentials never enter model discovery, the event
  stream or command receipts. A fresh enable creates a new control identity;
  previous control approvals cannot survive off/on, replacement, profile
  switching, closing or restart. Element references also expire on navigation
  or an input action and are never resolved by guessed text/coordinates.
- Control defaults off. Enabling permits browser use, not self-approval.
  Existing exact nested-tool approvals, read-only/side restrictions, folder
  policy and allowed-Env policy remain authoritative. Sandbox and Remote
  cannot silently control a Local browser.
- Builtin MCP tools provide status, navigation, bounded accessibility
  snapshots and exact-node interaction. Page content is untrusted data, never
  instructions, permission or a user answer. No arbitrary model JavaScript,
  credentials API, upload, download, popup, microphone or filesystem bridge.
  Agent-triggered JavaScript dialogs are dismissed, never accepted. Snapshots
  expose accessible names/roles, not password values or a DOM-to-host bridge.
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
  Browser leases/control stay ephemeral. Actual tool arguments/results keep
  their existing encrypted session/job ownership.

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
