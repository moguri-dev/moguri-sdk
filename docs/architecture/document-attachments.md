# Bounded document attachments

This slice extends existing typed attachment commands, snapshots, drafts, queues,
encrypted grants and worker delegation. It is not a second upload system.

## Change contract and qualification

Qualification precedes integration. PDF.js (`pdfjs-dist` 6.4.299, Apache-2.0)
supplies PDF text/page parsing. yauzl 3.4.0 (MIT) supplies lazy ZIP validation and
streaming decompression. sax 1.6.1 (BlueOak-1.0.0) supplies strict XML parsing.
Their upstream licenses are compatible with Moguri's distribution. OOXML
extraction uses these maintained primitives, not an office application, macro
runtime or formula engine. `npm run spike:documents` uses generated files only.
Before client/service integration, the macOS arm64 / Node 26.12.0 generated
qualification passed all six groups:

| Primitive | Result | Time / peak RSS |
| --- | --- | --- |
| PDF text/page and image-only-page provenance | PASS, 2 pages | 222.47 ms / 110.84 MiB |
| DOCX heading/paragraph/table extraction | PASS, 4 sections | 120.92 ms / 81.89 MiB |
| XLSX sparse/cached/formula/hidden-sheet extraction | PASS, 7 cells | 125.62 ms / 81.67 MiB |
| Signature, encryption, content-type, macro, DTD and expansion checks | PASS, 9 rejections | 1,148.50 ms total |
| Concurrency and actual process cancellation | PASS, third worker rejected, owned child killed | 121.35 ms |
| Forced deadline and observed-memory failure | PASS, no partial success | 56.57 ms |

The first rejection sweep failed only because its assertion omitted the explicit
DTD diagnostic; the parser had correctly rejected it. The corrected sweep
checks typed `document_*` errors. `npm ci`/audit reports zero vulnerabilities.
This qualifies local text extraction, not OCR, rendering, Office execution or a
new native VM transport.

Protocol/schema 43 adds a `document` attachment, bounded read/search queries and
tools, and additive retention metadata. Original canonical base64 and normalized
extraction JSON each get their own encrypted blob digest in the existing
session/profile grant transaction. Existing text, Java/source and image
discriminators and ciphertext stay unchanged. Explicit child context copies
receive independent grants, including originals.

Capture either commits one complete ready/limited descriptor with the unchanged
draft, or fails explicitly without replacing it. Concurrent revisions, stop,
timeout, deletion and shutdown cannot publish a late result. Interrupted capture
is never replayed on restart; retained completed snapshots need no reparsing.
Workers receive bytes, not source paths, credentials or a service token.
Send and hold admission are blocked while that draft has an active document
capture, including through another SDK client. Pending context is never
silently left out of an admitted prompt.

## Resource and execution limits

| Resource | Admission / execution bound |
| --- | --- |
| Original | 8 MiB per file; existing 16 attachments / 12 MiB aggregate includes original and extracted bytes |
| ZIP | 256 entries, 8 MiB per expanded entry, 32 MiB total; expansion ratio at most 200:1 for entries above 64 KiB |
| PDF | 200 pages; no raster rendering or OCR |
| DOCX | 20,000 extracted sections; nested tables/alternate chunks explicitly unsupported |
| XLSX | 32 sheets, 50,000 actual cells; sparse coordinates, never allocation from declared dimensions |
| XML | Depth 64, 200,000 elements per part, no DTD/custom entities, bounded UTF-8 parts |
| Extraction | 2 MiB complete normalized JSON; 128 KiB per text/formula unit |
| Worker | 10 seconds, 128 MiB V8 old-space, 384 MiB sampled whole-process RSS ceiling, two captures across profiles reserved before source loading |
| Inspect | 16 KiB UTF-8 text per read; 20 literal-search hits with bounded excerpts |

