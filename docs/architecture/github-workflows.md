# Reviewed Git and GitHub workflows

This is an executable, user-reviewed workflow surface, not model-owned Git
permission and not the completion of the wider first-release roadmap.

Protocol 61 adds [repository and session entry points](session-github-workflows.md):
explicit controller-account repository discovery, project-specific PR/issue
pickers, complete detail views, reviewed creation and source-bound idle session
starts. These reuse the write lifecycle below rather than another GitHub
client. Project-free catalogue reads claim no project filesystem authority;
Copilot login and private updater credentials stay separate.

Protocol95's [unified My Work inbox](my-work.md) reuses this actual CLI/account/
root ownership, exact-head CI collection/diagnostics, retained watches and
attention lifecycle. Sources are explicitly reviewed, refresh owns one
read-only capability job, and opening an item never starts polling or grants
permission. Original account/head/source observations survive partial reads
and restart without replay; no scheduler or second GitHub transport is added.

## Reuse and qualification

- Node.js 26 standard-library process, crypto, filesystem and timer primitives
  (MIT) own bounded execution, hashing and cancellation.
- Git is invoked through its installed CLI (GPL-2.0); Moguri does not fork Git,
  implement a Git transport or bypass user Git configuration/hooks.
- GitHub CLI `gh` (MIT) owns GitHub authentication and HTTP transport. There is
  no token scraping, token forwarding, account switching, personal-login
  automation, alternate API host or added dependency.
- Existing TypeBox (MIT), React (MIT), the shared SDK, append-only EventStore
  and capability-job lifecycle provide validation and cross-client state.

The Phase 0 generated core/cache/session qualification precedes this track.
`tests/github-workflows.test.ts` uses only generated checkouts, local bare
remotes and injected generated GitHub responses. It does not push this
repository, run personal authorization, contact a GitHub account or create
real issues, reviews, releases or merges.

## Authority and containment

Every project operation selects `{ env: "Local", projectId, workspaceId?, sessionId? }`.
The service resolves the exact managed root through `WorkflowHost.project`
and `assertRoot`, including canonical path/device/inode. Missing workspaces
never fall back to the base project. A supplied session must still own that
exact project/workspace and be explicitly Local. Side/read-only sessions
cannot mutate either Git or GitHub.

Protocol 58's Local native `create_issue` adapter reuses this exact preview/
intent/receipt path for `github.issue.create` only. The approved current
model's source is retained as `actor: model`, not user acceptance. It cannot
authenticate, switch account, write Git/PRs or acknowledge inspection. Its
controller-derived intent remains bound to the original turn/step/call; a lost
response returns partial evidence and never triggers another API request.

Global allowed-env policy, project closing, current permission rules and
project configuration are checked before review and immediately before
effects. A user confirmation does not override a hard denial. The review
binds the entire relevant policy/configuration/session digest; changes require
a fresh review.

Native Local Git hooks, credential helpers, SSH transport and `gh` are **not**
a qualified SendBox descendant-containment boundary. Denied/read-only
project-folder restrictions cannot be enforced by arbitrary native hooks:
affected operations fail closed rather than claim containment. These
workflows do not run on an SSH machine, inherit an SSH identity, change the
selected execution environment or fall back from Remote/Sandbox to Local.

Git writes serialize through the real root's shared service writer lease,
not a client-owned mutex. The service includes running `git.*` jobs when
checking other root writers. CI/API-only jobs do not claim a filesystem
writer. Native user programs remain external writers: Git's own
locks/leases and final verification are additional safeguards, not an
assertion that all external writers can be prevented.

Partial Git jobs quarantine their captured source root. Ordinary Git writes
cannot bypass that quarantine. A separately reviewed exact in-progress rebase
continue/abort remains available, but does not clear that quarantine, erase
unrelated uncertainty or implicitly resume source work.

