# Verified repository usage attribution

## Scope and authority

Protocol/database 22 extends the same Node service, SDK, append-only encrypted
events and current dashboard. It is optional and initially unconfigured.
There is no second tracker, background GitHub polling, inferred organization
or automatic private credential lookup. The [measured prerequisite](repository-attribution-primitives.md)
qualifies strict repository identity, current SPDX/OSI metadata and the
existing Local/worktree/pinned-SSH Git readers.

Reuse Node/TypeBox/React/OpenTUI (MIT), SQLite (public domain) and the pinned
`spdx-license-list` 6.12.0 metadata (CC0-1.0). No license text is loaded or sent
to a model. The observed `publicOsiLicensed` category means **public repository
plus a detected SPDX identifier with OSI approval in that pinned dataset**.
It is not a legal/compliance review or proof of every file's license.
Missing/unknown licenses stay null. Organization status comes from the exact
GitHub repository response, never an owner-name heuristic.

## Explicit lookup

`repositories.preview(sessionId)` reads the actual selected session's upstream
with the existing safe Git reader. It sends no network request and returns
the root/environment, repository URL, lookup boundary, current observation
revision and a binding digest. Local base/worktree identity includes the
canonical path/device/inode; Remote includes its pinned peer/build/configured
root. The digest also binds current project/repository settings and policy.
Credential-bearing/unsupported origins are not guessed or sent to GitHub.

`repositories.refresh(sessionId, bindingDigest, revision, true)` rechecks that
preview and starts one cancellable capability job. A root/policy/repository or
revision change before/during lookup discards the result. Root checks occur
after awaits and immediately before retention. One scope cannot refresh or
clear concurrently. Git hooks, filters, external diffs and credential prompts
remain disabled. Cancellation reaches owned Git/SSH/network reads.

Access follows the explicit project's `repo.githubAccess` setting:

- `public` uses the control plane's bounded, redirect-denying GitHub API reader,
  without an authorization header or ambient Copilot credential. The displayed
  repository identity is sent only after confirmation. Private/internal
  responses do not silently acquire another credential.
- Local `gh-cli` uses the user's explicitly selected host CLI account and an
  exact GET endpoint. Moguri does not extract, copy or place that account's
  credential in metadata, workers, prompts or command receipts.
- Remote Git origin is read on the pinned machine, not a Local checkout.
  Public metadata lookup still occurs at the displayed control plane.
  Remote `gh-cli` metadata access is unqualified and fails explicitly rather
  than using the host-local account or another environment.

`repository.recorded` retains a typed `actor:"user"` observation or explicit
clear revision under the profile root. It captures only canonical identity,
actual owner kind/visibility, nullable recognized license evidence, dataset/
observation time, scope digest, access boundary and exact refresh job ID.
Descriptions, response bodies, credentials and credential-bearing clone URLs
are excluded. Schema-21 data/keys/grants/receipts are preserved by migration 22.
Another profile never receives these observations or attributed ledger rows.

## Immutable admission snapshots

Configured future model calls re-read the actual Git origin before admission,
including router, solver, side/subagent and compaction roles on qualified
Local/SSH transports. The captured root/record authority is checked again
synchronously at reservation. Origin or scope mismatch leaves repository
attribution unassigned; no new metadata lookup, guessed repository or ledger
backfill occurs. A read failure is logged safely and disclosed as unassigned,
not fabricated evidence. Cancellation/scope changes cannot admit a stale
model request or charge.

The all-role budget reservation embeds an immutable sanitized copy of the
observation and its ID/digest. Model-tool metrics derive from that owning
step, not today's project metadata. External Local MCP admission performs
the same check and retains its captured attribution on the owning turn.
User plan operations remain outside model tool/cost counts. No model prompt,
tool permission, output bound or budget accounting is changed.

Visibility/owner/license remain **as observed**, not real-time GitHub state.
A later explicit refresh affects new calls only. `repositories.clear` uses
the current revision and stops future attribution without rewriting historical
names, facts or charges. Session/project deletion preserves independent
observations and attributed accounting; this retention boundary is shown
before enabling/clearing the feature.

## Filtering and clients

Budget dashboard/call and tool/MCP queries share `repositoryId`,
`organization` and `visibility` (`public`, `private`, `internal`,
`open-source`) filters. Repository IDs remain stable across recorded display
names. Organization filtering requires an observed organization owner.
`open-source` selects the explicitly described public-plus-OSI category,
not every public repository. Source/date-matching attributed/unattributed
coverage is reported before repository filters, so excluded unknown history
never masquerades as zero work. Public-repository calls with absent/null/unknown
detected license evidence are counted separately before the open-source filter.

These are projection filters only. Cumulative admission, held unknowns,
estimated/provider/billed distinctions and existing charges never change.
Legacy entries remain unassigned; old names/visibility cannot be reconstructed
from today's API or a later Git remote.

SDK exposes `repositories.preview/state/refresh/clear`. CLI provides
`repository preview|state|refresh|clear|stop --session ID`, using reviewed
`--digest`, `--revision` and `--confirm-review` where required. Shared TUI
commands are `/repository preview/state`,
`/repository refresh BINDING REV confirm-lookup`,
`/repository clear REV confirm-clear` and `/repository stop JOB_ID`.
Existing `/dashboard JSON` filters work unchanged.

Desktop Dashboard adds an explicit bound-session review, exact refresh/stop,
stored metadata and clear action, plus repository/organization/visibility
filters. Opening the section does not look up GitHub. Stale profile/filter/root
responses cannot replace a newer view; actual SDK job outcomes remain visible.
Session labels reuse the same SDK display helper as the rest of the desktop.

## Failure and recovery

Stop before publication retains no observation. Stop after retention is a
partial refresh with real stored facts, never rollback or a successful job.
Failed retention publishes no observation. Restart marks interrupted jobs
partial and never repeats a lookup. Marker failure reopens unchanged schema-21
ciphertext. Exact source bindings, mismatched/credentialed origins, oversized/
malformed/redirecting responses, private access, role/tool attribution,
clear/delete/restart, profile isolation and client races have generated
coverage; native tests never authorize a personal account or call a paid model.

This does not implement a full GitHub workflow plugin, Remote authenticated
CLI transport, license compliance, routed wind-down or native Sandbox.
