# Remote repository memory

## Prerequisite boundary

Reuse Node 26/TypeBox (MIT), OpenSSH (BSD), the existing bounded UTF-8 framer,
ignore (MIT), safe project-file/ignore/folder helpers and sqlite-vec
(MIT/Apache-2.0) on the control plane. No new dependency, learned embedding
provider, model request, persistent remote authority or Sandbox work.
The owned generated SSH primitive passes in **129.26 ms**.

The private proof must capture only the actual selected SSH root, with its
canonical path and lossless device/inode. Source data is bounded at the
existing 5,000-directory, configured-file, 128-KiB-file and 64-MiB-total limits.
Nested ignores, denied/protected paths, symlinks and unsupported/binary files
cannot enter the index. Capture rechecks root/file identity after awaits.
Each response frame is bounded independently, with backpressure; a valid
dataset may exceed the agent's single 32-MiB frame. No frame ceiling is raised.
Final counts/content hashes are checked before any cache publication. A
truncated/cancelled/stale stream is not an empty or successful index.

Retrieval needs actual-host metadata/ignore validation, not a Local `stat`
against a same-named path. Digests identify indexed bytes; matching
mtime/size is a cheap freshness observation, not proof against hostile
timestamp-preserving mutation. Returned context stays untrusted.

## Public integration requirements

The existing project/worktree SDK memory APIs stay explicitly Local. Add
session-bound index/search/graph operations so the service, not a client,
resolves Env, profile, peer and actual root. Settings, CLI/TUI, model
`memory_search`, optional context injection and internal MCP memory tools must
use that same binding. Optional indexing/injection stay off and vectors remain
accurately labeled lexical, not Sky/Terra/Glacier semantic memory.

The local control plane owns vector/graph derived caches. Remote cache keys
include actual pinned peer/root identity and profile/project; a Local index
can never substitute for a missing Remote one. A typed derived-cache metadata
table must be published atomically with its rows, preserve old Local caches,
and be removed with the owning project/workspace/profile scope. It is not a
permission source or second append-only domain authority. Existing event-first
capability jobs retain index/stop/partial outcomes.

This requires a versioned migration after schema 26, rollback/restart and
private-profile coverage. Admission/authority must be rechecked after capture
and before atomic publication; concurrent same-scope indexes cannot intermix.
Cancellation/control loss preserves the old complete cache or an explicitly
unconfirmed completed publication, never a partial replacement. Read/query
paths must validate current permissions and source scope again.

Public Remote readiness stays false until generated actual SSH, service
restart/SIGKILL, stale source/policy/root/peer, deletion, cancellation, MCP,
real clients and exact external SDK/packaged-app gates pass. The current
qualified delivery remains immutable 0.20.0-alpha.1 / protocol 26.

## Private implementation evidence

The private 0.21 capture proof used protocol 26 and kept every public Remote
memory gate closed. Shared file discovery/ignore validation has been extracted
from the existing Local index without changing its selection/reuse behavior.
A separate source helper and generated SSH frontend exercise capture and
current-source validation, without another remote database or public API.

The final private gate passes **18/18 in 3,466.06 ms**, including existing
Local vectors/graph/reuse/ignore/restart and legacy migration behavior.
Actual pinned SSH transfers **280 files / 36,036,000 source bytes** in
**568.61 ms**, including a subsequent host-side validation query. The largest
frame is **132,788 bytes** under a **2,097,152-byte** ceiling; the aggregate
exceeds the unchanged 32-MiB worker frame. Exact 64-MiB acceptance and rejection
of the next byte are tested separately, without creating personal data.
Both type checks and the complete build pass.

Generated coverage includes real Remote process exit after owned SSH-client
SIGKILL, cancellation, root replacement, malformed/truncated/duplicate/denied/
protected records, false final counters/digests, newly ignored sources,
UTF-8/BOM preservation and empty trees. A rejected stream remains permanently
unusable. Binding equality compares typed path/device/inode fields, not JSON
object key order. Indexed content hashes remain ordinary SHA-256; the
version-1 aggregate has its own explicit domain and ordered record metadata.
This is not SendBox provenance or snapshot-manifest encoding.

Still required: atomic profile/peer/root-bound derived cache publication and
deletion, schema-26 migration/restart, session-bound SDK/CLI/TUI/desktop,
model injection/search and internal MCP authorization, full service crash/
concurrency/policy coverage and independently installed/packaged acceptance.
These private passes alone do not make Remote repository memory available.

## Protocol-27 cache identity foundation

The subsequent development foundation adds explicit Local/Remote
`MemoryBinding` and version-1 `MemoryIndex` DTOs. Remote requires its original
peer/host/login/port/key/build and cannot claim a Local managed-worktree ID.
Root device/inode stay lossless strings. Migration 27 creates only the empty
`memory_scopes` derived-metadata table and marker, preserving old Local
vector/graph/chunk data, ciphertext, keys and original receipts.

The two identity/migration checks and all affected Local/platform/operation/
MCP/console/repository downgrade/recovery checks pass **54/54 in 8,104.12 ms**,
with both type checks and the full build. A failed marker rolls back the
new table and leaves schema-26 state usable; a successful reopen reads the
original Local vector. Legacy fixtures remove only genuinely newer tables/
markers instead of pretending a newer cache was present in an older schema.

No writer, session memory API, Remote index/query or model/MCP memory support
is enabled by this foundation. Current source is protocol/database 27; the
qualified immutable 0.20 SDK/app remain protocol 26.

## Atomic cache and production carrier foundation

The Node cache now publishes validated records, lexical vectors, graph and
typed scope metadata in one SQLite transaction. The locator binds profile/
project/workspace/env/root/actual peer/build; the Remote dataset ID also binds
lossless device/inode. Replacement removes only its prior owned dataset.
Failed metadata insertion or a final synchronous authority check rolls back
all rows, keeping the previous exact cache. No Remote root is statted Locally.
Corrupt or foreign metadata is rejected, not repaired into another owner.

Project relocation/removal and worktree removal enumerate owned metadata
scopes so Remote rows do not escape the existing derived-cache deletion path.
Other profiles' caches remain. Optional original job IDs allow truthful
post-publication partial outcomes; cached candidates/graph metadata can be
validated remotely before use. Existing project-only Local APIs retain their
reuse behavior. Graph construction has explicit 100,000-node/250,000-edge
limits rather than unbounded memory growth or silent truncation.

The production bridge now supports bounded capture/validation frames through
the existing pinned connector and tracked query shutdown. Capture has a
120-second ceiling and a 2-MiB framer; validation uses the same bounded query.
Shared awaited writes observe abort even while backpressure holds a callback.
An initial carrier edit accidentally nested methods inside the repository
reader, causing compile/loader failures; method placement was corrected and
the unchanged GitHub reader preserved. No failed run was called qualified.

The corrected memory/MCP/plan carrier gate passes **26/26 in 12,287.83 ms**.
The final combined cache/production transport/source/Local recovery/framing
gate passes **32/32 in 4,065.00 ms**, with both type checks/full build.
These cover exact metadata/vector rollback, last-moment revocation, restart,
profile-only deletion, real Remote source/ignore/deny checks, admitted/pre-abort
and held-write cancellation. Session SDK/service admission, model/context/MCP
wiring, native clients and exact 0.21 artifacts remain unfinished and blocked.
