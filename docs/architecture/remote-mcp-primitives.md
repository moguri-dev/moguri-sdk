# Host-originated Remote MCP prerequisites

The protocol-23 application still blocks Remote MCP discovery/execution and
repository-memory tools. This document records a **private generated
prerequisite**, not an enabled environment, new public permission or credential
grant. Qualified 0.17 artifacts are unchanged; the development manifest is 0.18.

## Reused boundary and libraries

Reuse the existing pinned OpenSSH transport and actual Remote supervisor,
encrypted frame replay, exact command/schema identity and owned MCP connector.
Node and the MCP TypeScript SDK are MIT-licensed, OpenSSH is BSD-licensed and
Ajv is MIT-licensed. No dependency, provider request, integration account,
unverified SSH executable, system daemon change or native VM is introduced.

The Local gateway's existing connector lifetime is extracted to
`mcp-process.ts`, retaining bounded Node memory, exact owned process-group
stop/escalation, result-before-exit validation, deadlines and no retries. Both
Local execution and the private Remote worker use that same implementation.
An optional synchronous process observer can retain actual ownership before
connector dispatch; failure/stop there never sends the request.

The private worker is deliberately **not** the public agent worker. It runs
one exact MCP operation through the real Remote supervisor and requests exact
authorization before the shared MCP connector. Its helper digest must match
the actual bytes before launch. The parent retains each real frame before its
acknowledgement, using the existing encrypted append-only authority.
The fixture's synthetic operation carrier/authorization fields are not a new
application wire contract or model instruction.

## Credentials and provenance

Forwarding is denied by default. The private proof forwards only a generated
access token after its explicit fixture grant. It does not obtain or infer a
user choice, real credential grant, OAuth refresh token or remote secret store.
The token goes through the existing non-journaled controller-reply channel,
not argv, an input context, events, replay or a model.

The test HTTP server deliberately echoes the active generated credential.
The actual MCP worker redacts it before result retention. No implicit Local
key lookup or anonymous fallback is used for an authenticated request.
Actual application token forwarding, when implemented, still needs an explicit
revocable resource/peer/profile-bound user grant; selecting Remote alone
cannot authorize it.

Stdio discovery/calls use the approved Remote cwd and read a unique Remote
marker, not a different Local counterpart. The external stdio server reports
its actual PID/parent/root. A held real HTTP call permits a read-only check of
the observed connector's actual parent PID, which matches the SSH worker
rather than the Local controller. These are actual generated loopback SSH
processes, not proof of an external Linux host or SendBox isolation.

## Measured result

The first combined Local/OAuth/Remote run passes **24 checks in 77,743.25 ms**.
Its Remote prerequisite subset is then isolated with process-admission
coverage:

`node --import tsx --test --test-concurrency=1 tests/mcp-process.test.ts tests/remote-mcp-primitives.test.ts`

passes **13 checks in 11,729.92 ms** on macOS arm64/Node 26.11.1: ten real SSH
MCP cases and three exact connector admission/cleanup cases. Type checks pass.
The combined duration is not presented as the isolated SSH measurement.
After building the 0.18 development source, the combined Local gateway/OAuth
and final prerequisite gate passes **28/28 checks in 77,166.05 ms**. This is
not full application, native client or delivered-archive qualification.

- Actual Remote internal discovery/grep reads the selected Remote bytes and
  leaves the Local marker unchanged, with no model boundary/request.
- A real stdio MCP executes under the observed connector PID and Remote cwd.
- Missing explicit credential forwarding creates neither a connector nor an
  HTTP request. Explicit generated access is authenticated and redacted.
- A changed current server/schema digest produces no tool effect under an old
  discovered digest. Unknown completion is not repaired by a retry.
- Stop before authorization launches no connector or network operation.
  Stop during an already-observed HTTP effect remains partial; actual owned
  connector cleanup is checked, never claimed as external rollback.
- Losing the SSH result acknowledgement retains one encrypted inspectable
  result. Starting the same run identity is rejected before another worker or
  tool effect; the effect counter stays exactly one.
- Changed MCP helper bytes or SSH host key prevent dispatch. No alternate
  helper, re-pinning, ambient SSH identity or Local fallback is used.
- Already-cancelled admission, a failed process-ownership observer and stop
  before request dispatch leave no connector marker or live owned child.

All model-request counters stay zero. No personal keychain, account, browser
authorization, paid inference, microphone, model weight or Sandbox probe is
used. Teardown removes only generated owned resources after exact closure.
Detached/reparented descendant containment remains unproven.

## Application integration still required

The proof does not enable Remote MCP or change durable schemas. Before exposure:

- Define versioned public/private operation and credential-grant contracts,
  migration/rollback and restart recovery, binding actual target/root/helper,
  session/profile, server/resource/schema, policy and approval revisions.
- Wire both actual model tool calls and external SDK/gateway attempts through
  the existing Remote worker, authoritative writer leases and sanitized outcome
  ledger. Discovery, actual calls and retained-result reads must not double count.
- Recheck authority/credential grants after awaits, refuse stale Remote
  catalogs/Local paths and preserve actual actor, cancellation and uncertain
  side effects. Human intervention and hard denial win races.
- Keep refresh credentials in their explicit backend. Pin/revoke access-token
  forwarding separately; never silently use a Local account or remote ambient
  secret under a different identity.
- Integrate bounded results/artifacts, owned cancellation and no-replay late
  reconciliation with both clients and exact packed SDK/native binaries.
- Keep unsupported Remote scripts, repository memory and transports explicit.
  A successful generated proof does not transfer a Local script, install a
  server, enable a marketplace or complete the broader first milestone.