Parsing runs in a separate restricted Node process. The parent owns timeout,
termination, output-byte and RSS watchdogs. A separate trusted watchdog thread
also enforces deadline/RSS while the parser event loop is blocked, even if the
controller disappears. Heap/watchdog failure cannot become a successful result
or crash the service. RSS is sampled (25 ms inside, 50 ms outside), not a claim of
an instantaneous OS physical-memory limit. Bounded original/ZIP/output
allocations and V8 heap limits supplement that watchdog. The two-capture limit
is per controller, shared across its profiles, and applies before original
bytes are read. No networking, process spawning, source filesystem reads or
plaintext temporary file is permitted. PDF JavaScript/eval, fonts, external
resource loading, forms and embedded code are never executed.

Signatures, ZIP CRC/sizes, required OOXML content types, namespaces and structure
must match the selected format. Renaming a binary to `.pdf` or `.xlsx` cannot
bypass validation. Encrypted/password-protected packages/PDFs, malformed parts,
macros, active/embedded objects and any exceeded bound fail explicitly. No output
is silently truncated to make extraction succeed.

## Extracted content and provenance

PDF units retain 1-based pages. Pages without extractable text remain represented
and identified as blank or possibly scanned/image-only; OCR is unavailable.
Text reading order is an extraction estimate, not a rendered-layout guarantee.

DOCX retains body paragraphs, heading levels and table-cell row/column provenance.
Formatting, media, headers/footers, comments and field evaluation are outside
this text slice and disclosed in limitations; originals stay retained.

XLSX retains valid 31-character sheet names/visibility, sparse A1 coordinates, raw cached values and
formulas as inert strings. Shared/array formula attributes remain explicit;
missing cache is null, never recalculated or replaced with zero. Hidden cells
and sheets are not silently discarded. Even a stale cached `999` for `1+2`
remains `999`, proving no formula evaluation. Phonetic guides are not appended
to the actual cached string. Links are text only, never fetched.

## Model boundary and clients

Only a descriptor, extraction status, limitations and bounded tool instructions
enter model context. Full originals/extractions are not injected into requests.
`read_document` selects pages, sections or spreadsheet ranges with exact UTF-8
pagination (16 KiB text plus provenance); `search_document` returns literal
matches with provenance. `list_documents` rediscovers bounded admitted
descriptors after explicit compaction without expanding all documents back
into model context. Inventory/search pages stay within 16 KiB serialized.
Results are explicitly untrusted and require the existing exact approval or
delegation. User previews may inspect draft/queue snapshots; model workers may
inspect admitted snapshots only.

Local and pinned SSH use the existing authenticated scoped-controller broker.
No workstation path, root mount, automatic provider switch or Local execution
fallback is introduced. Unsupported native/tool-less/model transports preserve
attachments and explain their admission blockage.

SDK root/React entrypoints contain only browser-safe schemas, types and calls.
Desktop selection/chips show parsing, ready/limited state and a bounded preview;
CLI and TUI use the same commands and APIs. Cancellation, errors and unsupported
combinations never consume the unsent prompt or held queue.

## API and command examples

