# Authoritative Remote MCP

The 0.18 development source introduces **protocol/database 24 foundations** for
Remote MCP, following the measured
[real-SSH prerequisite](remote-mcp-primitives.md). The latest independently
qualified delivery remains 0.17. Scoped Remote MCP discovery now runs over SSH
after an explicit grant. Tool calls are still blocked until the worker/
lifecycle/client integration below is qualified; a saved grant is not a claim
that a tool operation ran.

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
