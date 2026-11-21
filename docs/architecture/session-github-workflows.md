# Session approvals and GitHub workflow entry points

## Change contract

This slice reuses Node.js (MIT), TypeBox (MIT), React/OpenTUI (MIT), Git
(GPL-2.0), the GitHub CLI (MIT), and Moguri's SDK, event store, scoped secret
backends and existing reviewed GitHub operation lifecycle. No new dependency,
provider framework, shell parser or credential-sharing mechanism is needed.

## Protocol94 GitHub and input follow-up

This user-directed follow-up reuses Node crypto (MIT), maintained pi-ai (MIT),
TypeBox (MIT), React/OpenTUI (MIT), react-markdown/remark-gfm and their HAST types
(MIT), the GitHub CLI (MIT), the existing worker, permission engine, clipboard
bridge and GitHub operation projector. No dependency, authentication flow,
hard-policy override or new actor is introduced.

`fetch_page` is anonymous, including builtin MCP reads. The reported private
repository search succeeds through the already authenticated `gh` account and
fails anonymously with HTTP422. That status is not evidence of a failed
Copilot login. Both public fetch paths now disclose the difference and point
to authenticated exact-project reads without forwarding credentials,
replaying a partial call or borrowing Local authority for Remote/Sandbox.

The shared `GithubBrowseSchema` gains `resource: "search"` and bounded terms.
`sdk.github.search`, `moguri github search`, `/github search` and desktop's
advanced read panel reuse the same authoritative service read. Scope qualifiers
and unmatched query delimiters are denied. Returned repository identities,
complete counts, next-page receipts and the 1,000-result ceiling are checked;
incomplete/foreign/oversized results are not successful empty evidence.
The model-facing `github_read` first discovers the actual project/account,
then permits only that repository/login and rechecks its numeric account.
It is a Local project/worktree read, unavailable to Home, groups, restricted
folders, Remote and Sandbox. Stop/abort, root/policy changes and lost responses
remain original failures, with no account switch or read/write replay.

An actual generated provider with an empty tool-call ID reproduced the
reported `github_corrupt` issue-creation failure. Fresh worker messages now
assign absent, overlong, malformed, control-character or duplicate IDs once
before `model.complete`. The bounded IDs cannot collide with a later valid ID.
Retained completion, selected Kupo response, approval, issue origin and result
then share one runtime-owned identity. Valid provider IDs, output/usage and
older retained source are unchanged. The original issue projector is not
weakened, and old corrupt/partial operations are neither guessed nor replayed.
An actual service restart preserves the completed issue origin and one write.

The desktop reads current native input and current draft readiness for one
Enter, rather than a stale render's empty-text predicate. TUI submission also
synchronizes its native text before reading the shared editor. Autosave is not
a send gate. The existing intake barrier still prevents duplicates and
preserves newer edits, conflicts, composition, modifiers and separate
Resume/Retry behavior.

Guardrails and decision-provider controls sit beside their actual autonomy
options. Explicit Autonomous/Autopilot approvals ignore ask rules, never hard denies,
authentication, source qualification, read-only mode, Env policy or budgets.
Discovery remains a `policy` actor, ordinary automatically delegated calls an
`autonomy` actor, and real answers/grants remain user-owned. Saved Autonomous/Autopilot
defaults and unmarked legacy sessions approve automatically without
reselection; only an explicit `automaticApprovals: false` stays bounded. The main approval menu exposes conservative command
families across the active profile/Env; shell composition and other profiles
stay outside the grant.

Inline and fenced code copy controls reuse the acknowledged clipboard bridge.
Their source is exact Markdown HAST text, never DOM text containing controls.
Renderer identities are stable across unrelated snapshots. Linked-code copies
sit outside the anchor and neither nest buttons in links nor open a link;
keyboard activation, failure feedback and visible focus use existing controls.

