# Lean tools and coordinated sessions

## Change contract

The shared service remains authoritative. Fixed-model and kupo sessions use
the same deterministic tools, SDK, approvals, budgets and execution boundary.
Discovering a schema is not permission to execute it. Side chats remain
read-only; writable agent children need their own admitted execution authority.
Navigation nesting is not a coordination grant.

Reuse Node, TypeBox, maintained pi-ai, YAML, Cheerio, the existing MCP gateway,
file publication, worker, command supervisor, encrypted event store and domain
APIs. These dependencies retain their existing licenses (MIT, YAML ISC, SQLite
public domain). Structured authoring uses MIT-licensed docx 9.14.0, exceljs
4.4.0, pdf-lib 1.17.1 and fflate 0.8.3. ExcelJS's uuid dependency is pinned to
the compatible patched CJS release 11.1.1; generated workbook round trips
qualify that override. Its older archive dependencies still report upstream
deprecation warnings, not suppressed or called an advisory-free dependency tree
until the audit passes. No replacement agent framework, VT renderer or
unreviewed Rust helper is introduced. Runtime utilities/adapters must be
available in the actual execution environment; absence is an error, never a
controller-side fallback or permission to install software.

Result views are deterministic selections, not lossless summaries. Disclose
omissions, current source digests, cursors and retention limits. Exact source
remains recoverable only while its owner retains it. Model-written summaries
and history compaction keep their separate explicit review and metering.
Tool-less roles receive their complete admitted evidence, not unreadable
handles. Unknown results/accounting never become zero usage or success.

New capability APIs require a protocol upgrade and preserved-state migration.
Coordination messages retain actual model/user origin; they cannot forge an
answer or approval. Cancellation binds original owners and records actual
acknowledged/partial outcomes. Recovery never replays writes, starts paid work
or deletes sessions. Both clients consume the same SDK, not a client-only tool
registry.

## Phase-0 evidence, 2026-10-25

The initial attempt failed because node-pty was absent. A locked `npm ci`
restored declared dependencies and reported zero advisories. No live account,
microphone, browser profile or paid model was used.

| Primitive | Result | Measurement |
| --- | --- | --- |
| Generated provider HTTP/cancellation | PASS | 6 requests, cancellation 30.76 ms |
| SQLite WAL/crash rollback | PASS | 1,000 events, append p95 0.057 ms |
| Known PTY group cancellation | PASS | 151.94 ms, zero generated survivors |
| OpenTUI stream | PASS | 60 updates, mean 16.69 ms |
| Hidden Electron | PASS | 209.24 ms startup, 446.23 MiB, 8.24 ms scroll frame |
| Filesystem/Git | PASS | 2,000 generated files, 0.87/6.04 ms |
| Actual supported model controls | PASS | generated three-transport probe, 61.68 ms |
| Retention compartments | PASS | 500 events, 250 artifacts, 122.20 ms |
| Real Ghostty WASM | PASS | 423,045 bytes, 25.10 ms |

The baseline's live-provider, Rust/Linux, release signing, historical native
SendBox, live model-quality/decision/SSH and complete initial-composer groups
remain explicitly FAIL/unqualified. Later documented qualifications are
separate; a generated probe neither revokes nor extends them.

`node --import tsx --test tests/tool-catalog-primitives.test.ts` first failed
for the missing primitive, then passed both cases in 416.23 ms.
`node --import tsx scripts/tooling-spike.mjs` compared the same actual native
catalogue in 5.50 ms:

| Interface | Schemas | Serialized schema bytes | Labeled input estimate |
| --- | --- | --- | --- |
| Existing native catalogue | 19 | 14,417 | 4,125 |
| Lazy typed bootstrap | 3 | 3,452 | 992 |
| Lazy typed file task | 5 | 4,740 | 1,360 |
| Generic stable gateway | 1 | 240 | 74 |

Choose lazy typed native schemas: they retain provider-visible argument
constraints while reducing initial catalogue exposure. Keep external MCP
tools behind the existing gateway. The smaller generic envelope cannot
express each invoked native tool's parameters to provider validation.
Empty-query browsing and exact names recover vocabulary-dependent misses.

These are schema bytes and maintained estimates, not exact tokenizer counts,
provider cache hits, live token/cost savings or task-quality measurements.
No percentage saving or universal unchanged-outcome claim is authorized.
Generated integration, concurrency, cancellation, migration/restart and packed
consumer checks must cover the implemented surfaces. Live task/cache/quality
non-regression still needs a separately authorized representative evaluation.

## Product boundary

Lowercase `/review`, `/security`, `/performance` and `/debug` accept optional
prompts and act within existing autonomy/policy. Their default scope is current
changes (and relevant dependencies), or the current project when clean. Debug
may inspect only the session-owned Agent terminal/processes and permitted logs;
other DAP targets need explicit selection and normal execution permission.

Nested `AGENTS.md` and supplementary `moguri.md` are resolved root to target,
with nearer textual rules and same-directory `moguri.md` taking precedence.
They never override hard service policy.

Project SQLite reads and approved transactions are distinct from SQL views of
Moguri-owned todos/memories. Internal writes use validated domain events, never
raw encrypted event/key/receipt updates or invented user actors. Memory writes
cannot promote themselves or enable injection.

Structured PDF/DOCX/XLSX authoring belongs to this delivery, not a deferred
extraction-only claim. Arbitrary PDF layout editing, OCR, macros, embedded
execution and silent formula recalculation remain unsupported.

Keyless search is browser-free and separate from fetching. Configured providers
retain their real destination and failure provenance; no hidden provider
switch. Alternative/additive graph/vector memory backends and Stainless remain
later work, not implied implemented by this contract.
