# Tool outcomes and retained storage

## Prerequisite qualification

The protocol-20 audit found model accounting and streaming views, but no
session-independent tool/MCP outcome ledger or profile storage query. Generic
job progress is not a reliable operation source: an MCP result can be retained
as an already-completed job, and external MCP requests have a separate approval
and execution lifecycle.

The generated prerequisite is `tests/outcome-storage-primitives.test.ts`, with
its deliberately private fixture in `tests/fixtures/outcome-prototype.ts`.
It does not enable an application capability or introduce a second workflow
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

The next application implementation requires a numbered schema migration,
typed profile-root outcome events and a coverage marker. Backfill may use only
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

The service must provide the same projections to SDK, CLI/native TUI and
desktop. Migration/restart, duplicate/late completion, exact profile/date
filters, deletion, missing telemetry and failure paths require application
coverage before the feature can be described as implemented. This prerequisite
alone does not qualify those APIs or the wider dashboard roadmap.