`githubRootQuarantined(snapshot, root)` is a pure check over independently
retained `partial` `git.*` records at that exact canonical root, without
filtering by project/workspace/profile aliases or resolving a deleted
project. The parent aggregates this hold across controller/profile views.
Only an actual-user `github.acknowledge` command, bound to the operation ID,
observed revision and original input digest, can add its one immutable
`inspection` record. That record retains actor, timestamp and canonical
inspection-command identity. It does not change original scope, status,
diagnostic, result or job: the operation remains **partial**. Inspection is
**not cleanup proof or success**, does not grant a source root, send a signal,
infer PID ownership, replay or resume work, or clear another operation's
uncertainty. It remains available after source deletion.

The writer-host `permitRebaseRecovery` exception is requested only for
explicit continue/abort when every visible uninspected hold at that root is a
same-profile rebase with an actual retained typed `conflicts` result and
matching original/onto commits and root identity. The parent must still
block active writers, foreign-profile holds and unrelated unknown effects.
Successful continuation/abort never acknowledges those retained holds.

## Typed API and exact review

`packages/protocol/src/github-workflows.ts` owns:

- `GithubActionSchema`: a finite union of Git and GitHub actions;
- `GithubCommandSchema`: `github.execute` with the exact action/scope,
  `expectedDigest`, `confirm: true` and all original explicit confirmations;
- `GithubQuerySchema`: `github.preview`, `github.browse`, `github.read` and
  bounded `github.history`;
- `GithubOperation`, `GithubOperationResult` and
  `projectGithubOperation(previous, next)`.

There is no shell text, raw force option, arbitrary HTTP endpoint, arbitrary
GraphQL editor or arbitrary JSON command execution surface. String fields use
CLI argument arrays; GitHub string bodies are raw fields, never `@file`
expansion. Ref names reject options, refspecs, revision expressions, unsafe
components, competing branch/tag names and abbreviated/symbolic `HEAD` targets.
Remote names must name one configured push destination. Captured URLs reject embedded credentials,
custom transport helpers, query/fragment credentials and unsafe SSH paths.

The exact review includes:

- canonical root identity, profile, original scope and policy digest;
- current HEAD/branch/common directory and raw index digest;
- worktree/index/status digests and bounded actual status;
- actual in-progress rebase metadata and original/onto commits;
- expanded push URL, exact remote ref and SHA or exact absence;
- exact target object, authenticated GitHub login/numeric identity;
- original credential-free remote-resource content/digest and ETag when supplied;
- risk-specific confirmations for main/protected pushes, force leases,
  rebase, tag deletion, exact-head PR merge and release publication.

All confirmations must match the review in their original order. No model
output, read acknowledgement or checkbox from an earlier scope counts.

## Git operations

The protocol-81 built-in follow-up reuses this reviewed pipeline for bounded
`git_read` and `git_write` native agent tools, SDK calls and ordinary queued
`/git` commands. It must not manufacture shell scripts for covered operations.
The installed Git CLI and existing Node/TypeBox/React/SQLite licenses above
are unchanged; no Git implementation or dependency is added. The measured
prerequisites are recorded in [session reliability](session-reliability.md).

The actual user selected **a new revert commit preserving history** for
"roll back to the previous commit". There is no implicit reset, clean, force
rename, checkout overwrite, stash, branch deletion or history rewrite.
Creation/rename/push bind the exact current branch, HEAD, index, common Git
directory, canonical root and destination ref/absence. Integration and staged
commit operations require appropriate clean/in-progress state and retain
truthful conflicts/partial effects without automatic abort or replay.

Agent mutations need the original actual approved model turn/step/call and
current policy, not a model's `confirm` field. Their independent operation
retains model provenance rather than impersonating user acceptance.
The model's existing root ownership is handed to the exact Git job only;
other writers and unknown outcomes still block. Unsupported Remote, Sandbox,
project-free and captured-group transports cannot use the Local pipeline.
SDK/client user reviews remain explicit. Per-operation cancellation propagates
to the retained job and records real failed/partial outcomes across restart.

