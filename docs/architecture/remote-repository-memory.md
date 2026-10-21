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

Current 0.21 development still uses protocol 26 and keeps every public Remote
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
