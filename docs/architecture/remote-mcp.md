# Authoritative Remote MCP

The 0.18 development source introduces **protocol/database 24 foundations** for
Remote MCP, following the measured
[real-SSH prerequisite](remote-mcp-primitives.md). The latest independently
qualified delivery remains 0.17. Scoped discovery and exact approved model or
provider-free external calls now run over SSH after an explicit grant. CLI, actual OpenTUI
and factory-dark desktop share review/revoke/operation APIs.
The exact 0.18.0-alpha.2 SDK and actual bundled macOS application are
independently qualified. This remains a development alpha, not the completed
first milestone; a saved grant is not a claim that a tool operation ran.
Exact archive identities and qualification are recorded in setup.

Reuse the existing Node/MCP SDK (MIT), OpenSSH transport (BSD), private worker,
owned connector, exact tool approvals, all-role accounting and encrypted
append-only service authority. No new dependency or agent loop is introduced.
SSH is the actual boundary, not SendBox process isolation or folder containment.
Sandbox work remains paused.

## Explicit grants

Old Remote targets remain valid without `mcpGrants`; missing means **deny**, not
permission inherited from Copilot, Local MCP or environment selection.
Each optional target grant binds a server ID to the actual host/key/port/login
digest and exact transport resource digest, with an independent
`forwardAccess` flag. Display names/aliases are not credential boundaries.
Changing the real peer or resource invalidates a grant.

`mcp.remote.preview` reads no credential and calls no provider/server. It shows
the selected Remote project/root, host identity, exact resource/auth method,
settings/project/policy/permission revisions and a reviewed digest.
`mcp.remote.grant` requires that exact digest, observed settings revision and
explicit review. It cannot turn a no-auth resource into a meaningful credential
grant. Concurrent or stale edits fail instead of overwriting another client.
Grant updates invalidate outstanding approvals like other permission changes.

`mcp.remote.revoke` is available even when SSH is unready or Remote is excluded
by policy. Removing authority must not require a successful network probe or
access token. Existing started effects cannot be rolled back by revocation.

The SDK exposes `remotePreview`, `grantRemote`, `revokeRemote`, `remoteCalls`
and `remoteCall` under `sdk.mcp`. These APIs are user controls, not outward MCP
tools or model self-approval. A real forwarding grant is required before any
Local profile access token can cross the pinned SSH connection. Refresh
credentials remain in their explicit backend. A bearer value may be a
long-lived API key, and SSH transport does not prevent the remote host from
retaining access it receives. No real grant was inferred from
the implementation conversation or generated tests.
The shared `mcp.servers` metadata query labels Remote resources as configured,
review-required, access-required or unready. Neither model nor outward gateway
can advertise an ungranted resource as connected/approved, or use metadata
listing to read a credential. Actual tool/schema discovery is a separate call.

## Durable execution identity

The new `mcp.remote_recorded` event is owned by its exact
profile/session/project/turn/step. It records the actual model/external actor,
original command identity where applicable, peer/resource/root/helper scope,
phase/status, result digest and whether access was actually forwarded.
It contains no token, raw credential hash or secret-store copy.
Observed access forwarding is true/false; an attempted send without a worker
receipt can remain null/unknown, never falsely counted as no transfer.

Initial intent must precede execution. Revisions cannot change original
identity, downgrade recorded forwarding, replace a retained result or switch
an observed job/execution. Unknown or corrupt scope is an explicit recovery
error, never another helper, host, user answer or approval.
Migration 24 adds its version marker without rewriting schema-23 ciphertext,
keys, terminal ownership, receipts or historical charges. Marker failure rolls
back and reopening preserves the exact prior state.
The version-1 `moguri-remote-mcp-intent` content binds the complete typed scope,
call, server, helper/schema digests and required access method. Both intent and
result blobs are encrypted into the owning session's retention compartment in
the same transaction as their referencing event. A process-local pending blob
is not durable evidence. Session deletion removes those content grants.

## Integration boundary

The operational slice must run MCP in the existing owned Remote worker, not
delegate a tool to a Local filesystem/process. Stdio uses the actual Remote
cwd/argv; HTTP originates there. Exact approval, current resource/schema/helper
and authority must be rechecked after awaits and before credentials/effects.
The original actor, writer lease and tool identity cover both model and
external SDK callers. Discovery, actual MCP calls and result reads stay distinct
for operational metrics.

Actual result retention precedes acknowledgement. Lost control/acknowledgement,
restart, partial cancellation and late results must remain inspectable without
another effect or a falsely successful turn. Expired/revoked grants cannot
authorize retries or move an existing result to a new root. Unknown external
side effects are not zero work or proven rollback.
External admission atomically retains its original command, waiting approval,
job, turn and MCP intent. Replaying a receipted command returns its old job;
a lost command receipt still cannot launch that original intent again.
Pending approvals lease the actual peer/root across profile and target aliases.
Only the owned worker's terminal result plus confirmed worker cleanup can
settle an external job successfully. Stop after access/dispatch stays partial.
Explicit late-result reconciliation validates the original intent/approval and
private frame without reading a new access token or needing a current grant.
It can improve the retained evidence but never promote the original partial
turn to success.