Managed branch rename also binds the original workspace revision/change set.
After actual Git verification, its tagged `workspace.saved`, matching change-set
name, completed Git record and job result commit atomically. Root identity,
base commit and staged/dirty bytes are unchanged. Git read helpers suppress
both optional index locks and `diff.autoRefreshIndex`; a read must not rewrite
an unprimed managed index. Active fixed-branch Kanban tasks cannot be renamed.
Switching a managed root or creating-and-checking-out another branch is refused
before effects: create without checkout or create a separate managed worktree
instead of silently moving an existing conversation/change set.

A failed managed metadata acknowledgement retains the actual renamed ref and
original complete Git result as **partial**, with old metadata preserved.
After the actual user separately acknowledges that exact operation's inspection,
`workspace.reconcile` may repair only that original workspace revision using
matching root/common directory, HEAD, raw index and file state. It performs no
Git rename, keeps the operation partial and does not resume a queue. Old reports
cannot be reused after another metadata revision or external branch change.

Generated tests must prove local bare-remote publication, new branch
creation/rename, history-preserving revert, unchanged unrelated staged/dirty
work, stale HEAD/index/root/ref rejection, hard denials, exact approval and
writer ownership, conflicts, stop/lost acknowledgements, migration/reopen and
headless actual model-tool execution. Hidden desktop/TUI and packed SDK
coverage must exercise these same APIs, not replacement client commands.

| Action | Behavior |
| --- | --- |
| `git.branch.create` | Create one absent local branch at the exact resolved start. Optional checkout requires a clean source; a later failed switch preserves the created branch as partial work. |
| `git.branch.rename` | Rename only the captured current branch to an absent name. Preserve HEAD/index/dirty bytes; protected names require their own confirmation. |
| `git.switch` | Switch to one existing local branch on a clean source, without remote guessing or ignored-file overwrite. |
| `git.stage` / `git.unstage` | Explicit canonical files only. Pin their bytes/modes and unaffected index; never stage a directory or reset working files. Filters/text normalization are not approximated. |
| `git.commit` | Commit only selected staged paths with a private index and normal Git hooks. Preserve the actual index, unrelated staged work and partially staged working bytes; reverify the committed tree/parent. |
| `git.revert` | Create a new commit whose tree exactly matches the current single-parent commit's parent. Require a clean source; never move HEAD back or guess a merge mainline. |
| `git.push` | Push the captured HEAD SHA to one explicit destination using its exact SHA/absence lease. A normal push also requires locally proven fast-forward ancestry. Main/master/configured-main require a separate exact confirmation. |
| `git.push` with `forceWithLease` | Separately permit non-fast-forward replacement only at the captured lease. Never raw `--force`, implicit refreshed leases or automatic retries. |
| `git.rebase`, `mode: start` | Require a clean committed current branch and no existing integration operation; resolve and pin the onto commit. No automatic stash or updates to other branches. |
| `git.rebase`, `mode: continue` | Require the exact retained in-progress rebase and explicitly resolved/staged conflict entries. One continued step can expose another conflict. |
| `git.rebase`, `mode: abort` | Separately review the current rebase/index/worktree. Git abort deliberately discards the displayed in-progress resolution and restores its original state. |
| `git.tag.create` | Create one new lightweight or annotated local tag at the captured commit; never overwrite an existing tag. Annotated messages are explicit. |
| `git.tag.push` | Push the captured local tag object, including annotation, to one destination. A different existing remote tag is refused. |
| `git.tag.delete` | Explicitly select local or remote deletion. Local deletion compares the expected old object; remote deletion uses the exact captured lease. |

Push invokes normal user configuration, hooks and credential helpers. It
does not suppress hooks, force mirror behavior, follow extra tags, recurse
into submodules or auto-delete branches. No interactive prompt/editor is
opened; unavailable required signing/authentication fails visibly.

