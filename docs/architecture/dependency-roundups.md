# Dependency update roundups

Protocol 119 delivers [#8](https://github.com/mbianchidev/moguri/issues/8): a
read-only, model-free roundup of open dependency and security update PRs from
Dependabot, Renovate and any other configured update bot. The decision record
is [D66](decisions.md#d66-dependency-update-roundups-over-my-work). Roundups
are a view over [My Work](my-work.md)'s retained observations, not a second
GitHub reader. This is unrelated to the npm/pnpm
[dependency cache](dependency-cache-scopes.md).

## Change contract

- **Reused, no new dependency.** Node.js 26, TypeBox (MIT), React, Electron,
  OpenTUI, the GitHub CLI (MIT) through the existing My Work reader, the
  existing event store, intake timer and #6 schedule math.
- **Invariants.** Only explicitly selected My Work sources are read. A run owns
  exactly the one refresh admitted with it. No model call, write, install,
  push, rebase or merge. Security notes are provider (PR) data only.
- **Events and schema.** `dependency_roundup.recorded`,
  `dependency_roundup.run_recorded`, optional `MyWorkRefresh.trigger` with
  `actor: "schedule"`, marker `dependency_roundups_schema`. Pre-119 stores
  with any of them are refused; migration only inserts the marker.
- **Cross-client.** Service-owned commands/queries through the SDK; desktop,
  TUI and CLI use the same API and snapshot.
- **Failure and cancellation.** Source failures, rate limits and partial reads
  stay visible; stopping a run stops only its own readers; restart never
  replays a read.

## Configuration

The profile has one roundup configuration (`RoundupSettings`, id
`dependency-roundup`) changed only by actual-user commands:

| Field | Meaning |
| --- | --- |
| `sourceIds` | 1 to 100 explicitly chosen My Work sources (reviewed repository, account and Local root bindings). Configuration refuses a source that is missing or disabled. |
| `bots` | 1 to 50 distinct GitHub logins of update bots, compared case-insensitively. Default `dependabot[bot]`, `renovate[bot]`. GraphQL logins without `[bot]` also match. |
| `schedule`, `status` | Optional `once`, `interval`, `daily` or `weekly` schedule from [automations](automations.md) and the **On schedule** switch (`active`/`paused`). |
| `anchorAt`, `nextAt` | The interval anchor and next occurrence while active. Timers only advance `nextAt`. |
| `commandId`, `commandDigest` | The actual-user command behind the current revision; for scheduled runs this is the activation that authorizes them. |

## Runs

A `RoundupRun` records its trigger (`manual` or `schedule`), occurrence and
missed count, the selected sources, the owned `refreshId`, its status and a
summary (updates, groups, reported security, likely breaking, failing checks,
closed).

- **Manual.** `dependency_roundup.refresh` admits a new My Work refresh, its
  job and receipt and the `running` run in one transaction
  (`MyWorkRuntime.admitOwned`). If any My Work refresh is already running the
  roundup is refused and records nothing; it never adopts that reader.
- **Scheduled.** The shared intake timer fires once for the latest due
  occurrence, counts missed ones and skips an occurrence while a roundup is
  still running (a `skipped` run), with D50's DST rules. The run is committed
  `starting` with the settings advance, then admitted with a synthesized
  `dependency-roundup-run-<id>` command. Its refresh records
  `actor: "schedule"` and `trigger` with the run, settings revision and
  activation command, so a timer is never shown as a user. Changed settings,
  disabled sources, a busy reader or an uninspected partial reader record a
  `blocked` run with the reason.
- **Outcome.** When the owned refresh records a terminal status, the same
  transaction settles the run: `completed` (with summary), `partial`,
  `failed` or `cancelled`, keeping the refresh diagnostic.
- **Stop.** `dependency_roundup.cancel` cancels only the owned refresh's job
  through the existing job cancellation. The run says that no other refresh,
  CI watch or external operation was stopped.
- **Restart.** A `starting` run never admitted its refresh, so it becomes
  `blocked` with nothing read. A running refresh is terminalized by the
  existing My Work recovery and the run follows it. Nothing is replayed.

## The roundup view

`dependency_roundup.query` reads retained observations only (no GitHub or
model call) and returns updates, groups and source states.

- **Updates.** One entry per canonical PR (`myWorkItemId`) authored by a
  configured bot, with every source/account association and its retained
  refresh and observation digest, PR state, draft flag, head, freshness,
  conflicting-source flag, CI state, review decision and unresolved threads.
  Reruns and restarts never create duplicate entries because entries are
  derived from canonical PR identity.
- **Parsing.** `parseDependencyUpdate` reads the PR's own text: Dependabot
  single and grouped titles and `Updates \`x\` from a to b` lines, Renovate
  `Update dependency x to vY` titles and change tables, the Dependabot branch
  ecosystem and Renovate diff datasources. Unparsed bot PRs stay visible as
  their own group.
- **Security.** Only what the PR reports: labels such as `security`, a
  `[SECURITY]` title and GHSA/CVE IDs with their links in the body. A PR
  without them shows "No advisory information in this PR", which is not a
  statement that a package is secure.
- **Likely breaking.** A deterministic heuristic, labelled as such: a major
  version, a minor version below 1.0, a `major`/`breaking` label or "BREAKING
  CHANGE" text in the PR.
- **Groups.** By package and ecosystem; names fold case only where the
  ecosystem does (npm, pip with PEP 503 separators, GitHub Actions and others),
  never for Go modules or Maven coordinates. A PR touching several packages
  appears in each group by its identity. Groups sort by reported security,
  likely breaking, failing checks and size.
- **Sources and completeness.** Each selected source reports `failed`,
  `partial`, `stale`, `unobserved`, `disabled` or `missing` from its retained
  My Work state, with the verbatim diagnostic (HTTP status, account mismatch or
  the explicit `github_rate_limited` message). `complete` is true only when
  every selected source is fresh and complete; otherwise clients warn that
  updates may be missing.
- **Filters.** PR state (open by default), reported security, likely
  breaking, ecosystem, repository and text. Responses over 8 MiB fail
  explicitly instead of truncating.

## Follow-up

Nothing in a roundup acts on a PR. **Open in My Work** selects the exact PR in
the My Work inbox, whose existing reviewed follow-up creates only an idle,
source-bound chat. Installing, lifecycle scripts, pushing, rebasing and
merging stay separately authorized work in a chat, under its actual Env.

## Clients

| Client | Surface |
| --- | --- |
| SDK | `sdk.roundups.settings/runs/configure/setSchedule/refresh/cancel/query/run/wait`; `roundupSummary` and `roundupsSlash`. Snapshot fields `dependencyRoundup` and `dependencyRoundupRuns`. |
| Desktop | Dashboard **Dependencies** page: setup with explicit source checkboxes, bot logins and schedule (explicit Save), **On schedule** switch (saves immediately), **Refresh roundup**, **Stop**, source problems, filters, groups with security/breaking/failing marks, **Open on GitHub** and **Open in My Work**. |
| TUI and slash | `/roundups [show [FILTERS_JSON]|status|refresh|stop RUN_ID|configure SOURCE_IDS [BOTS]|schedule on|off]` in every client; desktop `/roundups` opens the page. |
| CLI | `moguri roundups [show] [--filters JSON] [--json] | status | refresh | wait RUN_ID | stop RUN_ID | configure SOURCE_IDS [BOTS] | schedule on|off | schedule set SCHEDULE_FILE`. |

## Evidence

`tests/dependency-roundups.test.ts` uses the generated My Work fixture with
Dependabot, Renovate, an unconfigured bot and a human author across two
accounts and a duplicate source: parsing and grouping, immutable run
lifecycle, grouping without duplicates across reruns, configuration changes
without new reads, closed PRs, read-only calls, rate limits, revoked access,
disabled sources, refusal to adopt another reader, cancellation, and scheduled
runs with schedule provenance, overlap skips and pausing.
`tests/personas.test.ts` covers restart blocking of a `starting` run and the
protocol 119 migration. `tests/e2e/dependency-roundups.spec.ts` drives the
hidden desktop setup, refresh, grouping and **Open in My Work**.

## Limitations

- Advisory details come only from PR text; Moguri does not read the
  Dependabot alerts API or any advisory database.
- Scheduled roundups need the Moguri service running, like automations.
- Roundup runs raise no Inbox entries; the Dependencies page shows the latest
  run.