Until separately qualified, Remote repository-memory tools, transferred Local
scripts and other extension transports remain unavailable. Read-only sessions
cannot gain execution through MCP annotations. No model can authenticate,
change a target grant, answer a user-only question or widen policy.

## Foundation checks

Seven generated grant/state checks pass in **1,623.93 ms**, with both type
checks. They cover exact peer/resource binding, deny-by-default old settings,
real-SSH no-model/no-credential preview, stale/concurrent writes, revocation
under excluded policy, immutable result/provenance and schema-24 rollback.
The prerequisite separately covers actual connectors, cancellation and
lost-result no-replay. Full public worker execution, cross-client and exact
archive qualification are not implied by these foundation checks.

The current four real-SSH discovery checks pass in **4,504.71 ms**: actual
scoped catalogs never use the Local gateway, generated OAuth sends only
separately granted access (never refresh), stale held responses are rejected,
and shutdown stops the owned Remote stdio server even when it ignores TERM.
Initial failures exposed a relative source-loader cwd assumption and an
unhandled new query-result kind. Source loading now resolves its own package
loader absolutely, and the explicit response variant is handled; no retry,
permission relaxation or Local fallback repaired either failure.

Four executor/actual-worker checks and existing plan/migration checks pass
**10/10 in 3,029.45 ms**. The executor validates exact call/root/env/step/args,
helper bytes and auth method before a connector, returns actual bounded data
after child closure and supports one provider-free owned worker operation.
These checks are not a substitute for public controller result/ACK/restart
integration or delivered-client acceptance.

The new controller checks exercise actual approved model calls and
provider-free external calls, stale catalogs, failed result retention, lost
original command receipts, denial/cancellation and actual held-connector group
cleanup. Real service SIGKILL coverage now inspects both pre-authorization and
post-effect/pre-result-ACK executions after restart, including reconciliation
after grant revocation. This exposed and fixed missing MCP content-retention
bindings: preserving a digest alone did not persist its process-local blob.
Cross-profile pending approvals also serialize the same pinned root even when
target aliases and remote runtime directories differ. Exact-archive acceptance
remains required.

The combined controller/state gate passes **14/14 in 11,822.65 ms**, with both
type checks. It includes actual access-only OAuth execution and proof that
retained private frames/results contain neither generated access nor refresh
values, plus revocation during an awaited access read. These are generated
same-host SSH fixtures, not real account consent or proof of every remote OS.

The related Local/Remote/connector gate passes **45/45 in 13,540.01 ms**.
The shared CLI command gate and discovery checks pass **5/5 in 5,033.57 ms**;
actual OpenTUI review/grant/list/revoke passes in **908.07 ms**. Two hidden
desktop workflows pass in **6.3 s**, including an actual separately approved
no-model SSH call, offline revocation/retained reads, stale held-review
rejection and initially unchecked authenticated forwarding. The first stale
UI assertion released its response before the second renderer had observed
the settings update; its safe stale-review warning was retained. The harness
now waits for that actual committed renderer state, not a sleep or weakened
permission guard. Both bounded desktop/compact visual rounds are complete.
Model and external failed-result-ACK reconciliation additionally pass
**10/10 in 13,603.17 ms**, retaining the exact late result without another
model step, tool effect, attempt or promotion of the partial turn/job.

The complete source suite passes **519/519 in 330.19 s**, and all **35 hidden
desktop workflows pass in 1.2 min**. Both type checks and the source audit
pass with zero vulnerabilities. These are source/build checks, not an
independent installed SDK or actual packaged-runtime qualification. Existing
OpenTUI experimental FFI and Ghostty chunk-size warnings are retained.

The exact alpha.1 SDK and actual bundled application subsequently pass
independent installation/types/runtime and 35 packaged desktop workflows,
including actual granted no-model SSH MCP. A cross-surface copy check then
found an obsolete Remote SSH settings sentence claiming MCP unavailable.
Alpha.2 corrects that sentence with a native regression assertion; alpha.1
archives are retained unchanged. See setup for both exact identities and the
corrected build's qualification. No extra permission or transport was introduced.

Alpha.2's exact SDK passes fresh explicit script approval/install/rebuild,
zero-vulnerability audit, all four external type entrypoints and actual
installed no-model SSH MCP/CLI/TUI/root/result/cleanup/revocation flows.
All **35 desktop workflows pass on the actual packaged application in 1.2 min**,
with corrected capability guidance. Actual bundled Node/worker/MCP and native
assets/signature/DMG integrity pass. Its Electron-only/combined memory
measurements remain separately reported in setup; no whole-runtime 600-MiB
claim or production notarization is implied. These artifacts are immutable.
