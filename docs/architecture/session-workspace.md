# Session workspace and Ghostty contract

The [protocol-51 interaction follow-up](session-interactions.md) adds atomic
sibling ordering, existing guarded drag attachment, shared confirmation
preferences, explicit model-only task checklists and real-user Other answers.
It does not change actual session roots or grant model authority. and Ghostty contract

This user-requested slice keeps capability semantics in the SDK/service and
extends the existing dark client world. It is not a new terminal implementation
or a reason to enable deferred autonomous features. CI remains main-push-only.

## Unified Start and independent consoles, protocol 44

The desktop has one **Start** entry point for a **New chat** without a project,
an existing project, importing an explicitly chosen local folder, or cloning an
explicit repository into a new chosen destination. There is no separate
project-free dropdown or project-import plus. The general conversation group is
**Chats**. Selecting a scope creates a session through the existing SDK; it never
rebinds an existing chat or starts a model automatically.

Reuse React/native dialogs and pointer/keyboard events (MIT), Node-PTY and
Ghostty (MIT), Node crypto/SQLite and the existing SDK/event authority. Cloning
invokes the user's Git executable, not a new Git library or bundled dependency.
Repository URLs cannot embed credentials, invoke custom transports, initialize
submodules or execute repository hooks/checkout filters. No interactive login is
automated. An unavailable credential or host fails explicitly. Exact canonical
destination and original user intent are retained before filesystem/network
effects; cancellation/restart never retries a clone or removes a partial tree.
The exact destination and any containing registered project/worktree are leased;
active clone roots cannot be imported or opened as a second user console.
Successful project registration and the completed clone-job record commit together.

Protocol/migration 44 extends Local terminal bindings/states with actual null
session/project identities for one independently owned **Global terminal** per
profile, not a synthetic chat or inherited project. A profile-default query
discloses the canonical home directory; the user explicitly opens that root.
Project-free session consoles also require an explicit Local root, separate from
model workspace authority. Existing project consoles keep their exact bound
worktree. Remote bindings still require real session/project/peer identities.
The existing profile-owned broker authenticates all consoles; no PID guessing,
input replay, new VT implementation or output persistence is introduced.

Global launches retain root-scoped `terminal.changed` intent with null
session/project fields. Global history survives unrelated session/project
deletion. A second concurrent global open selects no replacement: the service
admits at most one original live global intent. Captured inode/root and allowed
Local policy are rechecked before admission and every input/resize; inspection
and close remain available after policy/root changes. Explicit restart
reattaches the exact owner/PTY; ordinary stop closes known groups. Old running
brokers without the extended capability cannot be replaced or granted new
global launches implicitly. Migration records the new schema transactionally
without rewriting old encrypted payloads or asking users to delete state.

The main composer replaces Send with a red Stop icon while a real turn is
active. Enter and explicit delivery actions still answer/queue/steer/interrupt;
Cmd/Ctrl+Enter still holds without starting work. Stop never clears the draft or
claims cancellation succeeded before service acknowledgement. Autopilot may be
selected without a project or preexisting allow rule; selecting it grants no
tools. Hard denials, scope restrictions and exact human approval for undelegated
operations remain enforced. Side chats retain their snapshot/read-only scope
and expose explicit available-model selection when the inherited selection is
missing, stale or synthetic, never a provider/model fallback.

Generated coverage must include concurrent opens/clones, missing receipts,
cancel/restart/partial outcomes, migration rollback, profile and null-scope
isolation, preserved root/index intent, real Ghostty input/resize/reattachment,
project-free Autopilot without grants, and side-chat model changes. Tests never
use personal shells, repository contents, credentials or hosted inference.

The fresh pre-change Phase 0 run on macOS arm64 measured generated provider
cancellation **31.03 ms**, SQLite append p95 **0.048 ms** and crash rebuild
**0.52 ms**, known PTY-group cancellation **151.81 ms**, OpenTUI updates
**16.87 ms**, hidden Electron startup **249.89 ms**, aggregate shell memory
**451 MiB**, and 10,000-row scrolling **8.05 ms/frame**. The 2,000-file Node
baseline measured **0.90 ms** search and **5.89 ms** Git status. Independent
retention and real hidden Ghostty spikes passed in **109.12 ms** and **32.60 ms**.
The original script's live-provider, Rust/Linux, notarized release, qualified
native guest, model-quality, live-decision and configured-SSH gates remain
unavailable; these measurements do not enable those capabilities.

### Protocol-44 source qualification

The final production build and type checks pass. The complete generated
unit/native suite passes **1,092 checks with 9 gated skips in 1,029.85 s**;
the hidden desktop suite passes **81 workflows with 1 native-Sandbox skip in
3.2 min**. All four packed external SDK entrypoints pass import/declaration
checks. Actual installed SDK/CLI/shared-command qualification exercises real
generated Git clones, project-free Autopilot and independent Local consoles
with **zero model calls**. Workspace and packed-consumer audits report
**zero vulnerabilities**.

Coverage includes same/different-profile root leases, simultaneous global
opens and clone destinations, delayed/cancelled clone work, failed final
publication, service restart and missing original receipts without replay,
schema-43 migration rollback/reopen, unchanged version-1 Local/SSH binding
digests, and independent-console protection against worktree removal and
artifact publication. Desktop checks preserve parent drafts/models/scopes,
use Start for both project-free profile defaults and project overrides, and verify
the red composer Stop in its original Send position.

The expected upstream dependency deprecation notices, OpenTUI experimental FFI
warning and lazy Ghostty bundle-size warning remain visible. All audio, Git
repositories, SSH identities, recognizers and provider responses used here are
generated fixtures. This is source qualification, not live microphone/ASR,
personal provider entitlement, native Sandbox, notarized packaging or complete
detached-process containment.

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
Protocol 44 adds stable sibling order through one complete, revision-checked
`session.reorder` transaction. Desktop drop indicators do not mutate order on
hover. Dragging into the composer copies reviewed transcript context instead
of changing navigation ownership. Both clients sort with the shared comparator;
keyboard/menu alternatives use the same SDK command. Confirmation preferences
are independently saved profile settings, defaulting to asking.
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
partial and failed cleanup. Closing a UI panel does not stop its PTY. User-console
input/output are ephemeral, never durable conversation/event payloads or model
context. Restart does not relaunch a shell or replay terminal input.
Protocol 23's [user-console ownership](terminal-reattachment.md) preserves an
authenticated per-profile broker across explicit service restart or controller
loss. Ordinary service stop still closes known groups. Exact root/policy,
private cleanup and input-generation guards apply to every client; legacy
ownerless metadata is unconfirmed, never adopted from a saved PID.

Protocol 46 adds a separate [Agent command view](agent-terminal.md), backed by
approved `run_command` PTYs and ordinary scoped tool results, not these private
user-console buffers. Its read-only model inspection preserves exact approval,
source identity and current policy. Per-command output does not create
persistent interactive shell state or a user-input route.

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

Delivery includes the ad-hoc-signed app, approximately 330 MiB DMG, 257.5 MiB
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
