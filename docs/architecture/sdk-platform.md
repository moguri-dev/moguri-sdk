# Shared SDK platform contract

The CLI, TUI and desktop are clients of one Moguri SDK. The SDK owns typed
capability access, shared defaults, settings, cancellation and protocol
negotiation; the service remains the sole durable authority. A new SDK operation
must work without Electron and must be exposable by either client.

## Desktop interaction maintenance, 2026-10-23

Reuse React (MIT), existing native keyboard/pointer events, the shared revisioned
settings/session SDK and pinned NeMo-Speech.cpp 0.2.0 (Apache-2.0). No dependency,
protocol event or database migration is needed. Resizable desktop chrome is a
local presentation preference, with compatibility for the previous fixed-width
sidebar preference; settings and transcripts remain service-owned across clients.

Enter sends and Shift+Enter inserts a newline. Cmd/Ctrl+Enter still holds a
prompt without running it, and composition/repeated key events must not submit
work. Both chat composers follow the same desktop convention. Sidebar resizing
must also work with keyboard arrows, retain enough room for chat, and preserve
unsaved panel edits. Collapsing the right pane leaves its icon rail available.
Message copy controls appear on hover or keyboard focus, not persistently.

Toggle/dropdown preference changes use the existing optimistic-revision writes.
They cannot implicitly save other text edits, acknowledge prompt risk, apply a
model proposal or retry over another client's changes. Text/JSON settings retain
nearby explicit Save actions. A failed save preserves edits and surfaces the
failure; an in-flight save continues to block navigation/submission as appropriate.
The settings-focused conversation is presented as **ask Moguri**, without
changing its reviewed proposal or scope boundaries.

Compact layouts keep offered answers and composer actions visible together
with a held queue down to 840 x 620. Long question/advice content scrolls with
keyboard access instead of pushing Send below the window. Speech stop/discard
and capability-job cancellation remain available during a held preference save;
new recordings are blocked until the configuration settles.

Ctrl+Space must reach the focused chat surface without auto-repeating start/stop.
Native stop requests are idempotent and finalization has its own bounded deadline,
separate from cancellation escalation. Cancellation discards output; nonzero and
signal exits never become successful transcripts. Diagnostics retain the actual
exit status/signal and bounded native errors. Tests use generated recognizers,
including delayed finalization, startup/stop races, cancellation and native
failure, never a microphone, model weights or a personal provider account.

Before integration, the fresh Phase 0 run passed generated provider cancellation
in **31.57 ms**, SQLite append p95 **0.054 ms** and crash rebuild **0.54 ms**,
known PTY-group cancellation **151.94 ms**, OpenTUI updates **17.07 ms**, and
hidden Electron cold start **196.53 ms**, aggregate memory **446.50 MiB** and
10,000-row scrolling **11.97 ms/frame**. The 2,000-file Node baseline measured
**0.88 ms** search and **6.20 ms** Git status. Platform vector/graph work passed
in **6.04 ms** with real MCP discovery/call/result. Model-control forwarding and
its unsupported-effort negative case passed in **55.32 ms**; retained-compartment
and hidden Ghostty spikes passed in **123.95 ms** and **25.80 ms** respectively.
The real pinned speech binary's version/help passed without audio or weights.

The original Phase 0 script still explicitly reports unavailable live provider,
Rust/Linux, notarized packaging, native SendBox, evaluated multi-model quality,
live decision-provider and configured SSH checks. Its historical initial-slice
attachment/default labels do not supersede later qualified protocol slices.
These maintenance measurements do not qualify those unavailable capabilities
or claim real microphone capture or ASR accuracy.

## Requirements and delivery boundary

Dark is the factory desktop theme. The visual identity is an original minimal
face-and-bat-wings mark, represented as SVG, native app icon and terminal ASCII.
No supplied third-party illustration is embedded or traced.

The shared settings surface includes an editable, viewable strong system
prompt, a breakage warning, and restore-to-default actions. Hard permissions
are deterministic service policy, not editable model instructions. Restore
preserves projects, conversations, knowledge, credentials and downloaded models.
Any reset that weakens permissions is an explicit user action.

The capability families are prompt, permissions/SendBox, repository vector and
graph memory, style memory, optional subagents, standard skills, curated scripts,
plugins, the native MCP gateway and local dictation. Optional model-driven
evolution starts off and may only propose reviewed changes; no proposal can
enable itself, acquire permissions, alter user-only settings or apply a script
or skill without human approval. Autonomous later-work activation stays behind
the implementation specification's milestone gates.

## Phase 0 sources and new dependencies

Reuse the existing Node/SQLite/TypeBox/pi-ai/React stack. Add the official MCP
TypeScript SDK (MIT), sqlite-vec (MIT/Apache-2.0), Ajv (MIT), YAML (ISC) and
Cheerio (MIT), with ignore (MIT) for root/nested exclusions. Resvg (MPL-2.0)
is build-only rasterization for the original icon.
Local speech uses NVIDIA NeMo-Speech.cpp (Apache-2.0, retaining upstream
notices), not a hosted inference API.

The official `nvidia/nemotron-3.5-asr-streaming-0.6b` model card identifies
OpenMDW-1.1 licensing and 40 language-locales: 19 transcription-ready,
13 broad-coverage and 8 requiring adaptation. This is 32 working locales out of
the box, not a verified 22-language claim. The pinned native runtime is 0.2.0;
existing local GGUF paths avoid implicit model downloads. A user must explicitly
request and accept the model download before dictation. No model weights or real
microphone input are used by automated tests.