Protocol/service **94** is required for the added API and tool catalogue.
SQLite advances only version metadata in an atomic transaction. There are no
new durable event types or encrypted-data rewrites. The metadata-upgrade
fixture preserves original events, grants, receipts and a retained invalid-ID
source across two reopens. Existing genuine91 and CI-watch migration witnesses
remain independent, unchanged evidence.

Fresh generated prerequisites on Node26.12.0/macOS arm64: OAuth cancellation
32.61ms; SQLite append p95 0.0685ms, rebuild 0.6201ms and crash rollback; PTY
cancellation 153.42ms with zero survivors; TUI updates 18.01ms; hidden Electron
startup 187.54ms, 446.20MiB, 8.30ms scroll frames; 2,000-file search/Git
1.137/5.808ms. Current SSH primitive passes in 146.64ms with one owned pinned
loopback inference request; model-window/effort primitives in 77.49ms and local
provider/cancellation primitives in 41.95ms with two generated requests.
The baseline script's static initial-checkpoint unavailable flags are not a
current feature inventory. These current generated probes still do not prove
live model entitlement/quality/billing, external SSH-host readiness, physical
SendBox, signing/notarization or hosted CI.

Focused evidence is in `tests/github-search.test.ts`,
`tests/github-read-migration.test.ts`, `tests/worker-tool-ids.test.ts`,
`tests/github-workflows.test.ts`, `tests/native-web-fetch.test.ts`,
`tests/approval-memory.test.ts`, `tests/tui-input.test.ts`,
`tests/session-github-tui.test.ts` and the corresponding hidden composer,
GitHub-workflow and workspace-action tests. Fresh full source/package evidence
and residual native gates belong to the
[combination map](milestone-combination-matrix.md), not the preceding
protocol93 installer.

The focused pre-freeze run passes types/build, **80 Node/service/worker/CLI/TUI
checks** with no skips or cancellations in **17,905.91ms**, and **six hidden
desktop reproductions** in **8.8s**. These counts do not replace the fresh
complete matrix, complete source/client suites or independently installed
package verification. Existing experimental FFI and lazy bundle-size notices
remain visible.