Before rebase starts, both original and onto commits are retained as
`refs/moguri/rebase/<operationId>/original` and `.../onto`. These are not
branches and are not automatically deleted. A conflict is a **partial**
operation with retained actual index/worktree and original result, never a
successful rebase. No conflict reset, automatic abort, automatic resolution
or continuation is performed.

## GitHub application workflows

`gh api user` must match the explicitly selected login and numeric account
identity. The service rechecks it; a mismatch stops work instead of
substituting another logged-in account. GitHub content and CI logs remain
untrusted displayed data and do not enter solver context automatically.

Reads are bounded, explicit pages for:

- issues and issue details;
- PRs and PR details;
- PR reviews, conversation comments and inline review comments;
- check runs plus commit statuses, pinned to an exact SHA;
- workflow runs, optionally filtered to an exact SHA;
- one workflow run and bounded plaintext logs;
- releases and release details.

Supported reviewed mutations are issue/PR create and field-preserving
update, including close/reopen; conversation comments; exact-head review
submission; inline replies under the original review comment; exact
review-thread resolution/reopening; exact-head PR merge; and release
create/update/draft publication.

`github.comment.update` and `github.comment.delete` separately select the
conversation or inline-review channel and exact comment ID/owning issue/PR.
Preview retains the actual original comment bytes and revision. Edits
preserve omitted fields; deletion has its own explicit confirmation and
requires an acknowledged absence. A stale or wrong-owner comment is refused.
Deletion never means deleting the retained original Moguri operation.

Review replies use the PR review-comment reply endpoint, not a disconnected
conversation comment. Thread resolution uses a fixed GraphQL operation,
verifies actual repository/PR ownership and refuses an incomplete thread
snapshot exceeding 100 comments.

Remote-resource revisions are captured during preview and rechecked just
before mutation. Strong ETags for the same PATCH/DELETE resource are sent as
`If-Match`; weak ETags and parent/collection ETags are not promoted into an
invalid compare-and-swap guard. GitHub does
**not** promise compare-and-swap for every edit/comment/release/thread
endpoint. There remains a disclosed server race after the last read. No
atomic guarantee is invented and there are no automatic remote-write
retries.

`GitHubWorkflows.invalidateGhCredentials()` is the invalidation hook for an
**explicit gh credential/account change**. It invalidates prior review
digests and aborts actual owned GitHub jobs/watchers. A possibly dispatched
write remains partial. Copilot OAuth login/logout is a different credential
boundary and must not silently invoke this hook, switch gh accounts or
introduce GitHub metadata reads. External gh account changes are also
detected by the before/after account rechecks.

PR merge additionally sends the captured head `sha` in the merge REST
request. A changed head, closed/merged PR, declined merge or mismatched
post-merge observation cannot be reported as the reviewed merge. Merge
strategy is explicit. GitHub's captured server auto-delete policy is shown
separately, and possible server-policy deletion of only the exact captured PR
head branch requires its own actual-user confirmation. Moguri never issues a
client branch-delete request. The SHA guard cannot atomically lock remote
repository settings, so a settings race is disclosed rather than promised
away.

PR creation reads the actual base/head branch APIs and retains their exact
SHAs and repository identities. A fork/custom head repository must be named
explicitly with `headRepository`; a fork name is never inferred. The
documented `head_repo` field is sent for cross-repository creation, including
same-organization forks. The returned repositories/refs/SHAs must still
match. Known transient credential fields such as `temp_clone_token` are
excluded from retained remote metadata; original user-authored text is not
silently edited.

Release review includes the exact tag and resolved remote target commit.
Existing annotated tags are dereferenced with a bounded chain. An existing
tag pointing elsewhere is refused because GitHub ignores `target_commitish`
for an existing tag. New release writes send the pinned commit, and
post-publication tag verification must agree. Creating/updating a non-draft
release and publishing a draft require explicit publication confirmation.
Release assets, uploads and deletion are not silently added.

