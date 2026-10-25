# Workspace experience and skill gateway

## Change contract

This slice simplifies the existing macOS alpha, not the wider release roadmap.
The control plane remains authoritative for skill discovery, suggestion sources,
accounting and work observations. Clients share typed SDK queries and slash
commands. Automations is an empty left-sidebar destination. Code change and
Work item are right-rail, per-session panels, not global resources or new
provider-write capabilities. Code change preserves an already-linked PR;
Work item remains a placeholder for issue links.

Reuse React, TypeBox, the maintained MCP SDK, YAML and yauzl under their existing
MIT licenses, Node's filesystem/crypto primitives, and the existing budget,
event, terminal-owner and settings mechanisms. No new runtime dependency,
charting framework, agent loop, credential backend or terminal renderer is needed.

Protocol/schema 59 adds profile-owned optional skill-source settings and typed
read-only gateway/dashboard queries. A transactional metadata migration preserves
schema-58 events, receipts, encrypted grants and profiles. Existing settings
normalize to no configured sources. No new durable event kind is required.
User-selected source configuration uses the existing settings event and revision
check. Reading a skill cannot install it, enable a capability or grant tools.

The gateway accepts explicitly configured local folders, GitHub repository URLs
or HTTPS ZIP archives. Each find/read refreshes and validates the source; no stale
body is returned after failure. Local recursion rejects links and escaping paths.
Archives are bounded and validated without extraction or execution. Loading binds
the selected source/path and exact SHA-256 body. Sources are control-plane Local
reads, not an implicit SSH/Sandbox filesystem transport. Revocation, changed
configuration and cancellation must invalidate pending results.
Cancellation uses an authenticated, exact-profile query ID and explicit
`/v1/query-cancel` message as well as transport abort. Electron's custom-protocol
Request signal alone does not propagate renderer cancellation reliably. The
native proxy forwards the query ID and cancel route; the service aborts that
original source read, rather than only hiding its reply. A cancelled lookup
releases the settings navigation guard. A 30-second, bounded ephemeral marker
also rejects cancellation-before-admission races. IDs never identify commands,
model calls, permission grants or durable work; cancellation cannot replay or
refund any of those. Missing acknowledgement is an explicit client error.

Global suggestions preview profile-wide usage gaps and bounded prior prompts
without creating a hidden chat or calling a model. Selecting a chat narrows the
scope. Sending excerpts still requires review of the exact source digest.
Generated advice cannot apply configuration or authenticate anything.

Dashboard pages are My work, Usage, Cost and Velocity. Seven UTC days is the
initial range; 30/60/90-day presets and a custom range are available. Custom starts
at the trailing year. All-role model accounting keeps estimates, missing usage,
held capacity and invoices distinct. Velocity shows observed completions,
completion time and user interventions; these are not a causal productivity or
time-saved claim. External MCP/tool-control turns and private subagent turns
are excluded from completion/intervention velocity, not relabeled as user
tasks. Their operations and all-role costs remain in their own accounting.
Date filtering never changes cumulative budget admission.

New Local user consoles default to configured HOME, never the state directory.
Project consoles still bind the actual Moguri worktree. Existing owners retain
their original root and input is never replayed. Missing roots fail explicitly.

Settings use hover/focus copy controls for non-secret text fields and information
tooltips for explanations. Errors, live status and consequential safety warnings
stay visible. Icon-only navigation keeps accessible names and keyboard focus.
The footer contains profile name, Ask Moguri and Settings in one row. Copilot
connection status is shown only in Settings / Models / Providers, not the left
sidebar. Both new right-rail panels follow the actual selected session.

## Visual direction

Keep the factory theme: midnight `#11161e`, canvas `#141922`, surface `#191f29`,
mint `#a8d7bc`, slate `#a2afc0`, and text `#e1e8f0`, resolved through existing
theme variables. Native system type carries headings and controls; monospaced
figures distinguish measured data. Avoid a new marketing-style hero or fonts.

The dashboard's signature is a work pulse: a compact time-series plot and
project/model breakdowns first, with exact records behind disclosure controls.
The surrounding navigation and settings stay quiet. Graphs include accessible
text/data alternatives and do not depend on color alone.

## Prerequisite measurements

Fresh macOS arm64 run before feature integration, 2026-10-25:

| Primitive | Result | Measurement |
| --- | --- | --- |
| Generated provider streaming/cancellation | PASS | 6 requests; cancellation 31.77 ms |
| SQLite WAL/crash/rebuild | PASS | 1,000 events; append p95 0.050 ms; rebuild 0.51 ms |
| Known PTY process-group cancellation | PASS | 152.45 ms; zero fixture survivors |
| OpenTUI React timeline | PASS | 60 updates; mean 17.27 ms |
| Hidden Electron timeline | PASS | cold start 193.29 ms; 445.53 MiB; frame 12.11 ms |
| Generated filesystem/Git baseline | PASS | 2,000 files; search 0.96 ms; Git 5.98 ms |
| Independent encrypted compartments | PASS | 500 events / 250 artifacts in 114.80 ms |
| Hidden Ghostty WASM | PASS | 423,045 bytes; input/108x24 grid in 23.50 ms |
| Model-control forwarding and sizing | PASS | 56.06 ms; unsupported effort not forwarded |
| Official MCP OAuth/refresh | PASS | 17.50 ms; one refresh |
| Vector/graph and official MCP discovery/call/result | PASS | 500 rows in 6.59 ms; MCP round trip passed |

`npm ci` restored missing dependencies and reported zero vulnerabilities.
The expected OpenTUI experimental FFI warning remains. The base spike still
labels live inference, Rust/Linux, signed packaging, native SendBox, multi-model
quality, live decisions and personal SSH qualification FAIL/unavailable. Its
historical full-attachment/default/budget limitation is not a new regression.
Nothing here claims those physical/live gates passed or enables a fallback.

## Verification boundaries

Generated tests cover HOME/worktree roots, exact skill freshness and scope,
malformed/escaping archives, changed and removed sources, bounded pagination,
MCP discovery/read, profile isolation, schema-58 restart migration, global
suggestion consent, dated accounting and truthful velocity samples. Hidden
Electron checks cover navigation, all four dashboard pages, field copying,
secret exclusion, keyboard tooltips and preserved edits. Build/type checks and
an independently packed SDK consumer remain required.