The browser-safe SDK exposes `attachments.document`, `cancelDocument`,
`listDocuments`, `readDocument`, `searchDocument` and explicit user-only
`original`. Ordinary `attachments.read` returns status/metadata, not the body.
`attachments.file` still supports Java/source text and images and automatically
recognizes the three supported document extensions before validating content.
See [SDK usage](../sdk.md#document-attachments) and
[CLI/TUI/desktop usage](../setup.md#document-attachments-and-task-completion).

Configured local models may explicitly declare `toolInput: false`; document
admission then blocks without weakening existing text/image behavior. Tool-less
subagents and settings chats likewise cannot consume document context. This
flag describes configured transport capability, not model quality or permission.
Native execution needs a newly qualified matching-protocol workload (currently
44 after the desktop interaction update); old protocol-43 images are
not silently accepted or relabeled. Local/SSH source checks do not qualify a
new native image, OCR or a signed desktop release.

## Watchdog requalification

The independent watchdog version passed the same six spike groups: PDF
232.75 ms / 131.98 MiB, DOCX 188.80 ms / 103.92 MiB and XLSX
202.37 ms / 103.66 MiB. The nine rejection cases passed in 1,637.69 ms,
concurrency/cancellation in 197.35 ms and forced deadline/memory rejection in
55.18 ms. Generated CPU-blocked execution also self-terminates under a
500 ms watchdog deadline without using the test harness's emergency kill.
The first CPU test exposed an inherited `--input-type=module` fixture flag,
not a relaxed parser limit; the fixture now starts the real worker entrypoint
with its own explicit worker arguments.

## Focused source and packed-consumer qualification

The final document-focused sweep passed 29/29 cases in 19.44 s, including actual
CLI/TUI operations, browser-safe imports, Local/SSH model tools, compaction
inventory, retention, restart, failed persistence, refused kill acknowledgement,
pre-load concurrency and generated hostile-input/resource limits. Seventeen
affected legacy migration/recovery selectors also passed in 4.15 s. Legacy
fixture demotion removes only future markers so rollback checks still compare
the original ciphertext, identities and receipts.

The actual packed 0.30.0-alpha.1 external consumer passes all root/React/Node/MCP
imports/types, approved install/audit and installed document-worker checks.
It captures and privately retrieves all three originals, performs bounded
provenance-bearing reads/searches, and checks descriptor inventory and progress
without inference. Existing installed roles, budget holds, compaction, profiles,
SSH, terminal and retention checks remain intact. Both source and consumer
dependency audits report zero vulnerabilities.

The first packed sweep found a generated marketplace fixture pinned to protocol
41; it now binds the actual installed protocol, without weakening compatibility
checks. The next sweep correctly rejected an 8,192-token mock-model request:
its 4,311-token fresh input plus the unchanged 4,096-token headroom did not fit.
The repetitive compaction fixture now uses 64 rather than 80 repetitions and
asserts that exact input/headroom bound before each dispatch. No production
budget/context limit or no-truncation check was relaxed.

The full sweep exposed a TUI viewport regression from the added progress rows.
The checklist now uses the footer's existing reserved row, remaining visible
without hiding raw compaction results; the original unchanged native UI
assertion passes again (1.30 s). Strict XML-only entities reject HTML-only named
entities such as `&nbsp;`, and cancellation before source loading uses the same
typed `document_cancelled` result as an active parser. Pending-capture send/hold
rejection is exercised without consuming the draft or queue. The corrected
document-focused sweep passes 27/27 cases in 19.40 s and all six parser spike
groups pass again (PDF 238.38 ms / 131.89 MiB, DOCX 166.40 ms / 104.03 MiB,
XLSX 171.67 ms / 103.75 MiB).

The repeated full unit/integration/native-TUI sweep passes 1,068 cases with
zero failures (1,077 total; nine actual native-workload cases skip because this
host has no configured current-protocol workload receipt), in 979.23 s.
The first full desktop sweep found a compact-window answer-button clipping
regression from the expanded progress display. Compacting the bar and moving
details into its existing modal-visibility contract restores the unchanged
assertion. All nine focused document/progress/composer/question workflows pass
in 25.4 s; full hidden-desktop acceptance is recorded below.

## Final source acceptance

| Check | Result |
| --- | --- |
| Pinned dependency restore and source audit | PASS, zero vulnerabilities |
| Type checks and production build | PASS |
| `npm run spike:documents` | PASS, all six generated groups |
| `npm test` | PASS, 1,068 passed / 9 native-only skipped / 0 failed, 979.23 s |
| `npm run test:e2e` | PASS, 70 passed / 1 native-only skipped / 0 failed, 2.8 min |
| `npm run verify:sdk` | PASS, actual packed external imports/types/install/runtime/worker and existing owned-role probes |

The final desktop follow-up changes only compact presentation and its readonly
details dialog; the complete desktop suite passes after that change. Its
question/answer, permissions, document, image, preview and retention assertions
were not weakened. The nine unit and one Electron skips require a real configured
protocol-43 SendBox workload; these results do not qualify that missing native
image, a signed/notarized release, Linux release readiness, OCR or live paid
provider entitlement. Existing OpenTUI FFI, npm deprecation/script-review and
large Ghostty chunk notices remain nonfatal.
