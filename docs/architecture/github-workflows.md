# Reviewed Git and GitHub workflows

This is an executable, user-reviewed workflow surface, not model-owned Git
permission and not the completion of the wider first-release roadmap.

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

Every request selects `{ env: "Local", projectId, workspaceId?, sessionId? }`.
The service resolves the exact managed root through `WorkflowHost.project`
and `assertRoot`, including canonical path/device/inode. Missing workspaces
never fall back to the base project. A supplied session must still own that
exact project/workspace and be explicitly Local. Side/read-only sessions
cannot mutate either Git or GitHub.

Protocol 57's Local native `create_issue` adapter reuses this exact preview/
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

| Action | Behavior |
| --- | --- |
| `git.push` | Push the captured HEAD SHA to one explicit destination branch. Main/master/configured-main require a separate exact confirmation. |
| `git.push` with `forceWithLease` | Only `--force-with-lease=<full-ref>:<captured-sha-or-absence>`. Never raw `--force`, implicit refreshed leases or automatic retries. |
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
