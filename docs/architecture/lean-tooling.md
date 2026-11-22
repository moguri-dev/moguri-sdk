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
public domain). Structured authoring uses MIT-licensed docx 9.14.0,
write-excel-file 4.1.1, pdf-lib 1.17.1 and fflate 0.8.3. An initial ExcelJS
probe passed the root audit only under a root override; the packed consumer
proved that overrides do not propagate to dependent installs. ExcelJS was
therefore removed rather than exempting its UUID advisory or weakening the
consumer audit. The maintained writer depends only on the existing fflate.
No replacement agent framework, VT renderer or
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

## Compatible MCP dependency security updates, 2026-11-13

A fresh root audit reports moderate advisories in the unchanged Hono 4.13.13
and `@hono/node-server` 2.1.5 lock entries. The maintained MCP SDK already permits
the fixed versions: Hono `^4.11.4`, node-server `^1.19.9 || ^2.0.5`. The user
explicitly approved only compatible security lock updates. npm updates only
those two entries to the current fixed patch releases, **4.13.18 and 2.1.8**,
with their registry SHA-512 integrity. Both retain MIT licenses; no direct
dependency, root override, SDK version, public API or migration is added.

The advisory minimums are Hono 4.13.16
([GHSA-h7mg-cq63-vhpq](https://github.com/advisories/GHSA-h7mg-cq63-vhpq)) and
node-server 2.1.6
([GHSA-qv5m-9pm6-hqp3](https://github.com/advisories/GHSA-qv5m-9pm6-hqp3)).
`npm ci` installs the updated lock with the existing lifecycle policy and zero
root advisories. All 21 owned MCP/OAuth/process/import checks and the built UI's
five exact affected paths pass. The independently installed packed consumer
continues its own audit rather than relying on root overrides.

The compiled worker/service/SDK bytes do not change, but the dependency lock is
a new input cut. The older pinned Native workload image and its original
qualification remain exactly their old bytes, not retroactively patched.
A release using newly produced patched guest bytes requires its own reviewed
image and qualification. No host installation, service/network action or
automatic release is authorized by this development dependency update.
The user subsequently approved building and qualifying a generated patched
image without changing the existing SendBox, Apple CLI, services or networking.
The no-cache producer passes in **32,785.353708 ms** and binds lock SHA-256
`161dc06fba008956818271296d6c21aa41d817680bbb60a98ead73c7ab6dec9f`
to local immutable workload
`docker.io/library/moguri-worker@sha256:a204030620e19e2b0297416877b3d89475844938c2c7f041500178ba53ebfb38`.
All ten actual physical gates pass in **133,599.372792 ms**, report SHA-256
`959a1fd8879976feb821a9955a4b50328b1edfd0f6756346b22cc5c5c098214c`;
all five current Native desktop control patterns then pass in **59.4 seconds**.
The remaining four first-use/root-less/checkpoint/manual-publication UI paths
also pass in **42.7 seconds**, without a host installer or administrator dialog.
The root and fresh packed-consumer audits report zero vulnerabilities.
The earlier 3,360-cell coverage stays tied to its old image; these selected
patched-image receipts do not substitute for its complete new-image matrix.

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
constraints while reducing initial catalogue exposure. External MCP execution
retains the existing gateway's authority; the later
[ranked-method/direct-schema slice](command-tool-preferences.md) also permits
exact discovered provider-facing leaf schemas. The smaller generic envelope cannot
express each invoked native tool's parameters to provider validation.
Empty-query browsing and exact names recover vocabulary-dependent misses.

These are schema bytes and maintained estimates, not exact tokenizer counts,
provider cache hits, live token/cost savings or task-quality measurements.
No percentage saving or universal unchanged-outcome claim is authorized.
Generated integration, concurrency, cancellation, migration/restart and packed
consumer checks must cover the implemented surfaces. Live task/cache/quality
non-regression still needs a separately authorized representative evaluation.

The final expanded source catalogue was reprobed in **5.78 ms**. Its eager
45-tool surface serialized **39,579 bytes / 11,314 estimated input tokens**;
bootstrap was **3 tools / 3,484 bytes / 1,001 estimated tokens**; the selected
file task was **5 / 5,184 / 1,487**; and the generic gateway remained
**1 / 240 / 74**. This compares the same final capabilities, not a claim that
the old 19-tool checkpoint included the new functions. The labels and live
evaluation limits above still apply.

## Product boundary

Lowercase `/review`, `/security`, `/performance` and `/debug` accept optional
prompts and act within existing autonomy/policy. Their default scope is current
changes (and relevant dependencies), or the current project when clean. Debug
may inspect only the session-owned Agent terminal/processes and permitted logs;
other DAP targets need explicit selection and normal execution permission.

The [shared workflow-command extension](command-tool-preferences.md#shared-command-behavior)
adds UI design, prompt-free continuation, question-led collaboration, actual
assigned children/orchestration and read-only constructive critique. Presets
never manufacture answers or approvals. Project suggestions still require exact
source review before generation; optional tool-less subagents remain off.

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
switch. Alternative/additive graph/vector memory backends remain later work, not
implied implemented by this contract. Stainless is a separate optional
[integration](stainless.md).

## Executable protocol 58

Normal fixed-model and kupo solver turns initially expose `discover_tools`,
`ask_user` and `task_progress`. Discovery loads selected typed native functions
at the next model boundary. Empty-query pages and exact names remain available;
search rankings are deterministic metadata matches, not model decisions.
Metachat retains its own small configuration/question catalogue and private
router/critic/compactor/checkpoint roles remain tool-less. Every boundary
intersects loaded names with fresh root, mode, environment and policy gates.
Sizing/reservation uses the actual exposed schemas. Knowing a name or loading
its schema is never an execution grant.

Enabled skills initially contribute metadata/digests, not every body.
`use_skill` finds metadata or loads one exact enabled body. Root-to-target
instructions remain complete; repeated path/digest bodies are deduplicated
within the owning turn. They remain untrusted instructions beneath hard policy.

### Deterministic operations

| Capability | Actual behavior and bounds |
| --- | --- |
| `read_file` | Whole-source SHA-256; files up to 1 MiB with structural/line/byte/literal views. A stale optional digest refreshes explicitly and restarts byte continuation; `requireExactVersion` deliberately pins instead. Writes still require the returned fresh digest. Automatic previews above 16 KiB or 200 lines; explicit unpaged full reads remain at most 128 KiB. Byte paging/literal search takes precedence over full mode and returns at most 16 KiB. Previews are not AST or semantic summaries. |
| `edit_file` | Ordered unique old/new replacements, exact source digest and one atomic publication; up to 1 MiB edited text. No ambiguous matching, fuzzy replacement or silently rewritten EOLs. |
| `find_files` | Bounded `rg` inventories, applicable ancestor/nested `.gitignore`/`.ignore`/`.rgignore`, glob pages and explicit incomplete coverage. Intersect ordinary inventory with glob inventory because explicit ripgrep globs override ignore rules. Global ignore/config injection stays disabled. |
| `search_files` | Actual Rust-regex/literal ripgrep, path/glob/case/context selectors. Compact rows are bounded by UTF-8 bytes; only permitted match/context records enter retained source, including for literal metacharacters in denied folder names. |
| `diff_files` | Tracked staged/working-tree or merge-base comparison using local refs and full verified commits. No external diff/textconv/pager, remote freshness or untracked-file claim. Native text stages are not Git checkouts, so this schema is excluded there. |
| `query_data` | JSON/core-YAML parsing and compact stdin-only jq. No imports, modules, ambient environment or additional inputs. Reserved query words are conservatively rejected even in quoted strings; this is a disclosed subset, not all jq/yq syntax. |
| `clock` | UTC/timezone and observed monotonic timing, or a cancellable wait up to ten seconds. No durable timer, scheduling or extra inference. |
| `web_search` / `web_fetch` | Keyless public search versus bounded public-page fetching; no browser or credential forwarding. An explicit configured MCP search provider is a different approved destination, not a silent fallback. |
| `create_issue` | Exact-input preview then separately approved GitHub/Linear issue creation using existing account/team/root intent, verification and no-replay machinery. No arbitrary API/GraphQL, authentication, account switch, Git/PR write or transport substitution. |

`rg` and `jq` must exist on the actual execution host. Missing executables
produce explicit errors and are never installed by the tool. The Linux workload
recipe includes both and hashes `dist/data-worker.mjs` in its payload. A changed
recipe/payload is not proof that an old qualified native image contains them.

Original file/command/query/document/DAP output is retained separately from its
compact model view, up to the documented operation/envelope bounds.
`read_tool_result` and `tooling.result` bind exact public session/step/call
identity with UTF-8 paging. `rawComplete` describes retained source coverage,
not semantic completeness or successful execution. Source deletion removes
access; missing data never authorizes replay. Raw digests enter the normal
encrypted retention-reference transaction.

### Bounded file-search recovery, protocol 75

Selective `read_file` requests previously applied the 128-KiB whole-read cap
when `mode: "full"` accompanied `search`, `offset` or `limit`, despite returning
a bounded selection. Source admission now follows that selection precedence:
up to 1 MiB of source, at most 16 KiB of selected text. Actual unpaged full
reads retain their 128-KiB limit. No match is a successful empty literal-search
result; regex and larger sources use `search_files`. Write CAS, pinned reads,
protected paths, nested instructions and exact retained source do not change.

Builtin MCP `grep_logs` now uses the same 1-MiB source bound rather than the
smaller full-read default. Results contain at most 100 matching-line excerpts
of 1,000 Unicode code points each, with the entire serialized MCP result bounded
to 12,000 UTF-8 bytes. Whole trailing rows are omitted when needed, rather than
cutting JSON at the gateway's model-view boundary. Long excerpts start at their
first match, so a match near the end is not silently discarded. Each excerpt carries its
original UTF-8 byte `offset` and `clipped` flag; `omittedRows` and `complete`
disclose selection coverage. This is a bounded match result, not a retained
complete file. Page the exact source with `read_file` when needed. Invalid
Unicode queries and oversized/binary/protected sources remain explicit errors.

Known native-tool argument failures retain `invalid_tool` and report bounded
schema field/type/range diagnostics without echoing submitted values or
arbitrary input-property names. Unknown tool names are not echoed either.
Invalid requests execute nothing; corrected requests remain possible, including
after a genuine source or policy change. No blanket retry suppression, silent
clamping, synthetic success or automatic model/permission change is added.

The Remote builtin resource uses a new digest binding the actual source,
line, character and serialized-result limits. Previous two-tool and four-tool
grants remain retained but cannot authorize the expanded resource without fresh
user review.
Protocol/schema 75 forces the established matching-owner service-upgrade path;
its metadata-only migration preserves ciphertext, event identities, receipts,
website grants and accounting. No durable payload/event schema changes or
additional dependencies are introduced. TUI, desktop and SDK share the service
behavior and original failure/cancellation outcomes.

Generated README, long-line and actual-worker regressions reproduce the
incorrect limits and prove bounded recovery. They do not reconstruct the exact
cause of failures in a deleted conversation.

#### Focused protocol-75 qualification

Implementation `be3cd91` / `c93caf0` is qualified against frozen runtime bytes
and pinned Node 26.12.0. These are focused search/authority/recovery checks,
not the earlier complete protocol-73 suites relabelled as a new full run.

| Surface | Result |
| --- | --- |
| Strict types and complete production build | PASS |
| Native/SDK/worker/search, file CAS, MCP, real SSH authority/cancellation/restart and preserved-state migrations | **111 passed, no skips**, in **54,060.19 ms** |
| Hidden source desktop tooling and healthy-old-service cancellation | **3 passed**, **4.5 s** |
| Actual packaged executable desktop | **3 passed**, **7.0 s** |
| Independently installed packed SDK | Imports/types, browser-safe entries, installed runtime/CLI/TUI/recovery and audit pass; **12 actual installed-worker acknowledgement/accounting probes passed** |
| Exact actual bundled backend regression | Node **26.12.0**, SDK/service/worker: a **180,050-byte README** recovers from an invalid byte limit; long/control/Unicode searches retain matching excerpts and pass intact bounded JSON to the next model request. **Six generated model requests and four model-free MCP calls**, no personal credentials or paid inference |
| Source, independent-consumer and no-cache Linux-workload audits | **Zero vulnerabilities** |
| Exact no-cache protocol-75 Linux workload | PASS in **45,303.94 ms**; immutable image/payload below |
| Production ZIP/manifest consumer | PASS; **779,891,947 bytes**, **115,433.64 ms** |
| Actual DMG | Private layout, signed application tree and exact byte checks pass; no Finder/user application opened |

One initial packaged loss-receipt probe encountered `database is locked` during
its direct generated SQLite receipt deletion. The same compiled bundle passed
the unchanged complete packaged probe in isolation; the failed-run evidence is
retained separately. No production recovery behavior was changed to hide it.
Existing non-blocking notices remain experimental OpenTUI FFI, the large lazy
Ghostty chunk, transitive dependency deprecations and the skipped optional
`.icon` format; the actual `.icns` mascot and native layout verify.

Retained installer:
`release/Moguri-0.30.0-alpha.1-search-75-macos-arm64.dmg`,
**794,107,843 bytes**, SHA-512:

```text
1cd68f3b17c5a18dd0f7b910424d3dab0ae2815af8845c625987c784065d0209026afc2dcd66813d3b1828212aa1a66d8c2efef3cc51466c8b76319e1e8af2f9
```

Workload:
`docker.io/library/moguri-worker@sha256:a128496eaeeb698d97385c26675265c8a78df7e02318ca1eae3e8b179a935c5b`.
Worker SHA-256:
`cb872beca80577ff87de0d4b2d291e2ab360e8bfb3fa905983658b8751978d35`;
bridge:
`05c19b96bfc817609ed7f25e63f7761a516bc5856060a135b07bc1a769921e5b`;
MCP worker:
`1336c7c0f53afc951504b3c664e83277bb62216f7301c30bb074cfc21dede3a7`.
This is ad-hoc-signed development output, not notarized or uploaded. Install
matching protocol-75 clients/service through the existing reviewed upgrade;
never delete state to upgrade. No live model-quality, physical SendBox VM,
external Linux-host or wider first-milestone readiness is implied.

### Structured documents and SQL

`write_document` produces actual PDF, DOCX or XLSX bytes. `inspect_document`
extracts an approved existing project file, returns its original-byte digest,
and selects pages, sections, sheets/ranges or literal search. Continuations
require that digest. Retained source is inert extracted JSON-lines, not a
retained original binary, rendered layout or a model summary.

DOCX edits require a unique match within one supported body text run and
preserve untouched archive parts. Cross-run/ambiguous edits reject. XLSX cell
editing is restricted to supported simple Moguri-generated workbooks. A bounded
inert declaration is not trusted alone: regenerate its complete supported
parts and compare every actual original uncompressed entry before any edit.
Externally changed styles/cells/parts never get flattened or silently rebuilt.
Formula caches are explicit source data, never calculated. PDF regeneration
uses built-in fonts and rejects unsupported characters explicitly; arbitrary
PDF layout editing and OCR remain unavailable.

Authoring, extraction and SQLite evaluation use an isolated installed
`data-worker.mjs`, restricted filesystem/module access, a 128-MiB V8 heap,
an independent 384-MiB RSS/deadline watchdog and a ten-second operation bound.
No network, child process or plaintext temporary document is available there.
Publication uses the original source CAS, atomic rename, fsync and real partial
outcomes when acknowledgement is uncertain.

Project SQLite is separate: read-only `sqlite_query` returns a database/WAL
digest; `sqlite_transaction` requires that exact digest or `absent`, bound
parameters and one transaction. Database/sidecar symlinks, ATTACH, extensions,
user transaction control and raw Moguri event/key/receipt databases reject.
Unsafe-size integers remain decimal strings, not rounded numbers.

`query_state`/`mutate_state` instead evaluate isolated in-memory projections:
`todos(id,text,status)` and `memories(id,title,text,tier)`. Todo positions must
form an explicit 2..50-step canonical plan. Model writes can create/update only
current-session Sky notes. No deletion, Terra/Glacier edit/promotion, memory
opt-in or forged user authorship. Complete source/root/owner/policy is rechecked
after evaluation; all prepared domain events commit together. A failed note
validation cannot partially publish a plan.

### Owned commands and DAP

Ordinary `run_command` retains its per-turn, per-command PTY. Background shell
survivors never become successful implicit watches. The separate, explicit
Local `command_job` records an exact bounded command, original root/call owner
and timeout before execution. At most two watches run per profile; they may
survive a finished model turn but not an ordinary session/service stop.
`read_command_job` and `tools.command` read their original live tail or retained
result, never a User/Global console.

Only observed wall time, normalized output counts and real status are exposed;
CPU/RSS and lost output stay unavailable. Interrupted intents become partial
and quarantine the captured root without PID adoption or restart replay.
Actual-user inspection binds an exact digest and does not upgrade the outcome.
Acknowledgement and an explicit Resume are distinct; another same-root session
cannot clear uninspected watch quarantine.

`debug` implements framed stdio DAP against an explicitly selected executable,
not a replacement debugger engine or guessed PID. Each actual request needs its
own grant; blanket debug execution is forbidden. Requests have a 15-second
bound, bounded responses/events and rejected reverse-terminal requests.
Cleanup first requests disconnect: terminate a dispatched owned launch,
detach an external attach without terminating/suspending it, then stop the
known adapter group. Lost mutation/disconnect acknowledgement remains partial.
The generated adapter proves the transport/lifecycle, not qualification of
every language adapter or whole-descendant containment.

### Coordinated sessions

Birth ownership and explicit root-bound coordination grants are independent
of mutable sidebar nesting. Preview discloses actual profile, Env, canonical
Local root/inode or pinned SSH peer/root/build. Changed roots/grants require
fresh review. Native live coordination stays blocked until separately
qualified; retained original snapshots do not silently become live access.

Children retain their captured parent snapshot under their own encrypted grant
and read it on demand. Live transcript/progress reads are bounded, digest-bound
and public-only. Side chats stay read-only; separate agent children execute
explicitly dispatched tasks with Manual defaults and their existing approvals.
Messages preserve actual user/model/service origin and enter only at safe
boundaries as escaped untrusted data. Sending an advisory neither consumes a
draft nor starts a paid reply. A child result notice is an observation, not
acceptance, quality or a user answer.
Each new message binds its exact authorization-chain/root digest. Revoke/regrant
or changed-root messages remain inspectable with a delivery diagnostic, never
fresh model context. Queued delegated tasks recheck that original proof before
admitting a paid turn; an actual user queue edit clears model origin as before.

A quiescent coordinator may yield its same-root writer lease while waiting on
its child. It stays read-only until the child settles and the root is free.
Known live debugger/watch work prevents yielding. Stops bind the actually
observed child turn; held direct-user prompts cannot be released as model work.
Actual questions and approvals use the original child's owning APIs.

Coordinated calls charge the immutable original budget owner once. Retained
scope paths also enforce stricter child/intermediate token/USD caps and held
capacity. Navigation, source deletion and restarts do not reassign charges or
refund unknown work.

### Clients, migration and evidence limits

The SDK exposes `tools`, `coordination` and `workflows`. Shared `/tools`,
`/tool`, `/tool-result`, `/state`, `/watch` and `/coordinate` work in CLI/TUI/
desktop. Model-turn-only tools cannot be promoted into standalone user jobs.
The desktop Side chat panel adds main/child context, advisory messages,
explicit child tasks, grant review and original question/approval controls.
Agent shows watch logs and exact user inspection alongside ordinary commands.

Schema 58 adds a strict transactional `lean_tooling_schema` and convergence
marker. It recognizes the actual candidate-retention or earlier development
lean-tooling schema-57 lineage, never version numbers alone. Exactly one valid
original marker is required; missing, corrupt or ambiguous combinations fail
without healing state. The development tooling lineage runs the same original
candidate rekey inside the atomic schema-58 convergence transaction.
Existing ordinary ciphertext, drafts, receipts, Default identities and held
accounting stay preserved; only main's already-qualified exact candidate
generation evidence receives its intended retention scope.
New raw-result/snapshot references and coordination/command/model-note
provenance use the existing append-only stream, not mutable SQL state tables.
Older healthy services require the established explicit matching-owner restart.

Generated checks cover actual worker discovery/compact rereads, exact edits,
ignore/protected-path exclusion, isolated document round trips, SQL rollback/
atomic/stale-state rejection, actual model-origin issue creation/lost replies,
parent dispatch/writer handoff/budgets, restart migration/source retention,
framed DAP disconnect and hidden Electron controls. The live public keyless
probe returned three HTTPS results for `TypeScript official documentation`;
this one observed page is not a provider-availability SLO.
The [pre-integration setup qualification](https://github.com/mbianchidev/moguri/blob/main/docs/setup.md#pre-integration-lean-tooling-qualification)
records the original complete full-suite, hidden-client and audited
external-consumer results before main's candidate-cleanup merge. Final
integration additionally qualifies both schema-57 lineages and preserves
candidate cleanup, coordination and stricter descendant accounting together.
The [protocol-58 integrated sweep](https://github.com/mbianchidev/moguri/blob/main/docs/setup.md#protocol-58-integrated-source-qualification)
passes the complete Node/native-TUI, hidden Electron and audited packed SDK/
installed-worker gates against that combined implementation.
An integrated deletion blocked by a partial watch still permits only the exact
actual-user watch inspection/acknowledgement and existing Resume/retry paths;
candidate deletion cannot trap that recovery action or admit new model work.
Live representative task/cache/quality evaluation,
additional memory backends, arbitrary document preservation and independent
language-adapter/native/remote transport qualifications remain separate.
