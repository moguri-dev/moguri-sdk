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
| `read_file` | Whole-source SHA-256; files up to 1 MiB with structural/line/byte/literal views. Automatic previews above 16 KiB or 200 lines; explicit full reads remain at most 128 KiB. Previews are not AST or semantic summaries. |
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
The [pre-integration setup qualification](../setup.md#pre-integration-lean-tooling-qualification)
records the original complete full-suite, hidden-client and audited
external-consumer results before main's candidate-cleanup merge. Final
integration additionally qualifies both schema-57 lineages and preserves
candidate cleanup, coordination and stricter descendant accounting together.
An integrated deletion blocked by a partial watch still permits only the exact
actual-user watch inspection/acknowledgement and existing Resume/retry paths;
candidate deletion cannot trap that recovery action or admit new model work.
Live representative task/cache/quality evaluation,
additional memory backends, arbitrary document preservation and independent
language-adapter/native/remote transport qualifications remain separate.
