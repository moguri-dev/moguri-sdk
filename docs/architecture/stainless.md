# Stainless browser integration

Optional, off by default. Protocol and store schema **111**
(`stainless_integration_schema`). Tracks [#12](https://github.com/mbianchidev/moguri/issues/12);
the MCP follow-up is [#80](https://github.com/mbianchidev/moguri/issues/80), which
depends on [mbianchidev/stainless#22](https://github.com/mbianchidev/stainless/issues/22).

## Qualification of the Stainless contract (2026-11-17)

Before implementation, the Stainless repository (`main` at `22a2ef5`, plus open
PR mbianchidev/stainless#60) and the installed app were inspected:

| Interface #12 assumed | Finding |
| --- | --- |
| MCP server | None. The Stainless README lists agents as later work; its managed `agent-sandbox` mode is unavailable. |
| Automation API, CDP endpoint, WebDriver contract | None documented. Stainless's own smoke tests drive it with ChromeDriver, `--headless=new` and a synthetic `--user-data-dir`; no patch disables Chromium's automation switches. |
| Deep links / open-with | `stainless://` internal URLs exist only inside the browser and are not registered with macOS. The **built** app inherits Chromium's `CFBundleURLTypes` for `http`, `https` and `file`, so `open -a Stainless.app URL` works. |
| Version discovery | `Info.plist`: `CFBundleIdentifier=dev.stainless.browser`, `CFBundleExecutable=Stainless`, `CFBundleShortVersionString` (Chromium), plus `StainlessVersion`, `StainlessBuild`, `StainlessChannel`. |
| License | The Stainless repository has no license. Moguri does not bundle, copy or redistribute Stainless; it only launches the copy the user installed. |

By owner decision on #12, Moguri therefore owns the automation path itself
instead of waiting for Stainless to publish one. The policy-enforcing Stainless
MCP gateway (mbianchidev/stainless#22) replaces or complements it in #80.

The raw spike then launched the installed Stainless `0.1.0-preview.7` (build 7,
Chromium `158.0.8127.37`, ad-hoc signed) headless with a throwaway profile
through `playwright-core`'s `chromium.launch({ executablePath })`: launch
589 ms, generated loopback page load, click, screenshot and console/network
capture in 1.99 s total, no surviving process. The reusable
`npm run spike:stainless` (below) supersedes it.

## Contract

- **Off by default.** `settings.integrations.stainless = { enabled, appPath }`.
  Absent means off. `appPath` is an exact absolute `.app` bundle; when null the
  service checks `/Applications/Stainless.app`, then `~/Applications/Stainless.app`.
  A saved location is used exactly, with no fallback search.
- **Detection never launches the app.** The service reads `Contents/Info.plist`
  with `/usr/bin/plutil`, requires the Stainless bundle ID and executable name,
  and requires `Contents/MacOS/Stainless` to be a regular executable file (not a
  symlink). macOS only; other platforms report `supported: false`.
- **Tested builds and checks.** `STAINLESS_TESTED_BUILDS` lists the exact
  version/build/Chromium triples that passed `spike:stainless`. Any other build
  needs a passing **Check compatibility** before agents can use it. The check
  is a user action: it serves a generated page on `127.0.0.1`, launches one new
  headless Stainless through the same owned Playwright worker agents use, reads
  the page back and closes it. It calls no model. Concurrent checks share one
  launch. Results live in service memory, keyed by a digest of the resolved
  bundle path, declared versions and the executable's device/inode/size/mtime,
  so a replaced or updated executable needs a new check, and a restart forgets
  them (untested builds must be rechecked). A failed check marks that exact build
  `incompatible`.
- **Agent automation** uses the existing `playwright` tool with
  `launch: { kind: "stainless", url }`. The model never supplies a path: the
  controller resolves the executable only when automation is `ready`, and sends
  it with the per-call approval reply (beside `webAccess`). The worker launches
  a **new headless instance with a disposable profile** under the owned temporary
  directory, never the user's Stainless profiles, windows or cookies. Everything
  else is the unchanged owned-Playwright contract: Local only, unrestricted
  approved root, exact website scope (`toolWebTarget` covers the Stainless URL),
  normal tool approval, 25-second batch, at most four screenshots, no replay,
  failures reported as partial. If Stainless is off, missing, untested or
  incompatible at approval time, the batch fails before launching anything.
- **Diagnostics.** A new `diagnostics` action (for every Chromium-based launch,
  including Stainless) returns this batch's console messages and network
  responses/failures: at most 100 of each, 500 characters per text, with
  explicit `truncated` flags and omitted counts. Page data is untrusted.
- **Open in Stainless** (`stainless.open`) hands one HTTPS or loopback HTTP URL,
  without credentials, to the exact bundle with `/usr/bin/open -a`. It requires
  the integration to be on and a Local session. Remote and Sandbox sessions are
  refused because their preview is not on this Mac; no Local replacement is
  opened. Moguri does not own or observe that window. It sends nothing to a
  model and is not retried when macOS does not confirm the open.
- **Shared clients.** SDK: `sdk.stainless.status()`, `.check()`, `.open(sessionId, url)`,
  and `executeStainlessCommand` for `/stainless status|check|open [URL]` (TUI)
  and `moguri stainless status|check|open [URL] --session ID` (CLI). Desktop:
  **Settings > Stainless** (switch saves immediately; the app location is a
  written value with Save) and a status strip in the session Browser panel with
  **Open in Stainless** or a link to the settings page.

## Failure and cancellation

| Case | Behavior |
| --- | --- |
| Not installed, wrong bundle, symlinked/non-executable binary, unreadable plist | `missing`/`invalid` with the exact reason; nothing launched. |
| Integration off | Status `off`; check, open and agent batches refuse before any effect. |
| Untested build without a passing check | `needs_check`; agent batches refuse. |
| Check launch fails or the page is not read back | `incompatible` for that exact build, diagnostic shown and logged to stderr. |
| Executable replaced after a check | New identity, back to `needs_check`/tested state. |
| Batch cancelled, timed out or the browser dies | Existing owned-Playwright handling: process group stopped, outcome `partial`, no replay; profile retained only when cleanup is unconfirmed. |
| Service shutdown during a check | The check's worker is aborted; no result is recorded as passed. |
| macOS `open` fails | `stainless_open` error; nothing retried. |

## Schema and migration

Protocol 111 adds the `stainless.status` query, `stainless.check` and
`stainless.open` commands, the optional `integrations.stainless` setting, the
`stainless` launch kind and the `diagnostics` action. No new event type. The
migration only writes `stainless_integration_schema=1`; a missing or premature
marker fails closed, and saved `integrations.stainless` settings cannot become a
pre-111 lineage. `removeStainlessIntegrationFixtureMarker` extends the legacy
fixture chain. Check results are ephemeral by design.

## Evidence

`npm run spike:stainless` (headless, generated loopback page, never a window,
personal profile or model) against the installed `0.1.0-preview.7` on macOS
arm64, Node 26.12: **PASS**. Compatibility check 1,269 ms; one owned batch
(type, click, wait, snapshot, PNG screenshot, diagnostics) 1,202 ms; Stainless
reported Chromium `158.0.8127.37`; console log and warning plus the generated
404 were captured; zero surviving Stainless processes.

`tests/stainless.test.ts` (10 cases) uses generated `Stainless.app` bundles whose
executable runs Playwright's own Chromium: detection states, check/gating,
concurrent-check sharing, identity expiry on replacement, failing builds,
Open in Stainless refusals, a full model turn whose approved `playwright` batch
launches the configured Stainless and returns diagnostics (then refuses after
the integration is turned off), SDK/CLI helper parsing, settings validation and
the four schema migration cases. `tests/e2e/stainless.spec.ts` drives the hidden
desktop: Browser strip setup state, Settings switch/location/check, then
**Open in Stainless**.

## Not claimed

No Stainless MCP, CDP port, persistent agent profile, or control of the user's
own Stainless windows. Automation relies on Chromium behavior that Stainless
does not document as supported, so only the listed builds are tested; others
need a check on the user's Mac. Remote and Sandbox sessions cannot use
Stainless. Detached descendants of the browser are not confined beyond the
existing owned-Playwright process-group stop.
