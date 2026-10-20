# Tool outcomes and retained storage

## Prerequisite qualification

The protocol-20 audit found model accounting and streaming views, but no
session-independent tool/MCP outcome ledger or profile storage query. Generic
job progress is not a reliable operation source: an MCP result can be retained
as an already-completed job, and external MCP requests have a separate approval
and execution lifecycle.

The generated prerequisite is `tests/outcome-storage-primitives.test.ts`. Its
original private `tests/fixtures/outcome-prototype.ts` is preserved in commit
`6daa888`; the qualified projector/storage primitives were subsequently
extracted into `apps/service/src/operation-telemetry.ts`, not duplicated.
The prerequisite does not introduce a second workflow
database. Root-scoped fixture events exercise the existing encryption and
transaction primitive, not a production job-based metrics API.

On the current macOS arm64 host, using Node 26.11.1, all **11 checks passed in
231.68 ms**. A separate generated replay projected **20,000 source events into
5,000 distinct tool attempts in 15.46 ms**. This is a fixture replay measurement,
not model inference, production throughput or an active-tool-time benchmark.
Both repository type checks passed. The first check intentionally failed
because the prototype did not exist; a later test-only discriminated-union
typing error was corrected before qualification.

The prerequisite proves:

- Arguments, paths, command/output/error text and generated credential markers
  do not enter the allowlisted retained metadata.
- Profile, turn, step and call identity keep concurrent/reused IDs distinct.
  Actual MCP call attempts are separate from gateway discovery/tool lookup.
- Denial is not execution. Stopped, partial, failed, unconfirmed and unknown
  outcomes are not successes. A turn ending without a tool result does not
  invent a tool completion time or elapsed sample.
- Model and external actors need actual provenance. Historical missing start,
  environment and actor observations remain unknown. Explicit user plan saves
  are excluded from model tool/MCP metrics.
- Source and derived metadata commit or roll back together. Session-key
  deletion removes source contents but preserves sanitized root metadata,
  including across a real persistent-store close/reopen.
- Two grants of one content digest are two real ciphertext payload copies.
  Removing one grant preserves the other, while foreign-profile sizes remain
  excluded. An unexplained missing key fails measurement rather than becoming
  zero retained data.

No provider, real MCP, microphone, personal credentials, native sandbox or
external network endpoint was used.

## Change contract

Reuse the existing authoritative service, typed API, append-only encrypted
SQLite events and shared SDK. Node is MIT-licensed; SQLite is public domain.
Existing TypeBox, React, OpenTUI and MCP SDK dependencies are MIT-licensed.
No dependency, new inference role, process boundary or execution authority is
needed for this slice.

The protocol-21 implementation adds a numbered schema migration,
typed profile-root outcome events and a coverage marker. Backfill uses only
retained, provable source events. Previously forgotten history is unavailable,
not zero calls or a zero-percent failure rate. Capture names/IDs and actual
outcome/time provenance, never source contents. User plan-save history remains
its own control-operation history.

Tool and actual MCP-attempt families must be disjoint; gateway wrappers and
retained result jobs must not inflate counts. A failure rate needs an explicit
known-result denominator, with denied, pending, stopped, partial, unconfirmed
and unknown counts visible independently. Repeated names alone cannot establish
retries. Observed tool lifecycle wall time is not summed active time.

Storage measurement is **key-backed retained ciphertext**, not physical disk
usage, a successful decryption/integrity audit, plaintext size or reclaimed disk
space. Count the sealed event payload column once, encrypted blob grants and
encrypted retention-key payloads. The event envelope also embeds its payload;
that structural copy must not be counted again as logical content.
Metadata/receipts, tombstones, SQLite pages/indexes/WAL, forgotten ciphertext,
repositories/worktrees, dependency caches, model weights, memory indexes and
terminal buffers are outside this deliberately narrower measurement.
Physical and reclaimed byte values stay unavailable.

## Shared application behavior

`operation.recorded` contains one sanitized current attempt revision, with
profile/session/turn/step identity, a hashed opaque call ID, actual model or
external actor provenance, safe tool/server identifiers, captured source
filters, observed timestamps and source-event references. It is derived inside
the source event's transaction and retained under the profile root. Source
deletion does not delete it or make earlier private contents readable.
Unknown names, actors, environments and timings stay explicitly unknown.
Duplicate starts cannot yield a success or a fabricated elapsed sample.

`operation.coverage_started` marks the tracking boundary. Startup imports only
provable retained observations once, without model/tool dispatch. Already
deleted history is unavailable. Missing completions become unconfirmed at
turn termination, not successful or precisely timed. Exact late results can
improve a matching attempt's observed outcome without replaying an effect or
upgrading its owning partial turn.

MCP call attempts use the same tool lifecycle, not generic job progress,
discovery queries or retained-result jobs. A declined external approval is
denied before start even when its enclosing request job is cancelled.
The rate is failed / (completed + failed); every excluded outcome has its own
count. No semantic retry count or tool/MCP token attribution is invented.
Elapsed observations include service dispatch/result transport, have
millisecond wall-clock resolution and are not summed active-tool time.

`sdk.telemetry.operations(filters)` returns complete matching totals/groups and
bounded attempt pages. Shared UTC date, project/folder/session/owning-turn,
provider/model/role/environment filters apply; additional filters select
tool/MCP family, actual actor, tool/server or outcome. Missing request/start
times are counted as uncertain and excluded from dated views, not from All
time. More than 2,000 matching groups requires a narrower filter. Pagination
does not define totals and can shift during live/late updates.

`sdk.telemetry.storage()` measures one consistent current-profile read
transaction. It is deliberately not date/project/model filtered. It checks
active key presence and unexplained missing event/blob-grant keys fail
explicitly; it is not an authenticated payload-integrity scan. Byte/count
overflow fails instead of rounding. It adds no deletion, retention or
scheduling authority.

CLI exposes `telemetry operations --filters JSON` and `telemetry storage`.
Native TUI shares `/dashboard operations JSON`, `/dashboard storage` and F7.
The existing desktop Dashboard has progressive tool/MCP outcomes, sanitized
history and retained-size sections. Storage refresh is explicit, not a SQL
scan for every streamed token. Profile changes/unmounted requests cannot
install an earlier asynchronous result in a new view.

Application coverage includes real owned Local/SSH tool effects, model and
external MCP actors, declined approval, cancellation, identical scoped IDs,
source deletion/restart, legacy retained-only import, schema-marker/derived
append failure, exact date filters, profile isolation, native TUI and hidden
desktop views. The wider repository/org/visibility, full active-time and retry
attribution roadmap remains unimplemented.