The [full clean protocol94 qualification](milestone-combination-matrix.md#protocol94-frozen-source-and-package-cut)
then passes 10,562 complete source checks, every 6,720 Local/SSH matrix cell,
382 full hidden desktop flows, the independent installed SDK and actual new
ad-hoc package. All 17 packaged desktop selection/new-fix flows pass too.
Those complete receipts preserve the same `07087bf` executable bytes and their
separate 3,360 native-unqualified cells, hosted billing gate and release/physical
prerequisites.

macOS Local service startup uses a Node-only executable-path helper. It
preserves inherited precedence and appends
only missing standard Homebrew locations, reusing the native-host path list.
Owned programs inherit that Local service environment. Generic process launch,
direct in-process SDK runtimes and Remote peer PATH remain unchanged, so missing
tools on a selected SSH host cannot acquire another executable.
Explicit program environments and absolute executable selections remain exact;
there is no shell-profile execution, executable scan, alternate account,
credential forwarding or automatic CLI installation. Other platforms retain
their original lookup. This launch correction adds no dependency, event,
durable schema or protocol and leaves service restart ownership and Remote
credential boundaries unchanged. Generated service-startup, exact-selection,
explicit-exclusion and cancellation tests cover the behavior.

The Finder-launch follow-up passes type checks and the production build,
**118 related service/process/GitHub/SSH checks with three unqualified native
skips**, **13 hidden desktop flows**, and the independently installed SDK with
all **12 worker continuation probes**. Root and external-consumer audits remain
clean. Missing CLI tools on an SSH peer still produce the original unavailable
error rather than discovering a different executable. A Local version-only
probe confirms the installed Homebrew `gh` starts with the corrected startup
environment, without authentication or a GitHub request. The actual packaged
Node, SDK and matching compiled runtime also pass a generated minimal-PATH
service launch while preserving bundle provenance and environment isolation.
These are focused
follow-up results, not a new full-suite run or personal-account qualification.

Remembered approvals are actual-user settings, scoped to one session, one
project or every project in the current profile. Exact commands, conservative
command families and exact schema/configuration-bound MCP tools are separate
targets. Approval and its remembered setting must be retained atomically.
Models, plugins, command output and structured answers cannot create grants.
Hard denials, read-only modes, environment restrictions, root ownership and
budget limits remain authoritative.

Selecting Autonomous explicitly delegates tool approvals for subsequent turns.
Autopilot has the same automatic tool permission behavior and adds the
existing bounded, metered System One-compatible decision layer. It does not
turn a technical recommendation into a user answer, enable an unqualified
decision transport or silently substitute another model.

GitHub repository discovery is an explicit authenticated controller-side read,
independent of Copilot login and the optional updater token. Repository pickers
prioritize the signed-in user's and organizations' repositories. Public search
is a separate explicit source. Pagination, exact account identity and failure
remain visible. Importing never authenticates, overwrites an existing
destination or executes repository hooks.

Project-specific PR/issue pickers and detail views reuse bounded typed reads.
Writes keep the existing exact preview, explicit confirmation, durable
pre-dispatch intent, independently retained result and no-replay behavior.
Starting from a GitHub item retains its explicit source and draft without
starting inference or changing the checkout. Desktop and TUI consume the same
SDK capabilities.

Read-only GitHub authority does not include transient conversation status.
A session starting or completing an ordinary turn while a slower PR page
loads is activity, not a root or policy change. Reads still bind the exact
profile/session/project/workspace, canonical directory device/inode,
environment, session kind/mode, pending restrictions, permission revision,
project configuration and account. Archival, actual root replacement and
real policy changes still discard the response without retry or fallback.
Mutation-review policy keeps its original stricter status binding.

Protocol/schema **74** ensures a newly installed app cannot reuse a healthy
protocol-73 service with the stale read guard. Its upgrade advances only
version metadata: no new dependency, API shape, event or encrypted-data rewrite.
Generated service and hidden desktop regressions compare successful issue
listing with a held PR list across a real completed model turn, then verify
real root, mode, permission and archival invalidation remains enforced.

The protocol-74 follow-up passed types/build, **74 focused Node checks**,
**seven hidden source-desktop flows** and **seven actual packaged-app flows**.
The installed packed SDK passed its independent install/audit/runtime checks
and all **12 actual worker continuation probes**. A separate exact regression
ran the packaged Node 26.12.0, SDK and service runtime: one held PR-list request
survived one real generated completed model turn, returned its complete original
body/account, and sent no retry or live authenticated request.

Source, external-consumer and no-cache workload audits found **zero
vulnerabilities**. The protocol-74 immutable image is
`docker.io/library/moguri-worker@sha256:0dff889f4ef2ed1c1fa10ad5fa26a37c98197a92e84ca40993f645414fdadb8f`.
Its build preserved the tested compiled worker bytes. The **779,888,697-byte**
ZIP passed the production update consumer in **114,088.94 ms**; private DMG
layout/signature verification opened neither Finder nor the application.
The byte-identical development installer is
`release/Moguri-0.30.0-alpha.1-pr-list-74-macos-arm64.dmg`,
**794,068,251 bytes**, SHA-512:

```text
8cf47c3677b137b473c1ee0a4f768ec1de790940e575a330ec6a028691aa724b5f35350785c7dfcd63375e55352516cdf6c960aea1ddac3ec932ace9bae71aac
```

These are focused bug-fix results, not a relabelled complete suite, live account,
new VM/Linux qualification or notarized release. Existing FFI, lazy Ghostty
chunk, optional `.icon` and upstream deprecation notices remain unchanged.

Protocol/schema 61 preserves existing events and settings. Older grants
are not inferred. By owner decision, Autonomous/Autopilot selections saved before the
marker existed (session controls or startup defaults) count as automatic
approvals; their original events are not rewritten. New sessions resolve
`controls.automaticApprovals: true` from Autonomous/Autopilot defaults, an explicit
`false` keeps the bounded path, and automatic decisions record an `autonomy` actor.
The service supplies the solver's actual automatic-approval guidance before
prompt capture, context sizing and budget admission, without modifying saved
system prompts or adding unsized worker-only context.
`Session.githubSource` retains the original canonical item/account/digest;
relinking clears its current attribution, not its original event.
The source digest also binds profile/project/workspace, canonical root device
and inode, configuration and hard-policy epochs. Replacing a checkout at the
same path cannot reuse its old review. Publication editors survive destination
or policy changes and require explicit destination reload before another
preview; no input is silently discarded or copied into a different root.

After actual owned work quiesces, ordinary service shutdown also closes its
own HTTP connections. An incomplete client body cannot keep a closed window's
service registry/lock alive. Closing transport is not command success, cleanup
proof or permission to replay an unacknowledged write.

Adding a grant alongside its exact actual-user answer advances settings CAS
but does not revoke the unchanged active solver policy. Revocation and ordinary
permission edits still advance the permission epoch and invalidate pending
authority. Remote MCP keeps a digest of every non-remembered setting plus the
actual permission epoch, peer, resource, root, helper and project/mode policy.
Only the additive grant's settings-CAS increment is excluded from that
transport digest. Legacy intents without this optional digest retain their
original revision-bound verification. Remembered Remote tools bind the actual
underlying tool schema, not an ephemeral catalogue wrapper, and still require
fresh scoped discovery after restart. No access-forwarding grant is created.

Schema 61 retains the main-line workspace-experience schema 59 and reviewed
session-navigation schema 60. The exact earlier approval-development schema
59 is recognized only by its distinct retained workflow marker and absence
of main-line/future markers; it atomically adds both main-line markers and
the new convergence marker. Ambiguous/corrupt lineage is never repaired or
inferred from a version number. No ciphertext or existing consent is rewritten.

## Pull request follow-up actions (protocol 112)

Requested by the project owner on 2026-11-17
([D45](decisions.md#d45-pull-request-follow-up-actions)). The Code Change view
adds **Address code review**, **Fix merge conflicts** and **Fix CI** for the
session's linked pull request.

- `sessions.prStatus(sessionId, url)` (`session.pr_status`) reads the PR, up
  to 300 reviews and the head's latest check runs with the same bounded read
  as lifecycle follow-ups, the head's commit statuses (so external CI that
  reports through the Status API counts), GitHub's
  `mergeable`/`mergeable_state`, and the session checkout's current branch. Nothing is retained and no model is
  called. Only a PR linked to the session is read; Remote, Sandbox and grouped
  sessions are refused, because they never fall back to the controller's
  GitHub account.
- The shared `prStatus` rules enable **Address code review** when another
  reviewer's latest review requests changes or comments (the PR author's own
  reviews and later approvals don't count), **Fix merge conflicts** when
  GitHub reports `mergeable: false` or `dirty`, and **Fix CI** when a finished
  check on the head failed. All three stay off, with the reason shown, when
  the PR isn't open or the checkout isn't on the PR branch. Each button shows
  its reason, and **Refresh** reads again.
- A click calls `workflows.start` with the `address-review`, `fix-conflicts`
  or `fix-ci` preset and a prompt carrying only the PR's canonical URL, the
  head SHA prefix and counts. Check names, branch names and reviewer logins
  are repository-controlled text, so they never enter the prompt; the agent
  reads details from GitHub with its tools and treats them as data.
  It queues in this chat with its model, Env, budget and approvals. Pushes,
  thread replies and other GitHub writes stay ordinary approved tool calls;
  the guidance forbids resolving threads, dismissing reviews, force-pushing
  over others or loosening checks.
- The same presets are slash commands for the TUI and CLI (`/address-review`,
  `/fix-conflicts`, `/fix-ci`), without the status gate.

Schema 112 keeps these workflow kinds out of older lineages.
`tests/pr-actions.test.ts` covers the rules, the unretained read and the queued
workflow; `tests/e2e/pr-actions.spec.ts` drives the desktop buttons against
generated GitHub responses.

## Prerequisite measurements

Before implementation, `npm run spike` passed all six available generated
groups on macOS arm64: provider cancellation 31.68 ms; SQLite append p95
0.058 ms and rebuild 0.516 ms; owned PTY cancellation 151.32 ms with zero
survivors; TUI updates 17.29 ms; hidden Electron startup 201.14 ms, 445.23 MiB
and 12.09 ms per frame; 2,000-file search/Git 0.935/5.867 ms.

After integrating the main-line workspace/navigation changes and before the
protocol-61 convergence, all six prerequisite groups passed again: provider
cancellation 32.61 ms; SQLite append p95 0.065 ms and rebuild 0.499 ms; owned
PTY cancellation 152.84 ms with zero survivors; TUI updates 17.88 ms; hidden
Electron startup 171.71 ms, 446.27 MiB and 8.04 ms per frame; 2,000-file
search/Git 0.867/5.950 ms. The same separately listed live/native gates remain
unqualified.

Before integrating remembered Remote MCP approvals, the generated
`npm run spike:remote` passed in 141.29 ms with one actual loopback SSH-worker
inference request, a pinned host identity and no personal account. SSH is not
SendBox containment or external Linux-host qualification.

Live inference, Rust/Linux supervision, notarization, physical native
SendBox, multi-model quality, live Jev, personal SSH and the original wider
milestone gates remain unqualified. The generated probe does not establish
those capabilities. Dependency restoration and audit reported no advisories.

## Required evidence

Generated tests cover automatic approvals and hard denials, conservative
family matching, scope/profile/configuration isolation, concurrent and stale
answers, revocation, cancellation and restart persistence. GitHub tests cover
identity changes, credential-free repository ordering/pagination, exact
project item ownership, original write receipts and source-bound session
creation. Hidden Electron checks exercise repository/item dropdowns, retained
approvals, PR/issue details and creation. SDK packaging verifies browser-safe
entry points and an independently installed consumer.

## Integrated qualification

Runtime, SDK and native-client source is `9a1054e`, including main's workspace
and navigation changes. The generated private-CLI fixture correction is
`babe876`; the desktop fixture now exercises Autopilot's actual technical-answer
layer in `7c291c2`, not the intentionally removed new-mode tool-review gate.
No production source changed during these final runs.

| Check | Result |
| --- | --- |
| Type checks and production build | PASS |
| Complete Node/service/worker/CLI/native-TUI suite | 1,482 passed, 14 platform/native skips, zero failures; 1,496 total / 1,161,821.57 ms |
| Complete hidden Electron suite | 196 passed, three packaged/physical-native skips, zero failures; 199 total / 6.2 minutes |
| Independently packed external SDK | All entrypoints/declarations, approved installation, runtime/client flows and all 12 installed-worker continuation probes pass |
| Root and independently installed consumer audits | Zero vulnerabilities |

Coverage includes exact account/root replacement rejection, real GitHub
publication receipts using generated responses, concurrent approval answers,
Local/SSH MCP grants and revocation, uninterrupted routed-solver continuation,
actual service restart, both schema-59 lineages, interrupted migration rollback,
preserved publication edits and quiesced HTTP shutdown. Tests use generated
data, owned loopback servers and hidden windows, never personal authorization,
real GitHub mutations, a personal terminal or paid model access.

Known non-blocking notices remain: experimental OpenTUI FFI, the lazy Ghostty
bundle-size warning, and deprecated transitive `whatwg-encoding` and
`node-domexception` packages in the packed consumer. The install-script notice
is followed by explicit archive approval and rebuild; no unapproved lifecycle
script runs. These results do not qualify dedicated Jev, Remote/native Autopilot,
external Linux hosts, physical SendBox containment or notarized release
artifacts. CI remains main-push-only; no PR or working-branch trigger was added.