## CI watching

`github.ci.watch` records one original, cancellable job with an exact
repository/account/head SHA, poll interval and deadline (at most 30 minutes).
Each cycle reads bounded latest check runs, commit statuses and workflow
runs for **that same SHA**. Another branch tip/run is never adopted.

Outcomes distinguish:

- `no-checks`: no checks were observed before the deadline;
- `pending`: incomplete/unknown checks at the deadline;
- `failure`: an observed failing/error/cancelled/timed-out check/run;
- `success`: a complete bounded set of observed successful/neutral/skipped
  checks/statuses/runs.

Finishing the watcher is not passing CI: the result retains both states.
`no-checks`, pending deadlines and unknown conclusions are never success.
Observed success is not branch-protection clearance or permission to merge.
Per-request output and pagination limits fail closed; no omitted page is
treated as green. Cancellation stops the owned process group and polling,
not an unrelated GitHub workflow.

### PR-bound retained watches, protocol 93

The selected-PR lifecycle reuses the libraries/licenses above, existing
`github.operation_recorded`, capability jobs, encrypted operation compartments
and `attention.raised/cleared/acknowledged` events. No dependency, model call,
CI dispatch, Git write or new permission authority is added.

The `github.ci` query and shared SDK/CLI/TUI/desktop require protocol93 so a
healthy older service cannot silently omit this API. Genuine92 upgrades
atomically add `github_pr_ci_watch_schema=1`; existing events, ciphertext,
grants, receipts, budgets and terminal owners are not rewritten. Missing,
corrupt, premature or relabelled actual PR-watch/CI-attention lineage fails
closed. Older head-only operations retain their original semantics and are
never inferred to belong to a PR.

**Identity and admission.** New actions capture both PR number and numeric
account. The project repository, canonical root/device/inode, profile,
workspace, actual account and exact open PR head are rechecked before
admission and throughout polling. Captured view bindings are checked before
accessing GitHub through a replacement root. Activity/presentation-only
changes do not become new root authority; actual policy/permission changes
still invalidate work. The original intent/job/receipt precede owned read
preparation. Duplicate views return the original admitted watch without
starting another loop; a missing receipt cannot authorize a second poller.

**Observations.** `operation.ci` retains its immutable target and latest
observation digest, time/state/count, completeness/deadline and cleanup
uncertainty. The complete normalized original collection lives in that
operation's encrypted compartment. Every new digest participates in the
same event transaction's retention grants. Check/status/run counts,
pagination, duplicates and exact-head results must agree before publication.
The complete observation uses the existing 8-MiB GitHub read envelope; no
prefix is called green. Known credentials are redacted before either the
observation or terminal result is retained.

New PR watches distinguish queued, running, pending, failure, success,
cancelled, timed-out, skipped, neutral, unknown and no-checks. Only the complete
known-success set is success. The watch's own deadline is separate from the
observed GitHub outcome. Failing checks retain canonical links and bounded,
count-checked original annotations, including billing/startup failures with
no logs. A diagnostics failure preserves already observed CI failure and
reports the inspection failure instead of inventing an explanation.

**Failure and recovery.** Head/PR/account/root/access/policy changes never
retarget the original. Historical observations remain inspectable without
resolving another source root. Stop is limited to owned polling and known
groups, not GitHub cancellation or detached-descendant containment. A failed
read cleanup or lost controller acknowledgement stays partial/unconfirmed;
an expired request cannot become a completed empty result. Recovery never
replays polling. A new, independent read requires a fresh exact review and
the original uncertain watch/revision's inspection confirmation. It does
not modify that old report or certify its cleanup. A still-active loop wins
deduplication even when older partial attempts exist.

