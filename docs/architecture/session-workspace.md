# Session workspace and Ghostty contract

This user-requested slice keeps capability semantics in the SDK/service and
extends the existing dark client world. It is not a new terminal implementation
or a reason to enable deferred autonomous features. CI remains main-push-only.

## Phase 0 and reused components

Use maintained `ghostty-web` 0.4.0 (MIT), which embeds Ghostty's WASM VT parser
and renderer, for the desktop terminal. Moguri owns only the authenticated PTY
transport, user-input boundary, process lifecycle and bounded in-memory replay.
Reuse Node-PTY, existing process-group supervision, Node crypto/SQLite, React,
Vite and the shared protocol. No xterm.js replacement or homemade VT emulator
is introduced.

`node scripts/session-spikes.mjs` passed on macOS arm64: the real 423,045-byte
Ghostty WASM loaded in a hidden sandboxed Electron window under
`script-src 'self' 'wasm-unsafe-eval'`, rendered ANSI output, accepted input and
fitted 108 columns/24 rows in approximately 21 ms. No CDN, personal shell,
clipboard, real browser navigation or permission grant was used.

The same generated spike appended 500 encrypted compartment payloads while
keeping events immutable, removed only a session retention key and retained
250 independently owned project/artifact payloads. It took approximately
114 ms. This qualifies the primitive, not forensic erasure or production scale.

## Domain and interaction

Cmd+Enter queues a held prompt even when idle. Starting it is a separate
explicit action; Send/Steer/Interrupt remain distinct. Unclaimed queue items
can be reordered, edited, copied and removed. Sent messages can be copied, not
silently rewritten.

Agent/read-only is independent of Env, model and autonomy. Read-only permits
only scoped read operations, never shell, write, MCP execution, evolution or
Git mutations. Mode changes are recorded at a safe steer/step boundary; a
pending restriction blocks new edit approvals immediately. Already-started
operations may settle and must not be described as rolled back. A return to
agent mode waits for the project writer lease. Question-only side sessions
cannot promote themselves.

One shared slash catalogue/dispatcher serves both chat clients. `/read-only`,
`/agent`, `/rename`, `/side` and `/subsession` use typed APIs. Sidebar actions
are presentation/native actions. `/terminal` and the requested `/termnial`
alias open Ghostty only in desktop; terminal clients report that they already
have a terminal. Browser/diff/plan use the appropriate client surface.

Sessions have durable pin/unread/group/parent metadata. Reparenting is
project-scoped, acyclic and bounded; it does not rewrite captured context.
Explicit user subsessions are distinct from off-by-default model subagents.
Writable siblings serialize through the project lease; read-only questions
may run in parallel. PR/work-item bindings never implicitly check out a branch.

Projects support ordered folders, icon color, attached-path relocation and
per-project settings. Moving a navigation entry is not permission to move or
delete its repository. Repo defaults include upstream/main/branch pattern,
sandbox fields, scripts, port/optional Porto, read-only/denied folders and
instruction/MCP source paths. Repository content cannot grant its own
permissions. Uncontained shell/MCP execution is blocked when folder policy
cannot be enforced.

Missing AGENTS.md/mcp.json are surfaced for explicit initialization. Creating
and publishing defaults is an explicit user action on a non-protected branch,
not a hidden consequence of opening a folder or reading settings. Preserve
unrelated working-tree changes and never push main implicitly. Imported MCP
configuration requires review and starts disabled; inline secrets are rejected.

## Retention and deletion

Protocol/database migration 4 must preserve prior events, receipts, queues,
capabilities and indexes without asking users to delete state. New payload
retention compartments keep the typed event log append-only: deletion erases
authorized session/project payload keys and derived data, not immutable audit
records. Session artifacts use independent project ownership and survive
session deletion. Project removal forgets Moguri-owned project artifacts, not
repository files or external PRs.

Production retention keys use an explicit OS-keychain master, with its stable
identifier stored in state so relocating the complete state directory does not
create a new key. There is no plaintext-key fallback. Tests inject generated
keys and never access a personal keychain. This is a retention mechanism, not a
claim of filesystem protection, SSD secure erasure or deletion of user backups.

Stop owned work before deleting its session; preserve requested, acknowledged,
partial and failed cleanup. Closing a UI panel does not stop its PTY. Terminal
input/output are ephemeral, never durable conversation/event payloads or model
context. Restart does not relaunch a shell or replay terminal input.

Archived-session cleanup is off by default and requires an explicit user
retention policy. It preserves independently retained artifacts and never
closes a PR. Removal and retention must invalidate connected clients' cached
transcripts, drafts, terminal buffers and selections.

## Acceptance

Generated tests cover schema-1/2/3 migration, key loss/corruption, transactional
deletion/restart, artifact preservation, unsafe reparenting, project policy,
mode/steer and approval races, held-queue admission, copied prompts, owned PTY
input/resize/stop/restart and shared slash commands. Hidden Electron tests load
the actual Ghostty WASM, exercise compact/long-content layouts and native action
fixtures without opening a personal browser, publishing a real branch, running
CI or using a microphone.

## Alpha delivery evidence

The macOS arm64 `0.4.0-alpha.1` checkpoint passes clean locked installation,
type/declaration checks, production build and **83** generated unit/integration/
native-TUI checks. All **five** hidden Electron workflows pass for source and
the actual packaged app, including real Ghostty keyboard input, isolated browser
boundaries, held prompts, side read approvals and project/session deletion.
One batched visual inspection covered desktop, compact, long-title and settings
states; the bounded static desktop scan returned no findings.

The packed external consumer imports all four SDK entrypoints, explicitly
approves/rebuilds that exact file dependency, audits with no reported
vulnerabilities and drives its own real PTY I/O on macOS. The separately bundled
Node/service/SDK/native dependencies also pass PTY readiness/input/close checks,
not just renderer or source-runtime proxies. Unicode paging advances even with
a one-unit requested page, and generated high-volume output verifies the actual
128 KiB UTF-8 retention bound.

Delivery includes the ad-hoc-signed app, approximately 326.5 MiB DMG, 257.5 MiB
ZIP and 5.8 MiB SDK tarball. Signature/icon, self-hosted Ghostty assets, pinned
Node/speech runtime and DMG checksum are verified. No model weights, personal
keychain, microphone, real authorization or private Porto process was used.
Live Copilot entitlement, ASR accuracy and real SendBox/Remote containment are
not inferred from these generated checks.

Known nonfatal warnings remain visible: experimental OpenTUI FFI, upstream
dependency deprecations, the initial file-package script approval notice,
Packager's optional `.icon` absence with verified `.icns` fallback, and the
lazy Ghostty JavaScript chunk exceeding Vite's generic 500 kB threshold. The
source and external consumer audits report no vulnerabilities. CI is still
main-push-only; this evidence was produced locally, not by dispatching CI.