Sources:

- <https://huggingface.co/nvidia/nemotron-3.5-asr-streaming-0.6b>
- <https://github.com/NVIDIA/NeMo-Speech.cpp/tree/v0.2.0>
- <https://github.com/NVIDIA/NeMo-Speech.cpp/blob/v0.2.0/docs/cli.md>
- <https://github.com/mbianchidev/sendbox/blob/main/docs/integrations.md>
- <https://github.com/mbianchidev/sendbox/blob/main/docs/interactive-sessions.md>

SendBox is not installed on the validation host, nor is an approved digest-pinned
workload image/guest bundle configured. Its documented interactive input requires
a real controlling PTY and cannot be combined with JSON. Do not
pretend piping Node IPC through `--json` works. Sandbox remains fail-closed until
the real worker transport, scoped authentication and cleanup are qualified.

## Invariants, persistence and validation

New settings and capability changes are versioned immutable events with
optimistic revisions, source and real approval actors. Database migration 2
must preserve schema-1 sessions, drafts, queues and receipts. Repository indexes
are derived, profile/project-scoped SQLite vector/graph data; they do not become
a second session store. Local hashed-token vectors are labeled lexical vectors,
not claimed to be learned semantic embeddings. Indexing and context injection
require explicit opt-in, respect protected/ignored paths and retain digests.

The gateway exposes bounded discovery/description/call/result operations, not
every backend schema in every prompt. Backend credentials stay in an explicit
secret store. Tool metadata and returned content are untrusted. MCP annotations
do not confer permission. A model cannot start OAuth, approve itself, widen the
configured server set or execute a changed tool schema under an old approval.

Generated fixtures must prove SDK importability outside the checkout, shared
settings/restore behavior, migrations/restart, stale approval rejection, scoped
index invalidation, vector and graph retrieval, bounded gateway discovery,
stdio/HTTP cancellation, secret-safe auth and optional capability defaults.
Voice tests use generated audio or a generated recognizer, never real
microphone capture; runtime/model absence must be actionable, never cloud
fallback. Both clients must expose the same operation rather than duplicate it.

## Validation measurements, 2026-10-18

On the same macOS arm64 / Node 26 host, sqlite-vec 0.1.9 successfully loaded into
Node's real SQLite driver. Inserting 500 vectors, querying a project-partitioned
nearest-neighbor result and reading a graph edge took 13.12 ms total. An official
MCP client/server pair performed initialization, tool discovery, invocation and
result decoding through the supported in-memory transport.

The official 0.2.0 macOS arm64 Metal runtime (5,031,510 bytes) was downloaded,
matched against NVIDIA's published SHA-256 and executed. `--version`, JSON model
discovery and transcription help passed without weights or microphone access.
The default ASR catalog names Nemotron 3.5 and pins its GGUF revision. Model
inference and capture remain user-setup-dependent, not claimed benchmark passes.

SendBox remains a FAIL/unavailable physical-host spike because the CLI, trusted
guest artifacts and approved workload image are absent. Tests may exercise
configuration and fail-closed policy, not call a fixture a qualified real VM.

## Executable SDK platform checkpoint

The complete macOS suite passes **43** generated unit/integration/native-TUI
checks. The hidden Electron suite passes **2** workflows for source clients:
Copilot/device-flow wiring, streaming/tools, cross-client drafts and recovery,
plus dark defaults/mascot, prompt warning/edit/reset, preserved dirty settings,
shared permissions, real local indexing, MCP discovery and default-off modes.

The packed external consumer passes strict NodeNext declarations for all four
public entrypoints and runs an embedded service, project-partitioned vector
retrieval, native MCP discovery and speech-runtime readiness without Electron,
personal auth or model weights. A clean locked install, type checks, production
build and audit pass with zero reported vulnerabilities. Known upstream
`node-domexception`/`whatwg-encoding` deprecations and OpenTUI's experimental FFI
warning remain visible.

New regression coverage includes schema-1 migration without history/receipt
loss, persistent vectors/graph after restart, ignored/stale source suppression,
real stdio and Streamable HTTP MCPs, credential redaction, bounded pagination,
process shutdown/cancellation, revocation and external/agent project-lease
exclusion. Subagent cancellation covers a queued child before admission.
Generated recognizers prove early stop prevents later microphone startup,
finalize versus discard, and TERM-resistant output-limit escalation.

The repeated primitive spike measured 500 vector inserts/query/graph reads in
5.45 ms; official MCP discovery/call/result passed. The UI's bounded desktop/
compact/settings inspection and deterministic design scan found no remaining
mechanical issues. None of these results claims live Copilot entitlement,
learned semantic embeddings, real ASR accuracy, microphone capture, qualified
SendBox or notarized release readiness.

The versioned `0.2.0-alpha.1` macOS arm64 development artifact also passed the
packaged SDK/service, bundled Node, CLI/TUI, mascot-icon and native speech
runtime checks. Both hidden Electron workflows passed against that actual app.
Its DMG is approximately 298 MiB and ZIP 240 MiB; the DMG checksum and ad-hoc
bundle signature verify. Packager reports the optional `.icon` format absent;
the generated `.icns` fallback is present and byte-verified against the source
branding build. No production signing/notarization or model weights are claimed.