**Notifications and clients.** Existing attention carries reason `ci` and the
actual terminal operation revision. Projection rejects another source,
profile/session, running operation or fabricated ordinary attention.
Generative turn/answer/approval changes do not clear CI attention; ordinary
conversation navigation does not acknowledge it. Explicit read is only read,
never a model answer, permission, rerun or resume. OS defaults/privacy remain
unchanged. The pane derives watches from service snapshots and reads immutable
reports, without component-owned polling timers. Reopening or switching panes
cannot lose the association or replay a watcher. CLI/TUI derive the exact
source from an explicit session and either a supplied number or one unique
linked PR, without repository/SHA re-entry.

#### Phase 0, 2026-11-06

The generated prerequisite run on pinned Node26.12.0/macOS arm64 records:

| Primitive | Result and measurement |
| --- | --- |
| Generated provider streaming/cancel | PASS; six intercepted requests, cancellation 32.42 ms |
| WAL/crash/rebuild | PASS; 1,000 events, append p95 0.066 ms, rebuild 0.760 ms |
| Known macOS PTY groups | PASS; cancellation 153.44 ms, zero observed known survivors |
| Actual OpenTUI | PASS; 60 updates, mean 17.87 ms |
| Hidden Electron | PASS; cold start 273.00 ms, 449.31 MiB, scroll 8.29 ms/frame |
| Generated filesystem/Git | PASS; 2,000 files, search 1.17 ms, status 10.55 ms |

The spike's legacy declared-FAIL inventory is not a new physical probe or a
statement that subsequently implemented features disappeared. No personal
login, microphone, model weights, paid inference, real PR mutation or CI
dispatch was used. Current native/hosted-CI milestone gates remain separate.
Generated UI teardown also exposed actual `EPERM` group-signal warnings on
this shared host. They remain reported as unconfirmed cleanup, not suppressed
or used as proof that an original reader stopped.

#### Protocol93 qualification

The application/SDK cut is `c3f316432308466c6889ff31c9fc55753a5788ef`.
`b3b33c6390785d487aad7e29c01281e3b999db58` changes only the cold-start test's
owned-publication polling; it does not change application bytes.

| Gate | Actual result |
| --- | --- |
| Source types and dependency audit | PASS; no new dependencies, zero vulnerabilities |
| Combined focused ownership/CI/attention/migration/restart/compiled CLI/native TUI regressions | 106 passed, zero failures/skips |
| Independently installed packed SDK | All entrypoints/declarations and audited install pass; zero consumer vulnerabilities. Its actual installed protocol93 runtime survives a real controller SIGKILL, retains original CI/grants without polling replay and admits a separate explicitly inspected watch |
| Complete source/service/worker/migration/restart/native-TUI suite | 2,490 passed, 29 explicit skips, zero failures/cancellations; 2,519 cases in 3,099,868.16 ms |
| Complete fresh hidden desktop suite | 365 passed, five explicit skips, zero failures; 370 flows in 14.7 minutes |
| Exact unchanged cold-opening latency bounds | All three targeted frames/saved-draft samples pass: shell 427.98/426.95/427.84 ms and complete readiness 2,756.92/2,696.76/2,696.75 ms |

Failed attempts are not relabeled green. The first combined focused sweep
found that a fake-clock deadline test still used a 100-ms real native-request
timer. Its corrected generated clock models expiry after one complete read;
the real uncertain-cleanup deadline guard and production bounds remain.
The first whole desktop sweep has 364 passes, five skips and one failure:
the cold-start fixture read its newly created owned lock during publication,
and the unchanged production reader correctly rejected changing bytes.
The fixture now waits only through that exact not-yet-ready publication
diagnostic, then still requires the spawned child's actual PID. Wrong-owner,
path, permissions and other errors remain fatal; no production reader,
startup deadline or threshold changed. All three targeted cold samples and
the fresh complete desktop run above pass.

