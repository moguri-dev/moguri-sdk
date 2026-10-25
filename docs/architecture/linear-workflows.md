# Reviewed Linear workflows

This track adds explicit, typed Linear work to the local control plane. It does
not turn the local board into a hosted tracker, enable automatic export, or
replace the existing read-only import. Linear stays **off by default**.

## Reuse and qualification

No new runtime dependency is added. Requests use Node.js 26 built-in HTTP/fetch
and crypto (MIT), existing TypeBox 1.3.27 (MIT), the profile-scoped
`@napi-rs/keyring` 2.1.1 backend (MIT), and the existing React 19.3.1 client
(MIT). Moguri owns the bounded request/response schemas; it does not expose a
raw GraphQL proxy or copy the Linear SDK.

The parent platform change reruns the generated Phase 0 core, native-cache and
session/retention spikes before admission. The Linear primitive tests use
generated GraphQL responses, a mock vault, user-owned fixture directories and
encrypted SQLite, never a personal account or real Linear mutation. The
eight initial read/auth/pagination primitive checks passed in approximately
284 ms on this development host. This is not a Linear service performance
measurement.

Sources checked against the public official schema on 2026-10-22:

- [GraphQL endpoint, API keys and partial errors](https://linear.app/developers/graphql)
- [Pagination](https://linear.app/developers/pagination)
- [Public official schema](https://github.com/linear/linear/blob/master/packages/sdk/src/schema.graphql)

## Scope and credentials

Enable one exact team UUID in the existing project board configuration and
store its personal API key through the existing masked keychain path.
Credentials remain in that profile's explicit secret backend. The workflow
review binds a random generation identifier, never the key or its fingerprint.
Neither the key, a reflected provider error, nor an ambient token enters
events, receipts, model context or logs. Known credential text in requested issue or
project content is rejected before it can be retained or uploaded.

`ProjectIntegrations.setLinearToken(token | undefined, signal)` invalidates the
credential generation and aborts old requests **before** a keychain write or
revocation. It blocks new captures while the write is pending and invalidates
again whether the write succeeds or fails. Existing imports use the same
bounded generation-bound access. Board saves call
`invalidateLinearProject(projectId)` before changing the board; service close
also invalidates credentials. A team change never substitutes a new team into
an old operation. An observed external keychain replacement aborts old access
and requires a new review.

Full workflows bind the actual profile, Local root/device/inode, optional
session/managed workspace, board revision, enabled team, token generation,
authenticated viewer/workspace, current global policy, permission revision and
project configuration. Side/read-only sessions cannot mutate Linear or local
tickets. A policy excluding Local blocks these disclosed controller-side
connections; no SSH account, Remote host, alternative provider or OAuth login
is inferred. Authentication and user acceptance remain separate from models,
permissions and recommendations.

## Typed operations

The browser-safe protocol is `packages/protocol/src/linear-workflows.ts`.
Query and command schemas reject additional properties. Query endpoints
cannot accept a mutation or arbitrary GraphQL.

Explicit catalog reads cover teams, issue workflow states, projects, cycles,
labels, active/member identities, issues, issue comments and issue
relationships. Every page is limited to 50 entities and 2 MiB; at most five
pages may be followed in one explicit cursor chain. `limitReached` discloses
that a collection is incomplete. Cursors must have been returned for the same
profile, credential generation, team, board and collection. Cursor URLs,
repeated cursors, duplicate IDs, malformed page metadata and incomplete
required embedded collections fail closed. Exact issue reads are available
independently of collection pagination.

Supported mutation inputs:

| Action | Exact reviewed fields |
| --- | --- |
| `issue.create` / `issue.update` | Title, description, state, project, cycle, priority, estimate, assignee, complete replacement label set, parent and due date |
| `issue.move` | A workflow state in the already enabled team; not an implicit team transfer |
| `issue.archive` | Archive or restore |
| `issue.delete` | Linear's non-permanent deletion/trash API; no promised undo or permanent purge |
| `comment.create` / `comment.update` / `comment.delete` | Exact issue, comment ID when applicable, and body; edit/delete is limited to the actual viewer's own comments |
| `project.create` / `project.update` | Name, summary, content, lead, start/target dates and priority |
| `project.archive` | Archive or restore |
| `relation.create` / `relation.delete` | Exact same-team endpoints and supported `blocks`, `duplicate` or `related` type; exact relationship ID for removal |

Omitted update fields stay unchanged. Explicit `null` clears a nullable field;
an empty label list explicitly removes all labels. Invalid dates, missing
members, other-team states/cycles/parents/labels and wrong-workspace entities
are not coerced. New projects belong only to the enabled team. Shared
multi-team projects may be read or assigned to issues, but this one-team
workflow refuses to edit/archive them. It never silently changes another
team's project.

Canonical issue/project links must use the authenticated workspace on
`https://linear.app`, with no credentials or query string. Comment links may
include their bounded comment fragment. Redirects are disabled.

## One-ticket, two-way synchronization

The local ticket model remains local: type, PR link and project ownership are
not replaced by provider payloads. There is no default automatic export,
polling, webhook registration or unattended mutation.

`ticket.publish` explicitly creates one remote issue from an unlinked local
ticket and links it only after the original response and unchanged local
revision are verified. `ticket.sync` requires an already linked local ticket,
its exact revision, an explicit `pull` or `push` direction, and a reviewed
one-to-one phase/state mapping:

- Pull copies the reviewed remote title, description, mapped state and archive
  status into that exact local ticket.
- Push sends only the reviewed local title, description and mapped state to
  the exact original remote issue.

The preview retains both original snapshots, the current remote `updatedAt`,
the proposed local result and the complete mutation variables. Original
remote ID/identifier/URL provenance is verified, not replaced with another
issue. Successful synchronization advances only its linked observation
timestamp; every original snapshot stays in its independently retained
operation document.

Concurrent local edits always win. If a local revision changes before
dispatch, no mutation is sent. If it changes after a remote mutation was
dispatched, that remote result is retained but the local edit is not
overwritten and the operation is partial. A missing mapping does not guess
from phase labels, completed badges or a model's advice. Long remote titles
are rejected for local application rather than silently truncated.

**Remote concurrency limit:** Linear's official mutation inputs do not expose
an atomic `expectedUpdatedAt` condition. Moguri re-reads all reviewed remote
bases and memberships after admission immediately before dispatch and rejects
observed stale edits. This is an optimistic last-read guard, not a claim of
atomic remote compare-and-swap: another Linear client can still write between
the last read and the server applying the mutation. No custom conditional
header, webhook guarantee or provider transaction is invented.

## Exact review and independent durability

`linear.workflow.preview` performs only reads and returns the complete
`LinearPreview`. Review includes the actual account/workspace/team,
Local/profile/root/policy binding, selected entity memberships, exact fields,
local revision and all remote bases. A review ID also fixes client-assigned
UUIDs for create operations. Reviews expire after ten minutes, are bounded in
memory and become invalid across credential changes or controller restart.
Admission consumes a review; a new command ID cannot reuse it.
The SHA-256 of the canonical document is both `reviewDigest` and
`inputDigest`.

`linear.workflow.execute` requires that digest, identical input, `confirm:
true` and the controller's actual-user `finish.intent`. The shared job's start
callback atomically retains the original intent, encrypted input grant, job
and command receipt **before** effects. Dispatch itself is recorded before the
fixed mutation is sent. An original command ID with a lost response or lost
receipt returns the retained operation; it never sends a second mutation.
A changed command with that ID fails.

Protocol 58's Local native `create_issue` adapter admits only `issue.create`
through the same exact review/intent/result path. It retains `modelSource`
and `acceptance.actor: tool-grant`, never a forged actual-user acceptance.
Network-only model issue creation may coexist with its own active model-root
lease; independent Linear operations still serialize and normal user workflow
root-busy checks remain unchanged. No other mutation, credential setup,
ticket acceptance or inspection acknowledgement gains this exception.

Schema 41 adds `linear.operation_recorded` and `linearOperations`, with
`projectLinearOperation` enforcing immutable ownership, acceptance, input
digests, monotone dispatch/evidence and terminal lifecycle. Prior schema-40
events/receipts survive migration. Existing import settings stay intact;
new boards remain opted out and writes still require a separate exact review. The
operation, its input/result blob grants and all job lifecycle events use
`operation.id` as their independent retention identity. Removing the source
project/session cannot erase the original outcome or authorize replay.
Retained reads do not require the source root to still exist.

The optional session ID is also passed as actual job cancellation ownership,
separately from its retention identity. Session stop/deletion can therefore
cancel/join an owned request without deleting the independent operation or
pretending that a project-only job belongs to a session.

The result may retain a verified **remote** acknowledgement even when the
whole operation is partial; the operation/job terminal status is authoritative
for local application and complete success. A proposed local snapshot in such
a receipt is never proof that it was applied.

## Failures, cancellation and restart

- HTTP errors, GraphQL HTTP-200 errors, false `success`, malformed entities and
  incomplete required data are failures, never success-shaped fallbacks.
- Cancellation/revocation before dispatch prevents a remote mutation. A
  dispatched request with a lost response, stop, revocation, changed policy,
  stale local revision or unknown outcome is **partial**, not cancelled with
  an implied rollback.
- If a response still arrives, safe returned IDs and validated receipts are
  retained before checking cancellation/current ownership. Partial provider
  data may contribute only safe IDs, never fabricated successful entities.
- No provider response/error text is logged. Credential-reflecting content is
  redacted before parsing or retention.
- Restart recovers a dispatched running operation as partial and a definitely
  undispatched operation as cancelled. It never replays GraphQL, resumes a
  cursor automatically or upgrades unknown work to success.
- The terminal operation, optional local ticket save and job outcome are
  committed together through the shared lifecycle callback.

Moguri does not automatically compensate by deleting a created issue/comment,
undoing an edit, reauthenticating, or trying another account. A new action
requires a new explicit review.

## SDK and clients

The leaf `createLinearWorkflowApi(sdk)` is composed into `sdk.linear` beside
the backward-compatible `status`, `setToken`, `clearToken` and `import`
methods. It imports `MoguriSdk` type-only and introduces no Node runtime into
the browser-safe SDK entrypoints.

```ts
const states = await sdk.linear.catalog(projectId, "states");
const { preview } = await sdk.linear.preview({ projectId }, {
  action: "issue.update",
  issueId,
  fields: { stateId: reviewedStateId, assigneeId: null },
});

// Present preview.document and require the actual user's review first.
const admitted = await sdk.linear.accept(preview, true);
const retained = await sdk.linear.wait(admitted.id!);
// Inspect retained.operation.status; a resolved wait is not a success claim.
```

Other SDK methods are `issue`, `execute`, `cancel`, `read` and `history`.
`linear.workflow.read` and `linear.workflow.list` are independent retained
reads. `linear.workflow.catalog`, `.issue` and `.preview` are explicit
network reads. Only `.execute` can dispatch the selected typed mutation or
apply the reviewed one-ticket pull.

`LinearWorkflowPanel` takes `{sdk, project, session?, snapshot}`. Its catalog
reads are button-triggered, optional update fields are individually selected,
pull/push is explicit, and the complete review is visible before its separate
acceptance checkbox/button. It never renders provider HTML or starts OAuth.
TUI/CLI use the same SDK command/query families rather than client-owned
Linear state.

## Generated checks

`node --import tsx --test tests/linear-workflows*.test.ts` covers catalog and
all mutation paths, exact optional field clearing, mappings, original
provenance, local/remote conflicts, membership, opt-out, credential/team
revocation races, partial HTTP-200 errors, malformed/cyclic pagination,
pre/post-dispatch cancellation, late receipts, receipt loss/duplicate delivery,
schema-40 restart recovery and independent retention after source removal.

Full live OAuth, personal API permissions, API rate limits, remote atomic
concurrency and production Linear availability are not qualified by generated
fixtures. No personal authentication or real Linear write was performed.

### Local result, 2026-10-22

All 29 Linear checks and the five existing board/import compatibility checks
pass together (34 checks, approximately 2.22 seconds on generated fixtures).
They include real authenticated local HTTP/event transport between two SDK
clients, exact session-owned cancellation/join during deletion, late receipts,
and a rendered opt-out desktop panel. The root and TUI TypeScript projects
also pass. A compatibility regression that initially classified an aborted
old import as failed was corrected by preserving a sanitized actual abort
signal; the existing import cancellation check passes unchanged.

These focused results do not claim a production Linear connection, a live
OAuth flow, a complete first milestone, or a packaged Electron release.