Existing Node experimental FFI, Vite large chunks, optional packaging format,
consumer deprecations and explicit lifecycle-script review remain disclosed.
Shared-host `EPERM` group-signal warnings remain genuine unconfirmed cleanup,
not silently successful stops. The actual hosted main-CI account/spending
eligibility failure is unchanged. No workflow dispatch, main push, real
GitHub mutation, upstream release or signing/notarization is implied.
The old protocol92 development DMG remains immutable. No fresh native workload
or whole-descendant containment is qualified by this control-plane feature.

## Schema 41, retention and failure lifecycle

Schema 41 adds `github.operation_recorded: { operation }` and
`snapshot.githubOperations`. Existing events remain append-only; upgrades
preserve old state rather than require deletion.

Every original operation owns immutable profile/root/scope, actual-user
actor, command ID/digest, review/input digests and job ID. The initial
operation, `job.started` with `operationId`, and command receipt are
committed atomically **before dispatch**. The final record and job result
are likewise committed together by the existing lifecycle.

The independent retention identity is `operation.id`, including job
progress/result events. `inputDigest`, `reviewDigest` and any `resultDigest`
are bound into that operation compartment. Source session/project deletion
does not erase or transfer the retained report. History and original
documents remain readable without resolving a new source root.

Projection rejects replaced immutable ownership, non-monotonic revisions,
erased dispatch/cancellation, impossible completion and terminal replay.
Success requires dispatch, an actual result and no cancellation. A duplicate
canonical command returns its existing receipt. A retained command with a
missing receipt is refused: missing receipts, deletion or restart cannot
authorize another write.

An attempted mutation with cancellation, a lost response, failed final
verification or interrupted ownership is **partial** because effects may
already exist. Failure before dispatch can be failed/cancelled without
claiming an effect. A cancelled read-only CI watcher is cancelled, not a
failed GitHub workflow. Recovery terminalizes original running records and
jobs; it never replays an effect, reattaches by inferred PID, resumes a
watcher or automatically continues/aborts a rebase.

When an intermediate CLI/API acknowledgement is available but later checks
fail, its typed result is retained with `outcome: "partial"`, never upgraded
to success. Its diagnostic explicitly labels HEAD/branch/status as the
original pre-effect review rather than current verified repository state.
A lost response or restart cannot fabricate that acknowledgement.

## Cross-client use and validation

`createGithubApi(sdk)` is browser-safe and imports `MoguriSdk` as a type only.
It exposes typed preview/execute, paginated reads, independent history/read,
wait, original-job cancellation and
`acknowledge(operationId, expectedRevision, expectedInputDigest, true)`.
The desktop history/inspection surface also works without a selected source
project. The CLI/TUI and desktop use this shared
API and the service event stream, not client-specific Git state.

```ts
const scope = { env: "Local" as const, projectId, sessionId };
const { preview } = await sdk.github.preview(scope, {
  kind: "git.push", remote: "origin", branch: "main", forceWithLease: false,
});
// Display the exact document and collect every actual-user confirmation.
const admitted = await sdk.github.execute(preview, reviewedConfirmations, true);
const retained = await sdk.github.wait(admitted.id!);
```

Focused verification:

```sh
node --import tsx --test tests/github-workflows*.test.ts
```

Generated tests cover real bare-remote push/leases/tags, hook side effects,
stale reviews, hard policy/folder denials, actual rebase conflicts and
explicit resume/abort, pagination, exact account/head/resource ownership,
issue/PR/review/release mutations, CI outcomes and cancellation, concurrent
root ownership, duplicate/missing receipts, restart/migration and independent
retention after source deletion. Full release readiness, real account
permissions, protected-branch policy and real provider CI behavior remain
separate qualification; generated tests do not claim them.

`tests/github-workflows-service.test.ts` additionally exercises two real SDK
clients against the loopback service, actual source-session cancellation and
independent retention, and rebase recovery without quarantine clearing.
`tests/e2e/github-workflows.spec.ts` uses hidden Electron with a generated
offline service; review edits invalidate approval, main push requires its
separate confirmation, and a lightweight tag result is shared with the SDK.
